import NodeCache from 'node-cache';
import { logger } from './utils/logger';

// High-performance caching system for SEO optimization
export class PerformanceCache {
  private static instance: PerformanceCache;
  
  // Different caches with optimized TTLs for different data types
  private translationsCache: NodeCache;
  private seoHtmlCache: NodeCache; 
  private pageDataCache: NodeCache;
  private quickCache: NodeCache;
  
  private constructor() {
    // Translations cache - 1 hour TTL (rarely change)
    this.translationsCache = new NodeCache({ 
      stdTTL: 3600, // 1 hour
      checkperiod: 600, // Check every 10 minutes
      maxKeys: 100 // Max 100 language translation sets
    });
    
    // Rendered HTML cache - 20 minutes TTL (for SEO bot responses)
    this.seoHtmlCache = new NodeCache({ 
      stdTTL: 900, // 15 minutes
      checkperiod: 120,
      maxKeys: 500,
      useClones: false
    });
    
    this.pageDataCache = new NodeCache({ 
      stdTTL: 600, // 10 minutes
      checkperiod: 60,
      maxKeys: 500,
      useClones: false
    });
    
    // Quick data cache - 5 minutes TTL (for frequently accessed data)
    this.quickCache = new NodeCache({ 
      stdTTL: 300, // 5 minutes
      checkperiod: 60, // Check every minute
      maxKeys: 500, // Max 500 quick entries
      useClones: false // Save memory
    });
    
    logger.log('🚀 CACHE: Performance cache system initialized');
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
    this.translationsCache.set(`translations:${language}`, translations);
  }
  
  // === SEO HTML CACHING ===
  
  getSeoHtml(url: string, userAgent: string = 'bot'): string | null {
    const cacheKey = `seo:${userAgent}:${url}`;
    const result = this.seoHtmlCache.get(cacheKey) as string | undefined;
    return result || null;
  }
  
  setSeoHtml(url: string, html: string, userAgent: string = 'bot'): void {
    const cacheKey = `seo:${userAgent}:${url}`;
    this.seoHtmlCache.set(cacheKey, html);
  }
  
  // === PAGE DATA CACHING ===
  
  getPageData(url: string): any | null {
    const result = this.pageDataCache.get(`page:${url}`);
    return result || null;
  }
  
  setPageData(url: string, data: any): void {
    this.pageDataCache.set(`page:${url}`, data);
  }
  
  // === QUICK CACHING ===
  
  getQuick(key: string): any | null {
    const result = this.quickCache.get(key);
    return result || null;
  }
  
  setQuick(key: string, data: any, ttl?: number): void {
    if (ttl) {
      this.quickCache.set(key, data, ttl);
    } else {
      this.quickCache.set(key, data);
    }
  }
  
  // === SIMILAR STATIONS CACHE (Always Hot) ===
  // Pre-computed pools of popular stations per country for instant Similar Radios
  
  private similarStationsCache: NodeCache = new NodeCache({
    stdTTL: 3600, // 1 hour TTL
    checkperiod: 300,
    maxKeys: 200 // Max 200 countries
  });
  
  getSimilarPool(country: string): any[] | null {
    const result = this.similarStationsCache.get(`similar:${country}`) as any[] | undefined;
    return result || null;
  }
  
  setSimilarPool(country: string, stations: any[]): void {
    this.similarStationsCache.set(`similar:${country}`, stations);
  }
  
  getGlobalPopularPool(): any[] | null {
    const result = this.similarStationsCache.get('similar:global') as any[] | undefined;
    return result || null;
  }
  
