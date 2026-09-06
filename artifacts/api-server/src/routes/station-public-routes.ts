import type { Express } from "express";
import { stripPlaceholders, tvValidateParams, tvSlimStation } from './shared-utils';
import { normalizeCountryFilter, resolveToDbName } from '../utils/normalize-country';
import CacheManager from '../cache';
import { logger } from '../utils/logger';





import { slugifyStationName, evaluateJunkStation } from '../seo/junk-station-rules';
import {
  getStationByIdentifier,
  getGeoStationsFromPostgres,
  getNearbyStationsFromPostgres,
  getPopularStationsFromPostgres,
  getRandomCountryStationFromPostgres,
  getRelatedStationsFromPostgres,
  getStationStatsFromPostgres,
  listStationsFromPostgres,
  stationSlugExists,
  updateStationDerivedFields,
} from '../data/station-read-store';

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

// Synonym map: common non-English station/city names → English equivalents.
// Keys are lower-case. Allows "Viyana FM" → finds "Vienna FM", etc.
const SEARCH_SYNONYMS: Record<string, string> = {
  // Turkish city names
  viyana: 'vienna', münih: 'munich', londra: 'london', roma: 'rome',
  venedik: 'venice', floransa: 'florence', napoli: 'naples',
  barselona: 'barcelona', brüksel: 'brussels', moskova: 'moscow',
  varşova: 'warsaw', prag: 'prague', budapeşte: 'budapest',
  bükreş: 'bucharest', sofya: 'sofia', atina: 'athens',
  lizbon: 'lisbon', kopenhag: 'copenhagen', stokholm: 'stockholm',
  lahey: 'hague', zürih: 'zurich', cenevre: 'geneva',
  // German city names
  münchen: 'munich', köln: 'cologne', nürnberg: 'nuremberg',
  zürich: 'zurich',
  // Turkish country names
  almanya: 'germany', avusturya: 'austria', ingiltere: 'england',
  fransa: 'france', italya: 'italy', ispanya: 'spain',
  hollanda: 'netherlands', belçika: 'belgium', portekiz: 'portugal',
  lehistan: 'poland', rusya: 'russia', japonya: 'japan',
  çin: 'china', hindistan: 'india', brezilya: 'brazil',
  avustralya: 'australia', kanada: 'canada', meksika: 'mexico',
};

// Substitute synonyms word-by-word in a search term.
// "Viyana FM" → "vienna FM" (synonym for "viyana" is "vienna").
function applySynonyms(term: string): string {
  return term
    .split(/\s+/)
    .map(w => {
      const sub = SEARCH_SYNONYMS[w.toLowerCase()];
      return sub ?? w;
    })
    .join(' ');
}

