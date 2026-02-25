import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { ApiKey, DemoUsage, ApiUser } from '../../shared/mongo-schemas';

const router = Router();

function generateApiKey(): string {
  const prefix = 'mr';
  const randomPart = crypto.randomBytes(24).toString('base64url');
  return `${prefix}_${randomPart}`;
}

function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function hashIp(ip: string): string {
  return crypto.createHash('sha256').update(ip + '_megaradio_salt').digest('hex');
}

function maskKey(key: string): string {
  if (key.length <= 10) return key;
  return key.substring(0, 7) + '...' + key.substring(key.length - 4);
}

const PLAN_LIMITS = {
  demo: { rateLimitPerMin: 10, dailyQuota: 100, monthlyQuota: 500 },
  free: { rateLimitPerMin: 60, dailyQuota: 1000, monthlyQuota: 10000 },
  pro: { rateLimitPerMin: 300, dailyQuota: 10000, monthlyQuota: 100000 },
  internal: { rateLimitPerMin: 999999, dailyQuota: 999999999, monthlyQuota: 999999999 },
};

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(keyHash: string, limitPerMin: number): { allowed: boolean; remaining: number; resetIn: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(keyHash);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(keyHash, { count: 1, resetAt: now + 60000 });
    return { allowed: true, remaining: limitPerMin - 1, resetIn: 60 };
  }

  if (entry.count >= limitPerMin) {
    const resetIn = Math.ceil((entry.resetAt - now) / 1000);
    return { allowed: false, remaining: 0, resetIn };
  }

  entry.count++;
  const resetIn = Math.ceil((entry.resetAt - now) / 1000);
  return { allowed: true, remaining: limitPerMin - entry.count, resetIn };
}

function getTodayStr() {
  return new Date().toISOString().split('T')[0];
}

function getMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getClientIp(req: Request): string {
  return (req.headers['cf-connecting-ip'] as string) ||
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.ip || '127.0.0.1';
}

const apiUserSessions = new Map<string, { userId: string; email: string; expiresAt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(key);
  }
  for (const [key, session] of apiUserSessions) {
    if (now > session.expiresAt) apiUserSessions.delete(key);
  }
}, 5 * 60 * 1000);

function authenticateApiUser(req: Request): { userId: string; email: string } | null {
  const authHeader = req.headers['x-api-user-token'] as string;
  if (!authHeader) return null;

  const tokenHash = hashKey(authHeader);
  const session = apiUserSessions.get(tokenHash);
  if (!session) return null;

  if (Date.now() > session.expiresAt) {
    apiUserSessions.delete(tokenHash);
    return null;
  }

  return { userId: session.userId, email: session.email };
}

