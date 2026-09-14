import { pgGscIndexabilityGroups, pgGscStationChecks } from '../data/postgres-gsc-store';
import { pgSeoGenres } from '../data/postgres-seo-indexing-store';
import { getCachedQualifiedLanguages } from './qualified-languages';
import { computeGscServerIndexability, extractGscSlug } from './gsc-indexability';

const CACHE_MS = 5 * 60_000;
let cached: { version: string; expiresAt: number; value: Awaited<ReturnType<typeof buildReport>> } | undefined;
let pending: { version: string; promise: ReturnType<typeof buildReport> } | undefined;
let failure: { version: string; retryAt: number; error: unknown } | undefined;

export function invalidateGscIndexabilityReport(): void { cached = undefined; pending = undefined; failure = undefined; }

/** Single-flight, bounded catalog scan shared by the breakdown and URL filters.
 * Only scalar eligibility metadata crosses the database connection. */
export async function getGscIndexabilityReport(version = '') {
  if (cached?.version === version && cached.expiresAt > Date.now()) return cached.value;
  if (pending?.version === version) return pending.promise;
  if (failure?.version === version && failure.retryAt > Date.now()) throw failure.error;
  const promise = buildReport();
  const flight = { version, promise };
  pending = flight;
  try {
    const value = await promise;
    if (pending === flight) cached = { version, value, expiresAt: Date.now() + CACHE_MS };
    return value;
  } catch (error) {
    if (pending === flight) failure = { version, error, retryAt: Date.now() + 10_000 };
    throw error;
  } finally { if (pending === flight) pending = undefined; }
}

async function buildReport() {
  const [qualifiedLanguages, genres, groups] = await Promise.all([
    getCachedQualifiedLanguages(), pgSeoGenres(), pgGscIndexabilityGroups(),
  ]);
  const genreBySlug = new Map(genres.map((genre: any) => [genre.slug, genre]));
  const breakdown = { langRedirected: 0, numericSlug: 0, stationNoIndex: 0,
    junk: 0, genreNotWhitelisted: 0, genreThin: 0, unknown: 0, indexable: 0 };
  const byLanguage: Record<string, { total: number; qualified: boolean; redirected: number }> = {};
  const noindexKeys: string[] = [];
  const nonIndexableKeys: string[] = [];
  let total = 0;
  let checkedStationUrls = 0;
  let nextOffset = 0;
  // Four readers avoid ~100 sequential network round trips without flooding the pool.
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (nextOffset < groups.length) {
      const offset = nextOffset;
      nextOffset += 500;
      const rows = groups.slice(offset, offset + 500);
      const slugs = [...new Set<string>(rows.filter(row => row.group === 'station')
        .map(row => extractGscSlug(row.url)).filter((slug): slug is string => Boolean(slug)))];
      const stations = new Map((await pgGscStationChecks(slugs)).map(station => [station.slug, station]));
      for (const row of rows) {
        for (const { language: lang, count } of row.languages) {
          total += count;
          if (row.group === 'station') checkedStationUrls += count;
          const language = byLanguage[lang] ??= { total: 0, qualified: qualifiedLanguages.includes(lang), redirected: 0 };
          language.total += count;
          const decision = computeGscServerIndexability({ ...row, language: lang }, qualifiedLanguages, stations, genreBySlug);
          const key = `${row.group}\n${lang}\n${row.slug}`;
          if (decision.noindex) noindexKeys.push(key);
          if (decision.noindex || decision.redirected || decision.unknown) nonIndexableKeys.push(key);
          if (decision.redirected) { breakdown.langRedirected += count; language.redirected += count; }
          else if (decision.unknown) breakdown.unknown += count;
          else if (decision.noindex && decision.reason) breakdown[decision.reason] += count;
          else breakdown.indexable += count;
        }
      }
    }
  }));
  return {
    noindexKeys, nonIndexableKeys,
    report: {
      generatedAt: new Date().toISOString(), cacheMaxAgeSeconds: CACHE_MS / 1000,
      total, breakdown,
      serverNoindexTotal: breakdown.numericSlug + breakdown.stationNoIndex + breakdown.junk + breakdown.genreNotWhitelisted + breakdown.genreThin,
      qualifiedLanguageCount: qualifiedLanguages.length,
      totalLanguagesInCache: Object.keys(byLanguage).length,
      qualifiedLanguages: [...qualifiedLanguages].sort(),
      byLanguage: Object.entries(byLanguage).map(([language, info]) => ({ language, ...info }))
        .sort((a, b) => b.redirected - a.redirected || b.total - a.total),
      sampledStationUrls: checkedStationUrls, checkedStationUrls,
    },
  };
}
