# Mega Radio Station Management System

## Overview
The Mega Radio Station Management System is a full-stack application for streaming and managing radio stations. It features an extensive admin interface, real-time monitoring, broad audio format support, and SEO-friendly URLs. The system includes user management, social interaction, geolocation, advanced search, authentic user engagement data, trending stations, and AI-powered recommendations. The vision is to establish a leading digital audio platform utilizing AI for content delivery and advanced HLS session management for global reach and uninterrupted streaming.

## User Preferences
Preferred communication style: Simple, everyday language.

CRITICAL UI RULE: Never use duplicate headers and footers - RadioHeader and Footer are already provided by the main App.tsx PlayerWrapper, so individual pages should NEVER import or include their own RadioHeader/Footer components.

CRITICAL ADMIN UI RULE: Edit popups and admin dialogs must ALWAYS stay light/white theme, never dark theme. User preference: popups should always be bright with light backgrounds and dark text for readability.

CRITICAL SEO HEADING RULE: Only ONE H1 per page (provided by server-rendered content in seo-renderer.ts). All content sections (RadioFAQ, About, etc.) must use H2 for main headings and H3/H4 for subsections to maintain proper heading hierarchy across all 57 languages.

CRITICAL SEO COMPLIANCE RULE: NO sr-only H3 headings with SEO keywords on any page (Google Hidden Text policy). NO boilerplate template text in SSR body (Google Scaled Content Abuse policy). SSR station body must ONLY contain: AI description + station details + nav links.

CRITICAL LASTMOD RULE: Station sitemaps must ONLY include `<lastmod>` when real `updatedAt` data exists in the DB. If `updatedAt` is missing, omit `<lastmod>` entirely — never use today's date as fallback (Google treats fake lastmod as spam signal).

CRITICAL UGC RULE: User-submitted comments are stripped of HTML tags on input (max 1000 chars) and on output. Any future comment rendering with links MUST use `rel="nofollow ugc noopener"` to comply with Google's UGC spam policy.

CRITICAL SITEMAP RULE: sitemap-index.xml references ONLY existing routes: sitemap-main-{lang}.xml, sitemap-genres-{lang}.xml, sitemap-stations-{lang}-{chunk}.xml. Never add sitemap-images-*, sitemap-stations-{digit}.xml, sitemap-news.xml, sitemap-videos.xml back — these violate Google policies or don't exist. robots.txt must only list sitemap-index.xml. sitemap-main.xml is a 301 redirect to sitemap-main-en.xml. Deprecated sitemap URLs (/sitemap-news.xml, /sitemap-videos.xml, /sitemap-images-*.xml, /sitemap-stations-{digit}.xml) return 410 Gone to prevent soft-404.

CRITICAL ROBOTS.TXT RULE: `Disallow: /api/` blocks Google WRS (Web Rendering Service) from fetching API endpoints during JavaScript rendering, which causes React to show "Station not found" even when SSR is correct. Critical API paths MUST have explicit `Allow:` rules BEFORE the `Disallow: /api/` line: `/api/station/`, `/api/stations/`, `/api/genres`, `/api/translations`, `/api/location`, `/api/advertisements`. Never remove these Allow rules or Google will see blank/error pages after JS render.

CRITICAL HREFLANG RULE: ALL sitemaps use plain language codes (en, de, tr) — NEVER ISO codes (en-US, de-DE). All URLs in sitemaps must be language-prefixed (/en/stations not /stations). Every URL must have x-default hreflang pointing to the /en/ version. SSR renderer outputs ALL 57 language hreflang tags on every page (not just x-default).

CRITICAL CANONICAL RULE: Prefix-all strategy is enforced for ALL languages including default English. The /en homepage MUST self-canonical to https://themegaradio.com/en (NOT to /). Sitemap, hreflang, and canonical must all agree on the /en prefix. Stripping /en→/ for default English causes Google Search Console "Alternate page with proper canonical tag" because / 302-redirects back to /en (circular signal) and the entire site stays unindexed. shared/seo-config.ts:1899-1925 enforces this; never re-introduce a default-English bare-/ canonical branch. Trailing slashes are stripped from canonical to match the server's trailing-slash 301.

