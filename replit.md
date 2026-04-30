# Mega Radio Station Management System

## Overview
The Mega Radio Station Management System is a full-stack application for global online radio streaming and broadcasting. It aims to provide personalized listening experiences and comprehensive management tools for radio stations. Key capabilities include diverse audio format support, interactive features, geolocation-based content, advanced search, trend analysis, and AI-driven recommendations. The project's vision is to become a leading global platform, enhancing listener engagement and optimizing broadcasting operations to secure a significant market share.

## User Preferences
Preferred communication style: Simple, everyday language.

CRITICAL UI RULE: Never use duplicate headers and footers - RadioHeader and Footer are already provided by the main App.tsx PlayerWrapper, so individual pages should NEVER import or include their own RadioHeader/Footer components.

CRITICAL ADMIN UI RULE: Edit popups and admin dialogs must ALWAYS stay light/white theme, never dark theme. User preference: popups should always be bright with light backgrounds and dark text for readability.

CRITICAL SEO HEADING RULE: Only ONE H1 per page (provided by server-rendered content in seo-renderer.ts). All content sections (RadioFAQ, About, etc.) must use H2 for main headings and H3/H4 for subsections to maintain proper heading hierarchy across all 57 languages.

CRITICAL SEO COMPLIANCE RULE: NO sr-only H3 headings with SEO keywords on any page (Google Hidden Text policy). NO PURE boilerplate template text in SSR body — but station-specific enriched intro/outro IS allowed (Google Scaled Content Abuse policy). SSR station body MUST contain in order: (1) station logo `<figure>`, (2) `<h2>About</h2>`, (3) **H1-keyword echo intro** (1 sentence, MUST interpolate `{STATION}` + `{COUNTRY}` — translation key `seo_station_intro_sentence`), (4) AI description paragraph(s), (5) **station-specific outro** (25-35 words, MUST interpolate `{STATION}` + `{COUNTRY}` + `{GENRES}` from real `stationData.tags` — translation key `seo_station_outro_sentence`), (6) station details section, (7) nav links.

CRITICAL LASTMOD RULE: Station sitemaps must ONLY include `<lastmod>` when real `updatedAt` data exists in the DB. If `updatedAt` is missing, omit `<lastmod>` entirely — never use today's date as fallback (Google treats fake lastmod as spam signal).

CRITICAL UGC RULE: User-submitted comments are stripped of HTML tags on input (max 1000 chars) and on output. Any future comment rendering with links MUST use `rel="nofollow ugc noopener"` to comply with Google's UGC spam policy.

CRITICAL SITEMAP MANIFEST RULE: sitemap-index.xml is now driven by `SitemapManifest` Mongo collection (`shared/mongo-schemas.ts`). The manifest is rebuilt every 6h by `startManifestRefreshLoop`.

CRITICAL QUALIFIED-LANGUAGES FAIL-CLOSED RULE: `server/seo/qualified-languages.ts` is FAIL-CLOSED — it MUST NEVER fall back to all 57 ACTIVE_SITEMAP_LANGUAGES on translation cache miss.

CRITICAL ROBOTS.TXT RULE: `Disallow: /api/` blocks Google WRS (Web Rendering Service) from fetching API endpoints during JavaScript rendering. Critical API paths MUST have explicit `Allow:` rules BEFORE the `Disallow: /api/` line: `/api/station/`, `/api/stations/`, `/api/genres`, `/api/translations`, `/api/location`, `/api/advertisements`.

CRITICAL HREFLANG RULE: ALL sitemaps use plain language codes (en, de, tr) — NEVER ISO codes (en-US, de-DE). All URLs in sitemaps must be language-prefixed (/en/stations not /stations). Every URL must have x-default hreflang pointing to the /en (slashless) version.

