# Mega Radio Station Management System

## Overview
The Mega Radio Station Management System is a full-stack application for global radio station streaming and management. It provides robust administrative controls, real-time monitoring, and AI-driven content delivery to enhance user engagement. Key capabilities include extensive audio format support, advanced SEO, comprehensive user management, social interaction features, geolocation services, and advanced search. The project aims to be a leading digital radio platform, offering a dynamic and feature-rich experience for listeners and administrators.

## User Preferences
Preferred communication style: Simple, everyday language.

CRITICAL UI RULE: Never use duplicate headers and footers - RadioHeader and Footer are already provided by the main App.tsx PlayerWrapper, so individual pages should NEVER import or include their own RadioHeader/Footer components.

CRITICAL ADMIN UI RULE: Edit popups and admin dialogs must ALWAYS stay light/white theme, never dark theme. User preference: popups should always be bright with light backgrounds and dark text for readability.

CRITICAL SEO HEADING RULE: Only ONE H1 per page (provided by server-rendered content in seo-renderer.ts). All content sections (RadioFAQ, About, etc.) must use H2 for main headings and H3/H4 for subsections to maintain proper heading hierarchy across all 57 languages.

CRITICAL SEO COMPLIANCE RULE: NO sr-only H3 headings with SEO keywords on any page (Google Hidden Text policy). NO boilerplate template text in SSR body (Google Scaled Content Abuse policy). SSR station body must ONLY contain: AI description + station details + nav links.

CRITICAL LASTMOD RULE: Station sitemaps must ONLY include `<lastmod>` when real `updatedAt` data exists in the DB. If `updatedAt` is missing, omit `<lastmod>` entirely — never use today's date as fallback (Google treats fake lastmod as spam signal).

CRITICAL UGC RULE: User-submitted comments are stripped of HTML tags on input (max 1000 chars) and on output. Any future comment rendering with links MUST use `rel="nofollow ugc noopener"` to comply with Google's UGC spam policy.

CRITICAL SITEMAP RULE: sitemap-index.xml references ONLY existing routes: sitemap-main-{lang}.xml, sitemap-genres-{lang}.xml, sitemap-stations-{chunk}.xml. Never add sitemap-images-*, sitemap-stations-{digit}.xml, sitemap-news.xml, sitemap-videos.xml back — these violate Google policies or don't exist. robots.txt must only list sitemap-index.xml. sitemap-main.xml is a 301 redirect to sitemap-main-en.xml. Deprecated sitemap URLs (/sitemap-news.xml, /sitemap-videos.xml, /sitemap-images-*.xml, /sitemap-stations-{digit}.xml) return 410 Gone to prevent soft-404.

CRITICAL ROBOTS.TXT RULE: `Disallow: /api/` blocks Google WRS (Web Rendering Service) from fetching API endpoints during JavaScript rendering, which causes React to show "Station not found" even when SSR is correct. Critical API paths MUST have explicit `Allow:` rules BEFORE the `Disallow: /api/` line: `/api/station/`, `/api/stations/`, `/api/genres`, `/api/translations`, `/api/location`, `/api/advertisements`. Never remove these Allow rules or Google will see blank/error pages after JS render.

CRITICAL HREFLANG RULE: ALL sitemaps use plain language codes (en, de, tr) — NEVER ISO codes (en-US, de-DE). All URLs in sitemaps must be language-prefixed (/en/stations not /stations). Every URL must have x-default hreflang pointing to the /en/ version. SSR renderer outputs ALL 57 language hreflang tags on every page (not just x-default).

CRITICAL BREADCRUMB JSON-LD RULE: BreadcrumbList JSON-LD `item` URLs in seo-renderer.ts must NEVER end with trailing slash (e.g., use `${baseDomain}/${language}` NOT `${baseDomain}/${language}/`). Trailing-slash URLs in structured data cause Google to discover them, crawl them, hit the 301 redirect to the slashless canonical, and report "Page with redirect" in Search Console — even though sitemap/canonical/hreflang are already slashless. The 301 redirect is correct; the JSON-LD source must match.

CRITICAL CANONICAL RULE: Prefix-all strategy is enforced for ALL languages including default English. The /en homepage MUST self-canonical to https://themegaradio.com/en (NOT to /). Sitemap, hreflang, and canonical must all agree on the /en prefix. Stripping /en→/ for default English causes Google Search Console "Alternate page with proper canonical tag" because / 302-redirects back to /en (circular signal) and the entire site stays unindexed. shared/seo-config.ts:1899-1925 enforces this; never re-introduce a default-English bare-/ canonical branch. Trailing slashes are stripped from canonical to match the server's trailing-slash 301.