CRITICAL SEO REGEX RULE: Both `server/index.ts` AND `server/index-web.ts` must use dynamically-built regex from URL_TRANSLATIONS (collectSeoTranslations). NEVER hardcode URL patterns — they go stale when translations change. Both singular (`station`) and plural (`stations`) forms must be included. Both files must include `privacyPage` and `countryPage` in `isSeoEligiblePage`.

CRITICAL RATE LIMIT RULE: Major search bots (Google, Bing, Yandex, Baidu, DuckDuckGo, Apple) are FULLY EXEMPT from all rate limits — both API rate limiter in index-api.ts and SSR bot rate limiter in index-web.ts. Minor bots get 60/min. Previous value of 15/min caused Google crawling failures.

CRITICAL SSRF RULE: ALL outbound requests from server-side code (safeFetch in safe-fetch.ts, stream-proxy-routes.ts base64 + URL-decoded fallback paths, Shoutcast manual redirect handler, direct fetch path) MUST call validateOutboundUrl on every redirect hop, NOT just the initial URL. `redirect:'follow'` is forbidden — use `redirect:'manual'` with a max-5-hop loop. Otherwise a public origin can 30x into 169.254.169.254 (cloud metadata), localhost, or other internal targets. validateOutboundUrl blocks IPv6 6to4 (2002::/16) and Teredo (2001::/32) tunnels in addition to standard private/loopback/link-local ranges. STREAM_ALLOWED_PORTS in stream-proxy-routes.ts is the single source of truth for stream port allowlist. NoSQL $regex with user input MUST be escaped with escapeRegex() (regex meta-chars: `.*+?^${}()|[]\\`) — applies to misc-routes.ts and user-auth-routes.ts user-search filters.

CRITICAL CORS RULE: CORS middleware in index-api.ts must run BEFORE rate limiters. If rate limiter returns 429 before CORS headers are set, browsers block the response entirely — causing "No Access-Control-Allow-Origin" errors and making the site appear completely down. Origin-aware CORS: requests from themegaradio.com get `Access-Control-Allow-Credentials: true`; other origins get `Access-Control-Allow-Origin: *`.

CRITICAL STRUCTURED DATA RULE: WebSite schema has @id=`{domain}/#website` and alternateName. Organization schema has @id=`{domain}/#organization` and logo as ImageObject. FAQPage schema is present BOTH in SSR (seo-renderer.ts) AND in client SeoHead.tsx for `pageType==='home'` — do NOT remove the home FAQ from SeoHead or it disappears after React hydration. BreadcrumbList schema on station pages must always match visible breadcrumb nav in the React component (client/src/pages/stations/[id].tsx). BreadcrumbList positions are re-numbered after splice to guarantee sequential 1,2,3... order. sameAs removed from Organization schema since social accounts unverified. BroadcastService JSON-LD uses JSON.stringify() for proper character escaping — never use template literal interpolation for description fields.

CRITICAL MULTILINGUAL H1 RULE: Station page H1 uses translation keys `seo_from` and `seo_listen_live_online` for localized rendering. Never hardcode English "from" or "Listen Live Online" in the station H1 template.

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
- **UI**: Tailwind CSS with shadcn/ui
- **Build Tool**: Vite
- **Audio Streaming**: HLS.js with Plyr
- **UI/UX**: Responsive mobile-first design, consistent design system, functional audio player.

### Deployment
- **Architecture**: Three-service split deployment: backend-api (api.themegaradio.com), frontend-web (themegaradio.com), stream-proxy (stream.themegaradio.com).
- **Stream Proxy**: Dedicated service for audio stream proxying (HTTP only) and image proxying. HTTPS streams connect directly without proxy. Solves API server ext memory explosion (25MB→700MB+).
- **Smart Proxy Routing**: Client uses `getStreamProxyUrl()` for stream/image proxy URLs, `getApiProxyUrl()` for API calls. VITE_STREAM_PROXY_URL env var configures proxy URL.
- **Containerization**: Docker for builds and deployment (Dockerfile.api, Dockerfile.web, Dockerfile.proxy).

