/**
 * TV / mobile app version manifest.
 *
 * GET  /api/tv/version        — public, no auth, CORS *
 * GET  /api/admin/tv-version  — admin read (returns same doc)
 * PUT  /api/admin/tv-version  — admin write (full replace of config fields)
 *
 * The document is stored as a single MongoDB record so version numbers,
 * release notes, and store URLs can be updated without a code deploy.
 */

import type { Express, Request, Response } from 'express';
import { TvVersionConfig } from '@workspace/db-shared/mongo-schemas';
import { logger } from '../utils/logger';
import CacheManager from '../cache';

const CACHE_KEY = 'tv_version_config';
const CACHE_TTL = 300; // 5 minutes

const DEFAULT_CONFIG = {
  latest: {
    tizen:     '1.0.3',
    webos:     '1.0.3',
    tvos:      '1.0.0',
    androidtv: '1.0.0',
    macos:     '1.0.0',
    desktop:   '1.0.0',
    ios:       '5.4.3',
    android:   '5.4.3',
    web:       '1.0.0',
  },
  minimum: {} as Record<string, string>,
  releaseNotes: {
    tr: 'Yeni: ICY metadata, Login odak düzeltmesi, performans iyileştirmeleri.',
    en: 'New: ICY metadata, login focus fix, performance improvements.',
  },
  storeUrl: {
    tizen:     'https://www.samsung.com/global/galaxy/apps/samsung-smart-tv/',
    webos:     'https://www.lgappstv.com/',
    tvos:      '',
    androidtv: 'https://play.google.com/store/apps/details?id=com.themegaradio.tv',
    macos:     '',
    desktop:   'https://github.com/themegaradio/desktop/releases/latest',
    ios:       '',
    android:   'https://play.google.com/store/apps/details?id=com.themegaradio',
  },
};

function openCors(res: Response) {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  });
}

export function registerTvVersionRoutes(app: Express, deps: any) {
  const { requireAdmin } = deps;

  // OPTIONS preflight for TV clients
  app.options('/api/tv/version', (_req, res) => {
    openCors(res);
    res.sendStatus(204);
  });

  // GET /api/tv/version — public
  app.get('/api/tv/version', async (_req: Request, res: Response) => {
    openCors(res);
    try {
      const config = await CacheManager.getOrSetSingleFlight<any>(CACHE_KEY, async () => {
        const doc = await TvVersionConfig.findOne().lean();
        return doc ?? DEFAULT_CONFIG;
      }, { ttl: CACHE_TTL });

      const { latest, minimum, releaseNotes, storeUrl } = config;
      res.json({ latest, minimum, releaseNotes, storeUrl });
    } catch (err: any) {
      logger.error('tv/version fetch failed:', err?.message);
      // Clients treat 5xx as "no update needed" — still return default so
      // TV apps that handle errors gracefully see sensible fallback data.
      res.status(200).json(DEFAULT_CONFIG);
    }
  });

  // GET /api/admin/tv-version — admin read
  app.get('/api/admin/tv-version', requireAdmin, async (_req: Request, res: Response) => {
    try {
      const doc = await TvVersionConfig.findOne().lean();
      res.json(doc ?? { ...DEFAULT_CONFIG, _isDefault: true });
    } catch (err: any) {
      logger.error('admin/tv-version GET failed:', err?.message);
      res.status(500).json({ error: 'Failed to fetch version config' });
    }
  });

  // PUT /api/admin/tv-version — admin write
  app.put('/api/admin/tv-version', requireAdmin, async (req: Request, res: Response) => {
    try {
      const { latest, minimum, releaseNotes, storeUrl } = req.body ?? {};

      if (!latest || typeof latest !== 'object') {
        return void res.status(400).json({ error: '`latest` object is required' });
      }

      const update = {
        latest,
        minimum:      typeof minimum === 'object'      ? minimum      : {},
        releaseNotes: typeof releaseNotes === 'object' ? releaseNotes : {},
        storeUrl:     typeof storeUrl === 'object'     ? storeUrl     : {},
        updatedAt:    new Date(),
      };

      await TvVersionConfig.findOneAndUpdate({}, update, { upsert: true, new: true });
      await CacheManager.del(CACHE_KEY);

      logger.log('TV version config updated');
      res.json({ message: 'TV version config updated', ...update });
    } catch (err: any) {
      logger.error('admin/tv-version PUT failed:', err?.message);
      res.status(500).json({ error: 'Failed to update version config' });
    }
  });
}
