import type { Express } from "express";
import { pgCatalog } from '../data/postgres-catalog-store';
import { pgSaveDescriptionJob, pgReadDescriptionJob } from '../data/postgres-runtime-operations';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { SITEMAP_PRIORITY_LANGUAGES } from '@workspace/seo-shared/seo-config';
import { getPostgresCoordinationPool } from '../postgres-runtime';
import { fillMissingStationDescriptions } from '../services/fill-missing-station-descriptions';
import { pgAdminDescriptionCoverage, pgDescriptionRepairStationIds } from '../data/postgres-admin-catalog-store';
import { logger } from "../utils/logger";
import { stripPlaceholders } from "./shared-utils";
import { performanceCache } from "../performance-cache";

export async function registerAiDescriptionRoutes(app: Express, deps: any) {
  const { requireAdmin } = deps;

  // AI STATION DESCRIPTION GENERATION ENDPOINTS
  const { generateStationDescription } = await import('../services/ai-station-description');
  
  // Cap per-job result arrays to prevent unbounded memory growth on long-running jobs
  // (e.g. 40k-station batches would otherwise keep every result object in memory forever).
  const JOB_RESULT_ARRAY_MAX = 500;
  const pushLimited = <T>(arr: T[], item: T): void => {
    arr.push(item);
    if (arr.length > JOB_RESULT_ARRAY_MAX) arr.shift();
  };

  const descriptionJobs = new Map<string, {
    jobId: string;
    status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
    total: number;
    processed: number;
    successful: number;
    failed: number;
    skipped: number;
    currentStation: string;
    currentAction: 'generating' | 'translating' | 'saving' | 'idle' | 'analyzing';
    currentLanguage?: string;
    targetLanguages: string[];
    startedAt: Date;
    completedAt?: Date;
    error?: string;
    successfulStations: Array<{ name: string; languages: string[] }>;
    skippedStations: Array<{ name: string; reason: string }>;
    failedStations: Array<{ name: string; error: string }>;
    lastProcessedStationId?: string;
    lastProcessedSkip?: number;
    updatedAt?: Date;
    publishStatus?: 'pending' | 'completed' | 'failed' | 'not-needed';
  }>();

  setInterval(() => {
    const now = Date.now();
    for (const [jobId, job] of descriptionJobs) {
      if ((job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled' || job.status === 'paused') &&
          job.completedAt && (now - job.completedAt.getTime()) > 30 * 60 * 1000) {
        descriptionJobs.delete(jobId);
      }
    }
  }, 10 * 60 * 1000);

  // Single station AI description generation
  app.post("/api/admin/stations/:id/generate-description", requireAdmin, async (req, res) => {
    try {
      const stationId = req.params.id;
      const { language } = req.body; // Optional: override auto-detected language
      
      const station = await pgCatalog().findOne({ _id: stationId });
      if (!station) {
        return void res.status(404).json({ error: 'Station not found' });
      }
      
      logger.log(`🤖 [DEBUG] Generating AI description for station: ${station.name} (${station.countryCode})`);
      
      const result = await generateStationDescription(station as any, language);
      
      logger.log(`🤖 [DEBUG] AI Result for ${station.name}:`, {
        success: result.success,
        language: result.language,
        descriptionLength: (result as any).fullDescription?.length || 0,
        descriptionPreview: (result as any).fullDescription?.substring(0, 100) || 'NO DESCRIPTION',
        usedFallback: result.usedFallback,
        error: result.error
      });
      
      // Save if we have BOTH full description and meta description
      if (result.fullDescription && result.metaDescription) {
        logger.log(`💾 Saving both full (${result.fullDescription.length} chars) and meta (${result.metaDescription.length} chars) for "${station.name}"`);
        
        const updateResult = await pgCatalog().update({ _id: stationId }, {
            $set: { 
              [`descriptions.${result.language}`]: {
                full: result.fullDescription,
                meta: result.metaDescription
              }
            } 
          });
        
        if (updateResult.modifiedCount > 0 && station.slug) {
          performanceCache.invalidateStationCache(station.slug);
        }
        res.json({
          success: true,
          fullDescriptionLength: result.fullDescription.length,
          metaDescriptionLength: result.metaDescription.length,
          language: result.language,
          usedFallback: result.usedFallback || false,
          saved: updateResult.modifiedCount > 0
        });
      } else {
        res.json({
          success: false,
          error: result.error || 'Failed to generate descriptions',
          language: result.language,
          usedFallback: true
        });
      }
      
    } catch (error: any) {
      logger.error('Error generating AI description:', error);
      res.status(500).json({ error: error.message || 'Failed to generate description' });
    }
  });

  // Refresh AI description - clear skip flag and regenerate
  app.post("/api/admin/stations/:id/refresh-description", requireAdmin, async (req, res) => {
    try {
      const stationId = req.params.id;
      
      const station = await pgCatalog().findOne({ _id: stationId });
      if (!station) {
        return void res.status(404).json({ error: 'Station not found' });
      }
      
      logger.log(`🔄 Refreshing AI description for station: ${station.name} (clearing skip flag)`);
      
      // Clear the skip flag to allow regeneration
      await pgCatalog().update({ _id: stationId }, { $unset: { aiDescriptionSkipped: 1 } });
      
      // Generate fresh description
      const result = await generateStationDescription(station as any);
      
      // Save if we have content
      if (result.fullDescription && result.metaDescription) {
        logger.log(`💾 Saving refreshed description for "${station.name}"`);
        
        const updateResult = await pgCatalog().update({ _id: stationId }, {
            $set: { 
              [`descriptions.${result.language}`]: {
                full: result.fullDescription,
                meta: result.metaDescription
              }
            } 
          });
        
        if (updateResult.modifiedCount > 0 && station.slug) {
          performanceCache.invalidateStationCache(station.slug);
        }
        res.json({
          success: true,
          fullDescriptionLength: result.fullDescription.length,
          metaDescriptionLength: result.metaDescription.length,
          language: result.language,
          usedFallback: result.usedFallback || false,
          saved: updateResult.modifiedCount > 0
        });
      } else {
        res.json({
          success: false,
          error: result.error || 'Failed to generate descriptions',
          language: result.language
        });
      }
      
    } catch (error: any) {
      logger.error('Error refreshing AI description:', error);
      res.status(500).json({ error: error.message || 'Failed to refresh description' });
    }
  });

  // Clean meta descriptions from template text (TRANSLATED META..., brackets, etc) - Background Job
  app.post("/api/admin/stations/clean-meta-descriptions", requireAdmin, async (req, res) => {
    try {
      logger.log(`🧹 Starting meta description cleanup (background job)...`);
      
      // Send immediate response
      res.json({
        success: true,
        message: 'Meta description cleanup started in background',
        note: 'Check server logs for progress'
      });
      
      // Process in background - non-blocking, uses batching to avoid loading all stations into memory
      setImmediate(async () => {
        try {
          const BATCH = 500;
          let skip = 0;
          let cleanedCount = 0;
          const cleanupStats: any = {};
          
          while (true) {
            const batch = await pgCatalog().find({ descriptions: { $exists: true } }, { fields: ["_id","descriptions"], offset: skip, limit: BATCH });
            
            if (batch.length === 0) break;
            logger.log(`🧹 Cleanup batch: processing stations ${skip + 1}–${skip + batch.length}...`);
            
            const bulkOps: any[] = [];
            for (const station of batch) {
              if (!station.descriptions || typeof station.descriptions !== 'object') continue;
              
              let hasChanges = false;
              const updatedDescriptions: any = structuredClone(station.descriptions);
              
              for (const [lang, desc] of Object.entries(station.descriptions)) {
                if (typeof desc === 'object' && desc !== null && 'meta' in desc) {
                  const originalMeta = (desc as any).meta || '';
                  const originalFull = (desc as any).full || '';
                  const cleanedMeta = stripPlaceholders(originalMeta);
                  const cleanedFull = stripPlaceholders(originalFull);
                  
                  if (cleanedMeta !== originalMeta || cleanedFull !== originalFull) {
                    hasChanges = true;
                    updatedDescriptions[lang] = { full: cleanedFull, meta: cleanedMeta };
                    if (!cleanupStats[lang]) cleanupStats[lang] = 0;
                    cleanupStats[lang]++;
                  }
                }
              }
              
              if (hasChanges) {
                bulkOps.push({
                  updateOne: {
                    filter: { _id: station._id,descriptions:station.descriptions },
                    update: { $set: { descriptions: updatedDescriptions } }
                  }
                });
                cleanedCount++;
              }
            }
            
            for (const operation of bulkOps) await pgCatalog().update(operation.updateOne.filter,operation.updateOne.update);
            skip += BATCH;
            if (batch.length < BATCH) break;
          }
          
          logger.log(`✅ Meta description cleanup completed: ${cleanedCount} stations updated`);
          logger.log(`📊 Language cleanup stats:`, cleanupStats);
          
        } catch (error: any) {
          logger.error('❌ Error in background cleanup:', error.message);
        }
      });
      
    } catch (error: any) {
      logger.error('Error starting cleanup job:', error);
      res.status(500).json({ error: error.message || 'Failed to start cleanup' });
    }
  });

  // Clear all aiDescriptionSkipped flags to allow re-processing in bulk
  app.post("/api/admin/stations/clear-skipped-flags", requireAdmin, async (req, res) => {
    try {
      logger.log(`🔄 Clearing aiDescriptionSkipped flags for all stations`);
      
      const result = await pgCatalog().update({ aiDescriptionSkipped: true }, { $unset: { aiDescriptionSkipped: 1 } }, { many: true });
      
      logger.log(`✅ Cleared skip flags for ${result.modifiedCount} stations`);
      
      res.json({
        success: true,
        clearedCount: result.modifiedCount,
        message: `Cleared skip flags for ${result.modifiedCount} stations`
      });
      
    } catch (error: any) {
      logger.error('Error clearing skip flags:', error);
      res.status(500).json({ error: error.message || 'Failed to clear skip flags' });
    }
  });

  // Snapshot the selected work list before writes: missing-content filters shrink
  // as stations finish, so offset pagination would silently skip records.
  const startDescriptionJob = async (req: any, res: any, missingEnglishOnly = false, repairAll = false) => {
    let leader: pg.PoolClient | undefined;
    let ownsFillLock = false;
    let ownsJobLock = false;
    let backgroundStarted = false;
    let leadershipError: Error | undefined;
    let jobId = '';
    const onLeadershipError = (error: Error) => { leadershipError = error; };
    const release = async () => {
      if (!leader) return;
      if (!leadershipError) {
        try {
          if (ownsJobLock) await leader.query('SELECT pg_advisory_unlock(hashtext($1))', [`radiohub-description-job:${jobId}`]);
          if (ownsFillLock) await leader.query("SELECT pg_advisory_unlock(hashtext('radiohub-description-fill'))");
        } catch (error) { leadershipError = error as Error; }
      }
      leader.removeListener('error', onLeadershipError);
      leader.release(Boolean(leadershipError));
    };
    try {
      const body = req.body ?? {};
      if (repairAll && (Array.isArray(body) || typeof body !== 'object' || Object.keys(body).length)) {
        return void res.status(400).json({ error: 'Global repair accepts an empty object only and always checks all 14 languages.' });
      }
      const { limit, skip = 0, languages, filterByCountry, selectedStationIds } = body;
      if ((limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) ||
          !Number.isSafeInteger(skip) || skip < 0 ||
          (selectedStationIds !== undefined && (!Array.isArray(selectedStationIds) || selectedStationIds.some((id: unknown) => typeof id !== 'string' || !id))) ||
          (languages !== undefined && (!Array.isArray(languages) || !languages.length || languages.some((language: any) => !SITEMAP_PRIORITY_LANGUAGES.universal14.includes(language))))) {
        return void res.status(400).json({ error: 'Use positive integer limits, nonnegative skip, station IDs and supported translation languages.' });
      }
      const targetLanguages: string[] = [...new Set<string>(languages || SITEMAP_PRIORITY_LANGUAGES.universal14)];
      const hasSelection = Boolean(selectedStationIds?.length);
      const query: any = hasSelection ? { _id: { $in: selectedStationIds } } : filterByCountry ? { countryCode: filterByCountry } : {};
      if (missingEnglishOnly) query.$or = ['full', 'meta'].map(field => ({
        [`descriptions.en.${field}`]: { $not: { $regex: '[^[:space:]]' } },
      }));
      const effectiveLimit = limit ?? (hasSelection ? selectedStationIds.length : 10);
      jobId = `bulk-desc-${randomUUID()}`;
      leader = await getPostgresCoordinationPool().connect();
      leader.on('error', onLeadershipError);
      ownsFillLock = (await leader.query("SELECT pg_try_advisory_lock(hashtext('radiohub-description-fill')) AS acquired")).rows[0].acquired;
      if (!ownsFillLock) return void res.status(409).json({ error: 'A description fill job is already running. Wait for it to finish before starting another.' });
      const stationIds = repairAll ? await pgDescriptionRepairStationIds()
        : (await pgCatalog().find(query, { fields: ['_id'], offset: skip, limit: effectiveLimit })).map(station => station._id);
      if (!stationIds.length) return void res.json({ success: false, total: 0, message: 'No matching stations need processing.' });
      ownsJobLock = (await leader.query('SELECT pg_try_advisory_lock(hashtext($1)) AS acquired', [`radiohub-description-job:${jobId}`])).rows[0].acquired;
      if (!ownsJobLock) throw new Error('Could not acquire description job leadership');
      const job: NonNullable<ReturnType<typeof descriptionJobs.get>> = {
        jobId, status: 'running', total: stationIds.length, processed: 0, successful: 0, failed: 0, skipped: 0,
        currentStation: 'Initializing...', currentAction: 'idle', targetLanguages, startedAt: new Date(),
        successfulStations: [], skippedStations: [], failedStations: [],
        ...(repairAll ? { publishStatus: 'pending' as const } : {}),
      };
      const checkpoint = () => pgSaveDescriptionJob(jobId, job.total, {
        status: job.status, filterByCountry: filterByCountry || null, processedStations: job.processed,
        successCount: job.successful, failedCount: job.failed, skippedCount: job.skipped,
        lastProcessedStationId: job.lastProcessedStationId, lastProcessedSkip: job.processed + skip,
        errorMessage: job.error || null,
        ...(repairAll ? { publishStatus: job.publishStatus } : {}),
      });
      await checkpoint();
      descriptionJobs.set(jobId, job);
      backgroundStarted = true;
      res.json({ success: true, jobId, total: job.total, model: 'gpt-4o-mini', maxConcurrentTranslations: 2 });
      setImmediate(async () => {
        const deadline = Date.now() + 5 * 60 * 60 * 1000;
        let savedAnyDescription = false;
        const assertActive = () => {
          if (leadershipError) throw new Error('Description job leadership lost', { cause: leadershipError });
          if (job.status !== 'running') throw new Error(`Description job ${job.status}`);
          if (Date.now() > deadline) throw new Error('Description job reached its five-hour limit; rerun missing-only to continue');
        };
        try {
          for (const stationId of stationIds) {
            assertActive();
            const station = await pgCatalog().findOne({ _id: stationId });
            if (!station) {
              job.failed++;
              pushLimited(job.failedStations, { name: String(stationId), error: 'Station no longer exists' });
            } else {
              job.currentStation = station.name;
              job.currentAction = 'analyzing';
              try {
                const outcome = await fillMissingStationDescriptions(station, targetLanguages, (action, currentLanguages) => {
                  job.currentAction = action;
                  job.currentLanguage = currentLanguages.join(', ');
                }, assertActive, { repairInvalid: repairAll, onSaved: () => { savedAnyDescription = true; } });
                if (outcome.skipped) {
                  job.skipped++;
                  pushLimited(job.skippedStations, { name: station.name, reason: 'Already complete, manually protected, or previously skipped' });
                } else {
                  job.successful++;
                  pushLimited(job.successfulStations, { name: station.name, languages: outcome.languages });
                }
              } catch (error: any) {
                // Cancellation/leadership loss stops the run; it cannot turn into a completed job.
                assertActive();
                job.failed++;
                pushLimited(job.failedStations, { name: station.name, error: error.message || 'Description processing failed' });
              }
            }
            job.processed++;
            job.lastProcessedStationId = String(stationId);
            job.updatedAt = new Date();
            await checkpoint();
          }
          assertActive();
          if (repairAll && savedAnyDescription) {
            job.currentStation = 'Refreshing sitemaps';
            job.currentAction = 'saving';
            try {
              const { publishDescriptionRepairs } = await import('../services/publish-description-repairs');
              await publishDescriptionRepairs(assertActive);
              job.publishStatus = 'completed';
            } catch (error) {
              job.publishStatus = 'failed';
              job.error = 'Descriptions saved; sitemap refresh needs retry from SEO maintenance.';
              logger.error('Description repair sitemap refresh failed:', error);
            }
          } else if (repairAll) {
            job.publishStatus = 'not-needed';
          }
          assertActive();
          job.status = 'completed';
          job.completedAt = new Date();
          job.currentAction = 'idle';
          await checkpoint();
        } catch (error: any) {
          if (job.status === 'running') {
            job.status = 'failed';
            job.completedAt = new Date();
            job.error = error.message || 'Description processing interrupted';
          }
          if (repairAll) {
            job.publishStatus = savedAnyDescription ? 'failed' : 'not-needed';
            if (savedAnyDescription) job.error = `${job.error || 'Description processing interrupted'}. Saved fields are retained; rebuild sitemaps from SEO maintenance.`;
          }
          await checkpoint().catch(checkpointError => logger.error('Could not persist description job failure:', checkpointError));
        } finally {
          await release();
        }
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Could not start description job' });
    } finally {
      if (!backgroundStarted) await release();
    }
  };
  app.post("/api/admin/stations/fix-missing-english", requireAdmin, (req, res) => startDescriptionJob(req, res, true));
  app.post("/api/admin/stations/generate-bulk-descriptions", requireAdmin, (req, res) => startDescriptionJob(req, res));
  app.post("/api/admin/stations/repair-description-gaps", requireAdmin, (req, res) => startDescriptionJob(req, res, false, true));

  // Get AI description generation job status
  app.get("/api/admin/stations/description-job-status/:jobId", requireAdmin, async (req, res) => {
    const jobId = req.params.jobId;
    const job = descriptionJobs.get(jobId) || await pgReadDescriptionJob(jobId);
    
    if (!job) {
      return void res.status(404).json({ error: 'Job not found' });
    }
    
    res.json({
      jobId: job.jobId,
      status: job.status,
      total: job.total,
      processed: job.processed,
      successful: job.successful,
      failed: job.failed,
      skipped: job.skipped,
      currentStation: job.currentStation,
      currentAction: job.currentAction,
      currentLanguage: job.currentLanguage,
      targetLanguages: job.targetLanguages,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      error: job.error,
      publishStatus: job.publishStatus,
      successfulStations: job.successfulStations || [],
      skippedStations: job.skippedStations || [],
      failedStations: job.failedStations || []
    });
  });

  // Per-language AI description coverage stats.
  // Answers "do all stations actually have full+meta descriptions in each of
  // the 14 universal languages?" with real numbers instead of guesses. For
  // each language reports how many stations have a non-empty `full` and `meta`.
  // Cached 5 min; all supported locales share one PostgreSQL aggregate scan.
  app.get("/api/admin/stations/description-coverage", requireAdmin, async (_req, res) => {
    const CACHE_KEY = 'admin:description-coverage';
    const cached = performanceCache.getQuick(CACHE_KEY);
    if (cached) return void res.json(cached);

    try {
      const coverage = await pgAdminDescriptionCoverage();
      const payload = { ...coverage, languages: coverage.languages.map(language => ({
        ...language, complete: language.withComplete, missingEither: language.missingComplete,
      })), generatedAt: new Date().toISOString() };

      performanceCache.setQuick(CACHE_KEY, payload, 300);
      res.json(payload);
    } catch (err: any) {
      logger.error('❌ description-coverage stats failed:', err?.message || err);
      res.status(500).json({ error: 'Failed to compute coverage', detail: err?.message });
    }
  });

  // Pause AI description generation job
  app.post("/api/admin/stations/description-job/:jobId/pause", requireAdmin, async (req, res) => {
    const jobId = req.params.jobId;
    const job = descriptionJobs.get(jobId);
    
    if (!job) {
      return void res.status(404).json({ error: 'Job not found' });
    }
    
    if (job.status !== 'running') return void res.status(409).json({ error: 'Only running jobs can be paused' });
    job.status = 'paused';
    job.completedAt = new Date();
    job.error = 'Processing paused. Rerun the same selection to continue; completed fields are preserved.';
    descriptionJobs.set(jobId, job);
    await pgSaveDescriptionJob(jobId, job.total, { status: job.status, errorMessage: job.error });
    
    res.json({ success: true, message: job.error });
  });

  // Cancel AI description generation job
  app.post("/api/admin/stations/description-job/:jobId/cancel", requireAdmin, async (req, res) => {
    const jobId = req.params.jobId;
    const job = descriptionJobs.get(jobId);

    if (!job) {
      return void res.status(404).json({ error: 'Job not found' });
    }

    if (!['running', 'paused'].includes(job.status)) return void res.status(409).json({ error: 'Only active jobs can be cancelled' });
    job.status = 'cancelled';
    job.completedAt = new Date();
    descriptionJobs.set(jobId, job);
    await pgSaveDescriptionJob(jobId, job.total, { status: job.status });

    res.json({
      success: true,
      message: 'Job cancelled',
      processed: job.processed,
      successful: job.successful,
      failed: job.failed,
      skipped: job.skipped
    });
  });

  // ── Automated description fill (scheduled + manual trigger) ─────────────

  app.get("/api/admin/description-fill/status", requireAdmin, async (_req, res) => {
    const { scheduledDescriptionFill } = await import('../services/scheduled-description-fill');
    res.json(scheduledDescriptionFill.getStatus());
  });

  app.post("/api/admin/description-fill/run", requireAdmin, async (_req, res) => {
    const { scheduledDescriptionFill } = await import('../services/scheduled-description-fill');
    const status = scheduledDescriptionFill.getStatus();
    if (status.isRunning) {
      return void res.status(409).json({ error: 'already_running', message: 'Description fill is already in progress' });
    }
    // Fire and forget — client polls /status for progress
    scheduledDescriptionFill.runOnce('admin-trigger').catch((err) => {
      logger.error('❌ Manual description fill failed:', err);
    });
    res.json({ success: true, message: 'Description fill started — poll /api/admin/description-fill/status for progress' });
  });
}
