import type { Express } from "express";
import { Station, BulkDescriptionJob } from "../../shared/mongo-schemas";
import { logger } from "../utils/logger";
import { stripPlaceholders, TV_STATION_PROJECTION } from "./shared-utils";
import { performanceCache } from "../performance-cache";

export async function registerAiDescriptionRoutes(app: Express, deps: any) {
  const { requireAdmin } = deps;

  // AI STATION DESCRIPTION GENERATION ENDPOINTS
  const { generateStationDescription, detectStationLanguage, translateDescription } = await import('../services/ai-station-description');
  
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
  }>();

  setInterval(() => {
    const now = Date.now();
    for (const [jobId, job] of descriptionJobs) {
      if ((job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') &&
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
      
      const station = await Station.findById(stationId).lean();
      if (!station) {
        return res.status(404).json({ error: 'Station not found' });
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
        
        const updateResult = await Station.updateOne(
          { _id: stationId },
          { 
            $set: { 
              [`descriptions.${result.language}`]: {
                full: result.fullDescription,
                meta: result.metaDescription
              }
            } 
          }
        );
        
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
      
      const station = await Station.findById(stationId).lean();
      if (!station) {
        return res.status(404).json({ error: 'Station not found' });
      }
      
      logger.log(`🔄 Refreshing AI description for station: ${station.name} (clearing skip flag)`);
      
      // Clear the skip flag to allow regeneration
      await Station.updateOne(
        { _id: stationId },
        { $unset: { aiDescriptionSkipped: 1 } }
      );
      
      // Generate fresh description
      const result = await generateStationDescription(station as any);
      
      // Save if we have content
      if (result.fullDescription && result.metaDescription) {
        logger.log(`💾 Saving refreshed description for "${station.name}"`);
        
        const updateResult = await Station.updateOne(
          { _id: stationId },
          { 
            $set: { 
              [`descriptions.${result.language}`]: {
                full: result.fullDescription,
                meta: result.metaDescription
              }
            } 
          }
        );
        
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
            const batch = await Station.find({ descriptions: { $exists: true } })
              .select('_id descriptions')
              .skip(skip)
              .limit(BATCH)
              .lean();
            
            if (batch.length === 0) break;
            logger.log(`🧹 Cleanup batch: processing stations ${skip + 1}–${skip + batch.length}...`);
            
            const bulkOps: any[] = [];
            for (const station of batch) {
              if (!station.descriptions || typeof station.descriptions !== 'object') continue;
              
              let hasChanges = false;
              const updatedDescriptions: any = {};
              
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
                    filter: { _id: station._id },
                    update: { $set: { descriptions: updatedDescriptions } }
                  }
                });
                cleanedCount++;
              }
            }
            
            if (bulkOps.length > 0) await Station.bulkWrite(bulkOps);
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
      
      const result = await Station.updateMany(
        { aiDescriptionSkipped: true },
        { $unset: { aiDescriptionSkipped: 1 } }
      );
      
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

  // Find and fix stations with missing descriptions (English + ALL other languages)
  app.post("/api/admin/stations/fix-missing-english", requireAdmin, async (req, res) => {
    try {
      const { limit, selectedStationIds, languages } = req.body;
      
      // Target languages - all 14 supported languages
      const targetLanguages = languages || ['en', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'ar', 'zh', 'tr', 'ja', 'ko', 'hi', 'he'];
      
      // Build query based on whether specific stations are selected
      let query: any = {};
      
      if (selectedStationIds && selectedStationIds.length > 0) {
        // If specific stations selected, only process those (check for missing English)
        const mongoose = await import('mongoose');
        query = {
          _id: { $in: selectedStationIds.map((id: string) => new mongoose.default.Types.ObjectId(id)) },
          $or: [
            { 'descriptions.en': { $exists: false } },
            { 'descriptions.en.full': { $exists: false } },
            { 'descriptions.en.full': '' },
            { 'descriptions.en.full': null },
            { 'descriptions.en.meta': { $exists: false } },
            { 'descriptions.en.meta': '' },
            { 'descriptions.en.meta': null }
          ]
        };
        logger.log(`🔍 Checking ${selectedStationIds.length} selected stations for missing descriptions`);
      } else {
        // Find all stations where:
        // 1. descriptions exists (has some translations)
        // 2. descriptions.en.full OR descriptions.en.meta is empty or doesn't exist
        query = {
          descriptions: { $exists: true },
          $or: [
            { 'descriptions.en': { $exists: false } },
            { 'descriptions.en.full': { $exists: false } },
            { 'descriptions.en.full': '' },
            { 'descriptions.en.full': null },
            { 'descriptions.en.meta': { $exists: false } },
            { 'descriptions.en.meta': '' },
            { 'descriptions.en.meta': null }
          ]
        };
      }
      
      // Count matching stations
      const totalStations = await Station.countDocuments(query);
      const stationsToProcess = limit ? Math.min(limit, totalStations) : totalStations;
      
      logger.log(`🔍 Found ${totalStations} stations with missing English descriptions`);
      
      if (stationsToProcess === 0) {
        return res.json({
          success: false,
          message: 'No stations found with missing English full descriptions',
          count: 0
        });
      }
      
      // Create job ID
      const jobId = `fix-en-${Date.now()}`;
      
      // Initialize job tracking
      descriptionJobs.set(jobId, {
        jobId,
        status: 'running',
        total: stationsToProcess,
        processed: 0,
        successful: 0,
        failed: 0,
        skipped: 0,
        currentStation: 'Loading stations...',
        currentAction: 'idle',
        currentLanguage: 'en',
        targetLanguages: targetLanguages,
        startedAt: new Date(),
        successfulStations: [],
        skippedStations: [],
        failedStations: []
      });
      
      // Send immediate response
      res.json({
        success: true,
        message: `Started fixing descriptions for ${stationsToProcess} stations (${targetLanguages.length} languages)`,
        jobId,
        total: stationsToProcess
      });
      
      // Process in background
      setImmediate(async () => {
        try {
          logger.log(`🚀 Starting fix-missing-english job ${jobId} for ${stationsToProcess} stations with ${targetLanguages.length} languages`);
          
          const batchSize = 10;
          let processed = 0;
          let skip = 0;
          let successful = 0;
          let failed = 0;
          let skipped = 0;
          
          while (processed < stationsToProcess) {
            const currentLimit = limit ? Math.min(batchSize, stationsToProcess - processed) : batchSize;
            const stations = await Station.find(query).skip(skip).limit(currentLimit).select(TV_STATION_PROJECTION).lean();
            
            if (stations.length === 0) break;
            
            for (const station of stations) {
              try {
                const job = descriptionJobs.get(jobId);
                if (!job || job.status === 'paused') {
                  logger.log(`⏸️ Job ${jobId} paused`);
                  return;
                }
                
                job.currentStation = station.name;
                job.currentAction = 'analyzing';
                descriptionJobs.set(jobId, job);
                
                const stationName = station.name;
                const existingDescriptions = (station as any).descriptions || {};
                const nativeLanguage = detectStationLanguage(station as any);
                
                // Find ALL missing languages
                const missingLanguages: string[] = [];
                const existingLanguages: string[] = [];
                
                if (station.descriptions && typeof station.descriptions === 'object') {
                  for (const lang of targetLanguages) {
                    const desc = (station.descriptions as any)[lang];
                    if (!desc || !desc.full || desc.full === '') {
                      missingLanguages.push(lang);
                    } else {
                      existingLanguages.push(lang);
                    }
                  }
                } else {
                  missingLanguages.push(...targetLanguages);
                }
                
                if (missingLanguages.length === 0) {
                  logger.log(`⏭️ Skipping "${stationName}" - all ${targetLanguages.length} languages exist`);
                  skipped++;
                  job.skipped = skipped;
                  job.skippedStations.push({ name: stationName, reason: 'All languages exist' });
                  processed++;
                  job.processed = processed;
                  descriptionJobs.set(jobId, job);
                  continue;
                }
                
                logger.log(`🔧 Fixing "${stationName}" - missing ${missingLanguages.length} languages: ${missingLanguages.join(', ')}`);
                logger.log(`   ✅ Existing ${existingLanguages.length} languages: ${existingLanguages.join(', ')}`);
                
                // Find a valid source description (prefer native language, then any existing)
                let sourceDescription: { full: string; meta: string } | null = null;
                let sourceLanguage = nativeLanguage;
                
                // Check if native language exists
                if (station.descriptions && (station.descriptions as any)[nativeLanguage]?.full) {
                  sourceDescription = (station.descriptions as any)[nativeLanguage];
                  sourceLanguage = nativeLanguage;
                } else if (station.descriptions) {
                  // Find any existing language as source
                  for (const lang of existingLanguages) {
                    if ((station.descriptions as any)[lang]?.full) {
                      sourceDescription = (station.descriptions as any)[lang];
                      sourceLanguage = lang;
                      break;
                    }
                  }
                }
                
                // If no source exists, generate native language first
                if (!sourceDescription) {
                  job.currentAction = 'generating';
                  job.currentLanguage = nativeLanguage;
                  descriptionJobs.set(jobId, job);
                  
                  logger.log(`   🔄 Generating ${nativeLanguage.toUpperCase()} (native) for "${stationName}"`);
                  
                  const result = await generateStationDescription(station as any, nativeLanguage);
                  
                  if (!result.success || !result.fullDescription) {
                    logger.log(`❌ Failed to generate native description for "${stationName}"`);
                    failed++;
                    job.failed = failed;
                    job.failedStations.push({ name: stationName, error: 'Native generation failed' });
                    processed++;
                    job.processed = processed;
                    descriptionJobs.set(jobId, job);
                    continue;
                  }
                  
                  sourceDescription = { full: result.fullDescription, meta: result.metaDescription || '' };
                  sourceLanguage = nativeLanguage;
                  
                  // Save native language
                  await Station.updateOne(
                    { _id: station._id },
                    { $set: { [`descriptions.${nativeLanguage}`]: sourceDescription } }
                  );
                  
                  // Remove native from missing list if it was there
                  const nativeIndex = missingLanguages.indexOf(nativeLanguage);
                  if (nativeIndex > -1) {
                    missingLanguages.splice(nativeIndex, 1);
                  }
                  
                  logger.log(`   ✅ Generated ${nativeLanguage.toUpperCase()} for "${stationName}"`);
                }
                
                // Now translate to all missing languages
                if (missingLanguages.length > 0 && sourceDescription) {
                  job.currentAction = 'translating';
                  job.currentLanguage = missingLanguages.join(', ');
                  descriptionJobs.set(jobId, job);
                  
                  logger.log(`   🌍 Translating to ${missingLanguages.length} languages: ${missingLanguages.join(', ')}`);
                  
                  const translations = await translateDescription(
                    sourceDescription.full,
                    sourceDescription.meta,
                    sourceLanguage,
                    missingLanguages,
                    stationName
                  );
                  
                  job.currentAction = 'saving';
                  descriptionJobs.set(jobId, job);
                  
                  // Save all translations
                  for (const [lang, translation] of translations) {
                    await Station.updateOne(
                      { _id: station._id },
                      { $set: { [`descriptions.${lang}`]: translation } }
                    );
                  }
                  
                  logger.log(`   ✅ Added ${translations.size} languages for "${stationName}"`);
                  
                  successful++;
                  job.successful = successful;
                  job.successfulStations.push({ name: stationName, languages: Array.from(translations.keys()) });
                } else {
                  successful++;
                  job.successful = successful;
                  job.successfulStations.push({ name: stationName, languages: [nativeLanguage] });
                }
                
                processed++;
                job.processed = processed;
                descriptionJobs.set(jobId, job);
                
                logger.log(`✅ Fixed "${stationName}" - now has all ${targetLanguages.length} languages`);
                
              } catch (stationError: any) {
                logger.error(`❌ Error fixing "${station.name}":`, stationError.message);
                failed++;
                const job = descriptionJobs.get(jobId);
                if (job) {
                  job.failed = failed;
                  job.failedStations.push({ name: station.name, error: stationError.message });
                  job.processed = ++processed;
                  descriptionJobs.set(jobId, job);
                }
              }
              
              // Small delay between stations
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            skip += batchSize;
          }
          
          const job = descriptionJobs.get(jobId);
          if (job) {
            job.status = 'completed';
            job.completedAt = new Date();
            job.processed = processed;
            job.successful = successful;
            job.failed = failed;
            job.skipped = skipped;
            descriptionJobs.set(jobId, job);
          }
          
          logger.log(`✅ Fix-missing-english job ${jobId} completed! Processed: ${processed}, Successful: ${successful}, Failed: ${failed}, Skipped: ${skipped}`);
          
        } catch (error: any) {
          logger.error(`❌ Fix-missing-english job ${jobId} failed:`, error);
          const job = descriptionJobs.get(jobId);
          if (job) {
            job.status = 'failed';
            job.completedAt = new Date();
            job.error = error.message;
            descriptionJobs.set(jobId, job);
          }
        }
      });
      
    } catch (error: any) {
      logger.error('Error starting fix-missing-english:', error);
      res.status(500).json({ error: error.message || 'Failed to start fix job' });
    }
  });

  // Bulk generate descriptions
  app.post("/api/admin/stations/generate-bulk-descriptions", requireAdmin, async (req, res) => {
    try {
      const { 
        limit = 10, 
        skip: initialSkip = 0, 
        languages, 
        filterByCountry, 
        skipExisting = true,
        selectedStationIds 
      } = req.body;
      
      const jobId = `bulk-desc-${Date.now()}`;
      
      let query: any = {};
      
      if (selectedStationIds && selectedStationIds.length > 0) {
        const mongoose = await import('mongoose');
        query = {
          _id: { $in: selectedStationIds.map((id: string) => new mongoose.default.Types.ObjectId(id)) }
        };
      } else if (filterByCountry) {
        query = { countryCode: filterByCountry };
      }
      
      const totalStations = await Station.countDocuments(query);
      const stationsToProcess = Math.min(limit, totalStations - initialSkip);
      
      descriptionJobs.set(jobId, {
        jobId,
        status: 'running',
        total: stationsToProcess,
        processed: 0,
        successful: 0,
        failed: 0,
        skipped: 0,
        currentStation: 'Initializing...',
        currentAction: 'idle',
        targetLanguages: languages || ['en'],
        startedAt: new Date(),
        successfulStations: [],
        skippedStations: [],
        failedStations: []
      });
      
      res.json({
        success: true,
        jobId,
        total: stationsToProcess
      });
      
      setImmediate(async () => {
        try {
          const batchSize = 5;
          let processed = 0;
          let successful = 0;
          let failed = 0;
          let skipped = 0;
          let skip = initialSkip;
          
          while (processed < stationsToProcess) {
            const currentLimit = Math.min(batchSize, stationsToProcess - processed);
            const stations = await Station.find(query).skip(skip).limit(currentLimit).lean();
            
            if (stations.length === 0) break;
            
            for (const station of stations) {
              try {
                const job = descriptionJobs.get(jobId);
                if (!job || job.status === 'cancelled' || job.status === 'paused') return;
                
                job.currentStation = station.name;
                descriptionJobs.set(jobId, job);

                // Country-based language detection
                const targetLanguage = detectStationLanguage(station as any);
                const targetLanguages = languages && languages.length > 0 ? languages : ['en', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'ar', 'zh', 'tr', 'ja', 'ko', 'hi', 'he'];
                
                const existingLanguages = (station.descriptions && typeof station.descriptions === 'object') ? Object.keys(station.descriptions).filter((lang: string) => {
                  const desc = (station.descriptions as any)[lang];
                  if (typeof desc === 'object' && desc) {
                    const full = desc.full || '';
                    const meta = desc.meta || '';
                    return full.trim().length > 10 || meta.trim().length > 10;
                  }
                  return false;
                }) : [];
                
                const missingLanguages = targetLanguages.filter((lang: string) => !existingLanguages.includes(lang));
                
                if (station.descriptions && typeof station.descriptions === 'object' && existingLanguages.length > 0 && missingLanguages.length > 0) {
                  let sourceLang = targetLanguage;
                  const nativeDesc = (station.descriptions as any)[targetLanguage];
                  const hasValidNative = nativeDesc && 
                    typeof nativeDesc === 'object' && 
                    nativeDesc.full?.trim().length > 50;
                  
                  if (!hasValidNative) {
                    sourceLang = existingLanguages.find(lang => {
                      const desc = (station.descriptions as any)[lang];
                      if (typeof desc === 'object' && desc) {
                        return desc.full?.trim().length > 50;
                      }
                      return false;
                    }) || existingLanguages[0];
                  }
                  
                  const sourceDesc = (station.descriptions as any)[sourceLang];
                  
                  if (sourceDesc && sourceDesc.full && sourceDesc.meta) {
                    job.currentAction = 'translating';
                    job.currentLanguage = missingLanguages.join(', ');
                    descriptionJobs.set(jobId, job);
                    
                    try {
                      const translations = await translateDescription(sourceDesc.full, sourceDesc.meta, sourceLang, missingLanguages, station.name);
                      
                      job.currentAction = 'saving';
                      descriptionJobs.set(jobId, job);
                      
                      for (const [lang, translation] of translations) {
                        const cleanedTranslation = {
                          full: stripPlaceholders(translation.full),
                          meta: stripPlaceholders(translation.meta)
                        };
                        
                        await Station.updateOne(
                          { _id: station._id },
                          { $set: { [`descriptions.${lang}`]: cleanedTranslation } }
                        );
                      }
                      
                      successful++;
                      job.successfulStations.push({ name: station.name, languages: missingLanguages });
                    } catch (translationError: any) {
                      failed++;
                      job.failedStations.push({ name: station.name, error: translationError.message });
                    }
                    
                    processed++;
                    job.processed = processed;
                    job.successful = successful;
                    job.failed = failed;
                    descriptionJobs.set(jobId, job);
                    continue;
                  }
                }
                
                if (station.descriptions && existingLanguages.length > 0 && missingLanguages.length === 0) {
                  skipped++;
                  processed++;
                  job.processed = processed;
                  job.skipped = skipped;
                  job.skippedStations.push({ name: station.name, reason: `Already has all target languages` });
                  descriptionJobs.set(jobId, job);
                  continue;
                }
                
                if (filterByCountry && skipExisting && station.descriptions && typeof station.descriptions === 'object' && (station.descriptions as any)[targetLanguage]) {
                  skipped++;
                  processed++;
                  job.processed = processed;
                  job.skipped = skipped;
                  job.skippedStations.push({ name: station.name, reason: `Already has ${targetLanguage} description` });
                  descriptionJobs.set(jobId, job);
                  continue;
                }
                
                if (station.aiDescriptionSkipped) {
                  skipped++;
                  processed++;
                  job.processed = processed;
                  job.skipped = skipped;
                  job.skippedStations.push({ name: station.name, reason: 'Previously checked - no OpenAI info available' });
                  descriptionJobs.set(jobId, job);
                  continue;
                }
                
                const result = await generateStationDescription(station as any, targetLanguage);
                
                if (result.success && result.fullDescription && result.metaDescription) {
                  const cleanedFull = stripPlaceholders(result.fullDescription);
                  const cleanedMeta = stripPlaceholders(result.metaDescription);
                  
                  await Station.updateOne(
                    { _id: station._id },
                    { 
                      $set: { 
                        [`descriptions.${result.language}`]: {
                          full: cleanedFull,
                          meta: cleanedMeta
                        }
                      } 
                    }
                  );
                  
                  let translationTargets = targetLanguages.filter((lang: string) => lang !== result.language);
                  const existingLangs = (station.descriptions && typeof station.descriptions === 'object') ? Object.keys(station.descriptions).filter((lang: string) => {
                    const desc = (station.descriptions as any)[lang];
                    if (!desc) return false;
                    if (typeof desc === 'object') {
                      return desc.full?.trim().length > 50;
                    }
                    return false;
                  }) : [];
                  const missingLangs = translationTargets.filter((lang: string) => !existingLangs.includes(lang));
                  
                  if (missingLangs.length > 0) {
                    job.currentAction = 'translating';
                    job.currentLanguage = missingLangs.join(', ');
                    descriptionJobs.set(jobId, job);
                    
                    const translations = await translateDescription(cleanedFull, cleanedMeta, result.language, missingLangs, station.name);
                    
                    job.currentAction = 'saving';
                    descriptionJobs.set(jobId, job);
                    
                    for (const [lang, translation] of translations) {
                      const cleanedTranslation = {
                        full: stripPlaceholders(translation.full),
                        meta: stripPlaceholders(translation.meta)
                      };
                      
                      await Station.updateOne(
                        { _id: station._id },
                        { $set: { [`descriptions.${lang}`]: cleanedTranslation } }
                      );
                    }
                    successful++;
                    job.successfulStations.push({ name: station.name, languages: [result.language, ...missingLangs] });
                  } else {
                    successful++;
                    job.successfulStations.push({ name: station.name, languages: [result.language] });
                  }
                } else {
                  failed++;
                }
                
                processed++;
                job.processed = processed;
                job.successful = successful;
                job.failed = failed;
                job.skipped = skipped;
                job.lastProcessedStationId = station._id?.toString();
                job.lastProcessedSkip = skip;
                job.updatedAt = new Date();
                descriptionJobs.set(jobId, job);
                
                if (processed % 5 === 0) {
                  await BulkDescriptionJob.findOneAndUpdate(
                    { jobId },
                    {
                      processedStations: processed,
                      successCount: successful,
                      failedCount: failed,
                      skippedCount: skipped,
                      lastProcessedStationId: station._id?.toString(),
                      lastProcessedSkip: skip,
                      updatedAt: new Date()
                    },
                    { upsert: true }
                  );
                }
              } catch (error: any) {
                failed++;
                processed++;
              }
            }
            skip += batchSize;
          }
          
          const job = descriptionJobs.get(jobId);
          if (job) {
            job.status = 'completed';
            job.completedAt = new Date();
            descriptionJobs.set(jobId, job);
          }
          
          await BulkDescriptionJob.findOneAndUpdate(
            { jobId },
            {
              status: 'completed',
              processedStations: processed,
              successCount: successful,
              failedCount: failed,
              skippedCount: skipped,
              updatedAt: new Date()
            },
            { upsert: true }
          );
        } catch (error: any) {
          const job = descriptionJobs.get(jobId);
          if (job) {
            job.status = 'failed';
            job.completedAt = new Date();
            job.error = error.message;
            descriptionJobs.set(jobId, job);
          }
        }
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get AI description generation job status
  app.get("/api/admin/stations/description-job-status/:jobId", requireAdmin, async (req, res) => {
    const jobId = req.params.jobId;
    const job = descriptionJobs.get(jobId);
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
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
      successfulStations: job.successfulStations || [],
      skippedStations: job.skippedStations || [],
      failedStations: job.failedStations || []
    });
  });

  // Pause AI description generation job
  app.post("/api/admin/stations/description-job/:jobId/pause", requireAdmin, async (req, res) => {
    const jobId = req.params.jobId;
    const job = descriptionJobs.get(jobId);
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    job.status = 'paused';
    descriptionJobs.set(jobId, job);
    
    res.json({ success: true, message: 'Job paused' });
  });

  // Cancel AI description generation job
  app.post("/api/admin/stations/description-job/:jobId/cancel", requireAdmin, async (req, res) => {
    const jobId = req.params.jobId;
    const job = descriptionJobs.get(jobId);
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    job.status = 'cancelled';
    job.completedAt = new Date();
    descriptionJobs.set(jobId, job);
    
    res.json({ 
      success: true, 
      message: 'Job cancelled',
      processed: job.processed,
      successful: job.successful,
      failed: job.failed,
      skipped: job.skipped
    });
  });
}