CRITICAL SEO REGEX RULE: Both `server/index.ts` AND `server/index-web.ts` must use dynamically-built regex from URL_TRANSLATIONS (collectSeoTranslations). NEVER hardcode URL patterns — they go stale when translations changes. Both singular (`station`) and plural (`stations`) forms must be included. Both files must include `privacyPage` and `countryPage` in `isSeoEligiblePage`.

CRITICAL RATE LIMIT RULE: Major search bots (Google, Bing, Yandex, Baidu, DuckDuckGo, Apple) are FULLY EXEMPT from all rate limits — both API rate limiter in index-api.ts and SSR bot rate limiter in index-web.ts. Minor bots get 60/min. Previous value of 15/min caused Google crawling failures.

CRITICAL SSRF RULE: ALL outbound requests from server-side code (safeFetch in safe-fetch.ts, stream-proxy-routes.ts base64 + URL-decoded fallback paths, Shoutcast manual redirect handler, direct fetch path) MUST call validateOutboundUrl on every redirect hop, NOT just the initial URL. `redirect:'follow'` is forbidden — use `redirect:'manual'` with a max-5-hop loop. Otherwise a public origin can 30x into 169.254.169.254 (cloud metadata), localhost, or other internal targets. validateOutboundUrl blocks IPv6 6to4 (2002::/16) and Teredo (2001::/32) tunnels in addition to standard private/loopback/link-local ranges. STREAM_BLOCKED_PORTS in stream-proxy-routes.ts is the single source of truth for the stream/image proxy port policy — a BLOCKLIST (SSH, SMTP, DNS, SMB, DB/cache ports) passed via `blockedPorts` to validateOutboundUrl, not an allowlist. Narrow allowlists previously rejected ~3400 legitimate non-standard radio ports (e.g. :5032, :8201, :2199) silently; the IP-based SSRF defense (private/loopback/link-local/CGNAT/cloud-metadata) still fully guards against internal pivoting. Stream proxy MUST use a fixed media-player User-Agent (`VLC/3.0.20 LibVLC/3.0.20`) on all outbound fetches — forwarding the browser UA causes origins like stream.zeno.fm to return HTTP 401. NoSQL $regex with user input MUST be escaped with escapeRegex() (regex meta-chars: `.*+?^${}()|[]\\`) — applies to misc-routes.ts and user-auth-routes.ts user-search filters.

CRITICAL CORS RULE: CORS middleware in index-api.ts must run BEFORE rate limiters. If rate limiter returns 429 before CORS headers are set, browsers block the response entirely — causing "No Access-Control-Allow-Origin" errors and making the site appear completely down. Origin-aware CORS: requests from themegaradio.com get `Access-Control-Allow-Credentials: true`; other origins get `Access-Control/Allow-Origin: *`.

CRITICAL STRUCTURED DATA RULE: WebSite schema has @id=`{domain}/#website` and alternateName. Organization schema has @id=`{domain}/#organization` and logo as ImageObject. FAQPage schema is present BOTH in SSR (seo-renderer.ts) AND in client SeoHead.tsx for `pageType==='home'` — do NOT remove the home FAQ from SeoHead or it disappears after React hydration. BreadcrumbList schema on station pages must always match visible breadcrumb nav in the React component (client/src/pages/stations/[id].tsx). BreadcrumbList positions are re-numbered after splice to guarantee sequential 1,2,3... order. sameAs removed from Organization schema since social accounts unverified. BroadcastService JSON-LD uses JSON.stringify() for proper character escaping — never use template literal interpolation for description fields.

CRITICAL MULTILINGUAL H1 RULE: Station page H1 uses translation keys `seo_from` and `seo_listen_live_online` for localized rendering. Never hardcode English "from" or "Listen Live Online" in the station H1 template.

