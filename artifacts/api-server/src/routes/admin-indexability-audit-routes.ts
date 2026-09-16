import type { Express, RequestHandler } from 'express';
import { once } from 'node:events';
import { pgAuditStationIndexability } from '../data/postgres-indexability-audit';
import { getQualifiedLanguagesState } from '../seo/qualified-languages';
import { AUDIT_CSV_HEADER, stationAuditCsv } from '../seo/station-indexability-audit';

/** Explicit on-demand action only: opening SEO Maintenance never scans the catalog. */
export function registerAdminIndexabilityAuditRoutes(app: Express, requireAdmin: RequestHandler, dependencies = {
  getQualifiedLanguagesState, pgAuditStationIndexability,
}) {
  app.get('/api/admin/seo-indexability-audit', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    if (Object.keys(req.query).some(key => key !== 'format') ||
        req.query.format !== undefined && !['json', 'csv'].includes(String(req.query.format))) {
      return void res.status(400).json({ error: 'Invalid audit format' });
    }
    const controller = new AbortController();
    const disconnected = () => { if (!res.writableFinished) controller.abort(); };
    res.on('close', disconnected);
    let csvStarted = false;
    const csv = req.query.format === 'csv';
    try {
      const qualified = await dependencies.getQualifiedLanguagesState();
      const report = await dependencies.pgAuditStationIndexability({ qualifiedLanguages: qualified.languages, signal: controller.signal,
        ...(csv ? { onStation: async (station, decision) => {
          if (controller.signal.aborted) throw new Error('Client disconnected');
          if (!csvStarted) {
            res.type('text/csv');
            res.set('Content-Disposition', 'attachment; filename="station-indexability-review.csv"');
            res.write(AUDIT_CSV_HEADER); csvStarted = true;
          }
          // Full-catalog compact review export includes passing records so
          // reviewers can reconcile all rows, not just selected examples.
          if (!res.write(stationAuditCsv(station, decision))) {
            await once(res, 'drain', { signal: controller.signal });
          }
        } } : {}),
      });
      if (csv) {
        if (!csvStarted) {
          res.type('text/csv'); res.set('Content-Disposition', 'attachment; filename="station-indexability-review.csv"');
          res.write(AUDIT_CSV_HEADER);
        }
        res.end();
      } else res.json(report);
    } catch (error: any) {
      // A truncated download must fail, never masquerade as a complete CSV.
      if (res.headersSent) res.destroy();
      else res.status(error?.code === 'AUDIT_BUSY' ? 409 : 503).json({ error: error?.code === 'AUDIT_BUSY'
        ? 'An audit is already running. Retry when it finishes.' : 'Indexability audit is temporarily unavailable. Please retry.' });
    } finally { res.off('close', disconnected); }
  });
}
