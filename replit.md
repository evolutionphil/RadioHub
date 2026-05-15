# MegaRadio — pnpm Workspace Monorepo

## Overview

Full-stack radio streaming application migrated to a pnpm workspace monorepo.
Backend serves the `/api` path; frontend serves `/` (the Vite SPA).

## Architecture

```
artifacts/
  api-server/   → Express 5 backend (MongoDB/Mongoose, auth, SSE, WebSockets)
  megaradio/    → React + Vite frontend (Wouter, TanStack Query, Tailwind v3)
lib/
  api-zod/      → Zod validation schemas (shared)
  db/           → Drizzle ORM + PostgreSQL (for future relational data)
  db-shared/    → Shared Mongoose models + cross-app TS types. Exposes two
                  entry points:
                    `@workspace/db-shared/mongo-schemas` — full Mongoose
                      models + interfaces (used by api-server runtime).
                    `@workspace/db-shared/schema` — Zod auth/station
                      validators + `StationWithCountry` interface (used
                      by both api-server and megaradio; megaradio only
                      pulls types/zod, never Mongoose).
  seo-shared/   → Shared SEO/FAQ modules (faq-schema, structured-data,
                  seo-config, genre/region-seo-templates, url-translations,
                  country-name-translations, country-regions,
                  critical-translation-keys) used by both api-server and
                  megaradio. Imported as `@workspace/seo-shared/<module>`.
```

## Stack

- **Monorepo**: pnpm workspaces
- **Node.js**: v24
- **API framework**: Express 5 (path-to-regexp v8 — use `{:param}` for optional params, `/*path` for wildcards)
- **Database**: MongoDB (Mongoose) — primary; PostgreSQL (Drizzle) for future use
- **Auth**: Passport.js (local, Google, Facebook) + session store (connect-mongo)
- **Frontend**: React 18, Vite 7, Wouter, TanStack Query, Tailwind CSS v3
- **Build**: esbuild (ESM bundle for server)

## Key Commands

- `pnpm --filter @workspace/api-server run dev` — run API server
- `pnpm --filter @workspace/megaradio run dev` — run Vite frontend
- `pnpm --filter @workspace/api-server run build` — build backend
- `pnpm run test` — run every workspace package's `test` script via `pnpm -r --if-present run test`. Currently this executes the SEO translation guard at `artifacts/api-server/tests/seo-templates-coverage.test.ts`, which fails the build if any `SEO_LANGUAGES` code is missing a region or genre template. The root `pnpm run build` invokes `pnpm run test` after typecheck + per-package builds, so the guard runs automatically on every full build / CI check. To add new automated tests, drop them in a workspace package's `tests/` folder and expose a `test` script — they will be picked up automatically.

## Proxy Routing

A shared reverse proxy routes by path:
- `/api/*` → api-server (port 8080)
- `/` → megaradio Vite dev server (port 22507)

## Auth event logging (login debug trail)

Every Google / Apple / Email (web + mobile) login attempt is funnelled
through `logAuthEvent()` in
`artifacts/api-server/src/auth/auth-event-logger.ts`. The helper does
two things on every checkpoint (callback received, profile resolved,
token issued, session saved, every error branch, redirect):

1. Prints a single-line structured `✅ AUTH …` / `❌ AUTH …` record to
   stdout so it shows up in the Railway live tail.
2. Persists the same record to the `auth_event_logs` MongoDB collection
   (model: `AuthEventLog` in `lib/db-shared/src/mongo-schemas.ts`) via a
   `setImmediate` so the auth response is never blocked. The collection
   has a 30-day TTL on `ts`.

The persisted log survives Railway process restarts AND page refreshes,
which is the whole point — debug traces no longer disappear when the
user reloads after a failed login.

To inspect the log, hit `GET /api/admin/auth-events` (admin-only). Query
params: `limit` (1-500, default 200), `method`
(`google|apple|email|mobile-email|mobile-apple|mobile-google`),
`email`, `event`, `ok=true|false`, `sinceMs` (window in ms — e.g.
`?sinceMs=3600000` for the last hour).

NEVER log raw passwords, tokens, or full JWTs — the helper already
truncates `message` (500 chars) and free-form `detail` is intended for
HTTP status codes / Apple error bodies / similar non-secret context.

## Sitemap operations

- The top-30 country list embedded in `/sitemap-main-{lang}.xml` is computed
  during the `SitemapManifest` build (see `seo/sitemap-manifest-builder.ts`)
  and baked into the active `main` manifest's `chunks[0].stationIds` as
  `tc:<region>/<country>` markers. ETag/Last-Modified for those sitemaps
  flip automatically when the country leaderboard or recent station updates
  inside those countries change.
