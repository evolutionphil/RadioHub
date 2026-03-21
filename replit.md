# Mega Radio Station Management System

## Overview
This project is a full-stack radio station management application providing streaming and management capabilities. It features a comprehensive admin interface, real-time monitoring, broad audio format compatibility, and SEO-friendly URL structures. Key capabilities include user management, social interactions, geolocation, advanced search, authentic user engagement data, trending stations, and machine learning-powered recommendations. The vision is to establish a leading platform in digital audio with AI-driven content delivery and advanced HLS session management for global reach and uninterrupted streaming.

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

CRITICAL HREFLANG RULE: ALL sitemaps use plain language codes (en, de, tr) — NEVER ISO codes (en-US, de-DE). All URLs in sitemaps must be language-prefixed (/en/stations not /stations). Every URL must have x-default hreflang pointing to the /en/ version.

CRITICAL STRUCTURED DATA RULE: WebSite schema has @id=`{domain}/#website` and alternateName. Organization schema has @id=`{domain}/#organization` and logo as ImageObject. FAQPage schema is present BOTH in SSR (seo-renderer.ts) AND in client SeoHead.tsx for `pageType==='home'` — do NOT remove the home FAQ from SeoHead or it disappears after React hydration. BreadcrumbList schema on station pages must always match visible breadcrumb nav in the React component (client/src/pages/stations/[id].tsx). BreadcrumbList positions are re-numbered after splice to guarantee sequential 1,2,3... order. sameAs removed from Organization schema since social accounts unverified. BroadcastService JSON-LD uses JSON.stringify() for proper character escaping — never use template literal interpolation for description fields.

CRITICAL MULTILINGUAL H1 RULE: Station page H1 uses translation keys `seo_from` and `seo_listen_live_online` for localized rendering. Never hardcode English "from" or "Listen Live Online" in the station H1 template.

## System Architecture

### Backend
- **Framework**: Express.js with TypeScript
- **Database**: MongoDB with Mongoose
- **API**: REST API
- **Caching**: Multi-layer (NodeCache, Redis)
- **Core Services**: Data sync, user/station management, advertising, CMS, duplicate detection.

### Frontend
- **Framework**: React with TypeScript
- **Routing**: Wouter
- **State Management**: TanStack Query
- **UI**: Tailwind CSS with shadcn/ui
- **Build Tool**: Vite
- **Audio Streaming**: HLS.js with Plyr
- **UI/UX**: Responsive mobile-first design, consistent design system, functional audio player.

### Database Design
- **Collections**: Stations, Countries, Languages, Genres, Codecs, Sync Logs, Users, Comments, Sessions, Notifications, AdvancedSearch.
- **Key Fields**: Slugs, poster images, metadata, activity logs.
- **User Model**: `favoriteStations`, `recentlyPlayedStations`, preferences, authentication.

