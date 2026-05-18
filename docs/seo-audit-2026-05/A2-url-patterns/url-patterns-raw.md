# A.2 — URL Pattern Inventory
Date: 2026-05-18

Sources read:
- `artifacts/api-server/src/index-web.ts` (lines 30–1014)
- `artifacts/api-server/src/url-redirect-middleware.ts` (full file)
- `artifacts/api-server/src/routes/seo-sitemap-routes.ts` (lines 1–1200)
- `artifacts/api-server/src/routes.ts` (lines 1–100)
- `artifacts/api-server/src/routes/misc-routes.ts` (full)
- `artifacts/api-server/src/routes/og-image-routes.ts` (full)
- `artifacts/api-server/src/routes/station-public-routes.ts` (lines 1–60)
- `artifacts/api-server/src/routes/genres-countries-routes.ts` (lines 1–60)
- `artifacts/api-server/src/routes/admin-auth-routes.ts` (lines 1–40)
- `artifacts/api-server/src/routes/user-auth-routes.ts` (lines 1–80)
- `artifacts/api-server/src/station-country-validator.ts` (full)
- `lib/seo-shared/src/seo-config.ts` (COUNTRY_TO_LANGUAGE partial)

---

## Critical Middleware Interceptors (runs before route handlers)

Execution order in `index-web.ts` (the frontend-web server, port 3000):

| Order | Name | File:Line | Intercept Condition | Action |
|-------|------|-----------|---------------------|--------|
| 1 | `geoBlockMiddleware` | `src/middleware/geo-block.ts` via `index-web.ts:53` | Blocked country IP | Drops TCP connection, no response |
| 2 | `GET /healthz` (eager route) | `index-web.ts:87` | Path === `/healthz` | Returns 200 `ok` immediately, skips all middleware |
| 3 | `GET /llms.txt` (eager route) | `index-web.ts:97` | Path === `/llms.txt` | Returns text/plain AI-agent manifest; bypasses URL-redirect and SSR middleware ordering issue |
| 4 | `GET /health` (eager route) | `index-web.ts:128` | Path === `/health` | Returns 200 JSON with memory/SSR/cache stats |
| 5 | Country-prefix 301 redirect | `index-web.ts:198–211` | Path matches `^/[a-z]{2}(/.*)?` AND first 2-letter segment is in `COUNTRY_PREFIX_REDIRECTS` (countries that are NOT themselves SEO language codes but map to one) | `301` to `/{targetLang}{rest}`. Example: `/qa/...` → `/ar/...`, `/in/...` → `/hi/...`, `/sy/...` → `/ar/...`, `/ph/...` → `/en/...` |
| 6 | Security headers + auth noindex | `index-web.ts:213–274` | All paths except `/cast-receiver*` | Sets `X-Robots-Tag: noindex, follow` for auth paths matching `AUTH_NOINDEX_PATH` regex; sets `index, follow, max-image-preview:large, ...` for all others. Sets `X-Content-Type-Options`, `Vary`, `X-Frame-Options: DENY`, CSP, HSTS, `Referrer-Policy`, `Permissions-Policy` |
| 7 | Canonical URL middleware (single 301) | `index-web.ts:289–345` | Non-dev, non-localhost, non-health paths | Collapses http→https, www→non-www, trailing-slash-strip into ONE 301. Skips in dev/localhost/replit preview |
| 8 | Request timeout middleware | `index-web.ts:347–368` | Non-asset, non-api, non-health paths | Sets 30-second timeout on HTML requests; returns 504 on expiry |
| 9 | Operation tracker | `index-web.ts:358–368` | Non-api, non-ws, non-health, non-asset paths | Tracks active operation count for observability |
| 10 | `urlRedirectMiddleware` | `src/url-redirect-middleware.ts` via `index-web.ts:370` | All non-api, non-asset, non-extension paths | Multi-step single-hop canonicalization (see "Redirect Chain Analysis" below); emits ONE 301 |
| 11 | `stationCountryValidator` | `src/station-country-validator.ts` via `index-web.ts:371` | Paths matching `^/[a-z]{2}/station/[slug]` | Validates language vs country code; passes through to next middleware (effectively a no-op after the country-prefix redirect above already ran) |
| 12 | `compression` | `index-web.ts:378–387` | All text/json/js/xml/svg responses | gzip level 1, threshold 1KB |
| 13 | Static file cache headers | `index-web.ts:392–428` | SW, manifest, and hashed asset paths | `no-cache` for service workers/manifest.json; `max-age=31536000, immutable` for `/assets/*` hashed files |
| 14 | `/cast-receiver` static | `index-web.ts:430–439` | Path starts with `/cast-receiver` | Serves cast receiver files with CORS `*`, `max-age=3600` |
| 15 | `/station-images` static | `index-web.ts:445` | Path starts with `/station-images` | Serves from `images/` dir, `max-age=86400, must-revalidate` |
| 16 | `/station-logos` static | `index-web.ts:448` | Path starts with `/station-logos` | Serves from `station-logos/` dir, `max-age=31536000, immutable` |
| 17 | `/api/image` proxy | `index-web.ts:525` | Path starts with `/api/image` | Proxies to `STREAM_PROXY_URL` (stream service); returns 502 on error |
| 18 | `/api/stream` proxy | `index-web.ts:526` | Path starts with `/api/stream` | Proxies to `STREAM_PROXY_URL` |
| 19 | `registerSeoSitemapRoutes` (local) | `index-web.ts:536` | SEO/sitemap API paths | Handles `/api/seo/page-data`, sitemap XML, robots.txt, `.well-known/*` locally without proxying to API |
| 20 | `/api` proxy | `index-web.ts:539–542` | All remaining `/api/*` paths | Proxies to `BACKEND_API_URL` (port 5000) |
| 21 | SSR middleware (universal renderer) | `index-web.ts:685–981` | `isSeoEligiblePage === true` (see regex table below) | Serves full SSR HTML to ALL visitors (not just bots since 2026-05-12 cloaking fix). 15-second timeout falls back to SPA. Cache-HIT: `public, max-age=3600, s-maxage=86400, stale-while-revalidate=3600`. Junk station → 410. Slug alias → 301. Not found → 404 + noindex |
| 22 | `htmlLangMiddleware` | `src/html-lang-middleware.ts` via `index-web.ts:983` | All HTML responses | Injects `window.__INITIAL_TRANSLATIONS__` into SPA shell |
| 23 | `bareSlugRedirectMiddleware` | `src/middleware/bare-slug-redirect.ts` via `index-web.ts:993` | Bare top-level country/genre slugs (e.g. `/en/turkey`, `/tr/pop`) | 301 to canonical SEO URL (`/en/regions/asia/turkey`, `/tr/genres/pop`) |
| 24 | `createSlugShape404Middleware` | `src/middleware/slug-shape-404.ts` via `index-web.ts:1001` | Invalid slug-shape paths matching regions/genres/station routes | Returns proper 404 for browser visitors hitting junk URLs |
| 25 | `serveStatic` | `src/serve-static.ts` via `index-web.ts:1008` | All remaining unmatched paths | Serves Vite SPA `index.html` as fallback (200 SPA shell) |

