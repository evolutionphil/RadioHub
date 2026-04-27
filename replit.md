# Mega Radio Station Management System

## Overview
The Mega Radio Station Management System is a full-stack application for global radio station streaming and management. It provides comprehensive administrative controls, real-time monitoring, and an enhanced user experience for digital audio content. Key capabilities include extensive audio format support, advanced SEO, robust user management, social interaction features, geolocation, advanced search, user engagement analytics, trending station displays, and AI-powered content recommendations. The project aims to innovate in the digital audio market by leveraging AI for content delivery and HLS session management to offer a superior listening experience.

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

CRITICAL INDEXABILITY-GATE RULE: For station URLs, indexability MUST be computed only via `getIndexableLanguagesForStation(station, qualifiedLangs)` / `isStationIndexableInLanguage(station, lang, qualifiedLangs)` from `server/seo/junk-station-rules.ts`. Sitemap inclusion (`server/routes/seo-sitemap-routes.ts`), SSR robots/noindex + hreflang emission (`server/seo-renderer.ts` station branch), SSR station-branch CANONICAL selection (must use the same `indexable` array — never `getEligibleLanguages` directly), and the 410-Gone decision (both `server/index.ts` and `server/index-web.ts`) MUST all use this exact gate. `qualifiedLangs` MUST come from `server/seo/qualified-languages.ts` (`getCachedQualifiedLanguages` — 10-min TTL, same source for both call sites; fail-open fallback to `ACTIVE_SITEMAP_LANGUAGES` when the computed set is empty so a cold cache never drops valid stations to noindex; the fallback response is NOT cached so subsequent calls re-probe). NEVER branch on the raw `getEligibleLanguages` / `isLanguageEligibleForStation` at a public SEO surface — that skips the UI-translation qualification and reintroduces "Crawled – currently not indexed" regressions (~890K GSC URLs). Junk stations (`isJunkStation` true or `noIndex:true` in DB) MUST serve 410 Gone via `sendJunkGone()` from `server/seo/send-junk-gone.ts` in ALL paths (cache-HIT AND cache-MISS) in BOTH `server/index.ts` and `server/index-web.ts` — never 200/noindex and never 301. 410 bodies MUST NOT be written to `performanceCache.setSeoHtml`. Cache-HIT paths MUST cross-check `performanceCache.getPageData(cleanUrl).pageData.stationIsJunk` before serving cached HTML so stale pre-junk SSR cannot leak. For this guard to be deterministic, `pageDataCache.stdTTL` in `server/performance-cache.ts` MUST be >= `seoHtmlCache.stdTTL` (both currently 1800s) — otherwise the HTML outlives the pageData and the junk flag is lost mid-window. Junk pages MUST emit zero hreflang alternates (Google policy for noindex/gone). Hreflang on a valid station MUST be restricted via `generateLanguageUrls(..., allowedLanguages)` using the same `indexable` array — so sitemap and SSR advertise the exact same alternate set. `getEligibleLanguages(station)` MUST include every language present in `station.descriptions` with BOTH `full` AND `meta` non-empty (AI-generated per-station content counts as real content for SEO). NEVER drop the `descriptions` branch — doing so collapses multilingual stations like Kronehit back to `{en, country-language}` only, even when 14+ languages of genuine content exists in the DB. The half-filled / empty-string entry rejection is intentional: a record with only `meta` but no `full` renders a thin page and must not be advertised via hreflang.

## System Architecture

### Backend
- **Framework**: Express.js with TypeScript
- **Database**: MongoDB with Mongoose
- **API**: REST API
- **Caching**: Multi-layer (NodeCache, Redis)

### Frontend
- **Framework**: React with TypeScript
- **Routing**: Wouter
- **State Management**: TanStack Query
- **UI**: Tailwind CSS with shadcn/ui for responsive design and an audio player
- **Audio Streaming**: HLS.js with Plyr

### Deployment
- **Architecture**: Three-service split (backend-api, frontend-web, stream-proxy)
- **Containerization**: Docker

### Key Architectural Decisions
- **Monorepo**: Unified repository for all services
- **Type Safety**: End-to-end TypeScript with Zod validation
- **SEO Optimization**: Slug-based URLs, dynamic sitemaps, structured data, multilingual hreflang, robust indexing
- **Performance**: Multi-layer caching, database indexing, lazy loading, Core Web Vitals optimization, server-side image optimization
- **Geolocation**: Cloudflare headers and GPS
- **Audio Continuity**: Seamless audio playback across page navigations
- **User Engagement**: Data-driven trends and AI-powered recommendations
- **System Stability**: Multi-layer Out-Of-Memory prevention, self-watchdog, MongoDB circuit breaker, fail-fast exits
- **SSR Protection**: Limits concurrent Server-Side Rendering, timeouts, bot rate limiting
- **Subscription System**: Flexible feature matrix for various subscription plans

## External Dependencies
- **MongoDB Atlas**: Cloud-hosted database service
- **Radio-Browser API**: Third-party radio station data
- **ip-api.com**: Geolocation services
- **Cloudflare**: CDN, caching, Real User Monitoring (RUM) Web Vitals
- **AWS S3**: Cloud storage for media assets