# Mega Radio Station Management System

## Overview
The Mega Radio Station Management System is a full-stack application designed for global radio station streaming and broadcasting management. It aims to deliver personalized listening experiences and advanced broadcasting tools, positioning itself as a leader in the online radio market. Key capabilities include diverse audio format support, robust user management, social interaction features, geolocation-based content delivery, sophisticated search functionalities, data-driven trend analysis, and AI-powered recommendations. The project's vision is to capture a significant online radio audience through a comprehensive, high-performance, and stable platform.

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

CRITICAL MOBILE PERFORMANCE RULE: Mobile PageSpeed score'unu korumak için:
1) `vite.config.ts` `rollupOptions.output.manualChunks` KORUNMALI — react-vendor / query-vendor / radix-vendor / icons-vendor / media-vendor / forms-vendor ayrımı tree-shaking'i bozmadan lucide-react ikon parçalanmasını engeller.
2) `client/src/pages/radio-frontend.tsx` içinde `extendedPopularStationsData` AYRI bir useQuery olarak EKLENMEMELİ — `popularStationsData` ile aynı URL'yi (`/api/stations/precomputed?countryName=X&page=1&limit=12`) çağırıyor, sadece alias olarak kalmalı.
3) Country-change useEffect'inde broad `invalidateQueries({ predicate })` EKLENMEMELİ — TanStack Query queryKey değiştiğinde otomatik refetch yapar.
4) `InView` wrapper'ı (client/src/components/ui/in-view.tsx) artık `minHeight` defaultsuz; lazy bölümlerde CLS önlemek için ya `minHeight` prop'u ya `className="min-h-[...]"` verilmeli.
5) `client/index.html` hero preload media query'si HER ZAMAN `radio-frontend.tsx`'teki `<picture>` `<source media="(min-width: 768px)">` ile hizalı olmalı.
6) `client/index.html` `<link rel="preconnect" href="https://api.themegaradio.com" crossorigin>` 3-service split deploy'da KORUNMALI.
7) `TranslationPreloader.tsx` background prefetch (en+de) `'load'` event SONRASI çalışmalı.

CRITICAL INDEXABILITY-GATE RULE: For station URLs, indexability MUST be computed only via `getIndexableLanguagesForStation(station, qualifiedLangs)` / `isStationIndexableInLanguage(station, lang, qualifiedLangs)` from `server/seo/junk-station-rules.ts`. Sitemap inclusion, SSR robots/noindex + hreflang emission, SSR station-branch CANONICAL selection, and the 410-Gone decision MUST all use this exact gate. Junk stations MUST serve 410 Gone via `sendJunkGone()` in ALL paths. Cache-HIT paths MUST cross-check `performanceCache.getPageData(cleanUrl).pageData.stationIsJunk`. `pageDataCache.stdTTL` MUST be >= `seoHtmlCache.stdTTL`. Junk pages MUST emit zero hreflang alternates. Hreflang on a valid station MUST be restricted via `generateLanguageUrls(..., allowedLanguages)` using the same `indexable` array.

CRITICAL COUNTRY-PREFIX REDIRECT RULE: 2-letter URL prefixes that exist in `COUNTRY_TO_LANGUAGE` but NOT in enabled `SEO_LANGUAGES` (e.g. `/ph`, `/us`, `/au`, `/ca`, `/gb`, `/nz`, `‌/sg`, `/in`, `/ke`) MUST 301-redirect to `/<mapped-language>` BEFORE any SSR or security-header middleware runs. Implemented in BOTH `server/index-web.ts` and `server/index.ts`. Regex `/^\/([a-z]{2})(\/.*)?$/i` only matches exactly 2-letter first segments.

CRITICAL AUTH NOINDEX RULE: Auth pages (`/login`, `/signup`, `/sign-in`, `/sign-up`, `/register`, `/forgot-password`, `/reset-password`, `/change-password`, `/auth/*` — with optional `/<lang>/` prefix) MUST emit `X-Robots-Tag: noindex, follow` AND must NOT be blocked by `Disallow:` in robots.txt. The single source of truth for the auth regex is `AUTH_NOINDEX_PATH` in `server/index-web.ts` and `AUTH_NOINDEX_PATH_MAIN` in `server/index.ts` (mirrored). robots.txt MUST NOT contain `Disallow: /*/login`, `Disallow: /*/signup`, or `Disallow: /*/forgot-password`.

CRITICAL SSR IMG SURFACE RULE: Home SSR HTML MUST contain real `<img>` tags for the top-10 popular stations (S3 `logoAssets.webp256` URLs) so Bing/Google image crawlers can discover station logos. Visible `<img src=... alt=... width=256 height=256 loading=lazy>` is required. Implemented in `server/seo-renderer.ts` `generateHtmlBody` home branch (line ~927). The injected anchor URLs MUST follow the prefix-all canonical: `/<lang>/<localized-station-segment>/<slug>` for ALL languages including English.