**AUTH_NOINDEX_PATH regex** (applied in step 6, intercepts before SSR):
```
/^(?:\/[a-z]{2})?\/(?:auth(?:\/.*)?|login|signup|sign-in|sign-up|register|forgot-password|reset-password|change-password)(?:\/|$)/i
```

**SEO-eligible page regexes** used by the SSR middleware (step 21):
- `stationPage`: `^/([a-z]{2}/)?(?:{all station/stations/radios translations})/`
- `homepage`: `^/([a-z]{2}/?)?$`
- `regionsPage`: `^/([a-z]{2}/?)?(?:{regions translations})(/.*)?$`
- `genresPage`: `^/([a-z]{2}/?)?(?:{genres translations})\/?(.*)$`
- `aboutPage`, `contactPage`, `privacyPage`, `faqPage`, `termsPage`, `applicationsPage`: language-prefixed translated paths
- `countryPage`: `^/([a-z]{2}/?)?country/.+$`
- `stationsPage`: listing page variant
- `searchPage`: `^/([a-z]{2}/?)?(?:{search translations})\/?(\?.*)?$`

---

## URL Pattern Table

### Root / Homepage

| Pattern | Source File:Line | Method | In Sitemap | Noindex Conditions | Redirect Target | Auth Required | Example URL |
|---------|-----------------|--------|------------|--------------------|-----------------|---------------|-------------|
| `/` | `url-redirect-middleware.ts:312–323` | GET | No (redirects) | — | 301 `/en` for bots; 302 `/{detectedLang}` for users | No | `https://themegaradio.com/` |

### Language-prefixed Homepages

| Pattern | Source File:Line | Method | In Sitemap | Noindex Conditions | Redirect Target | Auth Required | Example URL |
|---------|-----------------|--------|------------|--------------------|-----------------|---------------|-------------|
| `/{lang}` | SSR middleware `index-web.ts:643,700` | GET | Yes (sitemap-main-{lang}.xml) | None | — | No | `/en`, `/tr`, `/de` |
| `/{lang}/` (trailing slash) | Canonical middleware `index-web.ts:316` | GET | No | — | 301 `/{lang}` | No | `/en/` |
| `/?lang=xx` | `url-redirect-middleware.ts:270–285` | GET | No | — | 301 `/{xx}/{path}` | No | `/?lang=tr` |

### Station Detail Pages

| Pattern | Source File:Line | Method | In Sitemap | Noindex Conditions | Redirect Target | Auth Required | Example URL |
|---------|-----------------|--------|------------|--------------------|-----------------|---------------|-------------|
| `/{lang}/station/{slug}` | SSR `index-web.ts:699`, sitemap `seo-sitemap-routes.ts` | GET | Yes (sitemap-stations-{lang}-{n}.xml) | `noIndex:true` on station doc; junk station (`isJunkStation()`) → 410 Gone; `notFound` → 404+noindex | Slug alias → 301 canonical slug | No | `/en/station/bbc-world-service` |
| `/{lang}/{stationTranslated}/{slug}` | SSR (all translated station segments) | GET | Yes | Same as above | — | No | `/tr/istasyon/radyo-sputnik`, `/de/sender/deutschlandradio` |
| `/{lang}/stations/{slug}` | `url-redirect-middleware.ts:382–388` | GET | No | — | 301 `/{lang}/station/{slug}` (singular canonicalization) | No | `/en/stations/bbc-news` |
| `/{lang}/radios/{slug}` | `url-redirect-middleware.ts:382–388` | GET | No | — | 301 `/{lang}/station/{slug}` | No | `/en/radios/bbc-news` |
| `/station/{slug}` (bare, no lang) | `url-redirect-middleware.ts:337–343` | GET | No | — | 301 `/en/station/{slug}` | No | `/station/bbc-news` |

### Station List Pages