- After a bulk import/cleanup, force an immediate refresh with:
  `POST /api/admin/sitemap/rebuild` (admin-only).

## Hint discipline — DO NOT add `.hint('index_name')` without a fresh probe

INCIDENT 2026-05-15 v10 (4th recurrence): production /api/stations/popular
and /api/cities/precomputed silently 500'd because previously-added
`.hint('lastCheckOk_1_votes_-1')` (and 2 other hints) referenced indexes
that the May 14 Atlas index audit (commit aee98c81e) HID. Hinting a
hidden index throws BadValue (code 2) and the catch returned 500.

**Rule**: every `.hint('name')` MUST be preceded by a comment of the form
`// HINT-VERIFIED YYYY-MM-DD - <name>` with proof that the index is
present AND visible. To verify, run `$indexStats` on the live cluster
via the Atlas Data Explorer **OR** the `mongosh` shell:

```
db.stations.aggregate([{$indexStats:{}}], {allowDiskUse:true})
  .toArray().map(i => ({name: i.name, hidden: !!i.hidden, accesses: i.accesses.ops}))
```

If `hidden: true`, do not hint that index. If the index is missing
entirely, add it via `Station.collection.createIndex(...)` in `routes.ts`
`createIndexes()` first. (The previous v10 admin route
`GET /api/admin/db/indexes` was deliberately removed — it was a
temporary probe, not a permanent surface.)

When in doubt, **DO NOT hint at all** — the planner is faster than a
silent 500. We removed all 3 hints in v10
(station-public-routes.ts:228/717, precomputed-stations.ts:225) and the
endpoints serve correctly without them.

The CI guard test at
`artifacts/api-server/tests/hint-discipline.test.ts` greps the
api-server source for `.hint(` and fails the build if any usage is
missing the verification comment. It runs automatically as part of
`pnpm run test` (which the root build invokes).

## Lazy cache fill (NO eager boot warmup)

INCIDENT 2026-05-15 v10 — boot warmup is REMOVED. Per user directive
("ilk gelenler olmaya baslayinca yapsin"), caches fill lazily as the
first organic visitor arrives. Stampede protection is provided by
`CacheManager.getOrSetSingleFlight(key, loader, opts)` (see
`cache.ts:160`) which coalesces concurrent misses on the same key into
ONE upstream call.

What was stripped from `routes.ts` boot path:
- `warmupViaHttp()` 5s setTimeout + 50min setInterval
- `warmupPopularStationsCache()` + `warmupTvMobileCache()`
- `PrecomputedStationsService.warmupPopularCountries()` 60s setTimeout
- `PrecomputedGenresService.warmupCache()` 15s setTimeout
- `PrecomputedCitiesService.warmupCache()` is now a no-op

What remains at boot: ONE cheap `Station.findOne({lastCheckOk:true})`
probe at the 5s mark to confirm the cluster is reachable. Off-peak cron
refreshes (TV/Mobile 2 AM, Genres 5 AM, Popular 6:30 AM, all
Europe/Berlin) still run for steady-state coverage.

If you re-add boot warmup, the M10 cluster will recurringly burn down
under multiplanner contention + connection pool exhaustion. DO NOT.

## Public read endpoints MUST soft-fail (never 500)

A 500 from a public read endpoint breaks SSR pages (homepage, country,
city, genre) and shows an error page to organic users. Every public
read in `station-public-routes.ts`, `genres-countries-routes.ts`,
`regions-recommendations-routes.ts`, and `translation-admin-routes.ts`
public filter endpoints now does:

```ts
} catch (error: any) {
  logger.error(`❌ /api/... failed: code=${error?.code || 'unknown'} msg=${error?.message || error}`);
  // SWR fallback: try the cache one more time — a parallel request
  // may have populated it before we threw.
  let stale: any = null;
  try { stale = await CacheManager.get(cacheKey); } catch {}
  res.set('Cache-Control', 'no-store');
  res.json(stale ?? <empty-but-shape-correct payload>);
}
```

`Cache-Control: no-store` on the failure response is critical: a
30-second cache on `[]` would lock organic users out of the homepage
for 30 seconds after the cluster recovers. `no-store` lets the next
request retry immediately while still returning 200 (so SSR doesn't
crash).

The hot endpoints (`/api/stations/popular`, `/api/filters/languages`,
the precomputed-cities service) wrap their cache compute in
`CacheManager.getOrSetSingleFlight(key, loader, opts)` so 100
concurrent cold misses (typical SSR fanout when CDN expires the
homepage) coalesce into ONE Mongo aggregate.

