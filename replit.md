# Mega Radio Station Management System

## Overview
This project is a full-stack radio station management application offering streaming and management capabilities for radio stations. It features a comprehensive admin interface, real-time monitoring, robust audio format compatibility, and a slug-based URL system for SEO. The system supports user management, social interactions, geolocation, advanced search, authentic user engagement data, trending stations, and machine learning-powered recommendations. The core vision is to establish a leading platform in digital audio, utilizing AI-driven content delivery and advanced HLS session management for global reach and uninterrupted streaming.

## User Preferences
Preferred communication style: Simple, everyday language.

CRITICAL UI RULE: Never use duplicate headers and footers - RadioHeader and Footer are already provided by the main App.tsx PlayerWrapper, so individual pages should NEVER import or include their own RadioHeader/Footer components.

CRITICAL ADMIN UI RULE: Edit popups and admin dialogs must ALWAYS stay light/white theme, never dark theme. User preference: popups should always be bright with light backgrounds and dark text for readability.

CRITICAL SEO HEADING RULE: Only ONE H1 per page (provided by server-rendered content in seo-renderer.ts). All content sections (RadioFAQ, About, etc.) must use H2 for main headings and H3/H4 for subsections to maintain proper heading hierarchy across all 57 languages.

CRITICAL SEO COMPLIANCE RULE: NO sr-only H3 headings with SEO keywords on any page (Google Hidden Text policy). NO boilerplate template text in SSR body (Google Scaled Content Abuse policy). SSR station body must ONLY contain: AI description + station details + nav links.

CRITICAL LASTMOD RULE: Station sitemaps must ONLY include `<lastmod>` when real `updatedAt` data exists in the DB. If `updatedAt` is missing, omit `<lastmod>` entirely — never use today's date as fallback (Google treats fake lastmod as spam signal).

CRITICAL UGC RULE: User-submitted comments are stripped of HTML tags on input (max 1000 chars) and on output. Any future comment rendering with links MUST use `rel="nofollow ugc noopener"` to comply with Google's UGC spam policy.

CRITICAL SITEMAP RULE: sitemap-index.xml references ONLY existing routes: sitemap-main-{lang}.xml, sitemap-genres-{lang}.xml, sitemap-stations-{lang}-{chunk}.xml. Never add sitemap-images-*, sitemap-stations-{digit}.xml, sitemap-news.xml, sitemap-videos.xml back — these violate Google policies or don't exist. robots.txt must only list sitemap-index.xml. sitemap-main.xml is a 301 redirect to sitemap-main-en.xml. Deprecated sitemap URLs (/sitemap-news.xml, /sitemap-videos.xml, /sitemap-images-*.xml, /sitemap-stations-{digit}.xml) return 410 Gone to prevent soft-404.

CRITICAL HREFLANG RULE: ALL sitemaps use plain language codes (en, de, tr) — NEVER ISO codes (en-US, de-DE). All URLs in sitemaps must be language-prefixed (/en/stations not /stations). Every URL must have x-default hreflang pointing to the /en/ version.

CRITICAL STRUCTURED DATA RULE: WebSite schema has @id=`{domain}/#website` and alternateName. Organization schema has @id=`{domain}/#organization` and logo as ImageObject. FAQPage schema is present BOTH in SSR (seo-renderer.ts) AND in client SeoHead.tsx for `pageType==='home'` — do NOT remove the home FAQ from SeoHead or it disappears after React hydration. BreadcrumbList schema on station pages must always match visible breadcrumb nav in the React component (client/src/pages/stations/[id].tsx). BreadcrumbList positions are re-numbered after splice to guarantee sequential 1,2,3... order. sameAs removed from Organization schema since social accounts unverified. BroadcastService JSON-LD uses JSON.stringify() for proper character escaping — never use template literal interpolation for description fields.

CRITICAL MULTILINGUAL H1 RULE: Station page H1 uses translation keys `seo_from` and `seo_listen_live_online` for localized rendering. Never hardcode English "from" or "Listen Live Online" in the station H1 template.

## System Architecture

### Backend Architecture
- **Framework**: Express.js with TypeScript
- **Database**: MongoDB with Mongoose ODM
- **API Style**: REST API
- **Session Management**: MemoryStore
- **Caching**: Multi-layer caching with NodeCache and Redis.
- **Core Services**: Data synchronization, user management, station requests/submissions, advertisement management, CMS, duplicate detection, merging.

### Frontend Architecture
- **Framework**: React with TypeScript
- **Routing**: Wouter
- **State Management**: TanStack Query
- **UI Framework**: Tailwind CSS with shadcn/ui components
- **Build Tool**: Vite
- **Audio Streaming**: Advanced HLS.js integration with Plyr.
- **UI/UX Decisions**: Pixel-perfect, responsive mobile-first design, consistent design system, functional audio player.

### Database Design
- **Collections**: Stations, Countries, Languages, Genres, Codecs, Sync Logs, Users, StationComment, UserSession, Notification, AdvancedSearch.
- **Key Fields**: Slugs for navigation, poster images, detailed metadata, activity logs.
- **Enhanced User Model**: `favoriteStations`, `recentlyPlayedStations`, user preferences, authentication.

