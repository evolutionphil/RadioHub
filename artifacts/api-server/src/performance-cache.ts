import NodeCache from 'node-cache';
import { logger } from './utils/logger';
import { sleep } from './utils/event-loop-yield';
import { trackOperation } from './utils/operation-tracker';
import {
  CountryLanguageMapping,
  UrlTranslation,
  Translation,
  Station as StationModel,
} from '@workspace/db-shared/mongo-schemas';

/**
 * Recursively freeze a value before storing it in a `useClones: false` cache.
 *
 * Why: every cache here is constructed with `useClones: false` so consumers
 * receive the same object reference on every hit. A single rogue mutation
 * (e.g. `seoData.seoTags.domain = ...`) would otherwise corrupt the cached
 * object for all subsequent users — causing cross-tenant SEO data, translation,
 * and station-list bleed-through.
 *
 * Freezing at write time turns those mutations into immediate TypeErrors in
 * strict mode (this codebase runs ESM/strict), surfacing the bug instead of
 * silently poisoning shared state. Built-in collections like `Map`/`Set` are
 * skipped because `Object.freeze` does not actually prevent their mutation.
 */
export function deepFreeze<T>(value: T, seen: WeakSet<object> = new WeakSet()): T {
  if (value === null || value === undefined) return value;
  const t = typeof value;
  if (t !== 'object' && t !== 'function') return value;
  const obj = value as unknown as object;
  if (seen.has(obj)) return value;
  // Skip types whose internal slots aren't protected by Object.freeze, or
  // whose freezing would break expected runtime behavior.
  if (
    obj instanceof Map ||
    obj instanceof Set ||
    obj instanceof WeakMap ||
    obj instanceof WeakSet ||
    obj instanceof Date ||
    obj instanceof RegExp ||
    obj instanceof Promise ||
    Buffer.isBuffer(obj) ||
    ArrayBuffer.isView(obj as any)
  ) {
    return value;
  }
  if (Object.isFrozen(obj)) return value;
  seen.add(obj);
  Object.freeze(obj);
  for (const key of Reflect.ownKeys(obj)) {
    const child = (obj as any)[key];
    if (child && (typeof child === 'object' || typeof child === 'function')) {
      deepFreeze(child, seen);
    }
  }
  return value;
}

// High-performance caching system for SEO optimization
export class PerformanceCache {
  private static instance: PerformanceCache;
  
  // Different caches with optimized TTLs for different data types
  private translationsCache: NodeCache;
  private seoHtmlCache: NodeCache; 
  private pageDataCache: NodeCache;
  private quickCache: NodeCache;

  private lastCacheFullWarnTime: Record<string, number> = {};
  private static CACHE_FULL_WARN_COOLDOWN = 60_000;
  
  private constructor() {
    // INCIDENT 2026-05-15 v5: production RSS sat at ~850MB sustained with
    // heap=200-400MB and native≈400-600MB, triggering MEMORY CRITICAL on a
    // 30-second cadence. Root-cause math:
    //   seoHtmlCache  8000 keys × ~50–150KB HTML  → up to 1.2 GB JS heap
    //   pageDataCache 5000 keys (full SEO+station blobs) → 200–500 MB heap
    //   ogImageCache  500 PNG buffers             → ~40 MB native ext
    // Even though Redis backs the same data, the in-process mirror grew
    // unbounded under crawler traffic. Cap the per-process mirrors well
    // below the M10 process budget; Redis remains the cross-process source
    // of truth and survives a per-process eviction.
    this.translationsCache = new NodeCache({
      stdTTL: 3600,
      checkperiod: 600,
      maxKeys: 100,
      useClones: false
    });

    // MEMORY FIX 2026-05-18: reduced 1500→500. HTML is fast to re-render from
    // pageDataCache (in-memory, no DB round-trip), so a smaller HTML cache
    // keeps ~50MB (500×100KB avg) vs ~150MB at 1500 keys. pageDataCache stays
    // large so the data layer stays hot even when HTML is evicted.
    this.seoHtmlCache = new NodeCache({
      stdTTL: 1800,
      checkperiod: 300,
      maxKeys: 500,
      useClones: false
    });

    // CRITICAL INDEXABILITY-GATE RULE: pageDataCache TTL MUST be >= seoHtmlCache
    // TTL so the cache-HIT junk guard in server/index.ts + server/index-web.ts
    // can always find the `stationIsJunk` flag that accompanies the HTML it is
    // about to serve. Previously pageData TTL was 900s vs HTML 1800s, creating
    // a 15-minute window where a junk station would serve cached 200 HTML
    // because the guard's pageData lookup had expired. Keep these in sync.
    this.pageDataCache = new NodeCache({
      stdTTL: 1800,
      checkperiod: 300,
      maxKeys: 1500,
      useClones: false
    });

    this.quickCache = new NodeCache({
      stdTTL: 300,
      checkperiod: 120,
      maxKeys: 300,
      useClones: false
    });
    
    logger.log('🚀 CACHE: Performance cache system initialized');
  }