### Key Architectural Decisions
- **Monorepo**: Unified repository for all components.
- **Type Safety**: End-to-end TypeScript with Zod validation.
- **SEO Optimization**: Slug-based URLs, dynamic sitemaps, structured data, multilingual hreflang.
- **Performance**: Caching, indexing, lazy loading, Core Web Vitals optimization, precomputed caches.
- **Geolocation**: Cloudflare headers and GPS for nearby stations.
- **Audio Continuity**: Preserves playback during navigation.
- **User Engagement**: Real user data drives trends and recommendations.
- **Internationalization**: 56-language support, dynamic cache warming, country-specific URL translations.
- **Background Audio Protection**: Multi-layer system to prevent browser audio suspension.
- **Image Optimization**: Server-side image resizing and WebP conversion with Sharp, stored on S3.
- **Memory Management**: Multi-layer OOM prevention using RSS monitoring, periodic GC, jemalloc, optimized HTTP server settings, and stream-aware memory pressure response (force-close active streams when ext>300MB or RSS>warning).
- **Self-Watchdog**: Both API and Web servers ping their own `/healthz` every 30s. After 3 consecutive failures, auto-restarts via SIGTERM. Additionally, watchdog monitors `mongoose.connection.readyState` — if MongoDB is not `connected` (state !== 1) for >3 minutes, forces restart. Prevents "zombie" state where process runs but DB is permanently disconnected.
- **MongoDB Circuit Breaker**: API requests return 503 when MongoDB is disconnected/disconnecting, preventing request queue buildup during reconnection.
- **MongoDB App-Level Reconnect**: `server/db-mongo.ts` implements explicit exponential-backoff reconnect (1s→2s→4s→…→60s max) on `disconnected` event or failed initial connect. Does not rely solely on Mongoose's passive auto-reconnect. `getMongoHealth()` exposes `{ readyState, isConnected, reconnectAttempt, reconnectScheduled }` for diagnostics.
- **Fail-Fast Exit**: `uncaughtException` and non-transient `unhandledRejection` trigger SIGTERM-based graceful shutdown (fail-fast) instead of log-and-continue. Transient MongoDB errors (MongoNetworkError, MongoServerSelectionError, ECONNRESET, ETIMEDOUT, ENOTFOUND, server selection) are logged but NOT fatal — they are handled by the reconnect loop.
- **SEO Render Protection**: Limits concurrent SSR, timeouts, bot rate limiting, event loop lag monitoring, and robust error handling for SSR failures.
- **Subscription System**: Supports various plans (`remove_ads`, `premium_monthly`, `premium_yearly`, `premium_lifetime`) with feature matrices and robust API for purchase reporting, status checking, and admin overrides.

## External Dependencies
- **MongoDB Atlas**: Cloud database service.
- **Radio-Browser API**: Third-party radio station data.
- **ip-api.com**: Geolocation API.
- **Cloudflare**: CDN, caching, and RUM Web Vitals.
- **AWS S3**: Cloud storage for media assets (logos, avatars).
- **mongoose**: MongoDB Object Data Modeling (ODM) library.
- **@tanstack/react-query**: Data fetching and state management.
- **axios**: Promise-based HTTP client.
- **node-cron**: Task scheduling.
- **@radix-ui/***: UI component library for accessibility.
- **tailwindcss**: Utility-first CSS framework.
- **wouter**: Small routing library for React.
- **react-hook-form**: Form validation and management.
- **vite**: Frontend build tool.
- **typescript**: Language for type safety.
- **bcrypt**: Password hashing library.
- **zod**: Schema declaration and validation library.
- **hls.js**: JavaScript library for HLS playback.
- **plyr**: Lightweight HTML5 media player.
- **sharp**: High-performance image processing.
- **multer**: Middleware for handling `multipart/form-data`.