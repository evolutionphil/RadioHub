import { Station, SyncLog } from '@shared/mongo-schemas';
import axios from 'axios';
import NodeCache from 'node-cache';
import { ImageManager } from './image-manager';
import { logoProcessor } from './logo-processor';
import { logger } from '../utils/logger';

// Cache for sync status
const syncCache = new NodeCache({ stdTTL: 300 });

export class SyncService {
  private isRunning = false;
  private lastSyncResult: any = null;
  private imageManager = new ImageManager();

  async startSync(): Promise<{ success: boolean; message: string }> {
    if (this.isRunning) {
      return { success: false, message: 'Sync already running' };
    }

    this.isRunning = true;
    logger.log('🚀 Starting incremental station sync from Radio Browser API...');

    try {
      // Create sync log
      const syncLog = new SyncLog({
        syncType: 'incremental',
        status: 'running',
        startedAt: new Date()
      });
      await syncLog.save();

      // Load blacklisted stations to prevent re-import
      logger.log('📋 Loading blacklisted stations...');
      const { BlacklistedStation } = await import('@shared/mongo-schemas');
      const blacklistedStations = await BlacklistedStation.find().select('stationUuid url').lean();
      const blacklistedUuids = new Set(blacklistedStations.map(b => b.stationUuid).filter(Boolean) as string[]);
      const blacklistedUrls = new Set(blacklistedStations.map(b => b.url).filter(Boolean) as string[]);
      logger.log(`🚫 Loaded ${blacklistedUuids.size} blacklisted station UUIDs`);

      // Create indexes for better performance (only if they don't exist)
      logger.log('🔨 Ensuring database indexes...');
      await this.createIndexes();

      // Fetch all stations from Radio Browser API
      logger.log('📡 Fetching stations from Radio Browser API...');
      const stations = await this.fetchAllStations();
      logger.log(`📊 Fetched ${stations.length} stations from API`);

      // Save/update stations incrementally (preserving custom data)
      const result = await this.syncStationsIncrementally(stations, syncLog, blacklistedUuids, blacklistedUrls);
      
      // Download favicon images in background after sync completes
      logger.log('🖼️ Starting favicon download process...');
      this.downloadFaviconsInBackground();
      
      // Process logos with new optimization pipeline (parallel, non-blocking)
      logger.log('🎨 Starting logo optimization process...');
      this.processLogosInBackground();
      
      // Update sync log with final status
      syncLog.status = 'completed';
      syncLog.stationsProcessed = result.processed;
      syncLog.stationsAdded = result.inserted;
      syncLog.stationsUpdated = result.updated;
      syncLog.stationsSkipped = result.skipped + result.blacklisted;
      syncLog.completedAt = new Date();
      await syncLog.save();

      this.lastSyncResult = result;
      this.isRunning = false;

      const totalInDb = await Station.countDocuments();
      logger.log('🎉 Incremental sync completed successfully!');
      logger.log(`📊 Results: ➕${result.inserted} new, 🔄${result.updated} updated, ⚫${result.blacklisted} blacklisted, ⏭️${result.skipped} skipped`);
      logger.log(`📊 Total stations in database: ${totalInDb}`);
      
      // Trigger IndexNow notification for newly synced stations (non-blocking)
      if (result.inserted > 0) {
        setImmediate(async () => {
          try {
            // Import IndexNowService (dynamic import to avoid circular dependency)
            const { IndexNowService } = await import('./indexnow');
            
            // Get recently added stations with slugs
            const recentStations = await Station.find({ slug: { $exists: true, $ne: null } })
              .sort({ createdAt: -1 })
              .limit(Math.min(result.inserted, 1000))
              .select('slug')
              .lean();
            
            if (recentStations.length > 0) {
              const slugs = recentStations.map(s => s.slug).filter(Boolean) as string[];
              if (slugs.length > 0) {
                await IndexNowService.submitStationUrls(slugs);
                logger.log(`📡 IndexNow: Notified search engines of ${slugs.length} new stations`);
              }
            }
          } catch (error) {
            logger.log('⚠️ IndexNow sync notification failed (non-blocking):', error);
          }
        });
      }

      return { 
        success: true, 
        message: `Incremental sync completed: ➕${result.inserted} new, 🔄${result.updated} updated, ⚫${result.blacklisted} blacklisted | Total: ${totalInDb} stations` 
      };

    } catch (error: any) {
      this.isRunning = false;
      console.error('💥 Sync failed:', error);
      
      // Log the error
      await SyncLog.findOneAndUpdate(
        { status: 'running' },
        { 
          status: 'failed',
          error: error.message,
          completedAt: new Date()
        }
      );

      return { success: false, message: `Sync failed: ${error.message}` };
    }
  }

