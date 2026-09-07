/**
 * /llms.txt body builder (architect P0 — GEO ingestion expansion).
 *
 * Output follows the llmstxt.org spec: a single H1, an optional short prose
 * intro, then markdown sections of bullet links the LLM crawler can follow
 * to ingest the most important content surfaces.
 *
 * What we expose (and why):
 *   1. About paragraph — gives ChatGPT/Perplexity/Claude a one-sentence
 *      grounding fact about MegaRadio (what, scale, free, multilingual).
 *      Without this they synthesize the description from the homepage HTML
 *      and often hallucinate a paywall / app-only product.
 *   2. Sitemaps — pointer to the canonical sitemap-index so robots.txt
 *      respecting bots can crawl ALL ~60k stations from one entry point.
 *   3. Per-language entry points — qualified languages only (>=50% UI
 *      translated, surfaced via getCachedQualifiedLanguages). Capped at
 *      one bullet per language pointing at /<lang>/radios so the bot
 *      discovers localized listings without us advertising every language
 *      variant of every page (which would explode the file).
 *   4. Top countries (≤30) — pulled from the active `main` sitemap manifest,
 *      same source the sitemap top-30 list uses, so freshness is
 *      consistent. Without these the bot only finds countries it already
 *      knows; with them it can prefer canonical region/country URLs over
 *      raw query strings.
 *   5. Top genres (≤20) — pulled from a 6h-cached aggregation of stations
 *      grouped by tag, intersected with the genre whitelist (so we only
 *      advertise genre slugs we already SSR-render with proper templates).
 *   6. Static key sections — about/faq/contact/privacy/terms/applications.
 *
 * Caching: the assembled body is per-baseUrl memoized for 6 hours. Both
 * /llms.txt handlers (early in index-web.ts and the canonical one in
 * routes/seo-sitemap-routes.ts) call this single helper so the bytes are
 * identical no matter which route serves the request.
 *
 * Cold/stale reads never wait for optional PostgreSQL aggregations. They
 * return the core guide/last good body while one shared refresh enriches it.
 * Failed sources are omitted, never replaced with invented ranked links.
 */

import { pgTopIndexableTags } from '../data/postgres-seo-indexing-store';
import { URL_TRANSLATIONS } from '@workspace/seo-shared/url-translations';
import { ACTIVE_SITEMAP_LANGUAGES } from '@workspace/seo-shared/seo-config';
import { getActiveManifest, extractTopCountriesFromChunk } from './sitemap-manifest-builder';
import { getCachedQualifiedLanguages } from './qualified-languages';
import { GENRE_WHITELIST_SEED } from './genre-whitelist-seed';
import { logger } from '../utils/logger';

const TTL_MS = 6 * 60 * 60 * 1000;
const RETRY_MS = 60 * 1000;
const COUNTRY_CAP = 30;
const GENRE_CAP = 20;
const LANG_CAP = 30;

interface CacheEntry {
  body: string;
  expiresAt: number;
}
const _cache = new Map<string, CacheEntry>();
const _refreshes = new Map<string, Promise<void>>();
let cacheGeneration = 0;

async function fetchTopGenres(): Promise<string[]> {
  const rows = await pgTopIndexableTags(GENRE_CAP * 5);
  return rows
    .map((r) => String(r._id || '').replace(/\s+/g, '-'))
    .filter((slug) => slug && GENRE_WHITELIST_SEED.has(slug))
    .slice(0, GENRE_CAP);
}

async function fetchTopCountries(): Promise<Array<{ region: string; country: string }>> {
  const main = await getActiveManifest('main', 'en');
  if (!main || !main.chunks?.length) return [];
  const entries = extractTopCountriesFromChunk(main.chunks[0].stationIds || []);
  return entries.slice(0, COUNTRY_CAP).map((e) => ({
    region: e.regionSlug,
    country: e.countrySlug,
  }));
}

async function fetchQualifiedLanguages(): Promise<string[]> {
  const langs = await getCachedQualifiedLanguages();
  return Array.isArray(langs)
    ? langs.filter(lang => ACTIVE_SITEMAP_LANGUAGES.some(active => active === lang)).slice(0, LANG_CAP)
    : ['en'];
}