| Pattern | Source File:Line | Method | In Sitemap | Noindex Conditions | Redirect Target | Auth Required | Example URL |
|---------|-----------------|--------|------------|--------------------|-----------------|---------------|-------------|
| `/{lang}/stations` | SSR `index-web.ts:650` | GET | Yes (sitemap-main-{lang}.xml) | None | — | No | `/en/stations`, `/tr/istasyonlar` |
| `/{lang}/{stationsTranslated}` | SSR (all translations) | GET | Yes | None | — | No | `/de/sender`, `/es/estaciones` |
| `/{lang}/station` (singular, list-level) | `url-redirect-middleware.ts:393–399` | GET | No | — | 301 `/{lang}/stations` | No | `/en/station` |
| `/{lang}/radios` (list-level) | `url-redirect-middleware.ts:393–399` | GET | No | — | 301 `/{lang}/stations` | No | `/en/radios` |
| `/stations` (bare) | `url-redirect-middleware.ts:337–343` | GET | No | — | 301 `/en/stations` | No | `/stations` |
| `/{lang}/radyolar`, `/{lang}/радио`, etc. | `url-redirect-middleware.ts:156–175` `USER_TYPED_LIST_ALIASES` | GET | No | — | 301 `/{lang}/stations-canonical` | No | `/tr/radyolar` |

### Genre Pages

| Pattern | Source File:Line | Method | In Sitemap | Noindex Conditions | Redirect Target | Auth Required | Example URL |
|---------|-----------------|--------|------------|--------------------|-----------------|---------------|-------------|
| `/{lang}/genres` | SSR `index-web.ts:645,702` | GET | Yes (sitemap-main-{lang}.xml) | None | — | No | `/en/genres`, `/tr/türler` |
| `/{lang}/genres/{genreSlug}` | SSR `index-web.ts:702` | GET | Yes (sitemap-genres-{lang}.xml) | None | — | No | `/en/genres/pop`, `/de/genres/jazz` |
| `/{lang}/{genresTranslated}` | SSR (translated `genres` segment) | GET | Yes | None | — | No | `/de/genres/pop` |
| `/{lang}/{genresTranslated}/{genreSlug}` | SSR | GET | Yes | None | — | No | `/tr/türler/pop` |
| `/genres` (bare) | `url-redirect-middleware.ts:337–343` | GET | No | — | 301 `/en/genres` | No | `/genres` |

### Country Pages

| Pattern | Source File:Line | Method | In Sitemap | Noindex Conditions | Redirect Target | Auth Required | Example URL |
|---------|-----------------|--------|------------|--------------------|-----------------|---------------|-------------|
| `/{lang}/country/{countrySlug}` | SSR `index-web.ts:649,706` | GET | No (not in sitemap-main; bare-slug-redirect handles discovery) | None | — | No | `/en/country/turkey` |

### Region Pages

| Pattern | Source File:Line | Method | In Sitemap | Noindex Conditions | Redirect Target | Auth Required | Example URL |
|---------|-----------------|--------|------------|--------------------|-----------------|---------------|-------------|
| `/{lang}/regions` | SSR `index-web.ts:644,701` | GET | Yes (sitemap-main-{lang}.xml) | None | — | No | `/en/regions` |
| `/{lang}/regions/{continent}` | SSR | GET | Yes (sitemap-main-{lang}.xml — europe/asia/africa/north-america/south-america/oceania) | None | — | No | `/en/regions/europe` |
| `/{lang}/regions/{continent}/{countrySlug}` | SSR | GET | Indirectly via top-countries in sitemap-main | None | — | No | `/en/regions/europe/germany` |
| `/{lang}/{regionsTranslated}` | SSR (translated segments) | GET | Yes | None | — | No | `/tr/bölgeler` |
| `/regions` (bare) | `url-redirect-middleware.ts:337–343` | GET | No | — | 301 `/en/regions` | No | `/regions` |
| `/{lang}/turkey` (bare country slug) | `bareSlugRedirectMiddleware` `index-web.ts:992` | GET | No | — | 301 `/en/regions/asia/turkey` | No | `/en/turkey` |

### Search Pages

| Pattern | Source File:Line | Method | In Sitemap | Noindex Conditions | Redirect Target | Auth Required | Example URL |
|---------|-----------------|--------|------------|--------------------|-----------------|---------------|-------------|
| `/{lang}/search` | SSR `index-web.ts:651,707` | GET | No (robots.txt: `Disallow: /*/search`) | `X-Robots-Tag: index,follow` set by default headers (NOT noindex via the AUTH regex); however robots.txt Disallows it | — | No | `/en/search` |
| `/{lang}/search?q=...` | SSR + robots.txt | GET | No | robots.txt: `Disallow: /*?*q=` | — | No | `/en/search?q=jazz` |
| `/{lang}/{searchTranslated}` | SSR | GET | No | robots.txt Disallow | — | No | `/tr/arama` |

**NOTE — Search Indexing Risk:** The robots.txt has `Disallow: /*/search` but `X-Robots-Tag` does NOT add `noindex` for search pages. There is a divergence: robots.txt blocks crawl, but if Google happened to index via a link, the page would not emit `noindex`. This is a minor inconsistency but is expected behavior (robots.txt blocks are sufficient).

### Static Pages