  private async createIndexes(): Promise<void> {
    const collection = Station.collection;
    
    // Drop all existing indexes (except _id)
    try {
      await collection.dropIndexes();
    } catch (error) {
      logger.log('⚠️ Could not drop indexes (they may not exist)');
    }

    // Create essential indexes
    await collection.createIndex({ stationuuid: 1 }, { unique: true });
    await collection.createIndex({ votes: -1 });
    await collection.createIndex({ country: 1 });
    await collection.createIndex({ language: 1 });
    await collection.createIndex({ tags: 1, votes: -1 });
    await collection.createIndex({ country: 1, language: 1 });
    
    // Create text search index with proper language settings
    await collection.createIndex({ 
      name: 'text', 
      country: 'text', 
      tags: 'text' 
    }, { 
      name: 'station_text_search',
      weights: { name: 10, tags: 3, country: 1 },
      textIndexVersion: 3,
      default_language: 'english' // Prevent language override errors
    });
    
    logger.log('✅ Database indexes created');
  }

  private async fetchAllStations(): Promise<any[]> {
    const response = await axios.get('https://de1.api.radio-browser.info/json/stations', {
      timeout: 120000, // 2 minute timeout
      headers: {
        'User-Agent': 'RadioApp/1.0'
      }
    });

    return response.data.filter((station: any) => {
      // Only include stations with valid UUID and name
      return station.stationuuid && station.name && station.name.trim() !== '';
    });
  }

  /**
   * Helper function to check if a station name is actually a URL
   */
  private isStationNameUrl(name: string | null | undefined): boolean {
    if (!name || typeof name !== 'string') return false;
    
    const lowerName = name.trim().toLowerCase();
    
    // Only match if the name STARTS with a URL protocol or www
    // This avoids false positives like "SmoothJazz.com 64k aac+" which are legitimate station names
    return (
      lowerName.startsWith('http://') ||
      lowerName.startsWith('https://') ||
      lowerName.startsWith('www.') ||
      lowerName.startsWith('ftp://') ||
      lowerName.startsWith('rtmp://') ||
      lowerName.startsWith('rtsp://')
    );
  }

