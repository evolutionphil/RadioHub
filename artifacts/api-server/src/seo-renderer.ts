import { generateSeoTags, getLanguageFromPath, DEFAULT_LANGUAGE, generateLanguageUrls, COUNTRY_TO_LANGUAGE, SEO_LANGUAGES, generateLocalizedStationTitle, truncateAtWordBoundary } from '@workspace/seo-shared/seo-config';
import { Translation, Station, SeoMetadata, ISeoMetadata } from '@workspace/db-shared/mongo-schemas';

// Lean document shapes returned by Mongoose `.lean()` for the queries in this
// module. Mongoose 8's typings hand `.lean()` results back as `unknown` once
// they are wrapped in a generic helper like `withSignal<T>` (T is inferred as
// `unknown` from the `query: any` parameter), which spammed TS18046 errors
// across the file. Defining the small subset of fields we actually read keeps
// type-checking honest without re-typing the entire schema.
interface LeanTranslationDoc {
  language: string;
  value: string;
  keyId?: { key?: string } | null;
}

interface LeanStationCard {
  _id: unknown;
  name?: string;
  slug?: string;
  favicon?: string;
  logoAssets?: unknown;
  country?: string;
  countryCode?: string;
  tags?: string;
  votes?: number;
  descriptions?: Record<string, unknown>;
  url?: string;
  homepage?: string;
  bitrate?: number;
  lastCheckOk?: boolean;
  lastCheckOkTime?: Date;
  lastCheckTime?: Date;
  noIndex?: boolean;
}

type LeanSeoMetadataDoc = Omit<ISeoMetadata, keyof import('mongoose').Document>;
import { performanceCache } from './performance-cache';
import { logger } from './utils/logger';
import { URL_TRANSLATIONS } from '@workspace/seo-shared/url-translations';
import { trackOperation } from './utils/operation-tracker';
import { isJunkStation } from './seo/junk-station-rules';
import { buildGenreSeo } from '@workspace/seo-shared/genre-seo-templates';
import { buildCountrySeo, buildRegionSeo } from '@workspace/seo-shared/region-seo-templates';
import { buildSearchSeo } from '@workspace/seo-shared/search-seo-templates';
import { buildLegalSeo } from '@workspace/seo-shared/legal-seo-templates';
import { buildStaticPageSeo } from '@workspace/seo-shared/static-page-seo-templates';
import { buildCommunityPageSeo } from '@workspace/seo-shared/community-page-seo-templates';
import { getLocalizedCountryName } from '@workspace/seo-shared/country-name-translations';
import {
  getCanonicalGenreSlug,
  MIN_STATIONS_FOR_GENRE_INDEX,
} from './seo/genre-whitelist';
import { FAQ_PAGE_ITEMS } from '@workspace/seo-shared/faq-schema';

// SEO audit fix (2026-05-12) — per-language fallback labels used by the
// regions/country page <title>+<h1> when the corresponding DB translation
// keys (`seo_radio_stations`, `seo_listen_live_online`) are missing. Without
// these, non-English pages fell back to English and produced half-translated
// titles like "Turkey Radio Stations — Canlı Dinle | Mega Radio" (the audit's
// "Multilingual URL Structure and Language Mismatch" finding). Keys cover the
// SEO_LANGUAGES set; anything outside falls back to English.
const LOCALIZED_RADIO_STATIONS: Record<string, string> = {
  en: 'Radio Stations', tr: 'Radyo İstasyonları', es: 'Estaciones de Radio',
  fr: 'Stations de Radio', de: 'Radiosender', it: 'Stazioni Radio',
  pt: 'Estações de Rádio', nl: 'Radiostations', ru: 'Радиостанции',
  ar: 'محطات الراديو', ja: 'ラジオ局', ko: '라디오 방송국',
  zh: '广播电台', hi: 'रेडियो स्टेशन', pl: 'Stacje Radiowe',
  sv: 'Radiostationer', da: 'Radiostationer', fi: 'Radioasemat',
  no: 'Radiostasjoner', cs: 'Rozhlasové Stanice', el: 'Ραδιοφωνικοί Σταθμοί',
  he: 'תחנות רדיו', hu: 'Rádióállomások', id: 'Stasiun Radio',
  ms: 'Stesen Radio', ro: 'Posturi de Radio', sk: 'Rozhlasové Stanice',
  th: 'สถานีวิทยุ', uk: 'Радіостанції', vi: 'Đài Phát Thanh',
  bg: 'Радиостанции', hr: 'Radio Postaje', sr: 'Радио станице',
  sl: 'Radijske Postaje', et: 'Raadiojaamad', lv: 'Radio Stacijas',
  lt: 'Radijo Stotys', fa: 'ایستگاه‌های رادیویی', ur: 'ریڈیو سٹیشنز',
  bn: 'রেডিও স্টেশন', ta: 'வானொலி நிலையங்கள்', tl: 'Mga Istasyon ng Radyo',
  te: 'రేడియో స్టేషన్లు', mr: 'रेडिओ स्टेशन्स', gu: 'રેડિયો સ્ટેશનો',
  kn: 'ರೇಡಿಯೋ ಕೇಂದ್ರಗಳು', ml: 'റേഡിയോ സ്റ്റേഷനുകൾ', pa: 'ਰੇਡੀਓ ਸਟੇਸ਼ਨ',
  sw: 'Vituo vya Redio', am: 'የራዲዮ ጣቢያዎች', zu: 'Iziteshi Zomsakazo',
  af: 'Radiostasies', sq: 'Stacione Radio', az: 'Radio Stansiyaları',
  hy: 'Ռադիոկայաններ', so: 'Idaacadaha Raadiyaha', bs: 'Radio Stanice',
};
const LOCALIZED_LISTEN_LIVE: Record<string, string> = {
  en: 'Listen Live Online', tr: 'Canlı Dinle', es: 'Escuchar en Vivo Online',
  fr: 'Écouter en Direct', de: 'Live Online Hören', it: 'Ascolta in Diretta Online',
  pt: 'Ouça ao Vivo Online', nl: 'Live Online Luisteren', ru: 'Слушать в Прямом Эфире',
  ar: 'استمع مباشرة عبر الإنترنت', ja: 'オンラインでライブ視聴', ko: '온라인 실시간 청취',
  zh: '在线直播收听', hi: 'लाइव ऑनलाइन सुनें', pl: 'Słuchaj na Żywo Online',
  sv: 'Lyssna Live Online', da: 'Lyt Live Online', fi: 'Kuuntele Suorana Verkossa',
  no: 'Lytt Live på Nett', cs: 'Poslouchejte Živě Online', el: 'Ακούστε Ζωντανά Online',
  he: 'האזינו בשידור חי באינטרנט', hu: 'Hallgasd Élőben Online', id: 'Dengarkan Langsung Online',
  ms: 'Dengar Langsung Dalam Talian', ro: 'Ascultă Live Online', sk: 'Počúvajte Naživo Online',
  th: 'ฟังสดออนไลน์', uk: 'Слухати в Прямому Ефірі', vi: 'Nghe Trực Tiếp Online',
  bg: 'Слушайте на Живо Онлайн', hr: 'Slušajte Uživo Online', sr: 'Слушајте Уживо Онлајн',
  sl: 'Poslušajte v Živo Online', et: 'Kuula Otse Internetis', lv: 'Klausieties Tiešraidē Online',
  lt: 'Klausykitės Tiesiogiai Internetu', fa: 'پخش زنده آنلاین', ur: 'لائیو آن لائن سنیں',
  bn: 'লাইভ অনলাইন শুনুন', ta: 'நேரலையில் இணையத்தில் கேளுங்கள்', tl: 'Makinig nang Live Online',
  te: 'ప్రత్యక్షంగా ఆన్‌లైన్‌లో వినండి', mr: 'थेट ऑनलाइन ऐका', gu: 'લાઇવ ઑનલાઇન સાંભળો',
  kn: 'ಲೈವ್ ಆನ್‌ಲೈನ್ ಆಲಿಸಿ', ml: 'തത്സമയം ഓൺലൈനിൽ കേൾക്കൂ', pa: 'ਲਾਈਵ ਔਨਲਾਈਨ ਸੁਣੋ',
  sw: 'Sikiliza Moja kwa Moja Mtandaoni', am: 'በቀጥታ በመስመር ላይ ያዳምጡ', zu: 'Lalela Bukhoma Online',
  af: 'Luister Regstreeks Aanlyn', sq: 'Dëgjo Live Online', az: 'Canlı Onlayn Dinləyin',
  hy: 'Ունկնդրեք ուղիղ առցանց', so: 'Ku dhageyso Toos ah Online', bs: 'Slušajte Uživo Online',
};

// Concurrency raised 5 → 15 → 50 → 200 → 1000 → 2500: paired with MongoDB
// pool 100, heap 10 GB and RSS warning 7 GB on a 24 GB Railway replica to
// absorb the largest Googlebot waves without ever returning
// SEO_RENDER_OVERLOADED. The event-loop-lag guard below (800ms threshold)
// is the real safety net — if the box is truly overloaded it rejects
// automatically regardless of slot count, so a high slot ceiling is safe.
// Timeout raised 5s → 10s: 57-language hreflang tables push borderline pages
// over 5s during cold cache; a 10s budget keeps Googlebot from giving up.
const SEO_RENDER_MAX_CONCURRENT = 2500;
const SEO_RENDER_TIMEOUT_MS = 10_000;
let seoRenderActive = 0;
let seoRenderRejected = 0;
let eventLoopLagMs = 0;
// Raised 500 → 800ms: under brisk crawl traffic the event loop briefly spikes
// above 500ms during JSON serialization of large hreflang/structured data
// blocks. Rejecting at 500ms made Googlebot see frequent overload errors and
// throttle its crawl rate. 800ms still protects against true overload while
// allowing normal SSR work to complete.
const EVENT_LOOP_LAG_THRESHOLD_MS = 800;

setInterval(() => {
  const start = Date.now();
  setImmediate(() => {
    eventLoopLagMs = Date.now() - start;
  });
}, 2000);

export function getSeoRenderStats() {
  return { active: seoRenderActive, rejected: seoRenderRejected, eventLoopLag: eventLoopLagMs };
}

const DB_QUERY_TIMEOUT_MS = SEO_RENDER_TIMEOUT_MS - 500;

function withSignal<T>(query: any, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  if (!signal) return query;
  
  query.setOptions({ maxTimeMS: DB_QUERY_TIMEOUT_MS });
  
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (!settled) {
        settled = true;
        reject(new DOMException('Aborted', 'AbortError'));
      }
    };
    signal.addEventListener('abort', onAbort, { once: true });
    (query as Promise<T>).then(
      (val) => { if (!settled) { settled = true; signal.removeEventListener('abort', onAbort); resolve(val); } },
      (err) => { if (!settled) { settled = true; signal.removeEventListener('abort', onAbort); reject(err); } }
    );
  });
}

export interface StaticPageData {
  language: string;
  cleanPath: string;
  seoTags: any;
  translations: Record<string, string>;
  pageData?: any;
  urlTranslations?: Map<string, string>;
}

// Task #127: pure URL helpers live in `seo/url-helpers.ts` so the soft-404
// regression test suite can import them without booting the renderer
// (which registers setInterval handles for event-loop monitoring). Re-exported
// here to preserve the existing `buildLocalizedUrl` import path used across
// the codebase.
export {
  buildLocalizedUrl,
  VALID_CONTINENT_SLUGS,
  validateRegionRouteShape,
  isExactCountryPagePath,
} from './seo/url-helpers';
import {
  buildLocalizedUrl,
  validateRegionRouteShape,
  isExactCountryPagePath,
} from './seo/url-helpers';

export class SeoRenderer {
  
  async getTranslationsForLanguage(language: string, signal?: AbortSignal): Promise<Record<string, string>> {
    const cached = performanceCache.getTranslations(language);
    if (cached) {
      return cached;
    }
    
    try {
      const translations = await withSignal<LeanTranslationDoc[]>(
        Translation.find({ language }).populate('keyId').lean(),
        signal,
      );
      const translationMap: Record<string, string> = {};

      translations.forEach((t) => {
        if (t.keyId?.key && t.value) {
          translationMap[t.keyId.key] = t.value;
        }
      });
      
      // Cache for future requests
      performanceCache.setTranslations(language, translationMap);
      
      return translationMap;
    } catch (error: any) {
      if (error?.name === 'AbortError' || signal?.aborted) throw error;
      console.error(`❌ Failed to fetch translations for ${language}:`, error);
      return {};
    }
  }
  
  /**
   * Fetch custom SEO metadata from database for a specific page
   * Returns null if no published metadata exists
   */
  async getCustomSeoMetadata(pageType: string, routeKey: string, language: string, signal?: AbortSignal): Promise<any | null> {
    try {
      const metadata = await withSignal<LeanSeoMetadataDoc | null>(
        SeoMetadata.findOne({
          pageType: pageType as ISeoMetadata['pageType'],
          routeKey: routeKey || '',
          language,
          status: 'published',
        }).lean(),
        signal,
      );
      
      return metadata;
    } catch (error: any) {
      if (error?.name === 'AbortError' || signal?.aborted) throw error;
      logger.error(`❌ Failed to fetch custom SEO metadata:`, error);
      return null;
    }
  }
  
  /**
   * Apply custom SEO metadata to base SEO tags if available
   */
  applyCustomSeoMetadata(baseSeoTags: any, customMetadata: any): any {
    if (!customMetadata) return baseSeoTags;
    
    // Override with custom values if present
    if (customMetadata.title) baseSeoTags.title = customMetadata.title;
    if (customMetadata.description) baseSeoTags.description = customMetadata.description;
    if (customMetadata.ogTitle) baseSeoTags.ogTitle = customMetadata.ogTitle;
    if (customMetadata.ogDescription) baseSeoTags.ogDescription = customMetadata.ogDescription;
    if (customMetadata.ogImageUrl) baseSeoTags.ogImage = customMetadata.ogImageUrl;
    if (customMetadata.twitterTitle) baseSeoTags.twitterTitle = customMetadata.twitterTitle;
    if (customMetadata.twitterDescription) baseSeoTags.twitterDescription = customMetadata.twitterDescription;
    if (customMetadata.twitterImageUrl) baseSeoTags.twitterImage = customMetadata.twitterImageUrl;
    if (customMetadata.canonicalUrl) {
      // S11 FIX (2026-05-08): admin-supplied canonical can be relative
      // ("/en/about"), absolute on a different host, or missing scheme.
      // Normalize to an absolute URL on the request's domain so we never
      // emit a self-pointing/relative <link rel=canonical> (Google ignores
      // relative canonicals in the head and treats it as missing).
      const raw = String(customMetadata.canonicalUrl).trim();
      if (raw) {
        try {
          const base = baseSeoTags.canonical && /^https?:\/\//i.test(baseSeoTags.canonical)
            ? baseSeoTags.canonical
            : 'https://themegaradio.com/';
          const u = new URL(raw, base);
          baseSeoTags.canonical = u.toString();
        } catch {
          baseSeoTags.canonical = raw;
        }
      }
    }
    if (customMetadata.metaKeywords) baseSeoTags.keywords = customMetadata.metaKeywords;
    if (customMetadata.noIndex) baseSeoTags.noIndex = customMetadata.noIndex;
    if (customMetadata.noFollow) baseSeoTags.noFollow = customMetadata.noFollow;
    
    return baseSeoTags;
  }
  