  private safeSet(cache: NodeCache, cacheName: string, key: string, value: any, ttl?: number): boolean {
    // CRITICAL: every cache uses `useClones: false` so mutating a cached value
    // poisons it for every other consumer. Freeze on write so any accidental
    // mutation throws instead of silently corrupting shared state.
    const frozen = deepFreeze(value);
    try {
      if (ttl !== undefined) {
        cache.set(key, frozen, ttl);
      } else {
        cache.set(key, frozen);
      }
      return true;
    } catch (err: any) {
      if (err?.errorcode === 'ECACHEFULL') {
        const now = Date.now();
        const lastWarn = this.lastCacheFullWarnTime[cacheName] || 0;
        if (now - lastWarn > PerformanceCache.CACHE_FULL_WARN_COOLDOWN) {
          this.lastCacheFullWarnTime[cacheName] = now;
          const keyCount = cache.keys().length;
          logger.warn(`⚠️ CACHE FULL: ${cacheName} hit maxKeys (${keyCount} keys) — evicting oldest 30% and retrying`);
        }
        const allKeys = cache.keys();
        const evictCount = Math.max(Math.floor(allKeys.length * 0.3), 50);
        const keysToEvict = allKeys.slice(0, evictCount);
        cache.del(keysToEvict);
        try {
          // Use the already-frozen reference so the eviction-retry path can't
          // smuggle mutable values into a `useClones: false` cache.
          if (ttl !== undefined) {
            cache.set(key, frozen, ttl);
          } else {
            cache.set(key, frozen);
          }
          return true;
        } catch {
          return false;
        }
      }
      return false;
    }
  }
  
  public static getInstance(): PerformanceCache {
    if (!PerformanceCache.instance) {
      PerformanceCache.instance = new PerformanceCache();
    }
    return PerformanceCache.instance;
  }
  
  // === TRANSLATION CACHING ===
  
  getTranslations(language: string): Record<string, string> | null {
    const result = this.translationsCache.get(`translations:${language}`) as Record<string, string> | undefined;
    return result || null;
  }
  
  setTranslations(language: string, translations: Record<string, string>): void {
    this.safeSet(this.translationsCache, 'translationsCache', `translations:${language}`, translations);
  }
  
  // === SEO HTML CACHING ===
  
  getSeoHtml(url: string, userAgent: string = 'bot'): string | null {
    const cacheKey = `seo:${userAgent}:${url}`;
    const result = this.seoHtmlCache.get(cacheKey) as string | undefined;
    return result || null;
  }
  
  setSeoHtml(url: string, html: string, userAgent: string = 'bot'): void {
    const cacheKey = `seo:${userAgent}:${url}`;
    this.safeSet(this.seoHtmlCache, 'seoHtmlCache', cacheKey, html);
  }
  
  // === PAGE DATA CACHING ===
  
  getPageData(url: string): any | null {
    const result = this.pageDataCache.get(`page:${url}`);
    return result || null;
  }
  