  setGlobalPopularPool(stations: any[]): void {
    this.similarStationsCache.set('similar:global', stations);
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

  clearAllForMemoryRelief(): void {
    const seoCount = this.seoHtmlCache.keys().length;
    const pageCount = this.pageDataCache.keys().length;
    const quickCount = this.quickCache.keys().length;
    const similarCount = this.similarStationsCache.keys().length;
    const transCount = this.translationsCache.keys().length;

    this.seoHtmlCache.flushAll();
    this.pageDataCache.flushAll();
    this.quickCache.flushAll();
    this.similarStationsCache.flushAll();
    this.translationsCache.flushAll();

    logger.log(`🧹 MEMORY RELIEF: Cleared ALL performance caches — seo=${seoCount}, page=${pageCount}, quick=${quickCount}, similar=${similarCount}, trans=${transCount}`);
  }
  
  clearCountryLanguageMappings() {
    this.quickCache.del('country_language_mappings');
    logger.log('🧹 Cleared country-language mappings cache');
  }

  async getCountryLanguageMappings(): Promise<Map<string, string>> {
    const cached = this.quickCache.get('country_language_mappings');
    if (cached) return cached as Map<string, string>;
    
    const { CountryLanguageMapping } = await import('../shared/mongo-schemas');
    const mappings = await CountryLanguageMapping.find({ isActive: true }).lean();
    
    const map = new Map<string, string>();
    mappings.forEach((m: any) => map.set(m.countryCode, m.languageCode));
    
    this.quickCache.set('country_language_mappings', map);
    
    return map;
  }

  clearUrlTranslations() {
    this.quickCache.del('url_translations');
    logger.log('🧹 Cleared URL translations cache');
  }

  async getUrlTranslations(): Promise<Map<string, string>> {
    const cached = this.quickCache.get('url_translations');
    if (cached) return cached as Map<string, string>;
    
    const { UrlTranslation } = await import('../shared/mongo-schemas');
    const translations = await UrlTranslation.find({ isActive: true }).lean();
    
    // Map key: "languageCode:englishPath" -> translatedPath
    const map = new Map<string, string>();
    translations.forEach((t: any) => {
      const key = `${t.languageCode}:${t.englishPath}`;
      map.set(key, t.translatedPath);
    });
    
    this.quickCache.set('url_translations', map);
    
    return map;
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
  async warmupCaches(): Promise<void> {
    logger.log('🔥 CACHE: Starting cache warmup...');
    
    // Dynamically load all enabled languages from SEO_LANGUAGES config
    const { SEO_LANGUAGES } = await import('../shared/seo-config');
    const criticalLanguages = SEO_LANGUAGES
      .filter(lang => lang.enabled)
      .map(lang => lang.code);
    
    try {
      const { Translation } = await import('../shared/mongo-schemas');
      
      for (const language of criticalLanguages) {
        const translations = await Translation.find({ language }).populate('keyId').lean();
        const translationMap: Record<string, string> = {};
        
        translations.forEach((t: any) => {
          if (t.keyId?.key && t.value) {
            translationMap[t.keyId.key] = t.value;
          }
        });
        
        this.setTranslations(language, translationMap);
      }
      
      logger.log(`🔥 CACHE: Warmed up translations for ${criticalLanguages.length} languages`);
    } catch (error) {
      console.error('❌ CACHE: Warmup failed:', error);
    }
  }
  
  // Warm up similar stations pools for all countries (called in background after boot)
  async warmupSimilarStations(): Promise<void> {
    logger.log('🔥 CACHE: Warming up similar stations pools (top 10 countries + global)...');
    
    try {
      const { Station } = await import('../shared/mongo-schemas');
      
      const selectFields = '_id name slug favicon country countryCode tags votes clickCount bitrate codec logoAssets url url_resolved';
      
      const countryStationCounts = await Station.aggregate([
        { $match: { lastCheckOk: true } },
        { $group: { _id: '$country', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]);
      
      const topCountries = countryStationCounts.map((c: any) => c._id).filter(Boolean);
      
      for (const country of topCountries) {
        const stations = await Station.find({ 
          country, 
          lastCheckOk: true 
        })
        .sort({ votes: -1, clickCount: -1 })
        .limit(30)
        .select(selectFields)
        .lean();
        
        this.setSimilarPool(country, stations);
      }
      
      const globalStations = await Station.find({ lastCheckOk: true })
        .sort({ votes: -1, clickCount: -1 })
        .limit(50)
        .select(selectFields)
        .lean();
      
      this.setGlobalPopularPool(globalStations);
      
      logger.log(`🔥 CACHE: Warmed up similar stations for ${topCountries.length} countries + global`);
    } catch (error) {
      console.error('❌ CACHE: Similar stations warmup failed:', error);
    }
  }
}

// Export singleton instance
export const performanceCache = PerformanceCache.getInstance();