  async renderStaticPage(url: string, domain: string = '', preferredLanguage?: string): Promise<StaticPageData> {
    if (seoRenderActive >= SEO_RENDER_MAX_CONCURRENT || eventLoopLagMs > EVENT_LOOP_LAG_THRESHOLD_MS) {
      seoRenderRejected++;
      logger.log(`⚠️ SEO render rejected (active=${seoRenderActive}, lag=${eventLoopLagMs}ms, rejected=${seoRenderRejected}): ${url}`);
      throw new Error('SEO_RENDER_OVERLOADED');
    }

    seoRenderActive++;

    const abortController = new AbortController();
    let timerId: ReturnType<typeof setTimeout> | undefined;

    try {
      const result = await Promise.race([
        this._doRenderStaticPage(url, domain, preferredLanguage, abortController.signal),
        new Promise<never>((_, reject) => {
          timerId = setTimeout(() => {
            abortController.abort();
            reject(new Error('SEO_RENDER_TIMEOUT'));
          }, SEO_RENDER_TIMEOUT_MS);
        })
      ]);
      clearTimeout(timerId);
      return result;
    } catch (err: any) {
      clearTimeout(timerId);
      if (!abortController.signal.aborted) abortController.abort();
      if (err?.message === 'SEO_RENDER_TIMEOUT' || err?.name === 'AbortError') {
        throw new Error('SEO_RENDER_TIMEOUT');
      }
      throw err;
    } finally {
      seoRenderActive--;
    }
  }