| Pattern | Source File:Line | Method | In Sitemap | Noindex Conditions | Redirect Target | Auth Required | Example URL |
|---------|-----------------|--------|------------|--------------------|-----------------|---------------|-------------|
| `/{lang}/about` | SSR `index-web.ts:703` | GET | Yes (sitemap-main-{lang}.xml) | None | — | No | `/en/about` |
| `/{lang}/{aboutTranslated}` | SSR | GET | Yes | None | — | No | `/tr/hakkında` |
| `/{lang}/contact` | SSR `index-web.ts:704` | GET | Yes (sitemap-main-{lang}.xml) | None | — | No | `/en/contact` |
| `/{lang}/privacy-policy` | SSR `index-web.ts:705` | GET | Yes (sitemap-main-{lang}.xml) | None | — | No | `/en/privacy-policy` |
| `/{lang}/terms-and-conditions` | SSR `index-web.ts:710` | GET | Yes (sitemap-main-{lang}.xml) | None | — | No | `/en/terms-and-conditions` |
| `/{lang}/faq` | SSR `index-web.ts:709` | GET | Yes (sitemap-main-{lang}.xml) | None | — | No | `/en/faq` |
| `/{lang}/applications` | SSR `index-web.ts:711` | GET | Yes (sitemap-main-{lang}.xml) | None | — | No | `/en/applications` |
| `/{lang}/{translatedVariants}` for all above | SSR (translated) | GET | Yes | None | — | No | `/de/datenschutz`, `/tr/gizlilik-politikasi` |
| `/about`, `/contact`, etc. (bare) | `url-redirect-middleware.ts:337–343` | GET | No | — | 301 `/en/{translated}` | No | `/about` |

### Auth Pages (Frontend Routes)

| Pattern | Source File:Line | Method | In Sitemap | Noindex Conditions | Redirect Target | Auth Required | Example URL |
|---------|-----------------|--------|------------|--------------------|-----------------|---------------|-------------|
| `/login`, `/{lang}/login` | `index-web.ts:45` AUTH_NOINDEX regex | GET | No | `X-Robots-Tag: noindex, follow` | — | No | `/en/login` |
| `/signup`, `/{lang}/signup` | AUTH_NOINDEX regex | GET | No | `noindex, follow` | — | No | `/en/signup` |
| `/sign-in`, `/sign-up`, `/register` | AUTH_NOINDEX regex | GET | No | `noindex, follow` | — | No | `/sign-in` |
| `/forgot-password`, `/{lang}/forgot-password` | AUTH_NOINDEX regex | GET | No | `noindex, follow` | — | No | `/en/forgot-password` |
| `/reset-password`, `/change-password` | AUTH_NOINDEX regex | GET | No | `noindex, follow` | — | No | `/reset-password` |
| `/auth/*`, `/{lang}/auth/*` | AUTH_NOINDEX regex | GET | No | `noindex, follow` | — | No | `/auth/callback` |

### Admin Frontend Routes (served as 404)

| Pattern | Source File:Line | Method | In Sitemap | Noindex Conditions | Redirect Target | Auth Required | Example URL |
|---------|-----------------|--------|------------|--------------------|-----------------|---------------|-------------|
| `/admin` | `index-web.ts:501` | GET | No | `X-Robots-Tag: noindex, nofollow` + HTTP 404 | — | No (returns 404) | `/admin` |
| `/admin-login` | `index-web.ts:500` | GET | No | `noindex, nofollow` + HTTP 404 | — | No (returns 404) | `/admin-login` |
| `/admin/*path` | `index-web.ts:502` | GET | No | `noindex, nofollow` + HTTP 404 | — | No (returns 404) | `/admin/stations` |

### Sitemap Routes

| Pattern | Source File:Line | Method | In Sitemap | Noindex Conditions | Redirect Target | Auth Required | Example URL |
|---------|-----------------|--------|------------|--------------------|-----------------|---------------|-------------|
| `/robots.txt` | `seo-sitemap-routes.ts:954` | GET | — | — | — | No | `/robots.txt` |
| `/sitemap-index.xml` | `seo-sitemap-routes.ts` | GET | — | — | — | No | `/sitemap-index.xml` |
| `/sitemap.xml` | `seo-sitemap-routes.ts` | GET | — | — | — | No | `/sitemap.xml` (alias to index) |
| `/sitemap-main-{lang}.xml` | `seo-sitemap-routes.ts:1125` | GET | — | 503 if qualified-langs unavailable; 410 if lang not qualified | — | No | `/sitemap-main-en.xml` |
| `/sitemap-genres-{lang}.xml` | `seo-sitemap-routes.ts` | GET | — | 410 if lang not qualified | — | No | `/sitemap-genres-tr.xml` |
| `/sitemap-stations-{lang}-{n}.xml` | `seo-sitemap-routes.ts` | GET | — | 410 if lang not qualified or chunk missing | — | No | `/sitemap-stations-en-1.xml` |
| `/llms.txt` | `index-web.ts:97` (early) + `seo-sitemap-routes.ts:935` (canonical) | GET | — | — | — | No | `/llms.txt` |

### Well-Known Routes

| Pattern | Source File:Line | Method | In Sitemap | Noindex Conditions | Redirect Target | Auth Required | Example URL |
|---------|-----------------|--------|------------|--------------------|-----------------|---------------|-------------|
| `/.well-known/apple-app-site-association` | `seo-sitemap-routes.ts:444` | GET | No | — | — | No | `/.well-known/apple-app-site-association` |
| `/.well-known/assetlinks.json` | `seo-sitemap-routes.ts:466` | GET | No | — | — | No | `/.well-known/assetlinks.json` |

### Special / Miscellaneous Routes

