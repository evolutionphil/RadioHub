import type { Express } from "express";
import { Station, UserProfile, UserListeningHistory, User, UserFollow, Country, Genre } from '../../shared/mongo-schemas';
import { deduplicatedFetch, calculateDistance, stripPlaceholders, tvValidateParams, tvSlimStation, tvSlimGenre, tvSlimProjection } from './shared-utils';
import { normalizeCountryFilter } from '../utils/normalize-country';
import CacheManager, { CacheKeys } from '../cache';
import { logger } from '../utils/logger';
import { RecommendationEngine } from '../services/recommendation-engine';
import { getAllCountryInfoFromDb } from '../utils/normalize-country';
import { PrecomputedGenresService } from '../services/precomputed-genres';
import { PrecomputedStationsService } from '../services/precomputed-stations';

// Helper: generate unique slug inline
async function generateUniqueSlug(name: string, type: string, id: string): Promise<string> {
  const base = name.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
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
      let station: any;

      station = await Station.findOne({ slug: identifier }).select('+descriptions').lean();

      if (!station) {
        if (identifier.match(/^[0-9a-fA-F]{24}$/)) {
          station = await Station.findById(identifier).select('+descriptions').lean();
        }
      }

      if (!station) {
        return res.status(404).json({ error: 'Station not found' });
      }

      if (!station.slug) {
        const newSlug = await generateUniqueSlug(station.name, 'station', station._id.toString());
        await Station.updateOne({ _id: station._id }, { $set: { slug: newSlug } });
        station.slug = newSlug;
      }

      res.json(stripPlaceholders(station));
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch station' });
    }
  });

  // POPULAR STATIONS API - With duplicate detection and icon-only filtering
  app.get("/api/stations/popular", async (req, res) => {
    try {
      const { country, state, limit = 12, excludeBroken = 'false' } = req.query;
      const isTV = req.query.tv === '1';
      
      // Generate cache key that includes country, state filters, broken status, and TV mode
      const cacheKey = `popular_stations:${country || 'all'}:${state || 'all'}:${limit}:${excludeBroken}:${isTV ? 'tv' : 'web'}:v2`;
      
      const popularRequestStart = Date.now();
      // Try cache first
      const cachedResult = await CacheManager.get(cacheKey);
      if (cachedResult) {
        logger.log(`[Cache HIT] /api/stations/popular country=${country || 'all'} (${Date.now() - popularRequestStart}ms)`);
        // Check if cache needs background refresh (30 seconds before expiry for popular stations)
        if (CacheManager.needsRefresh(cacheKey, 30)) {
          setImmediate(async () => {
            try {
              // Note: refreshPopularStationsCache was not found in global scope in routes.ts, 
              // it might be defined inside registerRoutes or as a helper.
              // For now, we'll skip background refresh or implement it if available.
              // In routes.ts it was: await refreshPopularStationsCache(country as string);
            } catch (error) {
              // Background refresh failed silently
            }
          });
        }
        
        return res.json(cachedResult);
      }

      // TV/Mobile fast path: small limits (<=10) use simple query for speed
      if (isTV && Number(limit) <= 10) {
        let tvFilter: any = { lastCheckOk: true };
        if (country && country !== 'all' && country !== 'null') {
          Object.assign(tvFilter, normalizeCountryFilter(country as string));
        }
        if (state && state !== 'all') {
          tvFilter.state = { $regex: new RegExp(state as string, 'i') };
        }
        tvFilter['logoAssets.status'] = 'completed';

        const fastStations = await Station.find(tvFilter)
          .sort({ votes: -1, clickCount: -1 })
          .limit(Number(limit) * 2)
          .select(deps.TV_STATION_PROJECTION || {}) // Fallback if projection not in deps
          .lean();

        const seen = new Set<string>();
        const unique: any[] = [];
        for (const s of fastStations) {
          const key = s.name?.toLowerCase().replace(/\s*(radio|fm|am|online|live)\s*/gi, '').replace(/[^a-z0-9]/gi, '');
          if (key && seen.has(key)) continue;
          if (key) seen.add(key);
          unique.push(tvSlimStation(s));
          if (unique.length >= Number(limit)) break;
        }

        await CacheManager.set(cacheKey, unique, { ttl: 600 });
        return res.json(unique);
      }
      
      // Helper function to normalize station name for duplicate detection
      const normalizeStationName = (name: string): string => {
        if (!name) return '';
        return name
          .toLowerCase()
          .replace(/[''`´]/g, '') // Remove apostrophes
          .replace(/\s*(radio|fm|am|digital|online|live|stream|web|internet|music|hits?)\s*/gi, ' ')
          .replace(/\s*\d+(\.\d+)?\s*(fm|am|mhz|khz)?\s*/gi, ' ') // Remove frequencies
          .replace(/[^a-z0-9\u00C0-\u024F]/gi, '') // Keep only alphanumeric and accented chars
          .trim();
      };
      
      // Helper to check if station has any valid image
      const hasValidImage = (station: any): boolean => {
        if (station.logoAssets?.status === 'completed' && 
            (station.logoAssets?.webp96 || station.logoAssets?.webp256)) {
          return true;
        }
        if (station.logoAssets?.status === 'failed') {
          return false;
        }
        if (station.localImagePath && station.localImagePath.trim()) {
          return true;
        }
        if (!station.logoAssets && station.favicon && /^https?:\/\/.+/i.test(station.favicon.trim())) {
          return true;
        }
        return false;
      };
      
      let countryFilter: any = {
        lastCheckOk: true  // Only working stations
      };
      
      if (country && country !== 'all' && country !== 'null') {
        Object.assign(countryFilter, normalizeCountryFilter(country as string));
      }
      if (state && state !== 'all') {
        countryFilter.state = { $regex: new RegExp(state as string, 'i') };
      }
      
      const requestedLimit = Number(limit);
      const fetchMultiplier = 5; // Fetch 5x to ensure enough after filtering
      
      let featuredFilter: any = {
        ...countryFilter,
        isFeatured: true
      };
      
      if (!country || country === 'all' || country === 'null') {
        featuredFilter.showInGlobalPopular = true;
      }
      
      const featuredPipeline = [
        { $match: featuredFilter },
        { $sort: { votes: -1, clickCount: -1 } },
        {
          $project: {
            _id: 1, name: 1, url: 1, urlResolved: 1, favicon: 1, country: 1,
            countrycode: 1, state: 1, genre: 1, codec: 1, bitrate: 1,
            homepage: 1, tags: 1, slug: 1, hls: 1, votes: 1, clickCount: 1,
            lastCheckOk: 1, lastCheckTime: 1, descriptions: 1, logoAssets: 1, localImagePath: 1
          }
        },
        { $limit: requestedLimit * fetchMultiplier }
      ];
      
      const featuredStations = await Station.aggregate(featuredPipeline);
      
      const regularPipeline = [
        { $match: { ...countryFilter, isFeatured: { $ne: true } } },
        { $sort: { votes: -1, clickCount: -1 } },
        {
          $project: {
            _id: 1, name: 1, url: 1, urlResolved: 1, favicon: 1, country: 1,
            countrycode: 1, state: 1, genre: 1, codec: 1, bitrate: 1,
            homepage: 1, tags: 1, slug: 1, hls: 1, votes: 1, clickCount: 1,
            lastCheckOk: 1, lastCheckTime: 1, descriptions: 1, logoAssets: 1, localImagePath: 1
          }
        },
        { $limit: requestedLimit * fetchMultiplier }
      ];
      
      const regularStations = await Station.aggregate(regularPipeline);
      
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

      if (isTV) {
        const slimStations = stations.map(tvSlimStation);
        await CacheManager.set(cacheKey, slimStations, { ttl: 600 });
        return res.json(slimStations);
      }

      await CacheManager.set(cacheKey, stations, { ttl: 600 });
      res.json(stripPlaceholders(stations));
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch popular stations' });
    }
  });

  // STATIONS WITH GEO COORDINATES API
  app.get("/api/stations/with-geo", async (req, res) => {
    try {
      const { limit = 1000 } = req.query;
      const stations = await Station.find({
        $and: [
          { geoLat: { $exists: true, $ne: null } },
          { geoLat: { $ne: '' } },
          { geoLong: { $exists: true, $ne: null } },
          { geoLong: { $ne: '' } }
        ]
      })
      .select('name country geoLat geoLong votes clickCount tags homepage favicon hasExtendedInfo url')
      .sort({ votes: -1 }) 
      .limit(parseInt(limit as string))
      .lean();
      
      res.json(stripPlaceholders(stations));
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch stations with geo coordinates' });
    }
  });

  // NEARBY STATIONS API - GPS-based proximity detection
  app.get("/api/stations/nearby", async (req, res) => {
    try {
      const { lat, lng, radius = 100, limit = 12, country, excludeBroken = 'false', userCountry } = req.query;
      
      if (lat && lng) {
        const countryKey = country && country !== 'all' ? (country as string) : 'global';
        const cacheKey = `nearby:${parseFloat(lat as string)}_${parseFloat(lng as string)}_${parseFloat(radius as string)}_${countryKey}_${excludeBroken}`;
        
        const cachedResult = await CacheManager.get(cacheKey);
        if (cachedResult) {
          logger.log(`📦 Serving nearby stations from cache (${countryKey})`);
          return res.json(cachedResult);
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
            .select('name country geoLat geoLong votes url urlResolved codec bitrate favicon homepage tags lastCheckOk')
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
          .select('name country geoLat geoLong votes url urlResolved codec bitrate favicon homepage tags lastCheckOk')
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
        const allStations = await Station.find(filter).lean();

        allStations.sort((a: any, b: any) => {
          const aHasFavicon = a.favicon && a.favicon.trim() !== '' && a.favicon !== 'null' && a.favicon !== 'undefined';
          const bHasFavicon = b.favicon && b.favicon.trim() !== '' && b.favicon !== 'null' && b.favicon !== 'undefined';
          
          if (aHasFavicon && !bHasFavicon) return -1;
          if (!aHasFavicon && bHasFavicon) return 1;
          
          return (b.votes || 0) - (a.votes || 0);
        });

        stations = allStations.slice(0, Number(limit));
        
      } else {
        return res.json([]);
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
        return res.json(cachedStats);
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
      ]);
      
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

      const cacheKey = `similar_stations:${id}:${limit}`;
      const cachedResult = await CacheManager.get(cacheKey);
      if (cachedResult) return res.json(cachedResult);

      const sourceStation = await Station.findById(id).lean();
      if (!sourceStation) return res.status(404).json({ error: 'Station not found' });

      const similarStations = await RecommendationEngine.getPersonalizedSimilarStations({
        sourceStationId: id,
        limit: Number(limit)
      });

      const stationIds = similarStations.map(s => s.stationId);
      const stations = await Station.find({ _id: { $in: stationIds } }).lean();

      const orderedStations = similarStations
        .map(sim => stations.find(s => s._id.toString() === sim.stationId))
        .filter(Boolean);

      await CacheManager.set(cacheKey, orderedStations, { ttl: 3600 });
      res.json(stripPlaceholders(orderedStations));
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch similar stations' });
    }
  });

  // RANDOM COUNTRY STATION
  app.get("/api/stations/country-random", async (req, res) => {
    try {
      const { country } = req.query;
      if (!country) return res.status(400).json({ error: 'Country parameter is required' });

      const filter = normalizeCountryFilter(country as string);
      const [station] = await Station.aggregate([
        { $match: filter },
        { $sample: { size: 1 } }
      ]);
      if (!station) return res.status(404).json({ error: 'No stations found for this country' });
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
      if (isGlobal) {
        const cacheReady = await PrecomputedStationsService.hasGlobalCache();
        if (!cacheReady) {
          // Fast MongoDB fallback: sorted by votes desc with logo priority
          const skip = (pageNum - 1) * limitNum;
          const mongoFilter: any = genre ? { $or: [{ genre: { $regex: new RegExp(genre as string, 'i') } }, { tags: { $regex: new RegExp(genre as string, 'i') } }] } : {};
          if (search) { const q = search as string; mongoFilter.name = { $regex: new RegExp(q, 'i') }; }
          const [stations, total] = await Promise.all([
            Station.find(mongoFilter)
              .select('_id name url urlResolved favicon country countrycode state language genre codec bitrate homepage tags slug hls votes clickCount lastCheckOk hasLogo logoAssets')
              .sort({ hasLogo: -1, votes: -1 })
              .skip(skip)
              .limit(limitNum)
              .lean(),
            Station.countDocuments(mongoFilter)
          ]);
          return res.json({
            success: true, data: stations, stations, total, count: total, page: pageNum,
            totalPages: Math.ceil(total / limitNum), cached: false,
            pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) }
          });
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
    } catch (error) {
      logger.error('Error fetching precomputed stations:', error);
      res.status(500).json({ error: 'Failed to fetch precomputed stations' });
    }
  });

  // LINKED STATIONS - Related stations for station detail page
  app.get("/api/stations/:stationId/linked", async (req, res) => {
    try {
      const { stationId } = req.params;
      const station = await Station.findById(stationId).lean() as any;
      if (!station) return res.status(404).json({ error: 'Station not found' });

      const filter: any = { _id: { $ne: stationId } };
      if (station.country) filter.country = station.country;
      if (station.genre) filter.genre = { $regex: new RegExp(station.genre, 'i') };

      const linked = await Station.find(filter)
        .select('_id name favicon slug country genre tags votes bitrate codec language url urlResolved hls lastCheckOk hasLogo logoAssets')
        .sort({ votes: -1 })
        .limit(12)
        .lean();

      res.json({ stations: linked });
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

      if (isTV && !search) {
        const tvCacheKey = `tv:stations:${country || 'all'}:${state || 'all'}:${genre || 'all'}:${tags || 'all'}:${language || 'all'}:${sort}:${page}:${limit}:${excludeBroken}:${timePeriod}`;
        const cachedResult = await CacheManager.get(tvCacheKey);
        if (cachedResult) return res.json(cachedResult);
        (req as any)._tvCacheKey = tvCacheKey;
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
          filter.$or.push(...searchTerms.map((term: string) => ({ state: { $regex: new RegExp(term, 'i') } })));
        } else {
          filter.state = { $regex: new RegExp(state as string, 'i') };
        }
      }

      if (tags && tags !== 'all') filter.tags = { $regex: new RegExp(tags as string, 'i') };

      if (genre && genre !== 'all') {
        const escapedGenre = (genre as string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filter.$or = [
          { genre: { $regex: new RegExp(`^${escapedGenre}$`, 'i') } },
          { tags: { $regex: new RegExp(`(^|,)\\s*${escapedGenre}\\s*(,|$)`, 'i') } }
        ];
      }

      if (language && language !== 'all') filter.language = { $regex: new RegExp(language as string, 'i') };

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

      const stations = await Station.aggregate(pipeline);

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

      const tvCacheKey = (req as any)._tvCacheKey;
      if (tvCacheKey) await CacheManager.set(tvCacheKey, response, { ttl: 300 });

      res.json(response);
    } catch (error) {
      logger.error('Error fetching stations:', error);
      res.status(500).json({ error: 'Failed to fetch stations' });
    }
  });
}
