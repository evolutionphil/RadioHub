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
 * Failure mode: every data source is wrapped in try/catch and falls back
 * to the previous minimal body so a Mongo blip can never 500 /llms.txt.
 */

import { pgTopIndexableTags } from '../data/postgres-seo-indexing-store';
import { URL_TRANSLATIONS } from '@workspace/seo-shared/url-translations';
import { getActiveManifest, extractTopCountriesFromChunk } from './sitemap-manifest-builder';
import { getCachedQualifiedLanguages } from './qualified-languages';
import { GENRE_WHITELIST_SEED } from './genre-whitelist-seed';
import { logger } from '../utils/logger';

const TTL_MS = 6 * 60 * 60 * 1000;
const COUNTRY_CAP = 30;
const GENRE_CAP = 20;
const LANG_CAP = 30;

interface CacheEntry {
  body: string;
  expiresAt: number;
}
const _cache = new Map<string, CacheEntry>();

let _topGenresCache: { slugs: string[]; expiresAt: number } | null = null;

async function fetchTopGenres(): Promise<string[]> {
  if (_topGenresCache && Date.now() < _topGenresCache.expiresAt) {
    return _topGenresCache.slugs;
  }
  try {
    // Group indexable stations by their first tag, count, sort, intersect
    // with the SEO genre whitelist, take the top GENRE_CAP. Mirrors the
    // junk/noIndex filter used by the main-manifest top-country aggregation
    // (sitemap-manifest-builder.ts:553) so the leaderboards align.
    // .allowDiskUse(true) is REQUIRED — see replit.md "MongoDB aggregation
    // memory limits" landmine note.
    const rows = await pgTopIndexableTags(GENRE_CAP * 5);

    const whitelisted = rows
      .map((r) => String(r._id || '').replace(/\s+/g, '-'))
      .filter((slug) => slug && GENRE_WHITELIST_SEED.has(slug))
      .slice(0, GENRE_CAP);

    _topGenresCache = { slugs: whitelisted, expiresAt: Date.now() + TTL_MS };
    return whitelisted;
  } catch (err: any) {
    logger.warn(`llms-txt: top-genres aggregation failed (${err?.message || err}); falling back to whitelist seed sample`);
    // Deterministic fallback: take the first GENRE_CAP slugs from the seed
    // in iteration order so the file still lists SOMETHING.
    return Array.from(GENRE_WHITELIST_SEED).slice(0, GENRE_CAP);
  }
}

async function fetchTopCountries(): Promise<Array<{ region: string; country: string }>> {
  try {
    const main = await getActiveManifest('main', 'en');
    if (!main || !main.chunks?.length) return [];
    const chunk = main.chunks[0];
    const entries = extractTopCountriesFromChunk(chunk.stationIds || []);
    // entries are already ordered by the manifest builder's leaderboard.
    return entries.slice(0, COUNTRY_CAP).map((e) => ({
      region: e.regionSlug,
      country: e.countrySlug,
    }));
  } catch (err: any) {
    logger.warn(`llms-txt: top-countries lookup failed (${err?.message || err})`);
    return [];
  }
}

async function fetchQualifiedLanguagesSafe(): Promise<string[]> {
  try {
    const langs = await getCachedQualifiedLanguages();
    return Array.isArray(langs) ? langs.slice(0, LANG_CAP) : ['en'];
  } catch {
    return ['en'];
  }
}

export async function buildLlmsTxtBody(baseUrl: string): Promise<string> {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const cached = _cache.get(cleanBase);
  if (cached && Date.now() < cached.expiresAt) return cached.body;

  const [topCountries, topGenres, qualifiedLangs] = await Promise.all([
    fetchTopCountries(),
    fetchTopGenres(),
    fetchQualifiedLanguagesSafe(),
  ]);

  // Always-present minimal sections come first so even if every async
  // source returned [] we still emit a valid llms.txt (the byte-identical
  // contract with the historical handler is preserved).
  const lines: string[] = [];
  lines.push('# MegaRadio');
  lines.push('');
  lines.push(
    '> MegaRadio is a free global radio streaming directory with 43,000+ live FM/AM and internet radio stations from 150+ countries, available in 57 languages. Stream any station directly in the browser with no signup required. Available on iOS, Android, Samsung TV, LG TV, and Apple TV.',
  );
  lines.push('');
  lines.push(
    'MegaRadio indexes stations from the Radio-Browser open database, augmented with AI-generated descriptions, verified stream URLs, and genre tagging. Station data is updated daily.',
  );
  lines.push('');

  lines.push('## Browse');
  lines.push(`- [All Stations](${cleanBase}/en/stations): Full directory of radio stations by country`);
  lines.push(`- [Genres](${cleanBase}/en/genres): Browse stations by music genre or format`);
  lines.push(`- [Top 100 Global](${cleanBase}/en/popular): Most-listened stations worldwide`);
  lines.push(`- [Countries & Regions](${cleanBase}/en/regions): Station index by country and continent`);
  lines.push('');

  lines.push('## Developer API');
  lines.push(`- [API Documentation](${cleanBase}/api-docs): REST API for station metadata, stream URLs, genre listings, and country data`);
  lines.push(`- [API Registration](${cleanBase}/api-user): Register for a free API key (free tier: 1,000 requests/day)`);
  lines.push('');

  lines.push('## Data & Discovery');
  lines.push(`- [Sitemap Index](${cleanBase}/sitemap-index.xml): Full URL sitemap covering all stations, genres, and country pages in 57 languages`);
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

  const body = lines.join('\n');
  _cache.set(cleanBase, { body, expiresAt: Date.now() + TTL_MS });
  return body;
}

export function clearLlmsTxtCache(): void {
  _cache.clear();
  _topGenresCache = null;
}