| Pattern | Source File:Line | Method | In Sitemap | Noindex Conditions | Redirect Target | Auth Required | Example URL |
|---------|-----------------|--------|------------|--------------------|-----------------|---------------|-------------|
| `/ads.txt` | `misc-routes.ts:740` | GET | — | — | — | No | `/ads.txt` |
| `/app-ads.txt` | `misc-routes.ts:747` | GET | — | — | — | No | `/app-ads.txt` |
| `/healthz` | `index-web.ts:87` | GET | — | — | — | No | `/healthz` |
| `/health` | `index-web.ts:128` | GET | — | — | — | No | `/health` |
| `/api/og-image/:stationSlug` | `og-image-routes.ts:6` | GET | No | — | — | No | `/api/og-image/bbc-world-service` |
| `/api/og-image` | `og-image-routes.ts:27` | GET | No | — | — | No | `/api/og-image` |
| `/uploads/{filename}` | `misc-routes.ts:34` | GET | No | — | — | No | `/uploads/ad-xyz123.png` |
| `/ws/*` | `index-web.ts:558` | WS | — | — | — | No | `/ws/metadata` |

### API Routes — Public Station

| Pattern | Source File:Line | Method | In Sitemap | Noindex Conditions | Redirect Target | Auth Required | Example URL |
|---------|-----------------|--------|------------|--------------------|-----------------|---------------|-------------|
| `/api/station/:identifier` | `station-public-routes.ts:43` | GET | No | — | — | No | `/api/station/bbc-world-service` |
| `/api/stations` | `station-public-routes.ts` | GET | No | — | — | No | `/api/stations` |
| `/api/stations/popular` | `station-public-routes.ts` | GET | No | — | — | No | `/api/stations/popular` |
| `/api/stations/report-error` | `seo-sitemap-routes.ts:219` | POST | No | — | — | No | `/api/stations/report-error` |

### API Routes — Genres / Countries

| Pattern | Source File:Line | Method | In Sitemap | Noindex Conditions | Redirect Target | Auth Required | Example URL |
|---------|-----------------|--------|------------|--------------------|-----------------|---------------|-------------|
| `/api/genres` | `genres-countries-routes.ts` | GET | No | — | — | No | `/api/genres` |
| `/api/genres/:slug` | `genres-countries-routes.ts` | GET | No | — | — | No | `/api/genres/pop` |
| `/api/countries` | `genres-countries-routes.ts` | GET | No | — | — | No | `/api/countries` |
| `/api/ml/track-interaction` | `genres-countries-routes.ts:16` | POST | No | — | — | No | `/api/ml/track-interaction` |
| `/api/ml/user-profile/:sessionId` | `genres-countries-routes.ts:49` | GET | No | — | — | No | `/api/ml/user-profile/abc123` |

### API Routes — Auth

| Pattern | Source File:Line | Method | In Sitemap | Noindex Conditions | Redirect Target | Auth Required | Example URL |
|---------|-----------------|--------|------------|--------------------|-----------------|---------------|-------------|
| `/api/admin/login` | `admin-auth-routes.ts:8` | POST | No | — | — | No (credential-based) | `/api/admin/login` |
| `/api/auth/google` | `user-auth-routes.ts` | GET | No | robots.txt: `Disallow: /api/auth/` | — | No | `/api/auth/google` |
| `/api/auth/google/callback` | `user-auth-routes.ts` | GET | No | — | — | No | `/api/auth/google/callback` |
| `/api/auth/facebook` | `user-auth-routes.ts` | GET | No | — | — | No | `/api/auth/facebook` |
| `/api/auth/apple` | `user-auth-routes.ts` | GET | No | — | — | No | `/api/auth/apple` |
| `/api/auth/logout` | `user-auth-routes.ts` | POST | No | — | — | No | `/api/auth/logout` |
| `/api/auth/me` | `user-auth-routes.ts` | GET | No | — | — | Yes | `/api/auth/me` |

### API Routes — User/Subscription

| Pattern | Source File:Line | Method | In Sitemap | Noindex Conditions | Redirect Target | Auth Required | Example URL |
|---------|-----------------|--------|------------|--------------------|-----------------|---------------|-------------|
| `/api/user/subscription` | `misc-routes.ts:493,603` | GET, POST | No | robots.txt: `Disallow: /api/user/` | — | Yes | `/api/user/subscription` |
| `/api/user/subscription/cancel` | `misc-routes.ts:642` | POST | No | — | — | Yes | `/api/user/subscription/cancel` |

### API Routes — IAP

| Pattern | Source File:Line | Method | In Sitemap | Noindex Conditions | Redirect Target | Auth Required | Example URL |
|---------|-----------------|--------|------------|--------------------|-----------------|---------------|-------------|
| `/api/iap/validate` | `iap-validation-routes.ts` | POST | No | robots.txt: `Disallow: /api/iap/` | — | Yes | `/api/iap/validate` |
| `/api/webhooks/apple` | `iap-apple-webhook.ts` | POST | No | — | — | No (HMAC-signed) | `/api/webhooks/apple` |

### API Routes — SEO/Sitemap Admin

| Pattern | Source File:Line | Method | In Sitemap | Noindex Conditions | Redirect Target | Auth Required | Example URL |
|---------|-----------------|--------|------------|--------------------|-----------------|---------------|-------------|
| `/api/seo/page-data` | `seo-sitemap-routes.ts:485` | GET | No | — | — | No | `/api/seo/page-data?url=/en/station/bbc` |
| `/api/admin/sitemap/rebuild` | `seo-sitemap-routes.ts:509` | POST | No | — | — | Yes (admin) | `/api/admin/sitemap/rebuild` |
| `/api/admin/sitemap/touch-stations` | `seo-sitemap-routes.ts:647` | POST | No | — | — | Yes (admin) | `/api/admin/sitemap/touch-stations` |
| `/api/admin/sitemap/manifest-stats` | `seo-sitemap-routes.ts:820` | GET | No | — | — | Yes (admin) | `/api/admin/sitemap/manifest-stats` |
| `/api/admin/error-logs` | `seo-sitemap-routes.ts:338` | GET | No | — | — | Yes (admin) | `/api/admin/error-logs` |

