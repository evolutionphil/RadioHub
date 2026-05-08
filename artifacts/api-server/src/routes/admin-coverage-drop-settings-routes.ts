import type { Express, Request, Response } from 'express';
import { AdminSetting } from '@workspace/db-shared/mongo-schemas';
import { logger } from '../utils/logger';
import {
  COVERAGE_DROP_SETTINGS_KEY,
  invalidateCoverageDropSettingsCache,
  loadStoredCoverageDropSettings,
  resolveCoverageDropSettings,
  getDefaultCoverageDropSettings,
  getEnvCoverageDropSettings,
  sendTestCoverageDropWebhook,
} from '../services/coverage-drop-notifier';

// Task #183: admin-tunable coverage drop alert settings.
//
// Lets admins set the drop threshold (pp), minimum-stations floor and
// optional Slack/Discord-compatible webhook URL from the UI without a
// redeploy. Stored in `AdminSetting` under the `coverage-drop-alert`
// key; env vars remain a fallback when no override has been set.

const MAX_THRESHOLD_PP = 100;
const MAX_MIN_STATIONS = 1_000_000;
const MAX_WEBHOOK_URL_LENGTH = 2_048;

function getAdminUsername(req: Request): string | null {
  const adminAuth = (req.session as any)?.adminAuth;
  const username = adminAuth?.username;
  return typeof username === 'string' && username.length > 0 ? username : null;
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

async function buildResponse() {
  const stored = await loadStoredCoverageDropSettings({ bypassCache: true });
  const env = getEnvCoverageDropSettings();
  const defaults = getDefaultCoverageDropSettings();
  const resolved = await resolveCoverageDropSettings();
  const doc = await AdminSetting.findOne({ key: COVERAGE_DROP_SETTINGS_KEY }).lean();
  return {
    stored,
    env: {
      thresholdPp: env.thresholdPp.source === 'env' ? env.thresholdPp.value : null,
      minStations: env.minStations.source === 'env' ? env.minStations.value : null,
      webhookUrl: env.webhookUrl,
    },
    defaults,
    effective: {
      thresholdPp: resolved.thresholdPp,
      minStations: resolved.minStations,
      webhookUrl: resolved.webhookUrl,
      source: resolved.source,
    },
    updatedAt: doc?.updatedAt ?? null,
    updatedBy: doc?.updatedBy ?? null,
  };
}

export function registerAdminCoverageDropSettingsRoutes(app: Express, deps: any) {
  const { requireAdmin } = deps;

  app.get(
    '/api/admin/settings/coverage-drop-alert',
    requireAdmin,
    async (_req: Request, res: Response) => {
      try {
        const payload = await buildResponse();
        return void res.json(payload);
      } catch (error: any) {
        logger.error('Error reading coverage drop settings:', error);
        return void res.status(500).json({ error: 'Failed to read settings' });
      }
    },
  );

  app.put(
    '/api/admin/settings/coverage-drop-alert',
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const body = (req.body ?? {}) as {
          thresholdPp?: unknown;
          minStations?: unknown;
          webhookUrl?: unknown;
        };

        const next: {
          thresholdPp: number | null;
          minStations: number | null;
          webhookUrl: string | null;
        } = { thresholdPp: null, minStations: null, webhookUrl: null };

        if (body.thresholdPp !== undefined && body.thresholdPp !== null && body.thresholdPp !== '') {
          const n = Number(body.thresholdPp);
          if (!Number.isFinite(n) || n < 0 || n > MAX_THRESHOLD_PP) {
            return void res.status(400).json({
              error: `thresholdPp must be a number between 0 and ${MAX_THRESHOLD_PP}`,
            });
          }
          next.thresholdPp = Math.round(n * 10) / 10;
        }

        if (body.minStations !== undefined && body.minStations !== null && body.minStations !== '') {
          const n = Number(body.minStations);
          if (!Number.isFinite(n) || n < 0 || n > MAX_MIN_STATIONS) {
            return void res.status(400).json({
              error: `minStations must be an integer between 0 and ${MAX_MIN_STATIONS}`,
            });
          }
          next.minStations = Math.floor(n);
        }

        if (body.webhookUrl !== undefined && body.webhookUrl !== null) {
          const raw = String(body.webhookUrl).trim();
          if (raw.length > 0) {
            if (raw.length > MAX_WEBHOOK_URL_LENGTH) {
              return void res
                .status(400)
                .json({ error: 'webhookUrl is too long' });
            }
            if (!isHttpUrl(raw)) {
              return void res
                .status(400)
                .json({ error: 'webhookUrl must be an http(s) URL' });
            }
            next.webhookUrl = raw;
          }
        }

        const adminUsername = getAdminUsername(req);
        const now = new Date();
        await AdminSetting.findOneAndUpdate(
          { key: COVERAGE_DROP_SETTINGS_KEY },
          {
            $set: {
              value: next,
              updatedAt: now,
              updatedBy: adminUsername,
            },
            $setOnInsert: { createdAt: now, key: COVERAGE_DROP_SETTINGS_KEY },
          },
          { upsert: true, new: true },
        );

        invalidateCoverageDropSettingsCache();
        const payload = await buildResponse();
        return void res.json(payload);
      } catch (error: any) {
        logger.error('Error writing coverage drop settings:', error);
        return void res.status(500).json({ error: 'Failed to write settings' });
      }
    },
  );

  app.post(
    '/api/admin/settings/coverage-drop-alert/test',
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const body = (req.body ?? {}) as { webhookUrl?: unknown };
        // Prefer the URL the admin just typed (so they can validate
        // before saving). Otherwise fall back to whatever URL would
        // actually be used the next time a real drop fires.
        let url: string | null = null;
        let urlSource: 'request' | 'effective' = 'effective';
        if (body.webhookUrl !== undefined && body.webhookUrl !== null) {
          const raw = String(body.webhookUrl).trim();
          if (raw.length > 0) {
            if (raw.length > MAX_WEBHOOK_URL_LENGTH) {
              return void res
                .status(400)
                .json({ error: 'webhookUrl is too long' });
            }
            if (!isHttpUrl(raw)) {
              return void res
                .status(400)
                .json({ error: 'webhookUrl must be an http(s) URL' });
            }
            url = raw;
            urlSource = 'request';
          }
        }
        if (!url) {
          const resolved = await resolveCoverageDropSettings();
          if (resolved.webhookUrl) {
            url = resolved.webhookUrl;
            urlSource = 'effective';
          }
        }
        if (!url) {
          return void res.status(400).json({
            error:
              'No webhook URL is currently configured (DB override or env var). Set one before sending a test alert.',
          });
        }
        const adminUsername = getAdminUsername(req);
        const result = await sendTestCoverageDropWebhook(url, adminUsername);
        return void res.json({
          urlSource,
          ...result,
        });
      } catch (error: any) {
        logger.error('Error sending coverage drop test webhook:', error);
        return void res
          .status(500)
          .json({ error: 'Failed to send test webhook' });
      }
    },
  );

  app.delete(
    '/api/admin/settings/coverage-drop-alert',
    requireAdmin,
    async (_req: Request, res: Response) => {
      try {
        await AdminSetting.deleteOne({ key: COVERAGE_DROP_SETTINGS_KEY });
        invalidateCoverageDropSettingsCache();
        const payload = await buildResponse();
        return void res.json(payload);
      } catch (error: any) {
        logger.error('Error clearing coverage drop settings:', error);
        return void res.status(500).json({ error: 'Failed to clear settings' });
      }
    },
  );
}