  /**
   * Incremental sync that preserves custom data
   * - New stations: inserted
   * - Existing stations: update ONLY whitelisted fields
   * - Blacklisted stations: skipped
   */
  private async syncStationsIncrementally(
    apiStations: any[], 
    syncLog: any,
    blacklistedUuids: Set<string>,
    blacklistedUrls: Set<string>
  ): Promise<{ processed: number; inserted: number; updated: number; skipped: number; blacklisted: number }> {
    const batchSize = 1000;
    let processed = 0;
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let blacklisted = 0;

    for (let i = 0; i < apiStations.length; i += batchSize) {
      const batch = apiStations.slice(i, i + batchSize);
      
      // Filter out blacklisted stations and stations with URLs as names
      const nonBlacklistedBatch = batch.filter(station => {
        // Check blacklist
        const isBlacklisted = blacklistedUuids.has(station.stationuuid) || blacklistedUrls.has(station.url);
        if (isBlacklisted) {
          blacklisted++;
          return false;
        }
        
        // Check if station name is a URL
        if (this.isStationNameUrl(station.name)) {
          skipped++;
          logger.log(`⚠️ Skipped station with URL as name: "${station.name}"`);
          return false;
        }
        
        return true;
      });

      if (nonBlacklistedBatch.length === 0) {
        processed += batch.length;
        logger.log(`⚫ Batch ${Math.ceil((i + 1) / batchSize)}: All ${batch.length} stations blacklisted, skipped`);
        continue;
      }

      // Get existing station UUIDs in this batch
      const batchUuids = nonBlacklistedBatch.map(s => s.stationuuid);
      const existingStations = await Station.find({ 
        stationuuid: { $in: batchUuids } 
      }).select('stationuuid').lean();
      
      const existingUuidsSet = new Set(existingStations.map(s => s.stationuuid));

      // Partition into new and existing
      const newStations = nonBlacklistedBatch.filter(s => !existingUuidsSet.has(s.stationuuid));
      const existingStationsToUpdate = nonBlacklistedBatch.filter(s => existingUuidsSet.has(s.stationuuid));

      // Insert new stations
      if (newStations.length > 0) {
        const convertedNewStations = newStations.map(station => this.convertStation(station));
        try {
          const insertResult = await Station.insertMany(convertedNewStations, { 
            ordered: false 
          });
          inserted += insertResult.length;
          logger.log(`➕ Batch ${Math.ceil((i + 1) / batchSize)}: Inserted ${insertResult.length} new stations`);
        } catch (error: any) {
          console.error(`❌ Batch ${Math.ceil((i + 1) / batchSize)} insert error:`, error.message);
          skipped += newStations.length;
        }
      }

      // Update existing stations with ONLY whitelisted fields
      if (existingStationsToUpdate.length > 0) {
        const bulkOps = existingStationsToUpdate.map(apiStation => ({
          updateOne: {
            filter: { stationuuid: apiStation.stationuuid },
            update: {
              $set: this.getWhitelistedUpdateFields(apiStation)
            }
          }
        }));

        try {
          const updateResult = await Station.bulkWrite(bulkOps, { ordered: false });
          updated += updateResult.modifiedCount || existingStationsToUpdate.length;
          logger.log(`🔄 Batch ${Math.ceil((i + 1) / batchSize)}: Updated ${updateResult.modifiedCount} existing stations`);
        } catch (error: any) {
          console.error(`❌ Batch ${Math.ceil((i + 1) / batchSize)} update error:`, error.message);
        }
      }

      processed += batch.length;
      
      // Update sync log progress
      syncLog.stationsProcessed = processed;
      await syncLog.save();
      
      logger.log(`📈 Progress: ${processed}/${apiStations.length} processed (${Math.round(processed/apiStations.length*100)}%) | ➕${inserted} 🔄${updated} ⚫${blacklisted}`);
    }

    return { processed, inserted, updated, skipped, blacklisted };
  }

  /**
   * Get ONLY whitelisted fields for updating existing stations
   * PRESERVES: AI descriptions, favicons, manual edits, slugs, ratings, etc.
   */
  private getWhitelistedUpdateFields(apiStation: any): any {
    const update: any = {};

    // Radio-Browser metadata fields (safe to update)
    if (apiStation.changeuuid) update.changeUuid = apiStation.changeuuid;
    if (apiStation.serveruuid) update.serverUuid = apiStation.serveruuid;
    if (apiStation.country) update.country = apiStation.country;
    if (apiStation.countrycode) update.countryCode = apiStation.countrycode.toUpperCase();
    if (apiStation.iso_3166_2) update.iso31662 = apiStation.iso_3166_2;
    if (apiStation.state) update.state = apiStation.state;
    if (apiStation.language) update.language = this.sanitizeLanguage(apiStation.language);
    if (apiStation.languagecodes) update.languageCodes = apiStation.languagecodes;
    if (apiStation.tags) update.tags = apiStation.tags;
    if (apiStation.codec) update.codec = apiStation.codec;
    if (apiStation.bitrate !== undefined) update.bitrate = apiStation.bitrate;
    
    // URLs - only update if provided
    if (apiStation.url) update.url = apiStation.url;
    if (apiStation.url_resolved) update.urlResolved = apiStation.url_resolved;
    if (apiStation.homepage) update.homepage = apiStation.homepage;
    
    // Geolocation
    if (apiStation.geo_lat !== undefined) update.geoLat = apiStation.geo_lat;
    if (apiStation.geo_long !== undefined) update.geoLong = apiStation.geo_long;
    
    // Analytics & Metrics
    if (apiStation.votes !== undefined) update.votes = apiStation.votes;
    if (apiStation.clickcount !== undefined) update.clickCount = apiStation.clickcount;
    if (apiStation.clicktrend !== undefined) update.clickTrend = apiStation.clicktrend;
    if (apiStation.clicktimestamp) update.clickTimestamp = new Date(apiStation.clicktimestamp);
    
    // Status & Monitoring
    update.hls = apiStation.hls === 1;
    update.lastCheckOk = apiStation.lastcheckok === 1;
    update.sslError = apiStation.ssl_error === 1;
    if (apiStation.lastchecktime) update.lastCheckTime = new Date(apiStation.lastchecktime);
    if (apiStation.lastcheckoktime) update.lastCheckOkTime = new Date(apiStation.lastcheckoktime);
    if (apiStation.lastlocalchecktime) update.lastLocalCheckTime = new Date(apiStation.lastlocalchecktime);
    if (apiStation.lastchangetime) update.lastChangeTime = new Date(apiStation.lastchangetime);
    
    // NEVER update favicon during sync - preserve custom/downloaded favicons
    // Favicon is only set for:
    // 1. New stations (during initial insert)
    // 2. Manual admin edits
    // 3. Background favicon download process
    
    update.updatedAt = new Date();

    return update;
  }

