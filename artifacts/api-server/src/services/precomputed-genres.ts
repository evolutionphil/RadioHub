import { CacheManager } from '../cache';
import { Station, Genre, GenreCount } from '@workspace/db-shared/mongo-schemas';
import { logger } from '../utils/logger';
import { normalizeCountryFilter, resolveToDbName } from '../utils/normalize-country';
import { sleep } from '../utils/event-loop-yield';
import { trackOperation } from '../utils/operation-tracker';
import { getTopCountryDbNames } from '../seo/sitemap-manifest-builder';

interface PrecomputedGenre {
  _id: string;
  name: string;
  slug: string;
  total_stations: number;
  stationCount: number;
  posterImage?: string;
}

interface PrecomputedGenresData {
  genres: PrecomputedGenre[];
  total: number;
  computedAt: number;
  countryName: string;
}

const CACHE_TTL = 604800; // 7 days
const CACHE_KEY_PREFIX = 'precomputed_genres:v5:';
const GLOBAL_CACHE_KEY = 'precomputed_genres:v5:global';

export class PrecomputedGenresService {
  private static resolveCountry(input?: string): string | null {
    if (!input || input === 'all' || input === 'global') return null;
    return resolveToDbName(input);
  }

  private static getCacheKey(countryIdentifier: string): string {
    if (!countryIdentifier || countryIdentifier === 'all' || countryIdentifier === 'global') {
      return GLOBAL_CACHE_KEY;
    }
    const dbName = resolveToDbName(countryIdentifier);
    if (!dbName) return GLOBAL_CACHE_KEY;
    const normalized = dbName.toLowerCase().replace(/[^a-z0-9]/g, '_');
    return `${CACHE_KEY_PREFIX}${normalized}`;
  }