router.post('/request', async (req: Request, res: Response) => {
  try {
    const { name, email, appName, appUrl, usageReason } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const existingCount = await ApiKey.countDocuments({ email, status: 'active', plan: { $ne: 'demo' } });
    if (existingCount >= 3) {
      return res.status(429).json({ error: 'Maximum 3 active API keys per email. Please revoke an existing key first.' });
    }

    const rawKey = generateApiKey();
    const keyHash = hashKey(rawKey);
    const keyPrefix = rawKey.substring(0, 7);
    const limits = PLAN_LIMITS.free;

    const apiKey = new ApiKey({
      keyHash,
      keyPrefix,
      name,
      email,
      appName: appName || undefined,
      appUrl: appUrl || undefined,
      usageReason: usageReason || undefined,
      plan: 'free',
      status: 'active',
      ...limits,
      usage: {
        todayCount: 0,
        monthCount: 0,
        totalCount: 0,
        lastResetDay: getTodayStr(),
        lastResetMonth: getMonthStr(),
      },
    });

    await apiKey.save();

    res.status(201).json({
      success: true,
      apiKey: rawKey,
      keyPrefix,
      plan: 'free',
      limits: {
        rateLimitPerMin: limits.rateLimitPerMin,
        dailyQuota: limits.dailyQuota,
        monthlyQuota: limits.monthlyQuota,
      },
      message: 'API key created successfully. Save this key securely - it will not be shown again.',
      expiresAt: null,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create API key' });
  }
});

router.get('/validate', async (req: Request, res: Response) => {
  try {
    const key = (req.headers['x-api-key'] as string) ||
      (req.headers['authorization'] as string)?.replace('Bearer ', '') ||
      (req.query.key as string);

    if (!key) {
      return res.status(400).json({ valid: false, error: 'No API key provided. Use X-API-Key header, Authorization: Bearer <key>, or ?key= query param.' });
    }

    const keyHash = hashKey(key);
    const apiKeyDoc = await ApiKey.findOne({ keyHash });

    if (!apiKeyDoc) {
      return res.status(401).json({ valid: false, error: 'Invalid API key' });
    }

    if (apiKeyDoc.status !== 'active') {
      return res.status(403).json({ valid: false, error: `API key is ${apiKeyDoc.status}` });
    }

    if (apiKeyDoc.expiresAt && new Date(apiKeyDoc.expiresAt) < new Date()) {
      apiKeyDoc.status = 'expired';
      await apiKeyDoc.save();
      return res.status(403).json({ valid: false, error: 'API key has expired' });
    }

    res.json({
      valid: true,
      keyPrefix: apiKeyDoc.keyPrefix,
      plan: apiKeyDoc.plan,
      status: apiKeyDoc.status,
      limits: {
        rateLimitPerMin: apiKeyDoc.rateLimitPerMin,
        dailyQuota: apiKeyDoc.dailyQuota,
        monthlyQuota: apiKeyDoc.monthlyQuota,
      },
      usage: {
        todayCount: apiKeyDoc.usage.todayCount,
        monthCount: apiKeyDoc.usage.monthCount,
        totalCount: apiKeyDoc.usage.totalCount,
        lastUsedAt: apiKeyDoc.usage.lastUsedAt,
      },
      createdAt: apiKeyDoc.createdAt,
      expiresAt: apiKeyDoc.expiresAt,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Validation failed' });
  }
});

router.get('/demo', async (req: Request, res: Response) => {
  try {
    const clientIp = getClientIp(req);
    const ipH = hashIp(clientIp);

    const existing = await DemoUsage.findOne({ ipHash: ipH });

    if (existing && new Date(existing.expiresAt) > new Date()) {
      const hoursLeft = Math.ceil((new Date(existing.expiresAt).getTime() - Date.now()) / 3600000);
      return res.status(429).json({
        error: 'Demo key already issued for this IP',
        message: `You already received a demo key. Try again in ${hoursLeft} hour(s), or request a free API key for unlimited access.`,
        expiresAt: existing.expiresAt,
        hoursRemaining: hoursLeft,
      });
    }

    const rawKey = generateApiKey();
    const keyHash = hashKey(rawKey);
    const keyPrefix = rawKey.substring(0, 7);
    const limits = PLAN_LIMITS.demo;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const demoApiKey = new ApiKey({
      keyHash,
      keyPrefix,
      name: 'Demo User',
      email: `demo-${ipH.substring(0, 8)}@themegaradio.com`,
      appName: 'API Documentation',
      usageReason: 'API Testing',
      plan: 'demo',
      status: 'active',
      ...limits,
      expiresAt,
      usage: {
        todayCount: 0,
        monthCount: 0,
        totalCount: 0,
        lastResetDay: getTodayStr(),
        lastResetMonth: getMonthStr(),
      },
    });
    await demoApiKey.save();

    await DemoUsage.findOneAndUpdate(
      { ipHash: ipH },
      {
        ipHash: ipH,
        demoKeyHash: keyHash,
        lastIssuedAt: new Date(),
        expiresAt,
        usageCount: existing ? existing.usageCount + 1 : 1,
      },
      { upsert: true }
    );

    res.json({
      apiKey: rawKey,
      keyPrefix,
      plan: 'demo',
      limits,
      expiresAt,
      note: 'This demo key expires in 24 hours and is limited to this IP. Request a free API key for higher limits.',
    });
  } catch (error: any) {
    console.error('Demo key error:', error.message);
    res.status(500).json({ error: 'Failed to get demo key' });
  }
});

router.get('/demo/status', async (req: Request, res: Response) => {
  try {
    const clientIp = getClientIp(req);
    const ipH = hashIp(clientIp);
    const existing = await DemoUsage.findOne({ ipHash: ipH });

    if (existing && new Date(existing.expiresAt) > new Date()) {
      res.json({
        available: false,
        hoursRemaining: Math.ceil((new Date(existing.expiresAt).getTime() - Date.now()) / 3600000),
        expiresAt: existing.expiresAt,
      });
    } else {
      res.json({ available: true });
    }
  } catch {
    res.json({ available: true });
  }
});

router.get('/usage', async (req: Request, res: Response) => {
  try {
    const key = (req.headers['x-api-key'] as string) ||
      (req.headers['authorization'] as string)?.replace('Bearer ', '') ||
      (req.query.key as string);

    if (!key) {
      return res.status(400).json({ error: 'No API key provided' });
    }

    const keyHash = hashKey(key);
    const apiKeyDoc = await ApiKey.findOne({ keyHash });

    if (!apiKeyDoc) {
      return res.status(401).json({ error: 'Invalid API key' });
    }

    const today = getTodayStr();
    const month = getMonthStr();

    const needDayReset = apiKeyDoc.usage.lastResetDay !== today;
    const needMonthReset = apiKeyDoc.usage.lastResetMonth !== month;

    if (needDayReset || needMonthReset) {
      const setOps: any = { 'usage.lastResetDay': today, 'usage.lastResetMonth': month };
      if (needDayReset) setOps['usage.todayCount'] = 0;
      if (needMonthReset) setOps['usage.monthCount'] = 0;
      await ApiKey.updateOne({ _id: apiKeyDoc._id }, { $set: setOps });
      if (needDayReset) apiKeyDoc.usage.todayCount = 0;
      if (needMonthReset) apiKeyDoc.usage.monthCount = 0;
    }

    res.json({
      keyPrefix: apiKeyDoc.keyPrefix,
      plan: apiKeyDoc.plan,
      status: apiKeyDoc.status,
      usage: {
        today: { used: apiKeyDoc.usage.todayCount, limit: apiKeyDoc.dailyQuota, remaining: apiKeyDoc.dailyQuota - apiKeyDoc.usage.todayCount },
        month: { used: apiKeyDoc.usage.monthCount, limit: apiKeyDoc.monthlyQuota, remaining: apiKeyDoc.monthlyQuota - apiKeyDoc.usage.monthCount },
        total: apiKeyDoc.usage.totalCount,
        lastUsedAt: apiKeyDoc.usage.lastUsedAt,
      },
      limits: {
        rateLimitPerMin: apiKeyDoc.rateLimitPerMin,
        dailyQuota: apiKeyDoc.dailyQuota,
        monthlyQuota: apiKeyDoc.monthlyQuota,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get usage data' });
  }
});

router.get('/my-keys', async (req: Request, res: Response) => {
  try {
    const auth = authenticateApiUser(req);
    if (!auth) {
      return res.status(401).json({ error: 'Authentication required. Use X-API-User-Token header.' });
    }

    const keys = await ApiKey.find({ email: auth.email, plan: { $ne: 'demo' } })
      .select('-keyHash')
      .sort({ createdAt: -1 });

    res.json({
      keys: keys.map(k => ({
        id: k._id,
        keyPrefix: k.keyPrefix,
        name: k.name,
        appName: k.appName,
        plan: k.plan,
        status: k.status,
        usage: k.usage,
        limits: {
          rateLimitPerMin: k.rateLimitPerMin,
          dailyQuota: k.dailyQuota,
          monthlyQuota: k.monthlyQuota,
        },
        createdAt: k.createdAt,
        expiresAt: k.expiresAt,
      })),
      total: keys.length,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch keys' });
  }
});

router.post('/revoke', async (req: Request, res: Response) => {
  try {
    const auth = authenticateApiUser(req);
    if (!auth) {
      return res.status(401).json({ error: 'Authentication required. Use X-API-User-Token header.' });
    }

    const { keyId } = req.body;
    if (!keyId) {
      return res.status(400).json({ error: 'keyId is required in request body' });
    }

    const apiKeyDoc = await ApiKey.findById(keyId);
    if (!apiKeyDoc || apiKeyDoc.email !== auth.email) {
      return res.status(404).json({ error: 'API key not found' });
    }

    if (apiKeyDoc.plan === 'demo') {
      return res.status(403).json({ error: 'Cannot revoke demo keys' });
    }

    apiKeyDoc.status = 'revoked';
    await apiKeyDoc.save();

    res.json({ success: true, message: 'API key has been revoked' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to revoke API key' });
  }
});

// ==================== API User Auth Routes ====================

router.post('/user/register', async (req: Request, res: Response) => {
  try {
    const { email, password, name, company, website } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name are required' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existing = await ApiUser.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const rawKey = generateApiKey();
    const keyHash = hashKey(rawKey);
    const keyPrefix = rawKey.substring(0, 7);
    const limits = PLAN_LIMITS.free;

    const apiKey = new ApiKey({
      keyHash,
      keyPrefix,
      name,
      email: email.toLowerCase(),
      plan: 'free',
      status: 'active',
      ...limits,
      usage: {
        todayCount: 0,
        monthCount: 0,
        totalCount: 0,
        lastResetDay: getTodayStr(),
        lastResetMonth: getMonthStr(),
      },
    });
    await apiKey.save();

    const apiUser = new ApiUser({
      email: email.toLowerCase(),
      passwordHash,
      name,
      company: company || undefined,
      website: website || undefined,
      plan: 'free',
      status: 'active',
      apiKeys: [apiKey._id],
    });
    await apiUser.save();

    apiKey.userId = apiUser._id as any;
    await apiKey.save();

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashKey(token);
    apiUserSessions.set(tokenHash, { userId: apiUser._id.toString(), email: apiUser.email, expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 });

    res.status(201).json({
      success: true,
      token,
      user: {
        email: apiUser.email,
        name: apiUser.name,
        plan: apiUser.plan,
        company: apiUser.company,
        createdAt: apiUser.createdAt,
      },
      apiKey: rawKey,
      keyPrefix,
      message: 'Account created successfully. Your first API key has been generated. Save it securely!',
    });
  } catch (error: any) {
    console.error('API User register error:', error.message);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

router.post('/user/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await ApiUser.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (user.status !== 'active') {
      return res.status(403).json({ error: 'Account is suspended' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    user.lastLoginAt = new Date();
    await user.save();

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashKey(token);
    apiUserSessions.set(tokenHash, { userId: user._id.toString(), email: user.email, expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 });

    res.json({
      success: true,
      token,
      user: {
        email: user.email,
        name: user.name,
        plan: user.plan,
        company: user.company,
        website: user.website,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/user/me', async (req: Request, res: Response) => {
  try {
    const auth = authenticateApiUser(req);
    if (!auth) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const user = await ApiUser.findById(auth.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const keys = await ApiKey.find({ email: user.email, plan: { $ne: 'demo' } })
      .select('-keyHash')
      .sort({ createdAt: -1 });

    res.json({
      user: {
        email: user.email,
        name: user.name,
        plan: user.plan,
        company: user.company,
        website: user.website,
        status: user.status,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
      },
      keys: keys.map(k => ({
        id: k._id,
        keyPrefix: k.keyPrefix,
        name: k.name,
        appName: k.appName,
        plan: k.plan,
        status: k.status,
        usage: k.usage,
        limits: {
          rateLimitPerMin: k.rateLimitPerMin,
          dailyQuota: k.dailyQuota,
          monthlyQuota: k.monthlyQuota,
        },
        createdAt: k.createdAt,
        expiresAt: k.expiresAt,
      })),
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get user data' });
  }
});

router.post('/user/create-key', async (req: Request, res: Response) => {
  try {
    const auth = authenticateApiUser(req);
    if (!auth) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { appName, appUrl, usageReason } = req.body;

    const existingCount = await ApiKey.countDocuments({ email: auth.email, status: 'active', plan: { $ne: 'demo' } });
    if (existingCount >= 3) {
      return res.status(429).json({ error: 'Maximum 3 active API keys. Please revoke an existing key first.' });
    }

    const user = await ApiUser.findById(auth.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const rawKey = generateApiKey();
    const keyHash = hashKey(rawKey);
    const keyPrefix = rawKey.substring(0, 7);
    const plan = user.plan;
    const limits = PLAN_LIMITS[plan];

    const apiKey = new ApiKey({
      keyHash,
      keyPrefix,
      name: user.name,
      email: user.email,
      appName: appName || undefined,
      appUrl: appUrl || undefined,
      usageReason: usageReason || undefined,
      plan,
      status: 'active',
      ...limits,
      userId: user._id as any,
      usage: {
        todayCount: 0,
        monthCount: 0,
        totalCount: 0,
        lastResetDay: getTodayStr(),
        lastResetMonth: getMonthStr(),
      },
    });
    await apiKey.save();

    user.apiKeys.push(apiKey._id as any);
    await user.save();

    res.status(201).json({
      success: true,
      apiKey: rawKey,
      keyPrefix,
      plan,
      limits: {
        rateLimitPerMin: limits.rateLimitPerMin,
        dailyQuota: limits.dailyQuota,
        monthlyQuota: limits.monthlyQuota,
      },
      message: 'API key created. Save it securely - it will not be shown again.',
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create API key' });
  }
});

router.post('/user/revoke-key', async (req: Request, res: Response) => {
  try {
    const auth = authenticateApiUser(req);
    if (!auth) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { keyId } = req.body;
    if (!keyId) return res.status(400).json({ error: 'Key ID is required' });

    const apiKeyDoc = await ApiKey.findById(keyId);
    if (!apiKeyDoc || apiKeyDoc.email !== auth.email) {
      return res.status(404).json({ error: 'API key not found' });
    }

    if (apiKeyDoc.plan === 'demo') {
      return res.status(403).json({ error: 'Cannot revoke demo keys' });
    }

    apiKeyDoc.status = 'revoked';
    await apiKeyDoc.save();

    res.json({ success: true, message: 'API key revoked' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to revoke key' });
  }
});

router.post('/user/logout', async (req: Request, res: Response) => {
  const authHeader = req.headers['x-api-user-token'] as string;
  if (authHeader) {
    const tokenHash = hashKey(authHeader);
    apiUserSessions.delete(tokenHash);
  }
  res.json({ success: true });
});

// ==================== Middleware ====================

export async function apiKeyMiddleware(req: Request, res: Response, next: NextFunction) {
  const key = (req.headers['x-api-key'] as string) ||
    (req.headers['authorization'] as string)?.replace('Bearer ', '');

  if (!key) {
    return next();
  }

  try {
    const keyHash = hashKey(key);
    const apiKeyDoc = await ApiKey.findOne({ keyHash });

    if (!apiKeyDoc || apiKeyDoc.status !== 'active') {
      return next();
    }

    if (apiKeyDoc.expiresAt && new Date(apiKeyDoc.expiresAt) < new Date()) {
      apiKeyDoc.status = 'expired';
      await apiKeyDoc.save();
      return next();
    }

    const isInternal = apiKeyDoc.plan === 'internal';

    if (!isInternal) {
      const rateCheck = checkRateLimit(keyHash, apiKeyDoc.rateLimitPerMin);
      if (!rateCheck.allowed) {
        return res.status(429).json({
          error: 'Rate limit exceeded',
          retryAfter: rateCheck.resetIn,
          limit: apiKeyDoc.rateLimitPerMin,
        });
      }

      const today = getTodayStr();
      const month = getMonthStr();

      const needDayReset = apiKeyDoc.usage.lastResetDay !== today;
      const needMonthReset = apiKeyDoc.usage.lastResetMonth !== month;

      const currentDay = needDayReset ? 0 : apiKeyDoc.usage.todayCount;
      const currentMonth = needMonthReset ? 0 : apiKeyDoc.usage.monthCount;

      if (currentDay >= apiKeyDoc.dailyQuota) {
        return res.status(429).json({ error: 'Daily quota exceeded', dailyQuota: apiKeyDoc.dailyQuota });
      }
      if (currentMonth >= apiKeyDoc.monthlyQuota) {
        return res.status(429).json({ error: 'Monthly quota exceeded', monthlyQuota: apiKeyDoc.monthlyQuota });
      }

      const updateOps: any = {
        $inc: { 'usage.todayCount': 1, 'usage.monthCount': 1, 'usage.totalCount': 1 },
        $set: { 'usage.lastUsedAt': new Date(), 'usage.lastResetDay': today, 'usage.lastResetMonth': month },
      };
      if (needDayReset) {
        updateOps.$set['usage.todayCount'] = 1;
        delete updateOps.$inc['usage.todayCount'];
      }
      if (needMonthReset) {
        updateOps.$set['usage.monthCount'] = 1;
        delete updateOps.$inc['usage.monthCount'];
      }

      await ApiKey.updateOne({ _id: apiKeyDoc._id }, updateOps);

      res.setHeader('X-RateLimit-Limit', apiKeyDoc.rateLimitPerMin.toString());
      res.setHeader('X-RateLimit-Remaining', rateCheck.remaining.toString());
      res.setHeader('X-RateLimit-Reset', rateCheck.resetIn.toString());
      res.setHeader('X-Daily-Remaining', (apiKeyDoc.dailyQuota - currentDay - 1).toString());
    } else {
      await ApiKey.updateOne({ _id: apiKeyDoc._id }, {
        $inc: { 'usage.totalCount': 1 },
        $set: { 'usage.lastUsedAt': new Date() },
      });
    }

    (req as any).apiKey = {
      id: apiKeyDoc._id,
      plan: apiKeyDoc.plan,
      keyPrefix: apiKeyDoc.keyPrefix,
    };

    next();
  } catch {
    next();
  }
}

setInterval(async () => {
  try {
    await ApiKey.deleteMany({ plan: 'demo', expiresAt: { $lt: new Date() } });
  } catch {}
}, 60 * 60 * 1000);

export async function seedDemoApiKey() {
  console.log('✅ Demo API keys: per-IP generation enabled (24h cooldown)');
  try {
    await ApiKey.deleteMany({ plan: 'demo', expiresAt: { $lt: new Date() } });
  } catch {}
}

export default router;
