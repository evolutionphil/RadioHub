import { Router, Request, Response } from 'express';
import { ApiKey, ApiUser, DemoUsage } from '@workspace/db-shared/mongo-schemas';

// Admin-only visibility + management for the public Developer API program.
// Surfaces who registered for an API key, which plan they're on, and exactly
// how many requests each key has made (today / month / all-time). Mounted
// behind requireAdmin in routes.ts — no auth logic lives here.

const router = Router();

// Keep these in sync with PLAN_LIMITS in routes/api-keys.ts. When an admin
// changes a key's plan we also re-stamp its concrete limit fields so the
// per-request middleware enforces the new tier immediately.
const PLAN_LIMITS: Record<string, { rateLimitPerMin: number; dailyQuota: number; monthlyQuota: number }> = {
  demo: { rateLimitPerMin: 10, dailyQuota: 100, monthlyQuota: 500 },
  free: { rateLimitPerMin: 60, dailyQuota: 1000, monthlyQuota: 10000 },
  pro: { rateLimitPerMin: 300, dailyQuota: 10000, monthlyQuota: 100000 },
};

// GET /api/admin/api-keys/stats — program-wide overview cards.
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const [
      totalDevelopers,
      totalKeys,
      activeKeys,
      planAgg,
      usageAgg,
      activeDemoKeys,
    ] = await Promise.all([
      ApiUser.estimatedDocumentCount(),
      ApiKey.countDocuments({ plan: { $ne: 'demo' } }),
      ApiKey.countDocuments({ plan: { $ne: 'demo' }, status: 'active' }),
      ApiKey.aggregate([
        { $group: { _id: '$plan', count: { $sum: 1 } } },
      ]).option({ maxTimeMS: 10000 }),
      ApiKey.aggregate([
        {
          $group: {
            _id: null,
            today: { $sum: '$usage.todayCount' },
            month: { $sum: '$usage.monthCount' },
            total: { $sum: '$usage.totalCount' },
          },
        },
      ]).option({ maxTimeMS: 10000 }),
      DemoUsage.estimatedDocumentCount(),
    ]);

    const byPlan: Record<string, number> = { demo: 0, free: 0, pro: 0 };
    for (const row of planAgg) {
      if (row._id) byPlan[row._id] = row.count;
    }
    const usage = usageAgg[0] || { today: 0, month: 0, total: 0 };

    res.json({
      totalDevelopers,
      totalKeys,
      activeKeys,
      activeDemoKeys,
      byPlan,
      requests: {
        today: usage.today || 0,
        month: usage.month || 0,
        total: usage.total || 0,
      },
      planLimits: PLAN_LIMITS,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to load API key stats' });
  }
});

// GET /api/admin/api-keys/users — registered developers with aggregated usage.
router.get('/users', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '25'), 10) || 25));
    const search = String(req.query.search || '').trim();

    const filter: Record<string, unknown> = {};
    if (search) {
      const safe = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { email: { $regex: safe, $options: 'i' } },
        { name: { $regex: safe, $options: 'i' } },
        { company: { $regex: safe, $options: 'i' } },
      ];
    }

    const [users, totalCount] = await Promise.all([
      ApiUser.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select('email name company website plan status createdAt lastLoginAt')
        .lean(),
      ApiUser.countDocuments(filter),
    ]);

    // Join each developer's keys by email (reliable across both register and
    // standalone /request flows) to compute live key counts + usage totals.
    const emails = users.map((u) => u.email);
    const keyAgg = emails.length
      ? await ApiKey.aggregate([
          { $match: { email: { $in: emails } } },
          {
            $group: {
              _id: '$email',
              keyCount: { $sum: 1 },
              activeKeys: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
              today: { $sum: '$usage.todayCount' },
              month: { $sum: '$usage.monthCount' },
              total: { $sum: '$usage.totalCount' },
              lastUsedAt: { $max: '$usage.lastUsedAt' },
            },
          },
        ]).option({ maxTimeMS: 10000 })
      : [];

    const byEmail = new Map<string, any>(keyAgg.map((k) => [k._id, k]));
    const rows = users.map((u) => {
      const k = byEmail.get(u.email);
      return {
        ...u,
        keyCount: k?.keyCount || 0,
        activeKeys: k?.activeKeys || 0,
        usage: {
          today: k?.today || 0,
          month: k?.month || 0,
          total: k?.total || 0,
        },
        lastUsedAt: k?.lastUsedAt || null,
      };
    });

    res.json({ users: rows, page, limit, totalCount, pages: Math.ceil(totalCount / limit) });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to load API users' });
  }
});

// GET /api/admin/api-keys/keys — every issued key with usage + owner.
router.get('/keys', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '25'), 10) || 25));
    const search = String(req.query.search || '').trim();
    const plan = String(req.query.plan || '').trim();
    const status = String(req.query.status || '').trim();

    const filter: Record<string, unknown> = {};
    if (plan && ['demo', 'free', 'pro'].includes(plan)) filter.plan = plan;
    if (status && ['active', 'revoked', 'expired', 'suspended'].includes(status)) filter.status = status;
    if (search) {
      const safe = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { email: { $regex: safe, $options: 'i' } },
        { name: { $regex: safe, $options: 'i' } },
        { appName: { $regex: safe, $options: 'i' } },
        { keyPrefix: { $regex: safe, $options: 'i' } },
      ];
    }

    const [keys, totalCount] = await Promise.all([
      ApiKey.find(filter)
        .sort({ 'usage.lastUsedAt': -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select('-keyHash')
        .lean(),
      ApiKey.countDocuments(filter),
    ]);

    res.json({ keys, page, limit, totalCount, pages: Math.ceil(totalCount / limit) });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to load API keys' });
  }
});

// POST /api/admin/api-keys/keys/:id/status — revoke / suspend / reactivate.
router.post('/keys/:id/status', async (req: Request, res: Response): Promise<void> => {
  try {
    const { status } = req.body as { status?: string };
    if (!status || !['active', 'revoked', 'suspended'].includes(status)) {
      res.status(400).json({ error: 'status must be active, revoked, or suspended' });
      return;
    }
    const key = await ApiKey.findByIdAndUpdate(
      req.params.id,
      { $set: { status } },
      { new: true },
    ).select('-keyHash').lean();
    if (!key) {
      res.status(404).json({ error: 'API key not found' });
      return;
    }
    res.json({ success: true, key });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to update key status' });
  }
});

// POST /api/admin/api-keys/keys/:id/plan — move a key between free/pro tiers.
router.post('/keys/:id/plan', async (req: Request, res: Response): Promise<void> => {
  try {
    const { plan } = req.body as { plan?: string };
    if (!plan || !['free', 'pro'].includes(plan)) {
      res.status(400).json({ error: 'plan must be free or pro' });
      return;
    }
    const limits = PLAN_LIMITS[plan];
    const key = await ApiKey.findByIdAndUpdate(
      req.params.id,
      { $set: { plan, ...limits } },
      { new: true },
    ).select('-keyHash').lean();
    if (!key) {
      res.status(404).json({ error: 'API key not found' });
      return;
    }
    res.json({ success: true, key });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to update key plan' });
  }
});

export default router;