  static async computeGenresForCountry(countryIdentifier?: string): Promise<PrecomputedGenresData> {
    const dbName = this.resolveCountry(countryIdentifier);
    const isGlobal = !dbName;
    
    return trackOperation('compute-genres', async () => {
    const stationFilter: any = isGlobal ? {} : normalizeCountryFilter(dbName);

    // INCIDENT 2026-05-14 (revisited 2026-05-16): the previous "skip on
    // global" workaround caused /api/genres/precomputed to return only
    // the 2 hand-curated Discoverable genres (Rock, Jazz) globally, so
    // the mobile/web Genres page looked broken. We now ALWAYS run the
    // unwind+group aggregate, but:
    //   - Global gets a generous 60s budget + allowDiskUse so the
    //     planner can spill ~40k stations × ~10 tags = ~400k unwound
    //     docs to disk. Country keeps the tight 8s budget.
    //   - try/catch falls back to the pre-aggregated Genre.stationCount
    //     map if the aggregate ever times out, so we degrade to the
    //     OLD behavior (Rock+Jazz only) instead of an empty page.
    //   - Wrapped in SWR (28-day stale window) + nightly 5 AM cron, so
    //     a real visitor effectively NEVER waits for this aggregate.
    // INCIDENT 2026-05-16 — denormalized read path. Instead of running
    // the unwind+group aggregate at request time (8s/60s budgets that
    // routinely timed out under M10 multiplanner pressure), read from
    // the precomputed `genre_counts` collection populated nightly by
    // PrecomputedGenresService.refreshGenreCounts(). The aggregate is
    // kept only as a cold-start fallback for the very first deploy.
    let genreCounts: Array<{ _id: string; count: number }> = [];
    const countryKey = dbName || 'global';
    try {
      const rows = await GenreCount.find({ country: countryKey })
        .select({ slug: 1, count: 1, _id: 0 })
        .lean();
      genreCounts = rows.map(r => ({ _id: r.slug, count: r.count }));
    } catch (gcErr: any) {
      logger.warn(`[precomputed-genres] genre_counts read failed for ${countryKey}: ${gcErr?.message || 'unknown'}`);
    }

    if (genreCounts.length === 0) {
      // Cold-start fallback: run the legacy aggregate ONCE so the first
      // deploy (before nightly cron has populated genre_counts) still
      // returns a populated list. After the cron runs, this branch is
      // never hit.
      try {
        const aggCounts = await Station.aggregate([
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
        ]).option({ maxTimeMS: isGlobal ? 60000 : 8000, allowDiskUse: true });
        genreCounts = aggCounts;
      } catch (aggErr: any) {
        logger.warn(`[precomputed-genres] cold-start aggregate failed for ${countryKey}: ${aggErr?.message || 'unknown'}`);
        genreCounts = [];
      }
    }

    const tagCounts = new Map<string, number>();
    for (const entry of genreCounts) {
      tagCounts.set(entry._id, entry.count);
    }

    const realGenres = await Genre.find({ isDiscoverable: true }).lean();
    const genreSet = new Set(realGenres.map(g => g.slug?.toLowerCase()));

    // Cold-start safety: if the aggregate timed out on global, seed
    // tagCounts from the pre-aggregated Genre.stationCount so the
    // page still renders (with the OLD limited set) instead of empty.
    if (isGlobal && tagCounts.size === 0) {
      logger.warn('[precomputed-genres] global aggregate empty — using Genre.stationCount fallback');
      for (const g of realGenres) {
        const slug = (g.slug || g.name || '').toLowerCase();
        if (slug && (g as any).stationCount > 0) {
          tagCounts.set(slug, (g as any).stationCount);
        }
      }
    }

    const allSlugs = new Set<string>();
    const genreEntries: Array<{ id: string; name: string; slug: string; posterImage?: string; isDb: boolean }> = [];

    for (const genre of realGenres) {
      const slug = genre.slug?.toLowerCase() || genre.name?.toLowerCase().replace(/\s+/g, '-');
      if (!allSlugs.has(slug)) {
        allSlugs.add(slug);
        genreEntries.push({
          id: genre._id?.toString() || `db-${slug}`,
          name: genre.name || slug,
          slug,
          posterImage: genre.posterImage,
          isDb: true
        });
      }
    }

    const isCountrySpecific = !!dbName;
    const minThreshold = isCountrySpecific ? 1 : 5;
    
    for (const [tag, count] of tagCounts.entries()) {
      if (!genreSet.has(tag) && !allSlugs.has(tag) && count >= minThreshold) {
        allSlugs.add(tag);
        const displayName = tag.split(/[\s-]+/).map(
          word => word.charAt(0).toUpperCase() + word.slice(1)
        ).join(' ');
        genreEntries.push({
          id: `dynamic-${tag}`,
          name: displayName,
          slug: tag.replace(/\s+/g, '-'),
          isDb: false
        });
      }
    }

    const allGenres: PrecomputedGenre[] = [];
    
    for (const entry of genreEntries) {
      const slug = entry.slug.toLowerCase();
      const count = tagCounts.get(slug) || 0;
      if (count > 0) {
        allGenres.push({
          _id: entry.id,
          name: entry.name,
          slug: entry.slug,
          total_stations: count,
          stationCount: count,
          posterImage: entry.posterImage || `/images/genre-bg-grad-${(Math.abs(entry.slug.split('').reduce((a: number, b: string) => a + b.charCodeAt(0), 0)) % 4) + 1}.webp`
        });
      }
    }

    allGenres.sort((a, b) => b.total_stations - a.total_stations);

    return {
      genres: allGenres,
      total: allGenres.length,
      computedAt: Date.now(),
      countryName: dbName || 'global'
    };
    }, countryIdentifier || 'global');
  }

