import type { Express } from "express";
import express from "express";
import mongoose from "mongoose";
import multer from "multer";
import { Station, User, UserFollow, BlacklistedStation, UserFavorite, UserNotification, AnalyticsEvent, SyncLog, StationDebugLog, BulkDescriptionJob } from "../../shared/mongo-schemas";
import { logger } from "../utils/logger";
import { normalizeCountryFilter } from "../utils/normalize-country";
import { syncService } from "../services/sync";
import { PrecomputedStationsService } from "../services/precomputed-stations";
import { logoProcessor } from "../services/logo-processor";
import { isS3Url, isS3Configured } from "../services/s3-storage";
import { IndexNowService } from "../services/indexnow";
import CacheManager from "../cache";
import { getQuotaStatus } from "../utils/quota-guard";
import { performanceCache } from "../performance-cache";
import { stripPlaceholders } from "./shared-utils";

const faviconUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

const STATION_UPDATE_ALLOWED_FIELDS = [
  'name', 'url', 'homepage', 'favicon', 'country', 'countryCode',
  'language', 'tags', 'bitrate', 'codec', 'hls', 'noIndex'
] as const;

function pickAllowedStationFields(body: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const key of STATION_UPDATE_ALLOWED_FIELDS) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  if (out.bitrate !== undefined && out.bitrate !== null && out.bitrate !== '') {
    const n = Number(out.bitrate);
    out.bitrate = Number.isFinite(n) ? n : undefined;
    if (out.bitrate === undefined) delete out.bitrate;
  } else if (out.bitrate === '') {
    delete out.bitrate;
  }
  if (typeof out.favicon === 'string') out.favicon = out.favicon.trim();
  if (typeof out.url === 'string') out.url = out.url.trim();
  if (typeof out.homepage === 'string') out.homepage = out.homepage.trim();
  if (typeof out.name === 'string') out.name = out.name.trim();
  return out;
}

interface RouteDeps {
  requireAuth: any;
  requireAdmin: any;
  stripPlaceholders?: (obj: any) => any;
}

