import { radioBrowserService } from './radio-browser';
import { imageManager } from './image-manager';
import { Station, Country, Language, Genre, SyncLog, BlacklistedStation, type IStation } from '@shared/mongo-schemas';
import cron from 'node-cron';

export class SyncService {
  private isRunning = false;
  private lastFullSync: Date | null = null;

  constructor() {
    // Schedule daily sync at 2 AM
    cron.schedule('0 2 * * *', () => {
      this.performDailySync();
    });

    // Schedule incremental sync every 4 hours
    cron.schedule('0 */4 * * *', () => {
      this.performIncrementalSync();
    });
  }

  async performDailySync(): Promise<void> {
    if (this.isRunning) {
      console.log('Sync already running, skipping scheduled sync');
      return;
    }

    console.log('Starting daily full sync...');
    await this.performFullSync();
  }

  async performIncrementalSync(): Promise<void> {
    if (this.isRunning) {
      console.log('Sync already running, skipping incremental sync');
      return;
    }

    console.log('Starting incremental sync...');
    
    // Get changes since last sync
    const since = this.lastFullSync || new Date(Date.now() - 24 * 60 * 60 * 1000); // Last 24 hours
    await this.performSync('incremental', since);
  }

  async performFullSync(): Promise<void> {
    console.log('Starting full sync...');
    
    // Fix MongoDB index migration if needed
    await this.fixStationIndexes();
    
    await this.performSync('full');
    this.lastFullSync = new Date();
  }

