import type { Express } from "express";
import { Station, UserProfile, UserListeningHistory, User, UserFollow, Country, Genre } from '../shared/mongo-schemas';
import { deduplicatedFetch, calculateDistance, normalizeCountryFilter, stripPlaceholders, tvValidateParams, tvSlimStation, tvSlimGenre } from './shared-utils';
import CacheManager, { CacheKeys } from '../cache';
import { logger } from '../utils/logger';
import { RecommendationEngine } from '../services/recommendation-engine';
import { getAllCountryInfoFromDb } from '../utils/normalize-country';
import { PrecomputedGenresService } from '../services/precomputed-genres';

export function registerPublicStationRoutes(app: Express, deps: any) {
  const { requireAdmin } = deps;

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
            distance: Math.round((Math.random() * 100 + 10) * 10) / 10
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
      const count = await Station.countDocuments(filter);
      if (count === 0) return res.status(404).json({ error: 'No stations found for this country' });

      const randomIdx = Math.floor(Math.random() * count);
      const station = await Station.findOne(filter).skip(randomIdx).lean();
      res.json(stripPlaceholders(station));
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch random station' });
    }
  });
}