export function registerAdminStationRoutes(app: Express, deps: RouteDeps) {
  const { requireAdmin } = deps;

  // DATA SYNC UTILITY - Fix follower counts for all users
  app.post("/api/admin/sync-follower-counts", requireAdmin, async (req, res) => {
    try {
      // Compute follower and following counts via aggregation (single query each)
      const [followersAgg, followingAgg] = await Promise.all([
        UserFollow.aggregate([
          { $group: { _id: '$followingUserId', count: { $sum: 1 } } }
        ]),
        UserFollow.aggregate([
          { $group: { _id: '$userId', count: { $sum: 1 } } }
        ])
      ]);

      const followersMap = new Map(followersAgg.map((r: any) => [String(r._id), r.count]));
      const followingMap = new Map(followingAgg.map((r: any) => [String(r._id), r.count]));

      // Build bulk update using aggregated data — no per-user queries
      const BATCH = 1000;
      let skip = 0;
      let syncedUsers = 0;

      while (true) {
        const users = await User.find({})
          .select('_id followersCount followingCount')
          .skip(skip)
          .limit(BATCH)
          .lean();
        if (users.length === 0) break;

        const bulkOps = users
          .map((user: any) => {
            const actualFollowers = followersMap.get(String(user._id)) ?? 0;
            const actualFollowing = followingMap.get(String(user._id)) ?? 0;
            if (user.followersCount === actualFollowers && user.followingCount === actualFollowing) return null;
            syncedUsers++;
            return {
              updateOne: {
                filter: { _id: user._id },
                update: { $set: { followersCount: actualFollowers, followingCount: actualFollowing } }
              }
            };
          })
          .filter(Boolean);

        if (bulkOps.length > 0) await User.bulkWrite(bulkOps as any[]);
        skip += BATCH;
        if (users.length < BATCH) break;
      }

      const totalUsers = skip; // approximate
      res.json({ success: true, message: `Synchronized ${syncedUsers} users`, totalUsers, syncedUsers, errors: 0 });
    } catch (error) {
      res.status(500).json({ error: 'Failed to sync follower counts' });
    }
  });

  // ADMIN STATIONS API - Paginated stations for admin interface
  app.get('/api/admin/stations', requireAdmin, async (req, res) => {
    try {
      logger.log(`📋 Admin stations request - Session ID: ${req.sessionID}, Query: ${JSON.stringify(req.query)}`);
      const { 
        page = 1, 
        limit = 50, 
        search = '', 
        country = '', 
        language = '', 
        genre = '',
        hasDescriptions = 'all',
        sortBy = 'name',
        sortOrder = 'asc'
      } = req.query;
      
      const cacheKey = `admin_stations:${JSON.stringify({
        page: String(page),
        limit: String(limit),
        search: String(search),
        country: String(country),
        language: String(language),
        genre: String(genre),
        hasDescriptions: String(hasDescriptions),
        sortBy: String(sortBy),
        sortOrder: String(sortOrder)
      })}`;
      
      const cachedResult = await CacheManager.get(cacheKey);
      if (cachedResult) {
        return res.json(cachedResult);
      }
      
      const filter: any = {};
      
      if (search && search !== '') {
        filter.$or = [
          { name: { $regex: new RegExp(search as string, 'i') } },
          { country: { $regex: new RegExp(search as string, 'i') } },
          { tags: { $regex: new RegExp(search as string, 'i') } }
        ];
      }
      
      if (country && country !== '' && country !== 'all') {
        Object.assign(filter, normalizeCountryFilter(country as string));
      }
      
      if (language && language !== '' && language !== 'all') {
        filter.language = { $regex: new RegExp(language as string, 'i') };
      }
      
      if (genre && genre !== '' && genre !== 'all') {
        filter.tags = { $regex: new RegExp(genre as string, 'i') };
      }
      
      if (hasDescriptions && hasDescriptions !== 'all') {
        if (hasDescriptions === 'yes') {
          filter.$and = [
            ...(filter.$and || []),
            { descriptions: { $exists: true, $type: 'object' } },
            { $expr: { $gt: [{ $size: { $objectToArray: { $ifNull: ['$descriptions', {}] } } }, 0] } }
          ];
        } else if (hasDescriptions === 'no') {
          filter.$or = [
            ...(filter.$or || []),
            { descriptions: { $exists: false } },
            { descriptions: null },
            { descriptions: {} },
            { $expr: { $eq: [{ $size: { $objectToArray: { $ifNull: ['$descriptions', {}] } } }, 0] } }
          ];
        } else if (hasDescriptions === 'partial') {
          filter.$and = [
            ...(filter.$and || []),
            { descriptions: { $exists: true, $type: 'object' } },
            { $expr: { 
              $and: [
                { $gt: [{ $size: { $objectToArray: { $ifNull: ['$descriptions', {}] } } }, 0] },
                { $lt: [{ $size: { $objectToArray: { $ifNull: ['$descriptions', {}] } } }, 14] }
              ]
            }}
          ];
        }
      }
      
      const total = await Station.countDocuments(filter);
      
      let stations: any = [];
      
      if (sortBy === 'favicon') {
        const skip = (Number(page) - 1) * Number(limit);
        const lim = Number(limit);
        const pipeline: any[] = [];
        if (Object.keys(filter).length > 0) {
          pipeline.push({ $match: filter });
        }
        pipeline.push({
          $addFields: {
            hasFavicon: {
              $cond: {
                if: {
                  $and: [
                    { $ne: ['$favicon', null] },
                    { $ne: ['$favicon', ''] },
                    { $gt: [{ $strLenCP: { $ifNull: ['$favicon', ''] } }, 5] }
                  ]
                },
                then: 1,
                else: 0
              }
            }
          }
        });
        const faviconSortDir = sortOrder === 'asc' ? -1 : 1;
        pipeline.push({ $sort: { hasFavicon: faviconSortDir, name: 1 } });
        pipeline.push({ $skip: skip });
        pipeline.push({ $limit: lim });
        pipeline.push({ $project: { hasFavicon: 0 } });
        stations = await Station.aggregate(pipeline).allowDiskUse(true);
      } else {
        const sort: any = {};
        sort[sortBy as string] = sortOrder === 'asc' ? 1 : -1;
        
        stations = await Station.find(filter)
          .sort(sort)
          .skip((Number(page) - 1) * Number(limit))
          .limit(Number(limit))
          .lean();
      }
      
      const result = {
        stations: stripPlaceholders(stations),
        total,
        page: Number(page),
        totalPages: Math.ceil(total / Number(limit))
      };
      
      await CacheManager.set(cacheKey, result, { ttl: 86400 });
      res.json(result);
    } catch (error: any) {
      logger.error(`Error in /api/admin/stations: ${error?.message || error}`);
      if (error?.stack) logger.error(error.stack.split('\n').slice(0, 5).join('\n'));
      res.status(500).json({ error: 'Failed to fetch stations', details: error?.message || 'Unknown error' });
    }
  });

  // PRECOMPUTED ADMIN API - Status and triggers
  app.get('/api/admin/precomputed/status', requireAdmin, async (req, res) => {
    try {
      const status = await PrecomputedStationsService.getStatus();
      res.json(status);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch precomputed status' });
    }
  });

  app.post('/api/admin/precomputed/refresh', requireAdmin, async (req, res) => {
    try {
      const { countryCode } = req.body;
      if (!countryCode) return res.status(400).json({ error: 'countryCode is required' });
      
      res.json({ success: true, message: `Refresh started for ${countryCode}` });
      
      setImmediate(async () => {
        try {
          await PrecomputedStationsService.refreshCountry(countryCode);
        } catch (err) {
          logger.error(`Error refreshing precomputed for ${countryCode}:`, err);
        }
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to start refresh' });
    }
  });

  // WORKING STATIONS API - Admin only diagnostic
  app.get("/api/admin/working-stations", requireAdmin, async (req, res) => {
    try {
      const { limit = 100 } = req.query;
      const stations = await Station.find({ lastCheckOk: true })
        .limit(Number(limit))
        .select('name url lastCheckOk')
        .lean();
      res.json(stations);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch working stations' });
    }
  });

  // SEED TEST NOTIFICATIONS - Creates new_station notifications for top stations (for testing)
  app.post("/api/admin/seed-notifications", requireAdmin, async (req, res) => {
    try {
      const topStations = await Station.find({})
        .select('_id name favicon slug country')
        .sort({ votes: -1 })
        .limit(10)
        .lean();
      
      const activeUsers = await User.find({}).select('_id').lean();
      
      let created = 0;
      for (const station of topStations) {
        for (const user of activeUsers) {
          const existing = await UserNotification.findOne({
            userId: user._id,
            type: 'new_station',
            'data.stationId': station._id
          });
          
          if (!existing) {
            const daysAgo = Math.floor(Math.random() * 9) + 1;
            const notificationDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
            
            await UserNotification.create({
              userId: user._id,
              type: 'new_station',
              title: `${station.name} Added`,
              message: 'New radio station added. Click to listen!',
              data: {
                stationId: station._id,
                stationSlug: station.slug,
                stationFavicon: station.favicon,
                stationCountry: station.country
              },
              read: false,
              createdAt: notificationDate
            });
            created++;
          }
        }
      }
      
      res.json({ success: true, created, stations: topStations.length, users: activeUsers.length });
    } catch (error: any) {
      console.error('Error seeding notifications:', error);
      res.status(500).json({ error: 'Failed to seed notifications' });
    }
  });

  // STATION FAVICON UPLOAD - Direct multipart upload → AWS S3 via logoProcessor
  // POST /api/admin/stations/:id/upload-favicon (multipart/form-data, field: 'favicon')
  app.post(
    "/api/admin/stations/:id/upload-favicon",
    requireAdmin,
    (req, res, next) => {
      faviconUpload.single('favicon')(req, res, (err: any) => {
        if (err) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ error: 'File too large. Max 5MB.' });
          }
          return res.status(400).json({ error: err.message || 'Invalid upload' });
        }
        next();
      });
    },
    async (req: any, res) => {
      try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
          return res.status(400).json({ error: 'Invalid station id' });
        }
        if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
          return res.status(400).json({ error: 'No favicon file uploaded (field name: favicon)' });
        }

        const station = await Station.findById(id).select('_id slug name').lean();
        if (!station) return res.status(404).json({ error: 'Station not found' });

        const slug = (station as any).slug || (station as any).name?.toLowerCase().replace(/\s+/g, '-') || String(station._id);

        const result = await logoProcessor.processFromBuffer(
          String(station._id),
          slug,
          req.file.buffer,
          req.file.originalname || 'upload.png'
        );

        if (!result.success) {
          return res.status(422).json({ error: result.error || 'Logo processing failed' });
        }

        const updated = await Station.findById(id).select('_id slug favicon logoAssets').lean();
        const newFaviconUrl = (updated as any)?.logoAssets?.webp256
          || (updated as any)?.logoAssets?.original
          || (updated as any)?.favicon
          || '';

        // Mirror processed S3 URL into the favicon field so the visible URL is also S3
        if (newFaviconUrl && isS3Url(newFaviconUrl)) {
          await Station.updateOne({ _id: id }, { $set: { favicon: newFaviconUrl } });
        }

        if ((station as any).slug) {
          performanceCache.invalidateStationCache((station as any).slug);
        }

        // Surface S3 configuration status so admin UI can warn when logo
        // landed only on Railway's ephemeral disk (lost on next redeploy).
        const s3Ok = isS3Configured();
        const warning = s3Ok ? undefined : 'S3 not configured — logo stored on ephemeral Railway disk and will be lost on next redeploy. Configure AWS_BUCKET_NAME / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY.';
        if (!s3Ok) {
          logger.warn(`⚠️ Favicon upload for station ${id} (${slug}) used local-disk fallback (S3 not configured)`);
        }

        return res.json({
          success: true,
          favicon: newFaviconUrl,
          logoAssets: (updated as any)?.logoAssets || null,
          folder: result.folder,
          backedUpToS3: s3Ok && !!newFaviconUrl && isS3Url(newFaviconUrl),
          warning,
        });
      } catch (error: any) {
        logger.error(`Favicon upload failed: ${error.message}`);
        return res.status(500).json({ error: error.message || 'Upload failed' });
      }
    }
  );

  // STATION UPDATE - Edit station metadata (Admin only)
  // PUT /api/stations/:stationId   (frontend updateMutation hits this exact path)
  app.put("/api/stations/:stationId", requireAdmin, express.json({ limit: '1mb' }), async (req, res) => {
    try {
      const { stationId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(stationId)) {
        return res.status(400).json({ error: 'Invalid station id' });
      }

      const update = pickAllowedStationFields(req.body || {});
      if (Object.keys(update).length === 0) {
        return res.status(400).json({ error: 'No editable fields provided' });
      }

      const before = await Station.findById(stationId).select('_id slug favicon logoAssets').lean();
      if (!before) return res.status(404).json({ error: 'Station not found' });

      const updated = await Station.findByIdAndUpdate(
        stationId,
        { $set: update },
        { new: true, runValidators: false }
      ).lean();

      // If favicon URL changed AND it's not already an S3 URL → mirror it to S3 in background.
      // ALSO retry the mirror when the URL is unchanged but the previous mirror
      // attempt failed (logoAssets.status === 'failed') — otherwise admins have
      // no way to retry a failed logo without first changing the URL.
      // The mirror also atomically swaps station.favicon → S3 URL on success
      // (see logo-processor.ts processFromUrl), so the dış URL only ever lives
      // in the DB for the few seconds it takes to download + resize + upload.
      const newFavicon = (updated as any)?.favicon;
      const oldFavicon = (before as any)?.favicon;
      const previousLogoStatus = (before as any)?.logoAssets?.status;
      const shouldRetryFailedMirror =
        newFavicon === oldFavicon && previousLogoStatus === 'failed';
      if (
        newFavicon &&
        typeof newFavicon === 'string' &&
        newFavicon.startsWith('http') &&
        (newFavicon !== oldFavicon || shouldRetryFailedMirror) &&
        !isS3Url(newFavicon)
      ) {
        const slug = (updated as any).slug || String((updated as any)._id);
        const stationIdStr = String((updated as any)._id);
        // Fire-and-forget mirror to S3 — log failures so admin can re-trigger
        // by saving again. logoAssets.status='failed' is also persisted by the
        // processor itself for UI visibility.
        logoProcessor.processFromUrl(stationIdStr, slug, newFavicon)
          .then((r) => {
            if (!r.success) {
              logger.warn(`⚠️ S3 mirror failed for station ${stationIdStr} (${slug}): ${r.error || 'unknown'} (failureType=${r.failureType || 'unknown'}); favicon kept as external URL`);
            }
          })
          .catch((err: any) => {
            logger.error(`❌ S3 mirror exception for station ${stationIdStr} (${slug}): ${err?.message || err}`);
          });
      }

      if ((updated as any)?.slug) {
        performanceCache.invalidateStationCache((updated as any).slug);
      }

      return res.json({ success: true, station: updated });
    } catch (error: any) {
      logger.error(`Station update failed: ${error.message}`);
      return res.status(500).json({ error: error.message || 'Update failed' });
    }
  });

  // BATCH STATION LOADING ENDPOINT - Performance Optimization
  app.post("/api/stations/batch", async (req, res) => {
    try {
      const { stationIds } = req.body;
      if (!Array.isArray(stationIds) || stationIds.length === 0) {
        return res.status(400).json({ error: 'stationIds array is required' });
      }
      if (stationIds.length > 50) {
        return res.status(400).json({ error: 'Maximum 50 stations per batch request' });
      }

      const sortedIds = [...stationIds].sort();
      const cacheKey = `stations:batch:${sortedIds.join(',')}`;
      const cached = await CacheManager.get(cacheKey);
      if (cached) return res.json(cached);

      const stations = await Station.find({ _id: { $in: stationIds } }).lean();
      const stationMap = stations.reduce((acc: any, station: any) => {
        acc[station._id.toString()] = station;
        return acc;
      }, {});

      await CacheManager.set(cacheKey, stationMap, { ttl: 300 });
      res.json(stationMap);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch stations' });
    }
  });

  // BULK IMPORT ENDPOINT - Import stations from Radio Browser API (Admin Only)
  app.post("/api/admin/bulk-import-stations", express.json({ limit: '50mb' }), requireAdmin, async (req, res) => {
    try {
      logger.log('🔄 Starting bulk station import...');
      const { stations, append = false, skipIndexes = false } = req.body;
      if (!stations || !Array.isArray(stations)) {
        return res.status(400).json({ error: 'Invalid stations array' });
      }
      
      if (req.body.clearOnly) {
        try {
          await Station.collection.drop();
          logger.log('✅ Database cleared');
        } catch (dropError) {}
        return res.json({ success: true, message: 'Database cleared' });
      }
      
      if (!append) {
        try {
          await Station.collection.drop();
        } catch (dropError) {}
      }
      
      const BATCH_SIZE = 1000;
      let insertedCount = 0;
      for (let i = 0; i < stations.length; i += BATCH_SIZE) {
        const batch = stations.slice(i, i + BATCH_SIZE);
        const cleanBatch = batch.map((station: any) => {
          const { language, ...cleanStation } = station;
          return cleanStation;
        });
        try {
          await Station.insertMany(cleanBatch, { ordered: false });
          insertedCount += batch.length;
        } catch (batchError) {}
      }
      
      if (!append && !skipIndexes) {
        try {
          await Station.collection.createIndex({ country: 1 }, { background: true });
          await Station.collection.createIndex({ votes: -1 }, { background: true });
          await Station.collection.createIndex({ hls: 1 }, { background: true });
        } catch (indexError) {}
      }
      
      const finalCount = await Station.countDocuments();
      const hlsCount = await Station.countDocuments({ hls: true });
      const mp3Count = await Station.countDocuments({ format: 'MP3' });
      const aacCount = await Station.countDocuments({ format: 'AAC' });
      const oggCount = await Station.countDocuments({ format: 'OGG' });
      const otherCount = await Station.countDocuments({ format: 'Other' });
      
      res.json({
        success: true,
        totalImported: finalCount,
        formatBreakdown: { HLS: hlsCount, MP3: mp3Count, AAC: aacCount, OGG: oggCount, Other: otherCount },
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      res.status(500).json({ error: 'Bulk import failed', details: error.message });
    }
  });

  // DELETE STATION ENDPOINT (Admin Only)
  app.delete("/api/stations/:stationId", requireAdmin, async (req, res) => {
    try {
      const { stationId } = req.params;
      const station = await Station.findById(stationId);
      if (!station) return res.status(404).json({ error: 'Station not found' });
      
      try {
        await BlacklistedStation.create({
          stationUuid: station.stationuuid,
          url: station.url,
          name: station.name,
          reason: 'Admin deletion',
          deletedBy: 'admin',
          radioBrowserId: station.changeUuid,
        });
      } catch (blacklistError) {}
      
      if (station.slug) performanceCache.invalidateStationCache(station.slug);
      await Station.findByIdAndDelete(stationId);
      await UserFavorite.deleteMany({ stationId: stationId });
      
      await CacheManager.clearByPattern('popular_stations');
      await CacheManager.clearByPattern('stations');
      await CacheManager.clearByPattern('genres');
      await CacheManager.clearByPattern('community_favorites');
      
      res.json({ success: true, message: 'Station deleted successfully and added to blacklist' });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to delete station' });
    }
  });

  // BULK DELETE STATIONS ENDPOINT (Admin Only) - For duplicates management
  app.post("/api/admin/delete-stations", requireAdmin, async (req, res) => {
    try {
      const { stationIds } = req.body;
      if (!Array.isArray(stationIds) || stationIds.length === 0) {
        return res.status(400).json({ success: false, error: 'stationIds must be a non-empty array' });
      }

      const mongoose = await import('mongoose');
      const invalidIds = stationIds.filter(id => !mongoose.Types.ObjectId.isValid(id));
      if (invalidIds.length > 0) {
        return res.status(400).json({ success: false, error: `Invalid station IDs: ${invalidIds.join(', ')}` });
      }

      let deletedCount = 0;
      let blacklistedCount = 0;
      const errors: string[] = [];

      for (const stationId of stationIds) {
        try {
          const station = await Station.findById(stationId);
          if (!station) {
            errors.push(`Station ${stationId} not found`);
            continue;
          }

          try {
            await BlacklistedStation.create({
              stationUuid: station.stationuuid,
              url: station.url,
              name: station.name,
              reason: 'Admin bulk deletion from duplicates management',
              deletedBy: 'admin',
              radioBrowserId: station.changeUuid,
            });
            blacklistedCount++;
          } catch (blacklistError: any) {
            if (!blacklistError.message.includes('duplicate')) {
              logger.warn(`Failed to blacklist station ${station.name}:`, blacklistError.message);
            }
          }

          if (station.slug) performanceCache.invalidateStationCache(station.slug);
          await Station.findByIdAndDelete(stationId);
          deletedCount++;
          await UserFavorite.deleteMany({ stationId: stationId });

        } catch (stationError: any) {
          errors.push(`Error deleting station ${stationId}: ${stationError.message}`);
        }
      }

      await CacheManager.clearByPattern('popular_stations');
      await CacheManager.clearByPattern('stations');
      await CacheManager.clearByPattern('community_favorites');

      res.json({
        success: true,
        deletedCount,
        blacklistedCount,
        message: `Successfully deleted ${deletedCount} station(s) and blacklisted ${blacklistedCount}`,
        errors: errors.length > 0 ? errors : undefined
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: 'Failed to delete stations', details: error.message });
    }
  });

  // Cleanup stations with URLs as names (Admin Only)
  app.post("/api/admin/cleanup-url-names", requireAdmin, async (req, res) => {
    try {
      // DB-side filter using case-insensitive regex for URL prefixes (avoids loading 40k+ docs into memory)
      const urlPrefixRegex = /^(https?:\/\/|www\.|ftps?:\/\/|rtmps?:\/\/|rtsps?:\/\/)/i;
      const filter = { name: { $regex: urlPrefixRegex } };

      let deletedCount = 0;
      let blacklistedCount = 0;
      const errors: string[] = [];

      // Stream matching stations via cursor — bounded memory regardless of match count
      const cursor = Station.find(filter)
        .select('_id name url stationuuid slug')
        .lean()
        .cursor({ batchSize: 500 });

      for await (const station of cursor as any) {
        try {
          try {
            await BlacklistedStation.create({
              stationUuid: station.stationuuid,
              url: station.url,
              name: station.name,
              reason: 'Station name is a URL - auto-cleanup',
              deletedBy: 'admin',
            });
            blacklistedCount++;
          } catch (blacklistError: any) {}

          if (station.slug) performanceCache.invalidateStationCache(station.slug);
          await Station.findByIdAndDelete(station._id);
          deletedCount++;
          await UserFavorite.deleteMany({ stationId: station._id });
        } catch (stationError: any) {
          errors.push(`Error deleting station ${station._id}: ${stationError.message}`);
        }
      }

      if (deletedCount === 0) {
        return res.json({ success: true, deletedCount: 0, blacklistedCount: 0, message: 'No stations with URL names found' });
      }
      
      await CacheManager.clearByPattern('popular_stations');
      await CacheManager.clearByPattern('stations');
      
      res.json({
        success: true,
        deletedCount,
        blacklistedCount,
        message: `Successfully deleted ${deletedCount} station(s) with URL names and blacklisted ${blacklistedCount}`,
        errors: errors.length > 0 ? errors : undefined
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: 'Failed to cleanup URL-named stations', details: error.message });
    }
  });

  // BLACKLISTED STATIONS ENDPOINTS (Admin Only)
  app.get("/api/admin/blacklisted-stations", requireAdmin, async (req, res) => {
    try {
      const { page = 1, limit = 50, search = '' } = req.query;
      const skip = (Number(page) - 1) * Number(limit);
      const searchFilter = search ? {
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { url: { $regex: search, $options: 'i' } },
          { reason: { $regex: search, $options: 'i' } }
        ]
      } : {};
      
      const total = await BlacklistedStation.countDocuments(searchFilter);
      const blacklistedStations = await BlacklistedStation.find(searchFilter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit));
      
      res.json({
        stations: blacklistedStations,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit))
        }
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch blacklisted stations' });
    }
  });

  app.post("/api/admin/blacklisted-stations/:blacklistId/restore", requireAdmin, async (req, res) => {
    try {
      const { blacklistId } = req.params;
      const blacklistedStation = await BlacklistedStation.findById(blacklistId);
      if (!blacklistedStation) return res.status(404).json({ error: 'Blacklisted station not found' });
      
      // Station schema uses lowercase `stationuuid` — matching BlacklistedStation's `stationUuid` field
      const existingStation = await Station.findOne({
        $or: [ { stationuuid: blacklistedStation.stationUuid }, { url: blacklistedStation.url } ]
      });
      if (existingStation) return res.status(400).json({ error: 'Station already exists in database' });
      
      try {
        if (blacklistedStation.stationUuid) {
          const radioBrowserResponse = await fetch(`https://de1.api.radio-browser.info/json/stations/byuuid/${blacklistedStation.stationUuid}`);
          if (radioBrowserResponse.ok) {
            const radioBrowserData = await radioBrowserResponse.json();
            if (radioBrowserData && radioBrowserData.length > 0) {
              const stationData = radioBrowserData[0];
              const restoredStation = new Station({
                stationuuid: stationData.stationuuid,
                name: stationData.name || blacklistedStation.name,
                url: stationData.url || blacklistedStation.url,
                homepage: stationData.homepage,
                favicon: stationData.favicon,
                tags: stationData.tags ? stationData.tags.split(',').map((tag: any) => tag.trim()).filter(Boolean) : [],
                country: stationData.country,
                state: stationData.state,
                language: stationData.language,
                languageCodes: stationData.languagecodes ? stationData.languagecodes.split(',') : [],
                votes: stationData.votes || 0,
                lastChangeTime: stationData.lastchangetime,
                codec: stationData.codec,
                bitrate: stationData.bitrate,
                hls: stationData.hls === 1,
                lastCheckOk: stationData.lastcheckok === 1,
                lastCheckTime: stationData.lastchecktime,
                lastCheckOkTime: stationData.lastcheckoktime,
                lastLocalCheckTime: stationData.lastlocalchecktime,
                clickTimestamp: stationData.clicktimestamp,
                clickCount: stationData.clickcount || 0,
                clickTrend: stationData.clicktrend || 0,
                sslError: stationData.ssl_error === 1,
                geoLat: stationData.geo_lat ? parseFloat(stationData.geo_lat) : null,
                geoLong: stationData.geo_long ? parseFloat(stationData.geo_long) : null,
                hasExtendedInfo: stationData.has_extended_info === 1
              });
              await restoredStation.save();
              await BlacklistedStation.findByIdAndDelete(blacklistId);
              await CacheManager.clearByPattern('stations');
              await CacheManager.clearByPattern('popular_stations');
              return res.json({ success: true, message: 'Station restored successfully with fresh data', station: restoredStation });
            }
          }
        }
      } catch (radioBrowserError: any) {}
      
      const restoredStation = new Station({
        stationuuid: blacklistedStation.stationUuid,
        name: blacklistedStation.name,
        url: blacklistedStation.url,
        tags: [], country: 'Unknown', language: 'Unknown', votes: 0, lastCheckOk: false, clickCount: 0, clickTrend: 0, sslError: false
      });
      await restoredStation.save();
      await BlacklistedStation.findByIdAndDelete(blacklistId);
      await CacheManager.clearByPattern('stations');
      await CacheManager.clearByPattern('popular_stations');
      res.json({ success: true, message: 'Station restored successfully with cached data', station: restoredStation });
    } catch (error) {
      res.status(500).json({ error: 'Failed to restore station' });
    }
  });

  app.get("/api/admin/db-status", requireAdmin, async (req, res) => {
    try {
      const db = mongoose.connection.db;
      if (!db) {
        return res.status(500).json({ error: 'Database not connected' });
      }
      const stats = await db.stats();
      const collections = await db.listCollections().toArray();
      const collectionStats: any[] = [];
      for (const col of collections) {
        try {
          const cStats = await db.collection(col.name).stats();
          collectionStats.push({
            name: col.name,
            count: cStats.count,
            sizeMB: Math.round((cStats.size / 1024 / 1024) * 100) / 100,
            storageSizeMB: Math.round((cStats.storageSize / 1024 / 1024) * 100) / 100,
            indexSizeMB: Math.round((cStats.totalIndexSize / 1024 / 1024) * 100) / 100,
          });
        } catch {}
      }
      collectionStats.sort((a, b) => b.storageSizeMB - a.storageSizeMB);
      res.json({
        totalSizeMB: Math.round((stats.dataSize / 1024 / 1024) * 100) / 100,
        storageSizeMB: Math.round((stats.storageSize / 1024 / 1024) * 100) / 100,
        indexSizeMB: Math.round((stats.indexSize / 1024 / 1024) * 100) / 100,
        collections: collectionStats,
        quotaStatus: getQuotaStatus()
      });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to get DB status', details: error.message });
    }
  });

  app.post("/api/admin/db-cleanup", requireAdmin, async (req, res) => {
    try {
      const { collections: targetCollections } = req.body;
      const cleanableCollections: Record<string, { model: any; keepDays?: number }> = {
        'analyticsevent': { model: AnalyticsEvent, keepDays: 0 },
        'analyticsevents': { model: AnalyticsEvent, keepDays: 0 },
        'synclogs': { model: SyncLog, keepDays: 7 },
        'stationdebuglogs': { model: StationDebugLog, keepDays: 3 },
        'bulkdescriptionjobs': { model: BulkDescriptionJob, keepDays: 1 },
      };

      const results: any[] = [];
      const targets = targetCollections || [...Object.keys(cleanableCollections), 'applogs', 'visitorsessions', 'userlisteninghistories'];

      for (const name of targets) {
        const key = name.toLowerCase().replace(/[_-]/g, '');
        const config = cleanableCollections[key];
        if (!config) {
          continue;
        }
        try {
          let deleteResult;
          if (config.keepDays === 0) {
            deleteResult = await config.model.deleteMany({});
          } else {
            const cutoff = new Date(Date.now() - config.keepDays! * 24 * 60 * 60 * 1000);
            deleteResult = await config.model.deleteMany({
              $or: [
                { createdAt: { $lt: cutoff } },
                { timestamp: { $lt: cutoff } }
              ]
            });
          }
          results.push({ collection: name, status: 'cleaned', deletedCount: deleteResult.deletedCount });
        } catch (err: any) {
          results.push({ collection: name, status: 'error', error: err.message });
        }
      }

      const db = mongoose.connection.db;

      const rawCollections: Record<string, { field: string; keepDays: number }> = {
        'applogs': { field: 'createdAt', keepDays: 7 },
        'visitorsessions': { field: 'createdAt', keepDays: 7 },
        'userlisteninghistories': { field: 'listenedAt', keepDays: 30 },
      };

      for (const name of targets) {
        const key = name.toLowerCase().replace(/[_-]/g, '');
        const rawConfig = rawCollections[key];
        if (!rawConfig || !db) continue;
        try {
          const col = db.collection(key);
          const cutoff = new Date(Date.now() - rawConfig.keepDays * 24 * 60 * 60 * 1000);
          const r = await col.deleteMany({ [rawConfig.field]: { $lt: cutoff } });
          results.push({ collection: key, status: 'cleaned', deletedCount: r.deletedCount });
        } catch (err: any) {
          results.push({ collection: key, status: 'error', error: err.message });
        }
      }

      res.json({ success: true, results });
    } catch (error: any) {
      res.status(500).json({ error: 'Cleanup failed', details: error.message });
    }
  });

  app.post("/api/admin/db-drop-collection", requireAdmin, async (req, res) => {
    try {
      const { collection } = req.body;
      if (!collection) return res.status(400).json({ error: 'Collection name required' });

      const droppable = ['applogs', 'analyticsevents', 'stationdebuglogs', 'bulkdescriptionjobs'];
      if (!droppable.includes(collection.toLowerCase())) {
        return res.status(400).json({ error: `Collection "${collection}" cannot be dropped. Allowed: ${droppable.join(', ')}` });
      }

      const db = mongoose.connection.db;
      if (!db) return res.status(500).json({ error: 'Database not connected' });

      const collections = await db.listCollections({ name: collection }).toArray();
      if (collections.length === 0) {
        return res.json({ success: true, message: `Collection "${collection}" does not exist` });
      }

      await db.dropCollection(collection);
      res.json({ success: true, message: `Collection "${collection}" dropped successfully` });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to drop collection', details: error.message });
    }
  });
}