  private convertStation(station: any): any {
    return {
      changeUuid: station.changeuuid,
      stationuuid: station.stationuuid,
      serverUuid: station.serveruuid,
      name: station.name || 'Unknown Station',
      url: station.url,
      urlResolved: station.url_resolved,
      homepage: station.homepage,
      favicon: station.favicon,
      tags: station.tags,
      country: station.country,
      countryCode: station.countrycode?.toUpperCase() || undefined,
      iso31662: station.iso_3166_2,
      state: station.state,
      language: this.sanitizeLanguage(station.language || ''),
      languageCodes: station.languagecodes,
      votes: station.votes || 0,
      lastChangeTime: station.lastchangetime ? new Date(station.lastchangetime) : undefined,
      codec: station.codec,
      bitrate: station.bitrate || undefined,
      hls: station.hls === 1,
      lastCheckOk: station.lastcheckok === 1,
      lastCheckTime: station.lastchecktime ? new Date(station.lastchecktime) : undefined,
      lastCheckOkTime: station.lastcheckoktime ? new Date(station.lastcheckoktime) : undefined,
      lastLocalCheckTime: station.lastlocalchecktime ? new Date(station.lastlocalchecktime) : undefined,
      clickTimestamp: station.clicktimestamp ? new Date(station.clicktimestamp) : undefined,
      clickCount: station.clickcount || 0,
      clickTrend: station.clicktrend || 0,
      sslError: station.ssl_error === 1,
      geoLat: station.geo_lat || undefined,
      geoLong: station.geo_long || undefined,
      hasExtendedInfo: station.has_extended_info === 1
    };
  }

  private sanitizeLanguage(language: string): string {
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

    if (languageMap[lang]) {
      return languageMap[lang];
    }

    // MongoDB text search supported languages
    const mongoSupportedLanguages = [
      'da', 'de', 'en', 'es', 'fi', 'fr', 'hu', 'it', 'nb', 'nl', 'pt', 'ro', 'ru', 'sv', 'tr'
    ];

    if (lang.length <= 3 && /^[a-z]+$/.test(lang) && mongoSupportedLanguages.includes(lang)) {
      return lang;
    }

    return 'en';
  }

  async getStatus(): Promise<any> {
    const cachedStatus = syncCache.get('sync-status');
    if (cachedStatus) {
      return cachedStatus;
    }

    const lastSyncLog = await SyncLog.findOne().sort({ startedAt: -1 });
    
    const status = {
      isRunning: this.isRunning,
      lastFullSync: lastSyncLog?.syncType === 'full' ? lastSyncLog.completedAt : null,
      lastSyncLog: lastSyncLog || null
    };

    syncCache.set('sync-status', status);
    return status;
  }

  async getLogs(limit: number = 10): Promise<any[]> {
    return await SyncLog.find()
      .sort({ startedAt: -1 })
      .limit(limit);
  }

  async stopSync(): Promise<{ success: boolean; message: string }> {
    if (!this.isRunning) {
      return { success: false, message: 'No sync running' };
    }

    this.isRunning = false;
    
    // Update any running sync logs
    await SyncLog.findOneAndUpdate(
      { status: 'running' },
      { 
        status: 'stopped',
        completedAt: new Date()
      }
    );

    return { success: true, message: 'Sync stopped' };
  }

