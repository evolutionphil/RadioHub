# Mega Radio Station Management System

## Overview
The Mega Radio Station Management System is a full-stack application for global radio station streaming and broadcasting, designed to deliver personalized listening experiences and comprehensive management tools for broadcasters. Key capabilities include support for diverse audio formats, interactive user functionalities, geolocation-based content delivery, advanced search, trend analysis, and AI-driven recommendations. The project aims to become a leading online radio platform, enhancing listener engagement and streamlining broadcaster operations through a robust and scalable architecture, thus presenting significant market potential.

## User Preferences
Preferred communication style: Simple, everyday language.

CRITICAL UI RULE: Never use duplicate headers and footers - RadioHeader and Footer are already provided by the main App.tsx PlayerWrapper, so individual pages should NEVER import or include their own RadioHeader/Footer components.

CRITICAL ADMIN UI RULE: Edit popups and admin dialogs must ALWAYS stay light/white theme, never dark theme. User preference: popups should always be bright with light backgrounds and dark text for readability.

CRITICAL SEO HEADING RULE: Only ONE H1 per page (provided by server-rendered content in seo-renderer.ts). All content sections (RadioFAQ, About, etc.) must use H2 for main headings and H3/H4 for subsections to maintain proper heading hierarchy across all 57 languages.

CRITICAL SEO COMPLIANCE RULE: NO sr-only H3 headings with SEO keywords on any page (Google Hidden Text policy). NO PURE boilerplate template text in SSR body — but station-specific enriched intro/outro IS allowed (Google Scaled Content Abuse policy). SSR station body MUST contain in order: (1) station logo `<figure>`, (2) `<h2>About</h2>`, (3) **H1-keyword echo intro** (1 sentence, MUST interpolate `{STATION}` + `{COUNTRY}` — translation key `seo_station_intro_sentence`), (4) AI description paragraph(s), (5) **station-specific outro** (25-35 words, MUST interpolate `{STATION}` + `{COUNTRY}` + `{GENRES}` from real `stationData.tags` — translation key `seo_station_outro_sentence`), (6) station details section, (7) nav links. Intro+outro are NOT scaled boilerplate because they interpolate real per-station data (name + country + top-3 tags). Junk station 410 path bypasses intro/outro/AI desc entirely (sendJunkGone). i18n DB keys `seo_station_intro_sentence` and `seo_station_outro_sentence` should be translated to all 57 languages over time; until then `getLocalizedText` falls back to English template.

CRITICAL LASTMOD RULE: Station sitemaps must ONLY include `<lastmod>` when real `updatedAt` data exists in the DB. If `updatedAt` is missing, omit `<lastmod>` entirely — never use today's date as fallback (Google treats fake lastmod as spam signal).

CRITICAL UGC RULE: User-submitted comments are stripped of HTML tags on input (max 1000 chars) and on output. Any future comment rendering with links MUST use `rel="nofollow ugc noopener"` to comply with Google's UGC spam policy.

CRITICAL SITEMAP RULE: sitemap-index.xml references ONLY existing routes: sitemap-main-{lang}.xml, sitemap-genres-{lang}.xml, sitemap-stations-{chunk}.xml. Never add sitemap-images-*, sitemap-stations-{digit}.xml, sitemap-news.xml, sitemap-videos.xml back — these violate Google policies or don't exist. robots.txt must only list sitemap-index.xml. sitemap-main.xml is a 301 redirect to sitemap-main-en.xml. Deprecated sitemap URLs (/sitemap-news.xml, /sitemap-videos.xml, /sitemap-images-*.xml, /sitemap-stations-{digit}.xml) return 410 Gone to prevent soft-404.

CRITICAL ROBOTS.TXT RULE: `Disallow: /api/` blocks Google WRS (Web Rendering Service) from fetching API endpoints during JavaScript rendering, which causes React to show "Station not found" even when SSR is correct. Critical API paths MUST have explicit `Allow:` rules BEFORE the `Disallow: /api/` line: `/api/station/`, `/api/stations/`, `/api/genres`, `/api/translations`, `/api/location`, `/api/advertisements`. Never remove these Allow rules or Google will see blank/error pages after JS render.