CRITICAL SSR STATION DETAIL IMG RULE: Station detay sayfa SSR HTML'inde EXACTLY 1 station logo `<img>` tag bulunmalı (genelde `<figure>` içinde, alt="{name} logo — {country}", width/height=256, loading=eager+decoding=async). `pickLogoUrl(station)` helper'ı (server/seo-renderer.ts) kullanılır: `logoAssets.webp256 → webp96 → favicon` fallback chain, http(s) scheme guard, trim. `fetchpriority=high` kullanılmaz — LCP optimizasyonu için sadece loading=eager yeterlidir. Junk station 410 yolunda `<img>` üretilmez.

CRITICAL IMAGE SITEMAP NAMESPACE RULE: `/sitemap-stations-{lang}-{chunk}.xml` `<urlset>` MUST declare `xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"`. Her `<url>` içinde, station gerçek S3 logo URL'i varsa (`logoAssets.webp256 → webp96 → favicon`, http(s) scheme + `default-station.{png,webp,jpg,jpeg,svg}` placeholder reject), tek bir `<image:image><image:loc>...</image:image:loc></image:image>` child emit edilir. URL'ler XML-escape edilir (& < > " '). Mongo `.select()` `logoAssets favicon` field'larını içermeli. `/sitemap-images.xml` ve `/sitemap-images-{N}.xml` 410 Gone döner — sadece `image:image` extension kullanılır, ayrı image sitemap yok.

CRITICAL SSR PREFIX-ALL LANGPREFIX RULE: Tüm SSR branch'lerinde (home/station/genres/regions/country/search/faq/about/privacy) `<a>` href ve JSON-LD `url`/`@id` üretiminde, `langPrefix` veya inline language prefix MUTLAKA `/${language}` formatında — `language === 'en' ? '' : '/'+language` ASLA kullanılmaz. `searchPath` (WebSite SearchAction `urlTemplate`), ItemList `stationUrl`, RadioStation `@id`/`url` dahil. Localized URL segment için `urlTranslations.get(\`${language}:station\`)` (en→station, tr→istasyon, de→sender) kullanılır. Bu kural seo-config.ts CRITICAL CANONICAL RULE ile uyumlu — /en homepage `/en` self-canonical, asla bare `/` değil.

CRITICAL WOUTER LOCALIZED REGIONS ROUTE RULE: `client/src/App.tsx` içinde, dil-spesifik translated `regions` blok'unda (~line 731-740) `/:citySlug?/stations` literal mount ETMEK YETMİYOR — Türkçe `/istasyonlar`, Almanca `/sender`, İspanyolca `/emisoras-radio` gibi localized stations suffix'leri için ayrı bir `<Route path={`/${langConfig.code}/${translations['regions']}/:regionSlug/:countrySlug/:citySlug?/${translations['stations']}`} />` mount EDİLMELİDİR. Yoksa wouter literal `/stations` ile match edemediği için catch-all `/:countryCode/:rest*` (line ~1083) yakalar, PlayerWrapper render olur ama `useParams()` `{countryCode, rest}` döner — `regionSlug/countrySlug/citySlug` undefined olur, sayfa boş skeleton + API'ye undefined slug istek atar = kullanıcı 404 görür. Footer'dan herhangi bir 5-segment ülke linkine basınca 404 alıyorsa root cause budur. English route'lar (line 611, 757, 978, 1038) literal `/stations` ile doğru — değiştirmeyin.

CRITICAL META DESCRIPTION LENGTH RULE: Tüm `<meta name="description">`, `og:description`, `twitter:description` MAX 145 karakter olmalı (≈1000 px Sebility/Yandex sınırı). Word-boundary truncation zorunlu — `truncateAtWordBoundary(text, 145)` (`shared/seo-config.ts:11`) tek source-of-truth helper. ASLA `substring(0, 160)` kullanma — yarım kelime ("Mega Rad", "60") bırakır. `server/seo-renderer.ts:1715` `ensureDescriptionLength` İngilizce `DESCRIPTION_PAD_TAIL` kullanmıyor — dil-karışıklığını önler (önceki bug: DE AI meta + "Listen free on Mega Radio — 60" İngilizce tail). `getStationMetaDescription` (shared/seo-config.ts:1458) içindeki padding clauses dil-aware: `translations['stations']`, `translations['from']`, `translations['countries']`, `translations['twenty_four_seven']`. MIN 130 / MAX 145 char penceresi — bu pencere dışında ASLA padding ekleme.

CRITICAL ADMIN STATION UPLOAD RULE: Admin panel station logo upload + edit-save uses TWO endpoints in `server/routes/admin-station-routes.ts`:
1) `POST /api/admin/stations/:id/upload-favicon` — multer.memoryStorage 5MB image-only multipart, calls `logoProcessor.processFromBuffer(stationId, slug, buffer, originalname)` → AWS S3 (`station-logos/{folder}/logo-256.webp` + `original.{ext}` via `uploadToS3`), then mirrors `logoAssets.webp256` (S3 URL) into `station.favicon` via `Station.updateOne` so `favicon` field is ALWAYS the S3 URL after upload. NEVER use Replit Object Storage (`ObjectStorageService.getFaviconUploadURL`) — that is dead code path; AWS S3 is the only allowed backend (AWS_BUCKET_NAME, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY env vars).
2) `PUT /api/stations/:stationId` — admin station metadata update with strict whitelist `STATION_UPDATE_ALLOWED_FIELDS = [name, url, homepage, favicon, country, countryCode, language, tags, bitrate, codec, hls, noIndex]`. NEVER allow `_id, slug, logoAssets, createdAt, updatedAt, votes, clickcount` (slug change would break canonical URLs). If admin pastes a non-S3 favicon URL, fire-and-forget `logoProcessor.processFromUrl(stationId, slug, url)` to mirror it to S3.
Both endpoints MUST: validate `mongoose.Types.ObjectId.isValid()`, use `requireAdmin`, call `performanceCache.invalidateStationCache(slug)` after write. Frontend `station-edit-dialog.tsx` and `station-form.tsx` use `${station._id || station.id}` (Mongo `.lean()` only returns `_id`). `logoProcessor.processFromBuffer` MUST have `processingQueue.has/add` guard with `finally { processingQueue.delete }` to prevent concurrent uploads corrupting the same station's S3 folder.

