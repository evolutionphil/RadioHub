# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MegaRadio is a full-stack radio streaming platform organized as a **pnpm workspace monorepo**. The backend is an Express 5 API server backed by MongoDB; the frontend is a React SPA built with Vite. Both are deployed as separate Docker containers behind a shared reverse proxy.

## Commands

**Install dependencies (always use pnpm):**
```sh
pnpm install
```

**Run individual apps:**
```sh
pnpm --filter @workspace/api-server run dev      # Build + start API server (port 8080)
pnpm --filter @workspace/megaradio run dev        # Vite dev server (port 22507)
```

**Build:**
```sh
pnpm run build                                    # typecheck → per-package builds → tests (full CI)
pnpm --filter @workspace/api-server run build     # esbuild bundle → dist/index.mjs
pnpm --filter @workspace/megaradio run build      # Vite → dist/public/
```

**Typecheck:**
```sh
pnpm run typecheck                                # Typecheck libs + all artifacts
pnpm run typecheck:libs                           # tsc project references (lib/* only)
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/megaradio run typecheck
```

**Tests:**
```sh
pnpm run test                                     # All workspace tests (runs as part of pnpm run build)
pnpm --filter @workspace/api-server run test      # Node test runner (tsx)
pnpm --filter @workspace/megaradio run test       # Vitest (jsdom)

# Run a single api-server test file:
cd artifacts/api-server && pnpm exec tsx --experimental-test-module-mocks --test --test-force-exit tests/hint-discipline.test.ts
```

**Docker builds** (uses `ENTRY` env var to select the server bundle):
```sh
docker build -f Dockerfile.api .    # ENTRY=src/index-api.ts
docker build -f Dockerfile.web .    # ENTRY=src/index-web.ts
docker build -f Dockerfile.proxy .  # reverse proxy only
```

## Workspace Structure

```
artifacts/
  api-server/       Express 5 backend — routes, caching, SEO rendering, scheduled jobs
  megaradio/        React + Vite SPA — Wouter routing, TanStack Query, Tailwind CSS v3
  megaradio-investor-deck/
  mockup-sandbox/
lib/
  api-client-react/ TanStack Query helpers + generated typed API client (@workspace/api-client-react)
  api-zod/          Shared Zod request/response schemas (@workspace/api-zod)
  db/               Drizzle ORM + PostgreSQL (future; not the primary DB)
  db-shared/        Mongoose models + cross-app TS types (@workspace/db-shared)
  seo-shared/       All SEO templates, URL translations, FAQs, seo-config (@workspace/seo-shared)
scripts/            Workspace-level utility scripts
```

## Architecture

### Backend (`artifacts/api-server`)

**Entry points** — selected at Docker build time via the `ENTRY` env var:
- `src/index-api.ts` — API-only server (port 5000 in production)
- `src/index-web.ts` — Serves the pre-built Vite SPA + API (port 3000 in production)
- `src/index-proxy.ts` — Reverse proxy only
- `src/index.ts` — Re-exports `index-api.ts` (default dev target)

**Route registration** — `src/routes.ts` imports and registers every sub-router in one place. Each domain area lives in `src/routes/<name>.ts` and is registered via a `register*Routes(app, deps)` function.

**Two-tier cache** (`src/cache.ts`):
- L1: `node-cache` in-process (max 100 keys, 10-min TTL)
- L2: Redis (optional, keyed by `REDIS_URL`)
- `CacheManager.getOrSetSingleFlight(key, loader, opts)` coalesces concurrent cold-miss requests into a single upstream call — always use this on hot read paths.

**MongoDB** is the primary database (`MONGODB_URI`). Mongoose models are in `lib/db-shared/src/mongo-schemas.ts`. Every `Station.aggregate(...)` **must** chain `.option({ maxTimeMS: 15000, allowDiskUse: true })` — the Atlas M10 enforces a 32 MB sort limit and will throw code 292 without `allowDiskUse`.

**SSR / SEO rendering** (`src/seo-renderer.ts`) — the API server injects language-specific `<title>`, `<meta>`, structured data, and `window.__INITIAL_TRANSLATIONS__` into `index.html` before serving it to crawlers. `@workspace/seo-shared` owns all copy; `src/seo/load-database-mappings.ts` hydrates the shared module with DB-sourced URL translations and country mappings at startup.

**Scheduled jobs** live in `src/services/scheduled-*.ts` and are registered in `routes.ts`. Off-peak cron schedule (all Europe/Berlin): TV/Mobile at 2 AM, Genres at 5 AM, Popular at 6:30 AM. **Boot-time warmup is intentionally absent** — caches fill lazily on first organic request (see "Lazy cache fill" in `replit.md`).

**Auth** — `requireAuth` / `requireAdmin` middleware in `src/middleware/auth.ts` accepts either a session cookie (`express-session` backed by `connect-mongo`) or a `Bearer <token>` header checked against the `AuthToken` Mongoose collection. Social logins (Google, Facebook) go through `src/auth/passport-config.ts`. Every auth attempt is logged via `logAuthEvent()` in `src/auth/auth-event-logger.ts` (persists to `auth_event_logs` collection with 30-day TTL).

