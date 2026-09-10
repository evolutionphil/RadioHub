import express, { type Express, type RequestHandler } from 'express';
import { getPostgresPool } from '../postgres-runtime';
import { PostgresDuplicateJobsStore } from '../data/postgres-duplicate-jobs-store';
import { duplicateMergeEnabled } from '../services/scheduled-duplicate-merge';

export function registerAdminDuplicateJobRoutes(app: Express, requireAdmin: RequestHandler) {
  const store = () => new PostgresDuplicateJobsStore(getPostgresPool());
  app.post('/api/admin/auto-merge-all', requireAdmin, express.json({ limit: '8kb' }), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      if (!duplicateMergeEnabled()) return void res.status(409).json({ success: false, error: 'Duplicate merge worker is disabled' });
      if (req.body?.dryRun !== undefined && typeof req.body.dryRun !== 'boolean') return void res.status(400).json({ error: 'dryRun must be a boolean' });
      const jobId = req.body?.dryRun === false ? await store().createApply(req.body.previewJobId)
        : await store().createPreview(Number(req.body?.threshold ?? 0.85));
      res.json({ success: true, async: true, jobId });
    } catch (error: any) {
      const status = [400,409].includes(error?.status) ? error.status : 503;
      res.status(status).json({ success: false, error: status === 503 ? 'Duplicate queue is temporarily unavailable' : error.message });
    }
  });
  app.get('/api/admin/auto-merge-status', requireAdmin, async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      res.json({ enabled: duplicateMergeEnabled(), automaticDailyEnabled: duplicateMergeEnabled(),
        intervalSeconds: 15, dailyGroupLimit: 100, ...await store().getStatus() });
    } catch { res.status(503).json({ error: 'Duplicate queue status is temporarily unavailable' }); }
  });
  app.get('/api/admin/merge-jobs/:jobId', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const job = await store().getJob(req.params.jobId);
      if (!job) return void res.status(404).json({ error: 'Job not found' });
      res.json(job);
    } catch { res.status(503).json({ error: 'Duplicate job is temporarily unavailable' }); }
  });
}