CRITICAL GENRES/REGIONS IMG GRID RULE: Genres ve Regions/Country SSR branch'leri Mongo'dan top-12 station fetch eder ve `<img>` grid üretir. Mongo `.select()` MUTLAKA `name slug favicon logoAssets country countryCode tags votes descriptions url homepage bitrate lastCheckOk` field'larını içermeli — eksik `url` field `isJunkStation` tarafından "empty-stream-url" olarak yorumlanır ve TÜM istasyonlar junk işaretlenir (grid 0 img verir). Junk filter sadece `!isJunkStation(s) && s.noIndex !== true` kullanır — `isStationIndexableInLanguage` BURADA KULLANILMAZ (over-restrictive: meta+full descriptions zorunluluğu image grid amacı için aşırı). Country page için `https://flagcdn.com/w320/{cc}.png` flag `<img>` da emit edilir.

## System Architecture

### Backend
- **Framework**: Express.js with TypeScript.
- **Database**: MongoDB with Mongoose.
- **API**: REST API.
- **Caching**: Multi-layer caching with NodeCache and Redis.

### Frontend
- **Framework**: React with TypeScript.
- **Routing**: Wouter.
- **State Management**: TanStack Query.
- **UI**: Tailwind CSS with shadcn/ui.
- **Audio Player**: HLS.js integrated with Plyr.

### Deployment
- **Architecture**: A three-service split: `backend-api`, `frontend-web`, and `stream-proxy`.
- **Containerization**: Docker.
- **Monorepo**: All services are managed within a unified monorepo.

### Key Architectural Decisions
- **Type Safety**: Achieved using TypeScript and Zod for end-to-end type validation.
- **SEO Optimization**: Implemented through slug-based URLs, dynamic sitemaps, structured data, multilingual hreflang, and robust indexing strategies.
- **Performance**: Enhanced via multi-layer caching, database indexing, lazy loading, and server-side image optimization.
- **Geolocation**: Utilizes Cloudflare headers and GPS for personalized content delivery.
- **Audio Continuity**: Ensures seamless playback across page navigations.
- **User Engagement**: Driven by data-driven trends and AI-powered content recommendations.
- **System Stability**: Maintained through multi-layer Out-Of-Memory prevention, a self-watchdog, MongoDB circuit breaker, and fail-fast exits.
- **SSR Protection**: Limits concurrent Server-Side Rendering, implements timeouts, and includes bot rate limiting.
- **Subscription System**: Features a flexible matrix to support various subscription plans.

## External Dependencies
- **MongoDB Atlas**: Cloud-hosted NoSQL database.
- **Radio-Browser API**: External service for radio station information.
- **ip-api.com**: Used for geolocation services.
- **Cloudflare**: Utilized for CDN, caching, and Real User Monitoring (RUM).
- **AWS S3**: Provides scalable cloud storage for media assets.