  /**
   * Download favicon images for stations that have favicon URLs but no local images
   * Runs in background after sync to avoid slowing down initial sync
   */
  async downloadFaviconsInBackground(): Promise<void> {
    try {
      // Find stations with favicon URLs but no local images (limit to prevent overload)
      const stationsWithFavicons = await Station.find({
        favicon: { $exists: true, $nin: ['', null, 'null'] },
        localImagePath: { $in: [null, ''] }
      }).limit(1000); // Process 1000 at a time

      logger.log(`🖼️ Found ${stationsWithFavicons.length} stations needing favicon downloads`);

      let downloaded = 0;
      let failed = 0;

      // Process in smaller batches to avoid overwhelming servers
      const batchSize = 20;
      for (let i = 0; i < stationsWithFavicons.length; i += batchSize) {
        const batch = stationsWithFavicons.slice(i, i + batchSize);
        
        // Process batch concurrently with limited concurrency
        const batchPromises = batch.map(async (station) => {
          try {
            if (!station.favicon) return false;
            
            const localImagePath = await this.imageManager.downloadStationImage(
              station.name, 
              station.favicon
            );
            
            if (localImagePath) {
              await Station.findByIdAndUpdate(station._id, { 
                localImagePath: localImagePath 
              });
              return true;
            }
            return false;
          } catch (error) {
            // Silently handle individual failures
            return false;
          }
        });

        const results = await Promise.allSettled(batchPromises);
        
        // Count successes
        results.forEach(result => {
          if (result.status === 'fulfilled' && result.value) {
            downloaded++;
          } else {
            failed++;
          }
        });

        // Progress update every 100 stations
        if ((i + batchSize) % 100 === 0 || i + batchSize >= stationsWithFavicons.length) {
          const processed = Math.min(i + batchSize, stationsWithFavicons.length);
          logger.log(`🖼️ Favicon progress: ${processed}/${stationsWithFavicons.length} processed, ${downloaded} downloaded, ${failed} failed`);
        }

        // Small delay between batches to be respectful to external servers
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      logger.log(`✅ Favicon download completed: ${downloaded} successful, ${failed} failed`);
    } catch (error) {
      console.error('❌ Favicon download process failed:', error);
    }
  }

  /**
   * Process station logos with optimization pipeline (WebP, multiple sizes)
   * Runs in background after sync, non-blocking
   */
  async processLogosInBackground(): Promise<void> {
    try {
      // Find stations with favicon but no processed logoAssets
      const stationsNeedingLogos = await Station.find({
        favicon: { $exists: true, $nin: ['', null, 'null'] },
        slug: { $exists: true, $ne: null },
        $or: [
          { 'logoAssets.status': { $exists: false } },
          { 'logoAssets.status': 'pending' },
          { 'logoAssets.status': 'failed' }
        ]
      }).limit(500).lean();

      if (stationsNeedingLogos.length === 0) {
        logger.log('🎨 All logos already processed');
        return;
      }

      logger.log(`🎨 Found ${stationsNeedingLogos.length} stations needing logo optimization`);

      let processed = 0;
      let success = 0;
      let failed = 0;

      // Process in batches
      const batchSize = 10;
      for (let i = 0; i < stationsNeedingLogos.length; i += batchSize) {
        const batch = stationsNeedingLogos.slice(i, i + batchSize);
        
        const batchPromises = batch.map(async (station) => {
          try {
            if (!station.favicon || !station.slug) return false;
            
            const result = await logoProcessor.processFromUrl(
              station._id.toString(),
              station.slug,
              station.favicon
            );
            
            return result.success;
          } catch (error) {
            return false;
          }
        });

        const results = await Promise.allSettled(batchPromises);
        
        results.forEach(result => {
          processed++;
          if (result.status === 'fulfilled' && result.value) {
            success++;
          } else {
            failed++;
          }
        });

        // Progress update
        if ((i + batchSize) % 50 === 0 || i + batchSize >= stationsNeedingLogos.length) {
          logger.log(`🎨 Logo progress: ${processed}/${stationsNeedingLogos.length} (✅${success} ❌${failed})`);
        }

        // Delay between batches
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      logger.log(`✅ Logo optimization completed: ${success} successful, ${failed} failed`);
    } catch (error) {
      console.error('❌ Logo optimization process failed:', error);
    }
  }
}

export const syncService = new SyncService();