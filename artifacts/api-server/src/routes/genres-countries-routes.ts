import type { Express } from "express";
import { Genre, Country, Station, UserProfile, UserListeningHistory, SAFE_GENRE_SLUG_RE } from '../shared/mongo-schemas';
import { RecommendationEngine } from '../services/recommendation-engine';
import CacheManager, { CacheKeys } from '../cache';
import { PrecomputedGenresService } from '../services/precomputed-genres';
import { normalizeCountryFilter, resolveToDbName, getAllCountryInfoFromDb } from '../utils/normalize-country';
import { tvValidateParams, tvSlimGenre, stripPlaceholders } from './shared-utils';
import { logger } from '../utils/logger';

export function registerGenresCountriesRoutes(app: Express, deps: any) {
  const { requireAdmin } = deps;

  // ML RECOMMENDATION APIs
  
  // Track user listening behavior for ML learning
  app.post("/api/ml/track-interaction", async (req, res) => {
    try {
      const { 
        sessionId, 
        stationId, 
        listenDuration, 
        interactionType, 
        deviceType, 
        location, 
        skipReason 
      } = req.body;

      if (!sessionId || !stationId || listenDuration === undefined || !interactionType) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      await RecommendationEngine.recordUserInteraction({
        sessionId,
        stationId,
        listenDuration: Number(listenDuration),
        interactionType,
        deviceType,
        location,
        skipReason
      });

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to track interaction' });
    }
  });

  // Get user's listening profile
  app.get("/api/ml/user-profile/:sessionId", async (req, res) => {
    try {
      const { sessionId } = req.params;
      const profile = await UserProfile.findOne({ sessionId }).lean();
      
      if (!profile) {
        return res.json({
          profileStrength: 0,
          preferredGenres: [],
          preferredCountries: [],
          averageListenDuration: 0,
          totalStationsListened: 0,
          uniqueStationsCount: 0,
          peakListeningHours: [],
          message: 'Profile still learning from your listening habits'
        });
      }

      res.json({
        profileStrength: profile.profileStrength,
        preferredGenres: profile.preferredGenres?.slice(0, 3) || [],
        preferredCountries: profile.preferredCountries?.slice(0, 2) || [],
        averageListenDuration: Math.round(profile.averageListenDuration || 0),
        totalStationsListened: profile.totalStationsListened || 0,
        uniqueStationsCount: profile.uniqueStationsCount || 0,
        peakListeningHours: profile.peakListeningHours || []
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get user profile' });
    }
  });

  // Get personalized recommendations for homepage
  app.get("/api/ml/recommendations/:sessionId", async (req, res) => {
    try {
      const { sessionId } = req.params;
      const { limit = 20 } = req.query;

      const recentStations = await UserListeningHistory.find({ sessionId })
        .sort({ listenedAt: -1 })
        .limit(5)
        .lean();

      if (recentStations.length === 0) {
        const popularStations = await Station.find({})
          .sort({ votes: -1 })
          .limit(parseInt(limit as string) || 6)
          .lean();
        
        const starterRecommendations = popularStations.map(station => ({
          ...station,
          _recommendation: {
            score: 0.8,
            reasons: ['Popular station', 'Great for discovering new music'],
            confidence: 0.7,
            type: 'popularity' as const
          }
        }));
        
        return res.json(starterRecommendations);
      }

      const mostRecentStation = recentStations[0];
      const recommendations = await RecommendationEngine.getPersonalizedSimilarStations({
        sourceStationId: mostRecentStation.stationId,
        sessionId,
        limit: parseInt(limit as string),
        minConfidence: 0.1
      });

      if (recommendations.length > 0) {
        const stationIds = recommendations.map(rec => rec.stationId);
        const stations = await Station.find({ _id: { $in: stationIds } }).lean();
        
        const enhancedStations = stations.map(station => {
          const rec = recommendations.find(r => r.stationId === station._id.toString());
          return {
            ...station,
            _recommendation: {
              score: rec?.score || 0,
              reasons: rec?.reasons || [],
              confidence: rec?.confidence || 0,
              type: rec?.type || 'unknown'
            }
          };
        });

        return res.json(enhancedStations);
      }

      res.json([]);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get recommendations' });
    }
  });

  // COUNTRIES API
  app.get("/api/countries", async (req, res) => {
    try {
      const format = req.query.format as string;

      if (format === 'rich') {
        const countryCounts = await Station.aggregate([
          { $match: { country: { $nin: [null, ''] } } },
          { $group: { _id: '$country', count: { $sum: 1 } } },
          { $sort: { _id: 1 } }
        ]);
        const countries = getAllCountryInfoFromDb(
          countryCounts.map((c: any) => ({ name: c._id, count: c.count }))
        );
        return res.json(countries);
      }

      const countries = await Station.distinct('country').lean();
      const filteredCountries = countries.filter(country => country && country.trim() !== '');
      res.json(filteredCountries.sort());
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch countries' });
    }
  });

  // GENRES API - Merge real genres from DB with dynamic genres from station data
  app.get("/api/genres", async (req, res) => {
    try {
      const isTV = req.query.tv === '1';
      const { 
        sortColumn = 'stationCount', 
        sortBy = 'desc',
        filters = {} 
      } = req.query;
      const gParams = isTV ? tvValidateParams(req.query) : {
        page: parseInt(req.query.page as string) || 1,
        limit: parseInt(req.query.limit as string) || 9
      };
      const page = gParams.page;
      const limit = gParams.limit;
      
      let parsedFilters = {};
      try {
        if (typeof filters === 'string' && filters.trim() !== '') {
          const decodedFilters = decodeURIComponent(filters);
          parsedFilters = JSON.parse(decodedFilters);
        } else if (filters && typeof filters === 'object') {
          parsedFilters = filters;
        }
      } catch (e) {
        parsedFilters = {};
      }
      let { countrycode, searchQuery } = parsedFilters as any;
      
      if (!countrycode) {
        countrycode = (req.query.countrycode as string) || (req.query.country as string) || (req.query.countryCode as string) || null;
      }
      if (!searchQuery) {
        searchQuery = (req.query.search as string) || (req.query.searchQuery as string) || null;
      }
      
      const cacheKey = CacheKeys.genres(parseInt(page as string), parseInt(limit as string), { searchQuery, countrycode, sortColumn, sortBy });
      const disableCache = countrycode === 'Austria';
      const cachedResult = !disableCache ? await CacheManager.get(cacheKey) : null;
      
      if (cachedResult && !disableCache) {
        if (isTV && (cachedResult as any).genres) {
          return res.json({
            genres: (cachedResult as any).genres.map(tvSlimGenre),
            data: (cachedResult as any).genres.map(tvSlimGenre),
            total: (cachedResult as any).total,
            page: (cachedResult as any).page,
            limit: (cachedResult as any).limit,
            totalPages: (cachedResult as any).totalPages
          });
        }
        return res.json(cachedResult);
      }

      const realGenres = await Genre.find({ isDiscoverable: true }).lean();
      let stationFilter = {};
      if (countrycode && countrycode !== 'global' && countrycode !== 'null') {
        Object.assign(stationFilter, normalizeCountryFilter(countrycode));
      }
      
      const genreCounts = await Station.aggregate([
        { $match: stationFilter },
        {
          $addFields: {
            allTags: {
              $setUnion: [
                { $cond: [
                  { $and: [{ $ne: ['$genre', null] }, { $ne: ['$genre', ''] }] },
                  [{ $toLower: '$genre' }],
                  []
                ]},
                { $cond: [
                  { $and: [{ $ne: ['$tags', null] }, { $ne: ['$tags', ''] }] },
                  { $map: {
                    input: { $split: ['$tags', ','] },
                    as: 'tag',
                    in: { $toLower: { $trim: { input: '$$tag' } } }
                  }},
                  []
                ]}
              ]
            }
          }
        },
        { $unwind: '$allTags' },
        { $match: { allTags: { $ne: '' } } },
        { $group: { _id: '$allTags', count: { $sum: 1 } } }
      ]);

      const tagCounts = new Map();
      for (const entry of genreCounts) {
        tagCounts.set(entry._id, entry.count);
      }
      
      let dynamicGenres = [];
      const isCountryFiltered = countrycode && countrycode !== 'global' && countrycode !== 'null';
      
      dynamicGenres = Array.from(tagCounts.entries())
        .filter(([tag, count]) => count >= 1 && tag.length > 1)
        .map(([tag, count]) => ({
          name: tag.charAt(0).toUpperCase() + tag.slice(1),
          slug: tag,
          stationCount: count,
          isDynamic: true
        }));
      
      const genreMap = new Map();
      if (!isCountryFiltered) {
        for (const realGenre of realGenres) {
          const normalizedName = realGenre.name.toLowerCase();
          let filteredCount = tagCounts.get(normalizedName);
          let actualCount = filteredCount !== undefined ? filteredCount : realGenre.stationCount;
          
          genreMap.set(normalizedName, {
            _id: realGenre._id,
            name: realGenre.name,
            slug: realGenre.slug || normalizedName.replace(/\s+/g, '-'),
            description: realGenre.description,
            stationCount: actualCount,
            total_stations: actualCount,
            posterImage: realGenre.posterImage,
            discoverableImage: realGenre.discoverableImage,
            isDiscoverable: realGenre.isDiscoverable,
            discoverable: realGenre.isDiscoverable,
            createdAt: realGenre.createdAt,
            updatedAt: realGenre.updatedAt,
            isDynamic: false
          });
        }
      }
      
      for (const dynamicGenre of dynamicGenres) {
        const normalizedName = dynamicGenre.name.toLowerCase();
        if (!genreMap.has(normalizedName)) {
          genreMap.set(normalizedName, {
            _id: `dynamic-${dynamicGenre.slug}`,
            name: dynamicGenre.name,
            slug: dynamicGenre.slug,
            posterImage: `/images/genre-bg-grad-${(genreMap.size % 4) + 1}.webp`,
            description: `${dynamicGenre.name} music and stations`,
            stationCount: dynamicGenre.stationCount,
            total_stations: dynamicGenre.stationCount,
            createdAt: new Date(),
            isDynamic: true
          });
        } else {
          const existingGenre = genreMap.get(normalizedName);
          existingGenre.stationCount = dynamicGenre.stationCount;
          existingGenre.total_stations = dynamicGenre.stationCount;
        }
      }
      
      let allGenres = Array.from(genreMap.values());
      if (isCountryFiltered) {
        allGenres = allGenres.filter(genre => (genre.stationCount || 0) > 0);
      }
      
      if (searchQuery) {
        const searchRegex = new RegExp(searchQuery, 'i');
        allGenres = allGenres.filter(genre => 
          searchRegex.test(genre.name) || 
          searchRegex.test(genre.slug) || 
          (genre.description && searchRegex.test(genre.description))
        );
      }
      
      const sortOrder = sortBy === 'desc' ? -1 : 1;
      allGenres.sort((a, b) => {
        if (sortColumn === 'total_stations' || sortColumn === 'stationCount') {
          return sortOrder === -1 ? (b.stationCount || 0) - (a.stationCount || 0) : (a.stationCount || 0) - (b.stationCount || 0);
        } else if (sortColumn === 'name') {
          return sortOrder === -1 ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name);
        }
        return 0;
      });
      
      const totalCount = allGenres.length;
      const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
      const paginatedGenres = allGenres.slice(skip, skip + parseInt(limit as string));
      
      const response = {
        success: true,
        genres: paginatedGenres,
        data: paginatedGenres,
        total: totalCount,
        count: totalCount,
        page: parseInt(page as string),
        currentPage: parseInt(page as string),
        limit: parseInt(limit as string),
        perPage: parseInt(limit as string),
        totalPages: Math.ceil(totalCount / parseInt(limit as string))
      };
      
      await CacheManager.set(cacheKey, response, { ttl: 3600 });
      
      if (isTV) {
        return res.json({
          genres: paginatedGenres.map(tvSlimGenre),
          data: paginatedGenres.map(tvSlimGenre),
          total: totalCount,
          page: parseInt(page as string),
          limit: parseInt(limit as string),
          totalPages: Math.ceil(totalCount / parseInt(limit as string))
        });
      }
      
      res.json(response);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch genres' });
    }
  });

  // PRECOMPUTED GENRES API - 7-day cache, ultra-fast genre browsing
  app.get("/api/genres/precomputed", async (req, res) => {
    try {
      const countryName = (req.query.countryName || req.query.country) as string | undefined;
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(Math.max(1, parseInt(req.query.limit as string) || 27), 200);
      const search = (req.query.search as string || '').toLowerCase().trim();

      const identifier = (!countryName || countryName === 'all') ? 'global' : countryName;
      const raw = await PrecomputedGenresService.getGenres(identifier);

      let genres = raw.genres || [];

      if (search) {
        genres = genres.filter((g: any) =>
          g.name?.toLowerCase().includes(search) || g.slug?.toLowerCase().includes(search)
        );
      }

      const total = genres.length;
      const skip = (page - 1) * limit;
      const paginated = genres.slice(skip, skip + limit);

      res.json({
        success: true,
        data: paginated,
        genres: paginated,
        count: total,
        total,
        currentPage: page,
        page,
        perPage: limit,
        limit,
        totalPages: Math.ceil(total / limit),
        computedAt: raw.computedAt,
        countryName: raw.countryName
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch precomputed genres' });
    }
  });

  // DISCOVERABLE GENRES API - for homepage genre tiles
  app.get("/api/genres/discoverable", async (req, res) => {
    try {
      const country = req.query.country as string | undefined;
      const limit = Math.min(parseInt(req.query.limit as string) || 13, 50);
      const cacheKey = `genres:discoverable:${country || 'all'}:${limit}`;
      const cached = await CacheManager.get(cacheKey);
      if (cached) return res.json(cached);

      let filter: any = { isDiscoverable: true };
      if (country) {
        const countryFilter = normalizeCountryFilter(country);
        if (Object.keys(countryFilter).length > 0) {
          const stationCountries = await Station.distinct('genre', { ...countryFilter, isDiscoverable: true });
          filter.name = { $in: stationCountries };
        }
      }

      const genres = await Genre.find({ isDiscoverable: true })
        .sort({ displayOrder: 1, stationCount: -1 })
        .limit(limit)
        .lean();

      await CacheManager.set(cacheKey, genres, { ttl: 600 });
      res.json(genres);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch discoverable genres' });
    }
  });

  app.get("/api/genres/slug/:slug", async (req, res) => {
    try {
      const { slug } = req.params;

      const cacheKey = `genre-slug:${slug}`;
      const cached = await CacheManager.get(cacheKey);
      if (cached) {
        return res.json(cached);
      }

      const genre = await Genre.findOne({ slug }).select('name slug stationCount description icon').lean();
      if (genre) {
        const result = { name: (genre as any).name, slug: (genre as any).slug, stationCount: (genre as any).stationCount, description: (genre as any).description, icon: (genre as any).icon };
        await CacheManager.set(cacheKey, result, { ttl: 3600 });
        return res.json(result);
      }

      const normalizedName = slug.replace(/-/g, ' ');
      const escapedName = normalizedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const stationCount = await Station.countDocuments({
        $or: [
          { tags: { $regex: new RegExp(`(^|,)\\s*${escapedName}\\s*(,|$)`, 'i') } },
          { genre: { $regex: new RegExp(escapedName, 'i') } }
        ]
      });

      if (stationCount > 0) {
        const result = { name: normalizedName.split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '), slug, stationCount };
        await CacheManager.set(cacheKey, result, { ttl: 3600 });
        return res.json(result);
      }

      return res.status(404).json({ error: 'Genre not found' });
    } catch (error) {
      console.error('Error fetching genre by slug:', error);
      res.status(500).json({ error: 'Failed to fetch genre' });
    }
  });

  // Admin-only update: PUT /api/genres/:id
  // Restores Edit support on the admin genres page (Task #167). Also clears
  // `cleanupDemotion` when an admin re-enables a genre demoted by the
  // slug-cleanup migration (Task #133).
  app.put("/api/genres/:id", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const {
        name,
        description,
        slug,
        isDiscoverable,
        discoverable,
        posterImage,
        discoverableImage,
        displayOrder,
      } = req.body || {};

      const set: Record<string, unknown> = {};
      if (typeof name === 'string') set.name = name.trim();
      if (typeof description === 'string') set.description = description;
      if (typeof posterImage === 'string') set.posterImage = posterImage;
      if (typeof discoverableImage === 'string') set.discoverableImage = discoverableImage;
      if (typeof displayOrder === 'number') set.displayOrder = displayOrder;

      const isDisc =
        typeof isDiscoverable === 'boolean' ? isDiscoverable
          : typeof discoverable === 'boolean' ? discoverable
            : undefined;
      if (typeof isDisc === 'boolean') set.isDiscoverable = isDisc;

      if (typeof slug === 'string' && slug.length > 0) {
        if (!SAFE_GENRE_SLUG_RE.test(slug)) {
          return res.status(400).json({
            error: `Invalid slug "${slug}". Must match ${SAFE_GENRE_SLUG_RE}`,
          });
        }
        set.slug = slug;
      }

      const ops: Record<string, unknown> = { $set: set };
      // Re-enabling a genre clears the forensic demotion record so it stops
      // appearing in the admin "Recently demoted by slug cleanup" view.
      if (isDisc === true) {
        ops.$unset = { cleanupDemotion: '' };
      }

      const updated = await Genre.findByIdAndUpdate(id, ops, {
        new: true,
        runValidators: true,
      });
      if (!updated) {
        return res.status(404).json({ error: 'Genre not found' });
      }

      try {
        await PrecomputedGenresService.refreshAll();
      } catch (err) {
        logger.warn({ err }, 'Failed to refresh precomputed genres after update');
      }

      res.json(updated);
    } catch (error: any) {
      if (error?.name === 'ValidationError') {
        return res.status(400).json({ error: error.message });
      }
      logger.error({ err: error }, 'Failed to update genre');
      res.status(500).json({ error: 'Failed to update genre' });
    }
  });

  // Admin-only delete: DELETE /api/genres/:id (Task #167)
  app.delete("/api/genres/:id", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await Genre.findByIdAndDelete(id);
      if (!deleted) {
        return res.status(404).json({ error: 'Genre not found' });
      }

      try {
        await PrecomputedGenresService.refreshAll();
      } catch (err) {
        logger.warn({ err }, 'Failed to refresh precomputed genres after delete');
      }

      res.json({ success: true });
    } catch (error) {
      logger.error({ err: error }, 'Failed to delete genre');
      res.status(500).json({ error: 'Failed to delete genre' });
    }
  });

  app.get("/api/genres/:slug/stations", async (req, res) => {
    try {
      const { slug } = req.params;
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const skip = (page - 1) * limit;
      const rawCountry = (req.query.country as string) || null;
      const country = (rawCountry && rawCountry !== 'undefined' && rawCountry !== 'null')
        ? (resolveToDbName(rawCountry) || rawCountry)
        : null;

      const cacheKey = `genre-stations:${slug}:${country || 'all'}:${page}:${limit}`;
      const cached = await CacheManager.get(cacheKey);
      if (cached) {
        return res.json(cached);
      }

      const genre = await Genre.findOne({ slug }).lean();
      if (!genre) {
        return res.status(404).json({ error: 'Genre not found' });
      }

      const filter: any = {
        $or: [
          { tags: { $regex: new RegExp(`(^|,)\\s*${(genre as any).name}\\s*(,|$)`, 'i') } },
          { genre: { $regex: new RegExp((genre as any).name, 'i') } }
        ]
      };
      if (country) {
        filter.country = { $regex: new RegExp(`^${country}$`, 'i') };
      }

      const [stations, total] = await Promise.all([
        Station.find(filter)
          .select('name slug favicon url country language genre tags votes codec bitrate logoAssets')
          .sort({ votes: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Station.countDocuments(filter)
      ]);

      const result = {
        genre: { name: (genre as any).name, slug: (genre as any).slug, stationCount: (genre as any).stationCount },
        stations,
        total,
        page,
        pages: Math.ceil(total / limit)
      };

      await CacheManager.set(cacheKey, result, { ttl: 300 });
      res.json(result);
    } catch (error) {
      console.error('Error fetching genre stations:', error);
      res.status(500).json({ error: 'Failed to fetch genre stations' });
    }
  });
}