### Key Architectural Decisions
- **Monorepo Structure**: Frontend, backend, and shared types in a single repository.
- **Type Safety**: End-to-end TypeScript with Zod validation.
- **Rate Limiting**: Global and auth-specific rate limiting using `express-rate-limit`.
- **SEO-Friendly URLs**: Slug-based navigation, dynamic sitemap, robots.txt, structured data (JSON-LD), multilingual support with hreflang, unified language URL prefix system.
- **Audio Continuity**: URL updates and page navigation preserve audio playback.
- **Performance Optimizations**: Caching, database indexing, lazy loading, code splitting, Core Web Vitals optimization, precomputed station caches, optimized user profile data fetching.
- **Local Font Hosting**: Ubuntu font served locally.
- **Instant Location Detection**: Cloudflare CF-IPCountry headers for geolocation.
- **Web Push Notifications**: VAPID keys and service workers.
- **Smart Direct Streaming**: HTTPS streams not proxied; HTTP streams use intelligent fallback with proxy.
- **Comprehensive Auto-Reconnect & Server Timeout Optimization**: Client-side auto-reconnect; optimized server-side timeouts.
- **Vote-Based Station Ordering**: Defaults to popularity.
- **Google OAuth Authentication**: Fully operational Google login with avatar management.
- **Radio Station Sync System**: Robust synchronization with automated index migration, duplicate prevention, and blacklist checking.
- **Authentic User Engagement**: Real user favorites power trending stations and recommendations, real station ratings.
- **Listening Timer Feature**: Real-time listening timer displays duration on station detail pages.
- **Internationalization**: 56-language SEO coverage, dynamic cache warmup, multilingual sitemap generation, country-specific URL translations, centralized country normalization.
- **Background Audio Prevention System**: 5-layer protection against browser audio suspension.
- **Geolocation & Country Detection System**: IP-based geolocation for auto-detection and personalization, including GPS-based nearby stations.
- **SEO FAQ Content Management**: Admin-manageable, translatable FAQ for homepage SEO.
- **Automatic Image Optimization**: Server-side image resizing and WebP conversion using Sharp for station favicons, integrated with S3 for storage. Image proxy has memory-safe guards: 2MB download limit, 6-concurrent Sharp semaphore, content-type/magic-byte validation, 512px dimension cap, and proper cleanup to prevent OOM on Railway.
- **Memory Management**: Multi-layer OOM prevention — heap monitor every 5min (warn >6000MB, critical >7000MB clears ALL caches: performance, precomputed, OG images, CacheManager patterns). Railway runs with `--max-old-space-size=8192 --expose-gc` (32GB server). ogImageCache maxKeys=500/1hr TTL, seoHtmlCache maxKeys=2000, pageDataCache maxKeys=2000, quickCache maxKeys=2000, memoryCache maxKeys=5000, similarStationsCache maxKeys=500, precomputed TTLs=24hr. PrecomputedStations aggregate limited to 3000 per country.
- **Startup Stability**: Staged cache warmup — web warmup first (5s delay), then TV/Mobile (10s gap), PrecomputedGenres (15s), hasLogo migration (30s). All warmup loops have intra-iteration delays (50-200ms) to prevent event loop blocking. LogCollector auto-disables after 3 consecutive S3 flush failures. Sitemap station count cached 24h to avoid MongoDB timeouts.
- **API Key Management System**: Secure API key generation, validation, rate limiting, and usage tracking.
- **Cast System (Mobile → TV)**: Dual cast architecture supporting WebSocket and polling-based communication for real-time command relay and now-playing status.
- **TV Device Code Login**: Netflix/YouTube-style TV login flow for device activation.
- **Security Hardening**: Rate limiting, X-Powered-By removal, security headers (HSTS, CSP, X-Frame-Options), suppressed internal error messages.
- **Input Validation**: Robust validation for user authentication endpoints.
- **Random Station Performance**: Optimized random station selection using MongoDB `$sample`.
- **Logo Optimization System**: MongoDB schema for `logoAssets`, LogoProcessor service for WebP conversion, unified StationLogo component, SSR-safe helpers, admin UI for bulk processing, S3 integration for logo storage.

## External Dependencies
- **MongoDB Atlas**: Cloud database service.
- **Radio-Browser API**: External radio station database.
- **ip-api.com**: Geolocation service.
- **Cloudflare**: Cache management and RUM Web Vitals data.
- **mongoose**: MongoDB object modeling.
- **@tanstack/react-query**: Server state management.
- **axios**: HTTP client.
- **node-cron**: Scheduled task management.
- **@radix-ui/***: Accessible UI primitives.
- **tailwindcss**: CSS framework.
- **wouter**: React router.
- **react-hook-form**: Form handling.
- **vite**: Build tool.
- **typescript**: Type safety.
- **bcrypt**: Password hashing.
- **zod**: Schema validation.
- **hls.js**: Professional HLS streaming library.
- **plyr**: Lightweight media player.
- **sharp**: High-performance image processing library.
- **AWS S3**: Cloud storage for station logos.