### API Routes — Admin (General)

| Pattern | Source File:Line | Method | In Sitemap | Noindex Conditions | Redirect Target | Auth Required | Example URL |
|---------|-----------------|--------|------------|--------------------|-----------------|---------------|-------------|
| `/api/admin/users` | `misc-routes.ts:331` | GET | No | robots.txt: `Disallow: /api/admin/` | — | Yes (admin) | `/api/admin/users` |
| `/api/admin/users/:id` | `misc-routes.ts:393,431` | PATCH, DELETE | No | — | — | Yes (admin) | `/api/admin/users/abc123` |
| `/api/admin/users/export.csv` | `misc-routes.ts:178` | GET | No | — | — | Yes (admin) | `/api/admin/users/export.csv` |
| `/api/admin/users/:id/subscription` | `misc-routes.ts:689` | PATCH | No | — | — | Yes (admin) | `/api/admin/users/abc123/subscription` |
| `/api/admin/advertisements` | `misc-routes.ts:81` | GET, POST | No | — | — | Yes (admin) | `/api/admin/advertisements` |
| `/api/admin/advertisements/:id` | `misc-routes.ts:104,114` | PATCH, DELETE | No | — | — | Yes (admin) | `/api/admin/advertisements/xyz` |
| `/api/admin/advertisements/upload` | `misc-routes.ts:56` | POST | No | — | — | Yes (admin) | `/api/admin/advertisements/upload` |
| `/api/admin/footer-social-media` | `misc-routes.ts:133` | GET, POST | No | — | — | Yes (admin) | `/api/admin/footer-social-media` |
| `/api/admin/footer-social-media/:id` | `misc-routes.ts:154,164` | PATCH, DELETE | No | — | — | Yes (admin) | `/api/admin/footer-social-media/xyz` |
| `/api/admin/seo-metadata` | `misc-routes.ts:902` | GET, POST | No | — | — | Yes (admin) | `/api/admin/seo-metadata` |
| `/api/admin/seo-metadata/:id` | `misc-routes.ts:917` | GET, PATCH, DELETE | No | — | — | Yes (admin) | `/api/admin/seo-metadata/xyz` |
| `/api/admin/seo-metadata/stats` | `misc-routes.ts:969` | GET | No | — | — | Yes (admin) | `/api/admin/seo-metadata/stats` |
| `/api/admin/seo-metadata/page-types` | `misc-routes.ts:978` | GET | No | — | — | Yes (admin) | `/api/admin/seo-metadata/page-types` |
| `/api/admin/seo-metadata/bulk-status` | `misc-routes.ts:959` | POST | No | — | — | Yes (admin) | `/api/admin/seo-metadata/bulk-status` |
| `/api/admin/seo-metadata/generate-draft` | `misc-routes.ts:982` | POST | No | — | — | Yes (admin) | `/api/admin/seo-metadata/generate-draft` |
| `/api/admin/listening-history` | `misc-routes.ts:997` | GET | No | — | — | Yes (admin) | `/api/admin/listening-history` |
| `/api/admin/feedback` | `misc-routes.ts:1011` | GET | No | — | — | Yes (admin) | `/api/admin/feedback` |
| `/api/admin/feedback/:id` | `misc-routes.ts:1061,1086` | PATCH, DELETE | No | — | — | Yes (admin) | `/api/admin/feedback/xyz` |
| `/api/admin/app-logs` | `misc-routes.ts:877` | GET | No | — | — | Yes (admin) | `/api/admin/app-logs` |
| `/api/admin/app-logs/crashes` | `misc-routes.ts:891` | GET | No | — | — | Yes (admin) | `/api/admin/app-logs/crashes` |

### API Routes — Remote Logging (API-key gated, not admin session)

| Pattern | Source File:Line | Method | In Sitemap | Noindex Conditions | Redirect Target | Auth Required | Example URL |
|---------|-----------------|--------|------------|--------------------|-----------------|---------------|-------------|
| `/api/logs/remote` | `misc-routes.ts:757,773,859` | GET, POST, DELETE | No | robots.txt: `Disallow: /api/logs/` | — | API key header | `/api/logs/remote` |
| `/api/logs/remote/stats` | `misc-routes.ts:810` | GET | No | — | — | API key header | `/api/logs/remote/stats` |

### API Routes — Advertisements / TV / Other Public

| Pattern | Source File:Line | Method | In Sitemap | Noindex Conditions | Redirect Target | Auth Required | Example URL |
|---------|-----------------|--------|------------|--------------------|-----------------|---------------|-------------|
| `/api/advertisements` | `misc-routes.ts:65` | GET | No | — | — | No | `/api/advertisements` |
| `/api/footer-social-media` | `misc-routes.ts:124` | GET | No | — | — | No | `/api/footer-social-media` |
| `/api/tv/bundle` | `misc-routes.ts:1097` | GET | No | robots.txt: `Disallow: /api/tv/` | — | No | `/api/tv/bundle` |

---

## Redirect Chain Analysis

### Step-by-step canonicalization in `urlRedirectMiddleware` (single-hop, `url-redirect-middleware.ts`)

All transformations are accumulated in memory and emitted as **one 301**. Previously this was a chain of individual 301s; the 2026-05-13 refactor collapsed them.

**Step 1 — `?lang=xx` query param → path prefix**
- Input: `/path?lang=tr`
- Transform: strips `lang` param, prepends `/tr`, removes existing lang/country prefix if present
- Output: `/tr/path` (then continues to further steps)

