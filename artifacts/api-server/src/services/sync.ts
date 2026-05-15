import mongoose from 'mongoose';
import { Station, SyncLog } from '@workspace/db-shared/mongo-schemas';
import axios from 'axios';
import NodeCache from 'node-cache';
import { ImageManager } from './image-manager';
import { logoProcessor } from './logo-processor';
import { logger } from '../utils/logger';
import {
  evaluateJunkStation,
  slugifyStationName,
  frequencyPrefixBaseSlug,
} from '../seo/junk-station-rules';

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
      await this.withMongoRetry('syncLog.create', () => syncLog.save());

      // Load blacklisted stations to prevent re-import
      logger.log('📋 Loading blacklisted stations...');
      const { BlacklistedStation } = await import('@workspace/db-shared/mongo-schemas');
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

      logger.log(`🚯 Auto-flagged ${result.autoFlagged} junk stations during ingest`);
      
      // Download favicon images in background after sync completes
      logger.log('🖼️ Starting favicon download process...');
      this.downloadFaviconsInBackground();
      
      // Process logos with new optimization pipeline (parallel, non-blocking)
      logger.log('🎨 Starting logo optimization process...');
      this.processLogosInBackground();

      // Hydrate stations whose `tags` field is missing/empty by re-fetching
      // them from Radio-Browser by stationuuid (TR audit P2). Non-blocking.
      logger.log('🏷️ Starting missing-tags hydration...');
      this.hydrateMissingTagsInBackground();
      
      // Update sync log with final status
      syncLog.status = 'completed';
      syncLog.stationsProcessed = result.processed;
      syncLog.stationsAdded = result.inserted;
      syncLog.stationsUpdated = result.updated;
      syncLog.stationsSkipped = result.skipped + result.blacklisted;
      syncLog.stationsAutoFlagged = result.autoFlagged;
      syncLog.completedAt = new Date();
      await this.withMongoRetry('syncLog.complete', () => syncLog.save());

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
      // INCIDENT 2026-05-15 v10.1 — sync runs on a periodic interval and
      // is automatically retried on the next tick. A MongoNetworkTimeout
      // mid-cycle is an expected condition during cluster stress, not a
      // 5xx-class error — downgrade to warn so the failure shows up in
      // the live tail without polluting alert dashboards.
      const msg = error?.message || String(error);
      const isNetTimeout = /MongoNetworkTimeoutError|timed out|MaxTimeMSExpired/i.test(msg);
      if (isNetTimeout) {
        logger.warn(`⚠️ Sync skipped (cluster cold, will retry next cycle): ${msg}`);
      } else {
        logger.error('💥 Sync failed:', error);
      }
      
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

    // INCIDENT 2026-05-15: previous version called `collection.dropIndexes()`
    // before recreating, which kills any in-flight admin aggregation that was
    // using one of those indexes. Production logs showed:
    //   "PlanExecutor error during aggregation :: caused by :: query plan
    //    killed :: index 'tags_1' dropped"
    // exactly when the nightly sync ran while admin tags-status-summary was
    // open. We never need to drop these — `createIndex` is idempotent and a
    // no-op when the index already exists with the same definition. The new
    // `background: true` keeps even brand-new index builds non-blocking.
    const ix = (spec: any, opts: any = {}) =>
      collection.createIndex(spec, { background: true, ...opts });

    await ix({ stationuuid: 1 }, { unique: true });
    await ix({ votes: -1 });
    await ix({ country: 1 });
    await ix({ language: 1 });
    await ix({ tags: 1, votes: -1 });
    await ix({ country: 1, language: 1 });

    // Create text search index with proper language settings
    await ix(
      { name: 'text', country: 'text', tags: 'text' },
      {
        name: 'station_text_search',
        weights: { name: 10, tags: 3, country: 1 },
        textIndexVersion: 3,
        default_language: 'english', // Prevent language override errors
      },
    );

    logger.log('✅ Database indexes ensured (idempotent, no drop)');
  }

  /**
   * Retry helper for transient Mongo write errors during sync. The Mongo node
   * driver already retries idempotent writes once, but in 2026-05-15 we saw a
   * `MongoNetworkTimeoutError` (errorLabel: RetryableWriteError) during a
   * routine sync that aborted the whole job. Wrap the bulk insert/update +
   * syncLog.save() calls so a transient blip costs us a few seconds, not the
   * entire 60K-station ingest.
   */
  private async withMongoRetry<T>(
    op: string,
    fn: () => Promise<T>,
    maxAttempts = 4,
  ): Promise<T> {
    let lastErr: any;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        lastErr = err;
        const labels: Set<string> | undefined = err?.errorLabelSet;
        const isNetTimeout = err?.name === 'MongoNetworkTimeoutError';
        const isRetryable =
          isNetTimeout ||
          (labels && (labels.has('RetryableWriteError') || labels.has('TransientTransactionError'))) ||
          /timed out|topology was destroyed|server selection|ECONNRESET/i.test(err?.message || '');
        if (!isRetryable || attempt >= maxAttempts) {
          throw err;
        }
        const backoff = Math.min(1000 * 2 ** (attempt - 1), 8000) + Math.floor(Math.random() * 250);
        logger.warn(
          `🔁 sync.${op}: retryable error on attempt ${attempt}/${maxAttempts} — backing off ${backoff}ms (${err?.name || 'Error'}: ${(err?.message || '').slice(0, 120)})`,
        );
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
    throw lastErr;
  }

  private async fetchAllStations(): Promise<any[]> {
    // INCIDENT 2026-05-15 v4: every recent force-sync reported the IDENTICAL
    // 998 processed / 934 updated / 64 skipped / 0 added — i.e. the loop ran
    // exactly ONE batch of ~1000 stations each time. Root cause: the
    // de1.api.radio-browser.info `/json/stations` endpoint NO LONGER returns
    // the full ~60K-station catalog by default — current mirror behaviour is
    // a hard 1000-row cap when no `limit` is provided, which silently
    // truncated the entire ingest. Switch to the documented
    // `/json/stations/search` endpoint with explicit limit + offset
    // pagination so we always pull the full catalog, regardless of any
    // future server-side default change. Stop on the first page that comes
    // back smaller than the requested page size (end of catalog reached).
    const PAGE_SIZE = 5000;
    const MAX_PAGES = 100; // hard ceiling — 500K stations is well above the catalog
    const baseUrl =
      'https://de1.api.radio-browser.info/json/stations/search';
    const all: any[] = [];
    const seen = new Set<string>();

    for (let page = 0; page < MAX_PAGES; page++) {
      const offset = page * PAGE_SIZE;
      const response = await axios.get(baseUrl, {
        timeout: 120000,
        headers: { 'User-Agent': 'RadioApp/1.0' },
        params: {
          limit: PAGE_SIZE,
          offset,
          hidebroken: false,
        },
      });
      const rows: any[] = Array.isArray(response.data) ? response.data : [];
      logger.log(
        `📥 Radio-Browser page ${page + 1}: offset=${offset} received=${rows.length}`,
      );
      // Filter + dedupe across pages (mirror occasionally returns dupes near
      // page boundaries when the underlying sort key isn't strictly unique).
      let added = 0;
      for (const station of rows) {
        if (
          station?.stationuuid &&
          station?.name &&
          typeof station.name === 'string' &&
          station.name.trim() !== '' &&
          !seen.has(station.stationuuid)
        ) {
          seen.add(station.stationuuid);
          all.push(station);
          added++;
        }
      }
      logger.log(
        `   ↳ kept ${added} new station(s) (total so far: ${all.length})`,
      );
      // End of catalog: a short page means there is no next page.
      if (rows.length < PAGE_SIZE) break;
    }

    logger.log(`📡 Radio-Browser fetch complete: ${all.length} unique stations`);
    return all;
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
  ): Promise<{ processed: number; inserted: number; updated: number; skipped: number; blacklisted: number; autoFlagged: number }> {
    // INCIDENT 2026-05-15: 1000-doc batches were tripping `socketTimeoutMS=15s`
    // on M10 during peak ingest (60K stations). 300-doc batches are well under
    // the timeout budget and let the per-batch retry helper recover from a
    // single blip without losing the whole sync. Override via env if needed.
    const batchSize = Math.max(50, Math.min(2000, Number(process.env.SYNC_BATCH_SIZE) || 300));
    let processed = 0;
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let blacklisted = 0;
    let autoFlagged = 0;

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

      // Get existing station UUIDs (and the fields needed to auto-flag junk
      // on update — slug for codec-suffix matching, noIndex to detect
      // transitions so we don't double-count already-flagged stations).
      const batchUuids = nonBlacklistedBatch.map(s => s.stationuuid);
      const existingStations = await Station.find({
        stationuuid: { $in: batchUuids }
      }).select('stationuuid slug noIndex').lean();

      const existingByUuid = new Map<string, { slug?: string; noIndex?: boolean }>(
        existingStations.map((s: any) => [s.stationuuid, { slug: s.slug, noIndex: s.noIndex }])
      );

      // Partition into new and existing
      const newStations = nonBlacklistedBatch.filter(s => !existingByUuid.has(s.stationuuid));
      const existingStationsToUpdate = nonBlacklistedBatch.filter(s => existingByUuid.has(s.stationuuid));

      // Insert new stations — auto-mark junk records with noIndex:true so
      // the upstream radio-browser feed cannot quietly re-pollute the sitemap.
      if (newStations.length > 0) {
        let batchAutoFlagged = 0;
        const convertedNewStations = newStations.map(station => {
          const doc = this.convertStation(station);
          // Use the slug we'd generate downstream so codec-suffix rules apply
          // even though `slug` isn't persisted by `convertStation` itself.
          const probeSlug = slugifyStationName(doc.name || '');
          const verdict = evaluateJunkStation({
            name: doc.name,
            slug: probeSlug,
            url: doc.url,
            homepage: doc.homepage,
            tags: doc.tags,
            bitrate: doc.bitrate,
            lastCheckOk: doc.lastCheckOk,
            lastCheckOkTime: doc.lastCheckOkTime,
            lastCheckTime: doc.lastCheckTime,
          });
          if (verdict.isJunk) {
            doc.noIndex = true;
            batchAutoFlagged++;
          }
          return doc;
        });
        try {
          const insertResult = await this.withMongoRetry(
            `insertMany.batch${Math.ceil((i + 1) / batchSize)}`,
            () => Station.insertMany(convertedNewStations, { ordered: false }),
          );
          inserted += insertResult.length;
          autoFlagged += batchAutoFlagged;
          logger.log(`➕ Batch ${Math.ceil((i + 1) / batchSize)}: Inserted ${insertResult.length} new stations (🚯 ${batchAutoFlagged} auto-flagged junk)`);
        } catch (error: any) {
          console.error(`❌ Batch ${Math.ceil((i + 1) / batchSize)} insert error:`, error.message);
          skipped += newStations.length;
        }
      }

      // Update existing stations with ONLY whitelisted fields
      if (existingStationsToUpdate.length > 0) {
        // Frequency-prefix sibling lookup (batch, single query): collect every
        // candidate base slug for this batch and ask the DB which of them
        // actually exist as siblings. The frequency-prefix shape alone is not
        // proof of duplication — only flag when a real sibling exists.
        const freqCandidates = new Map<string, string>(); // stationuuid -> baseSlug
        const baseSlugSet = new Set<string>();
        for (const apiStation of existingStationsToUpdate) {
          const existing = existingByUuid.get(apiStation.stationuuid) || {};
          const slug = existing.slug || slugifyStationName(apiStation.name || '');
          const base = frequencyPrefixBaseSlug(slug);
          if (base) {
            freqCandidates.set(apiStation.stationuuid, base);
            baseSlugSet.add(base);
          }
        }
        let existingBaseSlugs = new Set<string>();
        if (baseSlugSet.size > 0) {
          try {
            const found = await Station.find({
              slug: { $in: Array.from(baseSlugSet) },
            }).select('slug').lean();
            existingBaseSlugs = new Set(found.map((s: any) => s.slug));
          } catch (err) {
            logger.log(`⚠️ Frequency-prefix sibling lookup failed: ${(err as Error).message}`);
          }
        }

        const bulkOps = existingStationsToUpdate.map(apiStation => {
          const existing = existingByUuid.get(apiStation.stationuuid) || {};
          const fields = this.getWhitelistedUpdateFields(apiStation, existing);
          // Re-evaluate junk for the merged view: incoming feed values plus
          // the persisted slug (which is what the sitemap actually emits).
          const verdict = evaluateJunkStation({
            name: apiStation.name,
            slug: existing.slug || slugifyStationName(apiStation.name || ''),
            url: apiStation.url,
            homepage: apiStation.homepage,
            tags: apiStation.tags,
            bitrate: apiStation.bitrate,
            lastCheckOk: apiStation.lastcheckok === 1,
            lastCheckOkTime: apiStation.lastcheckoktime
              ? new Date(apiStation.lastcheckoktime)
              : undefined,
            lastCheckTime: apiStation.lastchecktime
              ? new Date(apiStation.lastchecktime)
              : undefined,
          });
          let isJunk = verdict.isJunk;
          if (!isJunk) {
            const candidateBase = freqCandidates.get(apiStation.stationuuid);
            if (candidateBase && existingBaseSlugs.has(candidateBase)) {
              isJunk = true;
            }
          }
          if (isJunk && existing.noIndex !== true) {
            fields.noIndex = true;
            autoFlagged++;
          }
          return {
            updateOne: {
              filter: { stationuuid: apiStation.stationuuid },
              update: { $set: fields }
            }
          };
        });

        try {
          const updateResult = await this.withMongoRetry(
            `bulkWrite.batch${Math.ceil((i + 1) / batchSize)}`,
            () => Station.bulkWrite(bulkOps, { ordered: false }),
          );
          updated += updateResult.modifiedCount || existingStationsToUpdate.length;
          logger.log(`🔄 Batch ${Math.ceil((i + 1) / batchSize)}: Updated ${updateResult.modifiedCount} existing stations`);
        } catch (error: any) {
          console.error(`❌ Batch ${Math.ceil((i + 1) / batchSize)} update error:`, error.message);
        }
      }

      processed += batch.length;

      // Update sync log progress (best-effort: a transient blip on the
      // progress write must NOT abort the whole 60K-station sync).
      syncLog.stationsProcessed = processed;
      try {
        await this.withMongoRetry(
          `syncLog.progress.batch${Math.ceil((i + 1) / batchSize)}`,
          () => syncLog.save(),
          2, // tighter retry — progress write is non-critical
        );
      } catch (err: any) {
        logger.warn(
          `⚠️ syncLog progress write failed (non-fatal): ${err?.message?.slice(0, 100) || err}`,
        );
      }
      
      logger.log(`📈 Progress: ${processed}/${apiStations.length} processed (${Math.round(processed/apiStations.length*100)}%) | ➕${inserted} 🔄${updated} ⚫${blacklisted} 🚯${autoFlagged}`);
    }

    return { processed, inserted, updated, skipped, blacklisted, autoFlagged };
  }

  /**
   * Get ONLY whitelisted fields for updating existing stations.
   *
   * EXPLICITLY PRESERVED — never touched by sync:
   *   • description / descriptions[lang] (AI translations + manual edits)
   *   • slug, name overrides, noIndex (admin decisions)
   *   • averageRating, totalRatings, ratingBreakdown (user ratings)
   *   • logoAssets, hasLogo, faviconLocal (S3-uploaded logos & local cache)
   *   • favicon — preserved if station already has a logo on S3 (logoAssets/
   *     hasLogo) OR a non-empty favicon URL. Only filled when the station
   *     has no logo at all (see 2026-05-09 change below).
   *
   * UPDATED FROM RADIO-BROWSER (per user spec 2026-05-09):
   *   url, urlResolved, votes, clickCount, country, countryCode, state/iso31662,
   *   codec, bitrate, tags, homepage, favicon (only if currently missing),
   *   plus technical health fields (lastCheckOk, lastChangeTime, hls, sslError).
   */
  private getWhitelistedUpdateFields(apiStation: any, existing: any = {}): any {
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
    
    // FAVICON / LOGO POLICY (2026-05-09 user spec):
    //   "logo url misal s3 deyse zaten veya logosu s3 de ekliyse elemesin
    //    sadece logosu olmayanlarda uygulansin"
    //
    // Translation: never overwrite a station's favicon if it already has
    // ANY logo presence — be it an S3-uploaded asset (`logoAssets`/`hasLogo`),
    // a downloaded local copy (`faviconLocal`), or simply a non-empty favicon
    // URL set previously. Only fill `favicon` from Radio-Browser when the
    // station currently has nothing at all to display.
    //
    // `logoAssets`/`hasLogo`/`faviconLocal` themselves are NEVER updated
    // here — they are managed by `logoProcessor` / `imageManager` /
    // background download jobs only.
    const hasS3Logo =
      existing?.hasLogo === true ||
      (existing?.logoAssets && Object.keys(existing.logoAssets).length > 0);
    const hasLocalFavicon = !!existing?.faviconLocal;
    const hasFaviconUrl = typeof existing?.favicon === 'string' && existing.favicon.trim().length > 0;
    const stationHasAnyLogo = hasS3Logo || hasLocalFavicon || hasFaviconUrl;

    if (!stationHasAnyLogo && apiStation.favicon && typeof apiStation.favicon === 'string' && apiStation.favicon.trim().length > 0) {
      update.favicon = apiStation.favicon;
    }

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

  /**
   * Hydrate `tags` for stations whose tags field is missing or empty
   * (TR audit P2). Re-fetches each station by `stationuuid` from
   * Radio-Browser and writes the upstream `tags` value back.
   *
   * - Skips stations already carrying tags.
   * - Conservative concurrency / batch delay so it can run alongside
   *   live traffic and the favicon + logo background jobs.
   *
   * Stations whose upstream Radio-Browser record returns empty tags are
   * stamped with `tagsCheckedAt = now` and excluded from the candidate
   * filter for a cooldown window (~30 days), so we don't re-query
   * genuinely-empty stations forever.
   */
  async hydrateMissingTagsInBackground(
    options: {
      limit?: number;
      countryCode?: string;
      isCancelled?: () => boolean;
      onProgress?: (progress: {
        processed: number;
        hydrated: number;
        emptyUpstream: number;
        failed: number;
        total: number;
      }) => void;
    } = {},
  ): Promise<{ processed: number; hydrated: number; emptyUpstream: number; failed: number; cancelled?: boolean }> {
    const { isCancelled, onProgress } = options;
    const limit = options.limit ?? 1000;
    const cooldownMs = 30 * 24 * 60 * 60 * 1000; // 30 days
    const cooldownCutoff = new Date(Date.now() - cooldownMs);
    const filter: Record<string, unknown> = {
      stationuuid: { $exists: true, $nin: [null, ''] },
      $or: [
        { tags: { $exists: false } },
        { tags: null },
        { tags: '' },
      ],
      $and: [
        {
          $or: [
            { tagsCheckedAt: { $exists: false } },
            { tagsCheckedAt: null },
            { tagsCheckedAt: { $lt: cooldownCutoff } },
          ],
        },
      ],
    };
    if (options.countryCode) {
      filter.countryCode = options.countryCode.toUpperCase();
    }

    let processed = 0;
    let hydrated = 0;
    let emptyUpstream = 0;
    let failed = 0;
    let cancelled = false;

    try {
      type TagHydrationCandidate = {
        _id: mongoose.Types.ObjectId;
        stationuuid: string;
        name?: string;
      };
      type RadioBrowserTagsResponse = Array<{ tags?: string }>;

      const stations = (await Station.find(filter)
        .select('_id stationuuid name')
        .limit(limit)
        .lean()) as unknown as TagHydrationCandidate[];

      if (stations.length === 0) {
        logger.log('🏷️ No stations need tags hydration');
        if (onProgress) {
          try {
            onProgress({ processed, hydrated, emptyUpstream, failed, total: 0 });
          } catch {
            /* ignore progress callback errors */
          }
        }
        return { processed, hydrated, emptyUpstream, failed };
      }
      const total = stations.length;

      logger.log(
        `🏷️ Found ${stations.length} stations needing tags hydration${
          options.countryCode ? ` (${options.countryCode.toUpperCase()})` : ''
        }`,
      );

      const batchSize = 10;
      for (let i = 0; i < stations.length; i += batchSize) {
        if (isCancelled?.()) {
          cancelled = true;
          logger.log(
            `🛑 Tags hydration cancelled after ${processed}/${stations.length} processed`,
          );
          break;
        }
        const batch = stations.slice(i, i + batchSize);

        const batchResults = await Promise.allSettled(
          batch.map(async (station) => {
            const uuid = station.stationuuid;
            const apiResp = await axios.get<RadioBrowserTagsResponse>(
              `https://de1.api.radio-browser.info/json/stations/byuuid/${encodeURIComponent(uuid)}`,
              {
                timeout: 10000,
                headers: { 'User-Agent': 'MegaRadio/1.0 (tags-hydration)' },
              },
            );
            const remote = Array.isArray(apiResp.data) ? apiResp.data[0] : null;
            const tags =
              remote && typeof remote.tags === 'string' ? remote.tags.trim() : '';
            if (!tags) {
              await Station.updateOne(
                { _id: station._id },
                { $set: { tagsCheckedAt: new Date() } },
              );
              return { hydrated: false, empty: true };
            }
            await Station.updateOne(
              { _id: station._id },
              { $set: { tags, tagsCheckedAt: new Date() } },
            );
            return { hydrated: true, empty: false };
          }),
        );

        for (const r of batchResults) {
          processed++;
          if (r.status === 'fulfilled') {
            if (r.value.hydrated) hydrated++;
            else if (r.value.empty) emptyUpstream++;
          } else {
            failed++;
          }
        }

        if ((i + batchSize) % 100 === 0 || i + batchSize >= stations.length) {
          const done = Math.min(i + batchSize, total);
          logger.log(
            `🏷️ Tags hydration progress: ${done}/${total} (✅${hydrated} ∅${emptyUpstream} ❌${failed})`,
          );
        }

        if (onProgress) {
          try {
            onProgress({ processed, hydrated, emptyUpstream, failed, total });
          } catch {
            /* ignore progress callback errors */
          }
        }

        // Be polite to the upstream API.
        await new Promise((resolve) => setTimeout(resolve, 750));
      }

      logger.log(
        `${cancelled ? '🛑 Tags hydration cancelled' : '✅ Tags hydration completed'}: ${hydrated} hydrated, ${emptyUpstream} upstream-empty, ${failed} failed (of ${processed})`,
      );
    } catch (error) {
      console.error('❌ Tags hydration process failed:', error);
    }

    return { processed, hydrated, emptyUpstream, failed, cancelled };
  }

  /**
   * Admin-triggered: re-query Radio-Browser tags for a single station and
   * write the result back. Bypasses the `tagsCheckedAt` cooldown that
   * `hydrateMissingTagsInBackground` honours, so admins can force a refresh
   * for stations stamped as upstream-empty.
   */
  async recheckStationTags(
    stationId: string,
  ): Promise<{
    success: boolean;
    hydrated: boolean;
    emptyUpstream: boolean;
    tags?: string;
    error?: string;
  }> {
    type RadioBrowserTagsResponse = Array<{ tags?: string }>;
    interface StationTagProjection {
      _id: mongoose.Types.ObjectId;
      stationuuid?: string;
      name?: string;
    }
    if (!mongoose.Types.ObjectId.isValid(stationId)) {
      return { success: false, hydrated: false, emptyUpstream: false, error: 'Invalid stationId' };
    }
    const station = (await Station.findById(stationId)
      .select('_id stationuuid name')
      .lean()) as unknown as StationTagProjection | null;
    if (!station) {
      return { success: false, hydrated: false, emptyUpstream: false, error: 'Station not found' };
    }
    const uuid = station.stationuuid;
    if (!uuid) {
      return {
        success: false,
        hydrated: false,
        emptyUpstream: false,
        error: 'Station has no stationuuid; cannot query Radio-Browser',
      };
    }
    try {
      const apiResp = await axios.get<RadioBrowserTagsResponse>(
        `https://de1.api.radio-browser.info/json/stations/byuuid/${encodeURIComponent(uuid)}`,
        {
          timeout: 10000,
          headers: { 'User-Agent': 'MegaRadio/1.0 (tags-recheck-admin)' },
        },
      );
      const remote = Array.isArray(apiResp.data) ? apiResp.data[0] : null;
      const tags =
        remote && typeof remote.tags === 'string' ? remote.tags.trim() : '';
      const now = new Date();
      if (!tags) {
        await Station.updateOne(
          { _id: station._id },
          { $set: { tagsCheckedAt: now } },
        );
        return { success: true, hydrated: false, emptyUpstream: true, tags: '' };
      }
      await Station.updateOne(
        { _id: station._id },
        { $set: { tags, tagsCheckedAt: now } },
      );
      return { success: true, hydrated: true, emptyUpstream: false, tags };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`🏷️ recheckStationTags failed for ${uuid}: ${message}`);
      return {
        success: false,
        hydrated: false,
        emptyUpstream: false,
        error: message || 'Radio-Browser request failed',
      };
    }
  }

  /**
   * Admin-triggered: re-query Radio-Browser tags for an explicit set of
   * station IDs. Like `recheckStationTags` but processes multiple
   * stations in batches with conservative concurrency, and bypasses the
   * `tagsCheckedAt` cooldown. Used by the bulk admin re-check route so
   * targeted requests actually hit the targeted stations (instead of
   * the global candidate pool that `hydrateMissingTagsInBackground`
   * scans).
   */
  async recheckStationsTagsByIds(
    stationIds: string[],
    onProgress?: (progress: {
      processed: number;
      hydrated: number;
      emptyUpstream: number;
      failed: number;
      total: number;
    }) => void,
    isCancelled?: () => boolean,
  ): Promise<{ processed: number; hydrated: number; emptyUpstream: number; failed: number; cancelled?: boolean }> {
    interface StationTagProjection {
      _id: mongoose.Types.ObjectId;
      stationuuid?: string;
      name?: string;
    }
    type RadioBrowserTagsResponse = Array<{ tags?: string }>;

    const validIds = stationIds.filter((id) =>
      mongoose.Types.ObjectId.isValid(id),
    );
    let processed = 0;
    let hydrated = 0;
    let emptyUpstream = 0;
    let failed = 0;
    let cancelled = false;
    if (validIds.length === 0) {
      return { processed, hydrated, emptyUpstream, failed };
    }

    try {
      const stations = (await Station.find({
        _id: { $in: validIds.map((id) => new mongoose.Types.ObjectId(id)) },
        stationuuid: { $exists: true, $nin: [null, ''] },
      })
        .select('_id stationuuid name')
        .lean()) as unknown as StationTagProjection[];

      if (stations.length === 0) {
        logger.log('🏷️ Bulk re-check: no eligible stations found');
        if (onProgress) {
          try {
            onProgress({ processed, hydrated, emptyUpstream, failed, total: 0 });
          } catch {
            /* ignore progress callback errors */
          }
        }
        return { processed, hydrated, emptyUpstream, failed };
      }
      const total = stations.length;

      logger.log(
        `🏷️ Admin bulk re-check: processing ${stations.length} station(s)`,
      );

      const batchSize = 10;
      for (let i = 0; i < stations.length; i += batchSize) {
        if (isCancelled?.()) {
          cancelled = true;
          logger.log(
            `🛑 Admin bulk re-check cancelled after ${processed}/${total} processed`,
          );
          break;
        }
        const batch = stations.slice(i, i + batchSize);
        const batchResults = await Promise.allSettled(
          batch.map(async (station) => {
            const uuid = station.stationuuid as string;
            const apiResp = await axios.get<RadioBrowserTagsResponse>(
              `https://de1.api.radio-browser.info/json/stations/byuuid/${encodeURIComponent(uuid)}`,
              {
                timeout: 10000,
                headers: { 'User-Agent': 'MegaRadio/1.0 (tags-recheck-admin-bulk)' },
              },
            );
            const remote = Array.isArray(apiResp.data) ? apiResp.data[0] : null;
            const tags =
              remote && typeof remote.tags === 'string' ? remote.tags.trim() : '';
            const now = new Date();
            if (!tags) {
              await Station.updateOne(
                { _id: station._id },
                { $set: { tagsCheckedAt: now } },
              );
              return { hydrated: false, empty: true };
            }
            await Station.updateOne(
              { _id: station._id },
              { $set: { tags, tagsCheckedAt: now } },
            );
            return { hydrated: true, empty: false };
          }),
        );

        for (const r of batchResults) {
          processed++;
          if (r.status === 'fulfilled') {
            if (r.value.hydrated) hydrated++;
            else if (r.value.empty) emptyUpstream++;
          } else {
            failed++;
          }
        }

        if (onProgress) {
          try {
            onProgress({ processed, hydrated, emptyUpstream, failed, total });
          } catch {
            /* ignore progress callback errors */
          }
        }

        await new Promise((resolve) => setTimeout(resolve, 750));
      }

      if (cancelled) {
        logger.log(
          `🛑 Admin bulk re-check cancelled: ${hydrated} hydrated, ${emptyUpstream} upstream-empty, ${failed} failed (of ${processed})`,
        );
      } else {
        logger.log(
          `✅ Admin bulk re-check completed: ${hydrated} hydrated, ${emptyUpstream} upstream-empty, ${failed} failed (of ${processed})`,
        );
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`❌ Admin bulk re-check failed: ${message}`);
      throw error instanceof Error ? error : new Error(message);
    }

    return { processed, hydrated, emptyUpstream, failed, cancelled };
  }
}

export const syncService = new SyncService();