CRITICAL ALIAS REDIRECT RULE: When a station is resolved via `slugAliases` (rather than the canonical `slug`), `server/seo-renderer.ts` MUST rebuild the redirect target via `buildLocalizedUrl(englishCanonical, actualLanguage, countryCode, urlTranslations)` — NEVER do a raw `cleanPath.replace(stationSlug, aliasMatch.slug)`. Reason: `cleanPath` returned by `getLanguageFromPath()` is already language-stripped AND reverse-translated to English (e.g. `/ar/mahta/-1` → cleanPath `/station/-1`). A raw replace produces `/station/<canonical>` which then triggers a 3-hop redirect chain (`/station/X` → `/en/station/X` → final localized) for non-English requests, dropping language signal and causing massive Google "Crawled – currently not indexed" duplication (~880K URLs as of Apr 2026). Single 301 hop to the correctly-localized canonical is mandatory. Also: the SSR redirect handler (`pageData.redirectTo` → `res.redirect(301, ...)`) MUST exist in BOTH `server/index-web.ts:704-710` AND `server/index.ts:921-940`. The monolithic `index.ts` entry path silently swallows the redirect if the handler is missing (returns 200 with stale alias content). Both entry points must stay in parity.

CRITICAL MOBILE PERFORMANCE RULE: Mobile PageSpeed score'u korumak için:
1) `vite.config.ts` `rollupOptions.output.manualChunks` KORUNMALI — react-vendor / query-vendor / radix-vendor / icons-vendor / media-vendor / forms-vendor ayrımı tree-shaking'i bozmadan lucide-react ikon parçalanmasını engeller.
2) `client/src/pages/radio-frontend.tsx` içinde `extendedPopularStationsData` AYRI bir useQuery olarak EKLENMEMELİ — `popularStationsData` ile aynı URL'yi (`/api/stations/precomputed?countryName=X&page=1&limit=12`) çağırıyor, sadece alias olarak kalmalı.
3) Country-change useEffect'inde broad `invalidateQueries({ predicate })` EKLENMEMELİ — TanStack Query queryKey değiştiğinde otomatik refetch yapar.
4) `InView` wrapper'ı (client/src/components/ui/in-view.tsx) artık `minHeight` defaultsuz; lazy bölümlerde CLS önlemek için ya `minHeight` prop'u ya `className="min-h-[...]"` verilmeli.
5) `client/index.html` hero preload media query'si HER ZAMAN `radio-frontend.tsx`'teki `<picture>` `<source media="(min-width: 768px)">` ile hizalı olmalı.
6) `client/index.html` `<link rel="preconnect" href="https://api.themegaradio.com" crossorigin>` 3-service split deploy'da KORUNMALI.
7) `TranslationPreloader.tsx` background prefetch (en+de) `'load'` event SONRASI çalışmalı.

CRITICAL INDEXABILITY-GATE RULE: For station URLs, indexability MUST be computed only via `getIndexableLanguagesForStation(station, qualifiedLangs)` / `isStationIndexableInLanguage(station, lang, qualifiedLangs)` from `server/seo/junk-station-rules.ts`. Sitemap inclusion, SSR robots/noindex + hreflang emission, SSR station-branch CANONICAL selection, and the 410-Gone decision MUST all use this exact gate. `qualifiedLangs` MUST come from `server/seo/qualified-languages.ts`. Junk stations MUST serve 410 Gone via `sendJunkGone()` in ALL paths. Cache-HIT paths MUST cross-check `performanceCache.getPageData(cleanUrl).pageData.stationIsJunk`. `pageDataCache.stdTTL` MUST be >= `seoHtmlCache.stdTTL`. Junk pages MUST emit zero hreflang alternates. Hreflang on a valid station MUST be restricted via `generateLanguageUrls(..., allowedLanguages)` using the same `indexable` array. `getEligibleLanguages(station)` MUST include every language present in `station.descriptions` with BOTH `full` AND `meta` non-empty.

CRITICAL COUNTRY-PREFIX REDIRECT RULE: 2-letter URL prefixes that exist in `COUNTRY_TO_LANGUAGE` but NOT in enabled `SEO_LANGUAGES` (e.g. `/ph`, `/us`, `/au`, `/ca`, `/gb`, `/nz`, `/sg`, `/in`, `/ke`) MUST 301-redirect to `/<mapped-language>` BEFORE any SSR or security-header middleware runs. Without this redirect, those URLs render `/en` content with self-canonical to `/ph` (etc.) and Google reports "Duplicate without user-selected canonical" for ~40 country prefixes. Implemented in BOTH `server/index-web.ts` and `server/index.ts` (named `COUNTRY_PREFIX_REDIRECTS` / `COUNTRY_PREFIX_REDIRECTS_MAIN`). Map is built from `Object.entries(COUNTRY_TO_LANGUAGE)` filtered by `!seoLangCodes.has(country) && seoLangCodes.has(lang)`. Regex `/^\/([a-z]{2})(\/.*)?$/i` only matches exactly 2-letter first segments — never touches 3+ letter routes (`/api`, `/admin`, `/genres`, etc.) or enabled SEO langs (`/en`, `/tr`, `/de`, `/sv` ...).