  setPageData(url: string, data: any): void {
    this.safeSet(this.pageDataCache, 'pageDataCache', `page:${url}`, data);
  }
  
  // === QUICK CACHING ===
  
  getQuick(key: string): any | null {
    const result = this.quickCache.get(key);
    return result || null;
  }
  
  setQuick(key: string, data: any, ttl?: number): void {
    this.safeSet(this.quickCache, 'quickCache', key, data, ttl);
  }
  
  // === SIMILAR STATIONS CACHE (Always Hot) ===
  // Pre-computed pools of popular stations per country for instant Similar Radios
  
  private similarStationsCache: NodeCache = new NodeCache({
    stdTTL: 3600,
    checkperiod: 300,
    maxKeys: 200,
    useClones: false
  });
  
  getSimilarPool(country: string): any[] | null {
    const result = this.similarStationsCache.get(`similar:${country}`) as any[] | undefined;
    return result || null;
  }
  
  setSimilarPool(country: string, stations: any[]): void {
    this.safeSet(this.similarStationsCache, 'similarStationsCache', `similar:${country}`, stations);
  }
  
  getGlobalPopularPool(): any[] | null {
    const result = this.similarStationsCache.get('similar:global') as any[] | undefined;
    return result || null;
  }
  
  setGlobalPopularPool(stations: any[]): void {
    this.safeSet(this.similarStationsCache, 'similarStationsCache', 'similar:global', stations);
  }
  
  isSimilarPoolWarmed(): boolean {
    return this.similarStationsCache.keys().length > 0;
  }
  
  // === CACHE MANAGEMENT ===
  
  clearTranslations(): void {
    this.translationsCache.flushAll();
    logger.log('🗑️ CACHE: Cleared translations cache');
  }
  
  clearSeoHtml(): void {
    this.seoHtmlCache.flushAll();
    logger.log('🗑️ CACHE: Cleared SEO HTML cache');
  }
  
  invalidateStationCache(stationSlug: string): void {
    const seoKeys = this.seoHtmlCache.keys().filter(k => k.includes(`/station/${stationSlug}`) || k.includes(`/${stationSlug}`));
    const pageKeys = this.pageDataCache.keys().filter(k => k.includes(`/station/${stationSlug}`) || k.includes(`/${stationSlug}`));
    seoKeys.forEach(k => this.seoHtmlCache.del(k));
    pageKeys.forEach(k => this.pageDataCache.del(k));
    if (seoKeys.length || pageKeys.length) {
      logger.log(`🗑️ CACHE: Invalidated ${seoKeys.length + pageKeys.length} cache entries for station: ${stationSlug}`);
    }
  }
  
  clearPageData(): void {
    this.pageDataCache.flushAll();
    logger.log('🗑️ CACHE: Cleared page data cache');
  }
  
  clearAll(): void {
    this.translationsCache.flushAll();
    this.seoHtmlCache.flushAll();
    this.pageDataCache.flushAll();
    this.quickCache.flushAll();
    logger.log('🗑️ CACHE: Cleared all caches');
  }
  
  clearSeoCaches(): { seoHtmlCleared: number; pageDataCleared: number } {
    const seoHtmlCount = this.seoHtmlCache.keys().length;
    const pageDataCount = this.pageDataCache.keys().length;
    
    this.seoHtmlCache.flushAll();
    this.pageDataCache.flushAll();
    
    logger.log(`🌙 CACHE: Cleared SEO caches - ${seoHtmlCount} HTML entries, ${pageDataCount} page data entries`);
    
    return {
      seoHtmlCleared: seoHtmlCount,
      pageDataCleared: pageDataCount
    };
  }

  clearSeoAndQuickCaches(): void {
    const seoCount = this.seoHtmlCache.keys().length;
    const pageCount = this.pageDataCache.keys().length;
    const quickCount = this.quickCache.keys().length;

    this.seoHtmlCache.flushAll();
    this.pageDataCache.flushAll();
    this.quickCache.flushAll();

    logger.log(`🧹 PROACTIVE: Cleared SEO + quick caches — seo=${seoCount}, page=${pageCount}, quick=${quickCount}`);
  }