### Key Architectural Decisions
- **Monorepo Structure**: Unified repository for frontend, backend, and shared types.
- **Type Safety**: End-to-end TypeScript with Zod.
- **Rate Limiting**: Global and auth-specific.
- **SEO Optimization**: Slug-based URLs, dynamic sitemaps, robots.txt, structured data (JSON-LD), multilingual hreflang support, unified language URL prefixes.
- **Audio Continuity**: Preserves playback during navigation.
- **Performance**: Caching, indexing, lazy loading, code splitting, Core Web Vitals optimization, precomputed caches, optimized profile data fetching.
- **Geolocation**: Cloudflare CF-IPCountry headers, GPS-based nearby stations.
- **Web Push Notifications**: VAPID keys and service workers for silent pushes.
- **Smart Direct Streaming**: HTTPS streams not proxied; HTTP streams use intelligent fallback with proxy and idempotent cleanup for memory leak prevention.
- **Auto-Reconnect & Server Timeout**: Client-side auto-reconnect, optimized server-side timeouts.
- **Vote-Based Ordering**: Stations ordered by popularity.
- **Google OAuth**: Integrated login and avatar management.
- **Radio Station Sync System**: Robust synchronization with automated index migration, duplicate prevention.
- **User Engagement**: Real user favorites/ratings drive trends and recommendations.
- **Internationalization**: 56-language SEO coverage, dynamic cache warmup, multilingual sitemap generation, country-specific URL translations, universal country normalization.
- **Background Audio Protection**: 5-layer system to prevent browser audio suspension.
- **Image Optimization**: Server-side image resizing and WebP conversion using Sharp, stored on S3. Includes memory-safe guards for image proxy.
- **Memory Management**: Multi-layer OOM prevention including heap monitoring and cache clearing. Memory-critical GC has 15-minute cooldown to prevent GC death spiral. `global.gc()` REMOVED from event loop load shedding (was causing synchronous freeze spiral). Proactive cache clearing at 3000MB (30-min cooldown). Memory warnings rate-limited to 15-min intervals. Cache maxKeys reduced (seoHtml/pageData/quick: 500, memoryCache: 2000) with useClones=false everywhere. All NodeCache `.set()` calls wrapped in `safeSet()` — catches `ECACHEFULL`, evicts oldest 30% of keys (not full flush) and retries once, with rate-limited warnings (60s cooldown per cache). SEO cache key uses `cleanUrl` (query/hash stripped) to prevent unbounded key cardinality. Station detail pages excluded from pageDataCache (high cardinality: 40k+ stations × 57 langs) — only low-cardinality pages (home, genres, about) are cached.
- **Event Loop Protection**: Load shedding has 10-minute cooldown (prevents repeated cache clearing). Lag logging rate-limited to max 1 per minute (prevents log collector feedback loop). Log collector skips EVENT LOOP LAG/LOAD SHEDDING/BLOCKED messages to prevent S3 flush storms.
- **Startup Stability**: Staged cache warmup, event loop blocking prevention, log collector safeguards. Daily auto-restart at 4:00 AM Europe/Berlin via SIGTERM (graceful shutdown) — Railway `restartPolicyType=ALWAYS` ensures container always restarts. Health check at `/health` AND `/api/health`.
- **API Key Management**: Secure generation, validation, rate limiting, and usage tracking.
- **Cast System**: Dual architecture (WebSocket/polling) for real-time command and now-playing status.
- **TV Device Code Login**: Netflix/YouTube-style activation.
- **Security**: Rate limiting, X-Powered-By removal, security headers, suppressed internal error messages.
- **Process Stability**: Global error handlers, graceful shutdown, event loop lag monitoring, MongoDB readyState monitoring, per-user WebSocket limits, strict ICY metaInterval validation, streaming for description cleanup, compression level optimization. Axios stream `destroy()` in finally blocks, native HTTP redirect path cleanup, hardDeadline timer cleanup via `clearTimeout`, bounded Sharp queue (MAX_SHARP_QUEUE=20 rejects when full), AI description job auto-cleanup (30-min TTL after completion).
- **External API Resilience**: iTunes API circuit breaker, recommendation engine guard against concurrent computations.
- **MongoDB Aggregate Timeouts**: Limits on heavy aggregates, `allowDiskUse` for genre aggregates, inter-iteration delays for warmup loops.
- **Precomputed Genres Optimization**: Only top 19 countries refreshed automatically.
- **Input Validation**: Robust for user authentication.
- **Random Station Selection**: Optimized using MongoDB `$sample`.
- **Logo Optimization**: MongoDB schema, LogoProcessor service, unified component, S3 integration.

## External Dependencies
- **MongoDB Atlas**: Cloud database.
- **Radio-Browser API**: External radio station data.
- **ip-api.com**: Geolocation service.
- **Cloudflare**: Cache management and RUM Web Vitals.
- **mongoose**: MongoDB ODM.
- **@tanstack/react-query**: Server state management.
- **axios**: HTTP client.
- **node-cron**: Scheduled tasks.
- **@radix-ui/***: Accessible UI primitives.
- **tailwindcss**: CSS framework.
- **wouter**: React router.
- **react-hook-form**: Form handling.
- **vite**: Build tool.
- **typescript**: Type safety.
- **bcrypt**: Password hashing.
- **zod**: Schema validation.
- **hls.js**: HLS streaming library.
- **plyr**: Media player.
- **sharp**: Image processing.
- **AWS S3**: Cloud storage for logos and user avatars.
- **multer**: Multipart form-data handling for file uploads.

## Performance Optimization Notes
- **Font Preloading**: Preload ubuntu-400, ubuntu-500, ubuntu-700 (actual critical fonts per PageSpeed analysis). ubuntu-600 removed from preload.
- **cast_sender.js**: Loaded with `async` attribute (was render-blocking 750ms mobile). Chromecast still works via `__onGCastApiAvailable` callback.
- **FloWAlive SDK**: DISABLED — WebSocket endpoint (flowalive-api.esimfo.com) unreachable (ERR_NAME_NOT_RESOLVED). Saves 121KB download. Re-enable when service restored.
- **Ahrefs Analytics**: DISABLED — analytics.ahrefs.com returns ERR_FAILED. Re-enable when endpoint verified.
- **Station Logos**: Size-aware asset selection — webp96 for cards/small (≤96px display), webp256 for hero/player/xl (>96px display). Reduces bandwidth ~60% for listing pages.
- **Hero Images**: heroleft.png converted to responsive WebP (300w mobile, 500w desktop). Saves ~20KB per page load.
- **Logo Icon**: Header/footer use 100w optimized version (2.4KB vs 34.7KB original). Full size kept for structured data/og:image.
- **Hero Background**: Explicit width/height attributes added to prevent CLS, decoding="async" for non-blocking decode.
- **Memory Management**: `/api/location` returns graceful fallback instead of 500 error. WebSocket metadata reconnect uses exponential backoff (2s→30s max).