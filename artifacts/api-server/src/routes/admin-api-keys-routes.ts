import { Router, type Request, type Response } from 'express';
import {
  API_PLAN_LIMITS, pgAdminApiDevelopers, pgAdminApiKeys, pgApiAccessStats,
  pgUpdateApiKeyPlan, pgUpdateApiKeyStatus,
} from '../data/postgres-api-access-store';

// routes.ts mounts this router behind requireAdmin.
const router = Router();
const pagination = (req: Request) => ({
  page: Math.min(1000000, Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1)),
  limit: Math.min(100, Math.max(1, parseInt(String(req.query.limit || '25'), 10) || 25)),
  search: String(req.query.search || '').trim(),
});
function failure(res: Response, error: unknown, message: string) {
  console.error(message, error instanceof Error ? error.message : 'Database unavailable');
  res.status(503).json({ error: message });
}
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const { demo, free, pro } = API_PLAN_LIMITS;
    res.json({ ...await pgApiAccessStats(), planLimits: { demo, free, pro } });
  } catch (error) { failure(res, error, 'Failed to load API key stats'); }
});
router.get('/users', async (req: Request, res: Response) => {
  try { res.json(await pgAdminApiDevelopers(pagination(req))); }
  catch (error) { failure(res, error, 'Failed to load API users'); }
});
router.get('/keys', async (req: Request, res: Response) => {
  try {
    const plan = String(req.query.plan || ''), status = String(req.query.status || '');
    res.json(await pgAdminApiKeys({ ...pagination(req),
      plan: ['demo', 'free', 'pro', 'internal'].includes(plan) ? plan : '',
      status: ['active', 'revoked', 'expired', 'suspended'].includes(status) ? status : '' }));
  } catch (error) { failure(res, error, 'Failed to load API keys'); }
});
router.post('/keys/:id/status', async (req: Request, res: Response) => {
  try {
    const status = req.body?.status;
    if (!['active', 'revoked', 'suspended'].includes(status))
      return void res.status(400).json({ error: 'status must be active, revoked, or suspended' });
    const key = await pgUpdateApiKeyStatus(String(req.params.id), status);
    if (!key) return void res.status(404).json({ error: 'API key not found' });
    res.json({ success: true, key });
  } catch (error) { failure(res, error, 'Failed to update key status'); }
});
router.post('/keys/:id/plan', async (req: Request, res: Response) => {
  try {
    const plan = req.body?.plan;
    if (plan !== 'free' && plan !== 'pro')
      return void res.status(400).json({ error: 'plan must be free or pro' });
    const key = await pgUpdateApiKeyPlan(String(req.params.id), plan);
    if (!key) return void res.status(404).json({ error: 'API key not found' });
    res.json({ success: true, key });
  } catch (error) { failure(res, error, 'Failed to update key plan'); }
});

export default router;