CRITICAL BREADCRUMB JSON-LD RULE: BreadcrumbList JSON-LD `item` URLs in seo-renderer.ts must NEVER end with trailing slash (e.g., use `${baseDomain}/${language}` NOT `${baseDomain}/${language}/`). ADDITIONALLY: `currentPath` for deep crumbs (position 3+) MUST be built from LOCALIZED route segments via `urlTranslations.get(\`${language}:${seg}\`)` — e.g. `/tr/istasyon/<slug>` NOT `/tr/station/<slug>`; `/tr/turler/rock` NOT `/tr/genres/rock`. Only the actual station slug (last segment of `/station/<slug>` paths) must NEVER be translated. English route segments leaking into deep crumbs cause "Page with redirect" GSC Coverage warnings (Webmaster #2 audit P1 fix, server/seo-renderer.ts:1517-1561).

CRITICAL CANONICAL RULE: Prefix-all strategy is enforced for ALL languages including default English. The /en homepage MUST self-canonical to https://themegaradio.com/en (NOT to /).

CRITICAL SEO REGEX RULE: Both `server/index.ts` AND `server/index-web.ts` must use dynamically-built regex from URL_TRANSLATIONS (collectSeoTranslations). NEVER hardcode URL patterns.

CRITICAL RATE LIMIT RULE: Major search bots (Google, Bing, Yandex, Baidu, DuckDuckGo, Apple) are FULLY EXEMPT from all rate limits — both API rate limiter in index-api.ts and SSR bot rate limiter in index-web.ts. Minor bots get 60/min.

CRITICAL SSRF RULE: ALL outbound requests from server-side code MUST call validateOutboundUrl on every redirect hop, NOT just the initial URL. `redirect:'follow'` is forbidden.

CRITICAL CORS RULE: CORS middleware in index-api.ts must run BEFORE rate limiters.

CRITICAL STRUCTURED DATA RULE: WebSite schema has @id=`{domain}/#website` and alternateName. Organization schema has @id=`{domain}/#organization` and logo as ImageObject. FAQPage schema is present BOTH in SSR (seo-renderer.ts) AND in client SeoHead.tsx for `pageType==='home'`. BreadcrumbList schema on station pages must always match visible breadcrumb nav in the React component (client/src/pages/stations/[id].tsx).

CRITICAL MULTILINGUAL H1 RULE: Station page H1 uses translation keys `seo_from` and `seo_listen_live_online` for localized rendering. Never hardcode English "from" or "Listen Live Online" in the station H1 template.

CRITICAL ALIAS REDIRECT RULE: When a station is resolved via `slugAliases`, `server/seo-renderer.ts` MUST rebuild the redirect target via `buildLocalizedUrl` — NEVER do a raw `cleanPath.replace(stationSlug, aliasMatch.slug)`.

CRITICAL MOBILE PERFORMANCE RULE: `vite.config.ts` `rollupOptions.output.manualChunks` must be preserved. Avoid broad `invalidateQueries({ predicate })` in country-change useEffect. `InView` wrapper must have `minHeight` prop or `className`. `client/index.html` hero preload media query must align with `<picture>` `<source media="(min-width: 768px)">`. `client/index.html` `<link rel="preconnect" href="https://api.themegaradio.com" crossorigin>` must be preserved. `TranslationPreloader.tsx` background prefetch must run AFTER 'load' event.

CRITICAL INDEXABILITY-GATE RULE: For station URLs, indexability MUST be computed only via `getIndexableLanguagesForStation(station, qualifiedLangs)` / `isStationIndexableInLanguage(station, lang, qualifiedLangs)` from `server/seo/junk-station-rules.ts`.

CRITICAL COUNTRY-PREFIX REDIRECT RULE: 2-letter URL prefixes that exist in `COUNTRY_TO_LANGUAGE` but NOT in enabled `SEO_LANGUAGES` MUST 301-redirect to `/<mapped-language>` BEFORE any SSR or security-header middleware runs.

CRITICAL AUTH NOINDEX RULE: Auth pages (`/login`, `/signup`, `/sign-in`, etc.) MUST emit `X-Robots-Tag: noindex, follow` AND must NOT be blocked by `Disallow:` in robots.txt.

CRITICAL SSR IMG SURFACE RULE: Home SSR HTML MUST contain real `<img>` tags for the top-10 popular stations (S3 `logoAssets.webp256` URLs) so Bing/Google image crawlers can discover station logos.

CRITICAL SSR STATION DETAIL IMG RULE: Station detail page SSR HTML must contain exactly one station logo `<img>` tag. The `pickLogoUrl(station)` helper (server/seo-renderer.ts) is used.

CRITICAL IMAGE SITEMAP NAMESPACE RULE: `/sitemap-stations-{lang}-{chunk}.xml` `<urlset>` MUST declare `xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"`.

CRITICAL SSR PREFIX-ALL LANGPREFIX RULE: In all SSR branches, `<a>` href and JSON-LD `url`/`@id` generation, `langPrefix` or inline language prefix MUST be in `/${language}` format — `language === 'en' ? '' : '/'+language` is NEVER used.

CRITICAL WOUTER LOCALIZED REGIONS ROUTE RULE: In `client/src/App.tsx`, for the language-specific translated `regions` block, a separate `<Route path={`/${langConfig.code}/${translations['regions']}/:regionSlug/:countrySlug/:citySlug?/${translations['stations']}`} />` must be mounted for localized stations suffixes.

CRITICAL META DESCRIPTION LENGTH RULE: All `<meta name="description">`, `og:description`, `twitter:description` MUST be MAX 145 characters. Word-boundary truncation is mandatory.

CRITICAL ADMIN STATION UPLOAD RULE: Admin panel station logo upload + edit-save uses TWO endpoints in `server/routes/admin-station-routes.ts`. NEVER use Replit Object Storage.

CRITICAL NOINDEX-DUP-MERGE MIGRATION RULE: Stations with `noIndex:true` that have exactly ONE non-noIndex sibling sharing the same `name + countryCode` MUST be merged into the canonical sibling's `slugAliases`.

CRITICAL GENRES/REGIONS IMG GRID RULE: Genres and Regions/Country SSR branches fetch top-12 stations from Mongo and generate an `<img>` grid.

## System Architecture

### Backend
- **Framework**: Express.js with TypeScript.
- **Database**: MongoDB with Mongoose.
- **API**: RESTful API.
- **Caching**: Multi-layer caching using NodeCache and Redis.
- **SSR Protection**: Manages concurrent SSR requests, timeouts, and bot rate limiting.
- **System Stability**: Includes Out-Of-Memory prevention, self-watchdog, MongoDB circuit breaker, and fail-fast strategies.

### Frontend
- **Framework**: React with TypeScript.
- **Routing**: Wouter.
- **State Management**: TanStack Query.
- **UI**: Tailwind CSS and shadcn/ui components.
- **Audio Player**: HLS.js integrated with Plyr for continuous playback.

### Deployment
- **Architecture**: Microservices (backend API, frontend web, stream proxy).
- **Containerization**: Docker.
- **Monorepo**: Unified development and management structure.

### Key Architectural Decisions
- **Type Safety**: Ensured through TypeScript and Zod.
- **SEO Optimization**: Implemented with slug-based URLs, dynamic sitemaps, JSON-LD, multilingual hreflang, and specific indexing rules.
- **Performance**: Achieved via multi-layer caching, database indexing, lazy loading, and server-side image optimization.
- **Geolocation**: Personalized content delivery leveraging Cloudflare headers and GPS data.
- **User Engagement**: Supported by data analytics and AI-powered recommendations.
- **Subscription System**: A flexible matrix supporting various plans and features.

## External Dependencies
- **MongoDB Atlas**: Cloud-hosted NoSQL database.
- **Radio-Browser API**: External database for radio station information.
- **ip-api.com**: Geolocation API service.
- **Cloudflare**: CDN, caching, Real User Monitoring (RUM), and security services.
- **AWS S3**: Scalable and secure media asset storage.