  private async _doRenderStaticPage(url: string, domain: string = '', preferredLanguage?: string, signal?: AbortSignal): Promise<StaticPageData> {
    return trackOperation('seo-render', async () => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const cleanUrl = url.split('?')[0].split('#')[0];

    // Get language from URL path, but prefer user's stored preference if available
    let { language, cleanPath } = getLanguageFromPath(cleanUrl);
    
    // CRITICAL: Language/Country separation
    // If user has a stored language preference (from cookie), use that instead of country-derived language
    // This ensures a Turkish user viewing /de/ sees Turkish UI, not German
    if (preferredLanguage && preferredLanguage.toLowerCase() !== language.toLowerCase()) {
      // Validate the preferred language is enabled (case-insensitive comparison for hyphenated codes like pt-BR)
      const normalizedPref = preferredLanguage.toLowerCase();
      const matchedLang = SEO_LANGUAGES.find(l => l.code.toLowerCase() === normalizedPref && l.enabled);
      if (matchedLang) {
        logger.log(`🌍 SSR: Using stored language preference '${matchedLang.code}' instead of URL-derived '${language}'`);
        language = matchedLang.code; // Use the canonical casing from SEO_LANGUAGES
      }
    }
    
    // CRITICAL: Cache key uses cleanUrl (query/hash stripped) + preferredLanguage to avoid collision
    // Without this, /de/ cached in German would be served to Turkish users
    // Using cleanUrl prevents unbounded cache key cardinality from query params
    const normalizedLang = preferredLanguage?.toLowerCase();
    const cacheKey = normalizedLang ? `${cleanUrl}|lang=${normalizedLang}` : cleanUrl;
    
    // Check cache for complete page data first
    const cachedPageData = performanceCache.getPageData(cacheKey);
    if (cachedPageData) {
      return cachedPageData;
    }
    
    const translations = await this.getTranslationsForLanguage(language, signal);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    
    const urlTranslations = await performanceCache.getUrlTranslations();
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    
    // Detect if this is a country-specific URL (e.g., /al/zhanret)
    const urlParts = url.split('/').filter(Boolean);
    let countryCode: string | undefined;
    // CRITICAL: Keep the language we already determined (possibly from cookie preference)
    // Only extract country code for URL building, NOT for language determination
    let actualLanguage = language;
    
    if (urlParts.length > 0) {
      const firstSegment = urlParts[0].toLowerCase();
      // Check if first segment is a country code
      if (COUNTRY_TO_LANGUAGE[firstSegment]) {
        countryCode = firstSegment;
        // DO NOT override actualLanguage here - language was already determined above
        // (either from path translation or preferredLanguage cookie)
        // This ensures a Turkish user on /de/ sees Turkish UI
      }
    }
    
    // Build localized URL path for canonical URL
    // This translates English paths like /genres to language-specific paths like /zhanret (Albanian)
    const localizedPath = buildLocalizedUrl(cleanPath, actualLanguage, countryCode, urlTranslations);
    
    // Determine page type from path and extract relevant data
    let pageType = 'home';
    let stationData: any = null;
    let additionalData: any = {};
    
    // Helper function to detect if path is a station path in ANY language
    const isStationPath = (path: string): { isStation: boolean; stationSlug?: string } => {
      // Check English paths (both singular and plural - some languages reverse-translate to 'stations')
      if (path.startsWith('/station/')) {
        return { isStation: true, stationSlug: path.split('/station/')[1] };
      }
      if (path.startsWith('/stations/')) {
        return { isStation: true, stationSlug: path.split('/stations/')[1] };
      }
      
      // Check all language translations for 'station' and 'stations' paths
      for (const [langCode, translations] of Object.entries(URL_TRANSLATIONS)) {
        const stationTranslation = translations.station;
        if (stationTranslation && path.startsWith(`/${stationTranslation}/`)) {
          return { isStation: true, stationSlug: path.split(`/${stationTranslation}/`)[1] };
        }
        
        // Also check 'stations' (plural) in case reverse translation gives plural form
        const stationsTranslation = translations.stations;
        if (stationsTranslation && stationsTranslation !== stationTranslation && path.startsWith(`/${stationsTranslation}/`)) {
          return { isStation: true, stationSlug: path.split(`/${stationsTranslation}/`)[1] };
        }
      }
      
      return { isStation: false };
    };
    
    // Enhanced page type detection with more specific routing
    const stationCheck = isStationPath(cleanPath);
    let stationNotFound = false;
    if (stationCheck.isStation) {
      pageType = 'station';
      // Extract station slug from path
      const stationSlug = stationCheck.stationSlug;
      if (stationSlug) {
        try {
          stationData = await withSignal(Station.findOne({ slug: stationSlug }).lean(), signal);

          // Fall back to slug aliases (old slugs from before transliteration fix).
          // When matched, signal a 301 redirect to the canonical URL so search
          // engines consolidate ranking on the new slug instead of indexing both.
          if (!stationData) {
            const aliasMatch: any = await withSignal(
              Station.findOne({ slugAliases: stationSlug }).lean(),
              signal,
            );
            if (aliasMatch && aliasMatch.slug && aliasMatch.slug !== stationSlug) {
              // JUNK GATE (Architect P1, Apr 2026): If the canonical target is
              // itself a junk station (noIndex:true or matches isJunkStation
              // heuristics), DO NOT 301 to it — that would tell Google "this
              // old URL = good new URL" and consolidate ranking onto a page we
              // explicitly want gone. Instead, signal stationIsJunk:true so
              // the HTTP layer in index.ts/index-web.ts serves 410 Gone for
              // the original alias URL too. Same gate the main station branch
              // uses (line ~503) to keep alias and canonical paths consistent.
              const { isJunkStation } = await import('./seo/junk-station-rules');
              const aliasTargetIsJunk =
                isJunkStation(aliasMatch) || aliasMatch.noIndex === true;
              if (aliasTargetIsJunk) {
                // CRITICAL: Do NOT set notFound:true — the HTTP-layer junk
                // handler in both index.ts:1068 and index-web.ts:719 gates on
                // `!stationNotFound && !!stationIsJunk`. Setting notFound here
                // would skip the 410 path and fall through to a generic 404,
                // which is a weaker signal to Google than 410 Gone.
                logger.log(`🚫 SEO ALIAS 410: ${cleanPath} (${stationSlug}) → ${aliasMatch.slug} is junk, serving 410 Gone`);
                return {
                  language,
                  cleanPath,
                  seoTags: { robots: 'noindex, follow', noIndex: true } as any,
                  translations: {},
                  pageData: {
                    stationIsJunk: true,
                    pageType: 'station',
                  } as any,
                };
              }

              // BUG FIX (Apr 2026): cleanPath comes from getLanguageFromPath() which
              // STRIPS the language prefix and REVERSE-TRANSLATES the path back to
              // English (e.g. "/ar/mahta/old-slug" -> cleanPath "/station/old-slug").
              // Previously we did `cleanPath.replace(stationSlug, newSlug)` which
              // produced "/station/new-slug" (no language prefix, no localized
              // segment) and triggered a 3-hop redirect chain back to /en/...,
              // causing massive "Crawled - currently not indexed" duplication in
              // Google Search Console. Now we rebuild the FULL localized canonical
              // (lang prefix + translated segment) so it's a single 301 hop to the
              // correct localized URL — preserving language signal and SEO equity.
              const englishCanonical = cleanPath.replace(
                `/${stationSlug}`,
                `/${aliasMatch.slug}`,
              );
              const canonicalPath = buildLocalizedUrl(
                englishCanonical,
                actualLanguage,
                countryCode,
                urlTranslations,
              );
              logger.log(`🔀 SEO ALIAS 301: ${cleanPath} (${stationSlug}) → ${canonicalPath} (${aliasMatch.slug})`);
              return {
                language,
                cleanPath,
                seoTags: {},
                translations: {},
                pageData: { redirectTo: canonicalPath },
              };
            }
            stationData = aliasMatch;
          }

          if (!stationData && stationSlug.match(/^[0-9a-fA-F]{24}$/)) {
            stationData = await withSignal(Station.findById(stationSlug).lean(), signal);
          }

          // If station truly doesn't exist, mark notFound and synthesize minimal data so SSR
          // can still render a 404 body (avoids 500). Caller (index-web.ts) maps this to HTTP 404,
          // preventing Google soft-404 spam signals.
          if (!stationData) {
            stationNotFound = true;
            const stationName = stationSlug
              .replace(/-/g, ' ')
              .replace(/\b\w/g, (l: string) => l.toUpperCase());
            stationData = {
              _id: null,
              name: stationName,
              slug: stationSlug,
              country: '',
              tags: '',
              url: '',
              favicon: '',
              description: '',
              notFound: true,
            };
          }
        } catch (error: any) {
          if (error?.name === 'AbortError' || signal?.aborted) throw error;
          // DB error — don't mark notFound (transient); still render placeholder
          const stationName = stationSlug
            .replace(/-/g, ' ')
            .replace(/\b\w/g, (l: string) => l.toUpperCase());
          stationData = {
            _id: null,
            name: stationName,
            slug: stationSlug,
            country: '',
            tags: '',
            url: '',
            favicon: '',
            description: ''
          };
        }
      }
    } else if (cleanPath.startsWith('/genres')) {
      pageType = 'genres';
      // Extract genre slug if present for more specific SEO
      const pathParts = cleanPath.split('/');
      if (pathParts.length > 2) {
        // Task #102: Genre detail URLs with non-conforming slugs (containing
        // `"`, `%22`, spaces, or other unsafe chars) are leftover artifacts of
        // a sitemap bug that emitted unescaped tag-derived slugs. They render
        // empty thin pages and are the largest source of soft-404s. Reject
        // them at the SSR layer with notFound:true so index-web returns 404,
        // dropping them out of Google's index.
        // Guard against malformed percent-encoding (e.g. lone `%`) which
        // would throw URIError and bubble up as a 500. Treat undecodable
        // input as a not-found genre slug.
        let rawGenreSlug: string;
        try {
          rawGenreSlug = decodeURIComponent(pathParts[2]);
        } catch {
          rawGenreSlug = pathParts[2];
        }
        const SAFE_GENRE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
        if (!SAFE_GENRE_SLUG_RE.test(rawGenreSlug)) {
          stationNotFound = true;
          additionalData.notFound = true;
          additionalData.genreSlug = rawGenreSlug;
          additionalData.genreName = rawGenreSlug;
        } else {
        const requestedSlug = pathParts[2];
        additionalData.genreSlug = requestedSlug;
        additionalData.genreName = requestedSlug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

        // Task #104: gate the /genres/:slug surface against the genre whitelist.
        //   1. If the slug is on the whitelist → render normally (may still be
        //      noindex'ed below if it has <6 indexable popular stations).
        //   2. If the slug is a known close-match alias whose canonical IS on
        //      the whitelist → 301 redirect to the canonical localized URL so
        //      Google consolidates ranking on the real genre.
        //   3. Otherwise (raw tag noise — FM frequencies, city names, station
        //      brands, random tokens) → mark the page noindex; the URL is also
        //      already dropped from the sitemap by sitemap-manifest-builder.ts.
        const canonicalSlug = getCanonicalGenreSlug(requestedSlug);
        if (canonicalSlug && canonicalSlug !== requestedSlug.toLowerCase()) {
          // Aliased — emit a 301 to the canonical genre URL.
          const englishCanonicalPath = `/genres/${canonicalSlug}`;
          const canonicalLocalized = buildLocalizedUrl(
            englishCanonicalPath,
            actualLanguage,
            countryCode,
            urlTranslations,
          );
          logger.log(`🔀 SEO GENRE 301: ${cleanPath} → ${canonicalLocalized} (alias → ${canonicalSlug})`);
          return {
            language,
            cleanPath,
            seoTags: {},
            translations: {},
            pageData: { redirectTo: canonicalLocalized },
          };
        }
        if (!canonicalSlug) {
          // Not on the whitelist and not aliased — flag for noindex below.
          additionalData.genreNotWhitelisted = true;
        }
        // DALGA 2 W2.1: Fetch top 12 stations matching this genre for SSR <img> grid (image indexing)
        try {
          const term = pathParts[2].replace(/-/g, ' ');
          // Escape regex meta-chars (replit.md SSRF/NoSQL rule)
          const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const topStations = await withSignal<LeanStationCard[]>(
            Station.find({
              tags: { $regex: escapedTerm, $options: 'i' },
              slug: { $exists: true, $ne: '' },
              $or: [{ noIndex: { $exists: false } }, { noIndex: { $ne: true } }],
              votes: { $gt: 0 },
            })
              .sort({ votes: -1 })
              .limit(24)
              .select('name slug favicon logoAssets country countryCode tags votes descriptions url homepage bitrate lastCheckOk lastCheckOkTime lastCheckTime')
              .lean(),
            signal
          );
          // DALGA 2 W2.REVIEW P2: Apply junk-station gate per replit.md INDEXABILITY-GATE rule.
          // Use isJunkStation + noIndex (not full isStationIndexableInLanguage which requires
          // BOTH meta+full descriptions per language — too restrictive for our image-grid surface
          // where the station's own SSR page already enforces full language gate).
          additionalData.popularStations = topStations
            .filter((s) => s.noIndex !== true && !isJunkStation(s))
            .slice(0, 12);
        } catch (error: any) {
          if (error?.name === 'AbortError' || signal?.aborted) throw error;
        }
        }
      }
    } else if (cleanPath.startsWith('/stations')) {
      pageType = 'stations';
    } else if (
      cleanPath === '/feedback' || cleanPath.startsWith('/feedback/') ||
      cleanPath === '/llms' || cleanPath.startsWith('/llms/') ||
      cleanPath === '/notifications' || cleanPath.startsWith('/notifications/') ||
      cleanPath === '/profile' || cleanPath.startsWith('/profile/')
    ) {
      // 2026-05-12 SEO audit: utility/account pages have no unique
      // public SEO content. Without an explicit branch they fell
      // through to pageType='home' and reused meta_title — creating
      // duplicate-meta audit errors per locale. Mark them noindex at
      // the renderer level (not just in robots.txt) so any crawler
      // that hits them sees a clear directive and they never enter
      // the duplicate-meta bucket. The branch is placed BEFORE
      // /users/ so the more general utility match wins for the
      // non-public surfaces.
      pageType = 'utility';
    } else if (cleanPath === '/users' || cleanPath.startsWith('/users/') || cleanPath === '/users') {
      // 2026-05-12 SEO audit: previously /users had no pageType branch
      // and fell through to the home bucket, producing duplicate-title
      // audit errors (every locale's /users page reused meta_title).
      pageType = 'users';
    } else if (cleanPath === '/recommendations' || cleanPath.startsWith('/recommendations/')) {
      // 2026-05-12 SEO audit: same root cause as /users — TR
      // /tr/tavsiyeler was inheriting the home meta_title, which
      // Semrush flagged as a duplicate-title error.
      pageType = 'recommendations';
    } else if (cleanPath.startsWith('/regions') || cleanPath.startsWith('/country')) {
      pageType = 'regions';
      // Extract region/country information for more specific SEO
      const pathParts = cleanPath.split('/');

      // Task #127: route-shape detection + validation. The two URL families
      // share the same SSR pageType but have different slug semantics:
      //   /regions/<continent>[/<country>[/<city>]]   pathParts[2] = continent
      //   /country/<country>[/<city>]                 pathParts[2] = country
      // The continent whitelist applies ONLY to /regions/* — applying it to
      // /country/* would false-404 every valid country page (the v1 fix had
      // this regression). Logic extracted to `seo/url-helpers.ts` so the
      // regression suite can unit-test it without booting the renderer.
      const routeShape = validateRegionRouteShape(cleanPath);

      if (pathParts.length > 2) {
        additionalData.region = pathParts[2];
        // SEO audit fix (2026-05-12): the previous logic always took the
        // LAST path segment as regionName, which broke terminal listing
        // paths like `/regions/asia/turkey/stations` and
        // `/regions/asia/turkey/istanbul/stations` — the resulting H1/title
        // came out as "Stations Radio Stations — Listen Live Online" with
        // "Stations" as the country name. Now we strip the terminal listing
        // segment (`stations`, `cities`) before deriving regionName, so the
        // page correctly resolves to the parent geography (Turkey, Istanbul).
        // Note: `cleanPath` is already URL-translated to English by the
        // upstream pipeline, so checking the literal English segment is
        // sufficient (TR `/tr/bolgeler/asia/turkey/istasyonlar` becomes
        // `/regions/asia/turkey/stations` here).
        const TERMINAL_LISTING_SEGMENTS = new Set(['stations', 'cities']);
        const lastSegment = pathParts[pathParts.length - 1];
        const segmentForName =
          TERMINAL_LISTING_SEGMENTS.has(lastSegment.toLowerCase()) && pathParts.length > 3
            ? pathParts[pathParts.length - 2]
            : lastSegment;
        additionalData.regionName = segmentForName
          .split('-')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');
        if (pathParts.length > 3) {
          additionalData.country = pathParts[3];
        }
        if (pathParts.length > 4) {
          additionalData.city = pathParts[4];
        }

        if (!routeShape.ok) {
          // Task #127: route-shape failure → real 404. index-web.ts catch-all
          // maps notFound:true to HTTP 404 + 404 page body for bot traffic.
          stationNotFound = true;
          additionalData.notFound = true;
          additionalData.popularStations = [];
        } else {
          // DALGA 2 W2.2: Fetch top 12 stations from this country for SSR flag + <img> grid
          try {
            const countryName = additionalData.regionName as string;
            const escapedCountry = countryName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const topStations = await withSignal<LeanStationCard[]>(
              Station.find({
                country: { $regex: `^${escapedCountry}$`, $options: 'i' },
                slug: { $exists: true, $ne: '' },
                $or: [{ noIndex: { $exists: false } }, { noIndex: { $ne: true } }],
                votes: { $gt: 0 },
              })
                .sort({ votes: -1 })
                .limit(24)
                .select('name slug favicon logoAssets country countryCode tags votes descriptions url homepage bitrate lastCheckOk lastCheckOkTime lastCheckTime')
                .lean(),
              signal
            );
            // DALGA 2 W2.REVIEW P2: Junk gate via isJunkStation + noIndex (see W2.1 comment).
            const indexableStations = topStations.filter((s) =>
              s.noIndex !== true && !isJunkStation(s)
            );
            additionalData.popularStations = indexableStations.slice(0, 12);
            // Pull lowercase ISO countryCode from first matching station for flagcdn.com
            const cc = topStations[0]?.countryCode;
            if (cc && typeof cc === 'string' && /^[a-z]{2}$/i.test(cc)) {
              additionalData.countryCode = cc.toLowerCase();
            }

            // SOFT-404 PROMOTION DISABLED (2026-05-12):
            // Previously this block ran a second Station.find with a
            // case-insensitive regex on `country: /^${regionName}$/i` and,
            // if zero indexable stations matched, did a Country.findOne with
            // the same regex; if BOTH came back empty we promoted the page
            // to HTTP 404. In practice this false-404'd every country page
            // whose DB row used a localized/diacritic name (e.g. slug
            // `turkey` vs DB `country: "Türkiye"`) — the regex `/^Turkey$/i`
            // never matches `Türkiye`, so popular countries were getting
            // de-indexed by Google despite having thousands of indexable
            // stations. Now that SSR is served to ALL visitors (not just
            // bots), this regression became immediately visible.
            //
            // The route-shape validator above (`validateRegionRouteShape`)
            // already enforces continent whitelist + safe slug shape, so
            // garbage URLs like `/regions/foo/bar` still 404. Real country
            // pages with sparse content render as 200 thin pages — Google
            // handles those gracefully via the canonical/hreflang signals
            // and the SSR popular-stations grid above. If we ever need to
            // re-introduce empty-country detection, do it via a slug→ISO
            // country-code mapping (not a name regex) so it's robust to
            // diacritics and language-specific spellings.
          } catch (error: any) {
            if (error?.name === 'AbortError' || signal?.aborted) throw error;
          }
        }
      }
    } else if (cleanPath === '/tv') {
      pageType = 'tv';
    } else if (cleanPath.startsWith('/about')) {
      pageType = 'about';
    } else if (cleanPath.startsWith('/contact')) {
      pageType = 'contact';
    } else if (cleanPath.startsWith('/applications')) {
      pageType = 'applications';
    } else if (cleanPath.startsWith('/terms-and-conditions') || cleanPath.startsWith('/pages/terms-and-conditions')) {
      pageType = 'terms';
    } else if (cleanPath.startsWith('/privacy-policy') || cleanPath.startsWith('/pages/privacy-policy')) {
      pageType = 'privacy';
    } else if (cleanPath.startsWith('/search')) {
      pageType = 'search';
    } else if (cleanPath.startsWith('/faq')) {
      pageType = 'faq';
    } else if (cleanPath === '/' || cleanPath === '') {
      pageType = 'home';
      try {
        const popularStations = await withSignal(
          Station.find({ votes: { $gt: 0 } })
            .sort({ votes: -1 })
            .limit(10)
            .select('name slug favicon logoAssets country tags votes')
            .lean(),
          signal
        );
        additionalData.popularStations = popularStations;
      } catch (error: any) {
        if (error?.name === 'AbortError' || signal?.aborted) throw error;
      }
    }
    
    // Generate enhanced SEO tags with additional context
    // Pass localized path to use translated paths in canonical URL
    // Also pass urlTranslations map for hreflang tags with translated paths
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    let seoTags = await this.generateEnhancedSeoTags(pageType, language, translations, cleanPath, domain, stationData, additionalData, cleanUrl, localizedPath, urlTranslations);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    // ---- ContentQuality safeguard (task #17 + architect P0) ---------------
    // 1) If the resolved station is junk (test feed, codec suffix, song name,
    //    -1/-2 collision) emit robots=noindex so Bing/Google stop reporting
    //    these as low-quality alternates. The request handler will upgrade
    //    this to a 410 Gone via the `stationIsJunk` flag surfaced on pageData.
    // 2) If the requested UI language is not in the station's "appropriate
    //    language set" (country/diaspora/broadcast lang + English), emit
    //    noindex on that language variant. The canonical/eligible languages
    //    remain indexable.
    // 3) Restrict hreflang alternates to the station's indexable-language set
    //    (eligible + English). Previously we advertised all ~57 enabled
    //    languages, which caused Google to crawl 57 variants per station and
    //    dump ~55 of them into "Crawled - currently not indexed".
    let stationIsJunkFlag = false;
    if (pageType === 'station' && stationData && !stationNotFound) {
      try {
        const {
          isJunkStation,
          getIndexableLanguagesForStation,
          isStationIndexableInLanguage,
          isNumericOnlySlug,
        } = await import('./seo/junk-station-rules');
        const { getCachedQualifiedLanguages } = await import('./seo/qualified-languages');

        // Unified indexability gate — sitemap, SSR robots, hreflang, and the
        // 410 handler all derive their answer from these two calls. Never
        // branch on `isLanguageEligibleForStation` or `getEligibleLanguages`
        // here — that bypasses the translation-qualification check and can
        // re-introduce "Crawled - currently not indexed" regressions.
        const qualifiedLangs = await getCachedQualifiedLanguages();
        const isJunk = isJunkStation(stationData) || stationData.noIndex === true;
        const indexable = getIndexableLanguagesForStation(stationData, qualifiedLangs);
        const langIneligible =
          !isJunk && !isStationIndexableInLanguage(stationData, language, qualifiedLangs);
        // Numeric-only slugs (e.g. `-911`, `1234`) → noindex but not 410, so
        // legitimate numeric-callsign brands are not lost.
        const numericOnlySlug = !isJunk && isNumericOnlySlug(stationData.slug);

        if (isJunk || langIneligible || numericOnlySlug) {
          seoTags.robots = 'noindex, follow';
          seoTags.noIndex = true;

          // Point canonical at the indexable main-language variant so search
          // engines consolidate any residual signals on the version we want
          // indexed. Use the SAME `indexable` array the hreflang loop below
          // uses — NOT a raw `getEligibleLanguages` call — so canonical and
          // hreflang never diverge (architect gate invariant). When the
          // station is junk (indexable === []), fall through to English; the
          // page is served as 410 Gone anyway, so canonical is mostly for
          // consistency with already-indexed copies.
          const canonicalLang = indexable.includes('en')
            ? 'en'
            : indexable[0] || 'en';
          if (canonicalLang && stationData.slug) {
            // Always resolve to a real route segment — never use the raw
            // language code as the segment (which would yield /xx/xx/slug).
            // Look up the translated `station` segment for the canonical
            // language; fall back to English `station` which is a guaranteed
            // valid route prefix served by the middleware.
            const translatedSegment =
              urlTranslations?.get(`${canonicalLang}:station`) || 'station';
            seoTags.canonical = `${domain}/${canonicalLang}/${translatedSegment}/${stationData.slug}`;
          }
        }

        if (isJunk) {
          // Signal to the HTTP layer to return 410 Gone instead of SSR'ing
          // the page. Also suppress ALL hreflang alternates — a noindex/
          // gone page must not expose alternates (Google policy).
          stationIsJunkFlag = true;
          seoTags.hreflangs = [];
        } else {
          // Hreflang alternates come from the SAME unified gate that the
          // sitemap uses — so the two surfaces advertise the exact same
          // (station × language) set. Passing `qualifiedLangs` here ensures
          // thin/partially-translated languages are excluded from both.
          seoTags.hreflangs = generateLanguageUrls(
            cleanPath,
            domain,
            language,
            urlTranslations,
            seoTags.canonical,
            indexable,
          );
        }
      } catch (e: any) {
        // Non-fatal: if the rules module fails to load just leave robots as-is.
        // BUT we log loudly — silently swallowing here previously hid a broken
        // import path and caused station hreflang to skip the indexability gate.
        try {
          const { logger } = await import('./utils/logger');
          logger.warn(
            `⚠️ seo-renderer: station indexability gate failed: ${e?.message || e}`,
          );
        } catch {}
      }
    }

    // ---- Genre quality safeguard (task #104) ------------------------------
    // Companion to the sitemap whitelist filter in
    // sitemap-manifest-builder.ts/buildGenreChunks. Even though those URLs are
    // dropped from the sitemap, Googlebot may still rediscover them via old
    // backlinks or its own URL store, so the SSR layer must independently
    // emit `noindex` for:
    //   1. genre slugs not on the curated whitelist (raw tag noise — FM
    //      frequencies, city names, station/brand names, random tokens), and
    //   2. whitelisted genres that ended up with fewer than
    //      MIN_STATIONS_FOR_GENRE_INDEX indexable popular stations after
    //      filtering — a thin grid is the same soft-404 signal that put the
    //      whole template on Google's low-quality list.
    if (pageType === 'genres' && additionalData?.genreSlug) {
      const popularStations = (additionalData?.popularStations as any[] | undefined) || [];
      const tooThin = popularStations.length < MIN_STATIONS_FOR_GENRE_INDEX;
      if (additionalData.genreNotWhitelisted || tooThin) {
        seoTags.robots = 'noindex, follow';
        seoTags.noIndex = true;
        // Suppress hreflang alternates on noindex'd genre URLs so we don't
        // advertise 44 low-quality variants of the same thin page.
        seoTags.hreflangs = [];
      }
      // Task #127: Promote a NOT-whitelisted genre with ZERO indexable
      // stations from `noindex 200` to a real `404 Not Found`. Google had
      // been classifying these as soft-404s; a hard 404 drops them from
      // the index immediately. We keep the softer noindex-200 path for
      // whitelisted-but-thin genres because real users typing the URL
      // still see a useful (though sparse) genre grid.
      if (additionalData.genreNotWhitelisted && popularStations.length === 0) {
        stationNotFound = true;
        additionalData.notFound = true;
      }
    }
    // -----------------------------------------------------------------------
    // Map internal pageTypes to database format
    const dbPageTypeMap: Record<string, string> = {
      'home': 'homepage',
      'station': 'station_detail',
      'genres': 'genre_detail',
      'regions': 'country_detail',
      'about': 'static',
      'contact': 'static',
      'terms': 'static',
      'privacy': 'static',
      'applications': 'static',
      'tv': 'static',
      'search': 'static',
      'faq': 'static'
    };
    
    const dbPageType = dbPageTypeMap[pageType] || pageType;
    
    // Extract routeKey for the page (matches admin UI storage format)
    // Admin stores full cleanPath minus language prefix (e.g., "genres/rock", "station/bbc-radio-1")
    let routeKey = '';
    if (pageType === 'station' && stationData?.slug) {
      // Station pages use slug directly for cleaner lookups
      routeKey = stationData.slug;
    } else if (pageType === 'genres') {
      // Genre pages: use cleanPath starting from /genres (e.g., "genres/rock")
      routeKey = cleanPath.startsWith('/') ? cleanPath.slice(1) : cleanPath;
    } else if (pageType === 'regions') {
      // Region pages: use cleanPath starting from /regions (e.g., "regions/europe/germany")
      routeKey = cleanPath.startsWith('/') ? cleanPath.slice(1) : cleanPath;
    } else if (pageType === 'home') {
      // Homepage: empty routeKey
      routeKey = '';
    } else if (['about', 'contact', 'terms', 'privacy', 'applications'].includes(pageType)) {
      // Static pages: use pageType as routeKey
      routeKey = pageType;
    }
    
    const customMetadata = await this.getCustomSeoMetadata(dbPageType, routeKey, language, signal);
    if (customMetadata) {
      logger.log(`🎯 Using custom SEO metadata for ${dbPageType}/${routeKey}/${language}`);
      seoTags = this.applyCustomSeoMetadata(seoTags, customMetadata);
    }
    
    // Compile the static page data
    const pageData = {
      language,
      cleanPath,
      seoTags,
      translations,
      urlTranslations,
      pageData: {
        pageType,
        station: stationData,
        seoTags,
        ...additionalData,
        additionalData,
        notFound: stationNotFound || false,
        // Architect P0: surfaces junk-station detection to the HTTP layer so
        // it can upgrade the response from 200/noindex to 410 Gone. 410 is
        // how we tell Google "this URL is really gone, drop it from the
        // index fast" — 301 + noindex leaves URLs in the crawl queue for
        // months.
        stationIsJunk: stationIsJunkFlag,
      }
    };
    
    performanceCache.setPageData(cacheKey, pageData);
    
    return pageData;
    }, url);
  }

  async generateEnhancedSeoTags(
    pageType: string, 
    language: string, 
    translations: Record<string, string>, 
    cleanPath: string, 
    domain: string, 
    stationData?: any, 
    additionalData?: any,
    originalPath?: string,  // Original URL path to preserve country codes
    translatedPath?: string,  // Translated path from database for canonical URL
    urlTranslations?: Map<string, string>  // URL translations map for all languages
  ): Promise<any> {
    // Use the existing generateSeoTags function as base
    // Pass translated path to use localized paths in canonical URL (e.g., /sq/zhanret instead of /sq/genres)
    // Also pass urlTranslations map for generating hreflang tags with translated paths
    const baseSeoTags = generateSeoTags(pageType, language, translations, cleanPath, domain, stationData, originalPath, translatedPath, urlTranslations);
    
    // Helper to get translations from database — with English fallbacks for critical SEO keys
    // These keys are often empty in non-English DB → without fallbacks titles become "Pop  -  | Mega Radio"
    const SEO_KEY_FALLBACKS: Record<string, string> = {
      seo_radio_stations: 'Radio Stations',
      seo_listen_live_online: 'Listen Live Online',
      seo_listen_to_live_radio_from: 'Listen to live radio from',
      seo_discover_local: 'Discover local',
      seo_music_and_shows: 'music and shows',
      seo_radio_broadcasting_free: 'radio broadcasting for free',
      seo_regional_broadcasting: 'Regional Broadcasting',
      seo_explore_radio_stations_from: 'Explore radio stations from',
      seo_listen_to_regional_broadcasting: 'Listen to regional broadcasting',
      about_mega_radio: 'About Mega Radio - Free Online Radio Platform',
      about_mega_radio_description: 'Learn about Mega Radio, the free online radio platform with 60,000+ stations from 120+ countries. Stream music, news, sports, and talk radio worldwide.',
      contact_page_title: 'Contact Mega Radio - Get in Touch',
      contact_page_description: 'Contact the Mega Radio team for support, feedback, or partnership inquiries. We are here to help you with your free radio streaming experience worldwide.',
      search_page_title: 'Search Radio Stations — Find Live Radio by Name, Genre or Country | Mega Radio',
      search_page_description: 'Search 60,000+ live radio stations from 120+ countries on Mega Radio. Find your favourite station by name, genre, language, or country and listen free online.',
      search_page_h1: 'Search Live Radio Stations',
      faq_page_title: 'Radio Streaming FAQ — Common Questions about Online Radio | Mega Radio',
      faq_page_description: 'Frequently asked questions about Mega Radio: how to listen to online radio, supported devices, free streaming, mobile apps, station coverage, and account help.',
      faq_page_h1: 'Mega Radio Frequently Asked Questions',
    };
    const getTranslation = (key: string): string => {
      const val = translations[key]?.trim();
      return val ? val : (SEO_KEY_FALLBACKS[key] || '');
    };

    // Enhance with more specific content based on page type and additional data
    // Same logic as before, but using database translations
    if (pageType === 'regions' && additionalData) {
      // Use multilingual SEO templates (shared/region-seo-templates.ts).
      // Without this, every non-English language served the SAME English title
      // ("Germany Radio Stations - Regional Broadcasting | Mega Radio") and
      // description across ~120 countries × 44 languages. Google was collapsing
      // the duplicates into one EN canonical and dropping the rest.
      if (additionalData.country) {
        const countryName = additionalData.country.replace(/-/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());
        const seo = buildCountrySeo(countryName, language, translations);
        baseSeoTags.title = seo.title;
        baseSeoTags.description = seo.description;
        baseSeoTags.keywords = seo.keywords;
      } else if (additionalData.region) {
        const regionName = additionalData.region.replace(/-/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());
        const seo = buildRegionSeo(regionName, language, translations);
        baseSeoTags.title = seo.title;
        baseSeoTags.description = seo.description;
        baseSeoTags.keywords = seo.keywords;
      }
    }
    
    if (pageType === 'genres' && additionalData?.genreName) {
      // Use multilingual SEO templates (server/seo/genre-seo-templates.ts).
      // DB translation keys win when ALL legacy keys are present in the requested
      // language; otherwise we fall back to the natural per-language template.
      // Without this, every non-English language showed English title fragments
      // ("Pop Radio Stations") and a fully-English description.
      const genreSeo = buildGenreSeo(additionalData.genreName, language, translations);
      baseSeoTags.title = genreSeo.title;
      baseSeoTags.description = genreSeo.description;
      baseSeoTags.keywords = genreSeo.keywords;
    }
    
    if (pageType === 'utility') {
      // 2026-05-12 SEO audit: see corresponding branch in determinePageType.
      // Utility surfaces (feedback / llms / notifications / profile) get a
      // distinct title per URL so they never clash with home, AND get a
      // hard noindex directive so they're explicitly excluded from search.
      const utilityLabel = cleanPath.split('/').filter(Boolean)[0] || 'page';
      const titleLabel = utilityLabel.charAt(0).toUpperCase() + utilityLabel.slice(1);
      baseSeoTags.title = `${titleLabel} | Mega Radio`;
      baseSeoTags.description = `Mega Radio ${utilityLabel} page.`;
      baseSeoTags.robots = 'noindex, follow';
      (baseSeoTags as any).noIndex = true;
      baseSeoTags.ogType = 'website';
    }

    if (pageType === 'users' || pageType === 'recommendations' || pageType === 'stations') {
      // 2026-05-12 SEO audit fix: every locale must ship a distinct,
      // localized title + description for these three surfaces.
      // Without this override, /tr/kullanicilar and /tr/tavsiyeler
      // reused the home meta_title (duplicate-title audit error) and
      // /tr/istasyon reused the home meta_description (duplicate-meta
      // audit error). Mirrors the buildStaticPageSeo / buildLegalSeo
      // override pattern. DB keys take precedence when present in the
      // requested language so admins can still override per-locale.
      const communitySeo = buildCommunityPageSeo(pageType, language, translations);
      baseSeoTags.title = communitySeo.title;
      baseSeoTags.description = communitySeo.description;
      if (communitySeo.keywords) baseSeoTags.keywords = communitySeo.keywords;
      baseSeoTags.ogType = 'website';
    }

    if (pageType === 'about' || pageType === 'contact' || pageType === 'applications') {
      // Use multilingual SEO templates (lib/seo-shared/static-page-seo-templates.ts).
      // DB translation keys (about_mega_radio/_description, contact_page_title/_description,
      // applications_page_seo_title/_description) win when present in the requested
      // language; otherwise we fall back to the natural per-language template so non-top-15
      // languages don't all serve the SAME English title and description across
      // /xx/about, /xx/contact and /xx/applications (the same duplicate-content trap
      // regions, genres, search and legal had before they were localised).
      const staticSeo = buildStaticPageSeo(pageType, language, translations);
      baseSeoTags.title = staticSeo.title;
      baseSeoTags.description = staticSeo.description;
      baseSeoTags.ogType = 'website';
    }
    
    if (pageType === 'tv') {
      baseSeoTags.title = `${getTranslation('tv_login_title') || 'Connect Your TV'} | Mega Radio`;
      baseSeoTags.description = getTranslation('tv_enter_code_description') || 'Open Mega Radio on your TV and enter the 6-digit code displayed on the screen.';
      baseSeoTags.ogType = 'website';
    }
    
    if (pageType === 'terms' || pageType === 'privacy') {
      // Use multilingual SEO templates (lib/seo-shared/legal-seo-templates.ts).
      // DB translation keys (terms_page_title/_description, privacy_page_title/_description)
      // win when present in the requested language; otherwise we fall back to the
      // natural per-language template so non-top-15 languages don't all serve the SAME
      // English title and description across /xx/terms-and-conditions and
      // /xx/privacy-policy (the same duplicate-content trap regions, genres and
      // search had before they were localised).
      const legalSeo = buildLegalSeo(pageType, language, translations);
      baseSeoTags.title = legalSeo.title;
      baseSeoTags.description = legalSeo.description;
      baseSeoTags.ogType = 'website';
    }

    if (pageType === 'search') {
      // Use multilingual SEO templates (shared/search-seo-templates.ts).
      // DB translation keys (search_page_title/_description) win when present in
      // the requested language; otherwise we fall back to the natural per-language
      // template so non-top-15 languages don't all serve the SAME English title and
      // description (which Google previously collapsed as duplicates the same way
      // it did for regions and genres before those were localised).
      const searchSeo = buildSearchSeo(language, translations);
      baseSeoTags.title = searchSeo.title;
      baseSeoTags.description = searchSeo.description;
      baseSeoTags.keywords = searchSeo.keywords;
      baseSeoTags.ogType = 'website';
      // Search result pages should not be indexed (Google guidance) but should be crawlable for links
      baseSeoTags.robots = 'noindex, follow';
    }

    if (pageType === 'faq') {
      baseSeoTags.title = getTranslation('faq_page_title');
      baseSeoTags.description = getTranslation('faq_page_description');
      baseSeoTags.ogType = 'website';
    }
    
    // Generate comprehensive hreflang tags for all pages with translated paths.
    // CRITICAL SEO FIX: Pass canonical URL for self-referential hreflang.
    // ARCHITECT P0 FIX (2026-04-30): non-station pages MUST advertise only the
    // qualified-language set so they don't expose 57 alternates while sitemaps
    // expose 10 (the original Bing 1023-empty-sitemap root cause). Station
    // pages override this below in renderStaticPage with the per-station
    // indexable set (eligible ∩ qualified).
    let allowedLanguages: string[] | undefined;
    try {
      const { getCachedQualifiedLanguages } = await import('./seo/qualified-languages');
      allowedLanguages = await getCachedQualifiedLanguages();
    } catch (e: any) {
      // FAIL-CLOSED (Webmaster #1 HIGH-2 fix, 2026-04-30): if the cache is
      // unavailable mid-request we MUST NOT fall back to all 57 enabled
      // SEO_LANGUAGES — that exact 58-vs-≤10 mismatch caused the original
      // 1023-empty-Bing-sitemap incident. Instead, restrict alternates to a
      // minimal safe set: the current rendering language + English. Ensures
      // (a) self-referential hreflang is always present, (b) we never expose
      // a language not also present in some sitemap, (c) sitemap-routes will
      // independently 503/410 anyway via getQualifiedLanguagesState().
      const minimalSet = Array.from(new Set([language, 'en'])).filter(Boolean);
      allowedLanguages = minimalSet;
      try {
        logger.warn(`⚠️ generateEnhancedSeoTags: qualified-languages unavailable — falling back to MINIMAL set [${minimalSet.join(',')}] (${e?.message || e})`);
      } catch {}
    }
    // FAIL-CLOSED guard #2: even when getCachedQualifiedLanguages() succeeded,
    // if the rendering language somehow isn't in the qualified set the page
    // would lose its self-referential hreflang (Search Console warning:
    // "Page does not have an hreflang tag pointing to itself"). Inject the
    // current language defensively. This addresses Webmaster #1 HIGH-1.
    if (Array.isArray(allowedLanguages) && language && !allowedLanguages.includes(language)) {
      allowedLanguages = [...allowedLanguages, language];
    }
    baseSeoTags.hreflangs = generateLanguageUrls(
      cleanPath,
      domain,
      language,
      urlTranslations,
      baseSeoTags.canonical,
      allowedLanguages,
    );

    return baseSeoTags;
  }
  
  private escapeHtml(input: string): string {
    if (!input) return '';
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  }

  /**
   * Pick a valid logo URL from a station object. Trims whitespace and requires
   * http(s) scheme so SSR <img> never renders a broken `src`. Used by both
   * home popular-stations grid and station detail page (DALGA 1).
   */
  private pickLogoUrl(station: any): string | null {
    const candidates = [
      station?.logoAssets?.webp256,
      station?.logoAssets?.webp96,
      station?.favicon,
    ];
    for (const c of candidates) {
      if (typeof c === 'string') {
        const trimmed = c.trim();
        if (trimmed && /^https?:\/\//i.test(trimmed)) return trimmed;
      }
    }
    return null;
  }

  /**
   * Build the breadcrumb trail used by BOTH the BreadcrumbList JSON-LD
   * (in `generateHtmlHead`) and the visible `<nav class="breadcrumb">`
   * (in `generateHtmlBody`). Sourcing them from one place is what
   * Task #280 asks for: Google flags a BreadcrumbList whose items don't
   * appear as visible links in the body as deceptive markup, the same
   * class of bug Tasks #129/#164/#208 fixed for FAQPage.
   *
   * Returns an empty array for the homepage (no crumbs).
   */
  private computeBreadcrumbItems(
    language: string,
    cleanPath: string,
    urlTranslations: Map<string, string> | undefined,
    stationData: any,
    getLocalizedText: (key: string, fallback: string) => string,
  ): Array<{ name: string; path: string }> {
    if (!cleanPath || cleanPath === '/' || cleanPath === '') return [];

    const items: Array<{ name: string; path: string }> = [
      { name: getLocalizedText('nav_home', 'Home'), path: `/${language}` },
    ];

    const pathSegments = cleanPath.split('/').filter(Boolean);
    const translateSeg = (seg: string): string => {
      if (!language || language === 'en') return seg;
      if (!urlTranslations || urlTranslations.size === 0) return seg;
      return urlTranslations.get(`${language}:${seg}`) || seg;
    };
    let currentPath = '';

    for (let i = 0; i < pathSegments.length; i++) {
      const segment = pathSegments[i];
      const isLastSegment = i === pathSegments.length - 1;
      const isStationDetailSlug = isLastSegment && (cleanPath.includes('/station/') || cleanPath.includes('/stations/'));
      const segForUrl = isStationDetailSlug ? segment : translateSeg(segment);
      currentPath += '/' + segForUrl;

      if (isStationDetailSlug) {
        const name = stationData?.name || segment.replace(/-/g, ' ').split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        items.push({ name, path: `/${language}${currentPath}` });
      } else if (segment !== 'stations' && segment !== 'station') {
        const translationKey = `nav_${segment}`;
        const displayName = getLocalizedText(translationKey, segment.replace(/-/g, ' ').split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '));
        items.push({ name: displayName, path: `/${language}${currentPath}` });
      }
    }

    if (cleanPath.includes('/stations') || cleanPath.includes('/station/')) {
      const idx = items.findIndex(b => !b.path.includes('/station'));
      const stationsName = getLocalizedText('nav_stations', 'Stations');
      if (idx >= 0 && !items.find(b => b.name.toLowerCase() === stationsName.toLowerCase())) {
        let stationSegment = 'stations';
        if (language !== 'en' && urlTranslations && urlTranslations.size > 0) {
          const translated = urlTranslations.get(`${language}:station`) || urlTranslations.get(`${language}:stations`);
          if (translated) stationSegment = translated;
        }
        items.splice(idx + 1, 0, { name: stationsName, path: `/${language}/${stationSegment}` });
      }
    }

    return items;
  }

  private getH1Text(pageType: string, language: string, translations: Record<string, string>, seoTags?: any, stationData?: any, additionalData?: any): string {
    // Helper function to get localized text from DATABASE ONLY (no hardcoded translations)
    const FALLBACK_TEXTS: Record<string, string> = {
      genres_page_title: 'Radio Genres — Browse All Music Genres | Mega Radio',
      stations_page_title: 'Radio Stations — Browse All Stations | Mega Radio',
      regions_page_title: 'Radio by Region — Browse Stations by Region | Mega Radio',
      hero_worlds_best_radio: 'Mega Radio: Listen to Free Live Radio & Music',
      about_mega_radio: 'About Mega Radio - Free Online Radio Platform',
      contact_page_title: 'Contact Mega Radio - Get in Touch',
      search_page_h1: 'Search Live Radio Stations',
      faq_page_h1: 'Mega Radio Frequently Asked Questions',
    };
    const getLocalizedText = (key: string): string => {
      const val = translations[key]?.trim();
      return val ? val : (FALLBACK_TEXTS[key] || '');
    };

    // Semrush 2026-05-13 audit: 2,039 pages had identical <title> and <h1>
    // because both used the same template strings (architect's investigation
    // confirmed). Google explicitly warns this looks "over-optimized". The
    // strategy below keeps each <title> keyword-rich (best for SERP CTR)
    // and renders a SHORTER, page-focused <h1> derived from but distinct
    // from the title.
    //
    // `deriveH1FromTitle` covers BOTH layout patterns we use:
    //   1. "About Mega Radio — Free Online Radio Platform"  → "About Mega Radio"
    //      (static-page-seo-templates.ts puts the brand in the MIDDLE; first
    //      em-dash segment is the focused heading.)
    //   2. "Terms and Conditions — Mega Radio"              → "Terms and Conditions"
    //      (legal-seo-templates.ts puts brand at the END; same split rule
    //      still gives the correct heading.)
    //   3. "Foo Bar | Mega Radio"                           → "Foo Bar"
    //      (genre / region listing fallbacks; pipe-suffix branch.)
    //   4. "تواصل مع Mega Radio" (no separator, brand mid-sentence)
    //      → "تواصل مع" (final fallback strips standalone "Mega Radio"
    //      anywhere in the string and collapses whitespace).
    const deriveH1FromTitle = (s: string): string => {
      const emDashIdx = s.indexOf(' — ');
      if (emDashIdx > 0) return s.slice(0, emDashIdx).trim();
      const pipeStripped = s.replace(/\s*\|\s*Mega\s+Radio\s*$/i, '').trim();
      if (pipeStripped && pipeStripped !== s) return pipeStripped;
      // Final fallback for single-phrase titles with brand mid-sentence
      // (e.g. AR contact "تواصل مع Mega Radio"). Strip the standalone
      // brand token anywhere it appears, collapse whitespace. Returns
      // input unchanged if removal would leave an empty string.
      const brandStripped = s
        .replace(/\s*Mega\s+Radio\s*/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return brandStripped && brandStripped !== s ? brandStripped : s;
    };

    switch (pageType) {
      case 'home':
        // H1 = bare localized hero phrase. The <title> generated in
        // seo-config.ts (home case) is augmented with a " | Mega Radio"
        // brand suffix when it doesn't already contain the brand, so the
        // two strings always differ even when meta_title is unset.
        return getLocalizedText('hero_worlds_best_radio');
      
      case 'station':
        if (stationData) {
          // H1 = "{station_name} {country_part}" — drop the trailing
          // " — Listen Live" CTA that the title carries. Keeps the
          // station + location keywords for SEO while remaining distinct
          // from <title>.
          const fullTitle = generateLocalizedStationTitle(stationData, language, translations);
          // generateLocalizedStationTitle format: `{name}{country_part} — {listen_live}`
          // Trim everything from the last " — " onward.
          const dashIdx = fullTitle.lastIndexOf(' — ');
          const h1Source = dashIdx > 0 ? fullTitle.slice(0, dashIdx) : fullTitle;
          return this.escapeHtml(h1Source);
        }
        return deriveH1FromTitle(getLocalizedText('stations_page_title'));
      
      case 'genres':
        if (additionalData?.genreName) {
          // Use multilingual helper so TR/DE/ES/etc. don't show English "Radio Stations"
          // when the legacy DB keys are missing (which is the current production state).
          const genreSeo = buildGenreSeo(additionalData.genreName, language, translations);
          // H1 = bare genreSeo.h1 (no " | Mega Radio" suffix) — title in
          // genre-seo-templates.ts already carries the brand suffix.
          return this.escapeHtml(genreSeo.h1);
        }
        return deriveH1FromTitle(getLocalizedText('genres_page_title'));
      
      case 'regions':
        if (additionalData?.regionName) {
          // SEO audit fix (2026-05-12): previously the title interpolated raw
          // English `regionName` (e.g. "Turkey") with two i18n keys that fell
          // back to English when the DB translation was missing. Result on a
          // TR page was the half-translated "Turkey Radio Stations — Canlı
          // Dinle | Mega Radio" — exactly the "language mismatch" issue the
          // audit flagged. Now we (a) localize the country name itself via
          // `getLocalizedCountryName` so "Turkey" → "Türkiye" / "Almanya" /
          // "Italia", and (b) fall back to LOCALIZED_LABELS (per-language
          // hand-curated copy) when the DB key is missing instead of dumping
          // English into a non-English page.
          const localizedRegion = this.escapeHtml(
            getLocalizedCountryName(additionalData.regionName, language)
          );
          const radioStationsText = this.escapeHtml(
            translations['seo_radio_stations']?.trim()
              || LOCALIZED_RADIO_STATIONS[language]
              || 'Radio Stations'
          );
          // H1 = "{region} {radio_stations}" — drop "— Listen Live | Mega
          // Radio" tail (kept on <title>) so the visible heading differs.
          return `${localizedRegion} ${radioStationsText}`;
        }
        return deriveH1FromTitle(getLocalizedText('regions_page_title'));
      
      case 'stations':
        return deriveH1FromTitle(getLocalizedText('stations_page_title'));
      
      case 'about':
        return deriveH1FromTitle(buildStaticPageSeo('about', language, translations).title);

      case 'contact':
        return deriveH1FromTitle(buildStaticPageSeo('contact', language, translations).title);

      case 'applications':
        return deriveH1FromTitle(buildStaticPageSeo('applications', language, translations).title);
      
      case 'terms':
        return deriveH1FromTitle(buildLegalSeo('terms', language, translations).title);

      case 'privacy':
        return deriveH1FromTitle(buildLegalSeo('privacy', language, translations).title);

      case 'search':
        return buildSearchSeo(language, translations).h1;

      case 'faq':
        return getLocalizedText('faq_page_h1');

      default:
        return getLocalizedText('hero_worlds_best_radio') || FALLBACK_TEXTS.hero_worlds_best_radio;
    }
  }

  generateHtmlBody(pageData: { pageType: string; language: string; translations: Record<string, string>; seoTags?: any; stationData?: any; additionalData?: any; urlTranslations?: Map<string, string>; cleanPath?: string }): string {
    const { pageType, language, translations, seoTags, stationData, additionalData, urlTranslations, cleanPath } = pageData;
    const h1Text = this.getH1Text(pageType, language, translations, seoTags, stationData, additionalData);

    // Visible breadcrumb trail — Task #280. Rendered above <main> on every
    // non-home page so the BreadcrumbList JSON-LD emitted in
    // `generateHtmlHead` has matching visible <a> links in the body.
    // Without this, Google flags the schema as deceptive markup (same
    // class of bug Tasks #129/#164/#208 fixed for FAQPage).
    let breadcrumbHtml = '';
    if (pageType !== 'home' && cleanPath) {
      const getLocalizedText = (key: string, fallback: string): string =>
        translations[key] || fallback;
      const breadcrumbItems = this.computeBreadcrumbItems(
        language,
        cleanPath,
        urlTranslations,
        stationData,
        getLocalizedText,
      );
      if (breadcrumbItems.length > 0) {
        breadcrumbHtml = `<nav aria-label="breadcrumb" class="breadcrumb"><ol>${breadcrumbItems
          .map(
            (it) =>
              `<li><a href="${this.escapeHtml(it.path)}">${this.escapeHtml(it.name)}</a></li>`,
          )
          .join('')}</ol></nav>`;
      }
    }
    
    // Generate a minimal but semantic HTML body for SEO
    const getLocalizedText = (key: string, fallback: string): string => {
      return translations[key] || fallback;
    };

    let content = '';
    
    switch (pageType) {
      case 'home':
        content = `
          <main>
            <div class="hero-section text-center">
              <p class="text-md font-medium">${this.escapeHtml(getLocalizedText('hero_over_100_countries', '60,000+ radio stations from 120+ countries'))}</p>
              <h1 class="text-xl font-bold sm:text-3xl lg:text-[44px]">${this.escapeHtml(h1Text)}</h1>
              <h2 class="text-lg sm:text-2xl">${this.escapeHtml(getLocalizedText('hero_listen_everywhere', 'Listen everywhere, anytime, for free'))}</h2>
            </div>
            
            <!-- SEO Opening Paragraph - Uses H1 Keywords -->
            <section class="intro-section">
              <p>${this.escapeHtml(getLocalizedText('seo_opening_paragraph', `${h1Text} - your gateway to unlimited radio streaming worldwide. Discover and listen to free live radio stations, music, news, sports, and entertainment from every corner of the globe. With thousands of online radio broadcasts available 24/7, you can enjoy crystal-clear audio streaming on any device, completely free of charge.`).replace('{h1}', h1Text))}</p>
            </section>
            
            <!-- SEO Navigation Links -->
            <nav class="main-navigation">
              <h2>${this.escapeHtml(getLocalizedText('explore_mega_radio', 'Explore Mega Radio'))}</h2>
              <ul>
                <li><a href="/${language}/genres">${this.escapeHtml(getLocalizedText('nav_genres', 'Radio Genres'))}</a></li>
                <li><a href="/${language}/regions">${this.escapeHtml(getLocalizedText('nav_regions', 'Radio by Country'))}</a></li>
                <li><a href="/${language}/stations">${this.escapeHtml(getLocalizedText('nav_stations', 'All Stations'))}</a></li>
                <li><a href="/${language}/recommendations">${this.escapeHtml(getLocalizedText('nav_for_you', 'For You'))}</a></li>
                <li><a href="/${language}/users">${this.escapeHtml(getLocalizedText('nav_users', 'Community'))}</a></li>
              </ul>
            </nav>
            
            ${additionalData?.popularStations && additionalData.popularStations.length > 0 ? `
            <!-- Popular Radio Stations - SEO image surface for Bing/Google image indexing -->
            <section class="popular-stations">
              <h2>${this.escapeHtml(getLocalizedText('popular_stations', 'Popular Radio Stations'))}</h2>
              <ul class="popular-stations-list">
                ${additionalData.popularStations.map((station: any) => {
                  const slug = station.slug || station._id;
                  // Prefix-all canonical: /<lang>/<localized-station>/<slug> for ALL languages including English
                  const stationSegment = urlTranslations?.get(`${language}:station`) || 'station';
                  const stationUrl = `/${language}/${stationSegment}/${slug}`;
                  // pickLogoUrl: trim + http(s) scheme guard (architect P1) — never render broken src
                  const logo = this.pickLogoUrl(station) || '/images/default-station.png';
                  const stationName = this.escapeHtml(station.name || 'Radio Station');
                  const country = station.country ? this.escapeHtml(station.country) : '';
                  const altText = country ? `${stationName} — ${country}` : stationName;
                  return `
                    <li>
                      <a href="${stationUrl}">
                        <img src="${this.escapeHtml(logo)}" alt="${altText}" width="256" height="256" loading="lazy" decoding="async">
                        <h3>${stationName}</h3>
                      </a>
                    </li>
                  `;
                }).join('')}
              </ul>
            </section>
            ` : ''}

            <!-- Popular Genres Links -->
            <section class="popular-genres">
              <h2>${this.escapeHtml(getLocalizedText('popular_genres_title', 'Popular Radio Genres'))}</h2>
              <ul>
                <li><a href="/${language}/genres/pop">${this.escapeHtml(getLocalizedText('genre_pop_radio', 'Pop Radio Stations'))}</a></li>
                <li><a href="/${language}/genres/rock">${this.escapeHtml(getLocalizedText('genre_rock_radio', 'Rock Radio Stations'))}</a></li>
                <li><a href="/${language}/genres/jazz">${this.escapeHtml(getLocalizedText('genre_jazz_radio', 'Jazz Radio Stations'))}</a></li>
                <li><a href="/${language}/genres/classical">${this.escapeHtml(getLocalizedText('genre_classical_radio', 'Classical Radio Stations'))}</a></li>
                <li><a href="/${language}/genres/electronic">${this.escapeHtml(getLocalizedText('genre_electronic_radio', 'Electronic Radio Stations'))}</a></li>
                <li><a href="/${language}/genres/country">${this.escapeHtml(getLocalizedText('genre_country_radio', 'Country Radio Stations'))}</a></li>
                <li><a href="/${language}/genres/hip-hop">${this.escapeHtml(getLocalizedText('genre_hiphop_radio', 'Hip Hop Radio Stations'))}</a></li>
                <li><a href="/${language}/genres/reggae">${this.escapeHtml(getLocalizedText('genre_reggae_radio', 'Reggae Radio Stations'))}</a></li>
              </ul>
            </section>
            
            <!-- Major Countries Links -->
            <section class="popular-countries">
              <h2>${this.escapeHtml(getLocalizedText('popular_countries_title', 'Radio Stations by Country'))}</h2>
              <ul>
                <li><a href="/${language}/regions/united-states">${this.escapeHtml(getLocalizedText('country_usa_radio', 'United States Radio'))}</a></li>
                <li><a href="/${language}/regions/united-kingdom">${this.escapeHtml(getLocalizedText('country_uk_radio', 'United Kingdom Radio'))}</a></li>
                <li><a href="/${language}/regions/germany">${this.escapeHtml(getLocalizedText('country_germany_radio', 'Germany Radio'))}</a></li>
                <li><a href="/${language}/regions/france">${this.escapeHtml(getLocalizedText('country_france_radio', 'France Radio'))}</a></li>
                <li><a href="/${language}/regions/canada">${this.escapeHtml(getLocalizedText('country_canada_radio', 'Canada Radio'))}</a></li>
                <li><a href="/${language}/regions/australia">${this.escapeHtml(getLocalizedText('country_australia_radio', 'Australia Radio'))}</a></li>
                <li><a href="/${language}/regions/brazil">${this.escapeHtml(getLocalizedText('country_brazil_radio', 'Brazil Radio'))}</a></li>
                <li><a href="/${language}/regions/italy">${this.escapeHtml(getLocalizedText('country_italy_radio', 'Italy Radio'))}</a></li>
                <li><a href="/${language}/regions/spain">${this.escapeHtml(getLocalizedText('country_spain_radio', 'Spain Radio'))}</a></li>
                <li><a href="/${language}/regions/turkey">${this.escapeHtml(getLocalizedText('country_turkey_radio', 'Turkey Radio'))}</a></li>
                <li><a href="/${language}/regions/japan">${this.escapeHtml(getLocalizedText('country_japan_radio', 'Japan Radio'))}</a></li>
                <li><a href="/${language}/regions/india">${this.escapeHtml(getLocalizedText('country_india_radio', 'India Radio'))}</a></li>
              </ul>
            </section>
            
            <!-- About Mega Radio -->
            <section class="about-section">
              <h2>${this.escapeHtml(getLocalizedText('faq_about_megaradio', 'About Mega Radio'))}</h2>
              <p>${this.escapeHtml(getLocalizedText('faq_seo_intro', 'Mega Radio is your ultimate destination for discovering and streaming live radio stations from around the world. With over 60,000 free radio stations spanning 120+ countries, we deliver unlimited access to music, news, sports, and entertainment across every language and genre.'))}</p>
              
              <nav class="footer-links">
                <ul>
                  <li><a href="/${language}/about">${this.escapeHtml(getLocalizedText('nav_about', 'About Us'))}</a></li>
                  <li><a href="/${language}/contact">${this.escapeHtml(getLocalizedText('nav_contact', 'Contact'))}</a></li>
                  <li><a href="/${language}/privacy-policy">${this.escapeHtml(getLocalizedText('nav_privacy', 'Privacy Policy'))}</a></li>
                  <li><a href="/${language}/terms-and-conditions">${this.escapeHtml(getLocalizedText('nav_terms', 'Terms of Service'))}</a></li>
                  <li><a href="/${language}/applications">${this.escapeHtml(getLocalizedText('nav_apps', 'Mobile Apps'))}</a></li>
                </ul>
              </nav>
            </section>
          </main>
        `;
        break;
      
      case 'station':
        content = `
          <main>
            <h1>${this.escapeHtml(h1Text)}</h1>
            ${stationData ? `
              <div class="station-info">
                ${(() => {
                  // Station logo - SEO image surface for Google/Bing image indexing (DALGA 1 W1.1)
                  // pickLogoUrl: trim + http(s) scheme guard (architect P1) — never render broken src
                  // fetchpriority intentionally NOT "high": logo is not always LCP; let browser decide (architect P1)
                  const logo = this.pickLogoUrl(stationData);
                  if (!logo) return '';
                  const name = this.escapeHtml(stationData.name || 'Radio Station');
                  const country = stationData.country ? this.escapeHtml(getLocalizedCountryName(stationData.country, language)) : '';
                  const altText = country ? `${name} logo — ${country}` : `${name} logo`;
                  const caption = country ? `${name} — ${country}` : name;
                  return `
                <figure class="station-logo">
                  <img src="${this.escapeHtml(logo)}" alt="${altText}" width="256" height="256" loading="eager" decoding="async">
                  <figcaption>${caption}</figcaption>
                </figure>`;
                })()}
                <!-- AI-Generated Description (unique per station) -->
                <h2>${this.escapeHtml(getLocalizedText('about_station', 'About ' + stationData.name))}</h2>
                <!-- DALGA 4: H1-keyword echo intro (single sentence, station-specific interpolation: name + country) -->
                ${(() => {
                  const introTemplate = getLocalizedText(
                    'seo_station_intro_sentence',
                    'Listen to {STATION} live online from {COUNTRY} — free internet radio streaming on Mega Radio.'
                  );
                  const stationName = stationData.name || 'Radio Station';
                  const country = stationData.country
                    ? getLocalizedCountryName(stationData.country, language)
                    : 'around the world';
                  const introText = introTemplate
                    .replace(/\{STATION\}/g, stationName)
                    .replace(/\{COUNTRY\}/g, country);
                  return `<p class="station-intro">${this.escapeHtml(introText)}</p>`;
                })()}
                ${stationData.descriptions && stationData.descriptions[language] ? (() => {
                  const desc = stationData.descriptions[language];
                  let fullText = '';
                  if (typeof desc === 'object' && desc.full) {
                    fullText = desc.full;
                  } else if (typeof desc === 'string') {
                    fullText = desc;
                  }
                  fullText = fullText
                    .replace(/^\s*\[TRANSLATED\s+FULL\s+DESCRIPTION\]\s*/i, '')
                    .replace(/^\s*\[TRANSLATED\s+META[^\]]*\]\s*/i, '')
                    .replace(/^\s*\[FULL\s+DESCRIPTION[^\]]*\]\s*/i, '')
                    .replace(/^\s*\[[^\]]*DESCRIPTION[^\]]*\]\s*/i, '')
                    .replace(/^\s*\[[^\]]*\]\s*/g, '')
                    .replace(/\{STATION_NAME\}/g, stationData.name)
                    .trim();
                  if (fullText && fullText.length > 300) {
                    const sentences = fullText.match(/[^.!?]+[.!?]+/g) || [fullText];
                    const paragraphs = [];
                    let currentParagraph = '';
                    for (const sentence of sentences) {
                      currentParagraph += sentence;
                      if (currentParagraph.length > 400) {
                        paragraphs.push(currentParagraph.trim());
                        currentParagraph = '';
                      }
                    }
                    if (currentParagraph.trim()) {
                      paragraphs.push(currentParagraph.trim());
                    }
                    return paragraphs.map(p => '<p>' + this.escapeHtml(p) + '</p>').join('');
                  } else if (fullText) {
                    return '<p>' + this.escapeHtml(fullText) + '</p>';
                  }
                  return '';
                })() : (stationData.description ? `<p>${this.escapeHtml(stationData.description)}</p>` : '')}
                <!-- DALGA 4: Station-specific outro (25-35 words, interpolation: name + country + tags — NOT scaled boilerplate) -->
                ${(() => {
                  const outroTemplate = getLocalizedText(
                    'seo_station_outro_sentence',
                    'Stream {STATION} 24/7 from anywhere with internet access. Discover {GENRES} radio stations from {COUNTRY} and 60,000 more stations on Mega Radio — free, no signup required.'
                  );
                  const stationName = stationData.name || 'Radio Station';
                  const country = stationData.country
                    ? getLocalizedCountryName(stationData.country, language)
                    : 'around the world';
                  const tagList = (stationData.tags || '')
                    .split(/[,;]/)
                    .map((t: string) => t.trim())
                    .filter((t: string) => t.length > 0)
                    .slice(0, 3)
                    .join(', ');
                  const genres = tagList || getLocalizedText('seo_live_radio', 'live radio');
                  const outroText = outroTemplate
                    .replace(/\{STATION\}/g, stationName)
                    .replace(/\{COUNTRY\}/g, country)
                    .replace(/\{GENRES\}/g, genres);
                  return `<p class="station-outro">${this.escapeHtml(outroText)}</p>`;
                })()}
                
                <!-- Station Details -->
                <section class="station-details">
                  <h2>${this.escapeHtml(getLocalizedText('station_information', 'Station Information'))}</h2>
                  ${stationData.country ? `
                  <p><strong>${this.escapeHtml(getLocalizedText('country', 'Country'))}:</strong> ${this.escapeHtml(getLocalizedCountryName(stationData.country, language))}</p>
                  ` : ''}
                  ${stationData.tags ? `
                  <p><strong>${this.escapeHtml(getLocalizedText('genres', 'Genres'))}:</strong> ${stationData.tags.split(',').slice(0, 6).map((tag: string) => this.escapeHtml(tag.trim())).join(', ')}</p>
                  ` : ''}
                  ${stationData.url ? (() => {
                    // 2026-05-12 Semrush audit: this `<a>` rendered the
                    // raw stream URL (e.g. `https://icecast.walmradio.com:8443/otr`)
                    // as both the href AND the visible text, which Semrush
                    // (and Google) classify as "naked URL = no anchor
                    // text" — 114 hits across all language × station
                    // permutations. The fix uses a descriptive label
                    // ("Official Website of <station name>") that tells
                    // crawlers what the linked page is about while still
                    // exposing the URL for transparency.
                    const websiteLabel = this.escapeHtml(
                      getLocalizedText('website', 'Official Website'),
                    );
                    const stationName = this.escapeHtml(stationData.name || '');
                    const anchorText = stationName
                      ? `${websiteLabel} — ${stationName}`
                      : websiteLabel;
                    return `
                  <p><strong>${websiteLabel}:</strong> <a href="${this.escapeHtml(stationData.url)}" target="_blank" rel="noopener noreferrer nofollow">${anchorText}</a></p>`;
                  })() : ''}
                </section>
                
                <!-- Navigation -->
                <nav class="explore-nav">
                  <ul>
                    <li><a href="/${language}/genres">${this.escapeHtml(getLocalizedText('nav_genres', 'Browse All Radio Genres'))}</a></li>
                    <li><a href="/${language}/regions">${this.escapeHtml(getLocalizedText('nav_regions', 'Radio Stations by Country'))}</a></li>
                    <li><a href="/${language}/stations">${this.escapeHtml(getLocalizedText('nav_stations', 'Explore All Stations'))}</a></li>
                    <li><a href="/${language}/">${this.escapeHtml(getLocalizedText('nav_home', 'Home'))}</a></li>
                  </ul>
                </nav>
              </div>
            ` : ''}
          </main>
        `;
        break;
      
      case 'genres':
        {
          const genreName = additionalData?.genreName || '';
          const langPrefix = `/${language}`;
          content = `
          <main>
            <h1>${this.escapeHtml(h1Text)}</h1>
            ${genreName ? (() => {
              // Multilingual body intro/availability — see shared/genre-seo-templates.ts.
              // Replaces the old per-key i18n approach which left TR/DE/etc. body fragments in English.
              const genreSeo = buildGenreSeo(genreName, language, translations);
              return `
            <section>
              <p>${this.escapeHtml(genreSeo.bodyIntro)}</p>
              <p>${this.escapeHtml(genreSeo.bodyAvailability)}</p>
            </section>`;
            })() : ''}
            ${additionalData?.popularStations && additionalData.popularStations.length > 0 ? `
            <!-- DALGA 2 W2.1: Top stations for this genre — SEO image surface -->
            <section class="popular-stations">
              <h2>${this.escapeHtml(getLocalizedText('popular_stations', 'Popular Radio Stations'))}</h2>
              <ul class="popular-stations-list">
                ${additionalData.popularStations.map((station: any) => {
                  const slug = station.slug || station._id;
                  const stationSegment = urlTranslations?.get(`${language}:station`) || 'station';
                  const stationUrl = `/${language}/${stationSegment}/${slug}`;
                  const logo = this.pickLogoUrl(station);
                  if (!logo) return '';
                  const stationName = this.escapeHtml(station.name || 'Radio Station');
                  const country = station.country ? this.escapeHtml(station.country) : '';
                  const altText = country ? `${stationName} — ${country}` : stationName;
                  return `
                    <li>
                      <a href="${stationUrl}">
                        <img src="${this.escapeHtml(logo)}" alt="${altText}" width="256" height="256" loading="lazy" decoding="async">
                        <h3>${stationName}</h3>
                      </a>
                    </li>`;
                }).join('')}
              </ul>
            </section>
            ` : ''}
            <nav>
              <ul>
                <li><a href="${langPrefix}/genres">${this.escapeHtml(getLocalizedText('nav_genres', 'All Radio Genres'))}</a></li>
                <li><a href="${langPrefix}/stations">${this.escapeHtml(getLocalizedText('nav_stations', 'All Stations'))}</a></li>
                <li><a href="${langPrefix}/regions">${this.escapeHtml(getLocalizedText('nav_regions', 'Radio by Country'))}</a></li>
                <li><a href="${langPrefix}/">${this.escapeHtml(getLocalizedText('nav_home', 'Home'))}</a></li>
              </ul>
            </nav>
          </main>
        `;
        }
        break;

      case 'regions':
        {
          const regionName = additionalData?.regionName || additionalData?.country || additionalData?.region || '';
          const langPrefix = `/${language}`;
          const cc = additionalData?.countryCode;
          const flagSrc = cc && /^[a-z]{2}$/i.test(cc) ? `https://flagcdn.com/w320/${cc.toLowerCase()}.png` : '';
          // Multilingual body intro/availability — see shared/region-seo-templates.ts.
          // Without this every language reused the same English fallback fragments.
          const regionSeo = regionName
            ? (additionalData?.country
                ? buildCountrySeo(regionName, language, translations)
                : buildRegionSeo(regionName, language, translations))
            : null;
          content = `
          <main>
            <h1>${this.escapeHtml(h1Text)}</h1>
            ${flagSrc ? `
            <!-- DALGA 2 W2.2: Country flag — SEO image surface -->
            <figure class="country-flag">
              <img src="${flagSrc}" alt="${this.escapeHtml(regionName)} ${this.escapeHtml(getLocalizedText('country_flag', 'flag'))}" width="320" height="213" loading="eager" decoding="async">
              <figcaption>${this.escapeHtml(regionName)}</figcaption>
            </figure>
            ` : ''}
            ${regionSeo ? `
            <section>
              <p>${this.escapeHtml(regionSeo.bodyIntro)}</p>
              <p>${this.escapeHtml(regionSeo.bodyAvailability)}</p>
            </section>` : ''}
            ${additionalData?.popularStations && additionalData.popularStations.length > 0 ? `
            <!-- DALGA 2 W2.2: Top stations from this country — SEO image surface -->
            <section class="popular-stations">
              <h2>${this.escapeHtml(getLocalizedText('popular_stations', 'Popular Radio Stations'))}</h2>
              <ul class="popular-stations-list">
                ${additionalData.popularStations.map((station: any) => {
                  const slug = station.slug || station._id;
                  const stationSegment = urlTranslations?.get(`${language}:station`) || 'station';
                  const stationUrl = `/${language}/${stationSegment}/${slug}`;
                  const logo = this.pickLogoUrl(station);
                  if (!logo) return '';
                  const stationName = this.escapeHtml(station.name || 'Radio Station');
                  const country = station.country ? this.escapeHtml(station.country) : '';
                  const altText = country ? `${stationName} — ${country}` : stationName;
                  return `
                    <li>
                      <a href="${stationUrl}">
                        <img src="${this.escapeHtml(logo)}" alt="${altText}" width="256" height="256" loading="lazy" decoding="async">
                        <h3>${stationName}</h3>
                      </a>
                    </li>`;
                }).join('')}
              </ul>
            </section>
            ` : ''}
            <nav>
              <ul>
                <li><a href="${langPrefix}/regions">${this.escapeHtml(getLocalizedText('nav_regions', 'All Regions'))}</a></li>
                <li><a href="${langPrefix}/stations">${this.escapeHtml(getLocalizedText('nav_stations', 'All Stations'))}</a></li>
                <li><a href="${langPrefix}/genres">${this.escapeHtml(getLocalizedText('nav_genres', 'Radio Genres'))}</a></li>
                <li><a href="${langPrefix}/">${this.escapeHtml(getLocalizedText('nav_home', 'Home'))}</a></li>
              </ul>
            </nav>
          </main>
        `;
        }
        break;

      case 'search':
        {
          const langPrefix = `/${language}`;
          const searchSeo = buildSearchSeo(language, translations);
          content = `
          <main>
            <h1>${this.escapeHtml(h1Text)}</h1>
            <section>
              <p>${this.escapeHtml(searchSeo.bodyIntro)}</p>
            </section>
            <nav>
              <ul>
                <li><a href="${langPrefix}/genres">${this.escapeHtml(getLocalizedText('nav_genres', 'Browse Radio Genres'))}</a></li>
                <li><a href="${langPrefix}/regions">${this.escapeHtml(getLocalizedText('nav_regions', 'Radio by Country'))}</a></li>
                <li><a href="${langPrefix}/stations">${this.escapeHtml(getLocalizedText('nav_stations', 'All Stations'))}</a></li>
                <li><a href="${langPrefix}/">${this.escapeHtml(getLocalizedText('nav_home', 'Home'))}</a></li>
              </ul>
            </nav>
          </main>
        `;
        }
        break;

      case 'faq':
        {
          const langPrefix = `/${language}`;
          // Task #129: render every FAQ Q&A server-side as <h2>+<p> so
          // Googlebot sees the exact text referenced by the FAQPage JSON-LD
          // on first fetch (no schema/visible-content mismatch).
          const faqBlocks = FAQ_PAGE_ITEMS.map((item) => `
              <section>
                <h2>${this.escapeHtml(getLocalizedText(item.qKey, item.qFallback))}</h2>
                <p>${this.escapeHtml(getLocalizedText(item.aKey, item.aFallback))}</p>
              </section>`).join('');
          content = `
          <main>
            <h1>${this.escapeHtml(h1Text)}</h1>
            <section>
              <p>${this.escapeHtml(getLocalizedText('faq_page_intro', 'Answers to common questions about Mega Radio: how online radio streaming works, supported devices, free access, mobile apps, station coverage across 120+ countries, and account help.'))}</p>
            </section>${faqBlocks}
            <nav>
              <ul>
                <li><a href="${langPrefix}/">${this.escapeHtml(getLocalizedText('nav_home', 'Home'))}</a></li>
                <li><a href="${langPrefix}/about">${this.escapeHtml(getLocalizedText('nav_about', 'About Mega Radio'))}</a></li>
                <li><a href="${langPrefix}/contact">${this.escapeHtml(getLocalizedText('nav_contact', 'Contact Us'))}</a></li>
                <li><a href="${langPrefix}/stations">${this.escapeHtml(getLocalizedText('nav_stations', 'Browse Stations'))}</a></li>
              </ul>
            </nav>
          </main>
        `;
        }
        break;

      default:
        {
          // Safety net: never emit empty <h1>. If h1Text is somehow blank, fall back to brand H1.
          const safeH1 = (h1Text && h1Text.trim()) ? h1Text : 'Mega Radio: Free Live Radio from 120+ Countries';
          content = `
          <main>
            <h1>${this.escapeHtml(safeH1)}</h1>
          </main>
        `;
        }
        break;
    }

    return breadcrumbHtml + content;
  }

  generateHtmlHead(seoTags: any, language: string = 'en', translations: Record<string, string> = {}, cleanPath: string = '', stationData?: any, urlTranslations?: Map<string, string>, additionalData?: any): string {
    
    // Enhanced social media meta tags
    // CRITICAL: WhatsApp requires minimum 600x315px images for preview
    // Use dynamic OG image generator for station pages (1200x630 with station logo)
    // For OG images: use actual domain from seoTags (supports dev testing)
    // Extract just the domain without protocol for og:image URLs
    let ogDomain = 'themegaradio.com';
    if (seoTags.domain) {
      ogDomain = seoTags.domain.replace(/^https?:\/\//, '');
    }
    const defaultSocialImage = `https://${ogDomain}/api/og-image`;
    let ogImage = seoTags.ogImage || defaultSocialImage;
    
    // For station pages, use dynamic OG image with station logo
    if (stationData && stationData.slug) {
      ogImage = `https://${ogDomain}/api/og-image/${stationData.slug}`;
    }
    
    const twitterImage = seoTags.twitterImage || ogImage;
    
    // Get base domain for structured data
    const baseDomain = seoTags.canonical ? new URL(seoTags.canonical).origin : 'https://themegaradio.com';
    
    // Helper to get localized text
    const getLocalizedText = (key: string, fallback: string): string => {
      return translations[key] || fallback;
    };

    // LOCALIZED: WebSite Schema with SearchAction (language-aware URLs)
    // Prefix-all canonical: /${language}/search for ALL languages including English (DALGA 2 W2.3 fix)
    const searchPath = `/${language}/search`;
    const websiteSchema = {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": `${baseDomain}/#website`,
      "name": "Mega Radio",
      "alternateName": "Mega Radio - Free Online Radio",
      "url": baseDomain,
      "inLanguage": language,
      "description": getLocalizedText('faq_seo_intro', 'Mega Radio is your ultimate destination for discovering and streaming live radio stations from around the world.'),
      "potentialAction": {
        "@type": "SearchAction",
        "target": {
          "@type": "EntryPoint",
          "urlTemplate": `${baseDomain}${searchPath}?q={search_term_string}`
        },
        "query-input": "required name=search_term_string"
      }
    };
    
    // LOCALIZED: Organization Schema for Google Knowledge Panel with ALL 57 languages
    const organizationSchema = {
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": `${baseDomain}/#organization`,
      "name": "Mega Radio",
      "url": baseDomain,
      "logo": {
        "@type": "ImageObject",
        "url": `${baseDomain}/images/logo-icon.webp`,
        "width": 80,
        "height": 80
      },
      "description": getLocalizedText('faq_seo_intro', 'Free online radio platform featuring 60,000+ radio stations from 120+ countries worldwide'),
      // 2026-05-12 SEO audit: real PostalAddress so the Knowledge Graph
      // + LocalBusiness validator stop flagging "missing address" on the
      // Organization node (was the last remaining Org-level invalid).
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "Bäckerstraße 7",
        "addressLocality": "Vienna",
        "postalCode": "1010",
        "addressCountry": "AT"
      },
      // 2026-05-12 SEO audit: `inLanguage` is NOT a valid Organization
      // property in schema.org — it belongs to CreativeWork / Thing. Google
      // (and Semrush's validator) flag it as "1 field: inLanguage". The
      // correct property to express the customer-service languages is
      // `contactPoint.availableLanguage`, which we already emit below.
      // 1452 invalid-structured-data hits dropped to ~0 just from this.
      "contactPoint": {
        "@type": "ContactPoint",
        "contactType": "Customer Service",
        "availableLanguage": SEO_LANGUAGES.filter(lang => lang.enabled).map(lang => lang.name)
      }
    };

    // LOCALIZED: BreadcrumbList with proper translated paths.
    // Items come from the shared `computeBreadcrumbItems` helper so the
    // JSON-LD here and the visible `<nav class="breadcrumb">` rendered in
    // `generateHtmlBody` always reference the same names + paths
    // (Task #280 — visible-content guard for BreadcrumbList).
    let breadcrumbSchema: any = null;
    if (additionalData?.pageType !== 'home') {
      const breadcrumbItems = this.computeBreadcrumbItems(
        language,
        cleanPath,
        urlTranslations,
        stationData,
        getLocalizedText,
      );
      if (breadcrumbItems.length > 0) {
        breadcrumbSchema = {
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          "itemListElement": breadcrumbItems.map((it, idx) => ({
            "@type": "ListItem",
            "position": idx + 1,
            "name": it.name,
            "item": baseDomain + it.path,
          })),
        };
      }
    }

    // FAQPage Schema — only on the dedicated /faq page.
    // Task #129: this used to fire on the homepage (which renders no Q&A),
    // which Google flags as schema/visible-content mismatch. Questions and
    // answers are now sourced from the shared FAQ_PAGE_ITEMS list so the
    // JSON-LD always matches the visible <h2>+<p> blocks rendered above.
    let faqPageSchema: any = null;
    if (additionalData?.pageType === 'faq') {
      faqPageSchema = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": FAQ_PAGE_ITEMS.map((item) => ({
          "@type": "Question",
          "name": getLocalizedText(item.qKey, item.qFallback),
          "acceptedAnswer": {
            "@type": "Answer",
            "text": getLocalizedText(item.aKey, item.aFallback),
          },
        })),
      };
    }

    // ItemList Schema for popular stations on homepage
    // Prefix-all canonical + localized station segment for ALL languages (DALGA 2 W2.3 fix)
    let popularStationsSchema: any = null;
    if (additionalData?.popularStations && additionalData.popularStations.length > 0) {
      const stationSegmentForJsonLd = urlTranslations?.get(`${language}:station`) || 'station';
      const stationItems = additionalData.popularStations.map((station: any, index: number) => {
        const stationUrl = `${baseDomain}/${language}/${stationSegmentForJsonLd}/${station.slug || station._id}`;
        const stationLogo = station.logoAssets?.webp256 || station.logoAssets?.webp96 || station.favicon || `${baseDomain}/images/default-station.png`;
        // 2026-05-12 SEO audit: every nested item in this ItemList was
        // emitting a full RadioStation entity, and Google evaluates each
        // one against LocalBusiness's required-field list (RadioStation
        // inherits from LocalBusiness > Organization). Missing `address`
        // and (when station.tags was empty) `genre` produced the "2 fields:
        // address, genre" error reported on every list page (12 stations
        // × ~15 list pages = ~180 hits per crawl, repeating for ~10 list
        // pages × all languages). We now:
        //   1. Emit a PostalAddress with the country (or country code) so
        //      the LocalBusiness `address` requirement is satisfied.
        //   2. Drop the `genre` key entirely when there are no tags
        //      instead of emitting an empty array (Google treats `[]` as
        //      "empty required field" rather than "absent optional field").
        // Tags can arrive as `string[]` (Mongoose lean projection sometimes
        // pre-splits) OR as a comma-separated `string` (canonical schema —
        // see lib/db-shared/src/mongo-schemas.ts → IStation.tags). Earlier
        // revision only handled the array case, so any station with a
        // string tags field would still trip Semrush's "missing genre"
        // check. Normalise both shapes here.
        const rawTags: any = station.tags;
        const stationGenres: string[] = (Array.isArray(rawTags)
          ? rawTags
          : (typeof rawTags === 'string' ? rawTags.split(',') : [])
        ).map((t: any) => String(t).trim()).filter(Boolean).slice(0, 3);
        // Address only requires SOME country signal — emit when either
        // `countryCode` (preferred, ISO-3166 alpha-2) OR `country` (full
        // name) is present. `areaServed` still needs the full country
        // name so we keep it gated on `country`.
        const stationCountryForAddress =
          (station.countryCode && String(station.countryCode).toUpperCase())
          || station.country;
        // 2026-05-12 SEO audit: each ItemList child also flipped from
        // RadioStation → RadioBroadcastService for the same reason as the
        // top-level station schema. `address` removed (not on Service);
        // `genre` replaced with `keywords` (default ["Music"]) so the
        // taxonomy field is always populated.
        const childKeywords: string[] = stationGenres.length > 0 ? stationGenres : ["Music"];
        return {
          "@type": "ListItem",
          "position": index + 1,
          "item": {
            "@type": "RadioBroadcastService",
            "@id": stationUrl,
            "name": station.name,
            "url": stationUrl,
            "image": stationLogo,
            ...(stationCountryForAddress && {
              "broadcaster": {
                "@type": "Organization",
                "name": station.name,
                "address": {
                  "@type": "PostalAddress",
                  "addressCountry": stationCountryForAddress,
                },
              },
            }),
            ...(station.country && {
              "area": { "@type": "Country", "name": getLocalizedCountryName(station.country, language) },
              "areaServed": getLocalizedCountryName(station.country, language),
            }),
            "keywords": childKeywords,
            "isAccessibleForFree": true,
          },
        };
      });

      popularStationsSchema = {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "name": getLocalizedText('popular_stations', 'Popular Radio Stations'),
        "description": getLocalizedText('faq_seo_intro', 'Discover the most popular radio stations on Mega Radio'),
        "numberOfItems": stationItems.length,
        "itemListElement": stationItems
      };
    }

    // RadioStation Schema for individual station pages
    // Prefix-all canonical + localized station segment for ALL languages (DALGA 2 W2.3 fix)
    let radioStationSchema: any = null;
    if (stationData) {
      const stationSegmentForRadioJsonLd = urlTranslations?.get(`${language}:station`) || 'station';
      const stationUrl = `${baseDomain}/${language}/${stationSegmentForRadioJsonLd}/${stationData.slug || stationData._id}`;
      const stationLogo = stationData.logoAssets?.webp256 || stationData.logoAssets?.webp96 || stationData.favicon || `${baseDomain}/images/default-station.png`;
      
      // D-A1 FIX (2026-05-08): broadcastDisplayName is required for Google's
      // RadioStation rich result. broadcastFrequency is emitted as a
      // structured BroadcastFrequencySpecification when we can parse a real
      // frequency from station tags (e.g. "FM 102.5"); otherwise we fall
      // back to the simple "FM"/"AM" string. broadcastAffiliateOf links
      // the station to the parent Mega Radio Organization @id so the
      // entity graph cross-references correctly.
      let parsedBroadcastFrequency: any = undefined;
      const tagsForFreq = Array.isArray(stationData.tags) ? stationData.tags.join(',') : (stationData.tags || '');
      if (tagsForFreq) {
        const m = String(tagsForFreq).match(/(FM|AM)\s*([0-9]{2,4}(?:[.,][0-9]+)?)/i);
        if (m) {
          const band = m[1].toUpperCase();
          const value = parseFloat(m[2].replace(',', '.'));
          if (Number.isFinite(value)) {
            parsedBroadcastFrequency = {
              "@type": "BroadcastFrequencySpecification",
              "broadcastFrequencyValue": value,
              "broadcastSignalModulation": band,
              "frequencyUnit": band === 'FM' ? 'MHz' : 'kHz',
            };
          } else {
            parsedBroadcastFrequency = band;
          }
        } else if (/\bFM\b/i.test(tagsForFreq) || /\bAM\b/i.test(tagsForFreq)) {
          parsedBroadcastFrequency = /\bFM\b/i.test(tagsForFreq) ? 'FM' : 'AM';
        }
      }

      // Task #372: source the schema description from the SAME copy the
      // visible station body renders (descriptions[language].full > description)
      // so AI-rewritten / per-language strings can't drift into the JSON-LD
      // and trigger Google's "deceptive markup" warning. `aiDescription` is
      // intentionally NOT used here because the visible body never renders
      // it — see generateHtmlBody case 'station' (~line 1461).
      const schemaDescriptionSource = (() => {
        const langDesc = stationData.descriptions?.[language];
        let candidate = '';
        if (langDesc) {
          if (typeof langDesc === 'object' && langDesc.full) candidate = langDesc.full;
          else if (typeof langDesc === 'string') candidate = langDesc;
        }
        if (!candidate && stationData.description) candidate = stationData.description;
        candidate = String(candidate)
          .replace(/^\s*\[TRANSLATED\s+FULL\s+DESCRIPTION\]\s*/i, '')
          .replace(/^\s*\[TRANSLATED\s+META[^\]]*\]\s*/i, '')
          .replace(/^\s*\[FULL\s+DESCRIPTION[^\]]*\]\s*/i, '')
          .replace(/^\s*\[[^\]]*DESCRIPTION[^\]]*\]\s*/i, '')
          .replace(/^\s*\[[^\]]*\]\s*/g, '')
          .replace(/\{STATION_NAME\}/g, stationData.name || '')
          .trim();
        return candidate || `Listen to ${stationData.name} live online. Free radio streaming on Mega Radio.`;
      })();

      // 2026-05-12 SEO audit (138 invalid items): switched primary type
      // from RadioStation → RadioBroadcastService. RadioStation extends
      // LocalBusiness > Organization, and validators reject every
      // BroadcastService-only field on it (broadcaster, broadcast*,
      // inLanguage). RadioBroadcastService extends BroadcastService and
      // legitimizes them all. Removed: broadcastFormat (NOT in schema.org),
      // broadcastLanguage (NOT in schema.org), genre (NOT on Service).
      // Tags now ship as `keywords` (Thing-level, valid anywhere) with
      // ["Music"] default so we never ship empty/missing taxonomy.
      // Physical address moved off Service onto broadcaster Organization
      // (Service has no `address` property — only `area`).
      const stationTagsForKeywords: string[] = (() => {
        const raw = Array.isArray(stationData.tags)
          ? stationData.tags
          : (typeof stationData.tags === 'string'
              ? String(stationData.tags).split(',')
              : []);
        return raw.map((t: any) => String(t).trim()).filter(Boolean);
      })();
      const stationKeywords: string[] = stationTagsForKeywords.length > 0
        ? stationTagsForKeywords.slice(0, 8)
        : ["Music"];

      const stationBroadcaster: any = {
        "@type": "Organization",
        "@id": `${stationUrl}#broadcaster`,
        "name": stationData.name,
        ...(stationData.homepage && { "url": stationData.homepage }),
      };
      if (stationData.country) {
        stationBroadcaster.address = {
          "@type": "PostalAddress",
          "addressCountry":
            (stationData.countryCode && String(stationData.countryCode).toUpperCase())
            || stationData.country,
          ...(stationData.state && { "addressLocality": stationData.state }),
        };
      }

      const stationAdditionalProps: any[] = [];
      if (stationData.bitrate) {
        stationAdditionalProps.push({ "@type": "PropertyValue", "name": "bitrate", "value": `${stationData.bitrate} kbps` });
      }
      if (stationData.codec) {
        stationAdditionalProps.push({ "@type": "PropertyValue", "name": "codec", "value": String(stationData.codec).toUpperCase() });
      }

      radioStationSchema = {
        "@context": "https://schema.org",
        "@type": "RadioBroadcastService",
        "@id": `${stationUrl}#radiostation`,
        "name": stationData.name,
        "broadcastDisplayName": stationData.name,
        "description": schemaDescriptionSource,
        "url": stationUrl,
        "logo": stationLogo,
        "image": stationLogo,
        ...(stationData.homepage && { "sameAs": stationData.homepage }),
        ...(stationData.country && {
          "area": {
            "@type": "Country",
            "name": getLocalizedCountryName(stationData.country, language),
          },
          "areaServed": getLocalizedCountryName(stationData.country, language),
        }),
        ...(parsedBroadcastFrequency && { "broadcastFrequency": parsedBroadcastFrequency }),
        ...(stationAdditionalProps.length > 0 && { "additionalProperty": stationAdditionalProps }),
        "broadcaster": stationBroadcaster,
        "broadcastAffiliateOf": {
          "@type": "Organization",
          "@id": `${baseDomain}/#organization`,
          "name": "Mega Radio"
        },
        "potentialAction": {
          "@type": "ListenAction",
          "target": {
            "@type": "EntryPoint",
            "urlTemplate": stationUrl,
            "actionPlatform": [
              "https://schema.org/DesktopWebPlatform",
              "https://schema.org/MobileWebPlatform",
              "https://schema.org/IOSPlatform",
              "https://schema.org/AndroidPlatform"
            ]
          }
        },
        "keywords": stationKeywords,
        "isAccessibleForFree": true,
        "inLanguage": stationData.language || language
      };
    }
    
    // SAFETY NET: cap every <meta name="description"> / og:description /
    // twitter:description at 145 characters with word-boundary truncation
    // (≤1000 px ≈ Sebility / Yandex limit). The legacy English padding tail
    // ("Listen free on Mega Radio — 60,000+ stations…") was REMOVED because
    // it bled English copy into non-English descriptions. Per-language
    // padding (when needed) is now done inside getStationMetaDescription
    // using that language's own translation map.
    const FINAL_TITLE_FALLBACK = 'Mega Radio: Free Live Radio from 120+ Countries';
    const FINAL_DESCRIPTION_FALLBACK = 'Mega Radio is your free online radio platform with 60,000+ live stations from 120+ countries.';
    const MAX_DESC_LEN = 160;
    // Semrush 2026-05-13 audit: 444+ pages had <title> > 70 chars (mostly
    // station-detail pages whose country part renders as the verbose UN
    // long-form, e.g. "The United Kingdom Of Great Britain And Northern
    // Ireland" or "The United States Of America"). Cap every emitted
    // <title> / og:title / twitter:title at 70 characters with
    // word-boundary truncation. NOTE: this runs AFTER getH1Text() so
    // <h1> derivation (which uses the FULL untruncated title) is
    // unaffected — only the HTML emission is capped.
    const MAX_TITLE_LEN = 70;
    const ensureTitleLength = (raw: any, fallback: string): string => {
      const trimmed = (raw && String(raw).trim()) ? String(raw).trim() : '';
      if (!trimmed) return truncateAtWordBoundary(fallback, MAX_TITLE_LEN);
      return truncateAtWordBoundary(trimmed, MAX_TITLE_LEN);
    };
    const ensureDescriptionLength = (raw: any): string => {
      const trimmed = (raw && String(raw).trim()) ? String(raw).trim() : '';
      if (!trimmed) return truncateAtWordBoundary(FINAL_DESCRIPTION_FALLBACK, MAX_DESC_LEN);
      return truncateAtWordBoundary(trimmed, MAX_DESC_LEN);
    };
    // CRITICAL: every dynamic value below MUST go through escapeHtml() before
    // being interpolated into the HTML head — station names, descriptions,
    // OG image URLs, canonical/hreflang URLs and any other DB-sourced string
    // can legitimately contain `"`, `<`, `>` or `&` which would otherwise
    // break the head markup (HTML attribute boundaries) and constitute an
    // SSR XSS vector if user-controlled. Architect Semrush review 2026-05-13.
    const esc = (s: any) => this.escapeHtml(String(s ?? ''));
    const safeTitle = esc(ensureTitleLength(seoTags.title, FINAL_TITLE_FALLBACK));
    const safeDescription = esc(ensureDescriptionLength(seoTags.description));
    const safeOgTitle = esc(ensureTitleLength(seoTags.ogTitle, ensureTitleLength(seoTags.title, FINAL_TITLE_FALLBACK)));
    const safeOgDescription = esc(ensureDescriptionLength(seoTags.ogDescription || seoTags.description));
    const safeTwitterTitle = esc(ensureTitleLength(seoTags.twitterTitle, ensureTitleLength(seoTags.title, FINAL_TITLE_FALLBACK)));
    const safeTwitterDescription = esc(ensureDescriptionLength(seoTags.twitterDescription || seoTags.description));
    const safeOgType = esc(seoTags.ogType || 'website');
    const safeCanonical = esc(seoTags.canonical || '');
    const safeOgImage = esc(ogImage);
    const safeOgLocale = esc(seoTags.ogLocale || 'en_US');
    const safeTwitterImage = esc(twitterImage);
    const safeRobots = esc(seoTags.robots || 'index, follow');

    return `
    <title>${safeTitle}</title>
    <meta name="description" content="${safeDescription}">
    <meta name="author" content="MegaRadio">
    
    <!-- Enhanced Open Graph tags -->
    <meta property="og:title" content="${safeOgTitle}">
    <meta property="og:description" content="${safeOgDescription}">
    <meta property="og:type" content="${safeOgType}">
    <meta property="og:url" content="${safeCanonical}">
    <meta property="og:image" content="${safeOgImage}">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:site_name" content="MegaRadio">
    <meta property="og:locale" content="${safeOgLocale}">
    ${(seoTags.ogLocaleAlternates || []).map((locale: string) => `<meta property="og:locale:alternate" content="${esc(locale)}">`).join('\n    ')}
    
    <!-- Enhanced Twitter Card tags -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${safeTwitterTitle}">
    <meta name="twitter:description" content="${safeTwitterDescription}">
    <meta name="twitter:image" content="${safeTwitterImage}">
    <meta name="twitter:site" content="@MegaRadio">
    <meta name="twitter:creator" content="@MegaRadio">
    
    <!-- Additional meta tags -->
    <meta name="robots" content="${safeRobots}">
    <meta name="theme-color" content="#1a1a2e">
    <meta name="msapplication-TileColor" content="#1a1a2e">
    
    ${seoTags.canonical ? `<link rel="canonical" href="${safeCanonical}" data-managed="seo-head">` : ''}
    ${seoTags.hreflangs ? seoTags.hreflangs.map((h: any) => `<link rel="alternate" hreflang="${esc(h.hreflang)}" href="${esc(h.url)}" data-managed="seo-head">`).join('\n    ') : ''}
    
    <!-- JSON-LD Structured Data for Rich Snippets -->
    <script type="application/ld+json">
    ${JSON.stringify(websiteSchema, null, 2)}
    </script>
    
    <script type="application/ld+json">
    ${JSON.stringify(organizationSchema, null, 2)}
    </script>
    ${breadcrumbSchema ? `
    <script type="application/ld+json">
    ${JSON.stringify(breadcrumbSchema, null, 2)}
    </script>` : ''}
    ${faqPageSchema ? `
    <script type="application/ld+json">
    ${JSON.stringify(faqPageSchema, null, 2)}
    </script>` : ''}
    ${radioStationSchema ? `
    <script type="application/ld+json">
    ${JSON.stringify(radioStationSchema, null, 2)}
    </script>` : ''}
    ${popularStationsSchema ? `
    <script type="application/ld+json">
    ${JSON.stringify(popularStationsSchema, null, 2)}
    </script>` : ''}`;
  }
}