import type { Express, Request, Response } from 'express';
import { AdminPreference } from '../shared/mongo-schemas';
import { logger } from '../utils/logger';

// Generic per-admin key/value preferences store. Lets admin pages
// persist view state (filters, sorts, toggles, etc.) against the
// signed-in admin account so it follows them across devices and
// browsers, instead of only living in localStorage.
//
// All endpoints are gated by `requireAdmin`. Keys are namespaced by
// the caller (e.g. `country-language-mappings:view-prefs:v1`) so a
// single endpoint pair can back any number of admin pages.

const KEY_REGEX = /^[a-zA-Z0-9._:-]{1,128}$/;

function getAdminUsername(req: Request): string | null {
  const adminAuth = (req.session as any)?.adminAuth;
  const username = adminAuth?.username;
  return typeof username === 'string' && username.length > 0 ? username : null;
}

export function registerAdminPreferencesRoutes(app: Express, deps: any) {
  const { requireAdmin } = deps;

  app.get(
    '/api/admin/preferences/:key',
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const key = String(req.params.key ?? '');
        if (!KEY_REGEX.test(key)) {
          return void res.status(400).json({ error: 'Invalid preference key' });
        }
        const adminUsername = getAdminUsername(req);
        if (!adminUsername) {
          return void res.status(401).json({ error: 'Admin identity unavailable' });
        }

        const doc = await AdminPreference.findOne({ adminUsername, key }).lean();
        if (!doc) {
          return void res.json({ key, value: null, updatedAt: null });
        }
        return void res.json({
          key,
          value: doc.value ?? null,
          updatedAt: doc.updatedAt ?? null,
        });
      } catch (error: any) {
        logger.error('Error reading admin preference:', error);
        return void res.status(500).json({ error: 'Failed to read preference' });
      }
    },
  );

  app.delete(
    '/api/admin/preferences/:key',
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const key = String(req.params.key ?? '');
        if (!KEY_REGEX.test(key)) {
          return void res.status(400).json({ error: 'Invalid preference key' });
        }
        const adminUsername = getAdminUsername(req);
        if (!adminUsername) {
          return void res.status(401).json({ error: 'Admin identity unavailable' });
        }

        const result = await AdminPreference.deleteOne({ adminUsername, key });
        return void res.json({
          key,
          deleted: result.deletedCount ?? 0,
        });
      } catch (error: any) {
        logger.error('Error deleting admin preference:', error);
        return void res.status(500).json({ error: 'Failed to delete preference' });
      }
    },
  );

  app.put(
    '/api/admin/preferences/:key',
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const key = String(req.params.key ?? '');
        if (!KEY_REGEX.test(key)) {
          return void res.status(400).json({ error: 'Invalid preference key' });
        }
        const adminUsername = getAdminUsername(req);
        if (!adminUsername) {
          return void res.status(401).json({ error: 'Admin identity unavailable' });
        }

        const body = (req.body ?? {}) as { value?: unknown };
        if (!('value' in body)) {
          return void res.status(400).json({ error: 'Body must include "value"' });
        }

        const value = body.value ?? null;
        const now = new Date();
        const doc = await AdminPreference.findOneAndUpdate(
          { adminUsername, key },
          { $set: { value, updatedAt: now }, $setOnInsert: { createdAt: now } },
          { upsert: true, new: true },
        ).lean();

        return void res.json({
          key,
          value: doc?.value ?? null,
          updatedAt: doc?.updatedAt ?? now,
        });
      } catch (error: any) {
        logger.error('Error writing admin preference:', error);
        return void res.status(500).json({ error: 'Failed to write preference' });
      }
    },
  );
}