export async function buildLlmsTxtBody(baseUrl: string): Promise<string> {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const cached = _cache.get(cleanBase);
  if (cached && Date.now() < cached.expiresAt) return cached.body;

  if (!_refreshes.has(cleanBase)) {
    const generation = cacheGeneration;
    const refresh = Promise.allSettled([
      fetchTopCountries(), fetchTopGenres(), fetchQualifiedLanguages(),
    ]).then(([countries, genres, languages]) => {
      if (generation !== cacheGeneration) return;
      const failed = [countries, genres, languages].some(result => result.status === 'rejected');
      if (failed) logger.warn('llms-txt: optional discovery refresh unavailable; retaining the last guide or verified core links');
      // A transient refresh failure must not discard a previously complete
      // guide or present an arbitrary whitelist sample as a measured top list.
      const body = failed && cached ? cached.body : renderLlmsTxtBody(cleanBase,
        countries.status === 'fulfilled' ? countries.value : [],
        genres.status === 'fulfilled' ? genres.value : [],
        languages.status === 'fulfilled' ? languages.value : ['en']);
      _cache.set(cleanBase, { body, expiresAt: Date.now() + (failed ? RETRY_MS : TTL_MS) });
    }).catch(() => {
      logger.warn('llms-txt: optional discovery refresh failed; core guide remains available');
    }).finally(() => {
      if (_refreshes.get(cleanBase) === refresh) _refreshes.delete(cleanBase);
    });
    _refreshes.set(cleanBase, refresh);
  }

  return cached?.body || renderLlmsTxtBody(cleanBase, [], [], ['en']);
}

function renderLlmsTxtBody(cleanBase: string, topCountries: Array<{ region: string; country: string }>,
  topGenres: string[], qualifiedLangs: string[]): string {

  // Always-present minimal sections come first so even if every async
  // source returned [] we still emit a valid llms.txt (the byte-identical
  // contract with the historical handler is preserved).
  const lines: string[] = [];
  lines.push('# MegaRadio');
  lines.push('');
  lines.push(
    `> MegaRadio is a global directory of FM/AM and internet radio stations. Browse localized directories in ${ACTIVE_SITEMAP_LANGUAGES.length} supported languages and listen to station streams in the browser.`,
  );
  lines.push('');
  lines.push(
    'MegaRadio indexes stations from the Radio-Browser open database, with station descriptions and genre tags. Stream availability depends on the broadcaster.',
  );
  lines.push('');

  lines.push('## Browse');
  lines.push(`- [All Stations](${cleanBase}/en/stations): Full directory of radio stations by country`);
  lines.push(`- [Genres](${cleanBase}/en/genres): Browse stations by music genre or format`);
  lines.push(`- [Popular Stations](${cleanBase}/en): Popular stations on the homepage`);
  lines.push(`- [Countries & Regions](${cleanBase}/en/regions): Station index by country and continent`);
  lines.push('');

  lines.push('## Developer API');
  lines.push(`- [API Documentation](${cleanBase}/api-docs): REST API for station metadata, stream URLs, genre listings, and country data`);
  lines.push(`- [API Registration](${cleanBase}/api-user): API account registration and access information`);
  lines.push('');

  lines.push('## Data & Discovery');
  lines.push(`- [Sitemap Index](${cleanBase}/sitemap-index.xml): Published station, genre, country, and localized page URLs`);
  lines.push(`- [robots.txt](${cleanBase}/robots.txt): Crawl rules`);
  lines.push('');

  lines.push('## About');
  lines.push(`- [About MegaRadio](${cleanBase}/en/about)`);
  lines.push(`- [FAQ](${cleanBase}/en/faq)`);
  lines.push(`- [Privacy Policy](${cleanBase}/en/privacy-policy)`);
  lines.push(`- [Terms of Service](${cleanBase}/en/terms-and-conditions)`);
  lines.push(`- [Contact](${cleanBase}/en/contact)`);
  lines.push(`- [Apps](${cleanBase}/en/applications)`);
  lines.push('');

  if (qualifiedLangs.length > 1) {
    lines.push('## Localized entry points');
    for (const lang of qualifiedLangs) {
      if (lang === 'en') continue;
      const stationsSlug = URL_TRANSLATIONS[lang]?.stations || 'stations';
      lines.push(`- [Stations in ${lang.toUpperCase()}](${cleanBase}/${lang}/${stationsSlug})`);
    }
    lines.push('');
  }

  if (topCountries.length > 0) {
    lines.push('## Optional');
    lines.push('');
    lines.push('Top country directories:');
    lines.push('');
    for (const { region, country } of topCountries) {
      lines.push(`- [${country}](${cleanBase}/en/regions/${region}/${country})`);
    }
    lines.push('');
  }

  if (topGenres.length > 0) {
    lines.push('Top genre directories:');
    lines.push('');
    for (const slug of topGenres) {
      lines.push(`- [${slug}](${cleanBase}/en/genres/${slug})`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function clearLlmsTxtCache(): void {
  _cache.clear();
  _refreshes.clear();
  cacheGeneration++;
}