CRITICAL HREFLANG RULE: ALL sitemaps use plain language codes (en, de, tr) — NEVER ISO codes (en-US, de-DE). All URLs in sitemaps must be language-prefixed (/en/stations not /stations). Every URL must have x-default hreflang pointing to the /en/ version. SSR renderer outputs ALL 57 language hreflang tags on every page (not just x-default).

CRITICAL BREADCRUMB JSON-LD RULE: BreadcrumbList JSON-LD `item` URLs in seo-renderer.ts must NEVER end with trailing slash (e.g., use `${baseDomain}/${language}` NOT `${baseDomain}/${language}/`). Trailing-slash URLs in structured data cause Google to discover them, crawl them, hit the 301 redirect to the slashless canonical, and report "Page with redirect" in Search Console — even though sitemap/canonical/hreflang are already slashless. The 301 redirect is correct; the JSON-LD source must match.

CRITICAL CANONICAL RULE: Prefix-all strategy is enforced for ALL languages including default English. The /en homepage MUST self-canonical to https://themegaradio.com/en (NOT to /). Sitemap, hreflang, and canonical must all agree on the /en prefix. Stripping /en→/ for default English causes Google Search Console "Alternate page with proper canonical tag" because / 302-redirects back to /en (circular signal) and the entire site stays unindexed. shared/seo-config.ts:1899-1925 enforces this; never re-introduce a default-English bare-/ canonical branch. Trailing slashes are stripped from canonical to match the server's trailing-slash 301.

CRITICAL SEO REGEX RULE: Both `server/index.ts` AND `server/index-web.ts` must use dynamically-built regex from URL_TRANSLATIONS (collectSeoTranslations). NEVER hardcode URL patterns — they go stale when translations changes. Both singular (`station`) and plural (`stations`) forms must be included. Both files must include `privacyPage` and `countryPage` in `isSeoEligiblePage`.

CRITICAL RATE LIMIT RULE: Major search bots (Google, Bing, Yandex, Baidu, DuckDuckGo, Apple) are FULLY EXEMPT from all rate limits — both API rate limiter in index-api.ts and SSR bot rate limiter in index-web.ts. Minor bots get 60/min.

