import type { Express, Request, Response } from 'express';
import { AdminSetting } from '@workspace/db-shared/mongo-schemas';
import { logger } from '../utils/logger';
import {
  clearAdminSettingWithHistory,
  listAdminSettingHistory,
  parseHistoryLimit,
  upsertAdminSettingWithHistory,
} from '../services/admin-setting-audit';
import {
  MAPPING_AUDIT_DIGEST_SETTINGS_KEY,
  invalidateMappingAuditDigestSettingsCache,
  isMappingAuditDigestCadence,
  loadStoredMappingAuditDigestSettings,
  resolveMappingAuditDigestSettings,
  getDefaultMappingAuditDigestCadence,
  getEnvMappingAuditDigestCadence,
} from '../services/mapping-audit-digest-settings';

// Task #284: admin-tunable cadence for the mapping-audit digest email.
//
// Lets admins flip the digest between off / daily / weekly without a
// redeploy. Stored in `AdminSetting` under the
// `mapping-audit-digest` key; env var `MAPPING_AUDIT_DIGEST_CADENCE`
// remains a fallback when no override has been set.

function getAdminUsername(req: Request): string | null {
  const adminAuth = (req.session as any)?.adminAuth;
  const username = adminAuth?.username;
  return typeof username === 'string' && username.length > 0 ? username : null;
}

async function buildResponse() {
  const stored = await loadStoredMappingAuditDigestSettings({ bypassCache: true });
  const env = getEnvMappingAuditDigestCadence();
  const defaults = { cadence: getDefaultMappingAuditDigestCadence() };
  const resolved = await resolveMappingAuditDigestSettings();
  const doc = await AdminSetting.findOne({
    key: MAPPING_AUDIT_DIGEST_SETTINGS_KEY,
  }).lean();
  return {
    stored,
    env: { cadence: env },
    defaults,
    effective: {
      cadence: resolved.cadence,
      lookbackMs: resolved.lookbackMs,
      source: resolved.source,
    },
    updatedAt: doc?.updatedAt ?? null,
    updatedBy: doc?.updatedBy ?? null,
  };
}

export function registerAdminMappingAuditDigestSettingsRoutes(
  app: Express,
  deps: any,
) {
  const { requireAdmin } = deps;

  app.get(
    '/api/admin/settings/mapping-audit-digest',
    requireAdmin,
    async (_req: Request, res: Response) => {
      try {
        const payload = await buildResponse();
        return void res.json(payload);
      } catch (error: any) {
        logger.error('Error reading mapping-audit digest settings:', error);
        return void res.status(500).json({ error: 'Failed to read settings' });
      }
    },
  );

  app.put(
    '/api/admin/settings/mapping-audit-digest',
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const body = (req.body ?? {}) as { cadence?: unknown };
        if (!isMappingAuditDigestCadence(body.cadence)) {
          return void res.status(400).json({
            error: "cadence must be one of 'off', 'daily', 'weekly'",
          });
        }
        const next = { cadence: body.cadence };

        const adminUsername = getAdminUsername(req);
        await upsertAdminSettingWithHistory({
          key: MAPPING_AUDIT_DIGEST_SETTINGS_KEY,
          value: next,
          changedBy: adminUsername,
          logTag: 'mapping-audit-digest',
        });

        invalidateMappingAuditDigestSettingsCache();
        const payload = await buildResponse();
        return void res.json(payload);
      } catch (error: any) {
        logger.error('Error writing mapping-audit digest settings:', error);
        return void res.status(500).json({ error: 'Failed to write settings' });
      }
    },
  );

  app.delete(
    '/api/admin/settings/mapping-audit-digest',
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const adminUsername = getAdminUsername(req);
        await clearAdminSettingWithHistory({
          key: MAPPING_AUDIT_DIGEST_SETTINGS_KEY,
          changedBy: adminUsername,
          logTag: 'mapping-audit-digest',
        });

        invalidateMappingAuditDigestSettingsCache();
        const payload = await buildResponse();
        return void res.json(payload);
      } catch (error: any) {
        logger.error('Error clearing mapping-audit digest settings:', error);
        return void res.status(500).json({ error: 'Failed to clear settings' });
      }
    },
  );

  app.get(
    '/api/admin/settings/mapping-audit-digest/history',
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const entries = await listAdminSettingHistory(
          MAPPING_AUDIT_DIGEST_SETTINGS_KEY,
          parseHistoryLimit(req.query.limit),
        );
        return void res.json({ entries });
      } catch (error: any) {
        logger.error(
          'Error reading mapping-audit digest settings history:',
          error,
        );
        return void res.status(500).json({ error: 'Failed to read history' });
      }
    },
  );
}
