/**
 * Task #158: in-memory slug existence sets for the slug-shape-404
 * middleware. Loaded once at startup (background) and refreshed on a
 * timer. Used to convert "shape-valid but DB-unknown" SEO URLs into a
 * fast HTTP 404 for non-bot visitors without doing per-request Mongo
 * lookups on the hot path.
 *
 * The sets are intentionally stored as plain `Set<string>` so lookup
 * cost is O(1). Both canonical slugs and slug aliases are included so a
 * legitimate alias URL still passes the existence gate (the SSR layer
 * will then 301 it to the canonical form).
 *
 * Task #269: extended with country + city slug sets so the same
 * shape-valid-but-DB-unknown short-circuit covers the regions/country/
 * city families. Country slugs are derived from the Country collection
 * + every distinct station.country value (canonicalized via
 * `canonicalizeCountry` and slugified to match URL conventions).
 * City slugs are computed per-country via PrecomputedCitiesService —
 * the same source of truth used to render the country → cities listing
 * pages, so a city URL is "valid" iff the cities page actually shows it.
 *
 * Task #363: countries outside the ~20 hardcoded in `COUNTRY_CITIES`
 * (e.g. Albania, Egypt, Argentina) have no precomputed city set, which
 * meant `hasCityDataForCountry` returned false for them and the
 * shape-404 gate skipped city existence checks entirely — so unknown
 * city URLs in those countries still served HTTP 200. We now backfill
 * those countries from a single aggregation over distinct
 * (station.country, station.state) pairs so any state value attached
 * to ≥1 station counts as a "known" city for that country. This stays
 * O(1) per request (the aggregation runs in the existing 6h refresh,
 * not on the hot path).
 */

import { Station, Genre, Country } from '@workspace/db-shared/mongo-schemas';
import {
  COUNTRY_TO_REGION_SLUG,
  canonicalizeCountry,
  countrySlug,
} from '@workspace/seo-shared/country-regions';
import { PrecomputedCitiesService } from '../services/precomputed-cities';
import { logger } from '../utils/logger';
import { isJunkStation } from './junk-station-rules';

/**
 * Mirrors the `generateSlug()` used in PrecomputedCitiesService and the
 * region/country/city route handlers (lowercase, non-alnum → `-`,
 * collapse runs, trim leading/trailing `-`). Keeping this byte-identical
 * is what lets the fallback set match the URL slug a visitor types.
 */
function slugifyCity(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/--+/g, '-')
    .replace(/^-|-$/g, '');
}

let stationSlugs: Set<string> = new Set();
let genreSlugs: Set<string> = new Set();
let countrySlugs: Set<string> = new Set();
let citySlugsByCountry: Map<string, Set<string>> = new Map();
// Alias slug → { canonical slug, junk bit }. Populated by
// `loadSlugExistence` from the same `Station.find(... slugAliases ...)`
// query that fills `stationSlugs`. Used by `urlRedirectMiddleware` to
// collapse the slug-alias 301 INTO the existing single canonicalization
// hop — without this map, an old-slug request would 301 once in the
// middleware (lang/segment fixes) and then 301 a second time in the SSR
// `seo-renderer` after a per-request `Station.findOne({slugAliases})`
// lookup.
//
// `junk` is precomputed via `isJunkStation()` (or the doc's `noIndex`
// flag) so the middleware can SKIP the alias-301 when the canonical
// target is junk — those URLs must serve 410 Gone via the SSR alias
// branch, not 301. Without this gate the middleware would silently
// reverse the SSR's deindex strategy. All slugs lowercased.
interface AliasInfo { canonical: string; junk: boolean; }
let stationAliasToCanonical: Map<string, AliasInfo> = new Map();
let ready = false;

export function isSlugExistenceReady(): boolean {
  return ready;
}

export function hasStationSlug(slug: string): boolean {
  return stationSlugs.has(slug);
}

/**
 * Returns the canonical station slug for a given alias slug, or `null`
 * when:
 *   - `aliasSlug` is not a known alias (or IS already the canonical), OR
 *   - the canonical target is junk / `noIndex:true`. In the junk case
 *     the caller must NOT 301 to the canonical (which would consolidate
 *     ranking onto a deindexed URL). Falling through to the SSR
 *     `seo-renderer` alias branch is the correct behavior — that branch
 *     serves 410 Gone for the original alias URL.
 * Lookup is O(1) and runs entirely in-memory.
 */
export function getCanonicalStationSlug(aliasSlug: string): string | null {
  if (!aliasSlug) return null;
  const info = stationAliasToCanonical.get(aliasSlug.toLowerCase());
  if (!info) return null;
  if (info.canonical === aliasSlug.toLowerCase()) return null;
  if (info.junk) return null;
  return info.canonical;
}

