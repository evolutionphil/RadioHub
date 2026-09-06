import { logger } from '../utils/logger';
import { createAuthToken, findActiveAuthToken } from '../data/auth-token-store';
import { pgFindUserById } from '../data/postgres-user-store';

export type MiddlewareFn = (req: any, res: any, next: any) => void | Promise<void>;

export const requireAuth: MiddlewareFn = async (req, res, next) => {
  try {
    const session = req.session;
    let userId = session?.user?.userId || session?.userId || req.user?._id || req.user?.id;
    const authHeader = req.headers['authorization'];
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!userId && bearerToken) userId = (await findActiveAuthToken(bearerToken))?.userId;
    if (!userId) return void res.status(401).json({ error:'Authentication required' });
    const user = await pgFindUserById(String(userId));
    if (!user) return void res.status(401).json({ error:'Authentication required' });
    if (['inactive','suspended','banned','deleted'].includes(user.status) || user.isActive===false) {
      return void res.status(403).json({ error:'Account is not active' });
    }
    if (!req.session) req.session = {};
    req.session.userId = user._id;
    req.session.user = { ...req.session.user,userId:user._id };
    req.user = user;
    return next();
  } catch (err) {
    logger.error('requireAuth fatal error:', err);
    return void res.status(503).json({ error: 'Authentication service unavailable' });
  }
};

export const requireAdmin: MiddlewareFn = async (req, res, next) => {
  try {
    const session = req.session as any;

    if (!session || !session.adminAuth) {
      logger.log(`🔒 requireAdmin DENIED: ${req.method} ${req.path} - SessionID: ${req.sessionID}, hasSession: ${!!session}, hasAdminAuth: ${!!session?.adminAuth}`);
      return void res.status(401).json({
        error: 'Admin authentication required',
        message: 'You must be logged in as an admin to access this resource.'
      });
    }

    if (session.adminAuth.role !== 'admin') {
      return void res.status(403).json({
        error: 'Admin access required',
        message: 'You do not have permission to access this resource. Admin privileges required.'
      });
    }
    (req.session as any).adminUser = session.adminAuth;
    next();
  } catch {
    return void res.status(500).json({ error: 'Authentication error' });
  }
};

export const generateAuthToken = async (
  userId: string,
  deviceType: 'mobile' | 'tv' | 'desktop' | 'web' = 'mobile',
  deviceName?: string
): Promise<string> => {
  return createAuthToken(userId, deviceType, deviceName);
};
