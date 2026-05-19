import type { Express } from "express";
import { Station, User, UserFollow, BlacklistedStation, UserFavorite, UserNotification } from '@workspace/db-shared/mongo-schemas';
import { logger } from "../utils/logger";
import { normalizeCountryFilter } from "../utils/normalize-country";
import { syncService } from "../services/sync";
import { PrecomputedStationsService } from "../services/precomputed-stations";
import { logoProcessor } from "../services/logo-processor";
import { isS3Configured } from "../services/s3-storage";
import { IndexNowService } from "../services/indexnow";
import { ObjectStorageService } from "../objectStorage";
import CacheManager from "../cache";

interface RouteDeps {
  requireAuth: any;
  requireAdmin: any;
  stripPlaceholders: (obj: any) => any;
}

export function registerLogoRoutes(app: Express, deps: RouteDeps) {
  const { requireAdmin } = deps;

  // ===== BULK LOGO PROCESSING ENDPOINTS =====
  
  // In-memory logo processing job tracking with per-station results
  interface StationResult {
    stationId: string;
    stationName: string;
    status: 'success' | 'failed';
    error?: string;
  }
  
  const logoProcessingJobs = new Map<string, {
    jobId: string;
    status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
    total: number;
    processed: number;
    successful: number;
    failed: number;
    startedAt: Date;
    completedAt?: Date;
    error?: string;
    results: StationResult[];
  }>();

  // Evict terminal-state jobs older than 1 hour — prevents map from growing forever
  // across many admin bulk-processing invocations. Also caps per-job results array
  // size at 2000 so a single job cannot use unbounded memory.
  const LOGO_JOB_RESULTS_MAX = 2000;
  const LOGO_JOB_RETENTION_MS = 60 * 60 * 1000;
  setInterval(() => {
    const now = Date.now();
    for (const [jobId, job] of logoProcessingJobs) {
      const terminal = job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled';
      const completedAt = job.completedAt ? job.completedAt.getTime() : 0;
      if (terminal && completedAt > 0 && (now - completedAt) > LOGO_JOB_RETENTION_MS) {
        logoProcessingJobs.delete(jobId);
      }
    }
  }, 10 * 60 * 1000).unref();
  
  // Get logo processing statistics
  app.get("/api/admin/logos/stats", requireAdmin, async (req, res) => {
    try {
      const [
        totalStations,
        stationsWithFavicon,
        stationsWithSlug,
        stationsWithLogoAssets,
        stationsFailed,
        stationsNotProcessed,
        stationsWithoutLogo,
        stationsNoFavicon,
      ] = await Promise.all([
        Station.countDocuments(),
        Station.countDocuments({ favicon: { $exists: true, $nin: ['', null, 'null'] } }),
        Station.countDocuments({ slug: { $exists: true, $ne: null } }),
        Station.countDocuments({ 'logoAssets.status': 'completed' }),
        Station.countDocuments({ 'logoAssets.status': 'failed' }),
        Station.countDocuments({
          favicon: { $exists: true, $nin: ['', null, 'null'] },
          $or: [
            { 'logoAssets.status': { $exists: false } },
            { logoAssets: { $exists: false } },
            { 'logoAssets.status': 'pending' },
            { 'logoAssets.status': 'processing' },
          ]
        }),
        // ANY station that does not currently serve from S3 ("logo eksik").
        // Includes failed processing, not-yet-processed, and stations without
        // a favicon URL at all. The frontend modal lets admin filter further.
        Station.countDocuments({
          $or: [
            { logoAssets: { $exists: false } },
            { 'logoAssets.status': { $exists: false } },
            { 'logoAssets.status': { $ne: 'completed' } },
          ]
        }),
        // Subset: stations that have NO favicon URL — backfill cannot help
        // these without manually entering a logo URL.
        Station.countDocuments({
          $or: [
            { favicon: { $exists: false } },
            { favicon: { $in: ['', null, 'null'] } },
          ]
        }),
      ]);

      res.json({
        totalStations,
        stationsWithFavicon,
        stationsWithSlug,
        stationsWithLogoAssets,
        stationsFailed,
        stationsNeedingProcessing: stationsNotProcessed,
        stationsWithoutLogo,
        stationsNoFavicon,
        processingComplete: stationsNotProcessed === 0,
        s3Configured: isS3Configured(),
      });
    } catch (error: any) {
      console.error('Error getting logo stats:', error);
      res.status(500).json({ error: 'Failed to get logo statistics' });
    }
  });

  // List stations WITHOUT an S3-optimized logo (for SEO/QA review). Supports
  // pagination + status filter (any | failed | pending | no_favicon) +
  // optional ISO country filter. Used by the admin "Logo eksik istasyonlar"
  // modal so SEO ops can spot-check + decide whether to fix favicon URLs by
  // hand or blacklist the station.
  app.get("/api/admin/logos/missing", requireAdmin, async (req, res) => {
    try {
      const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
      const limit = Math.min(200, Math.max(1, parseInt((req.query.limit as string) || '50', 10)));
      const skip = (page - 1) * limit;
      const status = String(req.query.status || 'any').toLowerCase();
      const countryCode = typeof req.query.countryCode === 'string'
        ? req.query.countryCode.trim().toUpperCase()
        : '';

      const filter: any = {};
      if (status === 'failed') {
        filter['logoAssets.status'] = 'failed';
      } else if (status === 'pending') {
        filter.$or = [
          { logoAssets: { $exists: false } },
          { 'logoAssets.status': { $exists: false } },
          { 'logoAssets.status': 'pending' },
          { 'logoAssets.status': 'processing' },
        ];
        filter.favicon = { $exists: true, $nin: ['', null, 'null'] };
      } else if (status === 'no_favicon') {
        filter.$or = [
          { favicon: { $exists: false } },
          { favicon: { $in: ['', null, 'null'] } },
        ];
      } else {
        filter.$or = [
          { logoAssets: { $exists: false } },
          { 'logoAssets.status': { $exists: false } },
          { 'logoAssets.status': { $ne: 'completed' } },
        ];
      }

      if (countryCode && /^[A-Z]{2}$/.test(countryCode)) {
        filter.countryCode = countryCode;
      }

      const [stations, total] = await Promise.all([
        Station.find(filter)
          .select('_id name slug favicon country countryCode logoAssets updatedAt')
          .sort({ updatedAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Station.countDocuments(filter),
      ]);

      res.json({
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        stations: stations.map((s: any) => ({
          _id: String(s._id),
          name: s.name,
          slug: s.slug,
          favicon: s.favicon || null,
          country: s.country || null,
          countryCode: s.countryCode || null,
          logoStatus: s.logoAssets?.status || (s.favicon ? 'pending' : 'no_favicon'),
          logoError: s.logoAssets?.error || null,
          updatedAt: s.updatedAt,
        })),
      });
    } catch (error: any) {
      console.error('Error listing missing-logo stations:', error);
      res.status(500).json({ error: 'Failed to list missing-logo stations' });
    }
  });

  // Get list of optimized stations with pagination
  app.get("/api/admin/logos/optimized", requireAdmin, async (req, res) => {
    try {
      const page = parseInt((req.query.page as string) || '1', 10);
      const limit = 50;
      const skip = (page - 1) * limit;
      
      const stations = await Station.find({ 'logoAssets.status': 'completed' })
        .select('name slug logoAssets')
        .skip(skip)
        .limit(limit)
        .lean();
      
      const total = await Station.countDocuments({ 'logoAssets.status': 'completed' });
      
      res.json({
        stations: stations.map((s: any) => ({
          _id: s._id,
          name: s.name,
          slug: s.slug,
          logoAssets: s.logoAssets
        })),
        total
      });
    } catch (error: any) {
      console.error('Error fetching optimized stations:', error);
      res.status(500).json({ error: 'Failed to fetch optimized stations' });
    }
  });
  
  // Start bulk logo processing job
  app.post("/api/admin/logos/process-all", requireAdmin, async (req, res) => {
    try {
      const { limit = 500 } = (req.body ?? {}) as { limit?: number };
      
      // Check for existing running job
      for (const [id, job] of logoProcessingJobs.entries()) {
        if (job.status === 'running') {
          return void res.json({ 
            success: false, 
            message: 'A logo processing job is already running',
            jobId: id
          });
        }
      }
      
      const stationsNeedingProcessing = await Station.countDocuments({
        favicon: { $exists: true, $nin: ['', null, 'null'] },
        slug: { $exists: true, $ne: null },
        $or: [
          { 'logoAssets.status': { $exists: false } },
          { logoAssets: { $exists: false } },
          { 'logoAssets.status': 'pending' },
          { 'logoAssets.status': 'processing' },
        ]
      });
      
      if (stationsNeedingProcessing === 0) {
        return void res.json({ 
          success: true, 
          message: 'All logos are already processed',
          processed: 0
        });
      }
      
      // Create job - will process ALL stations continuously
      const jobId = `logo-${Date.now()}`;
      
      logoProcessingJobs.set(jobId, {
        jobId,
        status: 'running',
        total: stationsNeedingProcessing, // Process ALL stations
        processed: 0,
        successful: 0,
        failed: 0,
        startedAt: new Date(),
        results: []  // Initialize empty results array for per-station tracking
      });
      
      // Return immediately with job ID
      res.json({
        success: true,
        message: 'Logo processing started - will process ALL stations',
        jobId,
        totalToProcess: stationsNeedingProcessing
      });
      
      const needsProcessingFilter = {
        favicon: { $exists: true, $nin: ['', null, 'null'] },
        $or: [
          { 'logoAssets.status': { $exists: false } },
          { logoAssets: { $exists: false } },
          { 'logoAssets.status': 'pending' as const },
          { 'logoAssets.status': 'processing' as const },
        ]
      };
      
      const MAX_RECENT_RESULTS = 50;
      const CONCURRENT_SIZE = 5;
      const BATCH_FETCH_SIZE = 100;
      const DELAY_BETWEEN_BATCHES_MS = 300;
      const DELAY_BETWEEN_ROUNDS_MS = 500;

      setImmediate(async () => {
        const job = logoProcessingJobs.get(jobId)!;
        let totalProcessedOverall = 0;
        let totalSuccessful = 0;
        let totalFailed = 0;
        let roundNumber = 0;
        
        try {
          while (true) {
            const currentJob = logoProcessingJobs.get(jobId);
            if (currentJob?.status === 'cancelled' || currentJob?.status === 'paused') {
              logger.log(`⏹️ Logo processing stopped by user after ${totalProcessedOverall} stations`);
              break;
            }
            
            roundNumber++;
            const stations = await Station.find(needsProcessingFilter)
              .select('_id name slug favicon')
              .limit(BATCH_FETCH_SIZE)
              .lean();
            
            if (stations.length === 0) {
              logger.log(`🎉 ALL LOGOS PROCESSED! Total: ${totalProcessedOverall} (${totalSuccessful} successful, ${totalFailed} failed)`);
              break;
            }
            
            logger.log(`📦 Round ${roundNumber}: Processing ${stations.length} stations...`);
            
            for (let i = 0; i < stations.length; i += CONCURRENT_SIZE) {
              const checkJob = logoProcessingJobs.get(jobId);
              if (checkJob?.status === 'cancelled' || checkJob?.status === 'paused') break;
              
              const batch = stations.slice(i, i + CONCURRENT_SIZE);
              const batchPromises = batch.map(async (station) => {
                try {
                  if (!station.favicon || !station.slug) {
                    await Station.updateOne(
                      { _id: station._id },
                      { $set: { 'logoAssets.status': 'failed', 'logoAssets.error': 'Missing favicon or slug', 'logoAssets.failureType': 'invalid_format' } }
                    );
                    return { stationId: station._id.toString(), stationName: station.name, status: 'failed' as const, error: 'Missing favicon or slug' };
                  }
                  const result = await logoProcessor.processFromUrl(station._id.toString(), station.slug, station.favicon);
                  if (result.success) {
                    return { stationId: station._id.toString(), stationName: station.name, status: 'success' as const };
                  } else {
                    return { stationId: station._id.toString(), stationName: station.name, status: 'failed' as const, error: result.error };
                  }
                } catch (error: any) {
                  return { stationId: station._id.toString(), stationName: station.name, status: 'failed' as const, error: error.message };
                }
              });
              
              const results = await Promise.allSettled(batchPromises);
              for (const result of results) {
                totalProcessedOverall++;
                job.processed = totalProcessedOverall;
                if (result.status === 'fulfilled') {
                  if (job.results.length >= MAX_RECENT_RESULTS) {
                    job.results.shift();
                  }
                  job.results.push(result.value); if (job.results.length > LOGO_JOB_RESULTS_MAX) job.results.shift();
                  if (result.value.status === 'success') {
                    totalSuccessful++;
                    job.successful = totalSuccessful;
                  } else {
                    totalFailed++;
                    job.failed = totalFailed;
                  }
                } else {
                  totalFailed++;
                  job.failed = totalFailed;
                }
              }
              logoProcessingJobs.set(jobId, job);
              await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES_MS));
            }
            
            if (roundNumber % 5 === 0) {
              const remaining = await Station.countDocuments(needsProcessingFilter);
              const heapMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
              logger.log(`📊 Round ${roundNumber}: ${totalProcessedOverall} done, ${remaining} remaining, heap: ${heapMB}MB`);
              if (typeof global.gc === 'function') global.gc();
            }
            await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_ROUNDS_MS));
          }
          
          job.status = 'completed';
          job.completedAt = new Date();
          logoProcessingJobs.set(jobId, job);
          logger.log(`✅ Logo processing COMPLETE: ${totalSuccessful} successful, ${totalFailed} failed out of ${totalProcessedOverall} total`);
          
        } catch (error: any) {
          job.status = 'failed';
          job.error = error.message;
          job.completedAt = new Date();
          logoProcessingJobs.set(jobId, job);
          logger.log(`❌ Logo processing job ${jobId} failed: ${error.message}`);
        }
      });
    } catch (error: any) {
      console.error('Error starting logo processing:', error);
      res.status(500).json({ error: 'Failed to start logo processing' });
    }
  });
  
  app.post("/api/admin/logos/reprocess-all", requireAdmin, async (req, res) => {
    try {
      for (const [id, job] of logoProcessingJobs.entries()) {
        if (job.status === 'running') {
          return void res.json({ 
            success: false, 
            message: 'A logo processing job is already running',
            jobId: id
          });
        }
      }

      const totalWithFavicon = await Station.countDocuments({
        favicon: { $exists: true, $nin: ['', null, 'null'] },
        slug: { $exists: true, $ne: null }
      });

      if (totalWithFavicon === 0) {
        return void res.json({ success: true, message: 'No stations with favicons found', processed: 0 });
      }

      const RESET_BATCH = 5000;
      let resetSkip = 0;
      let totalReset = 0;
      while (true) {
        const stationIds = await Station.find(
          { favicon: { $exists: true, $nin: ['', null, 'null'] } },
          { _id: 1 }
        ).skip(resetSkip).limit(RESET_BATCH).lean();
        if (stationIds.length === 0) break;
        await Station.updateMany(
          { _id: { $in: stationIds.map((s: any) => s._id) } },
          { $unset: { logoAssets: '' } }
        );
        totalReset += stationIds.length;
        resetSkip += RESET_BATCH;
        await new Promise(r => setTimeout(r, 100));
      }

      logger.log(`🔄 REPROCESS ALL: Reset logoAssets for ${totalReset} stations. Starting fresh processing...`);

      const jobId = `logo-reprocess-${Date.now()}`;

      logoProcessingJobs.set(jobId, {
        jobId,
        status: 'running',
        total: totalWithFavicon,
        processed: 0,
        successful: 0,
        failed: 0,
        startedAt: new Date(),
        results: []
      });

      res.json({
        success: true,
        message: `Reprocessing ALL ${totalWithFavicon} station logos from scratch`,
        jobId,
        totalToProcess: totalWithFavicon
      });

      const needsProcessingFilter = {
        favicon: { $exists: true, $nin: ['', null, 'null'] },
        slug: { $exists: true, $ne: null },
        $or: [
          { 'logoAssets.status': { $exists: false } },
          { logoAssets: { $exists: false } },
          { 'logoAssets.status': 'pending' as const },
          { 'logoAssets.status': 'processing' as const },
        ]
      };

      const MAX_RECENT_RESULTS = 50;
      const CONCURRENT_SIZE = 5;
      const BATCH_FETCH_SIZE = 100;
      const DELAY_BETWEEN_BATCHES_MS = 300;
      const DELAY_BETWEEN_ROUNDS_MS = 500;

      setImmediate(async () => {
        const job = logoProcessingJobs.get(jobId)!;
        let totalProcessedOverall = 0;
        let totalSuccessful = 0;
        let totalFailed = 0;
        let roundNumber = 0;

        try {
          while (true) {
            const currentJob = logoProcessingJobs.get(jobId);
            if (currentJob?.status === 'cancelled' || currentJob?.status === 'paused') {
              logger.log(`⏹️ Logo reprocessing stopped by user after ${totalProcessedOverall} stations`);
              break;
            }

            roundNumber++;
            const stations = await Station.find(needsProcessingFilter)
              .select('_id name slug favicon')
              .limit(BATCH_FETCH_SIZE)
              .lean();

            if (stations.length === 0) {
              logger.log(`🎉 ALL LOGOS REPROCESSED! Total: ${totalProcessedOverall} (${totalSuccessful} successful, ${totalFailed} failed)`);
              break;
            }

            logger.log(`📦 Reprocess Round ${roundNumber}: Processing ${stations.length} stations...`);

            for (let i = 0; i < stations.length; i += CONCURRENT_SIZE) {
              const checkJob = logoProcessingJobs.get(jobId);
              if (checkJob?.status === 'cancelled' || checkJob?.status === 'paused') break;

              const batch = stations.slice(i, i + CONCURRENT_SIZE);
              const batchPromises = batch.map(async (station) => {
                try {
                  if (!station.favicon || !station.slug) {
                    await Station.updateOne(
                      { _id: station._id },
                      { $set: { 'logoAssets.status': 'failed', 'logoAssets.error': 'Missing favicon or slug', 'logoAssets.failureType': 'invalid_format' } }
                    );
                    return { stationId: station._id.toString(), stationName: station.name, status: 'failed' as const, error: 'Missing favicon or slug' };
                  }
                  const result = await logoProcessor.processFromUrl(station._id.toString(), station.slug, station.favicon);
                  if (result.success) {
                    return { stationId: station._id.toString(), stationName: station.name, status: 'success' as const };
                  } else {
                    return { stationId: station._id.toString(), stationName: station.name, status: 'failed' as const, error: result.error };
                  }
                } catch (error: any) {
                  return { stationId: station._id.toString(), stationName: station.name, status: 'failed' as const, error: error.message };
                }
              });

              const results = await Promise.allSettled(batchPromises);
              for (const result of results) {
                totalProcessedOverall++;
                job.processed = totalProcessedOverall;
                if (result.status === 'fulfilled') {
                  if (job.results.length >= MAX_RECENT_RESULTS) {
                    job.results.shift();
                  }
                  job.results.push(result.value); if (job.results.length > LOGO_JOB_RESULTS_MAX) job.results.shift();
                  if (result.value.status === 'success') {
                    totalSuccessful++;
                    job.successful = totalSuccessful;
                  } else {
                    totalFailed++;
                    job.failed = totalFailed;
                  }
                } else {
                  totalFailed++;
                  job.failed = totalFailed;
                }
              }
              logoProcessingJobs.set(jobId, job);
              await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES_MS));
            }

            if (roundNumber % 5 === 0) {
              const remaining = await Station.countDocuments(needsProcessingFilter);
              const heapMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
              logger.log(`📊 Reprocess Round ${roundNumber}: ${totalProcessedOverall} done, ${remaining} remaining, heap: ${heapMB}MB`);
              if (typeof global.gc === 'function') global.gc();
            }
            await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_ROUNDS_MS));
          }

          job.status = 'completed';
          job.completedAt = new Date();
          logoProcessingJobs.set(jobId, job);
          logger.log(`✅ Logo REPROCESSING COMPLETE: ${totalSuccessful} successful, ${totalFailed} failed out of ${totalProcessedOverall} total`);
        } catch (error: any) {
          job.status = 'failed';
          job.error = error.message;
          job.completedAt = new Date();
          logoProcessingJobs.set(jobId, job);
          logger.log(`❌ Logo reprocessing job ${jobId} failed: ${error.message}`);
        }
      });
    } catch (error: any) {
      console.error('Error starting logo reprocessing:', error);
      res.status(500).json({ error: 'Failed to start logo reprocessing' });
    }
  });

  app.get("/api/admin/logos/active-job", requireAdmin, async (req, res) => {
    for (const [id, job] of logoProcessingJobs.entries()) {
      if (job.status === 'running') {
        return void res.json({ hasActiveJob: true, job });
      }
    }
    return void res.json({ hasActiveJob: false });
  });

  app.get("/api/admin/logos/job-status/:jobId", requireAdmin, async (req, res) => {
    const jobId = req.params.jobId;
    const job = logoProcessingJobs.get(jobId);
    
    if (!job) {
      const completedCount = await Station.countDocuments({ 'logoAssets.status': 'completed' });
      const failedCount = await Station.countDocuments({ 'logoAssets.status': 'failed' });
      return void res.json({
        jobId,
        status: 'lost',
        message: 'Job lost after server restart. Check stats for current progress.',
        processed: completedCount + failedCount,
        successful: completedCount,
        failed: failedCount,
        total: completedCount + failedCount,
        results: []
      });
    }
    
    res.json(job);
  });
  
  // Cancel logo processing job
  app.post("/api/admin/logos/job/:jobId/cancel", requireAdmin, async (req, res) => {
    const jobId = req.params.jobId;
    const job = logoProcessingJobs.get(jobId);
    
    if (!job) {
      return void res.status(404).json({ error: 'Job not found' });
    }
    
    job.status = 'cancelled';
    job.completedAt = new Date();
    logoProcessingJobs.set(jobId, job);
    
    logger.log(`🛑 Logo processing job ${jobId} cancelled`);
    
    res.json({ 
      success: true, 
      message: 'Job cancelled',
      processed: job.processed,
      successful: job.successful,
      failed: job.failed
    });
  });
}
