import crypto from 'crypto';
import mongoose from 'mongoose';
import { AuthToken } from '@workspace/db-shared/mongo-schemas';
import { logger } from '../utils/logger';

export type MiddlewareFn = (req: any, res: any, next: any) => void | Promise<void>;

export const requireAuth: MiddlewareFn = async (req, res, next) => {
  try {
    const session = req.session;
    if (session?.user?.userId) {
      (req.session as any).userId = session.user.userId;
      return next();
    }

    const authHeader = req.headers['authorization'];
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (bearerToken) {
      try {
        const tokenDoc = await AuthToken.findOne({
          token: bearerToken,
          isRevoked: false,
          expiresAt: { $gt: new Date() }
        });

        if (tokenDoc) {
          tokenDoc.lastUsedAt = new Date();
          await tokenDoc.save();

          if (!req.session) req.session = {};
          (req.session as any).userId = tokenDoc.userId.toString();
          if (!req.session.user) req.session.user = {} as any;
          (req.session as any).user = { userId: tokenDoc.userId.toString() };
          return next();
        }
      } catch (err) {
        logger.error('Token auth error:', err);
      }
    }

    return void res.status(401).json({ error: 'Authentication required' });
  } catch (err) {
    logger.error('requireAuth fatal error:', err);
    return void res.status(500).json({ error: 'Authentication error' });
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
  const prefix = deviceType === 'tv' ? 'mrt_tv_' : 'mrt_';
  const token = `${prefix}${crypto.randomBytes(32).toString('hex')}`;
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

  // Pre-flight: ensure mongoose is actually connected. With bufferCommands=false
  // (db-mongo.ts), .create() would throw fast — but we want a clean diagnostic.
  if (mongoose.connection.readyState !== 1) {
    logger.error(`🔴 generateAuthToken: Mongo NOT ready (readyState=${mongoose.connection.readyState}) — refusing to mint token that won't persist`);
    throw new Error('Database not ready — cannot generate auth token');
  }

  const created = await AuthToken.create({
    token,
    userId: new mongoose.Types.ObjectId(userId),
    deviceType,
    deviceName,
    expiresAt,
    lastUsedAt: new Date(),
    createdAt: new Date(),
    isRevoked: false,
  });

  // CRITICAL: round-trip verify the write actually landed and is readable.
  // Catches: silent writeConcern downgrades, wrong-cluster routing, duplicate
  // mongoose instances (monorepo hoisting), TTL-on-create misconfigs.
  const verify = await AuthToken.findOne({ token }).select('_id userId').lean();
  const conn = mongoose.connection;
  if (!verify) {
    logger.error(`🔴 generateAuthToken: WRITE returned ok but doc NOT readable! createdId=${String(created._id)} tokenPrefix=${token.slice(0, 16)} host=${conn.host} db=${conn.name} readyState=${conn.readyState}`);
    throw new Error('AuthToken persistence verification failed');
  }

  logger.log(`✅ generateAuthToken persisted+verified userId=${userId} deviceType=${deviceType} tokenPrefix=${token.slice(0, 16)} _id=${String(created._id)} host=${conn.host} db=${conn.name}`);

  return token;
};
