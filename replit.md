# Mega Radio Station Management System

## Overview
This project is a full-stack radio station management application providing streaming and management capabilities for radio stations. It features a comprehensive admin interface, real-time monitoring, robust audio format compatibility, and a slug-based URL system for SEO. The system supports user management, social interactions, geolocation, advanced search, authentic user engagement data, trending stations, and machine learning-powered recommendations. The core vision is to establish a leading platform in digital audio, utilizing AI-driven content delivery and advanced HLS session management for global reach and uninterrupted streaming.

## User Preferences
Preferred communication style: Simple, everyday language.

CRITICAL UI RULE: Never use duplicate headers and footers - RadioHeader and Footer are already provided by the main App.tsx PlayerWrapper, so individual pages should NEVER import or include their own RadioHeader/Footer components.

CRITICAL ADMIN UI RULE: Edit popups and admin dialogs must ALWAYS stay light/white theme, never dark theme. User preference: popups should always be bright with light backgrounds and dark text for readability.

CRITICAL SEO HEADING RULE: Only ONE H1 per page (provided by server-rendered content in seo-renderer.ts). All content sections (RadioFAQ, About, etc.) must use H2 for main headings and H3/H4 for subsections to maintain proper heading hierarchy across all 57 languages.

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
- **UI/UX Decisions**: Pixel-perfect, responsive mobile-first design, consistent design system, functional audio player, original error handling.

### Database Design
- **Collections**: Stations, Countries, Languages, Genres, Codecs, Sync Logs, Users, StationComment, UserSession, Notification, AdvancedSearch.
- **Key Fields**: Slugs for navigation, poster images, detailed metadata, activity logs.
- **Enhanced User Model**: `favoriteStations`, `recentlyPlayedStations`, user preferences, authentication.

### Route Module Architecture (COMPLETE)
`server/routes.ts` was refactored from 22,718 lines to 451-line thin orchestrator. All modules live under `server/routes/`:
- `cast-routes.ts`, `og-image-routes.ts`, `cache-dashboard-routes.ts`, `admin-auth-routes.ts`
- `slug-routes.ts`, `ai-description-routes.ts`, `logo-routes.ts`, `admin-station-routes.ts`
- `station-public-routes.ts`, `genres-countries-routes.ts`, `translation-admin-routes.ts`
- `user-auth-routes.ts`, `mobile-tv-routes.ts`, `translation-keys-routes.ts`, `seo-sitemap-routes.ts`
- `stream-proxy-routes.ts`, `regions-recommendations-routes.ts`, `misc-routes.ts`
- `shared-utils.ts` (pure utilities), `server/middleware/auth.ts` (requireAuth, requireAdmin, generateAuthToken)
- Special routers (api-keys, url-translations, performance, user-engagement, country-language-mappings) registered directly in thin routes.ts