**Step 2 — ASCII lowercase + RFC 3986 percent-hex uppercase**
- Input: `/EN/STATIONS/ABC%c4%8D`
- Output: `/en/stations/ABC%C4%8D`
- **2026-05-15 bugfix**: previously lowercased entire segment including `%xx` hex → infinite redirect loop (Semrush reported 7,694 redirect loops for non-ASCII slugs). Fixed to only lowercase ASCII A-Z; percent-encoded triplets are uppercased.

**Step 3 — Root path (`/`) → single-hop redirect**
- Bots (Googlebot/Bingbot/Yandex/Baidu/DuckDuck/Applebot): `301 /en` (deterministic canonical)
- Real users: `302 /{geo-detected-lang}` (based on CF-IPCountry → cookie → Accept-Language → fallback `en`)

**Step 4 — Bare known route without lang prefix → `/en/{translated}`**
- Input: `/stations`, `/genres`, `/about`, `/contact`, etc.
- Output: `301 /en/{english-translation-or-self}`
- CRITICAL: always resolves to `/en/` regardless of user's language. This is intentional — 301s are cached by CDN/browser permanently; geo-dependent 301s would poison cross-user caches.

**Step 5a — Cross-language segment normalization**
- Input: `/de/istasyon/x` (Turkish station word in German path)
- Looks up `istasyon` in `GLOBAL_REVERSE_URL_TRANSLATIONS` → finds `station` (English) → maps `de:station` → `sender`
- Output: `301 /de/sender/x`

**Step 5b — Old English path in non-English URL**
- Input: `/tr/station/radyo-sputnik` (English `station` in Turkish URL)
- Looks up `tr:station` in DB/static translations → `istasyon`
- Output: `301 /tr/istasyon/radyo-sputnik`

**Step 6 — Station-detail synonym collapse (3-segment paths)**
- Languages have up to 3 URL synonyms: singular (`stazione`), plural (`stazioni`), radios (`radio`)
- Canonical = singular form (`tr.station`)
- Input: `/it/stazioni/my-radio`, `/it/radio/my-radio`
- Output: `301 /it/stazione/my-radio`

**Step 7 — Station-list synonym collapse (2-segment paths)**
- Canonical = plural form (`tr.stations`) to match sitemap URLs
- Input: `/it/stazione` (2-seg listing), `/it/radio`
- Output: `301 /it/stazioni`
- **2026-05-15 flip**: canonical changed from `.radios` to `.stations` to match sitemap entries (previously sitemap submitted `/tr/istasyonlar` but canonical was `/tr/radyo`, causing GSC "Submitted URL is a redirect" warnings)

**Step 8 — Slug alias collapse (3-segment station-detail paths)**
- After step 6 has canonicalized `segments[1]`, checks `getCanonicalStationSlug(segments[2])` against the in-memory slug-existence set
- If an alias exists, collapses to canonical slug in the same 301
- Exception: if canonical target is `isJunkStation()` or `noIndex:true`, does NOT 301 → SSR serves 410 Gone instead, preventing ranking from consolidating onto a deindexed page
- Cache-Control on this class of 301: `public, max-age=300, must-revalidate` (5 min, not permanent, in case aliases are removed)

### Country-code prefix redirects (`index-web.ts:198–211`)

These run BEFORE `urlRedirectMiddleware` and produce a standalone 301. Countries that have a COUNTRY_TO_LANGUAGE mapping but are NOT themselves SEO language codes get redirected:

| Incoming prefix | Target lang | Example |
|----------------|-------------|---------|
| `qa` (Qatar) | `ar` | `/qa/...` → `/ar/...` |
| `sy` (Syria) | `ar` | `/sy/...` → `/ar/...` |
| `in` (India) | `hi` | `/in/...` → `/hi/...` |
| `ph` (Philippines) | `en` | `/ph/...` → `/en/...` |
| `cn` (China) | `zh` | `/cn/...` → `/zh/...` |
| (many others from COUNTRY_TO_LANGUAGE map) | varies | `/[country]/...` → `/[lang]/...` |

**Note**: This redirect runs at `index-web.ts:198` — BEFORE `urlRedirectMiddleware`. If a country code URL also needs lowercase normalization, it will be a 2-hop chain (country-prefix 301 → lowercase 301). However, the canonical middleware at step 7 (https/www/trailing-slash) runs before both, so the combined max chain is 2 hops.

### Canonical URL middleware redirects (`index-web.ts:289–345`)

Collapses up to 3 transforms into one 301:
1. `http://` → `https://` (production only, skips replit/localhost)
2. `www.themegaradio.com` → `themegaradio.com`
3. Trailing slash removal (except root `/` and files with extensions)

### `/` root geo-redirect

- Bots: `301 /en` (permanent, cacheable)
- Users: `302 /{detectedLang}` (temporary, not cached)
- Detection priority: `CF-IPCountry` header → `preferredLanguage` cookie → `Accept-Language` header → fallback `en`

### SSR slug-alias 301 (`index-web.ts:909–922`)

When SSR resolves a station via a slug alias (not the canonical slug), it returns:
- `301` to `/{lang}/{stationSegment}/{canonicalSlug}`
- `Cache-Control: public, max-age=300, must-revalidate` (short: 5 min)
- This fires AFTER the middleware-level slug alias collapse (Step 8) only catches known aliases; new aliases from the DB that haven't warmed the slug-existence set yet fall through to this SSR-level redirect

---

## Key Observations for SEO

### 1. Potential 2-hop redirect chain for country-prefix URLs