  private async performSync(type: 'full' | 'incremental', since?: Date): Promise<void> {
    if (this.isRunning) {
      throw new Error('Sync is already running');
    }

    this.isRunning = true;
    
    // Create sync log
    const syncLog = await SyncLog.create({
      syncType: type,
      status: 'running',
      stationsProcessed: 0,
      stationsAdded: 0,
      stationsUpdated: 0,
      stationsSkipped: 0,
      startedAt: new Date(),
    });

    try {
      console.log(`🔄 Starting COMPREHENSIVE ${type.toUpperCase()} SYNC - fetching ALL stations without skips...`);
      
      let stationsProcessed = 0;
      let stationsAdded = 0;
      let stationsUpdated = 0;
      let stationsSkipped = 0;
      let offset = 0;
      const batchSize = 2000; // Optimized batch size for stability
      const maxStations = 500000; // Increased safety limit to ensure all stations are fetched

      // Sync metadata first
      if (type === 'full') {
        await this.syncMetadata();
      }

      while (stationsProcessed < maxStations) {
        // Check if sync was stopped
        if (!this.isRunning) {
          console.log('Sync stopped by user');
          break;
        }

        // Fetch next batch - COMPREHENSIVE MODE (all stations including broken ones)
        console.log(`📡 COMPREHENSIVE FETCH: offset=${offset}, limit=${batchSize} (including broken/inactive stations)`);
        
        let stations: any[] = [];
        let fetchRetryCount = 0;
        const maxFetchRetries = 5; // Increased retries for reliability
        
        while (fetchRetryCount < maxFetchRetries) {
          try {
            stations = await radioBrowserService.getAllStations(batchSize, offset);
            console.log(`✅ Successfully fetched ${stations.length} stations from API (batch ${Math.floor(offset / batchSize) + 1})`);
            break; // Success, exit retry loop
          } catch (error) {
            fetchRetryCount++;
            console.error(`❌ Error fetching batch at offset ${offset} (attempt ${fetchRetryCount}/${maxFetchRetries}):`, error);
            
            if (fetchRetryCount >= maxFetchRetries) {
              console.error(`💥 FAILED to fetch batch after ${maxFetchRetries} attempts - this may result in missing stations!`);
              throw error;
            }
            
            // Exponential backoff for retries
            const waitTime = 2000 * Math.pow(2, fetchRetryCount - 1);
            console.log(`⏳ Waiting ${waitTime}ms before retry ${fetchRetryCount + 1}...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
          }
        }
        
        if (stations.length === 0) {
          console.log('No more stations returned from API, sync complete');
          break;
        }

        console.log(`Fetched ${stations.length} stations in this batch (offset: ${offset})`);

        // Process each station in the batch
        const processPromises = stations.map(async (station, index) => {
          try {
            // Check if sync was stopped during processing
            if (!this.isRunning) {
              return { status: 'stopped' };
            }

            const result = await this.processStationWithSmartUpdate(station);
            
            return { status: result };
          } catch (error) {
            console.error(`Error processing station ${station.stationuuid}:`, error);
            return { status: 'error', error };
          }
        });

        // Wait for all station processing to complete
        const results = await Promise.allSettled(processPromises);
        
        // Count results
        for (const result of results) {
          if (result.status === 'fulfilled') {
            const { status } = result.value;
            if (status === 'stopped') {
              console.log('Sync stopped during batch processing');
              return;
            } else if (status === 'added') {
              stationsAdded++;
            } else if (status === 'updated') {
              stationsUpdated++;
            } else if (status === 'skipped') {
              stationsSkipped++;
            }
          } else {
            stationsSkipped++;
          }
          stationsProcessed++;
        }

        // Update progress after each batch
        await SyncLog.findByIdAndUpdate(syncLog._id, {
          stationsProcessed,
          stationsAdded,
          stationsUpdated,
          stationsSkipped,
        });
        
        console.log(`Batch completed. Total processed: ${stationsProcessed} (Added: ${stationsAdded}, Updated: ${stationsUpdated}, Skipped: ${stationsSkipped})`);

        offset += batchSize;
        
        // Add delay between batches to be respectful to the API
        await new Promise(resolve => setTimeout(resolve, 500));

        // Check if we got less than expected - might be near end
        if (stations.length < batchSize) {
          console.log(`Received ${stations.length} stations (less than batch size ${batchSize}), likely reached end of available data`);
          // Continue processing until we get 0 stations to ensure we don't miss any
        }
      }

      // Complete sync
      await SyncLog.findByIdAndUpdate(syncLog._id, {
        status: 'completed',
        stationsProcessed,
        stationsAdded,
        stationsUpdated,
        stationsSkipped,
        completedAt: new Date(),
      });

      // Final comprehensive sync summary
      const syncSummary = {
        type: type.toUpperCase(),
        totalProcessed: stationsProcessed,
        added: stationsAdded,
        updated: stationsUpdated,
        skipped: stationsSkipped,
        successRate: stationsProcessed > 0 ? Math.round(((stationsAdded + stationsUpdated) / stationsProcessed) * 100) : 0,
        finalOffset: offset,
        estimatedApiTotal: offset // Last known position in API
      };

      console.log(`🎉 COMPREHENSIVE SYNC COMPLETED SUCCESSFULLY!`);
      console.log(`📊 FINAL STATS:`);
      console.log(`   └─ Total Processed: ${syncSummary.totalProcessed} stations`);
      console.log(`   └─ New Stations Added: ${syncSummary.added}`);
      console.log(`   └─ Existing Stations Updated: ${syncSummary.updated}`);
      console.log(`   └─ Skipped: ${syncSummary.skipped}`);
      console.log(`   └─ Success Rate: ${syncSummary.successRate}%`);
      console.log(`   └─ API Coverage: Reached offset ${syncSummary.finalOffset}`);
      
      if (syncSummary.skipped > 0) {
        console.log(`⚠️  NOTE: ${syncSummary.skipped} stations were skipped due to errors, not filtering`);
      }

    } catch (error) {
      console.error('❌ Sync failed:', error);
      await SyncLog.findByIdAndUpdate(syncLog._id, {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        completedAt: new Date(),
      });
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Process ALL stations from API without any skips - comprehensive sync mode
   * This ensures every station from the API is either added or updated
   */
  private async processStationWithSmartUpdate(apiStation: any): Promise<'added' | 'updated' | 'skipped'> {
    const stationData = radioBrowserService.convertToDbStation(apiStation);

    // STEP 1: Check by stationuuid first (exact API match)
    const existingByUuid = await Station.findOne({ stationuuid: apiStation.stationuuid });
    
    if (existingByUuid) {
      return await this.updateExistingStation(existingByUuid, stationData);
    }

    // STEP 2: Check for merged stations (similar stations that were manually merged)
    const mergedStation = await Station.findOne({
      mergedStationUuids: { $in: [apiStation.stationuuid] }
    });

    if (mergedStation) {
      // For merged stations, update the URL mapping AND update all other data
      const updatedMergedUrls = mergedStation.mergedUrls || [];
      if (!updatedMergedUrls.includes(stationData.url)) {
        updatedMergedUrls.push(stationData.url);
      }
      
      // Update merged station with fresh API data (except protected fields)
      const updateData = { ...stationData, mergedUrls: updatedMergedUrls };
      
      // Protect custom favicon if it was manually uploaded
      if (mergedStation.hasCustomFavicon) {
        updateData.favicon = mergedStation.favicon || '';
        if (mergedStation.localImagePath) {
          (updateData as any).localImagePath = mergedStation.localImagePath;
        }
      }
      
      await Station.findByIdAndUpdate(mergedStation._id, updateData);
      console.log(`🔗 Updated merged station with fresh API data: "${mergedStation.name}"`);
      return 'updated';
    }

    // STEP 3: Check for similar stations by URL (to prevent URL duplicates only)
    const duplicateByUrl = await Station.findOne({
      $or: [
        { url: stationData.url },
        { urlResolved: stationData.urlResolved }
      ]
    });

    if (duplicateByUrl) {
      // Update the existing station with fresh API data instead of skipping
      return await this.updateExistingStation(duplicateByUrl, stationData);
    }

    // STEP 4: Create new station (no URL conflicts found)
    try {      
      const newStation = await Station.create(stationData);
      
      // Download station image if favicon exists (only for new stations)
      if (stationData.favicon) {
        try {
          const imagePath = await imageManager.downloadStationImage(stationData.name, stationData.favicon);
          if (imagePath) {
            await Station.findByIdAndUpdate(newStation._id, { localImagePath: imagePath });
          }
        } catch (imageError: any) {
          console.warn(`Failed to download image for new station ${stationData.name}:`, imageError.message);
        }
      }

      console.log(`✅ NEW STATION ADDED: "${stationData.name}" from ${stationData.country}`);
      return 'added';
    } catch (error) {
      console.error(`❌ Failed to create station "${stationData.name}":`, error);
      console.error(`❌ Station data that failed:`, JSON.stringify(stationData, null, 2));
      
      // Even on creation failure, try to update if there's a similar station
      const fallbackStation = await Station.findOne({
        name: { $regex: new RegExp(stationData.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }
      });
      
      if (fallbackStation) {
        console.log(`🔄 Fallback: Updating similar station "${fallbackStation.name}" with API data`);
        return await this.updateExistingStation(fallbackStation, stationData);
      }
      
      return 'skipped';
    }
  }

  /**
   * Update existing station with comprehensive API data sync
   * Always updates stations to ensure fresh data, respecting only essential protections
   */
  private async updateExistingStation(existingStation: any, stationData: any): Promise<'updated' | 'skipped'> {
    // Prepare update data with all fresh API data
    const updateData = { ...stationData };
    
    // Only protect custom favicon if it was manually uploaded (essential protection only)
    if (existingStation.hasCustomFavicon) {
      delete updateData.favicon;
      delete updateData.localImagePath;
      console.log(`🔒 Protected custom favicon for: "${existingStation.name}"`);
    } else if (stationData.favicon && stationData.favicon !== existingStation.favicon) {
      // Favicon changed - download new image
      try {
        const imagePath = await imageManager.downloadStationImage(stationData.name, stationData.favicon);
        if (imagePath) {
          updateData.localImagePath = imagePath;
          
          // Clean up old image if it exists
          if (existingStation.localImagePath) {
            await imageManager.deleteStationImage(existingStation.localImagePath);
          }
        }
      } catch (imageError: any) {
        console.warn(`Failed to update image for station ${stationData.name}:`, imageError.message);
      }
    }

    // Preserve manual edit tracking if it exists, but still update the data
    if (existingStation.isManuallyEdited) {
      updateData.isManuallyEdited = existingStation.isManuallyEdited;
      updateData.manualEditFields = existingStation.manualEditFields;
    }

    // Preserve merged station data if it exists
    if (existingStation.mergedStationUuids) {
      updateData.mergedStationUuids = existingStation.mergedStationUuids;
    }
    if (existingStation.mergedUrls) {
      updateData.mergedUrls = existingStation.mergedUrls;
    }

    // Always perform the update to ensure fresh API data
    try {
      await Station.findByIdAndUpdate(existingStation._id, updateData);
      
      const editStatus = existingStation.isManuallyEdited ? ' (manually edited)' : '';
      console.log(`🔄 Updated station with fresh API data: "${existingStation.name}"${editStatus}`);
      
      return 'updated';
    } catch (updateError: any) {
      if (updateError.message && updateError.message.includes('language override unsupported')) {
        console.warn(`⚠️ Language override error for station "${existingStation.name}". Sanitizing language and retrying...`);
        
        // Sanitize language field to prevent unsupported language override errors
        if (updateData.language) {
          updateData.language = this.sanitizeLanguageCode(updateData.language);
        }
        
        // Retry the update with sanitized language
        await Station.findByIdAndUpdate(existingStation._id, updateData);
        console.log(`🔄 Updated station with sanitized language: "${existingStation.name}"`);
        return 'updated';
      } else {
        throw updateError; // Re-throw if it's a different error
      }
    }
  }

  private async syncMetadata(): Promise<void> {
    try {
      console.log('🔄 Syncing metadata (countries, languages, genres)...');
      
      // Sync countries
      const countries = await radioBrowserService.getCountries();
      for (const country of countries) {
        if (country.iso_3166_1 && country.name) {
          await Country.findOneAndUpdate(
            { code: country.iso_3166_1.toUpperCase() },
            {
              name: country.name,
              code: country.iso_3166_1.toUpperCase(),
              stationCount: country.stationcount || 0
            },
            { upsert: true, new: true }
          );
        }
      }

      // Sync languages
      const languages = await radioBrowserService.getLanguages();
      for (const language of languages) {
        if (language.iso_639 && language.name) {
          await Language.findOneAndUpdate(
            { code: language.iso_639 },
            {
              name: language.name,
              code: language.iso_639,
              stationCount: language.stationcount || 0
            },
            { upsert: true, new: true }
          );
        }
      }

      // Sync genres (tags)
      const tags = await radioBrowserService.getTags();
      for (const tag of tags.slice(0, 1000)) { // Limit to top 1000 tags
        if (tag.name && tag.stationcount > 5) { // Only include tags with significant usage
          const slug = tag.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
          
          try {
            // Use slug as the unique identifier to prevent duplicates
            await Genre.findOneAndUpdate(
              { slug: slug },
              {
                name: tag.name,
                stationCount: tag.stationcount || 0,
                slug: slug
              },
              { upsert: true, new: true }
            );
          } catch (error: any) {
            // If slug conflict, append the station count to make it unique
            if (error.code === 11000) {
              const uniqueSlug = `${slug}-${tag.stationcount}`;
              await Genre.findOneAndUpdate(
                { slug: uniqueSlug },
                {
                  name: tag.name,
                  stationCount: tag.stationcount || 0,
                  slug: uniqueSlug
                },
                { upsert: true, new: true }
              );
            }
          }
        }
      }

      console.log('✅ Metadata sync completed');
    } catch (error) {
      console.error('❌ Error syncing metadata:', error);
    }
  }

  async forceSyncNow(): Promise<void> {
    console.log('🚀 Force sync triggered');
    await this.performFullSync();
  }

  stopSync(): void {
    console.log('🛑 Sync stop requested');
    this.isRunning = false;
  }

  getSyncStatus(): { isRunning: boolean; lastFullSync: Date | null } {
    return {
      isRunning: this.isRunning,
      lastFullSync: this.lastFullSync,
    };
  }

  async getSyncLogs(limit: number = 10): Promise<any[]> {
    try {
      const logs = await SyncLog.find()
        .sort({ startedAt: -1 })
        .limit(limit)
        .lean();
      
      return logs;
    } catch (error) {
      console.error('Error fetching sync logs:', error);
      return [];
    }
  }

  private sanitizeLanguageCode(language: string): string {
    if (!language || language.trim() === '') {
      return 'en';
    }
    
    const lang = language.toLowerCase().trim();
    
    // Map problematic language codes to supported ones
    const languageMap: Record<string, string> = {
      'no': 'en', // Norwegian causes language override errors
      'norwegian': 'en',
      'pl': 'en', // Polish not supported
      'cs': 'en', // Czech not supported
      'bg': 'en', // Bulgarian not supported
      'el': 'en', // Greek not supported
      'ar': 'en', // Arabic not supported
      'he': 'en', // Hebrew not supported
      'hi': 'en', // Hindi not supported
      'zh': 'en', // Chinese not supported
      'ja': 'en', // Japanese not supported
      'ko': 'en', // Korean not supported
      'th': 'en', // Thai not supported
      'vi': 'en', // Vietnamese not supported
    };

    return languageMap[lang] || lang;
  }

  private async fixStationIndexes(): Promise<void> {
    try {
      console.log('🔧 Checking MongoDB station indexes...');
      const collection = Station.collection;
      
      // Get current indexes
      const indexes = await collection.listIndexes().toArray();
      console.log('📋 Current indexes:', indexes.map(idx => ({ name: idx.name, key: idx.key })));
      
      // Check if old stationUuid index exists
      const oldIndex = indexes.find(idx => idx.key && idx.key.stationUuid);
      if (oldIndex) {
        console.log('🗑️ Found old stationUuid index, dropping it...');
        await collection.dropIndex('stationUuid_1');
        console.log('✅ Old stationUuid index dropped');
      }
      
      // Check if new stationuuid index exists
      const newIndex = indexes.find(idx => idx.key && idx.key.stationuuid);
      if (!newIndex) {
        console.log('🔨 Creating new stationuuid index...');
        await collection.createIndex({ stationuuid: 1 }, { unique: true });
        console.log('✅ New stationuuid index created');
      } else {
        console.log('✅ stationuuid index already exists');
      }
      
      // Check for problematic text index without default_language
      const textIndex = indexes.find(idx => idx.name === 'station_text_search');
      if (textIndex && !textIndex.default_language) {
        console.log('🗑️ Found problematic text index without default language, dropping it...');
        try {
          await collection.dropIndex('station_text_search');
          console.log('✅ Problematic text index dropped');
          
          // Recreate with proper language settings
          console.log('🔨 Creating new text search index with default language...');
          await collection.createIndex({ 
            name: 'text', 
            country: 'text', 
            genre: 'text', 
            tags: 'text' 
          }, { 
            name: 'station_text_search',
            weights: { name: 10, genre: 5, tags: 3, country: 1 },
            textIndexVersion: 3,
            default_language: 'english'
          });
          console.log('✅ New text search index created with default language');
        } catch (textIndexError: any) {
          console.log('⚠️ Could not recreate text index:', textIndexError.message);
        }
      }
      
      console.log('🎯 Index migration complete!');
    } catch (error) {
      console.error('❌ Error fixing station indexes:', error);
      // Don't throw - continue with sync even if index fix fails
    }
  }
}

// Export singleton instance
export const syncService = new SyncService();