  static async getGenres(countryIdentifier?: string): Promise<PrecomputedGenresData> {
    const cacheKey = this.getCacheKey(countryIdentifier || 'global');
    const startTime = Date.now();

    // INCIDENT 2026-05-15 v10.2 — wrap in SWR so concurrent cold misses
    // coalesce AND a stressed M10 keeps serving last-known-good genre
    // counts during refresh windows. The country aggregate is the
    // exact path that emitted "[precomputed-genres] country aggregate
    // failed for Türkiye :: error while multiplanner was selecting
    // best plan" in prod logs — SWR ensures the visitor still gets a
    // populated response.
    const data = await CacheManager.getOrSetSWR<PrecomputedGenresData>(
      cacheKey,
      async () => {
        logger.log(`[Cache MISS] precomputed genres ${countryIdentifier || 'global'} - computing...`);
        const fresh = await this.computeGenresForCountry(countryIdentifier);
        logger.log(`📦 Cached genres for ${countryIdentifier || 'global'}: ${fresh.total} genres (${Date.now() - startTime}ms)`);
        return fresh;
      },
      { freshTtl: CACHE_TTL, staleTtl: CACHE_TTL * 4 } // 7d fresh, 28d stale
    );

    return data;
  }

  static async warmupCache(): Promise<void> {
    // INCIDENT 2026-05-14 round 6: previously this looped 19 countries
    // and the country aggregate timed out on EVERY one (8s budget vs
    // multi-minute cluster planner pressure), filling the log with
    // [err] lines and adding load with zero benefit (the failed
    // aggregate never wrote a cache entry). Real user traffic for
    // top countries fills the per-country cache on demand within
    // seconds. Keep only the global warmup, which is now cheap
    // because it skips the aggregate entirely.
    logger.log('🔥 Warming up genres cache (global only)...');
    try {
      await this.getGenres('global');
      logger.log('✅ Genres cache warmup complete (global)');
    } catch (error: any) {
      logger.warn('Failed to warmup global genres: ' + (error?.message || 'unknown'));
    }
  }

  static async refreshAll(): Promise<void> {
    logger.log('🔄 Refreshing all genres caches...');
    
    // INCIDENT 2026-05-15 v10.2 — read side is SWR; invalidate via delSWR
    // so the envelope is dropped and the next caller recomputes.
    await CacheManager.delSWR(GLOBAL_CACHE_KEY);
    await this.getGenres('global');
    
    const topCountries = ['DE', 'US', 'TR', 'FR', 'IT', 'ES', 'GB', 'BR', 'RU', 'JP', 'NL', 'AT', 'CH', 'PL', 'AU', 'CA', 'MX', 'IN', 'KR'];
    
    for (const country of topCountries) {
      try {
        // INCIDENT 2026-05-15 v10.2 — read side is SWR; invalidate via delSWR.
        const cacheKey = this.getCacheKey(country);
        await CacheManager.delSWR(cacheKey);
        await this.getGenres(country);
        await sleep(300);
      } catch (error) {
        logger.error(`Failed to refresh genres for ${country}:`, error);
      }
    }
    
    logger.log('✅ Top genres caches refreshed (other countries refresh on-demand)');
  }

  // INCIDENT 2026-05-16 — nightly job that populates `genre_counts` for
  // global + top countries. Runtime read path uses this collection
  // instead of running the unwind+group aggregate per request.
  // Runs ONCE per day with a generous budget (10 min, allowDiskUse) so
  // a single planner stall doesn't take the page down.
  // Fallback list — used only if the dynamic sitemap top-30 query
  // fails. The runtime source of truth is `getTopCountryDbNames()`
  // from `seo/sitemap-manifest-builder.ts`, which returns the same
  // top-N leaderboard the main sitemap bakes into `tc:` markers, so
  // the genre-counts coverage stays in sync with the sitemap coverage
  // when the country leaderboard shifts.
  static readonly GENRE_COUNT_TOP_COUNTRIES_FALLBACK = [
    'Türkiye', 'Germany', 'The United States Of America',
    'The United Kingdom Of Great Britain And Northern Ireland',
    'France', 'Spain', 'Italy', 'The Netherlands', 'Austria', 'Switzerland',
    'Brazil', 'The Russian Federation', 'Japan', 'The Republic Of Korea',
    'India', 'Mexico', 'Canada', 'Australia', 'Poland', 'Greece',
    'Portugal', 'Belgium', 'Sweden', 'Norway', 'Denmark', 'Finland',
    'Czechia', 'Hungary', 'Romania', 'Bulgaria',
  ];

