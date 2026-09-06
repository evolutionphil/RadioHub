import { Router, type Request, type Response, type NextFunction } from 'express';
import bcrypt from 'bcrypt';
import {
  ApiAccessError, hashApiSecret, pgApiDemoStatus, pgApiKeysForEmail,
  pgAuthenticateApiDeveloper, pgConsumeApiKey, pgCreateApiDeveloperSession,
  pgFindApiDeveloper, pgFindApiDeveloperByEmail, pgFindApiKeyByHash, pgIssueApiKey,
  pgIssueDemoApiKey, pgPruneApiAccess, pgRegisterApiDeveloper,
  pgRevokeApiDeveloperSession, pgRevokeOwnedApiKey,
} from '../data/postgres-api-access-store';

const router = Router();
const optionalText = (value: unknown) => typeof value === 'string' ? value.trim() || undefined : undefined;
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const header = (req: Request, name: string) => typeof req.headers[name] === 'string' ? req.headers[name] as string : '';
const suppliedKey = (req: Request, query = false) => header(req, 'x-api-key') ||
  header(req, 'authorization').replace(/^Bearer\s+/i, '') || (query ? optionalText(req.query.key) : '') || '';
const authenticateApiUser = (req: Request) => {
  const token = header(req, 'x-api-user-token');
  return token ? pgAuthenticateApiDeveloper(token) : Promise.resolve(null);
};
const limits = (key: any) => ({ rateLimitPerMin: key.rateLimitPerMin, dailyQuota: key.dailyQuota, monthlyQuota: key.monthlyQuota });
const publicKey = (key: any) => ({
  id: key._id, keyPrefix: key.keyPrefix, name: key.name, appName: key.appName,
  plan: key.plan, status: key.status, usage: key.usage, limits: limits(key),
  createdAt: key.createdAt, expiresAt: key.expiresAt,
});
const publicUser = (user: any) => ({
  email: user.email, name: user.name, plan: user.plan, company: user.company,
  website: user.website, status: user.status, createdAt: user.createdAt, lastLoginAt: user.lastLoginAt,
});
function failure(res: Response, error: unknown, message: string) {
  if (error instanceof ApiAccessError) {
    if (error.details.retryAfter) res.setHeader('Retry-After', String(error.details.retryAfter));
    res.status(error.status).json({ error: error.message, ...error.details });
  } else {
    console.error(message, error instanceof Error ? error.message : 'Database unavailable');
    res.status(503).json({ error: message });
  }
}
function usageHeaders(res: Response, key: any) {
  res.setHeader('X-RateLimit-Limit', String(key.rateLimitPerMin));
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, key.rateLimitPerMin - key.minuteCount)));
  res.setHeader('X-Daily-Remaining', String(Math.max(0, key.dailyQuota - key.usage.todayCount)));
}
// Express's configured trust-proxy policy is the sole proxy trust boundary.
const demoIpHash = (req: Request) => hashApiSecret((req.ip || req.socket.remoteAddress || '127.0.0.1') + '_megaradio_salt');

router.post('/request', async (req: Request, res: Response) => {
  try {
    const name = optionalText(req.body?.name), email = optionalText(req.body?.email);
    if (!name || !email) return void res.status(400).json({ error: 'Name and email are required' });
    if (!emailRegex.test(email)) return void res.status(400).json({ error: 'Invalid email format' });
    const issued = await pgIssueApiKey({ name, email, appName: optionalText(req.body?.appName),
      appUrl: optionalText(req.body?.appUrl), usageReason: optionalText(req.body?.usageReason) });
    res.status(201).json({ success: true, apiKey: issued.apiKey, keyPrefix: issued.key.keyPrefix,
      plan: issued.key.plan, limits: limits(issued.key), expiresAt: null,
      message: 'API key created successfully. Save this key securely - it will not be shown again.' });
  } catch (error) { failure(res, error, 'Failed to create API key'); }
});