  clearAllForMemoryRelief(): void {
    const seoCount = this.seoHtmlCache.keys().length;
    const pageCount = this.pageDataCache.keys().length;
    const quickCount = this.quickCache.keys().length;
    const similarCount = this.similarStationsCache.keys().length;

    this.seoHtmlCache.flushAll();
    this.pageDataCache.flushAll();
    this.quickCache.flushAll();
    this.similarStationsCache.flushAll();

    logger.log(`🧹 MEMORY RELIEF: Cleared caches (translations preserved) — seo=${seoCount}, page=${pageCount}, quick=${quickCount}, similar=${similarCount}`);
  }
  
  // Wraps a Map so that mutating methods (set/delete/clear) throw.
  // Read methods (get/has/keys/values/entries/forEach/size, iteration) work normally.
  // This prevents accidental shared-cache mutation when useClones=false.
  private static createReadOnlyMap<K, V>(source: Map<K, V>): Map<K, V> {
    const throwReadOnly = (op: string) => {
      throw new TypeError(`Cannot ${op} on read-only cached Map (performance-cache)`);
    };
    const handler: ProxyHandler<Map<K, V>> = {
      get(target, prop, receiver) {
        if (prop === 'set') return () => throwReadOnly('set');
        if (prop === 'delete') return () => throwReadOnly('delete');
        if (prop === 'clear') return () => throwReadOnly('clear');
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    };
    return new Proxy(source, handler);
  }

  clearCountryLanguageMappings() {
    this.quickCache.del('country_language_mappings');
    logger.log('🧹 Cleared country-language mappings cache');
  }

  async getCountryLanguageMappings(): Promise<Map<string, string>> {
    const cached = this.quickCache.get('country_language_mappings');
    if (cached) return cached as Map<string, string>;
    
    
    const mappings = await CountryLanguageMapping.find({ isActive: true }).lean();
    
    const map = new Map<string, string>();
    mappings.forEach((m: any) => map.set(m.countryCode, m.languageCode));
    
    const readOnly = PerformanceCache.createReadOnlyMap(map);
    this.safeSet(this.quickCache, 'quickCache', 'country_language_mappings', readOnly);
    
    return readOnly;
  }

  clearUrlTranslations() {
    this.quickCache.del('url_translations');
    logger.log('🧹 Cleared URL translations cache');
  }

  async getUrlTranslations(): Promise<Map<string, string>> {
    const cached = this.quickCache.get('url_translations');
    if (cached) return cached as Map<string, string>;
    
    
    const translations = await UrlTranslation.find({ isActive: true }).lean();
    
    // Map key: "languageCode:englishPath" -> translatedPath
    const map = new Map<string, string>();
    translations.forEach((t: any) => {
      const key = `${t.languageCode}:${t.englishPath}`;
      map.set(key, t.translatedPath);
    });
    
    const readOnly = PerformanceCache.createReadOnlyMap(map);
    this.safeSet(this.quickCache, 'quickCache', 'url_translations', readOnly);
    
    return readOnly;
  }
  
  // === CACHE STATISTICS ===
  
  getStats() {
    return {
      translations: {
        keys: this.translationsCache.keys().length,
        stats: this.translationsCache.getStats()
      },
      seoHtml: {
        keys: this.seoHtmlCache.keys().length,
        stats: this.seoHtmlCache.getStats()
      },
      pageData: {
        keys: this.pageDataCache.keys().length,
        stats: this.pageDataCache.getStats()
      },
      quick: {
        keys: this.quickCache.keys().length,
        stats: this.quickCache.getStats()
      }
    };
  }
  
  // Warm up critical caches on startup
  // ARCHITECT FIX (2026-05-10): memoized — both index-api.ts/index-web.ts
  // sitemap-init blocks AND the parallel background-tasks block now call
  // this; the in-flight promise is shared so the heavy Translation.find +
  // populate fans out only once per process.
  private warmupPromise: Promise<void> | null = null;
  async warmupCaches(): Promise<void> {
    if (this.warmupPromise) return this.warmupPromise;
    this.warmupPromise = trackOperation('warmup-translations', async () => {
      // Top-10 languages only — keeps boot warmup under 10 MongoDB queries.
      // Remaining 47 languages load lazily on first organic request; the
      // singleflight in CacheManager coalesces concurrent cold misses so a
      // crawler burst doesn't fan out into parallel DB hits.
      // INCIDENT 2026-05-18: extending to all 57 langs caused pool exhaustion
      // — 114 warmup queries (57 × find+populate) competed with 16+ simultaneous
      // user requests for the 40-connection pool. Reverted to top-10.
      logger.log('🔥 CACHE: Starting cache warmup (top 10 languages)...');

      const criticalLanguages = ['en', 'de', 'tr', 'fr', 'es', 'pt', 'it', 'nl', 'ru', 'ar'];

      try {
        let totalKeys = 0;
        let langsWithData = 0;
        for (const language of criticalLanguages) {
          const translations = await Translation.find({ language }).populate('keyId').lean();
          const translationMap: Record<string, string> = {};

          translations.forEach((t: any) => {
            if (t.keyId?.key && t.value) {
              translationMap[t.keyId.key] = t.value;
            }
          });

          this.setTranslations(language, translationMap);
          const k = Object.keys(translationMap).length;
          totalKeys += k;
          if (k > 0) langsWithData += 1;
        }

        logger.log(`🔥 CACHE: Warmed up translations for ${criticalLanguages.length} languages (${langsWithData} non-empty, ${totalKeys} keys total; others loaded on-demand)`);
      } catch (error) {
        // Reset memo so a failed warmup can be retried.
        this.warmupPromise = null;
        console.error('❌ CACHE: Warmup failed:', error);
      }
    });
    return this.warmupPromise;
  }
  
  // Warm up similar stations pools for all countries (called in background after boot)
  async warmupSimilarStations(): Promise<void> {
    return trackOperation('warmup-similar-stations', async () => {
    logger.log('🔥 CACHE: Warming up similar stations pools (top 10 countries + global)...');
    
    try {
      
      
      const selectFields = '_id name slug favicon country countryCode tags votes clickCount bitrate codec logoAssets url url_resolved';
      
      const countryStationCounts = await StationModel.aggregate([
        { $match: { lastCheckOk: true } },
        { $group: { _id: '$country', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]).option({ maxTimeMS: 20000, allowDiskUse: true });
      
      const topCountries = countryStationCounts.map((c: any) => c._id).filter(Boolean);
      
      for (let i = 0; i < topCountries.length; i++) {
        const country = topCountries[i];
        // ARCHITECT FIX (2026-05-10): drop `clickCount` tie-breaker so the
        // compound `{country:1, lastCheckOk:1, votes:-1}` index fully
        // satisfies the sort with no blocking SORT stage. Without this,
        // Atlas shared/serverless tiers (no allowDiskUse) crash boot when
        // any country has enough stations to make the TopK heap+filter
        // path overflow the 33MB sort budget.
        const stations = await StationModel.find({ 
          country, 
          lastCheckOk: true 
        })
        .sort({ votes: -1 })
        .limit(30)
        .select(selectFields)
        .lean();
        
        this.setSimilarPool(country, stations);
        if (i < topCountries.length - 1) await sleep(100);
      }
      
      // Global pool — same pattern, use the {lastCheckOk:1, votes:-1}
      // compound index to skip any in-memory SORT.
      const globalStations = await StationModel.find({ lastCheckOk: true })
        .sort({ votes: -1 })
        .limit(50)
        .select(selectFields)
        .lean();
      
      this.setGlobalPopularPool(globalStations);
      
      logger.log(`🔥 CACHE: Warmed up similar stations for ${topCountries.length} countries + global`);
    } catch (error) {
      console.error('❌ CACHE: Similar stations warmup failed:', error);
    }
    });
  }
}

// Export singleton instance
export const performanceCache = PerformanceCache.getInstance();