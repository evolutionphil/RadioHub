import type { Express } from "express";
import { Station, Genre, User, BulkDescriptionJob, SAFE_GENRE_SLUG_RE, normalizeGenreSlug } from '@workspace/db-shared/mongo-schemas';
import { logger } from "../utils/logger";
import { slugGenerationJobs, stripPlaceholders } from "./shared-utils";
import { slugifyStationName, evaluateJunkStation } from "../seo/junk-station-rules";
import CacheManager from "../cache";

export function registerSlugRoutes(app: Express, deps: any) {
  const { requireAdmin } = deps;

  // Admin endpoint to get slug statistics (no auth required for status checking)
  app.get("/api/admin/station-slugs/status", requireAdmin, async (req, res) => {
    try {
      const totalStations = await Station.countDocuments();
      const stationsWithSlugs = await Station.countDocuments({
        $and: [
          { slug: { $exists: true, $ne: null } },
          { slug: { $ne: "" } }
        ]
      });
      const stationsWithoutSlugs = totalStations - stationsWithSlugs;
      const completionPercentage = totalStations > 0 ? (stationsWithSlugs / totalStations) * 100 : 0;

      const stats = {
        totalStations,
        stationsWithSlugs,
        stationsWithoutSlugs,
        completionPercentage
      };

      res.json(stats);
    } catch (error: any) {
      logger.error(`Error fetching slug statistics: ${error.message}`);
      res.status(500).json({ error: 'Failed to fetch slug statistics' });
    }
  });

  // Admin endpoint for job status (with real-time tracking)
  app.get("/api/admin/station-slugs/job-status", requireAdmin, async (req, res) => {
    try {
      // Find the most recent running or recent job
      let mostRecentJob = null;
      for (const [jobId, job] of slugGenerationJobs.entries()) {
        if (!mostRecentJob || job.startedAt > mostRecentJob.startedAt) {
          mostRecentJob = job;
        }
      }
      
      // Return the most recent job or null if none exists
      res.json(mostRecentJob);
    } catch (error: any) {
      logger.error(`Error fetching job status: ${error.message}`);
      res.status(500).json({ error: 'Failed to fetch job status' });
    }
  });

  // Admin endpoint to stop slug generation
  app.post("/api/admin/station-slugs/stop", requireAdmin, async (req, res) => {
    try {
      // Stop all running jobs
      for (const [jobId, job] of slugGenerationJobs.entries()) {
        if (job.status === 'running') {
          job.status = 'stopped';
          job.completedAt = new Date();
          job.message = 'Generation stopped by user';
        }
      }
      
      res.json({ success: true, message: 'Generation stopped' });
    } catch (error) {
      console.error('Error stopping slug generation:', error);
      res.status(500).json({ error: 'Failed to stop generation' });
    }
  });

  // CLEAR ALL SLUGS FIRST (for complete regeneration) — admin-only,
  // destructive global mutation must not be public.
  app.post("/api/clear-all-slugs", requireAdmin, async (req, res) => {
    try {
      logger.log('🧹 CLEARING ALL SLUGS...');
      
      // Test with one station first
      const testStation = await Station.findOne({});
      if (testStation) {
        logger.log(`📋 Before clear: Station "${testStation.name}" has slug: "${testStation.slug}"`);
      }
      
      const clearResults = await Promise.all([
        Station.updateMany({}, { $unset: { slug: 1 } }),
        Genre.updateMany({}, { $unset: { slug: 1 } }),
        User.updateMany({}, { $unset: { slug: 1 } })
      ]);
      
      // Check if it worked
      const testStationAfter = await Station.findOne({ _id: testStation?._id });
      if (testStationAfter) {
        logger.log(`📋 After clear: Station "${testStationAfter.name}" has slug: "${testStationAfter.slug}"`);
      }
      
      const totalCleared = clearResults.reduce((sum, result) => sum + result.modifiedCount, 0);
      
      logger.log(`✅ Cleared ${totalCleared} slugs total:`);
      logger.log(`   • Stations: ${clearResults[0].modifiedCount}`);
      logger.log(`   • Genres: ${clearResults[1].modifiedCount}`);  
      logger.log(`   • Users: ${clearResults[2].modifiedCount}`);
      
      res.json({ 
        success: true, 
        totalCleared,
        stations: clearResults[0].modifiedCount,
        genres: clearResults[1].modifiedCount,
        users: clearResults[2].modifiedCount
      });
    } catch (error) {
      console.error('❌ Error clearing slugs:', error);
      res.status(500).json({ error: 'Failed to clear slugs' });
    }
  });

  // OPTIMIZED COMPREHENSIVE SLUG GENERATION - Stations, Genres, and Users
  // Admin-only — long-running CPU+DB job that must not be publicly triggerable.
  app.post("/api/generate-all-slugs", requireAdmin, async (req, res) => {
    const regenerateAll = req.body && req.body.regenerateAll === true;
    try {
      // Count stations based on regenerateAll flag
      const stationsWithoutSlugs = regenerateAll 
        ? await Station.countDocuments()
        : await Station.countDocuments({ $or: [{ slug: { $exists: false } }, { slug: "" }, { slug: null }] });
      const genresWithoutSlugs = regenerateAll
        ? await Genre.countDocuments()
        : await Genre.countDocuments({ $or: [{ slug: { $exists: false } }, { slug: "" }, { slug: null }] });
      const usersWithoutSlugs = regenerateAll
        ? await User.countDocuments()
        : await User.countDocuments({ $or: [{ slug: { $exists: false } }, { slug: "" }, { slug: null }] });
      
      const jobId = regenerateAll ? `regenerate-all-slugs-${Date.now()}` : `optimized-slug-gen-${Date.now()}`;
      const startedAt = new Date();
      const totalToProcess = stationsWithoutSlugs + genresWithoutSlugs + usersWithoutSlugs;
      
      // Create job tracking entry
      const jobData = {
        jobId,
        status: 'running' as const,
        progress: { current: 0, total: totalToProcess },
        startedAt,
        message: regenerateAll 
          ? `Complete regeneration for ALL ${stationsWithoutSlugs} stations, ${genresWithoutSlugs} genres, and ${usersWithoutSlugs} users`
          : `Optimized slug generation for ${stationsWithoutSlugs} stations, ${genresWithoutSlugs} genres, and ${usersWithoutSlugs} users without slugs`
      };
      
      slugGenerationJobs.set(jobId, jobData);
      
      // Send immediate response to user - this makes it asynchronous
      res.json(jobData);
      
      // Process comprehensive slug generation in background (non-blocking)
      setImmediate(async () => {
        try {
          logger.log('🚀 OPTIMIZED COMPREHENSIVE SLUG GENERATION STARTED');
          logger.log(`📊 Processing: ${stationsWithoutSlugs} stations, ${genresWithoutSlugs} genres, ${usersWithoutSlugs} users (only items without slugs)`);
          
          let totalUpdated = 0;
          let totalProcessed = 0;
          
          // Pre-load ALL existing slugs into memory for fast uniqueness checking
          logger.log('🔄 Pre-loading existing slugs for fast uniqueness checking...');
          const [existingStationSlugs, existingGenreSlugs, existingUserSlugs] = await Promise.all([
            Station.find({ slug: { $exists: true } }, { slug: 1 }).lean(),
            Genre.find({ slug: { $exists: true } }, { slug: 1 }).lean(),
            User.find({ slug: { $exists: true } }, { slug: 1 }).lean()
          ]);
          
          const usedSlugs = new Set([
            ...existingStationSlugs.map(s => s.slug),
            ...existingGenreSlugs.map(g => g.slug),
            ...existingUserSlugs.map(u => u.slug)
          ]);
          
          logger.log(`✅ Loaded ${usedSlugs.size} existing slugs for uniqueness checking`);
          
          // Optimized slug generator using in-memory uniqueness checking.
          // Uses centralized transliterating slugifier so non-Latin / accented
          // names produce real ASCII slugs instead of being stripped to ''.
          const generateOptimizedUniqueSlug = (name: string): string => {
            const baseSlug = slugifyStationName(name) || 'station';

            let uniqueSlug = baseSlug;
            let counter = 1;

            // Fast in-memory uniqueness check instead of database lookups
            while (usedSlugs.has(uniqueSlug)) {
              uniqueSlug = `${baseSlug}-${counter}`;
              counter++;
            }

            usedSlugs.add(uniqueSlug); // Reserve this slug
            return uniqueSlug;
          };
          
          // ==== GENERATE STATION SLUGS (BATCH OPTIMIZED) ====
          logger.log('🏁 Phase 1: Generating station slugs (batch optimized)...');
          const batchSize = 1000;
          let stationUpdated = 0;
          let skip = 0;
          
          while (true) {
            // Get stations based on regenerateAll flag — ALWAYS use skip/limit/lean for batching
            const stationFilter = regenerateAll
              ? {}
              : { $or: [{ slug: { $exists: false } }, { slug: '' }, { slug: null }] };
            const stations = await Station.find(stationFilter)
              .select('_id name url homepage tags country language codec bitrate lastCheckOk noIndex')
              .skip(skip)
              .limit(batchSize)
              .lean();
            if (stations.length === 0) break;
            
            // Prepare bulk operations
            const bulkOps = [];
            
            for (const station of stations) {
              try {
                // Check if job was stopped
                const currentJob = slugGenerationJobs.get(jobId);
                if (currentJob?.status === 'stopped') {
                  logger.log('🛑 Job stopped by user, exiting station processing');
                  return;
                }
                
                totalProcessed++;
                
                // Generate unique slug using optimized in-memory checker
                const newSlug = generateOptimizedUniqueSlug(station.name);

                // Re-evaluate junk against the slug we're about to persist —
                // collision suffixes (e.g. `-mp3-1`) only become visible at
                // assignment time, so this is the right moment to flag them.
                const update: { slug: string; noIndex?: true } = { slug: newSlug };
                const verdict = evaluateJunkStation({
                  name: station.name,
                  slug: newSlug,
                  url: station.url,
                  homepage: station.homepage,
                  tags: station.tags,
                  bitrate: station.bitrate,
                  lastCheckOk: station.lastCheckOk,
                  lastCheckOkTime: station.lastCheckOkTime,
                  lastCheckTime: station.lastCheckTime,
                });
                if (verdict.isJunk && station.noIndex !== true) {
                  update.noIndex = true;
                }

                // Add to bulk operations instead of individual updates
                bulkOps.push({
                  updateOne: {
                    filter: { _id: station._id },
                    update: { $set: update }
                  }
                });
                
                stationUpdated++;
                totalUpdated++;
                
                // Update job progress every 100 items for responsiveness
                if (totalProcessed % 100 === 0) {
                  const currentJob = slugGenerationJobs.get(jobId);
                  if (currentJob) {
                    currentJob.progress.current = totalProcessed;
                    slugGenerationJobs.set(jobId, currentJob);
                  }
                  logger.log(`📈 Station Progress: ${totalProcessed}/${totalToProcess} processed (${Math.round(totalProcessed/totalToProcess*100)}%)`);
                }
              } catch (error) {
                console.error(`❌ Error processing station ${station._id}:`, error);
              }
            }
            
            // Execute bulk operations for this batch
            if (bulkOps.length > 0) {
              await Station.bulkWrite(bulkOps);
              logger.log(`✅ Batch complete: ${bulkOps.length} station slugs updated`);
            }
            
            skip += batchSize;
          }
          
          logger.log(`✅ Station slugs: ${stationUpdated} stations updated`);
          
          // ==== GENERATE GENRE SLUGS (BATCH OPTIMIZED) ====
          logger.log('🎵 Phase 2: Generating genre slugs (batch optimized)...');
          const genres = regenerateAll 
            ? await Genre.find({}).lean()
            : await Genre.find({ $or: [{ slug: { $exists: false } }, { slug: "" }, { slug: null }] }).lean();
          let genreUpdated = 0;
          
          if (genres.length > 0) {
            const genreBulkOps = [];
            
            for (const genre of genres) {
              try {
                // Check if job was stopped
                const currentJob = slugGenerationJobs.get(jobId);
                if (currentJob?.status === 'stopped') {
                  logger.log('🛑 Job stopped by user, exiting genre processing');
                  return;
                }
                
                totalProcessed++;
                
                // Generate unique slug using optimized in-memory checker.
                // Task #161: route every Genre.slug write through the shared
                // `normalizeGenreSlug` helper so this admin path can never
                // reintroduce the XML-unsafe values the weekly cleanup cron
                // exists to scrub. The transliterating slugifier already
                // produces ASCII output, but we still normalize defensively
                // and skip docs whose name normalizes to empty (instead of
                // writing a literal '' which would later trip
                // `cleanup-malformed-genre-slugs`).
                const candidate = generateOptimizedUniqueSlug(genre.name);
                const newSlug = normalizeGenreSlug(candidate);
                if (!newSlug || !SAFE_GENRE_SLUG_RE.test(newSlug)) {
                  // Note: totalProcessed was already incremented above for
                  // this genre — do NOT double-count when skipping.
                  logger.log(
                    `⏭️  Skipping genre ${genre._id} ("${genre.name}") — normalized slug is empty/unsafe`,
                  );
                  continue;
                }

                genreBulkOps.push({
                  updateOne: {
                    filter: { _id: genre._id },
                    update: { $set: { slug: newSlug } }
                  }
                });

                genreUpdated++;
                totalUpdated++;
                
                // Update job progress every 50 items
                if (totalProcessed % 50 === 0) {
                  const currentJob = slugGenerationJobs.get(jobId);
                  if (currentJob) {
                    currentJob.progress.current = totalProcessed;
                    slugGenerationJobs.set(jobId, currentJob);
                  }
                  logger.log(`📈 Genre Progress: ${totalProcessed}/${totalToProcess} processed (${Math.round(totalProcessed/totalToProcess*100)}%)`);
                }
              } catch (error) {
                console.error(`❌ Error processing genre ${genre._id}:`, error);
              }
            }
            
            // Execute bulk operations for genres.
            // Task #110 added the GenreSchema.slug regex validator, but
            // Task #161 corrected a wrong comment that previously claimed
            // Mongoose runs validators on bulkWrite by default. In reality
            // Mongoose only runs schema validation on `insertOne` /
            // `replaceOne` operations inside bulkWrite — never on the
            // `updateOne` operations we use here (see model.js comment:
            // "Mongoose currently runs validation on `insertOne` and
            // `replaceOne` operations by default"). That is exactly how
            // malformed slugs were sneaking past this admin path and
            // showing up in the weekly cleanup cron's `normalized` count.
            //
            // The actual defense is the pre-normalization above: every
            // candidate slug goes through `normalizeGenreSlug` and is
            // skipped unless it matches SAFE_GENRE_SLUG_RE, so by the
            // time we reach this bulkWrite the only slugs in `genreBulkOps`
            // are already safe.
            if (genreBulkOps.length > 0) {
              await Genre.bulkWrite(genreBulkOps, { ordered: false });
              logger.log(`✅ Genre batch complete: ${genreBulkOps.length} genre slugs updated`);
            }
          }
          
          logger.log(`✅ Genre slugs: ${genreUpdated} genres updated`);
          
          // ==== GENERATE USER SLUGS (BATCH OPTIMIZED) ====
          logger.log('👥 Phase 3: Generating user slugs (batch optimized)...');
          const users = regenerateAll 
            ? await User.find({}).lean()
            : await User.find({ $or: [{ slug: { $exists: false } }, { slug: "" }, { slug: null }] }).lean();
          let userUpdated = 0;
          
          if (users.length > 0) {
            const userBulkOps = [];
            
            for (const user of users) {
              try {
                // Check if job was stopped
                const currentJob = slugGenerationJobs.get(jobId);
                if (currentJob?.status === 'stopped') {
                  logger.log('🛑 Job stopped by user, exiting user processing');
                  return;
                }
                
                totalProcessed++;
                
                // Generate unique slug for user (priority: username > fullName > name > email)
                let slugSource = '';
                if (user.username) {
                  slugSource = user.username;
                } else if (user.fullName) {
                  slugSource = user.fullName;
                } else if (user.name) {
                  slugSource = user.name;
                } else if (user.email) {
                  slugSource = user.email.split('@')[0]; // Use email prefix
                } else {
                  slugSource = `user-${user._id}`; // Ultimate fallback
                }
                const newSlug = generateOptimizedUniqueSlug(slugSource);
                
                userBulkOps.push({
                  updateOne: {
                    filter: { _id: user._id },
                    update: { $set: { slug: newSlug } }
                  }
                });
                
                userUpdated++;
                totalUpdated++;
                
                // Update job progress every 25 items
                if (totalProcessed % 25 === 0) {
                  const currentJob = slugGenerationJobs.get(jobId);
                  if (currentJob) {
                    currentJob.progress.current = totalProcessed;
                    slugGenerationJobs.set(jobId, currentJob);
                  }
                  logger.log(`📈 User Progress: ${totalProcessed}/${totalToProcess} processed (${Math.round(totalProcessed/totalToProcess*100)}%)`);
                }
              } catch (error) {
                console.error(`❌ Error processing user ${user._id}:`, error);
              }
            }
            
            // Execute bulk operations for users
            if (userBulkOps.length > 0) {
              await User.bulkWrite(userBulkOps);
              logger.log(`✅ User batch complete: ${userBulkOps.length} user slugs updated`);
            }
          }
          
          logger.log(`✅ User slugs: ${userUpdated} users updated`);
          
          // Final summary
          const completedAt = new Date();
          const duration = Math.round((completedAt.getTime() - startedAt.getTime()) / 1000);
          
          // Mark job as completed
          const finalJob = slugGenerationJobs.get(jobId);
          if (finalJob) {
            finalJob.status = 'completed';
            finalJob.completedAt = completedAt;
            finalJob.progress.current = finalJob.progress.total;
            finalJob.message = `Comprehensive slug generation completed: ${totalUpdated} total entities updated in ${duration}s`;
            slugGenerationJobs.set(jobId, finalJob);
          }

          logger.log('🎉 OPTIMIZED SLUG GENERATION COMPLETED');
          logger.log(`📊 Summary: ${totalUpdated} entities updated in ${duration}s`);
          logger.log(`   • Stations: ${stationUpdated} updated`);
          logger.log(`   • Genres: ${genreUpdated} updated`);
          logger.log(`   • Users: ${userUpdated} updated`);
          logger.log(`⚡ Performance: ~${Math.round(totalUpdated/duration)} entities/second`);
          
          // Optional: Clear cache after slug generation to ensure fresh data
          try {
            await CacheManager.clearByPattern(''); // Clear all cache by using empty pattern if no clearAll exists
            logger.log('🧹 Cache cleared after slug generation');
          } catch (cacheError) {
            logger.warn('⚠️ Cache clear failed:', cacheError);
          }
          
        } catch (error) {
          console.error('❌ Comprehensive slug generation failed:', error);
          
          // Mark job as failed
          const failedJob = slugGenerationJobs.get(jobId);
          if (failedJob) {
            failedJob.status = 'failed';
            failedJob.completedAt = new Date();
            failedJob.error = error instanceof Error ? error.message : 'Unknown error';
            failedJob.message = 'Comprehensive slug generation failed';
            slugGenerationJobs.set(jobId, failedJob);
          }
        }
      });
      
    } catch (error) {
      console.error('❌ Error starting slug generation:', error);
      res.status(500).json({ error: 'Failed to start slug generation' });
    }
  });

  // Admin endpoint to generate slugs for all stations
  app.post("/api/admin/stations/generate-slugs", requireAdmin, async (req, res) => {
    try {
      // Get count of stations for immediate response
      const totalStations = await Station.countDocuments();
      
      // Send immediate response to user - this makes it asynchronous
      res.json({
        success: true,
        message: `Slug generation started in background for ${totalStations} stations`,
        status: 'started',
        totalStations
      });
      
      // Process slug generation in background (non-blocking)
      setImmediate(async () => {
        try {
          logger.log('🏁 Starting background slug generation for all stations...');
          
          // Get all stations in batches to avoid memory issues
          const batchSize = 1000;
          let updated = 0;
          let processed = 0;
          let skip = 0;
          
          // Helper for generateUniqueSlug if not available in this scope
          // In routes.ts this was likely a local function, we should ideally import or define it
          const generateUniqueSlug = async (name: string, type: string, id: string): Promise<string> => {
            const baseSlug = slugifyStationName(name) || 'station';

            let uniqueSlug = baseSlug;
            let counter = 1;
            
            while (true) {
              const existing = await Station.findOne({ slug: uniqueSlug, _id: { $ne: id } });
              if (!existing) break;
              uniqueSlug = `${baseSlug}-${counter}`;
              counter++;
            }
            return uniqueSlug;
          };

          while (true) {
            // Get batch of stations
            const stations = await Station.find()
              .select('_id name url homepage tags bitrate lastCheckOk noIndex')
              .skip(skip)
              .limit(batchSize)
              .lean();
            
            if (stations.length === 0) {
              break; // No more stations to process
            }
            
            // Process batch
            for (const station of stations) {
              try {
                processed++;
                
                // Generate unique slug for this station
                const newSlug = await generateUniqueSlug(station.name, 'station', station._id.toString());

                // Re-evaluate junk against the slug we're about to persist so
                // codec-suffix matches (incl. collision suffixes like
                // `-mp3-1`) are caught at assignment time.
                const update: { slug: string; noIndex?: true } = { slug: newSlug };
                const verdict = evaluateJunkStation({
                  name: station.name,
                  slug: newSlug,
                  url: station.url,
                  homepage: station.homepage,
                  tags: station.tags,
                  bitrate: station.bitrate,
                  lastCheckOk: station.lastCheckOk,
                  lastCheckOkTime: station.lastCheckOkTime,
                  lastCheckTime: station.lastCheckTime,
                });
                if (verdict.isJunk && station.noIndex !== true) {
                  update.noIndex = true;
                }

                // Update station with new slug
                await Station.updateOne(
                  { _id: station._id },
                  { $set: update }
                );
                
                updated++;
                
                if (processed % 1000 === 0) {
                  logger.log(`📊 Slug progress: ${processed}/${totalStations} stations processed, ${updated} updated`);
                }
              } catch (error) {
                console.error(`❌ Error processing station ${station._id}:`, error);
              }
            }
            
            skip += batchSize;
            
            // Small delay between batches to prevent overwhelming the database
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          
          logger.log(`✅ Background slug generation completed! Processed: ${processed}, Updated: ${updated}`);
          
        } catch (error) {
          console.error('❌ Background slug generation failed:', error);
        }
      });
      
    } catch (error) {
      console.error('❌ Error starting slug generation:', error);
      res.status(500).json({ 
        error: 'Failed to start slug generation',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
}
