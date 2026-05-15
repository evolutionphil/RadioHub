import type { Express } from "express";
import { Station, UserProfile, UserListeningHistory, User, UserFollow, Country, Genre } from '@workspace/db-shared/mongo-schemas';
import { deduplicatedFetch, calculateDistance, stripPlaceholders, tvValidateParams, tvSlimStation, tvSlimGenre, tvSlimProjection } from './shared-utils';
import { normalizeCountryFilter, resolveToDbName } from '../utils/normalize-country';
import CacheManager, { CacheKeys } from '../cache';
import { logger } from '../utils/logger';
import { RecommendationEngine } from '../services/recommendation-engine';
import { getAllCountryInfoFromDb } from '../utils/normalize-country';
import { PrecomputedGenresService } from '../services/precomputed-genres';
import { PrecomputedStationsService } from '../services/precomputed-stations';
import { slugifyStationName, evaluateJunkStation } from '../seo/junk-station-rules';

// Escape regex meta-characters from user input. Without this, callers can pass
// patterns like `.*` or catastrophic-backtracking inputs (e.g. `(a+)+`) and
// either bypass intended exact-match filters or pin a Mongo regex worker.
// We also cap input length so a malicious 1MB query string cannot become a
// multi-million-character RegExp source. Inputs are anchored where the call
// site indicates an exact match is intended.
function escapeRegex(input: any, maxLen: number = 80): string {
  if (typeof input !== 'string') return '';
  const s = input.length > maxLen ? input.slice(0, maxLen) : input;
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Helper: generate unique slug inline
async function generateUniqueSlug(name: string, type: string, id: string): Promise<string> {
  const base = slugifyStationName(name);
  let slug = base || id;
  let counter = 0;
  while (true) {
    const candidate = counter === 0 ? slug : `${slug}-${counter}`;
    const existing = await Station.findOne({ slug: candidate, _id: { $ne: id } });
    if (!existing) return candidate;
    counter++;
  }
}

export function registerPublicStationRoutes(app: Express, deps: any) {
  const { requireAdmin } = deps;

  // SINGLE STATION BY SLUG OR ID - Used by all station detail pages
  app.get("/api/station/:identifier", async (req, res) => {
    try {
      const { identifier } = req.params;

      const cacheKey = `station:detail:${identifier}`;
      const cached = await CacheManager.get(cacheKey);
      if (cached) return void res.json(cached);

      let station: any;

      station = await Station.findOne({ slug: identifier }).select('+descriptions').lean();

      if (!station) {
        if (identifier.match(/^[0-9a-fA-F]{24}$/)) {
          station = await Station.findById(identifier).select('+descriptions').lean();
        }
      }

      if (!station) {
        return void res.status(404).json({ error: 'Station not found' });
      }

      if (!station.slug) {
        const newSlug = await generateUniqueSlug(station.name, 'station', station._id.toString());
        // Re-evaluate junk now that we know the persisted slug — codec-suffix
        // rules (incl. collision suffixes like `-mp3-1`) only fire once the
        // slug is finalised, so flag noIndex at the same write.
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
          station.noIndex = true;
        }
        await Station.updateOne({ _id: station._id }, { $set: update });
        station.slug = newSlug;
      }

      const result = stripPlaceholders(station);
      await CacheManager.set(cacheKey, result, { ttl: 300 });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch station' });
    }
  });

  // POPULAR STATIONS API - With duplicate detection and icon-only filtering
  app.get("/api/stations/popular", async (req, res) => {
    const { country, state, limit = 12, excludeBroken = 'false' } = req.query;
    const isTV = req.query.tv === '1';
    const resolvedCountry = resolveToDbName(country as string) || (country as string) || 'all';
    const normalizedState = (state as string) || 'all';
    const cacheKey = `popular_stations:${resolvedCountry}:${normalizedState}:${limit}:${excludeBroken}:${isTV ? 'tv' : 'web'}:v2`;
    const popularRequestStart = Date.now();
    try {
      // INCIDENT 2026-05-15 v10 — wrapped compute in single-flight so 100
      // concurrent cold misses (typical SSR fanout when CDN expires the
      // homepage) coalesce into ONE Mongo aggregate. Previously each
      // miss spawned its own pair of aggregates, draining the M10 pool.
      const computed = await CacheManager.getOrSetSingleFlight<any[]>(cacheKey, async () => {
        if (isTV && Number(limit) <= 10) {
          let tvFilter: any = { lastCheckOk: true };
          if (country && country !== 'all' && country !== 'null') {
            Object.assign(tvFilter, normalizeCountryFilter(country as string));
          }
          if (state && state !== 'all') {
            tvFilter.state = { $regex: new RegExp(escapeRegex(state, 60), 'i') };
          }
          tvFilter['logoAssets.status'] = 'completed';

          const fastStations = await Station.find(tvFilter)
            .sort({ votes: -1, clickCount: -1 })
            .limit(Number(limit) * 2)
            .select(deps.TV_STATION_PROJECTION || {})
            .lean();

          const seen = new Set<string>();
          const unique: any[] = [];
          for (const s of fastStations) {
            const key = s.name?.toLowerCase().replace(/\s*(radio|fm|am|online|live)\s*/gi, '').replace(/[^a-z0-9]/gi, '');
            if (key && seen.has(key)) continue;
            if (key) seen.add(key);
            // Cache the FULL station shape — tvSlimStation is applied
            // once by the response writer outside this closure. Slimming
            // here would double-slim on cache HIT.
            unique.push(s);
            if (unique.length >= Number(limit)) break;
          }
          logger.log(`[Cache MISS] /api/stations/popular TV fast-path country=${resolvedCountry} (${Date.now() - popularRequestStart}ms)`);
          return unique;
        }
      
      const normalizeStationName = (name: string): string => {
        if (!name) return '';
        return name
          .toLowerCase()
          .replace(/[''`´]/g, '')
          .replace(/\s*(radio|fm|am|digital|online|live|stream|web|internet|music|hits?)\s*/gi, ' ')
          .replace(/\s*\d+(\.\d+)?\s*(fm|am|mhz|khz)?\s*/gi, ' ')
          .replace(/[^a-z0-9\u00C0-\u024F]/gi, '')
          .trim();
      };
      
      const hasValidImage = (station: any): boolean => {
        // 1. Optimized S3 image — preferred
        if (station.logoAssets?.status === 'completed' &&
            (station.logoAssets?.webp256 || station.logoAssets?.webp96)) {
          return true;
        }
        // 2. Permanent failure (URL itself dead) — hide
        const failureType = station.logoAssets?.failureType;
        if (station.logoAssets?.status === 'failed' &&
            (failureType === 'http_error' || failureType === 'invalid_format')) {
          return false;
        }
        // 3. Legacy local download
        if (station.localImagePath && station.localImagePath.trim()) {
          return true;
        }
        // 4. Source URL fallback — used both when logo not yet processed AND when
        //    processing transiently failed (timeout/processing_failed/download_failed).
        //    Browser may succeed where our server-side downloader did.
        if (station.favicon && /^https?:\/\/.+/i.test(station.favicon.trim())) {
          return true;
        }
        return false;
      };
      
      let countryFilter: any = {
        lastCheckOk: true
      };
      
      if (country && country !== 'all' && country !== 'null') {
        Object.assign(countryFilter, normalizeCountryFilter(country as string));
      }
      if (state && state !== 'all') {
        countryFilter.state = { $regex: new RegExp(escapeRegex(state, 60), 'i') };
      }
      
      const requestedLimit = Number(limit);
      const fetchMultiplier = 4;
      
      let featuredFilter: any = {
        ...countryFilter,
        isFeatured: true
      };
      
      if (!country || country === 'all' || country === 'null') {
        featuredFilter.showInGlobalPopular = true;
      }
      
      const POPULAR_PROJECTION = {
        _id: 1, name: 1, url: 1, urlResolved: 1, favicon: 1, country: 1,
        countrycode: 1, state: 1, genre: 1, codec: 1, bitrate: 1,
        homepage: 1, tags: 1, slug: 1, hls: 1, votes: 1, clickCount: 1,
        lastCheckOk: 1, lastCheckTime: 1, descriptions: 1, logoAssets: 1, localImagePath: 1
      };

      // INCIDENT 2026-05-15 v10 — REMOVED all `.hint()` calls. The May 14
      // Atlas index audit (commit aee98c81e) HID 17 stations indexes
      // including `lastCheckOk_1_votes_-1`. Hinting a hidden index throws
      // BadValue (code 2) and silently 500'd the popular endpoint. We trust
      // the planner now; supporting indexes are PRESENT and visible
      // (country_1_votes_-1, isFeatured_1, votes_-1). Any new hint MUST
      // be tagged with `// HINT-VERIFIED YYYY-MM-DD` after probing
      // `db.stations.aggregate([{$indexStats:{}}])` on the live cluster.
      const [featuredStations, regularStations] = await Promise.all([
        Station.aggregate([
          { $match: featuredFilter },
          { $sort: { votes: -1, clickCount: -1 } },
          { $project: POPULAR_PROJECTION },
          { $limit: requestedLimit * fetchMultiplier }
        ]).option({ maxTimeMS: 15000, allowDiskUse: true }),
        Station.aggregate([
          { $match: { ...countryFilter, isFeatured: { $ne: true } } },
          { $sort: { votes: -1, clickCount: -1 } },
          { $project: POPULAR_PROJECTION },
          { $limit: requestedLimit * fetchMultiplier }
        ]).option({ maxTimeMS: 15000, allowDiskUse: true })
      ]);
      
      const allCandidates = [...featuredStations, ...regularStations];
      
      const seenNames = new Set<string>();
      const seenFavicons = new Set<string>();
      const stationsWithLogo: any[] = [];
      const stationsWithoutLogo: any[] = [];
      
      for (const station of allCandidates) {
        const normalizedName = normalizeStationName(station.name);
        const faviconKey = station.favicon?.toLowerCase()?.replace(/\?.*$/, '') || '';
        
        if (normalizedName && seenNames.has(normalizedName)) continue;
        if (faviconKey && seenFavicons.has(faviconKey)) continue;
        
        if (normalizedName) seenNames.add(normalizedName);
        if (faviconKey) seenFavicons.add(faviconKey);
        
        if (hasValidImage(station)) {
          stationsWithLogo.push(station);
        } else {
          stationsWithoutLogo.push(station);
        }
      }
      
      let stations: any[];
      if (stationsWithLogo.length >= requestedLimit) {
        stations = stationsWithLogo.slice(0, requestedLimit);
      } else {
        const remaining = requestedLimit - stationsWithLogo.length;
        stations = [...stationsWithLogo, ...stationsWithoutLogo.slice(0, remaining)];
      }

        const elapsed = Date.now() - popularRequestStart;
        logger.log(`[Cache MISS] /api/stations/popular country=${resolvedCountry} limit=${requestedLimit} (${elapsed}ms)`);

        // Cache the FULL station shape; the response writer below applies
        // the TV slim transform / placeholder strip per request.
        return stations;
      }, { ttl: 3600 });

      res.set('Cache-Control', 'public, max-age=600, s-maxage=3600');
      if (isTV) {
        return void res.json(computed.map(tvSlimStation));
      }
      res.json(stripPlaceholders(computed));
    } catch (error: any) {
      // SOFT-FAIL (2026-05-15 v10): never 500 a public read endpoint.
      // SWR fallback: try the cache key one last time — a parallel
      // request may have populated it before we threw. If still empty,
      // serve []. Use no-store so the failure response is NEVER cached
      // by the CDN/browser (a stale empty would lock users out for
      // minutes after the cluster recovers).
      logger.error(
        `❌ /api/stations/popular failed (country=${req.query.country || 'all'}, limit=${req.query.limit || '?'}): ` +
        `code=${error?.code || error?.codeName || 'unknown'} msg=${error?.message || error}`
      );
      let stale: any = null;
      try { stale = await CacheManager.get(cacheKey); } catch {}
      res.set('Cache-Control', 'no-store');
      // Apply the same response shaping as the success path so the
      // payload contract is identical on stale fallback (TV gets slim
      // shape; web strips placeholder logos).
      const staleArr: any[] = Array.isArray(stale) ? stale : [];
      if (isTV) {
        return void res.json(staleArr.map(tvSlimStation));
      }
      res.json(stripPlaceholders(staleArr));
    }
  });

  // STATIONS WITH GEO COORDINATES API
  app.get("/api/stations/with-geo", async (req, res) => {
    try {
      // Hard-cap limit to prevent memory spikes (40k+ stations)
      const WITH_GEO_MAX_LIMIT = 5000;
      const WITH_GEO_DEFAULT = 1000;
      const rawLimit = parseInt((req.query.limit as string) || String(WITH_GEO_DEFAULT), 10);
      const safeLimit = Math.min(
        Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : WITH_GEO_DEFAULT,
        WITH_GEO_MAX_LIMIT
      );
      // Cache key uses the clamped value so attackers can't pollute cache with arbitrary limits
      const cacheKey = `stations:with_geo:${safeLimit}`;
      const cached = await CacheManager.get(cacheKey);
      if (cached) return void res.json(cached);

      const stations = await Station.find({
        $and: [
          { geoLat: { $exists: true, $ne: null } },
          { geoLong: { $exists: true, $ne: null } }
        ]
      })
      .select('name slug country geoLat geoLong votes clickCount tags homepage favicon hasExtendedInfo url logoAssets')
      .sort({ votes: -1 }) 
      .limit(safeLimit)
      .lean();
      
      const result = stripPlaceholders(stations);
      await CacheManager.set(cacheKey, result, { ttl: 1800 });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch stations with geo coordinates' });
    }
  });

  // NEARBY STATIONS API - GPS-based proximity detection
  app.get("/api/stations/nearby", async (req, res) => {
    try {
      const { lat, lng, radius = 100, limit = 12, country, excludeBroken = 'false', userCountry } = req.query;
      
      if (lat && lng) {
        const snappedLat = Math.round(parseFloat(lat as string) * 100) / 100;
        const snappedLng = Math.round(parseFloat(lng as string) * 100) / 100;
        const countryKey = country && country !== 'all' ? (country as string) : 'global';
        const cacheKey = `nearby:${snappedLat}_${snappedLng}_${parseFloat(radius as string)}_${countryKey}_${excludeBroken}`;
        
        const cachedResult = await CacheManager.get(cacheKey);
        if (cachedResult) {
          logger.log(`📦 Serving nearby stations from cache (${countryKey})`);
          return void res.json(cachedResult);
        }
      }
      
      let filter: any = {};
      let stations: any[] = [];
      
      if (lat && lng) {
        const userLat = parseFloat(lat as string);
        const userLng = parseFloat(lng as string);
        let searchRadius = parseFloat(radius as string);
        
        searchRadius = Math.min(searchRadius, 150);
        const resultLimit = Math.min(Number(limit), 50);
        
        const deltaLat = searchRadius / 111; 
        const deltaLng = searchRadius / (111 * Math.cos(userLat * Math.PI / 180)); 
        
        let queryFilter: any = {
          geoLat: { 
            $type: 'number',
            $gte: userLat - deltaLat,
            $lte: userLat + deltaLat
          },
          geoLong: { 
            $type: 'number',
            $gte: userLng - deltaLng,
            $lte: userLng + deltaLng
          }
        };
        
        if (country && country !== 'all' && country !== 'undefined' && country !== 'null') {
          Object.assign(queryFilter, normalizeCountryFilter(country as string));
        }
        
        if (excludeBroken === 'true') {
          queryFilter.lastCheckOk = true;
        }
        
        try {
          const candidateStations = await Station.find(queryFilter)
            .select('name slug country geoLat geoLong votes url urlResolved codec bitrate favicon homepage tags lastCheckOk logoAssets')
            .limit(500)
            .lean(); 
          
          const stationsWithDistance = candidateStations
            .map((station: any) => {
              const distance = calculateDistance(userLat, userLng, station.geoLat, station.geoLong);
              return {
                ...station,
                distance: Math.round(distance * 10) / 10 
              };
            })
            .filter((station: any) => station.distance <= searchRadius) 
            .sort((a: any, b: any) => {
              const userCountryLower = userCountry ? (userCountry as string).toLowerCase() : '';
              const aIsUserCountry = userCountryLower && a.country?.toLowerCase().includes(userCountryLower);
              const bIsUserCountry = userCountryLower && b.country?.toLowerCase().includes(userCountryLower);
              
              if (aIsUserCountry && !bIsUserCountry) return -1;
              if (!aIsUserCountry && bIsUserCountry) return 1;
              
              const aHasFavicon = a.favicon && a.favicon.trim() !== '' && a.favicon !== 'null' && a.favicon !== 'undefined';
              const bHasFavicon = b.favicon && b.favicon.trim() !== '' && b.favicon !== 'null' && b.favicon !== 'undefined';
              
              if (aHasFavicon && !bHasFavicon) return -1;
              if (!aHasFavicon && bHasFavicon) return 1;
              
              if (a.distance !== b.distance) return a.distance - b.distance;
              
              return (b.votes || 0) - (a.votes || 0);
            })
            .slice(0, resultLimit);
          
          stations = stationsWithDistance;
          
          if (stations.length === 0 && searchRadius < 100) {
            const expandedStations = candidateStations
              .map((station: any) => {
                const distance = calculateDistance(userLat, userLng, station.geoLat, station.geoLong);
                return {
                  ...station,
                  distance: Math.round(distance * 10) / 10
                };
              })
              .filter((station: any) => station.distance <= 100) 
              .sort((a: any, b: any) => a.distance - b.distance)
              .slice(0, Math.min(resultLimit, 10));
            
            stations = expandedStations;
          }
          
        } catch (error) {
          const fallbackFilter: any = {};
          if (country && country !== 'all') {
            Object.assign(fallbackFilter, normalizeCountryFilter(country as string));
          } else {
            fallbackFilter.country = { $exists: true, $ne: null };
          }
          if (excludeBroken === 'true') {
            fallbackFilter.lastCheckOk = true;
          }
          
          stations = await Station.find(fallbackFilter)
          .sort({ votes: -1 })
          .limit(resultLimit)
          .select('name slug country geoLat geoLong votes url urlResolved codec bitrate favicon homepage tags lastCheckOk logoAssets')
          .lean();
          
          stations = stations.map((station: any) => ({
            ...station,
            distance: null
          }));
        }
        
      } else if (country && country !== 'all') {
        Object.assign(filter, normalizeCountryFilter(country as string));
        if (excludeBroken === 'true') {
          filter.lastCheckOk = true;
        }
        const countryStations = await Station.find(filter)
          .select('name slug country geoLat geoLong votes url urlResolved codec bitrate favicon homepage tags lastCheckOk logoAssets')
          .sort({ votes: -1 })
          .limit(Math.min(Number(limit) * 3, 100))
          .lean();

        countryStations.sort((a: any, b: any) => {
          const aHasFavicon = a.favicon && a.favicon.trim() !== '' && a.favicon !== 'null' && a.favicon !== 'undefined';
          const bHasFavicon = b.favicon && b.favicon.trim() !== '' && b.favicon !== 'null' && b.favicon !== 'undefined';
          
          if (aHasFavicon && !bHasFavicon) return -1;
          if (!aHasFavicon && bHasFavicon) return 1;
          
          return (b.votes || 0) - (a.votes || 0);
        });

        stations = countryStations.slice(0, Number(limit));
        
      } else {
        return void res.json([]);
      }

      if (lat && lng && stations.length > 0) {
        const snappedLat = Math.round(parseFloat(lat as string) * 100) / 100;
        const snappedLng = Math.round(parseFloat(lng as string) * 100) / 100;
        const countryKey = country && country !== 'all' ? (country as string) : 'global';
        const cacheKey = `nearby:${snappedLat}_${snappedLng}_${parseFloat(radius as string)}_${countryKey}_${excludeBroken}`;
        await CacheManager.set(cacheKey, stations, { ttl: 1800 }); 
      }

      res.json(stripPlaceholders(stations));
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch nearby stations' });
    }
  });

  // STATION STATISTICS API - Shows breakdown of working vs broken stations
  app.get("/api/stations/stats", async (req, res) => {
    try {
      const cacheKey = 'station_stats';
      const cachedStats = await CacheManager.get(cacheKey);
      if (cachedStats) {
        return void res.json(cachedStats);
      }
      
      const stats = await Station.aggregate([
        {
          $facet: {
            total: [{ $count: "count" }],
            working: [
              { $match: { lastCheckOk: true } },
              { $count: "count" }
            ],
            broken: [
              { $match: { lastCheckOk: { $ne: true } } },
              { $count: "count" }
            ],
            withGps: [
              { 
                $match: { 
                  geoLat: { $exists: true, $nin: [null, ''] },
                  geoLong: { $exists: true, $nin: [null, ''] }
                } 
              },
              { $count: "count" }
            ],
            withFavicon: [
              { 
                $match: { 
                  favicon: { 
                    $exists: true, 
                    $nin: [null, '', 'null', 'undefined'] 
                  } 
                } 
              },
              { $count: "count" }
            ],
            byCountry: [
              { $match: { country: { $exists: true, $nin: [null, ''] } } },
              { $group: { _id: "$country", count: { $sum: 1 } } },
              { $sort: { count: -1 } },
              { $limit: 10 }
            ],
            byGenre: [
              { $match: { genre: { $exists: true, $nin: [null, ''] } } },
              { $group: { _id: "$genre", count: { $sum: 1 } } },
              { $sort: { count: -1 } },
              { $limit: 10 }
            ]
          }
        }
      ]).allowDiskUse(true).option({ maxTimeMS: 20000 });
      
      const result = {
        total: stats[0].total[0]?.count || 0,
        working: stats[0].working[0]?.count || 0,
        broken: stats[0].broken[0]?.count || 0,
        workingPercentage: stats[0].total[0]?.count > 0 
          ? Math.round((stats[0].working[0]?.count || 0) / stats[0].total[0].count * 100) 
          : 0,
        lastUpdated: new Date().toISOString()
      };
      
      await CacheManager.set(cacheKey, result, { ttl: 1800 });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch station statistics' });
    }
  });

  // SIMILAR STATIONS API
  app.get("/api/stations/similar/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { limit = 6 } = req.query;
      const limitNum = Number(limit);

      const cacheKey = `similar_stations:${id}:${limitNum}`;
      const cachedResult = await CacheManager.get(cacheKey);
      if (cachedResult) return void res.json(cachedResult);

      const sourceStation = await Station.findById(id).select('country tags').lean();
      if (!sourceStation) return void res.status(404).json({ error: 'Station not found' });

      const { performanceCache } = await import('../performance-cache');
      const pool = performanceCache.getSimilarPool(sourceStation.country ?? '') || performanceCache.getGlobalPopularPool();

      let resultStations: any[];

      if (pool && pool.length > 0) {
        resultStations = pool
          .filter((s: any) => s._id?.toString() !== id)
          .slice(0, limitNum);
      } else {
        const similarStations = await RecommendationEngine.getPersonalizedSimilarStations({
          sourceStationId: id,
          limit: limitNum
        });

        const stationIds = similarStations.map(s => s.stationId);
        const stations = await Station.find({ _id: { $in: stationIds } }).lean();

        resultStations = similarStations
          .map(sim => stations.find(s => s._id.toString() === sim.stationId))
          .filter(Boolean);
      }

      await CacheManager.set(cacheKey, resultStations, { ttl: 3600 });
      res.json(stripPlaceholders(resultStations));
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch similar stations' });
    }
  });

  // RANDOM COUNTRY STATION
  app.get("/api/stations/country-random", async (req, res) => {
    try {
      const { country } = req.query;
      if (!country) return void res.status(400).json({ error: 'Country parameter is required' });

      const filter = normalizeCountryFilter(country as string);
      const [station] = await Station.aggregate([
        { $match: filter },
        { $sample: { size: 1 } }
      ]);
      if (!station) return void res.status(404).json({ error: 'No stations found for this country' });
      res.json(stripPlaceholders(station));
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch random station' });
    }
  });

  // PRECOMPUTED STATIONS API - 7-day cache, ultra-fast station browsing
  app.get("/api/stations/precomputed", async (req, res) => {
    try {
      const { countryCode, countryName, page = '1', limit = '33', genre, language, search, hasLogo, codec, bitrate, sort } = req.query;
      const pageNum = Math.max(1, parseInt(page as string) || 1);
      const limitNum = Math.min(parseInt(limit as string) || 33, 500);

      const identifier = (countryName as string) || (countryCode as string);
      const isGlobal = !identifier || identifier === 'global' || identifier === 'all';

      // For global requests: check cache readiness; if not ready, use fast MongoDB fallback
      // INCIDENT 2026-05-14 round 8: this fallback was the smoking gun for the
      // /api/stations/precomputed?countryName=global timeouts. Previous code did
      // a full Station.find({}).sort({ hasLogo:-1, votes:-1 }).skip().limit() with
      // NO maxTimeMS and NO lastCheckOk filter — a 200k-doc in-memory sort that
      // saturated the primary during the failover. Now we:
      //   1. Always filter by lastCheckOk:true (matches the cached path),
      //   2. Cap execution at 8s with maxTimeMS,
      //   3. Soft-fail with empty list on any timeout/error so the page still
      //      renders rather than emitting a 500 + ERR stack trace.
      if (isGlobal) {
        const cacheReady = await PrecomputedStationsService.hasGlobalCache();
        if (!cacheReady) {
          try {
            const skip = (pageNum - 1) * limitNum;
            const escG = escapeRegex(genre, 60);
            const mongoFilter: any = { lastCheckOk: true };
            if (escG) {
              mongoFilter.$or = [
                { genre: { $regex: new RegExp(escG, 'i') } },
                { tags: { $regex: new RegExp(escG, 'i') } },
              ];
            }
            const escQ = escapeRegex(search, 80);
            if (escQ) { mongoFilter.name = { $regex: new RegExp(escQ, 'i') }; }
            // INCIDENT 2026-05-15 v7 — `.allowDiskUse(true)` is REQUIRED here.
            // Sort key {hasLogo:-1, votes:-1} is satisfied by the new
            // {lastCheckOk:1, hasLogo:-1, votes:-1} index (added 2026-05-15
            // in routes.ts createIndexes), but during the rolling index build
            // and on cold planner state the executor still falls back to a
            // blocking SORT stage. Without allowDiskUse Atlas M10 hits the
            // 32MB sort memory limit on a 200k-doc scan and emits
            // "Executor error during getMore :: operation exceeded time
            // limit" within 5-10s instead of the budgeted 60s.
            // INCIDENT 2026-05-15 v10 — REMOVED `.hint('lastCheckOk_1_hasLogo_-1_votes_-1')`.
            // That index was hidden by the May 14 Atlas index audit and the
            // hint was throwing BadValue. Trust the planner; the supporting
            // index `country_1_lastCheckOk_1_hasLogo_-1_votes_-1` is still
            // present (visible) per `db.stations.getIndexes()`.
            const [stations, total] = await Promise.all([
              Station.find(mongoFilter)
                .select('_id name url urlResolved favicon country countrycode state language genre codec bitrate homepage tags slug hls votes clickCount lastCheckOk hasLogo logoAssets')
                .sort({ hasLogo: -1, votes: -1 })
                .skip(skip)
                .limit(limitNum)
                .maxTimeMS(60000)
                .allowDiskUse(true)
                .lean(),
              Station.countDocuments(mongoFilter).maxTimeMS(30000).catch(() => 0),
            ]);
            return void res.json({
              success: true, data: stations, stations, total, count: total, page: pageNum,
              totalPages: Math.ceil(total / limitNum), cached: false,
              pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) }
            });
          } catch (fallbackErr: any) {
            logger.warn('[/api/stations/precomputed] global cold-fallback failed: ' + (fallbackErr?.message || 'unknown'));
            return void res.json({
              success: true, data: [], stations: [], total: 0, count: 0, page: pageNum,
              totalPages: 0, cached: false,
              pagination: { page: pageNum, limit: limitNum, total: 0, pages: 0 }
            });
          }
        }
      }

      let result;
      if (isGlobal) {
        result = await PrecomputedStationsService.getGlobalStations(pageNum, limitNum);
      } else if (countryCode) {
        result = await PrecomputedStationsService.getCountryStations(countryCode as string, pageNum, limitNum);
      } else {
        result = await PrecomputedStationsService.getCountryStationsByName(countryName as string, pageNum, limitNum);
      }

      let { stations } = result;

      // Apply client-side filters on cached data
      if (genre) stations = stations.filter((s: any) => s.genre?.toLowerCase().includes((genre as string).toLowerCase()) || (typeof s.tags === 'string' ? s.tags.toLowerCase().includes((genre as string).toLowerCase()) : Array.isArray(s.tags) && s.tags.some((t: string) => t.toLowerCase().includes((genre as string).toLowerCase()))));
      if (language) stations = stations.filter((s: any) => s.language?.toLowerCase().includes((language as string).toLowerCase()));
      if (search) {
        const q = (search as string).toLowerCase();
        stations = stations.filter((s: any) => s.name?.toLowerCase().includes(q) || s.country?.toLowerCase().includes(q));
      }
      if (hasLogo === 'true') stations = stations.filter((s: any) => s.favicon || s.hasLogo);
      if (codec) stations = stations.filter((s: any) => s.codec?.toLowerCase() === (codec as string).toLowerCase());
      if (bitrate) stations = stations.filter((s: any) => s.bitrate >= parseInt(bitrate as string));

      res.json({
        success: true,
        data: stations,
        stations,
        total: result.total,
        count: result.total,
        page: result.page,
        totalPages: result.totalPages,
        cached: result.cached,
        pagination: { page: result.page, limit: limitNum, total: result.total, pages: result.totalPages }
      });
    } catch (error: any) {
      // INCIDENT 2026-05-14 round 8: this catch was emitting `logger.error`
      // (with full stack trace) once per failed request — during the failover
      // storm it printed 200+ stack traces in 10 minutes. Downgrade to a
      // single-line warn + return an empty payload so a transient cluster
      // blip degrades gracefully instead of looking like an outage in logs.
      logger.warn('[/api/stations/precomputed] failed: ' + (error?.message || 'unknown'));
      res.json({
        success: true, data: [], stations: [], total: 0, count: 0,
        page: 1, totalPages: 0, cached: false,
        pagination: { page: 1, limit: 0, total: 0, pages: 0 }
      });
    }
  });

  app.get("/api/now-playing/:id", async (req, res) => {
    try {
      const { id } = req.params;

      const station = await Station.findOne(
        { $or: [{ slug: id }, { _id: id.match(/^[0-9a-fA-F]{24}$/) ? id : undefined }].filter(Boolean) }
      ).select('name url urlResolved').lean() as any;

      if (!station) {
        return void res.status(404).json({ error: 'Station not found' });
      }

      const streamUrl = station.urlResolved || station.url;
      if (!streamUrl) {
        return void res.json({ title: station.name, artist: '', station: station.name });
      }

      const { getStreamMetadataService } = await import('../services/stream-metadata');
      const metadataService = getStreamMetadataService();
      const metadata = await metadataService.getStationMetadata(station);

      res.json({
        title: metadata.title || station.name,
        artist: metadata.artist || '',
        station: metadata.station || station.name,
        genre: metadata.genre || ''
      });
    } catch (error: any) {
      if (error?.message !== 'metadata-unavailable') {
        console.error('Error fetching now-playing:', error?.message || error);
      }
      res.json({
        title: '',
        artist: '',
        station: '',
        genre: ''
      });
    }
  });

  // LINKED STATIONS - Related stations for station detail page
  app.get("/api/stations/:stationId/linked", async (req, res) => {
    try {
      const { stationId } = req.params;

      const cacheKey = `stations:linked:${stationId}`;
      const cached = await CacheManager.get(cacheKey);
      if (cached) return void res.json(cached);

      const station = await Station.findById(stationId).lean() as any;
      if (!station) return void res.status(404).json({ error: 'Station not found' });

      const filter: any = { _id: { $ne: stationId } };
      if (station.country) filter.country = station.country;
      if (station.genre) filter.genre = { $regex: new RegExp(escapeRegex(station.genre, 60), 'i') };

      const linked = await Station.find(filter)
        .select('_id name favicon slug country genre tags votes bitrate codec language url urlResolved hls lastCheckOk hasLogo logoAssets')
        .sort({ votes: -1 })
        .limit(12)
        .lean();

      const result = { stations: linked };
      await CacheManager.set(cacheKey, result, { ttl: 1800 });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch linked stations' });
    }
  });

  // MAIN STATIONS LIST API - Full filter/sort/search/pagination
  app.get("/api/stations", async (req, res) => {
    try {
      const isTV = req.query.tv === '1';
      const {
        country,
        state,
        genre,
        tags,
        language,
        search,
        sort = 'votes',
        order = 'desc',
        excludeBroken = 'false',
        excludeStationIds = '',
        minVotes = 0,
        timePeriod = 'all'
      } = req.query;

      const safeParams = isTV ? tvValidateParams(req.query) : {
        page: parseInt(req.query.page as string) || 1,
        limit: parseInt(req.query.limit as string) || 25
      };
      const { page, limit } = safeParams;

      const webCacheKey = !search && !excludeStationIds
        ? `stations:list:${country || 'all'}:${state || 'all'}:${genre || 'all'}:${tags || 'all'}:${language || 'all'}:${sort}:${page}:${limit}:${excludeBroken}:${minVotes}:${timePeriod}:${isTV ? 'tv' : 'web'}`
        : null;

      if (webCacheKey) {
        const cached = await CacheManager.get(webCacheKey);
        if (cached) return void res.json(cached);
      }

      const filter: any = {};

      if (excludeBroken === 'true') filter.lastCheckOk = true;

      if (excludeStationIds && typeof excludeStationIds === 'string') {
        const excludeIds = excludeStationIds.split(',').filter((id: string) => id.trim());
        if (excludeIds.length > 0) filter._id = { $nin: excludeIds };
      }

      if (minVotes && Number(minVotes) > 0) filter.votes = { $gte: Number(minVotes) };

      if (timePeriod && timePeriod !== 'all') {
        const now = new Date();
        const startDate = new Date();
        if (timePeriod === '24h') startDate.setHours(now.getHours() - 24);
        else if (timePeriod === '7d') startDate.setDate(now.getDate() - 7);
        else if (timePeriod === '30d') startDate.setDate(now.getDate() - 30);
        filter.$or = [
          { lastChangeTime: { $gte: startDate } },
          { clickTimestamp: { $gte: startDate } },
          { createdAt: { $gte: startDate } }
        ];
      }

      if (country && country !== 'all') {
        Object.assign(filter, normalizeCountryFilter(country as string));
      }

      if (state && state !== 'all') {
        const stateAliases: { [key: string]: string[] } = {
          'Wien': ['Wien', 'Vienna'],
          'Vienna': ['Wien', 'Vienna'],
        };
        const searchTerms = stateAliases[state as string] || [state as string];
        if (searchTerms.length > 1) {
          if (!filter.$or) filter.$or = [];
          filter.$or.push(...searchTerms.map((term: string) => ({ state: { $regex: new RegExp(escapeRegex(term, 60), 'i') } })));
        } else {
          filter.state = { $regex: new RegExp(escapeRegex(state, 60), 'i') };
        }
      }

      if (tags && tags !== 'all') filter.tags = { $regex: new RegExp(escapeRegex(tags, 80), 'i') };

      if (genre && genre !== 'all') {
        const escapedGenre = (genre as string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filter.$or = [
          { genre: { $regex: new RegExp(`^${escapedGenre}$`, 'i') } },
          { tags: { $regex: new RegExp(`(^|,)\\s*${escapedGenre}\\s*(,|$)`, 'i') } }
        ];
      }

      if (language && language !== 'all') filter.language = { $regex: new RegExp(escapeRegex(language, 40), 'i') };

      let isGenreSearch = false;
      let genreSearchTerm = '';

      if (search) {
        const searchTerm = (search as string).trim();
        if (searchTerm.length >= 2) {
          const escapedTerm = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const flexibleTerm = escapedTerm.replace(/\s+/g, '\\s*');
          const customBoundaryRegex = new RegExp(`(^|[^a-zA-Z0-9])${flexibleTerm}`, 'i');
          const startsWithRegex = new RegExp(`^${flexibleTerm}`, 'i');
          const knownGenres = ['jazz', 'pop', 'rock', 'classical', 'news', 'talk', 'dance', 'electronic',
            'hiphop', 'country', 'oldies', 'hits', 'rnb', 'soul', 'blues', 'reggae',
            'metal', 'punk', 'alternative', 'indie', 'folk', 'world', 'latin'];
          if (knownGenres.some(g => g === searchTerm.toLowerCase().replace(/[\s-]/g, ''))) {
            isGenreSearch = true;
            genreSearchTerm = escapedTerm;
          }
          filter.$or = [
            { name: { $regex: customBoundaryRegex } },
            { country: { $regex: startsWithRegex } },
            { genre: { $regex: customBoundaryRegex } },
            { tags: { $regex: customBoundaryRegex } }
          ];
        }
      }

      const total = await Station.countDocuments(filter);

      let pipeline: any[] = [{ $match: filter }];

      if (isGenreSearch && genreSearchTerm) {
        pipeline.push({
          $addFields: {
            genreMatchScore: {
              $cond: [{ $regexMatch: { input: { $ifNull: ['$genre', ''] }, regex: genreSearchTerm, options: 'i' } }, 2,
                { $cond: [{ $regexMatch: { input: { $ifNull: ['$tags', ''] }, regex: genreSearchTerm, options: 'i' } }, 1, 0] }]
            }
          }
        });
      }

      pipeline.push({
        $addFields: {
          hasValidFavicon: {
            $cond: [{ $regexMatch: { input: { $trim: { input: { $ifNull: ['$favicon', ''] } } }, regex: '^(https?:\\/\\/.+|data:image\\/.+)', options: 'i' } }, 1, 0]
          },
          startsWithNumber: {
            $cond: [{ $regexMatch: { input: { $trim: { input: { $ifNull: ['$name', ''] } } }, regex: '^[0-9]' } }, 1, 0]
          }
        }
      });

      let sortObj: any = isGenreSearch
        ? { genreMatchScore: -1, hasValidFavicon: -1 }
        : { hasValidFavicon: -1 };

      switch (sort) {
        case 'az':
          sortObj = isGenreSearch
            ? { genreMatchScore: -1, startsWithNumber: 1, hasValidFavicon: -1, name: 1 }
            : { startsWithNumber: 1, hasValidFavicon: -1, name: 1 };
          break;
        case 'za':
          sortObj = isGenreSearch
            ? { genreMatchScore: -1, startsWithNumber: 1, hasValidFavicon: -1, name: -1 }
            : { startsWithNumber: 1, hasValidFavicon: -1, name: -1 };
          break;
        case 'newest':
          sortObj = isGenreSearch
            ? { genreMatchScore: -1, hasValidFavicon: -1, createdAt: -1 }
            : { hasValidFavicon: -1, createdAt: -1 };
          break;
        case 'oldest':
          sortObj = isGenreSearch
            ? { genreMatchScore: -1, hasValidFavicon: -1, createdAt: 1 }
            : { hasValidFavicon: -1, createdAt: 1 };
          break;
        default:
          sortObj = isGenreSearch
            ? { genreMatchScore: -1, hasValidFavicon: -1, votes: -1 }
            : { hasValidFavicon: -1, votes: -1 };
          break;
      }

      if (isTV) {
        pipeline.push(tvSlimProjection());
      } else {
        pipeline.push({
          $project: {
            _id: 1, name: 1, url: 1, urlResolved: 1, favicon: 1, country: 1, countrycode: 1,
            state: 1, language: 1, genre: 1, codec: 1, bitrate: 1, homepage: 1, tags: 1,
            slug: 1, hls: 1, votes: 1, clickCount: 1, lastCheckOk: 1, lastCheckTime: 1,
            descriptions: 1, logoAssets: 1, localImagePath: 1, createdAt: 1, updatedAt: 1,
            hasValidFavicon: 1, startsWithNumber: 1
          }
        });
      }

      pipeline.push({ $sort: sortObj });
      pipeline.push({ $skip: (Number(page) - 1) * Number(limit) });
      pipeline.push({ $limit: Number(limit) });

      const stations = await Station.aggregate(pipeline).allowDiskUse(true).option({ maxTimeMS: 20000 });

      const response = {
        stations,
        totalCount: total,
        count: total,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit))
        }
      };

      if (webCacheKey) await CacheManager.set(webCacheKey, response, { ttl: 300 });

      res.json(response);
    } catch (error) {
      logger.error('Error fetching stations:', error);
      res.status(500).json({ error: 'Failed to fetch stations' });
    }
  });
}
