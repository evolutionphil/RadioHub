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

## Important Migration Notes

- `artifacts/api-server/src/shared/` — shared Mongoose schemas (duplicated from legacy `shared/`)
- `artifacts/megaradio/src/shared/` — shared frontend types/SEO config (duplicated from legacy)
- `artifacts/megaradio/src/server/performance-cache.ts` — browser stub for server-only import
- Express 5 breaking changes fixed:
  - `/*` wildcards → `/*path`
  - `:param?` optional params → `{:param}`
- Backend entry: `artifacts/api-server/src/index-api.ts` (imports `registerRoutes` from `src/routes.ts`)
- Frontend fonts: `artifacts/megaradio/public/fonts/` (Ubuntu font family)