**Express 5 syntax** — use `/*path` for wildcards (not `/*`) and `{:param}` for optional params (not `:param?`).

### Frontend (`artifacts/megaradio`)

**Routing** — Wouter with all pages lazy-loaded via `src/components/lazy-routes.tsx` and `src/components/lazy-admin-routes.tsx`. `App.tsx` mounts the route tree; `ProtectedRoute` / `AdminRoute` guard authenticated sections.

**Data fetching** — TanStack Query v5. API calls go through `src/lib/queryClient.ts` (`apiRequest` + `resolveApiUrl`). `VITE_API_BASE_URL` can override the API base for split-deployment (Vite → CDN, API → Railway).

**Global player** — `src/hooks/useGlobalPlayer.tsx` (full implementation) + `src/hooks/useGlobalPlayer.shell.tsx` (lightweight context stub). The shell is imported broadly to avoid loading the audio engine until a station is selected. `LazyGlobalPlayerProvider` in `App.tsx` defers the full provider until first play. `public/sw.js` is hand-tuned for iOS Safari background audio — **do not replace it with `vite-plugin-pwa`** (see `replit.md`).

**Translations** — `useTranslation()` in `src/hooks/useTranslation.ts` reads `window.__INITIAL_TRANSLATIONS__` (server-injected) on first render, then fetches from `/api/translations`. Language is inferred from the URL path prefix (`/tr`, `/de`, etc.).

**Third-party scripts** — Microsoft Clarity and GA4 run via `@builder.io/partytown` (Web Worker). Google AdSense and the Cast SDK remain on the main thread.

### Shared Libraries

| Package | Import path | Purpose |
|---|---|---|
| `@workspace/db-shared/mongo-schemas` | server-only runtime | Mongoose models + TS interfaces |
| `@workspace/db-shared/schema` | server + client | Zod auth/station validators, `StationWithCountry` type |
| `@workspace/seo-shared/<module>` | server + client | SEO templates, URL translations, FAQ, seo-config |
| `@workspace/api-client-react` | client only | TanStack Query hooks over the typed API |
| `@workspace/api-zod` | server + client | Shared Zod schemas for API request/response |

**Do not import Mongoose or `@workspace/db-shared/mongo-schemas` from the frontend** — it pulls in Node.js-only deps.

## Key Conventions

### MongoDB `.hint()` discipline

Every `.hint('index_name')` call **must** be preceded within 5 lines by a comment:
```ts
// HINT-VERIFIED YYYY-MM-DD - <index_name>
```
The CI guard `tests/hint-discipline.test.ts` greps the source and fails the build if this comment is missing. Before adding a hint, verify the index is present and not hidden via `$indexStats`. If in doubt, omit the hint entirely — the planner is faster than a silent 500 (BadValue code 2).

Any hinted query **must** also catch `error.code === 2` and retry unhinted:
```ts
try {
  for await (const doc of cursor.hint('idx')) { ... }
} catch (err: any) {
  if (err.code === 2) { /* retry without hint */ }
  else throw err;
}
```

### Public read endpoints must soft-fail

All public read routes (`/api/stations/*`, `/api/genres/*`, `/api/regions/*`) must catch errors and return a 200 with a stale-cache fallback or an empty-but-shape-correct payload with `Cache-Control: no-store`. A 500 breaks SSR pages for organic visitors.

### Adding a new SEO language

1. Add the language code to `SEO_LANGUAGES` in `lib/seo-shared/src/seo-config.ts`.
2. Add corresponding entries in every template registry (`REGION_SEO_TEMPLATES`, `GENRE_SEO_TEMPLATES`, `SEARCH_SEO_TEMPLATES`, `LEGAL_SEO_TEMPLATES`, `STATIC_PAGE_SEO_TEMPLATES`, `URL_TRANSLATIONS`, etc.).
3. The CI test `tests/seo-templates-coverage.test.ts` will fail the build if any registry is missing the new language code.

### In-app purchase (IAP) security

`POST /api/user/subscription` requires a real Apple/Google receipt — never trust client-supplied plan/expiry fields. See `docs/IAP_HOTFIX_FRONTEND_NOTES.md` for the full contract, error codes, and the Apple S2S webhook.

### Shared code location

- SEO/FAQ shared modules → `lib/seo-shared` (never duplicate under `artifacts/*/src/shared/`)
- Mongoose models + cross-app types → `lib/db-shared`
- Cache loaders that call DB and populate `seo-shared` in-memory stores → `artifacts/api-server/src/seo/load-database-mappings.ts`

## Environment Variables

| Variable | Where used | Notes |
|---|---|---|
| `PORT` | api-server, web-server | Default 5000 (api), 3000 (web) |
| `MONGODB_URI` | api-server | Falls back to `DATABASE_URL` then `mongodb://localhost:27017/mega` |
| `REDIS_URL` | api-server | Optional; in-memory cache used if absent |
| `SESSION_SECRET` | api-server | Required in production |
| `VITE_API_BASE_URL` | megaradio build | Override API host for split deployment |
| `VITE_STREAM_PROXY_URL` | megaradio build | Stream proxy base URL |
| `BASE_PATH` | megaradio build | Vite `base` option |
| `ENTRY` | api-server Docker build | Selects server bundle entry point |
