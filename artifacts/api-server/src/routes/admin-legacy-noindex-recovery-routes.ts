import express, { type Express, type RequestHandler } from 'express';
import { pgApplyLegacyNoindexRecovery, pgPreviewLegacyNoindexRecovery } from '../data/postgres-legacy-noindex-recovery';

export function registerAdminLegacyNoindexRecoveryRoutes(app: Express, requireAdmin: RequestHandler, dependencies = {
  pgApplyLegacyNoindexRecovery, pgPreviewLegacyNoindexRecovery,
}) {
  const json = express.json({ limit: '32kb' });
  const validObject = (body: unknown): body is Record<string, unknown> => Boolean(body) && typeof body === 'object' && !Array.isArray(body);
  const errors: Record<string, { status: number; message: string }> = {
    RECOVERY_INVALID: { status: 400, message: 'Select 1–100 distinct station IDs from the current preview.' },
    RECOVERY_STALE: { status: 409, message: 'The preview or station evidence changed. Run a new preview before applying.' },
    RECOVERY_BUSY: { status: 409, message: 'Catalog maintenance is busy. Run a new preview and retry.' },
  };
  for (const action of ['preview', 'apply'] as const) {
    app.post(`/api/admin/seo-noindex-recovery/${action}`, requireAdmin, json, async (req, res) => {
      res.set('Cache-Control', 'private, no-store');
      const body = req.body ?? {};
      const allowed = action === 'apply' ? ['previewId', 'stationIds'] : [];
      if (Object.keys(req.query).length || !validObject(body) || Object.keys(body).some(key => !allowed.includes(key)) ||
          (action === 'apply' && (typeof body.previewId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.previewId) ||
            !Array.isArray(body.stationIds) || body.stationIds.length < 1 || body.stationIds.length > 100 ||
            body.stationIds.some(id => typeof id !== 'string' || !id || id.length > 200) ||
            new Set(body.stationIds).size !== body.stationIds.length))) {
        return void res.status(400).json({ code: 'RECOVERY_INVALID', error: errors.RECOVERY_INVALID.message });
      }
      const controller = new AbortController();
      const disconnected = () => { if (!res.writableFinished) controller.abort(); };
      res.on('close', disconnected);
      try {
        const result = action === 'preview'
          ? await dependencies.pgPreviewLegacyNoindexRecovery({ signal: controller.signal })
          : await dependencies.pgApplyLegacyNoindexRecovery({ previewId: body.previewId as string,
            stationIds: body.stationIds as string[], signal: controller.signal,
            actor: String((req.user as any)?._id || (req.user as any)?.id || 'authenticated-admin') });
        res.json(result);
      } catch (error: any) {
        const known = errors[error?.code];
        res.status(known?.status || 503).json({ code: known ? error.code : 'RECOVERY_UNAVAILABLE',
          error: known?.message || 'Recovery could not complete safely. Run a new preview and retry.' });
      } finally { res.off('close', disconnected); }
    });
  }
}