CRITICAL SSRF RULE: ALL outbound requests from server-side code (safeFetch in safe-fetch.ts, stream-proxy-routes.ts base64 + URL-decoded fallback paths, Shoutcast manual redirect handler, direct fetch path) MUST call validateOutboundUrl on every redirect hop, NOT just the initial URL. `redirect:'follow'` is forbidden — use `redirect:'manual'` with a max-5-hop loop. Otherwise a public origin can 30x into 169.254.169.254 (cloud metadata), localhost, or other internal targets. validateOutboundUrl blocks IPv6 6to4 (2002::/16) and Teredo (2001::32) tunnels in addition to standard private/loopback/link-local ranges. STREAM_BLOCKED_PORTS in stream-proxy-routes.ts is the single source of truth for the stream/image policy — a BLOCKLIST (SSH, SMTP, DNS, SMB, DB/cache ports) passed via `blockedPorts` to validateOutboundUrl, not an allowlist. Stream proxy MUST use a fixed media-player User-Agent (`VLC/3.0.20 LibVLC/3.0.20`) on all outbound fetches — forwarding the browser UA causes origins like stream.zeno.fm to return HTTP 401. NoSQL $regex with user input MUST be escaped with escapeRegex() (regex meta-chars: `.*+?^${}()|[]\`) — applies to misc-routes.ts and user-auth-routes.ts user-search filters.

CRITICAL CORS RULE: CORS middleware in index-api.ts must run BEFORE rate limiters. If rate limiter returns 429 before CORS headers are set, browsers block the response entirely — causing "No Access-Control-Allow-Origin" errors and making the site appear completely down. Origin-aware CORS: requests from themegaradio.com get `Access-Control/Allow-Credentials: true`; other origins get `Access-Control/Allow-Origin: *`.

CRITICAL STRUCTURED DATA RULE: WebSite schema has @id=`{domain}/#website` and alternateName. Organization schema has @id=`{domain}/#organization` and logo as ImageObject. FAQPage schema is present BOTH in SSR (seo-renderer.ts) AND in client SeoHead.tsx for `pageType==='home'` — do NOT remove the home FAQ from SeoHead or it disappears after React hydration. BreadcrumbList schema on station pages must always match visible breadcrumb nav in the React component (client/src/pages/stations/[id].tsx). BreadcrumbList positions are re-numbered after splice to guarantee sequential 1,2,3... order. sameAs removed from Organization schema since social accounts unverified. BroadcastService JSON-LD uses JSON.stringify() for proper character escaping — never use template literal interpolation for description fields.

CRITICAL MULTILINGUAL H1 RULE: Station page H1 uses translation keys `seo_from` and `seo_listen_live_online` for localized rendering. Never hardcode English "from" or "Listen Live Online" in the station H1 template.

CRITICAL ALIAS REDIRECT RULE: When a station is resolved via `slugAliases` (rather than the canonical `slug`), `server/seo-renderer.ts` MUST rebuild the redirect target via `buildLocalizedUrl(englishCanonical, actualLanguage, countryCode, urlTranslations)` — NEVER do a raw `cleanPath.replace(stationSlug, aliasMatch.slug)`. Single 301 hop to the correctly-localized canonical is mandatory. Also: the SSR redirect handler (`pageData.redirectTo` → `res.redirect(301, ...)`) MUST exist in BOTH `server/index-web.ts:704-710` AND `server/index.ts:921-940`. Both entry points must stay in parity.

CRITICAL MOBILE PERFORMANCE RULE: `vite.config.ts` `rollupOptions.output.manualChunks` must be preserved. `extendedPopularStationsData` should not be added as a separate `useQuery`. Avoid broad `invalidateQueries({ predicate })` in country-change useEffect. `InView` wrapper must have `minHeight` prop or `className`. `client/index.html` hero preload media query must align with `<picture>` `<source media="(min-width: 768px)">`. `client/index.html` `<link rel="preconnect" href="https://api.themegaradio.com" crossorigin>` must be preserved. `TranslationPreloader.tsx` background prefetch must run AFTER 'load' event.

CRITICAL INDEXABILITY-GATE RULE: For station URLs, indexability MUST be computed only via `getIndexableLanguagesForStation(station, qualifiedLangs)` / `isStationIndexableInLanguage(station, lang, qualifiedLangs)` from `server/seo/junk-station-rules.ts`. Sitemap inclusion, SSR robots/noindex + hreflang emission, SSR station-branch CANONICAL selection, and the 410-Gone decision MUST all use this exact gate. Junk stations MUST serve 410 Gone via `sendJunkGone()` in ALL paths. Cache-HIT paths MUST cross-check `performanceCache.getPageData(cleanUrl).pageData.stationIsJunk`. `pageDataCache.stdTTL` MUST be >= `seoHtmlCache.stdTTL`. Junk pages MUST emit zero hreflang alternates. Hreflang on a valid station MUST be restricted via `generateLanguageUrls(..., allowedLanguages)` using the same `indexable` array.

CRITICAL COUNTRY-PREFIX REDIRECT RULE: 2-letter URL prefixes that exist in `COUNTRY_TO_LANGUAGE` but NOT in enabled `SEO_LANGUAGES` (e.g. `/ph`, `/us`, `/au`, `/ca`, `/gb`, `/nz`, `‌/sg`, `/in`, `/ke`) MUST 301-redirect to `/<mapped-language>` BEFORE any SSR or security-header middleware runs. Implemented in BOTH `server/index-web.ts` and `server/index.ts`. Regex `/^\/([a-z]{2})(\/.*)?$/i` only matches exactly 2-letter first segments.

CRITICAL AUTH NOINDEX RULE: Auth pages (`/login`, `/signup`, `/sign-in`, `/sign-up`, `/register`, `/forgot-password`, `/reset-password`, `/change-password`, `/auth/*` — with optional `/<lang>/` prefix) MUST emit `X-Robots-Tag: noindex, follow` AND must NOT be blocked by `Disallow:` in robots.txt. The single source of truth for the auth regex is `AUTH_NOINDEX_PATH` in `server/index-web.ts` and `AUTH_NOINDEX_PATH_MAIN` in `server/index.ts` (mirrored). robots.txt MUST NOT contain `Disallow: /*/login`, `Disallow: /*/signup`, or `Disallow: /*/forgot-password`.

CRITICAL SSR IMG SURFACE RULE: Home SSR HTML MUST contain real `<img>` tags for the top-10 popular stations (S3 `logoAssets.webp256` URLs) so Bing/Google image crawlers can discover station logos. Visible `<img src=... alt=... width=256 height=256 loading=lazy>` is required. Implemented in `server/seo-renderer.ts` `generateHtmlBody` home branch (line ~927). The injected anchor URLs MUST follow the prefix-all canonical: `/<lang>/<localized-station-segment>/<slug>` for ALL languages including English.

CRITICAL SSR STATION DETAIL IMG RULE: Station detail page SSR HTML must contain exactly one station logo `<img>` tag (usually within `<figure>`, alt="{name} logo — {country}", width/height=256, loading=eager+decoding=async). The `pickLogoUrl(station)` helper (server/seo-renderer.ts) is used: `logoAssets.webp256 → webp96 → favicon` fallback chain, http(s) scheme guard, trim. `fetchpriority=high` is not used. For junk station 410 paths, no `<img>` is generated.

CRITICAL IMAGE SITEMAP NAMESPACE RULE: `/sitemap-stations-{lang}-{chunk}.xml` `<urlset>` MUST declare `xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"`. For each `<url>`, if the station has a real S3 logo URL (`logoAssets.webp256 → webp96 → favicon`, http(s) scheme + `default-station.{png,webp,jpg,jpeg,svg}` placeholder reject), a single `<image:image><image:loc>...</image:image:loc></image:image>` child is emitted. URLs are XML-escaped. Mongo `.select()` must include `name slug favicon logoAssets country countryCode tags votes descriptions url homepage bitrate lastCheckOk` fields. `/sitemap-images.xml` and `/sitemap-images-{N}.xml` return 410 Gone.

CRITICAL SSR PREFIX-ALL LANGPREFIX RULE: In all SSR branches (home/station/genres/regions/country/search/faq/about/privacy), `<a>` href and JSON-LD `url`/`@id` generation, `langPrefix` or inline language prefix MUST be in `/${language}` format — `language === 'en' ? '' : '/'+language` is NEVER used. This includes `searchPath` (WebSite SearchAction `urlTemplate`), ItemList `stationUrl`, RadioStation `@id`/`url`. For localized URL segment, `urlTranslations.get(\`${language}:station\`)` (en→station, tr→istasyon, de→sender) is used. This rule aligns with seo-config.ts CRITICAL CANONICAL RULE.

CRITICAL WOUTER LOCALIZED REGIONS ROUTE RULE: In `client/src/App.tsx`, for the language-specific translated `regions` block, it is NOT enough to literally mount `/:citySlug?/stations`. A separate `<Route path={`/${langConfig.code}/${translations['regions']}/:regionSlug/:countrySlug/:citySlug?/${translations['stations']}`} />` must be mounted for localized stations suffixes like Turkish `/istasyonlar`, German `/sender`, Spanish `/emisoras-radio`. Otherwise, wouter cannot match it, the catch-all `/:countryCode/:rest*` takes over, PlayerWrapper renders but `useParams()` returns `{countryCode, rest}`, `regionSlug/countrySlug/citySlug` are undefined, resulting in a blank skeleton page and undefined slug API requests. English routes (lines 611, 757, 978, 1038) are correct with literal `/stations` and should not be changed.

CRITICAL META DESCRIPTION LENGTH RULE: All `<meta name="description">`, `og:description`, `twitter:description` MUST be MAX 145 characters (≈1000 px Sebility/Yandex limit). Word-boundary truncation is mandatory — `truncateAtWordBoundary(text, 145)` (`shared/seo-config.ts:11`) is the single source-of-truth helper. NEVER use `substring(0, 160)`. `server/seo-renderer.ts:1715` `ensureDescriptionLength` does not use English `DESCRIPTION_PAD_TAIL` to prevent language mixing. The padding clauses in `getStationMetaDescription` (shared/seo-config.ts:1458) are language-aware: `translations['stations']`, `translations['from']`, `translations['countries']`, `translations['twenty_four_seven']`. Padding should ONLY be added within the MIN 130 / MAX 145 character window.

CRITICAL ADMIN STATION UPLOAD RULE: Admin panel station logo upload + edit-save uses TWO endpoints in `server/routes/admin-station-routes.ts`: `POST /api/admin/stations/:id/upload-favicon` (multer.memoryStorage 5MB image-only multipart, calls `logoProcessor.processFromBuffer` to AWS S3, then mirrors `logoAssets.webp256` into `station.favicon`) and `PUT /api/stations/:stationId` (admin station metadata update with strict whitelist `STATION_UPDATE_ALLOWED_FIELDS`). NEVER use Replit Object Storage. If admin pastes a non-S3 favicon URL, fire-and-forget `logoProcessor.processFromUrl`. Both endpoints MUST: validate `mongoose.Types.ObjectId.isValid()`, use `requireAdmin`, call `performanceCache.invalidateStationCache(slug)`. Frontend `station-edit-dialog.tsx` and `station-form.tsx` use `${station._id || station.id}`. `logoProcessor.processFromBuffer` MUST have `processingQueue.has/add` guard.

CRITICAL NOINDEX-DUP-MERGE MIGRATION RULE: Stations with `noIndex:true` that have exactly ONE non-noIndex sibling sharing the same `name + countryCode` MUST be merged into the canonical sibling's `slugAliases` (preserves backlink equity via 301 redirect) instead of staying as 410 Gone. Migration script: `scripts/merge-noindex-duplicates-to-aliases.ts` (aggregation + bulkWrite, idempotent via `$addToSet` + `deleteMany`). NEVER touch stations with 0 siblings (truly junk → keep 410) or 2+ siblings (ambiguous → skip). After running: server restart required to flush `performanceCache` and `pageDataCache`. Re-running the script is safe — `$addToSet` is no-op on existing aliases and `deleteMany` is no-op on already-deleted dups.

CRITICAL GENRES/REGIONS IMG GRID RULE: Genres and Regions/Country SSR branches fetch top-12 stations from Mongo and generate an `<img>` grid. Mongo `.select()` MUST include `name slug favicon logoAssets country countryCode tags votes descriptions url homepage bitrate lastCheckOk` fields. The junk filter only uses `!isJunkStation(s) && s.noIndex !== true`; `isStationIndexableInLanguage` is NOT used here. For the country page, `https://flagcdn.com/w320/{cc}.png` flag `<img>` is also emitted.

## System Architecture

### Backend
- **Framework**: Express.js with TypeScript.
- **Database**: MongoDB with Mongoose.
- **API**: RESTful API.
- **Caching**: NodeCache and Redis for multi-layer caching.

### Frontend
- **Framework**: React with TypeScript.
- **Routing**: Wouter.
- **State Management**: TanStack Query.
- **UI**: Tailwind CSS and shadcn/ui components for a modern, responsive design.
- **Audio Player**: HLS.js with Plyr for seamless playback.

### Deployment
- **Architecture**: Microservices (backend-api, frontend-web, stream-proxy).
- **Containerization**: Docker for isolated and scalable services.
- **Monorepo**: Unified monorepo for all services.

### Key Architectural Decisions
- **Type Safety**: Implemented using TypeScript and Zod for robust schema validation.
- **SEO Optimization**: Comprehensive strategy including slug-based URLs, dynamic sitemaps, JSON-LD, multilingual hreflang, and robust indexing rules.
- **Performance**: Achieved through multi-layer caching, database indexing, lazy loading, and server-side image optimization.
- **Geolocation**: Personalizes content delivery using Cloudflare headers and GPS data.
- **Audio Continuity**: Ensures uninterrupted audio playback across user navigations.
- **User Engagement**: Driven by data analytics and AI-powered recommendation engines.
- **System Stability**: Engineered with Out-Of-Memory prevention, a self-watchdog, MongoDB circuit breaker, and fail-fast mechanisms.
- **SSR Protection**: Manages concurrent Server-Side Rendering (SSR) requests, timeouts, and bot rate limiting.
- **Subscription System**: A flexible matrix supporting various subscription plans and features.

## External Dependencies
- **MongoDB Atlas**: Cloud-hosted NoSQL database.
- **Radio-Browser API**: External API providing comprehensive radio station data.
- **ip-api.com**: Geolocation service.
- **Cloudflare**: Utilized for CDN, caching, RUM, and enhanced security.
- **AWS S3**: Scalable cloud storage for media assets.