CRITICAL AUTH NOINDEX RULE: Auth pages (`/login`, `/signup`, `/sign-in`, `/sign-up`, `/register`, `/forgot-password`, `/reset-password`, `/change-password`, `/auth/*` — with optional `/<lang>/` prefix) MUST emit `X-Robots-Tag: noindex, follow` AND must NOT be blocked by `Disallow:` in robots.txt. Reason: when a path is Disallow'ed, Google may "index without content" via URL discovery (sitemap, backlinks) — the noindex header is never seen because the bot can't fetch it. The single source of truth for the auth regex is `AUTH_NOINDEX_PATH` in `server/index-web.ts` and `AUTH_NOINDEX_PATH_MAIN` in `server/index.ts` (mirrored). robots.txt (server/routes/seo-sitemap-routes.ts) MUST NOT contain `Disallow: /*/login`, `Disallow: /*/signup`, or `Disallow: /*/forgot-password` — only admin/settings/profile/messages/analytics/import-export/search may stay Disallow'ed.

CRITICAL SSR IMG SURFACE RULE: Home SSR HTML MUST contain real `<img>` tags for the top-10 popular stations (S3 `logoAssets.webp256` URLs) so Bing/Google image crawlers can discover station logos. JSON-LD `ImageObject` alone is insufficient for image indexing — visible `<img src=... alt=... width=256 height=256 loading=lazy>` is required. Implemented in `server/seo-renderer.ts` `generateHtmlBody` home branch (line ~927). The injected anchor URLs MUST follow the prefix-all canonical: `/<lang>/<localized-station-segment>/<slug>` for ALL languages including English (NEVER `/station/<slug>` for English, NEVER missing `/en` prefix). `localized-station-segment` comes from `urlTranslations.get('${language}:station')` (e.g. `tr:station` → `istasyon`, `de:station` → `sender`). The `urlTranslations` Map MUST be passed from `server/index-web.ts` AND `server/index.ts` to `generateHtmlBody({ ..., urlTranslations })` — both entrypoints must stay in parity.

## System Architecture

### Backend
- **Framework**: Express.js with TypeScript.
- **Database**: MongoDB with Mongoose.
- **API**: REST API.
- **Caching**: Multi-layer caching utilizing NodeCache and Redis.

### Frontend
- **Framework**: React with TypeScript.
- **Routing**: Wouter.
- **State Management**: TanStack Query.
- **UI**: Tailwind CSS with shadcn/ui for responsive design.
- **Audio Player**: HLS.js integrated with Plyr for seamless audio streaming.

### Deployment
- **Architecture**: A three-service split comprising `backend-api`, `frontend-web`, and `stream-proxy`.
- **Containerization**: Docker for isolated and reproducible environments.
- **Monorepo**: All services are managed within a unified monorepo.

### Key Architectural Decisions
- **Type Safety**: Enforced end-to-end using TypeScript and Zod for data validation.
- **SEO Optimization**: Implemented through slug-based URLs, dynamic sitemaps, structured data, multilingual hreflang, robust indexing strategies, and Core Web Vitals optimization.
- **Performance**: Achieved via multi-layer caching, database indexing, lazy loading, and server-side image optimization.
- **Geolocation**: Determined using Cloudflare headers and GPS.
- **Audio Continuity**: Ensured with seamless playback across page navigations utilizing HLS.js and Plyr.
- **User Engagement**: Driven by data-driven trends and AI-powered content recommendations.
- **System Stability**: Maintained through multi-layer Out-Of-Memory prevention, a self-watchdog mechanism, MongoDB circuit breaker, and fail-fast exits.
- **SSR Protection**: Limits on concurrent Server-Side Rendering, timeouts, and bot rate limiting.
- **Subscription System**: Designed with a flexible feature matrix to support various subscription plans.

## External Dependencies
- **MongoDB Atlas**: Cloud-hosted NoSQL database service.
- **Radio-Browser API**: External service for radio station information.
- **ip-api.com**: Used for geolocation services.
- **Cloudflare**: Utilized for CDN, caching, and Real User Monitoring (RUM) for Web Vitals.
- **AWS S3**: Employed for scalable cloud storage of media assets.