### Key Architectural Decisions
- **Monorepo Structure**: Frontend, backend, and shared types in a single repository.
- **Type Safety**: End-to-end TypeScript with Zod validation.
- **Rate Limiting**: Global 100 req/min API limiter + strict 10 req/15min for auth endpoints (express-rate-limit).
- **SEO-Friendly URLs**: Slug-based navigation, dynamic sitemap, robots.txt, structured data (JSON-LD), multilingual support with hreflang.
- **Audio Continuity**: URL updates and page navigation preserve audio playback.
- **Performance Optimizations**: Caching, database indexing, lazy loading, code splitting, Core Web Vitals optimization.
- **Local Font Hosting**: Ubuntu font served locally.
- **Instant Location Detection**: Cloudflare CF-IPCountry headers for geolocation.
- **Web Push Notifications**: VAPID keys and service workers.
- **Smart Direct Streaming**: HTTPS streams not proxied; HTTP streams use intelligent fallback with proxy.
- **Comprehensive Auto-Reconnect & Server Timeout Optimization**: Client-side auto-reconnect; optimized server-side timeouts.
- **Vote-Based Station Ordering**: Defaults to popularity.
- **Google OAuth Authentication**: Fully operational Google login.
- **Radio Station Sync System**: Robust synchronization with automated index migration, duplicate prevention, and blacklist checking.
- **Authentic User Engagement**: Real user favorites power trending stations and recommendations.
- **Listening Timer Feature**: Real-time listening timer displays duration on station detail pages.
- **Internationalization**: 56-language SEO coverage, dynamic cache warmup, multilingual sitemap generation.
- **Centralized Country Normalization**: `normalizeCountryFilter()` in `server/utils/normalize-country.ts` handles ISO codes (TR/US/RU/GB), English names (Turkey/Russia), native names (Türkiye/Deutschland), and localized names across 6+ languages. Used by all station/genre/popular/nearby endpoints for consistent results.
- **Country-Specific Genre Filtering**: Authentic genre filtering based on station tags.
- **Background Audio Prevention System**: 5-layer protection against browser audio suspension.
- **Geolocation & Country Detection System**: IP-based geolocation for auto-detection and personalization, including GPS-based nearby stations.
- **SEO FAQ Content Management**: Admin-manageable, translatable FAQ for homepage SEO.
- **Automatic Image Optimization**: Server-side image resizing and WebP conversion using Sharp for station favicons.
- **Country-Specific URL Translations**: Complete URL translation system with database-first priority.
- **Universal Country Code Navigation**: All navigation links use `getLocalizedPath()` to preserve country codes.
- **Scheduled SEO Cache Clear**: Nightly service clears server and Cloudflare caches for fresh AI-generated content.
- **Core Web Vitals Monitoring**: RUM integration with Cloudflare.
- **Logo Optimization System**: MongoDB schema update for `logoAssets`, LogoProcessor service for WebP conversion, unified StationLogo component, SSR-safe helpers, admin UI for bulk processing.
- **Non-Latin Script SEO Routing Fix**: `decodeURIComponent()` and Unicode flags for proper SEO across non-Latin scripts.
- **Precomputed Stations Cache System**: Ultra-fast `/radios` page performance with pre-computed country-level station cache.
- **Unified Language URL Prefix System**: All languages (including English) now use `/{lang}/*` URL format for SEO consistency with 301 redirects for legacy English URLs.
- **API Key Management System**: Secure API key generation, validation, rate limiting, and usage tracking with various plans (Demo, Free, Pro).
- **Cast System (Mobile → TV)**: Dual cast architecture: (1) WebSocket-based at `/ws/cast` for real-time command relay, (2) Polling-based HTTP endpoints for TV apps without WebSocket support. Polling endpoints: `GET /api/cast/poll` (TV polls every 3s), `POST /api/cast/send` (mobile sends commands), `POST /api/cast/now-playing` (TV reports playback), `GET /api/cast/now-playing` (mobile reads TV status). MongoDB `CastCommand` (24h TTL, consumed flag, deviceId scoping) and `CastNowPlaying` (unique per userId+deviceId) models. Docs: `docs/cast-integration-guide.md`.
- **TV Device Code Login**: Netflix/YouTube-style TV login flow. TV requests 6-digit code → displays on screen → user enters on mobile → TV gets `mrt_tv_` prefixed token (90-day). Endpoints: `/api/auth/tv/code`, `/api/auth/tv/code/:code/status`, `/api/auth/tv/activate`, `/api/auth/tv/logout`, `/api/auth/tv/verify`. MongoDB `TvLoginCode` model with 10-min TTL. Rate-limited activation, unique code generation.

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

## Planned Improvements
- **S3 Logo Storage**: Station logos currently cached locally in `public/station-logos/` (runtime-generated, gitignored). Plan to migrate to Amazon S3 for scalable, persistent storage.
- **Logo Processor** (`server/services/logo-processor.ts`): Creates WebP variants in `public/station-logos/{slug}/` folders. Will need refactoring when S3 migration happens.