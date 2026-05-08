import type { Express } from "express";
import express from "express";
import mongoose from "mongoose";
import multer from "multer";
import { Station, User, UserFollow, BlacklistedStation, UserFavorite, UserNotification, AnalyticsEvent, SyncLog, StationDebugLog, BulkDescriptionJob, CoverageSnapshot, AdminSetting } from '@workspace/db-shared/mongo-schemas';
import { logger } from "../utils/logger";
import { normalizeCountryFilter, resolveToDbName, dbNameToIso } from "../utils/normalize-country";
import { syncService } from "../services/sync";
import { PrecomputedStationsService } from "../services/precomputed-stations";
import { logoProcessor } from "../services/logo-processor";
import { isS3Url, isS3Configured } from "../services/s3-storage";
import { IndexNowService } from "../services/indexnow";
import CacheManager from "../cache";
import { getQuotaStatus } from "../utils/quota-guard";
import { performanceCache } from "../performance-cache";
import { stripPlaceholders } from "./shared-utils";
import { triggerGenreStationCountsRecompute } from "../services/genre-station-counts";
import { runCoverageBackfill } from "../services/coverage-snapshot-backfill";

// AdminSetting key used to record the most recent coverage drop alert
// acknowledgement (Task #238). The stored value is keyed by snapshotDate
// so a newer alert automatically un-suppresses the banner.
const COVERAGE_DROP_ACK_KEY = 'coverage-drop-alert-ack';

const faviconUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

// In-memory progress tracker for bulk tag re-check jobs. Keyed by a
// generated jobId, with periodic cleanup of finished jobs so the map
// can't grow unbounded.
type RecheckTagsJob = {
  jobId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  total: number;
  processed: number;
  hydrated: number;
  emptyUpstream: number;
  failed: number;
  cleared: number;
  matched: number;
  scope?: string;
  startedAt: number;
  finishedAt?: number;
  error?: string;
  cancelRequested?: boolean;
  cancellable?: boolean;
};
const recheckTagsJobs = new Map<string, RecheckTagsJob>();
const RECHECK_TAGS_JOB_TTL_MS = 60 * 60 * 1000; // 1h after completion
function cleanupRecheckTagsJobs() {
  const now = Date.now();
  for (const [jobId, job] of recheckTagsJobs) {
    if (job.finishedAt && now - job.finishedAt > RECHECK_TAGS_JOB_TTL_MS) {
      recheckTagsJobs.delete(jobId);
      recheckTagsJobSubscribers.delete(jobId);
    }
  }
}

// SSE subscribers for live recheck-job progress. Each entry holds the
// callbacks attached by an open `/recheck-tags-job-stream/:jobId`
// connection; they are invoked whenever the job's snapshot changes
// (per-batch progress or terminal status transition) so clients see
// updates instantly.
type RecheckTagsJobSubscriber = (job: RecheckTagsJob) => void;
const recheckTagsJobSubscribers = new Map<string, Set<RecheckTagsJobSubscriber>>();
function notifyRecheckTagsJobSubscribers(jobId: string) {
  const subs = recheckTagsJobSubscribers.get(jobId);
  if (!subs || subs.size === 0) return;
  const job = recheckTagsJobs.get(jobId);
  if (!job) return;
  for (const sub of Array.from(subs)) {
    try {
      sub(job);
    } catch (err) {
      logger.warn(`recheck-tags SSE subscriber threw: ${(err as Error)?.message}`);
    }
  }
}