export function hasGenreSlug(slug: string): boolean {
  return genreSlugs.has(slug);
}

export function hasCountrySlug(slug: string): boolean {
  return countrySlugs.has(slug);
}

/**
 * Returns true when `citySlug` is a known city under `countrySlugValue`.
 * Both slugs must be lowercased URL slugs (no leading slash). Returns
 * false when the country is unknown or has no precomputed city set —
 * callers should also gate on `isSlugExistenceReady()` so a cold start
 * doesn't false-404 valid pages.
 */
export function hasCitySlug(countrySlugValue: string, citySlug: string): boolean {
  const cities = citySlugsByCountry.get(countrySlugValue);
  return cities ? cities.has(citySlug) : false;
}

/**
 * True when we have *any* city data for the given country slug. Used to
 * skip the city existence gate for countries we don't precompute cities
 * for (would otherwise false-404 valid city URLs in those countries).
 */
export function hasCityDataForCountry(countrySlugValue: string): boolean {
  const cities = citySlugsByCountry.get(countrySlugValue);
  return !!cities && cities.size > 0;
}

/**
 * Load (or reload) the slug sets from MongoDB. Failures are logged but
 * do not throw — a stale set is preferable to a 404 storm if Mongo is
 * briefly unavailable, and an empty initial set keeps `ready=false` so
 * the middleware just falls through.
 */
