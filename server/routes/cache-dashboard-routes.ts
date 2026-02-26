import { type Express } from "express";
import { Station, SyncLog, User, Genre, Language, Country, Feedback, VisitorSession, StationDebugLog } from '../../shared/mongo-schemas';
import CacheManager from '../cache';
import { logger } from '../utils/logger';

export function registerCacheDashboardRoutes(app: Express, deps: any) {
  // CACHE MANAGEMENT API
  app.get("/api/cache/stats", async (req, res) => {
    try {
      const stats = CacheManager.getStats();
      res.json({
        ...stats,
        message: "Cache statistics retrieved successfully"
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch cache stats' });
    }
  });

  app.delete("/api/cache/clear/:pattern?", async (req, res) => {
    try {
      const { pattern } = req.params;
      if (pattern) {
        await CacheManager.clearByPattern(pattern);
        res.json({ message: `Cleared cache entries matching pattern: ${pattern}` });
      } else {
        await CacheManager.clearByPattern(''); // Clear all
        res.json({ message: 'Cleared entire cache' });
      }
    } catch (error) {
      res.status(500).json({ error: 'Failed to clear cache' });
    }
  });

  // DASHBOARD STATS API
  app.get("/api/dashboard/stats", async (req, res) => {
    try {
      const CACHE_KEY = 'dashboard:stats:v1';
      const cached = await CacheManager.get(CACHE_KEY);
      if (cached) return res.json(cached);

      const [
        totalStations,
        totalCountries,
        totalLanguages,
        totalGenres,
        totalCodecs,
        workingStations,
        recentlyUpdated,
        lastSyncLog,
        errorCount,
        userCount,
        feedbackCount,
        topCountries,
        topGenres,
        codecDistribution,
        stationsWithFavicon,
        stationsWithDesc
      ] = await Promise.all([
        Station.countDocuments(),
        Station.distinct('country').then(countries => countries.filter(c => c).length),
        Station.distinct('language').then(languages => languages.filter(l => l).length),
        Station.distinct('tags').then(tags => tags.filter(t => t).length),
        Station.distinct('codec').then(codecs => codecs.filter(c => c).length),
        Station.countDocuments({ lastCheckOk: true }),
        Station.countDocuments({ 
          updatedAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        }),
        SyncLog.findOne().sort({ createdAt: -1 }),
        StationDebugLog ? StationDebugLog.countDocuments({ isResolved: false }) : 0,
        User.countDocuments(),
        Feedback.countDocuments({ status: 'open' }),
        Station.aggregate([
          { $match: { country: { $exists: true, $ne: null } } },
          { $group: { _id: '$country', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 5 }
        ]),
        Station.aggregate([
          { $match: { tags: { $exists: true, $ne: null } } },
          { $group: { _id: '$tags', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 5 }
        ]),
        Station.aggregate([
          { $match: { codec: { $exists: true, $ne: null } } },
          { $group: { _id: '$codec', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 10 }
        ]),
        Station.countDocuments({ favicon: { $exists: true, $nin: [null, ''] } }),
        Station.countDocuments({ 'descriptions.en': { $exists: true } })
      ]);

      const isRecentSync = lastSyncLog && 
        new Date(lastSyncLog.createdAt).getTime() > Date.now() - (24 * 60 * 60 * 1000);
      
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
      let activeVisitors = 0;
      try {
        activeVisitors = await VisitorSession.countDocuments({
          lastActiveDate: { $gte: thirtyMinutesAgo }
        });
      } catch (e) {}

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      let todayVisitors = 0;
      try {
        todayVisitors = await VisitorSession.countDocuments({
          lastActiveDate: { $gte: todayStart }
        });
      } catch (e) {}

      const weekAgoStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      let weekVisitors = 0;
      try {
        weekVisitors = await VisitorSession.countDocuments({
          lastActiveDate: { $gte: weekAgoStart }
        });
      } catch (e) {}

      const weekAgoDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      let activeRegisteredUsers = 0;
      try {
        activeRegisteredUsers = await User.countDocuments({
          lastActiveDate: { $gte: weekAgoDate }
        });
      } catch (e) {}

      const stats = {
        totalStations,
        totalCountries,
        totalLanguages,
        totalGenres,
        totalCodecs,
        workingStations,
        workingPercentage: totalStations > 0 ? Math.round((workingStations / totalStations) * 100) : 0,
        offlineStations: totalStations - workingStations,
        recentlyUpdated,
        unresolvedErrors: errorCount,
        totalUsers: userCount,
        activeRegisteredUsers,
        openFeedback: feedbackCount,
        stationsWithFavicon,
        faviconPercentage: totalStations > 0 ? Math.round((stationsWithFavicon / totalStations) * 100) : 0,
        stationsWithDesc,
        descriptionPercentage: totalStations > 0 ? Math.round((stationsWithDesc / totalStations) * 100) : 0,
        activeVisitors,
        todayVisitors,
        weekVisitors,
        topCountries: topCountries.map(c => ({ name: c._id, count: c.count })),
        topGenres: topGenres.map(g => ({ name: g._id, count: g.count })),
        codecDistribution: codecDistribution.map(c => ({ name: c._id, count: c.count })),
        syncStatus: {
          isRunning: lastSyncLog?.status === 'running',
          lastSync: lastSyncLog ? new Date(lastSyncLog.createdAt) : null,
          lastSyncStatus: lastSyncLog?.status || 'unknown',
          isHealthy: isRecentSync && lastSyncLog?.status === 'completed'
        }
      };

      await CacheManager.set(CACHE_KEY, stats, { ttl: 300 });
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch dashboard statistics' });
    }
  });
}