## MongoDB aggregation memory limits (read before adding new aggregations)

Atlas enforces a **32MB sort memory limit per aggregation stage** at every
tier (M10 included). When a `$sort` / `$group` / `$facet` stage on the
Station collection exceeds it, Mongo throws code 292
(`QueryExceededMemoryLimitNoDiskUseAllowed`) and the request fails.

**Rule**: every `Station.aggregate(...)` (and any aggregation that sorts or
groups a multi-MB result) MUST chain `.allowDiskUse(true)` (or pass
`{ allowDiskUse: true }` in `.option({...})` alongside `maxTimeMS`).
The `precomputed-stations`, `precomputed-cities`, `station-public-routes`,
`regions-recommendations-routes`, and `recommendation-engine` aggregations
were all retrofitted on 2026-05-12 — DO NOT remove the option. Atlas M10+
allows disk spill so this is safe; the prior shared/serverless tier ban is
no longer applicable.

If you add a new `Station.aggregate(...)` call, copy this pattern:
`.option({ maxTimeMS: 15000, allowDiskUse: true })`.

## Performance optimization landmines (DO NOT touch without re-reading this)

The following retrofits were investigated on 2026-05-12 and intentionally
**NOT** done because the risk-vs-benefit math is bad for this app:

- **`vite-plugin-pwa`**: `artifacts/megaradio/public/sw.js` is hand-tuned for
  iOS Safari background audio survival (the `KEEP_ALIVE` message channel
  driven by `src/hooks/useGlobalPlayer.tsx`), custom push-notification JSON
  payload handling, three notification action handlers (`play` / `favorite`
  / `explore`) that postMessage the running clients, and background sync to
  `/api/user/sync`. None of these are easy to express in Workbox without
  custom code, and the only real gain (precaching of hashed bundles) is
  already provided by the immutable `Cache-Control` we set on `/assets/*`
  + the existing cache-first fetch handler in `sw.js`. Migration would put
  the app's CORE feature (radio streaming on iOS Safari with the screen
  off) at risk for a marginal precaching win — DO NOT do it. If you
  absolutely must, only `injectManifest` mode wrapping the existing
  `sw.js` is acceptable; `generateSW` would silently drop the custom
  handlers above.
- **Custom `rollupOptions.output.manualChunks()`**: PARTIALLY IN USE as of
  2026-05-12. The ARRAY form (`manualChunks: { icons: ['lucide-react'] }`)
  is still forbidden — it bypasses tree-shaking and ballooned the icon
  chunk to 6 MB raw. The FUNCTION form (`manualChunks(id) { if
  (id.includes('lucide-react/dist/esm/icons/')) return 'icons-lucide' }`)
  IS now in `vite.config.ts` because it runs AFTER Rollup tree-shaking
  and only groups icons that are actually imported. This was added to
  cut PageSpeed mobile TBT (we previously shipped 50+ per-icon chunks
  of 2.5 KiB each that were eagerly modulepreloaded with the entry,
  costing 50+ HTTP round-trips on the critical chain). Do NOT extend
  the function to swallow general vendor packages — keep it scoped to
  confirmed-heavy split-victims like the lucide icon directory.
- **AdSense in Partytown**: AdSense (`pagead2.googlesyndication.com`) does
  NOT survive being moved into a Web Worker — it relies on synchronous DOM
  measuring, iframe creation, and anti-fraud signals that Partytown can't
  proxy. Microsoft Clarity and GA4 ARE moved to Partytown via
  `@builder.io/partytown` (see `vite.config.ts` + `index.html`); AdSense
  and the Google Cast SDK stay on the main thread.

## Important Migration Notes

- Nothing is duplicated under `artifacts/*/src/shared/` anymore — those folders have been deleted. SEO/FAQ shared code lives in `lib/seo-shared` (`@workspace/seo-shared/<module>`) and Mongoose models + cross-app TS/zod types live in `lib/db-shared` (`@workspace/db-shared/mongo-schemas` for the server, `@workspace/db-shared/schema` for both server and client).
- The api-server-only cache loaders for SEO/URL translations live in `artifacts/api-server/src/seo/load-database-mappings.ts` (they call `setDatabase*` setters exposed by `@workspace/seo-shared`).
- Express 5 breaking changes fixed:
  - `/*` wildcards → `/*path`
  - `:param?` optional params → `{:param}`
- Backend entry: `artifacts/api-server/src/index-api.ts` (imports `registerRoutes` from `src/routes.ts`)
- Frontend fonts: `artifacts/megaradio/public/fonts/` (Ubuntu font family)