router.get('/validate', async (req: Request, res: Response) => {
  try {
    const raw = suppliedKey(req, true);
    if (!raw) return void res.status(400).json({ valid: false, error: 'No API key provided. Use X-API-Key header, Authorization: Bearer <key>, or ?key= query param.' });
    const key = await pgFindApiKeyByHash(hashApiSecret(raw));
    if (!key) return void res.status(401).json({ valid: false, error: 'Invalid API key' });
    if (key.status !== 'active') return void res.status(403).json({ valid: false, error: 'API key is ' + key.status });
    usageHeaders(res, key);
    res.json({ valid: true, keyPrefix: key.keyPrefix, plan: key.plan, status: key.status,
      limits: limits(key), usage: key.usage, createdAt: key.createdAt, expiresAt: key.expiresAt });
  } catch (error) { failure(res, error, 'Validation failed'); }
});

router.get('/demo', async (req: Request, res: Response) => {
  try {
    const { apiKey, key } = await pgIssueDemoApiKey(demoIpHash(req));
    res.json({ apiKey, keyPrefix: key.keyPrefix, plan: 'demo', limits: limits(key), expiresAt: key.expiresAt,
      note: 'This demo key expires in 24 hours. Request a free API key for higher limits.' });
  } catch (error) { failure(res, error, 'Failed to create demo API key'); }
});
router.get('/demo/status', async (req: Request, res: Response) => {
  try { res.json(await pgApiDemoStatus(demoIpHash(req)) || { available: true }); }
  catch (error) { failure(res, error, 'Failed to load demo status'); }
});
router.get('/usage', async (req: Request, res: Response) => {
  try {
    const raw = suppliedKey(req, true);
    if (!raw) return void res.status(400).json({ error: 'No API key provided' });
    const key = await pgFindApiKeyByHash(hashApiSecret(raw));
    if (!key) return void res.status(401).json({ error: 'Invalid API key' });
    usageHeaders(res, key);
    res.json({ keyPrefix: key.keyPrefix, plan: key.plan, status: key.status,
      usage: { today: { used: key.usage.todayCount, limit: key.dailyQuota, remaining: Math.max(0, key.dailyQuota - key.usage.todayCount) },
        month: { used: key.usage.monthCount, limit: key.monthlyQuota, remaining: Math.max(0, key.monthlyQuota - key.usage.monthCount) },
        total: key.usage.totalCount, lastUsedAt: key.usage.lastUsedAt }, limits: limits(key) });
  } catch (error) { failure(res, error, 'Failed to get usage'); }
});

router.get('/my-keys', async (req: Request, res: Response) => {
  try {
    const auth = await authenticateApiUser(req);
    if (!auth) return void res.status(401).json({ error: 'Authentication required. Use X-API-User-Token header.' });
    const keys = (await pgApiKeysForEmail(auth.email)).map(publicKey);
    res.json({ keys, total: keys.length });
  } catch (error) { failure(res, error, 'Failed to get API keys'); }
});
async function revokeKey(req: Request, res: Response) {
  try {
    const auth = await authenticateApiUser(req);
    if (!auth) return void res.status(401).json({ error: 'Authentication required. Use X-API-User-Token header.' });
    const id = optionalText(req.body?.keyId);
    if (!id) return void res.status(400).json({ error: 'keyId is required in request body' });
    await pgRevokeOwnedApiKey(id, auth.email);
    res.json({ success: true, message: 'API key has been revoked' });
  } catch (error) { failure(res, error, 'Failed to revoke API key'); }
}
router.post('/revoke', revokeKey);
router.post('/user/revoke-key', revokeKey);