  private static async resolveTopCountries(): Promise<string[]> {
    try {
      const dynamic = await getTopCountryDbNames(30);
      if (Array.isArray(dynamic) && dynamic.length > 0) return dynamic;
    } catch (err: any) {
      logger.warn(`[precomputed-genres] getTopCountryDbNames failed, using fallback: ${err?.message || err}`);
    }
    return this.GENRE_COUNT_TOP_COUNTRIES_FALLBACK;
  }

  private static async computeCountsFor(countryDbName: string | null): Promise<Map<string, number>> {
    const stationFilter: any = countryDbName ? normalizeCountryFilter(countryDbName) : {};
    const aggCounts = await Station.aggregate([
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
    ]).option({ maxTimeMS: 600000, allowDiskUse: true });
    const m = new Map<string, number>();
    for (const r of aggCounts) {
      if (r._id) m.set(r._id, r.count);
    }
    return m;
  }

  private static async writeCountsForCountry(
    countryKey: string,
    counts: Map<string, number>
  ): Promise<void> {
    if (counts.size === 0) return;
    const ops = Array.from(counts.entries()).map(([slug, count]) => ({
      updateOne: {
        filter: { country: countryKey, slug },
        update: { $set: { country: countryKey, slug, count, updatedAt: new Date() } },
        upsert: true,
      },
    }));
    // Drop slugs that are no longer present so a tag that hit zero
    // disappears from the page.
    const slugs = Array.from(counts.keys());
    await GenreCount.deleteMany({ country: countryKey, slug: { $nin: slugs } });
    // Bulk-write in chunks of 500 to keep payload size sane.
    for (let i = 0; i < ops.length; i += 500) {
      const slice = ops.slice(i, i + 500);
      try {
        await GenreCount.bulkWrite(slice, { ordered: false });
      } catch (err: any) {
        logger.warn(`[precomputed-genres] bulkWrite chunk failed for ${countryKey}: ${err?.message || 'unknown'}`);
      }
    }
  }

  static async refreshGenreCounts(): Promise<{ global: number; countries: number; failures: number; durationMs: number }> {
    const start = Date.now();
    let countries = 0;
    let failures = 0;
    let globalCount = 0;

    try {
      const counts = await this.computeCountsFor(null);
      await this.writeCountsForCountry('global', counts);
      globalCount = counts.size;
      logger.log(`[precomputed-genres] genre_counts: global → ${counts.size} slugs`);
    } catch (err: any) {
      failures++;
      logger.error(`[precomputed-genres] genre_counts global failed: ${err?.message || err}`);
    }

    const topCountries = await this.resolveTopCountries();
    for (const dbName of topCountries) {
      try {
        const counts = await this.computeCountsFor(dbName);
        await this.writeCountsForCountry(dbName, counts);
        countries++;
        await sleep(500);
      } catch (err: any) {
        failures++;
        logger.warn(`[precomputed-genres] genre_counts ${dbName} failed: ${err?.message || err}`);
      }
    }

    // Drop the SWR envelopes so subsequent reads pick up the fresh map.
    try { await CacheManager.delSWR(GLOBAL_CACHE_KEY); } catch {}
    for (const dbName of topCountries) {
      try { await CacheManager.delSWR(this.getCacheKey(dbName)); } catch {}
    }

    const durationMs = Date.now() - start;
    logger.log(`✅ [precomputed-genres] genre_counts refresh: global=${globalCount}, countries=${countries}, failures=${failures}, duration=${durationMs}ms`);
    return { global: globalCount, countries, failures, durationMs };
  }
}
