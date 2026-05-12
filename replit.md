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

## Sitemap operations

- The top-30 country list embedded in `/sitemap-main-{lang}.xml` is computed
  during the `SitemapManifest` build (see `seo/sitemap-manifest-builder.ts`)
  and baked into the active `main` manifest's `chunks[0].stationIds` as
  `tc:<region>/<country>` markers. ETag/Last-Modified for those sitemaps
  flip automatically when the country leaderboard or recent station updates
  inside those countries change.
- After a bulk import/cleanup, force an immediate refresh with:
  `POST /api/admin/sitemap/rebuild` (admin-only).

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
- **Custom `rollupOptions.output.manualChunks()`**: see the warning comment
  inside `artifacts/megaradio/vite.config.ts`. Forcing whole packages like
  `lucide-react` or `react-icons` into a single chunk previously ballooned
  the icon chunk to 6 MB raw. Vite's default per-import tree-shaking + the
  route-level lazy splits in `src/components/lazy-routes.tsx` already give
  a healthy ~170 KB gzipped entry bundle.
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
