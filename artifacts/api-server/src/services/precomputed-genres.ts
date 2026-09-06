import { CacheManager } from '../cache';
import { pgTaxonomyRuntime } from '../data/postgres-taxonomy-runtime-store';
import { pgGenres } from '../data/postgres-taxonomy-store';
import { logger } from '../utils/logger';
import { resolveToDbName } from '../utils/normalize-country';
import { sleep } from '../utils/event-loop-yield';
import { trackOperation } from '../utils/operation-tracker';
import { getTopCountryDbNames } from '../seo/sitemap-manifest-builder';

interface PrecomputedGenre {
  _id: string; name: string; slug: string; total_stations: number; stationCount: number; posterImage?: string;
}
interface PrecomputedGenresData {
  genres: PrecomputedGenre[]; total: number; computedAt: number; countryName: string;
}

const CACHE_TTL = 604800;
const CACHE_KEY_PREFIX = 'precomputed_genres:v5:';
const GLOBAL_CACHE_KEY = `${CACHE_KEY_PREFIX}global`;

export class PrecomputedGenresService {
  private static resolveCountry(input?: string): string | null {
    if (!input || input === 'all' || input === 'global') return null;
    return resolveToDbName(input);
  }
  private static getCacheKey(country: string): string {
    const dbName = this.resolveCountry(country);
    return dbName ? `${CACHE_KEY_PREFIX}${dbName.toLowerCase().replace(/[^a-z0-9]/g, '_')}` : GLOBAL_CACHE_KEY;
  }

  static async computeGenresForCountry(countryIdentifier?: string): Promise<PrecomputedGenresData> {
    const dbName = this.resolveCountry(countryIdentifier);
    return trackOperation('compute-genres', async () => {
      const store = pgTaxonomyRuntime();
      let counts = await store.storedCounts(dbName || 'global');
      // Empty is a legitimate cold start, not a database-error fallback.
      if (!counts.size) counts = await store.liveCounts(dbName);
      const curated = await pgGenres();
      const entries = new Map<string, { id: string; name: string; tag: string; posterImage?: string }>();
      for (const genre of curated) {
        if (typeof genre.slug !== 'string' || !genre.slug) continue;
        const slug = genre.slug.toLowerCase();
        entries.set(slug, { id:String(genre._id),name:genre.name,tag:slug,posterImage:genre.posterImage });
      }
      const threshold = dbName ? 1 : 5;
      for (const [tag,count] of counts) {
        const slug = tag.replace(/\s+/g,'-');
        if (count >= threshold && !entries.has(slug)) entries.set(slug, {
          id:`dynamic-${tag}`,tag,name:tag.split(/[\s-]+/).map(word=>word.charAt(0).toUpperCase()+word.slice(1)).join(' '),
        });
      }
      const genres: PrecomputedGenre[] = [];
      for (const [slug,entry] of entries) {
        const count = counts.get(entry.tag) ?? 0;
        if (count > 0) genres.push({
          _id:entry.id,name:entry.name,slug,total_stations:count,stationCount:count,
          posterImage:entry.posterImage || `/images/genre-bg-grad-${([...slug].reduce((sum,char)=>sum+char.charCodeAt(0),0)%4)+1}.webp`,
        });
      }
      genres.sort((a,b)=>b.total_stations-a.total_stations || a.slug.localeCompare(b.slug));
      return { genres,total:genres.length,computedAt:Date.now(),countryName:dbName||'global' };
    }, countryIdentifier || 'global');
  }

  static async getGenres(countryIdentifier?: string): Promise<PrecomputedGenresData> {
    return CacheManager.getOrSetSWR(this.getCacheKey(countryIdentifier || 'global'),
      ()=>this.computeGenresForCountry(countryIdentifier),{freshTtl:CACHE_TTL,staleTtl:CACHE_TTL*4});
  }
  static async warmupCache(): Promise<void> { await this.getGenres('global'); }

  private static async publishCountry(country: string): Promise<void> {
    const fresh = await this.computeGenresForCountry(country);
    // Publish only after all queries succeed; a refresh failure leaves the existing envelope intact.
    await CacheManager.setSWR(this.getCacheKey(country),fresh,{freshTtl:CACHE_TTL,staleTtl:CACHE_TTL*4});
  }
  static async refreshAll(): Promise<void> {
    const failures: unknown[] = [];
    for (const country of ['global','DE','US','TR','FR','IT','ES','GB','BR','RU','JP','NL','AT','CH','PL','AU','CA','MX','IN','KR']) {
      try { await this.publishCountry(country); await sleep(300); }
      catch(error) { failures.push(error); logger.error(`Failed to refresh genres for ${country}:`,error); }
    }
    if (failures.length) throw new AggregateError(failures,'Some genre caches could not be refreshed; prior snapshots retained');
  }

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
      if (Array.isArray(dynamic) && dynamic.length) return dynamic;
    } catch(error) { logger.warn('[precomputed-genres] country leaderboard unavailable; using configured fallback countries',error); }
    return this.GENRE_COUNT_TOP_COUNTRIES_FALLBACK;
  }
  static async refreshGenreCounts(): Promise<{global:number;countries:number;failures:number;durationMs:number}> {
    const start = Date.now(); let global=0; let countries=0; let failures=0;
    const store = pgTaxonomyRuntime();
    for (const country of ['global',...await this.resolveTopCountries()]) {
      try {
        const counts = await store.liveCounts(country==='global'?null:country);
        await store.replaceCounts(country,counts);
        await this.publishCountry(country);
        if(country==='global') global=counts.size; else countries++;
        await sleep(500);
      } catch(error) { failures++; logger.error(`[precomputed-genres] refresh failed for ${country}; previous cache retained`,error); }
    }
    return {global,countries,failures,durationMs:Date.now()-start};
  }
}
