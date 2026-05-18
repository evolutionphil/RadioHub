# A.5 — Sitemap Health: Code Audit

## Route Handlers

### Sitemap Index (`/sitemap-index.xml`, `/sitemap.xml`)
- Lines 1585–1787 in `seo-sitemap-routes.ts`
- Manifest-driven (refactored 2026-04-30)
- Emits entries only for active manifests with `chunkCount > 0`
- `<lastmod>` = per-(type, lang) `maxUpdatedAt` from manifest

### Main Sitemap (`/sitemap-main-:lang.xml`) — Lines 1125–1270
- Static pages: `''`, `/stations`, `/genres`, `/about`, `/regions`, `/faq`, `/contact`, `/privacy-policy`, `/terms-and-conditions`, `/applications`
- **Top-30 countries**: baked-in marker entries (`tc:` prefix) from manifest `chunks[0].stationIds`
- Hreflang: all `qualifiedLanguages` get self-referential tags; `x-default` → English
- `lastmod`: `manifest.maxUpdatedAt` for all main pages

### Stations Sitemap (`/sitemap-stations-:lang-:chunk.xml`) — Lines 1275–1423
- **10,000 stations per chunk** (bumped from 1,000 on 2026-05-08)
- Defensive re-run of `getIndexableLanguagesForStation()` at serve-time
- noIndex/junk stations skip even if in manifest
- Image sitemap: best logo (webp256 → webp96 → favicon), verified hosts only
- `lastmod` = `station.updatedAt`, `changefreq` = `weekly`, `priority` = `0.8`
- Hreflang: filtered by `getIndexableLanguagesForStation(station, qualifiedLanguages)`; `x-default` → English

### Genres Sitemap (`/sitemap-genres-:lang.xml`) — Lines 1427–1540
- Only whitelisted slugs (`SAFE_SLUG_RE: ^[a-z0-9]+(?:-[a-z0-9]+)*$`)
- Hreflang: all `qualifiedLanguages`; `x-default` → English
- `changefreq` = `weekly`, `priority` = `0.7`

## Manifest Builder (`sitemap-manifest-builder.ts`)

### Station filtering
```
{ slug: { $exists: true, $ne: '' }, $or: [{ noIndex: { $exists: false } }, { noIndex: { $ne: true } }] }
```
Routes each station into per-language buckets via `getIndexableLanguagesForStation()`.

### ETag strategy
- `sha256(qualifiedLanguagesHash + sorted chunks signature)` — **excludes maxUpdatedAt** to avoid cache stampedes
- Freshness bump: when version matches, in-place `$set` of chunks+maxUpdatedAt (FRESHNESS BUG FIX 2026-05-09)

### Scheduled refresh
- Main loop: every 6h via `startManifestRefreshLoop()`
- Diff + IndexNow: cron daily 04:45 Berlin
- Admin: `POST /api/admin/sitemap/rebuild` (full flush + force rebuild)

## Key Issue: H16 (top-30 baked countries)

The `/sitemap-main-{lang}.xml` contains only the top-30 countries in static entries. The remaining 190+ countries are only discoverable via the stations sitemap chunks. If Google prioritises the main sitemap, the majority of station URLs have low discovery probability. **Verdict: H16 CONFIRMED as secondary factor.**

## Non-qualified language sitemaps
Return `410 Gone` with `X-Robots-Tag: noindex, follow` — correct per Google guidelines.