export async function loadSlugExistence(): Promise<void> {
  try {
    const [stationDocs, genreDocs, countryDocs, distinctStationCountries] = await Promise.all([
      Station.find(
        { slug: { $exists: true, $ne: null } },
        // Extra fields (name/url/noIndex/lastCheck*) are needed to
        // precompute `isJunkStation()` per station so the alias map's
        // junk bit is correct. Footprint stays small (~100B per doc on
        // average) compared to the typical 1-2 KB full station record.
        {
          slug: 1, slugAliases: 1, noIndex: 1, name: 1, url: 1,
          lastCheckOk: 1, lastCheckOkTime: 1, lastCheckTime: 1,
          _id: 0,
        },
      ).lean(),
      Genre.find(
        { slug: { $exists: true, $ne: null } },
        { slug: 1, _id: 0 },
      ).lean(),
      Country.find({}, { name: 1, _id: 0 }).lean(),
      Station.distinct('country').then((vals: unknown[]) =>
        (vals as Array<string | null | undefined>).filter(
          (v): v is string => typeof v === 'string' && v.length > 0,
        ),
      ),
    ]);

    const nextStations = new Set<string>();
    const nextAliasMap = new Map<string, AliasInfo>();
    let junkAliasCount = 0;
    type StationLite = {
      slug?: string;
      slugAliases?: string[];
      noIndex?: boolean;
      name?: string;
      url?: string;
      lastCheckOk?: boolean;
      lastCheckOkTime?: Date | string | null;
      lastCheckTime?: Date | string | null;
    };
    for (const doc of stationDocs as StationLite[]) {
      const canonical = doc.slug ? doc.slug.toLowerCase() : '';
      if (canonical) nextStations.add(canonical);
      if (Array.isArray(doc.slugAliases) && canonical) {
        // Compute junk ONCE per station, not per alias — same canonical
        // target is shared across all of its aliases.
        const isJunk = doc.noIndex === true || isJunkStation(doc);
        for (const a of doc.slugAliases) {
          if (!a) continue;
          const aliasLower = a.toLowerCase();
          nextStations.add(aliasLower);
          // Only store entries where the alias actually differs from the
          // canonical — saves memory and short-circuits the no-op case.
          if (aliasLower !== canonical) {
            nextAliasMap.set(aliasLower, { canonical, junk: isJunk });
            if (isJunk) junkAliasCount++;
          }
        }
      } else if (Array.isArray(doc.slugAliases)) {
        for (const a of doc.slugAliases) {
          if (a) nextStations.add(a.toLowerCase());
        }
      }
    }

    const nextGenres = new Set<string>();
    for (const doc of genreDocs as Array<{ slug?: string }>) {
      if (doc.slug) nextGenres.add(doc.slug.toLowerCase());
    }

    const nextCountries = new Set<string>();
    // 1. Static canonical map — covers every country we generate region URLs for.
    for (const name of Object.keys(COUNTRY_TO_REGION_SLUG)) {
      const slug = countrySlug(name);
      if (slug) nextCountries.add(slug);
    }
    // 2. Country docs in Mongo (admin-managed list, may diverge from static).
    for (const doc of countryDocs as Array<{ name?: string }>) {
      if (doc.name) {
        const slug = countrySlug(doc.name);
        if (slug) nextCountries.add(slug);
      }
    }
    // 3. Every distinct station.country (canonicalized via alias map first
    // so e.g. "Türkiye" → "Turkey" → "turkey" matches the URL slug).
    for (const raw of distinctStationCountries) {
      const slug = countrySlug(canonicalizeCountry(raw));
      if (slug) nextCountries.add(slug);
    }

    // Per-country city slug sets — sourced from PrecomputedCitiesService
    // so a city URL is "valid" iff the cities listing actually shows it
    // (the same `generateSlug()` is applied so URL/slug stay in sync).
    const nextCities = new Map<string, Set<string>>();
    const supportedCountries = PrecomputedCitiesService.getSupportedCountries();
    for (const countryName of supportedCountries) {
      try {
        const data = await PrecomputedCitiesService.getCitiesForCountry(countryName);
        if (!data?.cities?.length) continue;
        const set = new Set<string>();
        for (const c of data.cities) {
          if (c.slug) set.add(c.slug.toLowerCase());
        }
        if (set.size > 0) {
          nextCities.set(countrySlug(countryName), set);
        }
      } catch (cityErr: any) {
        logger.log(
          `⚠️ SLUG-EXISTENCE: city precompute failed for ${countryName} (${cityErr?.message || cityErr})`,
        );
      }
    }

    // Task #363: backfill city sets for countries outside the
    // hardcoded `COUNTRY_CITIES` list using distinct station.state
    // values. One aggregation, runs on the existing 6h refresh — no
    // per-request DB cost. Only fills in country slugs we haven't
    // already populated above so the tighter precomputed sets win
    // for the supported countries.
    let fallbackCountries = 0;
    let fallbackCities = 0;
    const fallbackSets = new Map<string, Set<string>>();
    try {
      const stateRows = (await Station.aggregate([
        {
          $match: {
            country: { $type: 'string', $ne: '' },
            state: { $type: 'string', $ne: '' },
          },
        },
        { $group: { _id: { country: '$country', state: '$state' } } },
      ])
        .option({ maxTimeMS: 30000, allowDiskUse: true })
        .exec()) as Array<{ _id: { country: string; state: string } }>;

      for (const row of stateRows) {
        const cSlug = countrySlug(canonicalizeCountry(row._id.country));
        if (!cSlug) continue;
        // Don't override the precomputed (tight) set for supported
        // countries — those already cover the URLs we render.
        if (nextCities.has(cSlug)) continue;
        const stateSlug = slugifyCity(row._id.state);
        if (!stateSlug) continue;
        let set = fallbackSets.get(cSlug);
        if (!set) {
          set = new Set<string>();
          fallbackSets.set(cSlug, set);
        }
        if (!set.has(stateSlug)) {
          set.add(stateSlug);
          fallbackCities++;
        }
      }
      for (const [cSlug, set] of fallbackSets) {
        if (set.size === 0) continue;
        nextCities.set(cSlug, set);
        fallbackCountries++;
      }
    } catch (fallbackErr: any) {
      logger.log(
        `⚠️ SLUG-EXISTENCE: city fallback aggregation failed (${fallbackErr?.message || fallbackErr})`,
      );
    }

    stationSlugs = nextStations;
    stationAliasToCanonical = nextAliasMap;
    genreSlugs = nextGenres;
    countrySlugs = nextCountries;
    citySlugsByCountry = nextCities;
    ready = true;
    const cityTotal = Array.from(nextCities.values()).reduce((n, s) => n + s.size, 0);
    logger.log(
      `🗂️ SLUG-EXISTENCE: loaded ${nextStations.size} station slugs (${nextAliasMap.size} aliases incl. ${junkAliasCount} junk-canonical), ${nextGenres.size} genre slugs, ${nextCountries.size} country slugs, ${cityTotal} city slugs across ${nextCities.size} countries (incl. ${fallbackCities} fallback cities across ${fallbackCountries} countries from station.state)`,
    );
  } catch (err: any) {
    logger.log(`⚠️ SLUG-EXISTENCE: load failed (${err?.message || err}) — keeping previous sets`);
  }
}

/**
 * Start a periodic refresh in the background. Returns the timer handle
 * so callers can clear it during shutdown if they want.
 */
export function startSlugExistenceRefresh(intervalMs = 6 * 60 * 60 * 1000) {
  const timer = setInterval(() => {
    loadSlugExistence().catch(() => {});
  }, intervalMs);
  // Don't keep the event loop alive solely for this refresh.
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}
