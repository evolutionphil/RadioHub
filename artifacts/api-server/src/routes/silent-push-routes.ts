import type { Express } from 'express';
import { SilentPushService, SilentPushAction } from '../services/silentPushService';
import { PushToken } from '../shared/mongo-schemas';
import { logger } from '../utils/logger';
import cron from 'node-cron';

const VALID_ACTIONS: SilentPushAction[] = ['cache_refresh', 'popular_update', 'genres_update', 'favorites_sync', 'clear_cache'];

export function registerSilentPushRoutes(app: Express, deps: any) {
  const { requireAdmin } = deps;

  app.post('/api/admin/push/silent', requireAdmin, async (req, res) => {
    try {
      const { action, country, userId } = req.body;

      if (!action || !VALID_ACTIONS.includes(action)) {
        return res.status(400).json({
          error: `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}`,
        });
      }

      const result = await SilentPushService.sendSilentPush({ action, country, userId });

      res.json({
        success: true,
        action,
        country: country || 'all',
        userId: userId || 'all',
        result,
      });
    } catch (error) {
      logger.error('Admin silent push error:', error);
      res.status(500).json({ error: 'Failed to send silent push' });
    }
  });

  app.get('/api/admin/push/status', requireAdmin, async (req, res) => {
    try {
      const config = SilentPushService.isConfigured();

      const [totalTokens, activeTokens, iosPlatform, androidPlatform, expoType, apnsType, fcmType] = await Promise.all([
        PushToken.countDocuments(),
        PushToken.countDocuments({ isActive: true }),
        PushToken.countDocuments({ platform: 'ios', isActive: true }),
        PushToken.countDocuments({ platform: 'android', isActive: true }),
        PushToken.countDocuments({ tokenType: 'expo', isActive: true }),
        PushToken.countDocuments({ tokenType: 'apns', isActive: true }),
        PushToken.countDocuments({ tokenType: 'fcm', isActive: true }),
      ]);

      const topCountries = await PushToken.aggregate([
        { $match: { isActive: true, country: { $ne: '' } } },
        { $group: { _id: '$country', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]);

      res.json({
        configuration: config,
        tokens: {
          total: totalTokens,
          active: activeTokens,
          byPlatform: { ios: iosPlatform, android: androidPlatform },
          byType: { expo: expoType, apns: apnsType, fcm: fcmType },
        },
        topCountries: topCountries.map((c) => ({ country: c._id, count: c.count })),
        validActions: VALID_ACTIONS,
      });
    } catch (error) {
      logger.error('Push status error:', error);
      res.status(500).json({ error: 'Failed to get push status' });
    }
  });

  app.post('/api/admin/push/cleanup', requireAdmin, async (req, res) => {
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const result = await PushToken.deleteMany({
        isActive: false,
        updatedAt: { $lt: thirtyDaysAgo },
      });

      res.json({
        success: true,
        deletedCount: result.deletedCount,
      });
    } catch (error) {
      logger.error('Push cleanup error:', error);
      res.status(500).json({ error: 'Failed to cleanup tokens' });
    }
  });

  app.post('/api/internal/daily-cache-refresh', async (req, res) => {
    const internalKey = process.env.INTERNAL_API_KEY;
    const providedKey = req.headers['x-internal-key'] as string;

    if (!internalKey || providedKey !== internalKey) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    try {
      const result = await SilentPushService.sendSilentPush({ action: 'cache_refresh' });
      res.json({ success: true, result });
    } catch (error) {
      logger.error('Daily cache refresh error:', error);
      res.status(500).json({ error: 'Failed to send daily cache refresh' });
    }
  });

  cron.schedule('0 4 * * *', async () => {
    logger.log('🔔 Daily silent push cache_refresh starting...');
    try {
      const result = await SilentPushService.sendSilentPush({ action: 'cache_refresh' });
      logger.log(`🔔 Daily silent push complete: ${result.totalDevices} devices`);
    } catch (error) {
      logger.error('Daily silent push cron error:', error);
    }
  }, { timezone: 'Europe/Berlin' });
}