The country-prefix redirect middleware (`index-web.ts:198`) is a SEPARATE middleware from `urlRedirectMiddleware`. A request like `/QA/ISTASYON/slug` would chain:
1. Country-prefix 301: `/QA/ISTASYON/slug` → `/ar/ISTASYON/slug` (case not yet lowercased)
2. `urlRedirectMiddleware` 301: `/ar/ISTASYON/slug` → `/ar/istasyon/slug` (lowercase + step 5a cross-lang normalization)

This is a 2-hop redirect chain that could still affect crawl budget for URLs with country codes that need case normalization. Pure lowercase country-code URLs avoid the second hop.

### 2. `/search` robots.txt vs X-Robots-Tag inconsistency

`robots.txt` contains:
```
Disallow: /*/search
Disallow: /*?*q=
```
But `index-web.ts:216–220` only applies `noindex` to AUTH_NOINDEX_PATH; search pages receive the default `X-Robots-Tag: index, follow`. If Googlebot somehow accesses a search page via a link (e.g., linked from another page), it would receive `index, follow` but robots.txt says Disallow. This creates a "Indexed though blocked" scenario in Search Console. The safer fix is to also add search paths to AUTH_NOINDEX_PATH or emit `X-Robots-Tag: noindex` from the SSR renderer for search pages.

### 3. Station-list canonical flip risk (2026-05-15)

The station-list canonical was changed from `.radios` to `.stations` (Step 7 in the redirect middleware). If any CDN or browser previously cached a 301 from `/tr/istasyonlar` → `/tr/radyo` (old canonical), those clients will keep going to the old URL. The TTL on 301s in browsers is indefinite unless `Cache-Control: max-age` was set explicitly. Verify that no old 301s pointing from `.stations` URLs to `.radios` URLs are still cached in Cloudflare. Use a Cache-Control header on the old redirect if re-registering.

### 4. `/admin`, `/admin-login`, `/admin/*path` return 404 with `noindex, nofollow`

These routes are intentionally served as HTTP 404 with `X-Robots-Tag: noindex, nofollow`. This is the correct behavior — prevents Google from "Indexed though 404" reports. However, any external links pointing to `/admin` will spend crawl budget on a 404 response. Verify that `robots.txt` explicitly disallows `/admin*` to prevent crawling entirely.

robots.txt contains:
```
Disallow: /*/admin/
Disallow: /*/admin
```
But does NOT contain `Disallow: /admin` (bare, no lang prefix). This means Googlebot could technically crawl `/admin` and receive the 404+noindex response. Add `Disallow: /admin` to robots.txt.

### 5. SSR cloaking fix (2026-05-12) — all visitors now receive SSR HTML

Previously only bots received SSR HTML; real users received the SPA shell. This was classified as "dynamic rendering" (deprecated by Google in 2022, treated as potential cloaking). As of 2026-05-12, ALL visitors receive SSR HTML for SEO-eligible pages. Performance impact is absorbed by `Cache-Control: public, max-age=3600, s-maxage=86400` at the Cloudflare edge.

### 6. Junk station 410 behavior

Stations with `isJunkStation() === true` or `noIndex: true` return HTTP 410 Gone instead of 200+noindex. This is the correct SEO approach — Google de-indexes 410 responses faster than noindex pages and removes the URL from the crawl queue entirely.

### 7. Dual `/llms.txt` handlers (potential divergence risk)

There are two handlers for `/llms.txt`:
- Early-mount at `index-web.ts:97` (runs before all middleware)
- Canonical in `seo-sitemap-routes.ts:935`

Both call `buildLlmsTxtBody()` so the output should be byte-identical. The early-mount was added as a workaround for a middleware ordering bug (the SSR catch-all was intercepting `/llms.txt` and returning SPA HTML). Risk: if `buildLlmsTxtBody()` is updated, both handlers must be kept in sync. Architectural debt to be cleaned up.

### 8. `sitemap-main-{lang}.xml` main pages list

The main pages list (`seo-sitemap-routes.ts:1189`) is hardcoded:
```
['', '/stations', '/genres', '/about', '/regions', '/regions/europe', '/regions/asia',
 '/regions/africa', '/regions/north-america', '/regions/south-america', '/regions/oceania',
 '/faq', '/contact', '/privacy-policy', '/terms-and-conditions', '/applications']
```
These must match `MAIN_STATIC_PAGES` in `sitemap-manifest-builder.ts`. If they diverge, `urlCount`/`maxUpdatedAt` in the manifest will be incorrect, causing ETag mismatches and potentially stale sitemap serving.

### 9. `stationCountryValidator` is effectively a no-op

`station-country-validator.ts` was written for the old country-code URL architecture. It now simply calls `next()` for valid language codes and also calls `next()` for unrecognized codes (deferring to the redirect middleware). This middleware adds overhead without benefit and could be removed.

### 10. `/api/stream/*` and `/api/image/*` are robots.txt Disallowed

Both of these are also intercepted early at `index-web.ts:525–526` (proxied to the stream service) before the `/api` catch-all proxy. This is correct behavior. The robots.txt `Disallow: /api/stream/` and `Disallow: /api/image/` rules reinforce this.

### 11. Per-language sitemap 503 vs 410 logic

- Unqualified language codes return `410 Gone` (permanent removal signal to Google/Bing)
- Cold boot (manifest not yet built) returns `503 Service Unavailable` with `Retry-After: 120`
- This distinction is correct: 410 removes the URL from crawl queue; 503 tells the crawler to retry later

### 12. Qualified-languages shrink protection

The `/api/admin/sitemap/rebuild` endpoint explicitly resets the LKG (last-known-good) qualified languages before rebuilding. Without `resetLkg: true`, a 50% shrink-protection guard would prevent the new language set from being smaller than the previous LKG, causing "zombie languages" (dequalified languages that keep appearing in sitemaps).
