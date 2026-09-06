import type { Express } from "express";
import { pgRecommendationProfile, pgRecentSessionListening } from '../data/postgres-recommendation-store';
import { SAFE_GENRE_SLUG_RE } from '../seo/genre-slug';
import { pgCatalog } from '../data/postgres-catalog-store';
import { RecommendationEngine } from '../services/recommendation-engine';
import CacheManager, { CacheKeys } from '../cache';
import { PrecomputedGenresService } from '../services/precomputed-genres';
import { resolveToDbName, getAllCountryInfoFromDb } from '../utils/normalize-country';
import { tvValidateParams, tvSlimGenre } from './shared-utils';
import { logger } from '../utils/logger';
import { listStationsFromPostgres } from '../data/station-read-store';
import { pgCountryCounts, pgDiscoverableGenres, pgGenreBySlug, pgGenres, pgStoredGenreBySlug, pgCreateGenre, pgUpdateGenre, pgDeleteGenre } from '../data/postgres-taxonomy-store';

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
        return void res.status(400).json({ error: 'Missing required fields' });
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
      const profile = await pgRecommendationProfile(sessionId);
      
      if (!profile) {
        return void res.json({
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
      const { limit: rawLimit = 20 } = req.query;
      const limit = typeof rawLimit === 'string' ? (parseInt(rawLimit) || 20) : (typeof rawLimit === 'number' ? rawLimit : 20);

      const recentStations = await pgRecentSessionListening(sessionId, 5);

      if (recentStations.length === 0) {
        const popularStations = await pgCatalog().find({}, { sort: { votes: -1 }, limit: limit || 6 });
        
        const starterRecommendations = popularStations.map(station => ({
          ...station,
          _recommendation: {
            score: 0.8,
            reasons: ['Popular station', 'Great for discovering new music'],
            confidence: 0.7,
            type: 'popularity' as const
          }
        }));
        
        return void res.json(starterRecommendations);
      }

      const mostRecentStation = recentStations[0];
      const recommendations = await RecommendationEngine.getPersonalizedSimilarStations({
        sourceStationId: mostRecentStation.stationId,
        sessionId,
        limit: limit,
        minConfidence: 0.1
      });

      if (recommendations.length > 0) {
        const stationIds = recommendations.map(rec => rec.stationId);
        const stations = await pgCatalog().find({ _id: { $in: stationIds } });
        
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

        return void res.json(enhancedStations);
      }

      res.json([]);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get recommendations' });
    }
  });

  // COUNTRIES API
  // INCIDENT 2026-05-14: this endpoint (both modes) was uncached and ran
  // a full Station collection scan/aggregate on every page load. Add 24h
  // cache + bounded execution + soft fallback so a slow Atlas response
  // never blocks the UI.
  app.get("/api/countries", async (req, res) => {
    try {
      const format = req.query.format as string;
      const isRich = format === 'rich';
      const cacheKey = isRich ? 'countries:rich:v1' : 'countries:plain:v1';
      const cached = await CacheManager.get(cacheKey);
      if (cached) {
        res.set('Cache-Control', 'public, max-age=3600, s-maxage=86400');
        return void res.json(cached);
      }

      {
        const countryCounts = await pgCountryCounts();
        const countries = isRich
          ? getAllCountryInfoFromDb(countryCounts)
          : countryCounts.map((entry) => entry.name).sort();
        await CacheManager.set(cacheKey, countries, { ttl: 86400 });
        res.set('Cache-Control', 'public, max-age=3600, s-maxage=86400');
        return void res.json(countries);
      }


    } catch (error: any) {
      logger.warn('[countries] failed: ' + (error?.message || 'unknown'));
      // Soft-fail with empty list rather than 500 so the UI shell renders
      res.set('Cache-Control', 'no-store');
      res.status(503).json({ error: 'Taxonomy data is temporarily unavailable' });
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
      
      const cacheKey = CacheKeys.genres(page, limit, { searchQuery, countrycode, sortColumn, sortBy });
      const disableCache = countrycode === 'Austria';
      const cachedResult = !disableCache ? await CacheManager.get(cacheKey) : null;
      
      if (cachedResult && !disableCache) {
        if (isTV && (cachedResult as any).genres) {
          return void res.json({
            genres: (cachedResult as any).genres.map(tvSlimGenre),
            data: (cachedResult as any).genres.map(tvSlimGenre),
            total: (cachedResult as any).total,
            page: (cachedResult as any).page,
            limit: (cachedResult as any).limit,
            totalPages: (cachedResult as any).totalPages
          });
        }
        return void res.json(cachedResult);
      }

      {
        const scopedCountry = countrycode && !['global', 'null', 'all'].includes(String(countrycode))
          ? (resolveToDbName(String(countrycode)) || String(countrycode)) : undefined;
        let allGenres = await pgGenres(scopedCountry);
        if (searchQuery) {
          const needle = String(searchQuery).toLowerCase();
          allGenres = allGenres.filter((genre: any) =>
            genre.name?.toLowerCase().includes(needle) || genre.slug?.toLowerCase().includes(needle),
          );
        }
        const direction = sortBy === 'desc' ? -1 : 1;
        allGenres.sort((a: any, b: any) =>
          sortColumn === 'name'
            ? direction * a.name.localeCompare(b.name)
            : direction * ((a.stationCount || 0) - (b.stationCount || 0)),
        );
        const totalCount = allGenres.length;
        const paginatedGenres = allGenres.slice((page - 1) * limit, page * limit);
        const response = {
          success: true, genres: paginatedGenres, data: paginatedGenres,
          total: totalCount, count: totalCount, page, currentPage: page, limit,
          perPage: limit, totalPages: Math.ceil(totalCount / limit),
        };
        await CacheManager.set(cacheKey, response, { ttl: 86400 });
        return void res.json(isTV ? { ...response, genres: paginatedGenres.map(tvSlimGenre), data: paginatedGenres.map(tvSlimGenre) } : response);
      }

      
    } catch (error: any) {
      logger.error(`❌ /api/genres failed: code=${error?.code || 'unknown'} msg=${error?.message || error}`);
      res.set('Cache-Control', 'no-store');
      res.status(503).json({ success: false, error: 'Station data is temporarily unavailable' });
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
      {
        let genres = await pgGenres(identifier === 'global' ? undefined : (resolveToDbName(identifier) || identifier), true);
        if (search) genres = genres.filter((genre: any) => genre.name?.toLowerCase().includes(search) || genre.slug?.toLowerCase().includes(search));
        const total = genres.length;
        const paginated = genres.slice((page - 1) * limit, page * limit);
        return void res.json({
          success: true, data: paginated, genres: paginated, count: total, total,
          currentPage: page, page, perPage: limit, limit, totalPages: Math.ceil(total / limit),
          computedAt: Date.now(), countryName: identifier,
        });
      }

    } catch (error: any) {
      logger.error(`❌ /api/genres/precomputed failed: code=${error?.code || 'unknown'} msg=${error?.message || error}`);
      res.set('Cache-Control', 'no-store');
      res.status(503).json({ success: false, error: 'Station data is temporarily unavailable' });
    }
  });

  // DISCOVERABLE GENRES API - for homepage genre tiles
  app.get("/api/genres/discoverable", async (req, res) => {
    try {
      const country = req.query.country as string | undefined;
      const limit = Math.min(parseInt(req.query.limit as string) || 13, 50);
      const cacheKey = `genres:discoverable:${country || 'all'}:${limit}`;
      const cached = await CacheManager.get(cacheKey);
      if (cached) return void res.json(cached);

      {
        const genres = await pgDiscoverableGenres(
          country ? (resolveToDbName(country) || country) : undefined,
          limit,
        );
        await CacheManager.set(cacheKey, genres, { ttl: 600 });
        return void res.json(genres);
      }


    } catch (error: any) {
      logger.error(`❌ /api/genres/discoverable failed: code=${error?.code || 'unknown'} msg=${error?.message || error}`);
      res.set('Cache-Control', 'no-store');
      res.json([]);
    }
  });

  app.get("/api/genres/slug/:slug", async (req, res) => {
    try {
      const { slug } = req.params;

      const cacheKey = `genre-slug:${slug}`;
      const cached = await CacheManager.get(cacheKey);
      if (cached) {
        return void res.json(cached);
      }

      const genre = (await pgGenreBySlug(slug));
      if (genre) {
        const result = { name: (genre as any).name, slug: (genre as any).slug, stationCount: (genre as any).stationCount, description: (genre as any).description, icon: (genre as any).icon };
        await CacheManager.set(cacheKey, result, { ttl: 3600 });
        return void res.json(result);
      }

      const normalizedName = slug.replace(/-/g, ' ');
      const escapedName = normalizedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const stationCount = ((await listStationsFromPostgres({ genre: normalizedName, page: 1, limit: 1 })).totalCount);

      if (stationCount > 0) {
        const result = { name: normalizedName.split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '), slug, stationCount };
        await CacheManager.set(cacheKey, result, { ttl: 3600 });
        return void res.json(result);
      }

      return void res.status(404).json({ error: 'Genre not found' });
    } catch (error: any) {
      logger.error(`❌ /api/genres/slug failed: code=${error?.code || 'unknown'} msg=${error?.message || error}`);
      res.set('Cache-Control', 'no-store');
      res.status(503).json({ error: 'Taxonomy data is temporarily unavailable' });
    }
  });

  // Admin-only create: POST /api/genres (Task #209)
  // The admin genres page already had a "Create" dialog that POSTed here, but
  // the route was never registered, so creates silently 404'd.
  app.post("/api/genres", requireAdmin, async (req, res) => {
    try {
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

      if (typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: 'Genre name is required' });
      }
      if (typeof slug !== 'string' || slug.length === 0) {
        return res.status(400).json({ error: 'Genre slug is required' });
      }
      if (!SAFE_GENRE_SLUG_RE.test(slug)) {
        return res.status(400).json({
          error: `Invalid slug "${slug}". Must match ${SAFE_GENRE_SLUG_RE}`,
        });
      }

      const existing = await pgStoredGenreBySlug(slug);
      if (existing) {
        return res.status(409).json({ error: `A genre with slug "${slug}" already exists` });
      }

      const isDisc =
        typeof isDiscoverable === 'boolean' ? isDiscoverable
          : typeof discoverable === 'boolean' ? discoverable
            : false;

      const doc: Record<string, unknown> = {
        name: name.trim(),
        slug,
        isDiscoverable: isDisc,
      };
      if (typeof description === 'string') doc.description = description;
      if (typeof posterImage === 'string') doc.posterImage = posterImage;
      if (typeof discoverableImage === 'string') doc.discoverableImage = discoverableImage;
      if (typeof displayOrder === 'number') doc.displayOrder = displayOrder;

      let created;
      try {
        created = await pgCreateGenre(doc);
      } catch (err: any) {
        // Race-condition safety net: unique-index violation on slug.
        if (err?.code === '23505') {
          return res.status(409).json({ error: `A genre with slug "${slug}" already exists` });
        }
        throw err;
      }

      try {
        await PrecomputedGenresService.refreshAll();
      } catch (err) {
        logger.warn({ err }, 'Failed to refresh precomputed genres after create');
      }

      return res.status(201).json(created);
    } catch (error: any) {
      if (error?.name === 'ValidationError') {
        return res.status(400).json({ error: error.message });
      }
      logger.error({ err: error }, 'Failed to create genre');
      return res.status(500).json({ error: 'Failed to create genre' });
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
          return void res.status(400).json({
            error: `Invalid slug "${slug}". Must match ${SAFE_GENRE_SLUG_RE}`,
          });
        }
        // Task #210: Reject slug collisions before they hit the DB so two
        // genres can't end up sharing a slug (which breaks
        // `/api/genres/slug/:slug` lookups and SEO routing).
        const collision = await pgStoredGenreBySlug(slug);
        if (collision && String(collision._id) !== id) {
          return res.status(409).json({
            error: `Slug "${slug}" is already used by genre "${collision.name}".`,
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

      const updated = await pgUpdateGenre(String(id), set, isDisc === true);
      if (!updated) {
        return void res.status(404).json({ error: 'Genre not found' });
      }

      try {
        await PrecomputedGenresService.refreshAll();
      } catch (err) {
        logger.warn({ err }, 'Failed to refresh precomputed genres after update');
      }

      return res.json(updated);
    } catch (error: any) {
      if (error?.name === 'ValidationError') {
        return void res.status(400).json({ error: error.message });
      }
      // Task #210: Mongo duplicate-key fallback for the partial unique slug
      // index. Covers the race window between the findOne check above and the
      // findByIdAndUpdate below.
      if (error?.code === '23505') {
        return res.status(409).json({
          error: `Slug "${String(req.body?.slug || '')}" is already used by another genre.`,
        });
      }
      logger.error({ err: error }, 'Failed to update genre');
      return res.status(500).json({ error: 'Failed to update genre' });
    }
  });

  // Admin-only delete: DELETE /api/genres/:id (Task #167)
  app.delete("/api/genres/:id", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await pgDeleteGenre(String(id));
      if (!deleted) {
        return void res.status(404).json({ error: 'Genre not found' });
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
    const { slug } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const skip = (page - 1) * limit;
    const rawCountry = (req.query.country as string) || null;
    const country = (rawCountry && rawCountry !== 'undefined' && rawCountry !== 'null')
      ? (resolveToDbName(rawCountry) || rawCountry)
      : null;

    const cacheKey = `genre-stations:${slug}:${country || 'all'}:${page}:${limit}`;
    try {
      // INCIDENT 2026-05-16 v12 — was hard-500 on timeout, breaking SSR
      // genre pages. Single-flight + 8s maxTimeMS + soft-fail catch.
      // Genre.findOne stays OUTSIDE the single-flight so a real 404 is
      // a clean 404 (no `as any` sentinel inside the cached payload).
      const genre = (await pgGenreBySlug(slug));
      if (!genre) {
        return void res.status(404).json({ error: 'Genre not found' });
      }

      const result = await CacheManager.getOrSetSingleFlight(cacheKey, async () => {
        {
          const listed = await listStationsFromPostgres({
            genre: (genre as any).name,
            country: country || undefined,
            sort: 'votes', page, limit,
          });
          return {
            genre: { name: (genre as any).name, slug: (genre as any).slug, stationCount: (genre as any).stationCount },
            stations: listed.stations, total: listed.totalCount, page,
            pages: listed.pagination.pages,
          };
        }

      }, { ttl: 300 });

      res.json(result);
    } catch (error: any) {
      logger.error(`❌ /api/genres/:slug/stations failed: code=${error?.code || 'unknown'} msg=${error?.message || error}`);
      let stale: any = null;
      try { stale = await CacheManager.get(cacheKey); } catch {}
      res.set('Cache-Control', 'no-store');
      // Soft-fail payload: empty-but-shape-correct. `name: ''` (not the
      // slug) so the client can't accidentally render a fake genre title
      // when the DB is down.
      if (stale != null) { res.set('X-Data-Stale', 'true'); return void res.json(stale); }
      res.status(503).json({ error: 'Station data is temporarily unavailable' });
    }
  });
}
