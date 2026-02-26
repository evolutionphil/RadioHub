import type { Express } from "express";
import { Station, User, UserFollow, BlacklistedStation, UserFavorite, UserNotification } from "../../shared/mongo-schemas";
import { logger } from "../utils/logger";
import { normalizeCountryFilter } from "../utils/normalize-country";
import { syncService } from "../services/sync";
import { PrecomputedStationsService } from "../services/precomputed-stations";
import { logoProcessor } from "../services/logo-processor";
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
  
  // Get logo processing statistics
  app.get("/api/admin/logos/stats", requireAdmin, async (req, res) => {
    try {
      const [
        totalStations,
        stationsWithFavicon,
        stationsWithSlug,
        stationsWithLogoAssets,
        stationsNeedingProcessing
      ] = await Promise.all([
        Station.countDocuments(),
        Station.countDocuments({ favicon: { $exists: true, $nin: ['', null, 'null'] } }),
        Station.countDocuments({ slug: { $exists: true, $ne: null } }),
        Station.countDocuments({ 'logoAssets.status': 'completed' }),
        Station.countDocuments({
          favicon: { $exists: true, $nin: ['', null, 'null'] },
          slug: { $exists: true, $ne: null },
          $or: [
            { 'logoAssets.status': { $exists: false } },  // Never processed
            { 'logoAssets.status': 'pending' }             // Still pending
          ],
          'logoAssets.status': { $ne: 'failed' }           // Skip failed - never retry
        })
      ]);
      
      res.json({
        totalStations,
        stationsWithFavicon,
        stationsWithSlug,
        stationsWithLogoAssets,
        stationsNeedingProcessing,
        processingComplete: stationsNeedingProcessing === 0
      });
    } catch (error: any) {
      console.error('Error getting logo stats:', error);
      res.status(500).json({ error: 'Failed to get logo statistics' });
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
      const { limit = 500 } = req.body;
      
      // Check for existing running job
      for (const [id, job] of logoProcessingJobs.entries()) {
        if (job.status === 'running') {
          return res.json({ 
            success: false, 
            message: 'A logo processing job is already running',
            jobId: id
          });
        }
      }
      
      // Count stations needing processing (skip permanent failures like 404, invalid_format)
      const stationsNeedingProcessing = await Station.countDocuments({
        favicon: { $exists: true, $nin: ['', null, 'null'] },
        slug: { $exists: true, $ne: null },
        $or: [
          { 'logoAssets.status': { $exists: false } },
          { 'logoAssets.status': 'pending' },
          // Only retry temporary failures (timeout, download_failed, processing_failed)
          // Skip permanent failures (http_error = 404/403, invalid_format = SVG/HTML)
          { 
            'logoAssets.status': 'failed',
            'logoAssets.failureType': { $nin: ['http_error', 'invalid_format'] }
          },
          // Also retry old failures without failureType (legacy)
          {
            'logoAssets.status': 'failed',
            'logoAssets.failureType': { $exists: false }
          }
        ]
      });
      
      if (stationsNeedingProcessing === 0) {
        return res.json({ 
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
      
      // Query filter for stations needing processing
      // IMPORTANT: Skip all previously failed stations - never retry them!
      // Only process unprocessed stations or those still pending
      const needsProcessingFilter = {
        favicon: { $exists: true, $nin: ['', null, 'null'] },
        slug: { $exists: true, $ne: null },
        $or: [
          { 'logoAssets.status': { $exists: false } },     // Never processed before
          { 'logoAssets.status': 'pending' }               // Marked as pending
        ],
        'logoAssets.status': { $ne: 'failed' }             // Explicitly skip ALL failed stations
      };
      
      // Process in background with CONTINUOUS LOOP until all done
      setImmediate(async () => {
        const job = logoProcessingJobs.get(jobId)!;
        const batchFetchSize = 500; // Fetch 500 at a time from DB
        const concurrentSize = 10; // Process 10 concurrently
        let totalProcessedOverall = 0;
        let totalSuccessful = 0;
        let totalFailed = 0;
        let roundNumber = 0;
        
        try {
          // CONTINUOUS LOOP - keep fetching batches until none remain
          while (true) {
            // Check if job was cancelled
            const currentJob = logoProcessingJobs.get(jobId);
            if (currentJob?.status === 'cancelled' || currentJob?.status === 'paused') {
              logger.log(`⏹️ Logo processing stopped by user after ${totalProcessedOverall} stations`);
              break;
            }
            
            // Fetch next batch of stations
            roundNumber++;
            const stations = await Station.find(needsProcessingFilter)
              .limit(batchFetchSize)
              .lean();
            
            // If no more stations, we're done
            if (stations.length === 0) {
              logger.log(`🎉 ALL LOGOS PROCESSED! Total: ${totalProcessedOverall} (${totalSuccessful} successful, ${totalFailed} failed)`);
              break;
            }
            
            logger.log(`📦 Round ${roundNumber}: Processing ${stations.length} stations...`);
            
            // Process stations in concurrent batches
            for (let i = 0; i < stations.length; i += concurrentSize) {
              // Check cancellation frequently
              const checkJob = logoProcessingJobs.get(jobId);
              if (checkJob?.status === 'cancelled' || checkJob?.status === 'paused') {
                break;
              }
              
              const batch = stations.slice(i, i + concurrentSize);
              
              const batchPromises = batch.map(async (station) => {
                try {
                  if (!station.favicon || !station.slug) {
                    return { stationId: station._id.toString(), stationName: station.name, status: 'failed' as const, error: 'Missing favicon or slug' };
                  }
                  
                  const result = await logoProcessor.processFromUrl(
                    station._id.toString(),
                    station.slug,
                    station.favicon
                  );
                  
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
              
              results.forEach(result => {
                totalProcessedOverall++;
                job.processed = totalProcessedOverall;
                if (result.status === 'fulfilled') {
                  job.results.push(result.value);
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
                  job.results.push({ stationId: 'unknown', stationName: 'unknown', status: 'failed', error: 'Promise rejected' });
                }
              });
              
              logoProcessingJobs.set(jobId, job);
              
              // Small delay between concurrent batches to prevent overwhelming
              await new Promise(resolve => setTimeout(resolve, 500));
            }
            
            // Log progress after each round
            const remaining = await Station.countDocuments(needsProcessingFilter);
            logger.log(`📊 Round ${roundNumber} complete: ${totalProcessedOverall} processed so far, ${remaining} remaining`);
            
            // Brief pause between rounds
            await new Promise(resolve => setTimeout(resolve, 1000));
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
  
  // Get logo processing job status
  app.get("/api/admin/logos/job-status/:jobId", requireAdmin, async (req, res) => {
    const jobId = req.params.jobId;
    const job = logoProcessingJobs.get(jobId);
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    res.json(job);
  });
  
  // Cancel logo processing job
  app.post("/api/admin/logos/job/:jobId/cancel", requireAdmin, async (req, res) => {
    const jobId = req.params.jobId;
    const job = logoProcessingJobs.get(jobId);
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
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
