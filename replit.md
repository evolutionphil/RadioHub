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

CRITICAL HREFLANG RULE: ALL sitemaps use plain language codes (en, de, tr) — NEVER ISO codes (en-US, de-DE). All URLs in sitemaps must be language-prefixed (/en/stations not /stations). Every URL must have x-default hreflang pointing to the /en/ version.

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
- **Architecture**: Supports monolithic or split deployment (backend-api and frontend-web services) for scalability.
- **Containerization**: Docker for builds and deployment.

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
- **Memory Management**: Multi-layer OOM prevention using RSS monitoring, periodic GC, jemalloc, and optimized HTTP server settings.
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