router.post('/user/register', async (req: Request, res: Response) => {
  try {
    const email = optionalText(req.body?.email), name = optionalText(req.body?.name);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!email || !password || !name) return void res.status(400).json({ error: 'Email, password, and name are required' });
    if (!emailRegex.test(email)) return void res.status(400).json({ error: 'Invalid email format' });
    if (password.length < 6 || Buffer.byteLength(password, 'utf8') > 72)
      return void res.status(400).json({ error: 'Password must be at least 6 characters and at most 72 UTF-8 bytes' });
    const result = await pgRegisterApiDeveloper({ email, name, passwordHash: await bcrypt.hash(password, 10),
      company: optionalText(req.body?.company), website: optionalText(req.body?.website) });
    res.status(201).json({ success: true, token: result.token, user: publicUser(result.user),
      apiKey: result.apiKey, keyPrefix: result.key.keyPrefix,
      message: 'Account created successfully. Your first API key has been generated. Save it securely!' });
  } catch (error) { failure(res, error, 'Failed to create account'); }
});
router.post('/user/login', async (req: Request, res: Response) => {
  try {
    const email = optionalText(req.body?.email), password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!email || !password) return void res.status(400).json({ error: 'Email and password are required' });
    const user = await pgFindApiDeveloperByEmail(email);
    if (!user || !(await bcrypt.compare(password, user.passwordHash)))
      return void res.status(401).json({ error: 'Invalid email or password' });
    if (user.status !== 'active') return void res.status(403).json({ error: 'Account is suspended' });
    const token = await pgCreateApiDeveloperSession(user._id);
    res.json({ success: true, token, user: publicUser(await pgFindApiDeveloper(user._id)) });
  } catch (error) { failure(res, error, 'Login failed'); }
});
router.get('/user/me', async (req: Request, res: Response) => {
  try {
    const auth = await authenticateApiUser(req);
    if (!auth) return void res.status(401).json({ error: 'Not authenticated' });
    const user = await pgFindApiDeveloper(auth.userId);
    if (!user) return void res.status(404).json({ error: 'User not found' });
    res.json({ user: publicUser(user), keys: (await pgApiKeysForEmail(user.email)).map(publicKey) });
  } catch (error) { failure(res, error, 'Failed to get user data'); }
});
router.post('/user/create-key', async (req: Request, res: Response) => {
  try {
    const auth = await authenticateApiUser(req);
    if (!auth) return void res.status(401).json({ error: 'Not authenticated' });
    const user = await pgFindApiDeveloper(auth.userId);
    if (!user) return void res.status(404).json({ error: 'User not found' });
    const { apiKey, key } = await pgIssueApiKey({ email: user.email, name: user.name, userId: user._id, plan: user.plan,
      appName: optionalText(req.body?.appName), appUrl: optionalText(req.body?.appUrl), usageReason: optionalText(req.body?.usageReason) });
    res.status(201).json({ success: true, apiKey, keyPrefix: key.keyPrefix, plan: key.plan, limits: limits(key),
      message: 'API key created successfully. Save this key securely - it will not be shown again.' });
  } catch (error) { failure(res, error, 'Failed to create API key'); }
});
router.post('/user/logout', async (req: Request, res: Response) => {
  try {
    const token = header(req, 'x-api-user-token');
    if (token) await pgRevokeApiDeveloperSession(token);
    res.json({ success: true });
  } catch (error) { failure(res, error, 'Logout failed'); }
});

export async function apiKeyMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Other API modules use Authorization for user/admin tokens. Only mr_ Bearer
  // credentials belong to this middleware; explicit X-API-Key always does.
  const bearer = header(req, 'authorization').match(/^Bearer\s+(mr_\S+)$/i)?.[1];
  const raw = header(req, 'x-api-key') || bearer;
  if (!raw) { next(); return; }
  try {
    const { key, remaining, resetIn } = await pgConsumeApiKey(hashApiSecret(raw));
    if (key.plan !== 'internal') {
      usageHeaders(res, key);
      res.setHeader('X-RateLimit-Remaining', String(remaining));
      res.setHeader('X-RateLimit-Reset', String(resetIn));
    }
    (req as any).apiKey = { id: key._id, plan: key.plan, keyPrefix: key.keyPrefix };
    next();
  } catch (error) {
    // A supplied invalid key or unavailable quota store must never bypass enforcement.
    failure(res, error, 'API key validation unavailable');
  }
}

const cleanupTimer = setInterval(() => {
  pgPruneApiAccess().catch(error => console.error('API access cleanup failed:', error.message));
}, 60 * 60 * 1000);
cleanupTimer.unref();

export async function seedDemoApiKey(): Promise<void> {
  await pgPruneApiAccess();
}

export default router;