// In-memory progress tracker for per-country coverage backfill jobs (the
// "Re-enqueue" buttons on the coverage page). Each job tracks the logo
// pipeline (driven by the scheduled-logo-processor sweeping the stations
// we just $unset) and the tags pipeline (the in-process Radio-Browser
// hydration). Logo progress is computed lazily on each status poll by
// counting how many of the originally-enqueued station IDs still lack a
// completed `logoAssets`. Tags progress is streamed from the helper's
// `onProgress` callback.
type CoverageBackfillJob = {
  jobId: string;
  countryCode: string;
  scope: 'logos' | 'tags' | 'both';
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: number;
  finishedAt?: number;
  error?: string;
  cancelRequested?: boolean;
  cancellable?: boolean;
  logos?: {
    matched: number;
    enqueuedIds: string[];
    completed: number;
    remaining: number;
    done: boolean;
  };
  tags?: {
    total: number;
    processed: number;
    hydrated: number;
    emptyUpstream: number;
    failed: number;
    done: boolean;
  };
};
const coverageBackfillJobs = new Map<string, CoverageBackfillJob>();
const COVERAGE_BACKFILL_JOB_TTL_MS = 60 * 60 * 1000; // 1h after completion
function cleanupCoverageBackfillJobs() {
  const now = Date.now();
  for (const [jobId, job] of coverageBackfillJobs) {
    if (job.finishedAt && now - job.finishedAt > COVERAGE_BACKFILL_JOB_TTL_MS) {
      coverageBackfillJobs.delete(jobId);
    }
  }
}
function maybeFinishCoverageJob(job: CoverageBackfillJob) {
  const logosDone = !job.logos || job.logos.done;
  const tagsDone = !job.tags || job.tags.done;
  const wasRunning = job.status === 'running';
  if (logosDone && tagsDone && wasRunning) {
    // Task #185: a country backfill that touched tags can shift which
    // genres have stations under them — refresh Genre.stationCount so
    // the admin Genre Whitelist page doesn't show stale "thin" badges.
    if (job.tags) {
      triggerGenreStationCountsRecompute(`coverage-backfill:${job.countryCode ?? 'unknown'}`);
    }
    job.status = job.cancelRequested
      ? 'cancelled'
      : job.error
        ? 'failed'
        : 'completed';
    job.finishedAt = Date.now();
  }
}

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
        tagsStatus = 'all',
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
        tagsStatus: String(tagsStatus),
        sortBy: String(sortBy),
        sortOrder: String(sortOrder)
      })}`;
      
      const cachedResult = await CacheManager.get(cacheKey);
      if (cachedResult) {
        return void res.json(cachedResult);
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
      
      if (tagsStatus && tagsStatus !== '' && tagsStatus !== 'all') {
        // Empty-tags predicate: tags missing, null, or empty/whitespace-only string
        const emptyTagsPredicate = {
          $or: [
            { tags: { $exists: false } },
            { tags: null },
            { tags: '' },
            { tags: { $regex: /^\s*$/ } },
          ],
        };
        const tagsAndConds: any[] = filter.$and || [];
        if (tagsStatus === 'empty-cooldown') {
          // Stations whose Radio-Browser re-check returned empty AND are still
          // inside the 30-day cooldown window — i.e. stuck waiting for the
          // upstream to publish tags before the background hydration job will
          // re-query them.
          const cooldownCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
          tagsAndConds.push(emptyTagsPredicate);
          tagsAndConds.push({ tagsCheckedAt: { $gte: cooldownCutoff } });
          filter.$and = tagsAndConds;
        } else if (tagsStatus === 'never-checked') {
          // Tagless stations the background job has never re-checked yet.
          tagsAndConds.push(emptyTagsPredicate);
          tagsAndConds.push({
            $or: [
              { tagsCheckedAt: { $exists: false } },
              { tagsCheckedAt: null },
            ],
          });
          filter.$and = tagsAndConds;
        }
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

  // TAGS-STATUS SUMMARY - Count stations stuck in the 30-day Radio-Browser
  // empty-tag cooldown (and the never-checked tagless bucket) so the admin UI
  // can surface a live KPI without applying the filter manually.
  app.get('/api/admin/stations/tags-status-summary', requireAdmin, async (req, res) => {
    try {
      const cacheKey = 'admin:stations:tags-status-summary';
      const cached = await CacheManager.get(cacheKey);
      if (cached) {
        return void res.json(cached);
      }

      const emptyTagsPredicate = {
        $or: [
          { tags: { $exists: false } },
          { tags: null },
          { tags: '' },
          { tags: { $regex: /^\s*$/ } },
        ],
      };
      const cooldownCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const [emptyCooldown, neverChecked] = await Promise.all([
        Station.countDocuments({
          $and: [emptyTagsPredicate, { tagsCheckedAt: { $gte: cooldownCutoff } }],
        }),
        Station.countDocuments({
          $and: [
            emptyTagsPredicate,
            {
              $or: [
                { tagsCheckedAt: { $exists: false } },
                { tagsCheckedAt: null },
              ],
            },
          ],
        }),
      ]);

      const result = { emptyCooldown, neverChecked };
      await CacheManager.set(cacheKey, result, { ttl: 300 });
      res.json(result);
    } catch (error: any) {
      logger.error(`Error in /api/admin/stations/tags-status-summary: ${error?.message || error}`);
      res.status(500).json({ error: 'Failed to fetch tags status summary' });
    }
  });

  // PRECOMPUTED ADMIN API - Status and triggers
  app.get('/api/admin/precomputed/status', requireAdmin, async (req, res) => {
    try {
      const status = PrecomputedStationsService.getCacheStats();
      res.json(status);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch precomputed status' });
    }
  });

  app.post('/api/admin/precomputed/refresh', requireAdmin, async (req, res) => {
    try {
      const { countryCode } = req.body;
      if (!countryCode) return void res.status(400).json({ error: 'countryCode is required' });
      
      res.json({ success: true, message: `Refresh started for ${countryCode}` });
      
      setImmediate(async () => {
        try {
          await PrecomputedStationsService.computeCountryStations(countryCode);
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
            return void res.status(413).json({ error: 'File too large. Max 5MB.' });
          }
          return void res.status(400).json({ error: err.message || 'Invalid upload' });
        }
        next();
      });
    },
    async (req: any, res) => {
      try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
          return void res.status(400).json({ error: 'Invalid station id' });
        }
        if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
          return void res.status(400).json({ error: 'No favicon file uploaded (field name: favicon)' });
        }

        const station = await Station.findById(id).select('_id slug name').lean();
        if (!station) return void res.status(404).json({ error: 'Station not found' });

        const slug = (station as any).slug || (station as any).name?.toLowerCase().replace(/\s+/g, '-') || String(station._id);

        const result = await logoProcessor.processFromBuffer(
          String(station._id),
          slug,
          req.file.buffer,
          req.file.originalname || 'upload.png'
        );

        if (!result.success) {
          return void res.status(422).json({ error: result.error || 'Logo processing failed' });
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

        return void res.json({
          success: true,
          favicon: newFaviconUrl,
          logoAssets: (updated as any)?.logoAssets || null,
          folder: result.folder,
          backedUpToS3: s3Ok && !!newFaviconUrl && isS3Url(newFaviconUrl),
          warning,
        });
      } catch (error: any) {
        logger.error(`Favicon upload failed: ${error.message}`);
        return void res.status(500).json({ error: error.message || 'Upload failed' });
      }
    }
  );

  // STATION UPDATE - Edit station metadata (Admin only)
  // PUT /api/stations/:stationId   (frontend updateMutation hits this exact path)
  app.put("/api/stations/:stationId", requireAdmin, express.json({ limit: '1mb' }), async (req, res) => {
    try {
      const { stationId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(stationId)) {
        return void res.status(400).json({ error: 'Invalid station id' });
      }

      const update = pickAllowedStationFields(req.body || {});
      if (Object.keys(update).length === 0) {
        return void res.status(400).json({ error: 'No editable fields provided' });
      }

      const before = await Station.findById(stationId).select('_id slug favicon logoAssets').lean();
      if (!before) return void res.status(404).json({ error: 'Station not found' });

      const updated = await Station.findByIdAndUpdate(
        stationId,
        { $set: update },
        { returnDocument: 'after', runValidators: false }
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

      return void res.json({ success: true, station: updated });
    } catch (error: any) {
      logger.error(`Station update failed: ${error.message}`);
      return void res.status(500).json({ error: error.message || 'Update failed' });
    }
  });

  // BATCH STATION LOADING ENDPOINT - Performance Optimization
  app.post("/api/stations/batch", async (req, res) => {
    try {
      const { stationIds } = req.body;
      if (!Array.isArray(stationIds) || stationIds.length === 0) {
        return void res.status(400).json({ error: 'stationIds array is required' });
      }
      if (stationIds.length > 50) {
        return void res.status(400).json({ error: 'Maximum 50 stations per batch request' });
      }

      const sortedIds = [...stationIds].sort();
      const cacheKey = `stations:batch:${sortedIds.join(',')}`;
      const cached = await CacheManager.get(cacheKey);
      if (cached) return void res.json(cached);

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
        return void res.status(400).json({ error: 'Invalid stations array' });
      }
      
      if (req.body.clearOnly) {
        try {
          await Station.collection.drop();
          logger.log('✅ Database cleared');
        } catch (dropError) {}
        return void res.json({ success: true, message: 'Database cleared' });
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
      
      // Task #185: a bulk import flips most genres' station counts at once.
      // Refresh Genre.stationCount in the background so the admin Genre
      // Whitelist page reflects the new totals on its next poll instead of
      // showing pre-import "thin" / "no matching stations" badges.
      triggerGenreStationCountsRecompute('bulk-import-stations');

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
      if (!station) return void res.status(404).json({ error: 'Station not found' });
      
      let blacklisted = false;
      try {
        await BlacklistedStation.create({
          stationUuid: station.stationuuid,
          url: station.url,
          name: station.name,
          reason: 'Admin deletion',
          deletedBy: 'admin',
          radioBrowserId: station.changeUuid,
        });
        blacklisted = true;
      } catch (blacklistError) {}
      
      if (station.slug) performanceCache.invalidateStationCache(station.slug);
      await Station.findByIdAndDelete(stationId);
      await UserFavorite.deleteMany({ stationId: stationId });
      
      await CacheManager.clearByPattern('popular_stations');
      await CacheManager.clearByPattern('stations');
      await CacheManager.clearByPattern('genres');
      await CacheManager.clearByPattern('community_favorites');

      if (blacklisted) {
        const actorEmail =
          (req.user as { email?: string } | undefined)?.email ?? undefined;
        void import('../services/admin-audit-email')
          .then(({ emailBlacklistChangesCsv }) =>
            emailBlacklistChangesCsv({
              action: 'add',
              source: 'single deletion',
              rows: [
                {
                  name: station.name ?? '',
                  url: station.url ?? '',
                  stationUuid: station.stationuuid,
                  country: (station as any).country ?? '',
                  countryCode: (station as any).countrycode ?? '',
                  reason: 'Admin deletion',
                },
              ],
              actorEmail,
            }),
          )
          .catch((err) => {
            logger.error({ err }, 'Failed to send blacklist audit email');
          });
      }

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
        return void res.status(400).json({ success: false, error: 'stationIds must be a non-empty array' });
      }

      const mongoose = await import('mongoose');
      const invalidIds = stationIds.filter(id => !mongoose.Types.ObjectId.isValid(id));
      if (invalidIds.length > 0) {
        return void res.status(400).json({ success: false, error: `Invalid station IDs: ${invalidIds.join(', ')}` });
      }

      let deletedCount = 0;
      let blacklistedCount = 0;
      const errors: string[] = [];
      const SAMPLE_CAP = 500;
      const blacklistSamples: Array<{
        name: string;
        url: string;
        stationUuid?: string;
        country?: string;
        countryCode?: string;
        reason?: string;
      }> = [];

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
            if (blacklistSamples.length < SAMPLE_CAP) {
              blacklistSamples.push({
                name: station.name ?? '',
                url: station.url ?? '',
                stationUuid: station.stationuuid,
                country: (station as any).country ?? '',
                countryCode: (station as any).countrycode ?? '',
                reason: 'Admin bulk deletion from duplicates management',
              });
            }
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

      // Task #185: bulk deletes can drop a slug below the indexable
      // threshold or to zero — refresh Genre.stationCount so the admin
      // page doesn't keep showing the pre-delete "live" badge.
      if (deletedCount > 0) {
        triggerGenreStationCountsRecompute('bulk-delete-stations');
      }

      if (blacklistSamples.length > 0) {
        const actorEmail =
          (req.user as { email?: string } | undefined)?.email ?? undefined;
        void import('../services/admin-audit-email')
          .then(({ emailBlacklistChangesCsv }) =>
            emailBlacklistChangesCsv({
              action: 'add',
              source: `bulk deletion (${blacklistedCount} station${blacklistedCount === 1 ? '' : 's'})`,
              rows: blacklistSamples,
              actorEmail,
            }),
          )
          .catch((err) => {
            logger.error({ err }, 'Failed to send blacklist audit email');
          });
      }

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
      const SAMPLE_CAP = 500;
      const blacklistSamples: Array<{
        name: string;
        url: string;
        stationUuid?: string;
        country?: string;
        countryCode?: string;
        reason?: string;
      }> = [];

      // Stream matching stations via cursor — bounded memory regardless of match count
      const cursor = Station.find(filter)
        .select('_id name url stationuuid slug country countrycode')
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
            if (blacklistSamples.length < SAMPLE_CAP) {
              blacklistSamples.push({
                name: station.name ?? '',
                url: station.url ?? '',
                stationUuid: station.stationuuid,
                country: station.country ?? '',
                countryCode: station.countrycode ?? '',
                reason: 'Station name is a URL - auto-cleanup',
              });
            }
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
        return void res.json({ success: true, deletedCount: 0, blacklistedCount: 0, message: 'No stations with URL names found' });
      }
      
      await CacheManager.clearByPattern('popular_stations');
      await CacheManager.clearByPattern('stations');

      if (blacklistSamples.length > 0) {
        const actorEmail =
          (req.user as { email?: string } | undefined)?.email ?? undefined;
        void import('../services/admin-audit-email')
          .then(({ emailBlacklistChangesCsv }) =>
            emailBlacklistChangesCsv({
              action: 'add',
              source: `URL-name cleanup (${blacklistedCount} station${blacklistedCount === 1 ? '' : 's'})`,
              rows: blacklistSamples,
              actorEmail,
            }),
          )
          .catch((err) => {
            logger.error({ err }, 'Failed to send blacklist audit email');
          });
      }

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
          { name: { $regex: String(search), $options: 'i' } },
          { url: { $regex: String(search), $options: 'i' } },
          { reason: { $regex: String(search), $options: 'i' } }
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
    const sendUnblacklistEmail = (
      bl: { name?: string; url?: string; stationUuid?: string; reason?: string },
    ) => {
      const actorEmail =
        (req.user as { email?: string } | undefined)?.email ?? undefined;
      void import('../services/admin-audit-email')
        .then(({ emailBlacklistChangesCsv }) =>
          emailBlacklistChangesCsv({
            action: 'remove',
            source: 'restore from blacklist',
            rows: [
              {
                name: bl.name ?? '',
                url: bl.url ?? '',
                stationUuid: bl.stationUuid,
                reason: bl.reason ?? '',
              },
            ],
            actorEmail,
          }),
        )
        .catch((err) => {
          logger.error({ err }, 'Failed to send blacklist audit email');
        });
    };
    try {
      const { blacklistId } = req.params;
      const blacklistedStation = await BlacklistedStation.findById(blacklistId);
      if (!blacklistedStation) return void res.status(404).json({ error: 'Blacklisted station not found' });
      
      // Station schema uses lowercase `stationuuid` — matching BlacklistedStation's `stationUuid` field
      const existingStation = await Station.findOne({
        $or: [ { stationuuid: blacklistedStation.stationUuid }, { url: blacklistedStation.url } ]
      });
      if (existingStation) return void res.status(400).json({ error: 'Station already exists in database' });
      
      try {
        if (blacklistedStation.stationUuid) {
          const radioBrowserResponse = await fetch(`https://de1.api.radio-browser.info/json/stations/byuuid/${blacklistedStation.stationUuid}`);
          if (radioBrowserResponse.ok) {
            const radioBrowserData = (await radioBrowserResponse.json()) as any[];
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
              sendUnblacklistEmail({
                name: blacklistedStation.name,
                url: blacklistedStation.url,
                stationUuid: blacklistedStation.stationUuid,
                reason: blacklistedStation.reason,
              });
              return void res.json({ success: true, message: 'Station restored successfully with fresh data', station: restoredStation });
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
      sendUnblacklistEmail({
        name: blacklistedStation.name,
        url: blacklistedStation.url,
        stationUuid: blacklistedStation.stationUuid,
        reason: blacklistedStation.reason,
      });
      res.json({ success: true, message: 'Station restored successfully with cached data', station: restoredStation });
    } catch (error) {
      res.status(500).json({ error: 'Failed to restore station' });
    }
  });

  app.get("/api/admin/db-status", requireAdmin, async (req, res) => {
    try {
      const db = mongoose.connection.db;
      if (!db) {
        return void res.status(500).json({ error: 'Database not connected' });
      }
      const stats = await db.stats();
      const collections = await db.listCollections().toArray();
      const collectionStats: any[] = [];
      for (const col of collections) {
        try {
          const cStats: any = await db.command({ collStats: col.name });
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
      if (!collection) return void res.status(400).json({ error: 'Collection name required' });

      const droppable = ['applogs', 'analyticsevents', 'stationdebuglogs', 'bulkdescriptionjobs'];
      if (!droppable.includes(collection.toLowerCase())) {
        return void res.status(400).json({ error: `Collection "${collection}" cannot be dropped. Allowed: ${droppable.join(', ')}` });
      }

      const db = mongoose.connection.db;
      if (!db) return void res.status(500).json({ error: 'Database not connected' });

      const collections = await db.listCollections({ name: collection }).toArray();
      if (collections.length === 0) {
        return void res.json({ success: true, message: `Collection "${collection}" does not exist` });
      }

      await db.dropCollection(collection);
      res.json({ success: true, message: `Collection "${collection}" dropped successfully` });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to drop collection', details: error.message });
    }
  });

  // Re-check tags from Radio-Browser for a single station (admin override).
  // Bypasses the `tagsCheckedAt` cooldown that the background hydration job
  // honours, so admins can force a refresh on stations stamped as
  // upstream-empty.
  app.post(
    "/api/admin/stations/:stationId/recheck-tags",
    requireAdmin,
    async (req, res) => {
      try {
        const { stationId } = req.params;
        const result = await syncService.recheckStationTags(stationId);
        if (!result.success) {
          return void res.status(400).json(result);
        }
        return void res.json(result);
      } catch (error: any) {
        logger.error('recheck-tags single failed', error);
        return void res
          .status(500)
          .json({ success: false, error: error?.message || 'Failed to re-check tags' });
      }
    },
  );

  // Bulk re-check tags. Clears `tagsCheckedAt` for the targeted stations
  // (so the next hydration sweep re-queries them) and immediately kicks off
  // the hydration job in the background. Targeting is via either
  // `stationIds` (specific stations) or `countryCode` (all empty-tag
  // stations in that country). At least one must be provided.
  app.post(
    "/api/admin/stations/recheck-tags-bulk",
    express.json({ limit: '1mb' }),
    requireAdmin,
    async (req, res) => {
      try {
        const {
          stationIds,
          countryCode,
          tagsStatus,
          search,
          language,
          genre,
        } = (req.body || {}) as {
          stationIds?: unknown;
          countryCode?: unknown;
          tagsStatus?: unknown;
          search?: unknown;
          language?: unknown;
          genre?: unknown;
        };

        const ids = Array.isArray(stationIds)
          ? (stationIds.filter(
              (id) => typeof id === 'string' && mongoose.Types.ObjectId.isValid(id),
            ) as string[])
          : [];
        const rawCountry =
          typeof countryCode === 'string' && countryCode.trim()
            ? countryCode.trim()
            : undefined;
        const rawTagsStatus =
          typeof tagsStatus === 'string' && tagsStatus.trim()
            ? tagsStatus.trim()
            : undefined;
        const rawSearch =
          typeof search === 'string' && search.trim() ? search.trim() : undefined;
        const rawLanguage =
          typeof language === 'string' && language.trim() && language !== 'all'
            ? language.trim()
            : undefined;
        const rawGenre =
          typeof genre === 'string' && genre.trim() && genre !== 'all'
            ? genre.trim()
            : undefined;

        const isFilterMode =
          rawTagsStatus === 'empty-cooldown' || rawTagsStatus === 'never-checked';

        if (ids.length === 0 && !rawCountry && !isFilterMode) {
          return void res.status(400).json({
            success: false,
            error: 'Provide stationIds, countryCode, or tagsStatus',
          });
        }

        // Country input may arrive as either an ISO code (e.g. "DE")
        // or a full DB country name (e.g. "Germany") — the admin
        // filters dropdown sends the latter via `/api/filters/countries`.
        // Resolve both forms so the bulk path matches reliably.
        let resolvedIso: string | undefined;
        let countryFilter: Record<string, unknown> = {};
        if (rawCountry) {
          const dbName = resolveToDbName(rawCountry);
          if (dbName) {
            const iso = dbNameToIso(dbName);
            if (iso) {
              resolvedIso = iso.toUpperCase();
              countryFilter = {
                $or: [
                  { countryCode: resolvedIso },
                  { country: { $regex: new RegExp(`^${dbName}$`, 'i') } },
                ],
              };
            } else {
              countryFilter = {
                country: { $regex: new RegExp(`^${dbName}$`, 'i') },
              };
            }
          } else {
            // Fall back to a regex match on the raw input.
            countryFilter = normalizeCountryFilter(rawCountry);
          }
        }

        const filter: Record<string, unknown> = {};
        if (ids.length > 0) {
          filter._id = { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) };
        } else if (isFilterMode) {
          // Filter-driven bulk: target every station matching the
          // current admin "tagsStatus" filter (and any additional
          // search/country/language/genre filters), not just the
          // visible page. Mirrors the predicate used by the GET
          // /api/admin/stations endpoint. We compose every constraint
          // inside `$and` so independent `$or` clauses (country
          // alternatives, search alternatives, empty-tags alternatives)
          // never clobber each other.
          const emptyTagsPredicate: Record<string, unknown> = {
            $or: [
              { tags: { $exists: false } },
              { tags: null },
              { tags: '' },
              { tags: { $regex: /^\s*$/ } },
            ],
          };
          const andConds: Record<string, unknown>[] = [emptyTagsPredicate];
          if (rawTagsStatus === 'empty-cooldown') {
            const cooldownCutoff = new Date(
              Date.now() - 30 * 24 * 60 * 60 * 1000,
            );
            andConds.push({ tagsCheckedAt: { $gte: cooldownCutoff } });
          } else {
            andConds.push({
              $or: [
                { tagsCheckedAt: { $exists: false } },
                { tagsCheckedAt: null },
              ],
            });
          }
          if (Object.keys(countryFilter).length > 0) {
            andConds.push(countryFilter);
          }
          if (rawSearch) {
            andConds.push({
              $or: [
                { name: { $regex: new RegExp(rawSearch, 'i') } },
                { country: { $regex: new RegExp(rawSearch, 'i') } },
                { tags: { $regex: new RegExp(rawSearch, 'i') } },
              ],
            });
          }
          if (rawLanguage) {
            andConds.push({
              language: { $regex: new RegExp(rawLanguage, 'i') },
            });
          }
          if (rawGenre) {
            andConds.push({ tags: { $regex: new RegExp(rawGenre, 'i') } });
          }
          filter.$and = andConds;
        } else {
          Object.assign(filter, countryFilter);
          filter.$and = [
            {
              $or: [
                { tags: { $exists: false } },
                { tags: null },
                { tags: '' },
              ],
            },
          ];
        }

        // Resolve every matching station for filter-mode so the
        // background re-check targets exactly the cleared rows. We
        // page through the cursor (no fixed cap) so requests with
        // tens of thousands of stuck stations are still fully covered.
        let filterModeIds: string[] = [];
        if (isFilterMode) {
          const cursor = Station.find(filter).select('_id').lean().cursor();
          for await (const doc of cursor) {
            const id = (doc as { _id: mongoose.Types.ObjectId })._id;
            if (id) filterModeIds.push(id.toString());
          }
        }

        let cleared = 0;
        let matched = 0;
        if (isFilterMode) {
          matched = filterModeIds.length;
          // Chunk the $unset to keep each Mongo command well below the
          // 16MB BSON limit on huge result sets.
          const updateChunkSize = 5000;
          for (let i = 0; i < filterModeIds.length; i += updateChunkSize) {
            const chunk = filterModeIds.slice(i, i + updateChunkSize);
            const chunkResult: import('mongodb').UpdateResult =
              await Station.updateMany(
                {
                  _id: {
                    $in: chunk.map((id) => new mongoose.Types.ObjectId(id)),
                  },
                },
                { $unset: { tagsCheckedAt: '' } },
              );
            cleared += chunkResult.modifiedCount ?? 0;
          }
        } else {
          const updateResult: import('mongodb').UpdateResult =
            await Station.updateMany(filter, { $unset: { tagsCheckedAt: '' } });
          cleared = updateResult.modifiedCount ?? 0;
          matched = updateResult.matchedCount ?? cleared;
        }

        // Create an in-memory job so the admin UI can stream progress
        // (over SSE) while the background hydration runs. Only
        // ID-scoped paths produce per-station progress; the country
        // hydration sweep runs as a fire-and-forget background scan
        // that doesn't expose progress, so we leave the job in
        // `running` until we detect it has nothing to track and mark
        // it completed.
        cleanupRecheckTagsJobs();
        const jobId = new mongoose.Types.ObjectId().toString();
        const scopeBits: string[] = [];
        if (ids.length > 0) scopeBits.push(`${ids.length} selected`);
        if (rawTagsStatus) scopeBits.push(rawTagsStatus);
        if (resolvedIso ?? rawCountry) scopeBits.push(`country ${resolvedIso ?? rawCountry}`);
        if (rawLanguage) scopeBits.push(`language ${rawLanguage}`);
        if (rawGenre) scopeBits.push(`genre ${rawGenre}`);
        if (rawSearch) scopeBits.push(`search "${rawSearch}"`);
        const job: RecheckTagsJob = {
          jobId,
          status: 'running',
          total: 0,
          processed: 0,
          hydrated: 0,
          emptyUpstream: 0,
          failed: 0,
          cleared,
          matched,
          scope: scopeBits.join(', ') || undefined,
          startedAt: Date.now(),
          cancelRequested: false,
          cancellable: false,
        };
        recheckTagsJobs.set(jobId, job);

        const isCancelled = () => recheckTagsJobs.get(jobId)?.cancelRequested === true;

        const onProgress = (p: {
          processed: number;
          hydrated: number;
          emptyUpstream: number;
          failed: number;
          total: number;
        }) => {
          const current = recheckTagsJobs.get(jobId);
          if (!current) return;
          current.total = p.total;
          current.processed = p.processed;
          current.hydrated = p.hydrated;
          current.emptyUpstream = p.emptyUpstream;
          current.failed = p.failed;
          recheckTagsJobs.set(jobId, current);
          notifyRecheckTagsJobSubscribers(jobId);
        };
        const finish = (err?: unknown) => {
          const current = recheckTagsJobs.get(jobId);
          if (!current) return;
          // Task #185: a tag re-check can move stations into/out of slugs.
          // Refresh Genre.stationCount so the admin Genre Whitelist page
          // doesn't keep showing pre-recheck totals.
          if ((current.hydrated ?? 0) > 0 || (current.processed ?? 0) > 0) {
            triggerGenreStationCountsRecompute(`recheck-tags-bulk:${jobId}`);
          }
          // If cancellation was requested but the loop had already finished
          // every station before observing the flag, prefer the truthful
          // 'completed' status so admins don't see a misleading "cancelled"
          // label on a run that actually processed everything.
          const fullyProcessed =
            current.total > 0 && current.processed >= current.total;
          if (current.cancelRequested && !fullyProcessed) {
            current.status = 'cancelled';
          } else {
            current.status = err ? 'failed' : 'completed';
          }
          current.finishedAt = Date.now();
          if (err && current.status === 'failed') {
            current.error = err instanceof Error ? err.message : String(err);
          }
          recheckTagsJobs.set(jobId, current);
          notifyRecheckTagsJobSubscribers(jobId);
        };

        // Kick off the actual re-query in the background so the admin
        // gets immediate feedback. Targeted ID requests use the
        // ID-scoped helper so we re-query exactly those stations;
        // country requests use the country-scoped hydration sweep
        // (which itself filters on `countryCode` ISO).
        if (ids.length > 0) {
          job.total = ids.length;
          job.cancellable = true;
          void syncService
            .recheckStationsTagsByIds(ids, onProgress, isCancelled)
            .then(() => finish())
            .catch((err) => {
              logger.error('bulk tags recheck (ids) failed', err);
              finish(err);
            });
        } else if (isFilterMode) {
          if (filterModeIds.length > 0) {
            job.total = filterModeIds.length;
            job.cancellable = true;
            void syncService
              .recheckStationsTagsByIds(filterModeIds, onProgress, isCancelled)
              .then(() => finish())
              .catch((err) => {
                logger.error('bulk tags recheck (filter) failed', err);
                finish(err);
              });
          } else {
            finish();
          }
        } else if (resolvedIso) {
          job.total = matched;
          job.cancellable = true;
          void syncService
            .hydrateMissingTagsInBackground({
              countryCode: resolvedIso,
              limit: Math.max(matched, 1000),
              isCancelled,
              onProgress,
            })
            .then((result) => {
              // Fold the final tallies back into the job tracker before
              // finish() decides between completed / cancelled. The
              // per-batch onProgress stream already keeps the UI live,
              // but this guarantees the final numbers (and the
              // `fullyProcessed` safeguard in finish()) line up even if
              // the last progress tick was missed.
              const current = recheckTagsJobs.get(jobId);
              if (current) {
                current.processed = result.processed;
                current.hydrated = result.hydrated;
                current.emptyUpstream = result.emptyUpstream;
                current.failed = result.failed;
                recheckTagsJobs.set(jobId, current);
                notifyRecheckTagsJobSubscribers(jobId);
              }
              finish();
            })
            .catch((err) => {
              logger.error('bulk tags recheck (country) failed', err);
              finish(err);
            });
        } else if (rawCountry) {
          // No ISO code resolvable — fall back to ID-scoped sweep
          // over the matched stations so we still re-query them.
          const matchedDocs = (await Station.find(filter)
            .select('_id')
            .limit(5000)
            .lean()) as unknown as Array<{ _id: mongoose.Types.ObjectId }>;
          const matchedIds = matchedDocs.map((d) => d._id.toString());
          if (matchedIds.length > 0) {
            job.total = matchedIds.length;
            job.cancellable = true;
            void syncService
              .recheckStationsTagsByIds(matchedIds, onProgress, isCancelled)
              .then(() => finish())
              .catch((err) => {
                logger.error('bulk tags recheck (country fallback) failed', err);
                finish(err);
              });
          } else {
            finish();
          }
        } else {
          finish();
        }

        return void res.json({
          success: true,
          jobId,
          cleared,
          matched,
          countryCode: resolvedIso ?? rawCountry,
          stationIdsCount: ids.length,
          tagsStatus: rawTagsStatus,
          message: `Cleared tagsCheckedAt for ${cleared} station(s) (${matched} matched); re-check job started`,
        });
      } catch (error: any) {
        logger.error('recheck-tags bulk failed', error);
        return void res
          .status(500)
          .json({ success: false, error: error?.message || 'Failed to bulk re-check tags' });
      }
    },
  );

  // Cancel a running bulk tag re-check job. The background loops in
  // `recheckStationsTagsByIds` and `hydrateMissingTagsInBackground` both
  // poll the job's `cancelRequested` flag between batches and exit
  // cleanly, after which `finish()` will mark the job as `cancelled`.
  app.post(
    '/api/admin/stations/recheck-tags-job-cancel/:jobId',
    requireAdmin,
    async (req, res) => {
      const { jobId } = req.params as { jobId: string };
      const job = recheckTagsJobs.get(jobId);
      if (!job) {
        return void res
          .status(404)
          .json({ success: false, error: 'Job not found' });
      }
      if (job.status !== 'running') {
        return void res.json({ success: true, job, alreadyFinished: true });
      }
      if (!job.cancellable) {
        return void res
          .status(409)
          .json({ success: false, error: 'Job is not cancellable' });
      }
      job.cancelRequested = true;
      recheckTagsJobs.set(jobId, job);
      notifyRecheckTagsJobSubscribers(jobId);
      logger.log(`🛑 Bulk tag re-check job ${jobId} cancellation requested`);
      return void res.json({ success: true, job });
    },
  );

  // Live progress stream for a bulk tag re-check job. Admins see
  // processed/hydrated/failed counts the moment each batch finishes,
  // and the header tagless badge updates as soon as the server reports
  // progress. The stream emits an initial `snapshot`, one `progress`
  // event per change while the job is running, and a final `done`
  // event on terminal status before closing. Unknown jobs (e.g.
  // evicted after the 1-hour TTL) get a `not-found` event so the
  // client can stop reconnecting and clear the persisted job id.
  app.get(
    '/api/admin/stations/recheck-tags-job-stream/:jobId',
    requireAdmin,
    async (req, res) => {
      const { jobId } = req.params as { jobId: string };
      cleanupRecheckTagsJobs();

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        // Disable proxy buffering so each event flushes immediately.
        'X-Accel-Buffering': 'no',
      });
      // Express 5 doesn't always flush headers eagerly for SSE.
      res.flushHeaders?.();

      const send = (event: string, payload: unknown) => {
        try {
          res.write(`event: ${event}\n`);
          res.write(`data: ${JSON.stringify(payload)}\n\n`);
        } catch {
          // socket likely already closed; cleanup happens via 'close'
        }
      };

      const job = recheckTagsJobs.get(jobId);
      if (!job) {
        send('not-found', { jobId });
        return void res.end();
      }

      send('snapshot', job);
      if (job.status !== 'running') {
        send('done', job);
        return void res.end();
      }

      let closed = false;
      const keepalive = setInterval(() => {
        if (closed) return;
        try {
          res.write(': ping\n\n');
        } catch {
          // ignore; 'close' will clean up
        }
      }, 15000);

      const sub: RecheckTagsJobSubscriber = (j) => {
        if (closed) return;
        if (j.status === 'running') {
          send('progress', j);
        } else {
          send('done', j);
          cleanup();
          try {
            res.end();
          } catch {
            // ignore
          }
        }
      };

      let subs = recheckTagsJobSubscribers.get(jobId);
      if (!subs) {
        subs = new Set();
        recheckTagsJobSubscribers.set(jobId, subs);
      }
      subs.add(sub);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepalive);
        const s = recheckTagsJobSubscribers.get(jobId);
        if (s) {
          s.delete(sub);
          if (s.size === 0) recheckTagsJobSubscribers.delete(jobId);
        }
      };

      req.on('close', cleanup);
      return;
    },
  );

  // COVERAGE BY COUNTRY — admin diagnostic that surfaces which markets are
  // dragging down indexing quality. Returns one row per countryCode with
  // total stations + how many have a completed `logoAssets` record + how
  // many have a non-empty `tags` field. Designed to replace the ad-hoc
  // Mongo aggregations admins were running by hand to find regressions.
  app.get(
    '/api/admin/coverage/by-country',
    requireAdmin,
    async (_req, res) => {
      try {
        const rows = await Station.aggregate([
          {
            $match: {
              countryCode: { $exists: true, $nin: [null, '', 'null'] },
            },
          },
          {
            $group: {
              _id: { $toUpper: '$countryCode' },
              total: { $sum: 1 },
              withLogo: {
                $sum: {
                  $cond: [
                    { $eq: ['$logoAssets.status', 'completed'] },
                    1,
                    0,
                  ],
                },
              },
              withTags: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $ne: ['$tags', null] },
                        { $ne: [{ $ifNull: ['$tags', ''] }, ''] },
                        {
                          $not: [
                            {
                              $regexMatch: {
                                input: { $ifNull: ['$tags', ''] },
                                regex: /^\s*$/,
                              },
                            },
                          ],
                        },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
            },
          },
        ]);

        const decorated = rows
          .map((row) => {
            const code = String(row._id || '').toUpperCase();
            const total = Number(row.total) || 0;
            const withLogo = Number(row.withLogo) || 0;
            const withTags = Number(row.withTags) || 0;
            const dbName = resolveToDbName(code) || code;
            return {
              countryCode: code,
              countryName: dbName,
              total,
              withLogo,
              withTags,
              missingLogo: Math.max(total - withLogo, 0),
              missingTags: Math.max(total - withTags, 0),
              logoCoveragePct:
                total > 0 ? Math.round((withLogo / total) * 1000) / 10 : 0,
              tagCoveragePct:
                total > 0 ? Math.round((withTags / total) * 1000) / 10 : 0,
            };
          })
          .sort((a, b) => b.total - a.total);

        return void res.json({ countries: decorated });
      } catch (error: any) {
        logger.error('coverage by-country failed', error);
        return void res.status(500).json({
          error: error?.message || 'Failed to compute country coverage',
        });
      }
    },
  );

  // COVERAGE TRENDS — return per-country daily coverage snapshots from the
  // last N days (default 30) so the admin coverage page can render a small
  // sparkline and a 30-day delta beside today's numbers. Snapshots are
  // populated nightly by `services/scheduled-coverage-snapshot.ts`.
  app.get(
    '/api/admin/coverage/trends',
    requireAdmin,
    async (req, res) => {
      try {
        const rawDays = Number(req.query.days);
        const days = Number.isFinite(rawDays)
          ? Math.min(Math.max(Math.floor(rawDays), 1), 180)
          : 30;
        const since = new Date();
        since.setUTCHours(0, 0, 0, 0);
        since.setUTCDate(since.getUTCDate() - (days - 1));

        // Optional countryCode filter — when the per-country trend page asks
        // for a single market we don't need to ship every other country's
        // snapshots over the wire. The compare view passes a comma-separated
        // list (e.g. `TR,DE,US`) to overlay several markets on one chart, so
        // accept either a single ISO-2 code or a CSV of them. Anything that
        // isn't a valid ISO-2 code is silently dropped, and an empty result
        // means "no filter" (return everything).
        const rawCountry =
          typeof req.query.countryCode === 'string'
            ? req.query.countryCode.trim().toUpperCase()
            : '';
        const countryList = rawCountry
          ? Array.from(
              new Set(
                rawCountry
                  .split(',')
                  .map((c) => c.trim())
                  .filter((c) => /^[A-Z]{2}$/.test(c)),
              ),
            )
          : [];
        const countryFilter =
          countryList.length === 1
            ? countryList[0]
            : countryList.length > 1
              ? { $in: countryList }
              : null;

        type SnapshotRow = {
          countryCode: string;
          snapshotDate: Date;
          logoCoveragePct: number;
          tagCoveragePct: number;
          total: number;
          withLogo: number;
          withTags: number;
          source?: 'cron' | 'backfill';
        };
        type TrendPoint = Omit<SnapshotRow, 'countryCode' | 'snapshotDate'> & {
          date: string;
          // Always present in the response (legacy rows missing the DB
          // field default to 'cron'), so the UI can render reconstructed
          // backfill points distinctly from real cron snapshots.
          source: 'cron' | 'backfill';
        };

        const rows = await CoverageSnapshot.find(
          {
            snapshotDate: { $gte: since },
            ...(countryFilter !== null ? { countryCode: countryFilter } : {}),
          },
          {
            countryCode: 1,
            snapshotDate: 1,
            logoCoveragePct: 1,
            tagCoveragePct: 1,
            total: 1,
            withLogo: 1,
            withTags: 1,
            source: 1,
            _id: 0,
          },
        )
          .sort({ countryCode: 1, snapshotDate: 1 })
          .lean<SnapshotRow[]>();

        const byCountry = new Map<string, TrendPoint[]>();
        for (const r of rows) {
          const code = String(r.countryCode || '').toUpperCase();
          if (!code) continue;
          const date =
            r.snapshotDate instanceof Date
              ? r.snapshotDate.toISOString().slice(0, 10)
              : String(r.snapshotDate).slice(0, 10);
          const list = byCountry.get(code) || [];
          list.push({
            date,
            logoCoveragePct: Number(r.logoCoveragePct) || 0,
            tagCoveragePct: Number(r.tagCoveragePct) || 0,
            total: Number(r.total) || 0,
            withLogo: Number(r.withLogo) || 0,
            withTags: Number(r.withTags) || 0,
            source: r.source === 'backfill' ? 'backfill' : 'cron',
          });
          byCountry.set(code, list);
        }

        const trends: Record<string, TrendPoint[]> = {};
        for (const [code, list] of byCountry) {
          trends[code] = list;
        }

        return void res.json({
          days,
          since: since.toISOString(),
          trends,
        });
      } catch (error: any) {
        logger.error('coverage trends failed', error);
        return void res.status(500).json({
          error: error?.message || 'Failed to fetch coverage trends',
        });
      }
    },
  );

  // COVERAGE DROP ALERTS — surface the most recent nightly coverage drop
  // alert (written by `services/coverage-drop-notifier.ts` as admin
  // `UserNotification` rows with `data.kind === 'coverage_drop'`) so the
  // admin coverage page can highlight which countries triggered the alert
  // without forcing admins to dig through the generic notifications UI.
  // We return the latest single alert (most recent snapshotDate) — earlier
  // alerts are still available in the notifications surface.
  //
  // Acknowledgement (Task #238): admins can dismiss the banner for the
  // current alert via POST /api/admin/coverage/drop-alerts/acknowledge.
  // The acknowledgement is keyed by snapshotDate and stored in
  // `AdminSetting` under `coverage-drop-alert-ack`, so it is shared
  // across admins and survives reloads. Once a newer alert (different
  // snapshotDate) arrives the banner shows again automatically.
  app.get(
    '/api/admin/coverage/drop-alerts',
    requireAdmin,
    async (_req, res) => {
      try {
        // Sort by `data.snapshotDate` first (the date the alert is *about*)
        // and fall back to `createdAt` so historical replays / backfills
        // don't misorder. In normal nightly operation the two correlate.
        const latest = await UserNotification.findOne(
          { type: 'system', 'data.kind': 'coverage_drop' },
          {
            createdAt: 1,
            message: 1,
            data: 1,
          },
        )
          .sort({ 'data.snapshotDate': -1, createdAt: -1 })
          .lean();

        if (!latest) {
          return void res.json({ alert: null });
        }

        const data = (latest.data ?? {}) as {
          kind?: string;
          snapshotDate?: string;
          thresholdPp?: number;
          drops?: Array<{
            countryCode: string;
            metric: 'logo' | 'tag';
            todayPct: number;
            weekAgoPct: number;
            deltaPp: number;
            total: number;
          }>;
        };

        const drops = Array.isArray(data.drops) ? data.drops : [];

        // Look up any acknowledgement that matches this alert's
        // snapshotDate. We always resolve `acknowledged` so the client
        // can decide whether to render the banner.
        const ackDoc = await AdminSetting.findOne({
          key: COVERAGE_DROP_ACK_KEY,
        }).lean();
        const ackValue = (ackDoc?.value ?? null) as {
          snapshotDate?: string | null;
          acknowledgedAt?: string | null;
          acknowledgedBy?: string | null;
        } | null;
        const ackMatches =
          !!ackValue &&
          typeof ackValue.snapshotDate === 'string' &&
          ackValue.snapshotDate === (data.snapshotDate ?? null);

        return void res.json({
          alert: {
            createdAt:
              latest.createdAt instanceof Date
                ? latest.createdAt.toISOString()
                : new Date().toISOString(),
            snapshotDate: data.snapshotDate ?? null,
            thresholdPp:
              typeof data.thresholdPp === 'number' ? data.thresholdPp : null,
            message: latest.message ?? '',
            drops: drops.map((d) => ({
              countryCode: String(d.countryCode || '').toUpperCase(),
              metric: d.metric,
              todayPct: Number(d.todayPct) || 0,
              weekAgoPct: Number(d.weekAgoPct) || 0,
              deltaPp: Number(d.deltaPp) || 0,
              total: Number(d.total) || 0,
            })),
            acknowledged: ackMatches,
            acknowledgedAt: ackMatches ? ackValue?.acknowledgedAt ?? null : null,
            acknowledgedBy: ackMatches ? ackValue?.acknowledgedBy ?? null : null,
          },
        });
      } catch (error: any) {
        logger.error('coverage drop-alerts failed', error);
        return void res.status(500).json({
          error: error?.message || 'Failed to fetch coverage drop alerts',
        });
      }
    },
  );

  // Acknowledge the most recent coverage drop alert (Task #238). The
  // client passes the `snapshotDate` of the alert it currently sees so
  // we don't accidentally suppress a newer alert that arrived between
  // page load and the click. Acknowledgement is shared across admins
  // and persists until a newer alert (different snapshotDate) shows up.
  app.post(
    '/api/admin/coverage/drop-alerts/acknowledge',
    express.json(),
    requireAdmin,
    async (req, res) => {
      try {
        const body = (req.body ?? {}) as { snapshotDate?: unknown };
        const snapshotDate =
          typeof body.snapshotDate === 'string' && body.snapshotDate.trim().length > 0
            ? body.snapshotDate.trim()
            : null;
        if (!snapshotDate) {
          return void res
            .status(400)
            .json({ error: 'snapshotDate is required' });
        }

        // Confirm the latest alert actually has the snapshotDate the
        // client is acknowledging — otherwise an out-of-date client
        // could silence a freshly-arrived alert.
        const latest = await UserNotification.findOne(
          { type: 'system', 'data.kind': 'coverage_drop' },
          { data: 1 },
        )
          .sort({ 'data.snapshotDate': -1, createdAt: -1 })
          .lean();
        const latestSnapshotDate =
          (latest?.data as { snapshotDate?: string } | undefined)?.snapshotDate ?? null;
        if (!latest || latestSnapshotDate !== snapshotDate) {
          return void res.status(409).json({
            error:
              'A newer coverage drop alert is available; refresh before acknowledging.',
            latestSnapshotDate,
          });
        }

        const adminUsername =
          ((req.session as any)?.adminAuth?.username as string | undefined) ?? null;
        const acknowledgedAt = new Date().toISOString();
        const now = new Date();
        await AdminSetting.findOneAndUpdate(
          { key: COVERAGE_DROP_ACK_KEY },
          {
            $set: {
              value: {
                snapshotDate,
                acknowledgedAt,
                acknowledgedBy: adminUsername,
              },
              updatedAt: now,
              updatedBy: adminUsername,
            },
            $setOnInsert: { createdAt: now, key: COVERAGE_DROP_ACK_KEY },
          },
          { upsert: true, new: true },
        );

        return void res.json({
          acknowledged: true,
          snapshotDate,
          acknowledgedAt,
          acknowledgedBy: adminUsername,
        });
      } catch (error: any) {
        logger.error('coverage drop-alerts acknowledge failed', error);
        return void res.status(500).json({
          error: error?.message || 'Failed to acknowledge coverage drop alert',
        });
      }
    },
  );

  // Re-enqueue the same logo / tag backfill that
  // `scripts/backfill-tr-logos.ts` and `scripts/backfill-tr-tags.ts` run from
  // the CLI, but for any country and from the admin UI. `scope` selects which
  // pipeline(s) to kick off; defaults to running both.
  app.post(
    '/api/admin/coverage/enqueue/:countryCode',
    express.json(),
    requireAdmin,
    async (req, res) => {
      try {
        const rawCode = String(req.params.countryCode || '').trim().toUpperCase();
        if (!rawCode) {
          return void res
            .status(400)
            .json({ success: false, error: 'countryCode is required' });
        }

        const scopeInput =
          typeof req.body?.scope === 'string' ? req.body.scope : 'both';
        const wantLogos = scopeInput === 'logos' || scopeInput === 'both';
        const wantTags = scopeInput === 'tags' || scopeInput === 'both';
        if (!wantLogos && !wantTags) {
          return void res.status(400).json({
            success: false,
            error: "scope must be one of 'logos', 'tags', 'both'",
          });
        }

        cleanupCoverageBackfillJobs();
        const jobId = new mongoose.Types.ObjectId().toString();
        const job: CoverageBackfillJob = {
          jobId,
          countryCode: rawCode,
          scope: scopeInput as 'logos' | 'tags' | 'both',
          status: 'running',
          startedAt: Date.now(),
          cancellable: true,
          cancelRequested: false,
        };
        coverageBackfillJobs.set(jobId, job);

        // Logo enqueue — mirror `backfill-tr-logos.ts` exactly (same filter,
        // same `$unset` so the next scheduled-logo-processor sweep picks the
        // station up). Idempotent: completed assets are excluded. We resolve
        // the matching `_id`s up front so the status endpoint can later
        // count how many of *those specific* stations now have a completed
        // logoAssets record (instead of conflating with unrelated traffic).
        let logoMatched = 0;
        let logoEnqueued = 0;
        let logoEnqueuedIds: string[] = [];
        if (wantLogos) {
          const STALE_PROCESSING_MS = 60 * 60 * 1000;
          const stalePivot = new Date(Date.now() - STALE_PROCESSING_MS);
          const logoFilter: Record<string, unknown> = {
            countryCode: rawCode,
            favicon: { $exists: true, $nin: ['', null, 'null'] },
            slug: { $exists: true, $ne: null },
            $or: [
              { logoAssets: { $exists: false } },
              { 'logoAssets.status': { $exists: false } },
              { 'logoAssets.status': 'pending' },
              {
                'logoAssets.status': 'failed',
                'logoAssets.failureType': {
                  $nin: ['http_error', 'invalid_format'],
                },
              },
              {
                'logoAssets.status': 'failed',
                'logoAssets.failureType': { $exists: false },
              },
              {
                'logoAssets.status': 'processing',
                $or: [
                  { 'logoAssets.lastAttempt': { $lt: stalePivot } },
                  {
                    'logoAssets.lastAttempt': { $exists: false },
                    'logoAssets.processedAt': { $lt: stalePivot },
                  },
                  {
                    'logoAssets.lastAttempt': { $exists: false },
                    'logoAssets.processedAt': { $exists: false },
                  },
                ],
              },
            ],
          };
          const matchedDocs = (await Station.find(logoFilter)
            .select('_id')
            .lean()) as unknown as Array<{ _id: mongoose.Types.ObjectId }>;
          logoMatched = matchedDocs.length;
          logoEnqueuedIds = matchedDocs.map((d) => d._id.toString());
          if (logoEnqueuedIds.length > 0) {
            const result = await Station.updateMany(
              {
                _id: {
                  $in: logoEnqueuedIds.map(
                    (id) => new mongoose.Types.ObjectId(id),
                  ),
                },
              },
              { $unset: { logoAssets: '' } },
            );
            logoEnqueued = result.modifiedCount ?? 0;
          }
          job.logos = {
            matched: logoMatched,
            enqueuedIds: logoEnqueuedIds,
            completed: 0,
            remaining: logoEnqueuedIds.length,
            // Nothing to track → already done so the job can complete
            // immediately rather than sit "running" forever.
            done: logoEnqueuedIds.length === 0,
          };
        }

        // Tags enqueue — fire-and-forget call into the same hydration helper
        // used by `backfill-tr-tags.ts`. The job runs in the background; we
        // return immediately so the admin UI stays responsive.
        let tagsStarted = false;
        if (wantTags) {
          tagsStarted = true;
          job.tags = {
            total: 0,
            processed: 0,
            hydrated: 0,
            emptyUpstream: 0,
            failed: 0,
            done: false,
          };
          void syncService
            .hydrateMissingTagsInBackground({
              countryCode: rawCode,
              // Mirror the default in scripts/backfill-tr-tags.ts so an
              // admin-triggered run produces the same Radio-Browser load
              // shape as the CLI backfill.
              limit: 2000,
              isCancelled: () =>
                coverageBackfillJobs.get(jobId)?.cancelRequested === true,
              onProgress: (p) => {
                const current = coverageBackfillJobs.get(jobId);
                if (!current?.tags) return;
                current.tags.total = p.total;
                current.tags.processed = p.processed;
                current.tags.hydrated = p.hydrated;
                current.tags.emptyUpstream = p.emptyUpstream;
                current.tags.failed = p.failed;
                coverageBackfillJobs.set(jobId, current);
              },
            })
            .then((result) => {
              const current = coverageBackfillJobs.get(jobId);
              if (!current?.tags) return;
              current.tags.total = Math.max(
                current.tags.total,
                result.processed,
              );
              current.tags.processed = result.processed;
              current.tags.hydrated = result.hydrated;
              current.tags.emptyUpstream = result.emptyUpstream;
              current.tags.failed = result.failed;
              current.tags.done = true;
              maybeFinishCoverageJob(current);
              coverageBackfillJobs.set(jobId, current);
            })
            .catch((err) => {
              logger.error(
                `coverage tags enqueue (${rawCode}) failed`,
                err,
              );
              const current = coverageBackfillJobs.get(jobId);
              if (current?.tags) {
                current.tags.done = true;
                current.error =
                  err instanceof Error ? err.message : String(err);
                maybeFinishCoverageJob(current);
                coverageBackfillJobs.set(jobId, current);
              }
            });
        }

        // If both subjobs ended up no-ops (e.g. nothing matched and
        // nothing was started), close the job out immediately.
        maybeFinishCoverageJob(job);
        coverageBackfillJobs.set(jobId, job);

        return void res.json({
          success: true,
          jobId,
          countryCode: rawCode,
          scope: scopeInput,
          logos: wantLogos
            ? { matched: logoMatched, enqueued: logoEnqueued }
            : null,
          tags: wantTags ? { started: tagsStarted } : null,
        });
      } catch (error: any) {
        logger.error('coverage enqueue failed', error);
        return void res.status(500).json({
          success: false,
          error: error?.message || 'Failed to enqueue country backfill',
        });
      }
    },
  );

  // Poll status for a coverage backfill job. The logo subjob has no
  // in-process callback we can hook (the actual processing is done by the
  // scheduled-logo-processor sweeping `logoAssets`-less rows), so we
  // recompute "remaining" lazily here by counting how many of the
  // originally-enqueued station IDs still don't have a completed
  // `logoAssets` record.
  app.get(
    '/api/admin/coverage/enqueue-job-status/:jobId',
    requireAdmin,
    async (req, res) => {
      const { jobId } = req.params as { jobId: string };
      cleanupCoverageBackfillJobs();
      const job = coverageBackfillJobs.get(jobId);
      if (!job) {
        return void res
          .status(404)
          .json({ success: false, error: 'Job not found' });
      }
      if (job.logos && !job.logos.done && job.logos.enqueuedIds.length > 0) {
        try {
          const completed = await Station.countDocuments({
            _id: {
              $in: job.logos.enqueuedIds.map(
                (id) => new mongoose.Types.ObjectId(id),
              ),
            },
            'logoAssets.status': 'completed',
          });
          job.logos.completed = completed;
          job.logos.remaining = Math.max(
            job.logos.enqueuedIds.length - completed,
            0,
          );
          if (job.logos.remaining === 0) {
            job.logos.done = true;
            maybeFinishCoverageJob(job);
          }
          coverageBackfillJobs.set(jobId, job);
        } catch (err) {
          logger.error('coverage logo progress recompute failed', err);
        }
      }
      // Sanity ceiling: if a job has been "running" for >2h it almost
      // certainly missed a finish signal (e.g. logo processor lagged or a
      // station was deleted). Mark it complete so the UI doesn't spin
      // forever and the row goes back to its normal coverage display.
      const MAX_RUN_MS = 2 * 60 * 60 * 1000;
      if (job.status === 'running' && Date.now() - job.startedAt > MAX_RUN_MS) {
        if (job.logos) job.logos.done = true;
        if (job.tags) job.tags.done = true;
        maybeFinishCoverageJob(job);
        coverageBackfillJobs.set(jobId, job);
      }
      // Don't ship the full enqueuedIds array on every poll — it can be
      // a few thousand strings per country.
      const { logos, ...rest } = job;
      return void res.json({
        success: true,
        job: {
          ...rest,
          logos: logos
            ? {
                matched: logos.matched,
                enqueued: logos.enqueuedIds.length,
                completed: logos.completed,
                remaining: logos.remaining,
                done: logos.done,
              }
            : undefined,
        },
      });
    },
  );

  // Cancel a running country backfill. The tags subjob's
  // `hydrateMissingTagsInBackground` polls `cancelRequested` between
  // batches and exits cleanly; the logo subjob's actual processing is
  // handled out-of-process by the scheduled-logo-processor, so we can't
  // truly abort an in-flight favicon download — but we mark the logo
  // bucket done so the job can transition to `cancelled` and the UI
  // indicator clears, matching the recheck-tags cancel flow.
  app.post(
    '/api/admin/coverage/enqueue-job-cancel/:jobId',
    requireAdmin,
    async (req, res) => {
      const { jobId } = req.params as { jobId: string };
      const job = coverageBackfillJobs.get(jobId);
      if (!job) {
        return void res
          .status(404)
          .json({ success: false, error: 'Job not found' });
      }
      if (job.status !== 'running') {
        return void res.json({ success: true, alreadyFinished: true });
      }
      if (!job.cancellable) {
        return void res
          .status(409)
          .json({ success: false, error: 'Job is not cancellable' });
      }
      job.cancelRequested = true;
      // Logo processing happens in the out-of-process scheduled sweeper —
      // we can't pull stations back off its queue, so the most we can do
      // is stop tracking remaining work and let the job transition.
      if (job.logos && !job.logos.done) {
        job.logos.done = true;
      }
      // If tags weren't started or already finished, the cancel flag has
      // nothing to poll; transition immediately.
      if (!job.tags || job.tags.done) {
        maybeFinishCoverageJob(job);
      }
      coverageBackfillJobs.set(jobId, job);
      logger.log(
        `🛑 Coverage backfill ${jobId} (${job.countryCode}) cancellation requested`,
      );
      return void res.json({ success: true });
    },
  );

  // Re-run the historical sparkline reconstruction (Task #237). Mirrors
  // `scripts/backfill-coverage-snapshots.ts` but invokable from the
  // admin coverage page so admins can re-seed history after a bulk
  // import without shell access. Idempotent: real cron-written rows are
  // preserved by `$setOnInsert`. Reconstructed rows are tagged with
  // `source: 'backfill'` and the nightly cron promotes them to `'cron'`
  // as days roll over.
  app.post(
    '/api/admin/coverage/reconstruct-history',
    express.json(),
    requireAdmin,
    async (req, res) => {
      try {
        const rawDays = req.body?.days;
        const daysNum = rawDays === undefined ? 30 : Number(rawDays);
        if (!Number.isFinite(daysNum) || !Number.isInteger(daysNum) || daysNum < 1 || daysNum > 365) {
          return void res.status(400).json({
            success: false,
            error: 'days must be an integer between 1 and 365',
          });
        }
        const dryRun = req.body?.dryRun === true;
        const result = await runCoverageBackfill({ days: daysNum, dryRun });
        return void res.json({ success: true, days: daysNum, dryRun, ...result });
      } catch (error: any) {
        logger.error('coverage reconstruct-history failed', error);
        return void res.status(500).json({
          success: false,
          error: error?.message || 'Failed to reconstruct sparkline history',
        });
      }
    },
  );
}