// Sanitise a raw user string for use in MongoDB $text search.
// $text tokenises on whitespace/punctuation and ignores most special chars,
// so we only strip characters that break the parser ($, ", \).
function sanitiseForTextSearch(term: string): string {
  return term.replace(/[$"\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
}

// Helper: generate unique slug inline
async function generateUniqueSlug(name: string, type: string, id: string): Promise<string> {
  const base = slugifyStationName(name);
  let slug = base || id;
  let counter = 0;
  while (true) {
    const candidate = counter === 0 ? slug : `${slug}-${counter}`;
    if (!(await stationSlugExists(candidate, id))) return candidate;
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

      const station: any = await getStationByIdentifier(identifier);

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
        await updateStationDerivedFields(String(station._id), update);
        station.slug = newSlug;
      }

      const result = stripPlaceholders(station);
      await CacheManager.set(cacheKey, result, { ttl: 300 });
      res.json(result);
    } catch (error: any) {
      logger.error(`❌ /api/station/:identifier failed: code=${error?.code || 'unknown'} msg=${error?.message || error}`);
      let stale: any = null;
      try { stale = await CacheManager.get(`station:detail:${req.params.identifier}`); } catch {}
      res.set('Cache-Control', 'no-store');
      if (stale != null) { res.set('X-Data-Stale', 'true'); return void res.json(stale); }
      res.status(503).json({ error: 'Station data is temporarily unavailable' });
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
      {
        const stations = await CacheManager.getOrSetSWR<any[]>(cacheKey, () =>
          getPopularStationsFromPostgres({
            country: country && !['all', 'null', 'undefined'].includes(String(country)) ? resolvedCountry : undefined,
            state: state && !['all', 'null', 'undefined'].includes(String(state)) ? String(state) : undefined,
            limit: Number(limit),
            requireLogo: isTV,
          }),
          { freshTtl: 3600, staleTtl: 21600 },
        );
        res.set('Cache-Control', 'public, max-age=600, s-maxage=3600');
        return void res.json(isTV ? stations.map(tvSlimStation) : stripPlaceholders(stations));
      }
      // INCIDENT 2026-05-15 v10 — wrapped compute in single-flight so 100
      // concurrent cold misses (typical SSR fanout when CDN expires the
      // homepage) coalesce into ONE Mongo aggregate. Previously each
      // miss spawned its own pair of aggregates, draining the M10 pool.
      // INCIDENT 2026-05-15 v10.2 — upgraded to true SWR (1h fresh /
      // 6h stale) so a stressed cluster keeps serving last-known-good
      // popular stations during refresh windows instead of waiting
      // 5-15s on the aggregate.
      
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
      // INCIDENT 2026-05-15 v10.2 — read SWR envelope (`<key>:swr`),
      // not the dead base key, so we actually surface last-known-good.
      let stale: any = null;
      try { stale = await CacheManager.getSWR(cacheKey); } catch {}
      res.set('Cache-Control', 'no-store');
      // Apply the same response shaping as the success path so the
      // payload contract is identical on stale fallback (TV gets slim
      // shape; web strips placeholder logos).
      if (!Array.isArray(stale)) return void res.status(503).json({ error: 'Station data is temporarily unavailable' });
      res.set('X-Data-Stale', 'true');
      const staleArr: any[] = stale;
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

      {
        const result = stripPlaceholders(await getGeoStationsFromPostgres(safeLimit));
        await CacheManager.set(cacheKey, result, { ttl: 1800 });
        return void res.json(result);
      }

      
    } catch (error: any) {
      logger.error(`❌ /api/stations/with-geo failed: code=${error?.code || 'unknown'} msg=${error?.message || error}`);
      let stale: any = null;
      try {
        const rawLimit = parseInt((req.query.limit as string) || '1000', 10);
        const safeLimit = Math.min(Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 1000, 5000);
        stale = await CacheManager.get(`stations:with_geo:${safeLimit}`);
      } catch {}
      res.set('Cache-Control', 'no-store');
      if (stale != null) { res.set('X-Data-Stale', 'true'); return void res.json(stale); }
      res.status(503).json({ error: 'Station data is temporarily unavailable' });
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

      {
        stations = await getNearbyStationsFromPostgres({
          latitude: lat ? parseFloat(lat as string) : undefined,
          longitude: lng ? parseFloat(lng as string) : undefined,
          radiusKm: parseFloat(radius as string),
          limit: Number(limit),
          country: country && !['all', 'null', 'undefined'].includes(String(country))
            ? (resolveToDbName(country as string) || String(country)) : undefined,
          excludeBroken: excludeBroken === 'true',
          userCountry: userCountry ? String(userCountry) : undefined,
        });
        if (lat && lng && stations.length > 0) {
          const snappedLat = Math.round(parseFloat(lat as string) * 100) / 100;
          const snappedLng = Math.round(parseFloat(lng as string) * 100) / 100;
          const countryKey = country && country !== 'all' ? String(country) : 'global';
          await CacheManager.set(`nearby:${snappedLat}_${snappedLng}_${parseFloat(radius as string)}_${countryKey}_${excludeBroken}`, stations, { ttl: 1800 });
        }
        return void res.json(stripPlaceholders(stations));
      }


    } catch (error: any) {
      logger.error(`❌ /api/stations/nearby failed: code=${error?.code || 'unknown'} msg=${error?.message || error}`);
      let stale: any = null;
      try {
        const { lat, lng, radius = 100, country, excludeBroken = 'false' } = req.query;
        if (lat && lng) {
          const snappedLat = Math.round(parseFloat(lat as string) * 100) / 100;
          const snappedLng = Math.round(parseFloat(lng as string) * 100) / 100;
          const countryKey = country && country !== 'all' ? (country as string) : 'global';
          stale = await CacheManager.get(`nearby:${snappedLat}_${snappedLng}_${parseFloat(radius as string)}_${countryKey}_${excludeBroken}`);
        }
      } catch {}
      res.set('Cache-Control', 'no-store');
      if (stale != null) { res.set('X-Data-Stale', 'true'); return void res.json(stale); }
      res.status(503).json({ error: 'Station data is temporarily unavailable' });
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
      {
        const result = await getStationStatsFromPostgres();
        await CacheManager.set(cacheKey, result, { ttl: 1800 });
        return void res.json(result);
      }
      
      
    } catch (error: any) {
      logger.error(`❌ /api/stations/stats failed: code=${error?.code || 'unknown'} msg=${error?.message || error}`);
      let stale: any = null;
      try { stale = await CacheManager.get('station_stats'); } catch {}
      res.set('Cache-Control', 'no-store');
      if (stale != null) { res.set('X-Data-Stale', 'true'); return void res.json(stale); }
      res.status(503).json({ error: 'Station data is temporarily unavailable' });
    }
  });

  // SIMILAR STATIONS API
  app.get("/api/stations/similar/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const limitNum = Math.min(Math.max(Number(req.query.limit ?? 6), 1), 20);
      const cacheKey = `similar_stations:${id}:${limitNum}`;

      // Single-flight: concurrent cold-misses for the same station coalesce
      // into one DB call instead of spawning N parallel RecommendationEngine runs.
      const result = await CacheManager.getOrSetSingleFlight<any[] | null>(cacheKey, async () => {
        {
          return getRelatedStationsFromPostgres(id, limitNum);
        }

      }, { ttl: 3600 });

      if (result === null) return void res.status(404).json({ error: 'Station not found' });

      // Let the Tizen app / CDN cache the response — similar stations change rarely.
      res.set('Cache-Control', 'public, max-age=300, s-maxage=3600');
      res.json(stripPlaceholders(result));
    } catch (error: any) {
      logger.error(`❌ /api/stations/similar/:id failed: code=${error?.code || 'unknown'} msg=${error?.message || error}`);
      let stale: any = null;
      try {
        stale = await CacheManager.get(`similar_stations:${req.params.id}:${Math.min(Math.max(Number(req.query.limit ?? 6), 1), 20)}`);
      } catch {}
      res.set('Cache-Control', 'no-store');
      if (stale != null) { res.set('X-Data-Stale', 'true'); return void res.json(stale); }
      res.status(503).json({ error: 'Station data is temporarily unavailable' });
    }
  });

  // RANDOM COUNTRY STATION
  app.get("/api/stations/country-random", async (req, res) => {
    try {
      const { country } = req.query;
      if (!country) return void res.status(400).json({ error: 'Country parameter is required' });

      const filter = normalizeCountryFilter(country as string);
      {
        const station = await getRandomCountryStationFromPostgres(
          resolveToDbName(country as string) || String(country),
        );
        if (!station) return void res.status(404).json({ error: 'No stations found for this country' });
        return void res.json(stripPlaceholders(station));
      }

    } catch (error: any) {
      logger.error(`❌ /api/stations/country-random failed: code=${error?.code || 'unknown'} msg=${error?.message || error}`);
      res.set('Cache-Control', 'no-store');
      res.status(503).json({ error: 'Station data is temporarily unavailable' });
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

      {
        const pgResult = await listStationsFromPostgres({
          country: isGlobal ? undefined : (
            resolveToDbName(((countryName as string) || (countryCode as string))) ||
            (countryName as string) || (countryCode as string)
          ),
          genre: genre as string | undefined,
          language: language as string | undefined,
          search: search as string | undefined,
          page: pageNum,
          limit: limitNum,
          sort: sort as string | undefined,
          hasLogo: hasLogo === 'true' ? true : hasLogo === 'false' ? false : undefined,
          codec: typeof codec === 'string' ? codec : undefined,
          minBitrate: bitrate ? parseInt(String(bitrate)) : undefined,
        });
        const stations = pgResult.stations;
        return void res.json({
          success: true, data: stations, stations, total: pgResult.totalCount,
          count: pgResult.totalCount, page: pageNum,
          totalPages: pgResult.pagination.pages, cached: false,
          pagination: pgResult.pagination,
        });
      }

      // INCIDENT 2026-05-15 v10.2 round 9 — REMOVED the `hasGlobalCache()`
      // cold-fallback branch. Previously, when the SWR envelope was
      // empty, the route ran an uncoalesced direct `Station.find()` on
      // every cold request: NOT singleflight-coalesced (so 100 cold SSR
      // requests = 100 200k-doc scans), and the result was NEVER
      // written into the SWR envelope (so the cache could never warm
      // up — every request stayed cold forever).
      //
      // Fix: always route through `PrecomputedStationsService.getGlobalStations()`,
      // which is wrapped in `getOrSetSWR` with singleflight. The first
      // organic visitor pays one bounded compute (15s `maxTimeMS`), the
      // result is written into the SWR envelope, and every concurrent
      // miss coalesces onto that same in-flight promise. After the
      // envelope is populated, subsequent traffic gets fresh-or-stale
      // hits with background refresh — no more cold fallback ever.

    } catch (error: any) {
      // INCIDENT 2026-05-14 round 8: this catch was emitting `logger.error`
      // (with full stack trace) once per failed request — during the failover
      // storm it printed 200+ stack traces in 10 minutes. Downgrade to a
      // single-line warn + return an empty payload so a transient cluster
      // blip degrades gracefully instead of looking like an outage in logs.
      // INCIDENT 2026-05-15 v10.2 — structured code/codeName + no-store
      // on the failure response so a transient cluster blip doesn't
      // get cached as an empty payload by upstream CDN.
      logger.warn(`[/api/stations/precomputed] failed: code=${error?.code || 'unknown'} codeName=${error?.codeName || 'unknown'} msg=${error?.message || 'unknown'}`);
      res.set('Cache-Control', 'no-store');
      res.status(503).json({ success: false, error: 'Station data is temporarily unavailable' });
    }
  });

  app.get("/api/now-playing/:id", async (req, res) => {
    try {
      const { id } = req.params;

      const station = (await getStationByIdentifier(id));

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

      {
        const linked = await getRelatedStationsFromPostgres(stationId, 12);
        if (linked === null) return void res.status(404).json({ error: 'Station not found' });
        const result = { stations: linked };
        await CacheManager.set(cacheKey, result, { ttl: 1800 });
        return void res.json(result);
      }


    } catch (error: any) {
      logger.error(`❌ /api/stations/:stationId/linked failed: code=${error?.code || 'unknown'} msg=${error?.message || error}`);
      let stale: any = null;
      try { stale = await CacheManager.get(`stations:linked:${req.params.stationId}`); } catch {}
      res.set('Cache-Control', 'no-store');
      if (stale != null) { res.set('X-Data-Stale', 'true'); return void res.json(stale); }
      res.status(503).json({ error: 'Station data is temporarily unavailable' });
    }
  });

  // MAIN STATIONS LIST API - Full filter/sort/search/pagination
  app.get("/api/stations", async (req, res) => {
    // INCIDENT 2026-05-16 v11 — restructured: cacheable path (no search,
    // no excludeStationIds) is now wrapped in CacheManager.getOrSetSingleFlight
    // so 50 concurrent SSR cold misses on the same country page coalesce
    // into ONE Mongo aggregate. The Railway 15:06-16:18 log dump showed
    // this endpoint draining the 100-slot pool over 4 minutes because
    // every miss spawned its own aggregate. Pattern copied from
    // /api/stations/popular at L163.
    // Also writes a country-only LKG ("last known good") cache after
    // every successful aggregate so the catch-block fallback can serve
    // a populated country page even when the exact filter/sort/page
    // combination has no cached entry.
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

    // Country-only LKG cache key — last successful payload for this
    // country regardless of filter/sort/page. Used as second-tier
    // fallback in the catch block when the exact webCacheKey is cold.
    const lkgKey = `stations:list:lkg:${country || 'all'}:${isTV ? 'tv' : 'web'}`;

    const computeStationsList = async () => {
      {
        let createdAfter: Date | undefined;
        if (timePeriod && timePeriod !== 'all') {
          const milliseconds = timePeriod === '24h' ? 86400000 : timePeriod === '7d' ? 604800000 : timePeriod === '30d' ? 2592000000 : 0;
          if (milliseconds) createdAfter = new Date(Date.now() - milliseconds);
        }
        return listStationsFromPostgres({
          country: country && country !== 'all' ? (resolveToDbName(country as string) || String(country)) : undefined,
          state: state && state !== 'all' ? String(state) : undefined,
          genre: genre && genre !== 'all' ? String(genre) : undefined,
          tags: tags && tags !== 'all' ? String(tags) : undefined,
          language: language && language !== 'all' ? String(language) : undefined,
          search: search ? applySynonyms(String(search).trim()) : undefined,
          sort: String(sort), excludeBroken: excludeBroken === 'true',
          excludeIds: typeof excludeStationIds === 'string' ? excludeStationIds.split(',').map((value) => value.trim()).filter(Boolean) : [],
          minVotes: Number(minVotes) || 0, createdAfter, page: Number(page), limit: Number(limit),
        });
      }

    };

    try {
      // INCIDENT 2026-05-16 v11 — single-flight wrap for the cacheable
      // path. When webCacheKey is set (no search, no excludeStationIds),
      // 50 concurrent SSR misses on the same key coalesce to ONE
      // aggregate. The non-cacheable path (admin search, exclude lists)
      // still runs directly because the cache key is request-specific.
      const response = webCacheKey
        ? await CacheManager.getOrSetSingleFlight(webCacheKey, computeStationsList, { ttl: 300 })
        : await computeStationsList();

      // Write country-level LKG cache after every successful aggregate
      // so the catch-block fallback can serve a populated country page
      // even when the exact filter/sort/page combination has no entry.
      // 6h TTL — generous because LKG is intentionally only consulted
      // when the live aggregate fails.
      if (response && response.stations && response.stations.length > 0) {
        try { await CacheManager.set(lkgKey, response, { ttl: 21600 }); } catch {}
      }

      res.json(response);
    } catch (error: any) {
      logger.error(`❌ /api/stations failed: code=${error?.code || 'unknown'} msg=${error?.message || error}`);
      let stale: any = null;
      // Stale fallback is ONLY used for cacheable requests (no search,
      // no excludeStationIds). For search / exclude requests, returning
      // a country-level LKG would surface unrelated stations (e.g. a
      // failed `?search=jazz` would return ALL of Germany's stations).
      // Tier 1: exact webCacheKey (may already be populated by a
      // parallel successful caller before we threw).
      // Tier 2: country-level LKG so the visitor still gets a populated
      // page even on a cold exact-key miss.
      if (webCacheKey) {
        try { stale = await CacheManager.get(webCacheKey); } catch {}
        if (!stale) {
          try { stale = await CacheManager.get(lkgKey); } catch {}
        }
      }
      res.set('Cache-Control', 'no-store');
      if (stale != null) { res.set('X-Data-Stale', 'true'); return void res.json(stale); }
      res.status(503).json({ error: 'Station data is temporarily unavailable' });
    }
  });
}
