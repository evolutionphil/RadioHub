import { useState, useCallback, useMemo, useRef, useEffect, createContext, useContext } from "react";
import { useParams, useLocation } from "wouter";

type Theme = "dark" | "light";

interface ThemeColors {
  pageBg: string;
  sidebarBg: string;
  sidebarBorder: string;
  cardBg: string;
  cardBgOpen: string;
  cardBorder: string;
  codeBg: string;
  codeBlockBg: string;
  inputBg: string;
  inputBorder: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  textDim: string;
  heading: string;
  link: string;
  tagBg: string;
  tagText: string;
  tableBorder: string;
  activeNavBg: string;
  activeNavBorder: string;
  hoverBg: string;
  tryItBg: string;
  tryItBorder: string;
  badgeBg: string;
  responseText: string;
  optionBg: string;
  baseUrlBg: string;
  baseUrlBadgeBg: string;
  footerBorder: string;
  codeTabBg: string;
  codeTabActiveBg: string;
  codeTabBorder: string;
  authBg: string;
  authText: string;
  quickInfoBorder: string;
}

const THEMES: Record<Theme, ThemeColors> = {
  dark: {
    pageBg: "#0a0a14",
    sidebarBg: "#0e0e1a",
    sidebarBorder: "#1a1a2a",
    cardBg: "#12121e",
    cardBgOpen: "#1a1a2e",
    cardBorder: "#2a2a4a",
    codeBg: "#0a0a2a",
    codeBlockBg: "#0a0a1a",
    inputBg: "#111",
    inputBorder: "#2a2a4a",
    text: "#e2e8f0",
    textSecondary: "#b0b0c0",
    textMuted: "#888",
    textDim: "#666",
    heading: "#fff",
    link: "#60a5fa",
    tagBg: "#2a1a4a",
    tagText: "#a78bfa",
    tableBorder: "#1a1a2a",
    activeNavBg: "#1a1a3a",
    activeNavBorder: "#3b82f6",
    hoverBg: "transparent",
    tryItBg: "#1a1a2e",
    tryItBorder: "#2a2a4a",
    badgeBg: "#222",
    responseText: "#a5d6a7",
    optionBg: "#1a1a2e",
    baseUrlBg: "#0a0a2a",
    baseUrlBadgeBg: "#0a2a0a",
    footerBorder: "#1a1a2a",
    codeTabBg: "#111",
    codeTabActiveBg: "#1e1e3a",
    codeTabBorder: "#333",
    authBg: "#332800",
    authText: "#f59e0b",
    quickInfoBorder: "#1a1a2a",
  },
  light: {
    pageBg: "#f8f9fc",
    sidebarBg: "#ffffff",
    sidebarBorder: "#e2e8f0",
    cardBg: "#ffffff",
    cardBgOpen: "#f1f5f9",
    cardBorder: "#e2e8f0",
    codeBg: "#f1f5f9",
    codeBlockBg: "#f8fafc",
    inputBg: "#ffffff",
    inputBorder: "#d1d5db",
    text: "#1e293b",
    textSecondary: "#475569",
    textMuted: "#64748b",
    textDim: "#94a3b8",
    heading: "#0f172a",
    link: "#2563eb",
    tagBg: "#ede9fe",
    tagText: "#7c3aed",
    tableBorder: "#e2e8f0",
    activeNavBg: "#eff6ff",
    activeNavBorder: "#3b82f6",
    hoverBg: "#f8fafc",
    tryItBg: "#f0fdf4",
    tryItBorder: "#bbf7d0",
    badgeBg: "#e2e8f0",
    responseText: "#166534",
    optionBg: "#f1f5f9",
    baseUrlBg: "#eff6ff",
    baseUrlBadgeBg: "#dcfce7",
    footerBorder: "#e2e8f0",
    codeTabBg: "#f1f5f9",
    codeTabActiveBg: "#ffffff",
    codeTabBorder: "#d1d5db",
    authBg: "#fef3c7",
    authText: "#b45309",
    quickInfoBorder: "#e2e8f0",
  }
};

const ThemeContext = createContext<ThemeColors>(THEMES.dark);
const useTheme = () => useContext(ThemeContext);

interface ApiKeyState {
  key: string | null;
  plan: string | null;
  validated: boolean;
  setKey: (key: string | null, plan?: string | null) => void;
}
const ApiKeyContext = createContext<ApiKeyState>({ key: null, plan: null, validated: false, setKey: () => {} });
const useApiKey = () => useContext(ApiKeyContext);

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface ApiParam {
  name: string;
  type: string;
  required?: boolean;
  default?: string;
  description: string;
  options?: string[];
}

interface ApiEndpoint {
  method: HttpMethod;
  path: string;
  summary: string;
  description: string;
  params?: ApiParam[];
  queryParams?: ApiParam[];
  bodyParams?: ApiParam[];
  headers?: ApiParam[];
  responseExample: string;
  requiresAuth?: boolean;
  tags?: string[];
}

interface ApiCategory {
  id: string;
  name: string;
  icon: string;
  description: string;
  endpoints: ApiEndpoint[];
}

const API_CATEGORIES: ApiCategory[] = [
  {
    id: "stations",
    name: "Stations",
    icon: "📻",
    description: "Browse, search, and get details about 40,000+ radio stations worldwide.",
    endpoints: [
      {
        method: "GET",
        path: "/api/stations",
        summary: "List Stations",
        description: "Get paginated list of radio stations with powerful filtering, sorting, and search capabilities.",
        queryParams: [
          { name: "page", type: "number", default: "1", description: "Page number" },
          { name: "limit", type: "number", default: "25", description: "Results per page (max 100)" },
          { name: "country", type: "string", description: "Filter by country name (e.g., Germany, Turkey)", options: ["Germany", "Turkey", "United States", "United Kingdom", "France"] },
          { name: "state", type: "string", description: "Filter by state/city" },
          { name: "genre", type: "string", description: "Filter by genre tag (e.g., pop, rock, jazz)" },
          { name: "tags", type: "string", description: "Filter by tags (comma-separated)" },
          { name: "language", type: "string", description: "Filter by broadcast language" },
          { name: "search", type: "string", description: "Full-text search query" },
          { name: "sort", type: "string", default: "createdAt", description: "Sort field", options: ["votes", "clickCount", "name", "createdAt"] },
          { name: "order", type: "string", default: "desc", description: "Sort order", options: ["asc", "desc"] },
          { name: "excludeBroken", type: "string", default: "false", description: "Exclude non-working stations", options: ["true", "false"] },
          { name: "minVotes", type: "number", default: "0", description: "Minimum vote count" },
          { name: "tv", type: "string", description: "Slim response for TV/mobile apps (47% smaller payload)", options: ["1"] }
        ],
        responseExample: `{
  "stations": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "name": "BBC Radio 1",
      "slug": "bbc-radio-1",
      "url": "https://stream.live.vc.bbcmedia.co.uk/bbc_radio_one",
      "urlResolved": "https://stream.live.vc.bbcmedia.co.uk/bbc_radio_one",
      "favicon": "https://cdn-profiles.tunein.com/s24939/images/logog.png",
      "logoAssets": {
        "webp96": "/logos/bbc-radio-1-96.webp",
        "webp192": "/logos/bbc-radio-1-192.webp"
      },
      "country": "United Kingdom",
      "state": "London",
      "language": "english",
      "tags": ["pop", "rock", "dance", "bbc"],
      "codec": "MP3",
      "bitrate": 128,
      "votes": 15230,
      "clickCount": 45678,
      "homepage": "https://www.bbc.co.uk/radio1",
      "hls": false,
      "lastCheckOk": true,
      "lastCheckTime": "2025-12-10T10:00:00.000Z"
    }
  ],
  "totalCount": 47904,
  "count": 25,
  "pagination": {
    "page": 1,
    "limit": 25,
    "total": 47904,
    "pages": 1917
  }
}`
      },
      {
        method: "GET",
        path: "/api/station/:identifier",
        summary: "Get Station Detail",
        description: "Retrieve a single station by its slug or MongoDB ObjectId. Returns full details including multilingual descriptions.",
        params: [
          { name: "identifier", type: "string", required: true, description: "Station slug (e.g., bbc-radio-1) or MongoDB ObjectId" }
        ],
        responseExample: `{
  "_id": "507f1f77bcf86cd799439011",
  "name": "BBC Radio 1",
  "slug": "bbc-radio-1",
  "url": "https://stream.live.vc.bbcmedia.co.uk/bbc_radio_one",
  "favicon": "https://cdn-profiles.tunein.com/s24939/images/logog.png",
  "logoAssets": { "webp96": "...", "webp192": "..." },
  "country": "United Kingdom",
  "state": "London",
  "language": "english",
  "tags": ["pop", "rock", "dance"],
  "codec": "MP3",
  "bitrate": 128,
  "votes": 15230,
  "clickCount": 45678,
  "hls": false,
  "lastCheckOk": true,
  "descriptions": {
    "en": "BBC Radio 1 is the UK's number one youth radio station...",
    "tr": "BBC Radio 1, Birleşik Krallık'ın bir numaralı gençlik radyosu...",
    "de": "BBC Radio 1 ist der führende Jugendsender des Vereinigten Königreichs..."
  }
}`
      },
      {
        method: "GET",
        path: "/api/stations/popular",
        summary: "Popular Stations",
        description: "Get most popular stations by votes, optionally filtered by country. Includes duplicate detection and logo-priority sorting.",
        queryParams: [
          { name: "country", type: "string", description: "Filter by country name" },
          { name: "state", type: "string", description: "Filter by state/city" },
          { name: "limit", type: "number", default: "12", description: "Number of results" },
          { name: "excludeBroken", type: "string", default: "false", description: "Exclude broken stations" },
          { name: "tv", type: "string", description: "Slim response mode", options: ["1"] }
        ],
        responseExample: `{
  "stations": [...],
  "count": 12,
  "country": "Germany"
}`
      },
      {
        method: "GET",
        path: "/api/stations/precomputed",
        summary: "Precomputed Stations (Ultra Fast)",
        description: "Pre-sorted, cached station lists by country. Logo-first + vote-sorted. Fastest endpoint for default browsing. 24h cache TTL.",
        queryParams: [
          { name: "country", type: "string", description: "Country code (DE, US, TR)" },
          { name: "countryName", type: "string", description: "Country name or 'global'", options: ["global", "Germany", "Turkey"] },
          { name: "page", type: "number", default: "1", description: "Page number" },
          { name: "limit", type: "number", default: "33", description: "Results per page" }
        ],
        responseExample: `{
  "success": true,
  "data": [...station objects...],
  "total": 1500,
  "page": 1,
  "limit": 33,
  "pages": 46
}`
      },
      {
        method: "GET",
        path: "/api/stations/working",
        summary: "Working Stations Only",
        description: "Same as /api/stations but only returns stations with lastCheckOk=true. Guaranteed playable streams.",
        queryParams: [
          { name: "page", type: "number", default: "1", description: "Page number" },
          { name: "limit", type: "number", default: "25", description: "Results per page" },
          { name: "country", type: "string", description: "Filter by country" },
          { name: "genre", type: "string", description: "Filter by genre" },
          { name: "search", type: "string", description: "Search query" },
          { name: "sort", type: "string", default: "createdAt", description: "Sort field" }
        ],
        responseExample: `{
  "stations": [...],
  "totalCount": 42000,
  "count": 25,
  "pagination": { "page": 1, "limit": 25, "total": 42000, "pages": 1680 }
}`
      },
      {
        method: "GET",
        path: "/api/stations/nearby",
        summary: "Nearby Stations (GPS)",
        description: "Find radio stations near a GPS coordinate. Uses geospatial database index for fast results.",
        queryParams: [
          { name: "lat", type: "number", required: true, description: "Latitude (e.g., 41.0082)" },
          { name: "lng", type: "number", required: true, description: "Longitude (e.g., 28.9784)" },
          { name: "radius", type: "number", default: "100", description: "Search radius in km" },
          { name: "limit", type: "number", default: "20", description: "Max results" }
        ],
        responseExample: `{
  "stations": [...],
  "count": 15
}`
      },
      {
        method: "GET",
        path: "/api/stations/similar/:stationId",
        summary: "Similar Stations",
        description: "Get stations similar to a given station based on country, tags, and genre matching.",
        params: [
          { name: "stationId", type: "string", required: true, description: "MongoDB ObjectId of the station" }
        ],
        queryParams: [
          { name: "limit", type: "number", default: "12", description: "Number of results" }
        ],
        responseExample: `[...station objects...]`
      },
      {
        method: "GET",
        path: "/api/stations/with-geo",
        summary: "Stations with GPS Coordinates",
        description: "Get all stations that have GPS coordinates. Ideal for map view.",
        queryParams: [
          { name: "limit", type: "number", default: "1000", description: "Max results" }
        ],
        responseExample: `[
  {
    "name": "Radio Istanbul",
    "country": "Turkey",
    "geoLat": 41.0082,
    "geoLong": 28.9784,
    "votes": 500,
    "favicon": "..."
  }
]`
      },
      {
        method: "GET",
        path: "/api/stations/country-random",
        summary: "Random Stations by Country",
        description: "Get random stations from a specific country. Useful for 'More from Country' sections.",
        queryParams: [
          { name: "country", type: "string", required: true, description: "Country name" },
          { name: "limit", type: "number", default: "12", description: "Number of results" },
          { name: "excludeIds", type: "string", description: "Comma-separated station IDs to exclude" }
        ],
        responseExample: `[...station objects...]`
      },
      {
        method: "GET",
        path: "/api/stations/stats",
        summary: "Station Statistics",
        description: "Get total counts of all stations, working stations, and broken stations.",
        responseExample: `{
  "total": 47904,
  "working": 42000,
  "broken": 5904
}`
      },
      {
        method: "POST",
        path: "/api/stations",
        summary: "Create Station",
        description: "Create a new radio station entry. Requires authentication. The station will be validated and indexed for search.",
        requiresAuth: true,
        bodyParams: [
          { name: "name", type: "string", required: true, description: "Station display name" },
          { name: "url", type: "string", required: true, description: "Stream URL (HTTP/HTTPS)" },
          { name: "country", type: "string", required: true, description: "Country name (e.g., Germany)" },
          { name: "tags", type: "string[]", description: "Genre/category tags (e.g., [\"pop\", \"rock\"])" },
          { name: "language", type: "string", description: "Broadcast language (e.g., english)" },
          { name: "homepage", type: "string", description: "Station website URL" },
          { name: "favicon", type: "string", description: "Station logo/favicon URL" },
          { name: "codec", type: "string", description: "Audio codec (MP3, AAC, OGG, etc.)" },
          { name: "bitrate", type: "number", description: "Stream bitrate in kbps (e.g., 128)" }
        ],
        responseExample: `{
  "message": "Station created successfully",
  "station": {
    "_id": "507f1f77bcf86cd799439099",
    "name": "My Radio Station",
    "slug": "my-radio-station",
    "url": "https://stream.example.com/live",
    "country": "Germany",
    "tags": ["pop", "rock"],
    "language": "german",
    "codec": "MP3",
    "bitrate": 128
  }
}`
      },
      {
        method: "PUT",
        path: "/api/stations/:id",
        summary: "Update Station",
        description: "Update an existing station's details. Requires authentication. Only the station owner or admin can update.",
        requiresAuth: true,
        params: [
          { name: "id", type: "string", required: true, description: "Station MongoDB ObjectId" }
        ],
        bodyParams: [
          { name: "name", type: "string", description: "Updated station name" },
          { name: "url", type: "string", description: "Updated stream URL" },
          { name: "country", type: "string", description: "Updated country" },
          { name: "tags", type: "string[]", description: "Updated tags array" },
          { name: "language", type: "string", description: "Updated language" },
          { name: "homepage", type: "string", description: "Updated homepage URL" },
          { name: "favicon", type: "string", description: "Updated favicon URL" },
          { name: "codec", type: "string", description: "Updated codec" },
          { name: "bitrate", type: "number", description: "Updated bitrate" }
        ],
        responseExample: `{
  "message": "Station updated successfully",
  "station": { ...updated station object... }
}`
      },
      {
        method: "DELETE",
        path: "/api/stations/:stationId",
        summary: "Delete Station",
        description: "Permanently delete a station. Requires authentication and admin privileges. This action cannot be undone.",
        requiresAuth: true,
        params: [
          { name: "stationId", type: "string", required: true, description: "Station MongoDB ObjectId" }
        ],
        responseExample: `{ "message": "Station deleted successfully" }`
      },
      {
        method: "POST",
        path: "/api/stations/batch",
        summary: "Batch Get Stations",
        description: "Retrieve multiple stations by their IDs in a single request. More efficient than individual GET requests for bulk operations.",
        bodyParams: [
          { name: "ids", type: "string[]", required: true, description: "Array of station MongoDB ObjectIds (max 100)" }
        ],
        responseExample: `{
  "stations": [
    { "_id": "507f1f77bcf86cd799439011", "name": "BBC Radio 1", ... },
    { "_id": "507f1f77bcf86cd799439012", "name": "NRJ France", ... }
  ],
  "count": 2
}`
      },
      {
        method: "GET",
        path: "/api/stations/by-genre/:genre",
        summary: "Stations by Genre Tag",
        description: "Get stations filtered by a specific genre tag. Supports pagination, country filtering, and TV slim mode.",
        params: [
          { name: "genre", type: "string", required: true, description: "Genre tag (e.g., pop, rock, jazz, classical)" }
        ],
        queryParams: [
          { name: "page", type: "number", default: "1", description: "Page number" },
          { name: "limit", type: "number", default: "25", description: "Results per page" },
          { name: "country", type: "string", description: "Filter by country name" },
          { name: "tv", type: "string", description: "Slim response mode for TV/mobile apps", options: ["1"] }
        ],
        responseExample: `{
  "stations": [...station objects...],
  "totalCount": 5000,
  "pagination": { "page": 1, "limit": 25, "total": 5000, "pages": 200 }
}`
      },
      {
        method: "GET",
        path: "/api/stations/:id/user-rating",
        summary: "Get User's Rating",
        description: "Get the current authenticated user's rating for a specific station. Returns null if the user hasn't rated the station.",
        requiresAuth: true,
        params: [
          { name: "id", type: "string", required: true, description: "Station MongoDB ObjectId" }
        ],
        responseExample: `{
  "rating": 4,
  "review": "Great station with excellent music selection!",
  "ratedAt": "2025-12-10T10:00:00.000Z"
}`
      },
      {
        method: "GET",
        path: "/api/stations/:stationId/playback-cache",
        summary: "Get Playback Cache",
        description: "Retrieve cached playback URL for a station. Used to speed up stream playback by skipping URL resolution on subsequent plays.",
        params: [
          { name: "stationId", type: "string", required: true, description: "Station MongoDB ObjectId" }
        ],
        responseExample: `{
  "url": "https://actual-stream.example.com/live",
  "codec": "MP3",
  "bitrate": 128,
  "cachedAt": "2025-12-10T10:00:00.000Z",
  "expiresAt": "2025-12-10T11:00:00.000Z"
}`
      },
      {
        method: "POST",
        path: "/api/stations/:stationId/playback-cache",
        summary: "Save Playback Cache",
        description: "Cache a resolved playback URL for faster subsequent access. The cache expires after a configurable TTL (default 1 hour).",
        params: [
          { name: "stationId", type: "string", required: true, description: "Station MongoDB ObjectId" }
        ],
        bodyParams: [
          { name: "url", type: "string", required: true, description: "Resolved stream URL to cache" },
          { name: "codec", type: "string", description: "Detected audio codec" },
          { name: "bitrate", type: "number", description: "Detected bitrate in kbps" }
        ],
        responseExample: `{
  "message": "Playback URL cached successfully",
  "expiresAt": "2025-12-10T11:00:00.000Z"
}`
      }
    ]
  },
  {
    id: "streaming",
    name: "Streaming",
    icon: "🎵",
    description: "Stream resolution, proxying, HLS conversion, and real-time now-playing metadata.",
    endpoints: [
      {
        method: "GET",
        path: "/api/stream/resolve",
        summary: "Resolve Stream URL",
        description: "Resolves playlist URLs (M3U, PLS, HLS) to direct stream URLs. Essential for playback - call this before playing any station.",
        queryParams: [
          { name: "url", type: "string", required: true, description: "Stream URL to resolve" }
        ],
        responseExample: `{
  "originalUrl": "https://stream.example.com/radio",
  "playlistType": "direct",
  "candidates": ["https://actual-stream.com/stream"],
  "resolvedAt": 1770904431749
}`,
        tags: ["playlistType: direct | m3u | pls | hls"]
      },
      {
        method: "GET",
        path: "/api/stream/:encodedUrl",
        summary: "Stream Proxy",
        description: "Proxies HTTP streams over HTTPS. HTTPS streams are redirected directly (not proxied). Use encodeURIComponent() on the stream URL.",
        params: [
          { name: "encodedUrl", type: "string", required: true, description: "URL-encoded stream URL" }
        ],
        responseExample: `Binary audio stream (Content-Type: audio/mpeg)`
      },
      {
        method: "GET",
        path: "/api/stream-hls/:stationId",
        summary: "HLS Stream",
        description: "Converts non-HLS streams to HLS format using FFmpeg. Includes session management. Ideal for mobile players.",
        params: [
          { name: "stationId", type: "string", required: true, description: "Station MongoDB ObjectId" }
        ],
        responseExample: `HLS manifest (.m3u8) with audio segments`
      },
      {
        method: "GET",
        path: "/api/stations/:stationId/metadata",
        summary: "Now Playing Metadata",
        description: "Get current track/song metadata from ICY stream headers. Also available via WebSocket at ws://themegaradio.com/ws/metadata",
        params: [
          { name: "stationId", type: "string", required: true, description: "Station MongoDB ObjectId" }
        ],
        responseExample: `{
  "title": "Dua Lipa - Levitating",
  "station": "BBC Radio 1",
  "timestamp": 1770904431749
}`
      },
      {
        method: "GET",
        path: "/api/stream-stats",
        summary: "Stream Statistics",
        description: "Get real-time statistics about active streams, total listeners, and proxy usage across the platform.",
        responseExample: `{
  "activeStreams": 142,
  "totalListeners": 3850,
  "proxyBandwidth": "2.3 GB/h",
  "hlsSessions": 28,
  "uptime": "72h 15m"
}`
      },
      {
        method: "GET",
        path: "/api/stream-check",
        summary: "Check Stream Health",
        description: "Check if a stream URL is alive and responding. Returns HTTP status, content type, and response time. Useful for monitoring station health.",
        queryParams: [
          { name: "url", type: "string", required: true, description: "Stream URL to check" }
        ],
        responseExample: `{
  "alive": true,
  "statusCode": 200,
  "contentType": "audio/mpeg",
  "responseTime": 245,
  "headers": {
    "icy-name": "BBC Radio 1",
    "icy-br": "128"
  }
}`
      },
      {
        method: "GET",
        path: "/api/stream-resolve",
        summary: "Alternate Stream Resolver",
        description: "Alternative stream URL resolver endpoint. Resolves playlist files (M3U, PLS) and redirects to find the final direct stream URL.",
        queryParams: [
          { name: "url", type: "string", required: true, description: "Stream URL to resolve" }
        ],
        responseExample: `{
  "resolved": "https://actual-stream.example.com/live",
  "originalUrl": "https://example.com/stream.m3u",
  "type": "m3u",
  "candidates": [
    { "url": "https://actual-stream.example.com/live", "contentType": "audio/mpeg" }
  ]
}`
      },
      {
        method: "GET",
        path: "/api/stream-proxy",
        summary: "Stream Proxy with CORS",
        description: "Proxy a stream URL through the server with proper CORS headers. Enables playback of HTTP-only streams from HTTPS pages and handles cross-origin restrictions.",
        queryParams: [
          { name: "url", type: "string", required: true, description: "Stream URL to proxy" }
        ],
        responseExample: `Binary audio stream with CORS headers (Access-Control-Allow-Origin: *)`
      },
      {
        method: "GET",
        path: "/api/stream-analysis",
        summary: "Analyze Stream Format",
        description: "Analyze a stream URL to detect its format, codec, bitrate, and other technical details. Useful for debugging playback issues.",
        queryParams: [
          { name: "url", type: "string", required: true, description: "Stream URL to analyze" }
        ],
        responseExample: `{
  "url": "https://stream.example.com/live",
  "codec": "MP3",
  "bitrate": 128,
  "sampleRate": 44100,
  "channels": 2,
  "contentType": "audio/mpeg",
  "isHLS": false,
  "supportsICY": true,
  "serverType": "Icecast"
}`
      },
      {
        method: "GET",
        path: "/api/stream-https-analysis",
        summary: "HTTPS Stream Analysis",
        description: "Analyze HTTPS compatibility of a stream. Checks SSL certificate validity, mixed content issues, and CORS support for browser playback.",
        queryParams: [
          { name: "url", type: "string", required: true, description: "Stream URL to analyze for HTTPS" }
        ],
        responseExample: `{
  "url": "https://stream.example.com/live",
  "isHTTPS": true,
  "sslValid": true,
  "corsEnabled": true,
  "mixedContent": false,
  "browserPlayable": true,
  "recommendation": "Direct playback supported"
}`
      },
      {
        method: "GET",
        path: "/api/hls-diagnostics",
        summary: "HLS Stream Diagnostics",
        description: "Run diagnostics on HLS (HTTP Live Streaming) streams. Checks manifest validity, segment availability, and latency. Useful for debugging HLS playback issues.",
        queryParams: [
          { name: "url", type: "string", required: true, description: "HLS manifest URL (.m3u8)" }
        ],
        responseExample: `{
  "valid": true,
  "manifestType": "master",
  "variants": [
    { "bandwidth": 128000, "codecs": "mp4a.40.2", "url": "https://..." }
  ],
  "segmentCount": 6,
  "targetDuration": 10,
  "latency": 32,
  "totalDuration": 60
}`
      }
    ]
  },
  {
    id: "genres",
    name: "Genres",
    icon: "🎭",
    description: "Browse and filter 2,300+ music genres with station counts and metadata.",
    endpoints: [
      {
        method: "GET",
        path: "/api/genres",
        summary: "List All Genres",
        description: "Get paginated list of all genres (real + dynamic) with station counts.",
        queryParams: [
          { name: "page", type: "number", default: "1", description: "Page number" },
          { name: "limit", type: "number", default: "50", description: "Results per page" }
        ],
        responseExample: `{
  "data": [
    {
      "_id": "...",
      "name": "Pop",
      "slug": "pop",
      "description": "Pop music stations worldwide",
      "posterImage": "https://...",
      "stationCount": 5000,
      "isDynamic": false
    }
  ],
  "total": 2394,
  "page": 1,
  "limit": 50,
  "totalPages": 48
}`
      },
      {
        method: "GET",
        path: "/api/genres/precomputed",
        summary: "Precomputed Genres (Fast)",
        description: "Pre-cached genre list filtered by country. Much faster than /api/genres.",
        queryParams: [
          { name: "country", type: "string", description: "Country name for country-specific genres" },
          { name: "tv", type: "string", description: "Slim response mode", options: ["1"] }
        ],
        responseExample: `{
  "success": true,
  "data": [...genre objects...]
}`
      },
      {
        method: "GET",
        path: "/api/genres/discoverable",
        summary: "Discoverable Genres",
        description: "Featured genres for the discovery page. Curated list with poster images.",
        responseExample: `[...genre objects with posterImage...]`
      },
      {
        method: "GET",
        path: "/api/genres/slug/:slug",
        summary: "Genre by Slug",
        description: "Get a single genre by its URL slug.",
        params: [
          { name: "slug", type: "string", required: true, description: "Genre slug (e.g., pop, rock, jazz)" }
        ],
        responseExample: `{
  "_id": "...",
  "name": "Pop",
  "slug": "pop",
  "description": "Pop music stations",
  "stationCount": 5000
}`
      },
      {
        method: "GET",
        path: "/api/genres/:slug/stations",
        summary: "Stations by Genre",
        description: "Get stations that belong to a specific genre.",
        params: [
          { name: "slug", type: "string", required: true, description: "Genre slug" }
        ],
        queryParams: [
          { name: "page", type: "number", default: "1", description: "Page number" },
          { name: "limit", type: "number", default: "25", description: "Results per page" },
          { name: "country", type: "string", description: "Filter by country" }
        ],
        responseExample: `{
  "stations": [...],
  "pagination": { "page": 1, "limit": 25, "total": 5000, "pages": 200 }
}`
      },
      {
        method: "POST",
        path: "/api/genres",
        summary: "Create Genre",
        description: "Create a new genre/category. Requires admin authentication. The genre will be available for station tagging and discovery.",
        requiresAuth: true,
        tags: ["admin"],
        bodyParams: [
          { name: "name", type: "string", required: true, description: "Genre display name (e.g., Lo-Fi)" },
          { name: "slug", type: "string", required: true, description: "URL-friendly slug (e.g., lo-fi)" },
          { name: "description", type: "string", description: "Genre description for SEO and discovery" },
          { name: "posterImage", type: "string", description: "Cover image URL for the genre" },
          { name: "isDiscoverable", type: "boolean", default: "false", description: "Show in discovery/explore page" }
        ],
        responseExample: `{
  "message": "Genre created successfully",
  "genre": {
    "_id": "...",
    "name": "Lo-Fi",
    "slug": "lo-fi",
    "description": "Lo-fi beats and chill music",
    "stationCount": 0,
    "isDiscoverable": false
  }
}`
      },
      {
        method: "PUT",
        path: "/api/genres/:id",
        summary: "Update Genre",
        description: "Update an existing genre's details. Requires admin authentication.",
        requiresAuth: true,
        tags: ["admin"],
        params: [
          { name: "id", type: "string", required: true, description: "Genre MongoDB ObjectId" }
        ],
        bodyParams: [
          { name: "name", type: "string", description: "Updated genre name" },
          { name: "description", type: "string", description: "Updated description" },
          { name: "posterImage", type: "string", description: "Updated poster image URL" },
          { name: "isDiscoverable", type: "boolean", description: "Updated discoverability flag" }
        ],
        responseExample: `{
  "message": "Genre updated successfully",
  "genre": { ...updated genre object... }
}`
      },
      {
        method: "DELETE",
        path: "/api/genres/:id",
        summary: "Delete Genre",
        description: "Delete a genre. Requires admin authentication. Stations tagged with this genre will retain the tag but it won't appear in genre listings.",
        requiresAuth: true,
        tags: ["admin"],
        params: [
          { name: "id", type: "string", required: true, description: "Genre MongoDB ObjectId" }
        ],
        responseExample: `{ "message": "Genre deleted successfully" }`
      }
    ]
  },
  {
    id: "countries",
    name: "Countries & Filters",
    icon: "🌍",
    description: "Country lists, language filters, and IP-based location detection for personalization.",
    endpoints: [
      {
        method: "GET",
        path: "/api/countries",
        summary: "All Countries",
        description: "Get list of all 219 countries in the database.",
        responseExample: `["Afghanistan", "Albania", "Algeria", ..., "Zimbabwe"]`
      },
      {
        method: "GET",
        path: "/api/countries",
        summary: "Rich Country Data",
        description: "Get enriched country objects with native names, ISO codes, flag emojis, flag image URLs, and station counts. Perfect for mobile apps and international UIs. Use query parameter format=rich.",
        queryParams: [
          { name: "format", type: "string", required: true, description: "Must be 'rich' to get enriched data", options: ["rich"] }
        ],
        responseExample: `{
  "countries": [
    {
      "name": "Turkey",
      "nativeName": "Türkiye",
      "code": "TR",
      "flag": "🇹🇷",
      "flagUrl": "https://flagcdn.com/w320/tr.png",
      "stationCount": 1250
    },
    {
      "name": "Germany",
      "nativeName": "Deutschland",
      "code": "DE",
      "flag": "🇩🇪",
      "flagUrl": "https://flagcdn.com/w320/de.png",
      "stationCount": 3500
    }
  ],
  "total": 215
}`,
        tags: ["mobile", "international"]
      },
      {
        method: "GET",
        path: "/api/filters/countries",
        summary: "Filter Countries",
        description: "Countries that have at least one radio station. Use for filter dropdowns.",
        responseExample: `["Germany", "Turkey", "United States", ...]`
      },
      {
        method: "GET",
        path: "/api/filters/languages",
        summary: "Filter Languages",
        description: "All broadcast languages available for filtering.",
        responseExample: `["english", "german", "turkish", "spanish", ...]`
      },
      {
        method: "GET",
        path: "/api/filters/genres",
        summary: "Filter Genres",
        description: "All genre tags available for filtering.",
        responseExample: `["pop", "rock", "jazz", "classical", ...]`
      },
      {
        method: "GET",
        path: "/api/location",
        summary: "Detect Location",
        description: "IP-based geolocation. Uses Cloudflare CF-IPCountry headers for 0ms detection. For mobile apps, prefer device GPS.",
        responseExample: `{
  "location": {
    "country": "Turkey",
    "countryCode": "TR",
    "city": "Istanbul",
    "lat": 41.0082,
    "lon": 28.9784
  }
}`
      },
      {
        method: "GET",
        path: "/api/languages",
        summary: "All Languages",
        description: "Complete list of broadcast languages with station counts.",
        responseExample: `[
  { "name": "english", "stationCount": 15000 },
  { "name": "german", "stationCount": 3000 }
]`
      }
    ]
  },
  {
    id: "auth",
    name: "Authentication",
    icon: "🔐",
    description: "User registration, login (email + Google OAuth), session management, and password recovery.",
    endpoints: [
      {
        method: "POST",
        path: "/api/auth/signup",
        summary: "Register",
        description: "Create a new user account with email and password.",
        bodyParams: [
          { name: "email", type: "string", required: true, description: "User email address" },
          { name: "password", type: "string", required: true, description: "Password (minimum 6 characters)" },
          { name: "name", type: "string", required: true, description: "Display name" }
        ],
        responseExample: `{
  "message": "Registration successful",
  "user": {
    "_id": "...",
    "email": "user@example.com",
    "name": "John Doe",
    "profilePhoto": null,
    "isPublicProfile": false,
    "favoriteStations": [],
    "totalListeningTime": 0
  }
}`
      },
      {
        method: "POST",
        path: "/api/auth/login",
        summary: "Login",
        description: "Authenticate with email and password. Returns a session cookie (connect.sid) that must be sent with subsequent requests.",
        bodyParams: [
          { name: "email", type: "string", required: true, description: "User email" },
          { name: "password", type: "string", required: true, description: "User password" }
        ],
        responseExample: `{
  "message": "Login successful",
  "user": { ...user object... }
}

// Response includes Set-Cookie header with session ID`
      },
      {
        method: "GET",
        path: "/api/auth/me",
        summary: "Session Check",
        description: "Check if current session is authenticated. Call on app startup to restore session.",
        responseExample: `{
  "user": { ...user object or null... },
  "authenticated": true
}`
      },
      {
        method: "POST",
        path: "/api/auth/logout",
        summary: "Logout",
        description: "End the current session.",
        requiresAuth: true,
        responseExample: `{ "message": "Logout successful" }`
      },
      {
        method: "GET",
        path: "/api/auth/google",
        summary: "Google OAuth",
        description: "Redirect to Google OAuth consent screen. For mobile apps, open in WebView or system browser. Profile photo is automatically captured.",
        responseExample: `302 Redirect to accounts.google.com`
      },
      {
        method: "POST",
        path: "/api/auth/forgot-password",
        summary: "Forgot Password",
        description: "Send password reset email to the user.",
        bodyParams: [
          { name: "email", type: "string", required: true, description: "Registered email address" }
        ],
        responseExample: `{ "message": "Password reset email sent" }`
      },
      {
        method: "POST",
        path: "/api/auth/reset-password",
        summary: "Reset Password",
        description: "Reset password using the token from the email link.",
        bodyParams: [
          { name: "token", type: "string", required: true, description: "Reset token from email" },
          { name: "password", type: "string", required: true, description: "New password" }
        ],
        responseExample: `{ "message": "Password reset successful" }`
      },
      {
        method: "PUT",
        path: "/api/auth/profile",
        summary: "Update Profile",
        description: "Update user profile information.",
        requiresAuth: true,
        bodyParams: [
          { name: "name", type: "string", description: "New display name" },
          { name: "isPublicProfile", type: "boolean", description: "Make profile public" }
        ],
        responseExample: `{ "user": { ...updated user object... } }`
      },
      {
        method: "GET",
        path: "/api/auth/facebook",
        summary: "Facebook OAuth",
        description: "Redirect to Facebook OAuth consent screen. Opens Facebook login flow. After authentication, user is redirected back to the callback URL.",
        responseExample: `302 Redirect to facebook.com/v18.0/dialog/oauth`
      },
      {
        method: "GET",
        path: "/api/auth/apple",
        summary: "Apple OAuth",
        description: "Redirect to Apple Sign In consent screen. Opens Apple ID authentication flow for privacy-focused users.",
        responseExample: `302 Redirect to appleid.apple.com/auth/authorize`
      },
      {
        method: "GET",
        path: "/api/auth/google/callback",
        summary: "Google OAuth Callback",
        description: "Callback URL for Google OAuth. Handles the authorization code exchange and creates/links the user account. Not called directly by clients.",
        tags: ["internal"],
        responseExample: `302 Redirect to / (with session cookie set)`
      },
      {
        method: "GET",
        path: "/api/auth/facebook/callback",
        summary: "Facebook OAuth Callback",
        description: "Callback URL for Facebook OAuth. Handles the authorization code exchange and creates/links the user account. Not called directly by clients.",
        tags: ["internal"],
        responseExample: `302 Redirect to / (with session cookie set)`
      },
      {
        method: "POST",
        path: "/api/auth/apple/callback",
        summary: "Apple OAuth Callback",
        description: "Callback URL for Apple Sign In. Apple sends user data via POST. Handles the authorization code exchange and creates/links the user account.",
        tags: ["internal"],
        responseExample: `302 Redirect to / (with session cookie set)`
      },
      {
        method: "GET",
        path: "/api/auth/social-status",
        summary: "Social Auth Status",
        description: "Check which social authentication providers are configured and available. Returns the status of Google, Facebook, and Apple OAuth integrations.",
        responseExample: `{
  "google": { "enabled": true, "configured": true },
  "facebook": { "enabled": true, "configured": true },
  "apple": { "enabled": false, "configured": false }
}`
      },
      {
        method: "POST",
        path: "/api/auth/avatar",
        summary: "Upload Avatar",
        description: "Upload a new profile avatar image. Accepts multipart/form-data with an image file. Supported formats: JPEG, PNG, WebP. Max size: 5MB.",
        requiresAuth: true,
        headers: [
          { name: "Content-Type", type: "string", required: true, description: "Must be multipart/form-data" }
        ],
        bodyParams: [
          { name: "avatar", type: "File", required: true, description: "Image file (JPEG, PNG, WebP, max 5MB)" }
        ],
        responseExample: `{
  "message": "Avatar uploaded successfully",
  "avatarUrl": "https://themegaradio.com/avatars/user_507f1f77.webp"
}`
      }
    ]
  },
  {
    id: "user",
    name: "User & Social",
    icon: "👤",
    description: "Favorites, recently played, notifications, user profiles, and social features (follow/unfollow).",
    endpoints: [
      {
        method: "GET",
        path: "/api/user/favorites",
        summary: "Get Favorites",
        description: "Get authenticated user's favorite stations list. Supports pagination and field filtering for mobile performance optimization. Without pagination params, returns all favorites as array (backward compatible). With page+limit params, returns paginated response with total count.",
        requiresAuth: true,
        queryParams: [
          { name: "page", type: "number", description: "Page number (starts from 1). When provided with limit, enables paginated response." },
          { name: "limit", type: "number", description: "Items per page (max 100). Required with page for pagination." },
          { name: "fields", type: "string", description: "Comma-separated station fields to return. Example: name,favicon,country,slug. Reduces response size dramatically for mobile apps." },
          { name: "sort", type: "string", default: "newest", description: "Sort order for favorites", options: ["newest", "oldest", "name", "country"] }
        ],
        responseExample: `// WITH pagination (recommended for mobile):
// GET /api/user/favorites?page=1&limit=20&fields=name,favicon,country,slug
{
  "stations": [
    {
      "_id": "68a8c485bd66579311ab34bd",
      "name": "Power POP",
      "favicon": "https://example.com/icon.png",
      "country": "Türkiye",
      "slug": "power-pop-1",
      "favoritedAt": "2025-07-20T10:30:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 42,
    "totalPages": 3
  }
}

// WITHOUT pagination (backward compatible, returns full array):
// GET /api/user/favorites
[
  { "_id": "...", "name": "...", "url": "...", ... all fields ... }
]

// Available fields for filtering:
// name, url, country, genre, tags, votes, clickCount, codec,
// bitrate, favicon, homepage, iso_3166_1, language, slug,
// urlResolved, geo_lat, geo_long, favoritedAt`
      },
      {
        method: "POST",
        path: "/api/user/favorites",
        summary: "Add Favorite",
        description: "Add a station to favorites.",
        requiresAuth: true,
        bodyParams: [
          { name: "stationId", type: "string", required: true, description: "Station MongoDB ObjectId" }
        ],
        responseExample: `{ "message": "Station added to favorites" }`
      },
      {
        method: "DELETE",
        path: "/api/user/favorites/:stationId",
        summary: "Remove Favorite",
        description: "Remove a station from favorites.",
        requiresAuth: true,
        params: [
          { name: "stationId", type: "string", required: true, description: "Station ObjectId" }
        ],
        responseExample: `{ "message": "Station removed from favorites" }`
      },
      {
        method: "GET",
        path: "/api/user/favorites/check/:stationId",
        summary: "Check Favorite",
        description: "Check if a station is in the user's favorites.",
        requiresAuth: true,
        params: [
          { name: "stationId", type: "string", required: true, description: "Station ObjectId" }
        ],
        responseExample: `{ "isFavorite": true }`
      },
      {
        method: "GET",
        path: "/api/recently-played",
        summary: "Recently Played",
        description: "Get the authenticated user's recently played stations, ordered by most recent first. Maximum 12 stations are stored per user. Each station includes full details plus a playedAt timestamp. Supports both session cookies (web) and Bearer tokens (mobile/TV).",
        requiresAuth: true,
        headers: [
          { name: "Authorization", type: "string", description: "Bearer mrt_your_token (for mobile/TV apps)" },
          { name: "Cookie", type: "string", description: "connect.sid=... (for web, sent automatically by browser)" }
        ],
        responseExample: `[
  {
    "_id": "68a8c47dbd66579311ab228c",
    "name": "BBC Radio 1",
    "slug": "bbc-radio-1",
    "url": "https://stream.live.vc.bbcmedia.co.uk/bbc_radio_one",
    "favicon": "https://cdn-profiles.tunein.com/s24939/images/logog.png",
    "country": "United Kingdom",
    "language": "English",
    "tags": "pop,rock,dance",
    "votes": 1250,
    "clickCount": 85000,
    "codec": "MP3",
    "bitrate": 128,
    "playedAt": "2026-02-14T18:33:56.747Z"
  },
  ...
]

// If not authenticated:
{ "error": "Authentication required" } // 401`
      },
      {
        method: "POST",
        path: "/api/recently-played",
        summary: "Save Recently Played",
        description: "Record a station as recently played for the authenticated user. If the station already exists in the list, it is moved to the top. Maximum 12 stations are stored (oldest are removed). Supports both session cookies (web) and Bearer tokens (mobile/TV).",
        requiresAuth: true,
        headers: [
          { name: "Authorization", type: "string", description: "Bearer mrt_your_token (for mobile/TV apps)" },
          { name: "Cookie", type: "string", description: "connect.sid=... (for web, sent automatically by browser)" }
        ],
        bodyParams: [
          { name: "stationId", type: "string", required: true, description: "Station MongoDB ObjectId" }
        ],
        responseExample: `{ "success": true }

// Errors:
{ "error": "Authentication required" }  // 401 - No session/token
{ "error": "Station ID is required" }   // 400 - Missing stationId
{ "error": "Station not found" }         // 404 - Invalid stationId`
      },
      {
        method: "GET",
        path: "/api/user/notifications",
        summary: "Get Notifications",
        description: "Get user's notifications.",
        requiresAuth: true,
        responseExample: `[...notification objects...]`
      },
      {
        method: "GET",
        path: "/api/user-profile/:idOrSlug",
        summary: "View Profile",
        description: "Get public profile of any user by ID or slug.",
        params: [
          { name: "idOrSlug", type: "string", required: true, description: "User ID or profile slug" }
        ],
        responseExample: `{
  "_id": "...",
  "name": "John Doe",
  "profilePhoto": "https://...",
  "isPublicProfile": true,
  "totalListeningTime": 36000,
  "followers": 15,
  "following": 8
}`
      },
      {
        method: "POST",
        path: "/api/user/follow/:userId",
        summary: "Follow User",
        description: "Follow another user.",
        requiresAuth: true,
        params: [
          { name: "userId", type: "string", required: true, description: "User ID to follow" }
        ],
        responseExample: `{ "message": "Followed successfully" }`
      },
      {
        method: "DELETE",
        path: "/api/user/unfollow/:userId",
        summary: "Unfollow User",
        description: "Unfollow a user.",
        requiresAuth: true,
        params: [
          { name: "userId", type: "string", required: true, description: "User ID to unfollow" }
        ],
        responseExample: `{ "message": "Unfollowed successfully" }`
      },
      {
        method: "GET",
        path: "/api/user/followers/:userId",
        summary: "Get Followers",
        description: "Get list of a user's followers.",
        params: [
          { name: "userId", type: "string", required: true, description: "User ID" }
        ],
        responseExample: `[...user objects...]`
      },
      {
        method: "GET",
        path: "/api/community-favorites",
        summary: "Community Favorites",
        description: "Most favorited stations across all users. Public endpoint.",
        queryParams: [
          { name: "limit", type: "number", default: "20", description: "Number of results" }
        ],
        responseExample: `[...most favorited station objects...]`
      },
      {
        method: "GET",
        path: "/api/public-profiles",
        summary: "Public Profiles",
        description: "Browse public user profiles.",
        queryParams: [
          { name: "page", type: "number", default: "1", description: "Page number" },
          { name: "limit", type: "number", default: "20", description: "Results per page" }
        ],
        responseExample: `{ "users": [...], "total": 100 }`
      },
      {
        method: "POST",
        path: "/api/listening/record",
        summary: "Record Listening Time",
        description: "Record a listening session. Only sessions longer than 5 seconds are saved. Used for profile statistics.",
        requiresAuth: true,
        bodyParams: [
          { name: "stationId", type: "string", required: true, description: "Station ObjectId" },
          { name: "duration", type: "number", required: true, description: "Duration in seconds" },
          { name: "startedAt", type: "string", required: true, description: "ISO 8601 timestamp" }
        ],
        responseExample: `{ "message": "Listening session recorded" }`
      },
      {
        method: "GET",
        path: "/api/user/following/:userId",
        summary: "Get Following List",
        description: "Get the list of users that a specific user is following.",
        params: [
          { name: "userId", type: "string", required: true, description: "User ID to get following list for" }
        ],
        responseExample: `{
  "following": [
    { "_id": "...", "name": "Jane Doe", "profilePhoto": "...", "slug": "jane-doe" }
  ],
  "count": 8
}`
      },
      {
        method: "GET",
        path: "/api/user/is-following/:userId",
        summary: "Check Following Status",
        description: "Check if the current authenticated user is following another user. Returns a boolean indicating follow status.",
        requiresAuth: true,
        params: [
          { name: "userId", type: "string", required: true, description: "Target user ID to check" }
        ],
        responseExample: `{ "isFollowing": true }`
      },
      {
        method: "PATCH",
        path: "/api/user/notifications/:id/read",
        summary: "Mark Notification Read",
        description: "Mark a specific notification as read for the authenticated user.",
        requiresAuth: true,
        params: [
          { name: "id", type: "string", required: true, description: "Notification ID" }
        ],
        responseExample: `{ "message": "Notification marked as read" }`
      },
      {
        method: "PATCH",
        path: "/api/user/notifications/read-all",
        summary: "Mark All Notifications Read",
        description: "Mark all unread notifications as read for the authenticated user. Useful for a 'mark all as read' button.",
        requiresAuth: true,
        responseExample: `{ "message": "All notifications marked as read", "count": 12 }`
      },
      {
        method: "PATCH",
        path: "/api/user/notification-settings",
        summary: "Update Notification Settings",
        description: "Update the authenticated user's notification preferences. Control which types of notifications to receive (new followers, favorites, etc.).",
        requiresAuth: true,
        bodyParams: [
          { name: "emailNotifications", type: "boolean", description: "Enable/disable email notifications" },
          { name: "pushNotifications", type: "boolean", description: "Enable/disable push notifications" },
          { name: "newFollower", type: "boolean", description: "Notify on new follower" },
          { name: "stationUpdates", type: "boolean", description: "Notify on favorite station updates" },
          { name: "weeklyDigest", type: "boolean", description: "Receive weekly listening digest" }
        ],
        responseExample: `{
  "message": "Notification settings updated",
  "settings": {
    "emailNotifications": true,
    "pushNotifications": true,
    "newFollower": true,
    "stationUpdates": false,
    "weeklyDigest": true
  }
}`
      },
      {
        method: "POST",
        path: "/api/user/push-subscription",
        summary: "Subscribe to Push",
        description: "Register a browser push notification subscription for the authenticated user. Uses the Web Push API with VAPID keys.",
        requiresAuth: true,
        bodyParams: [
          { name: "endpoint", type: "string", required: true, description: "Push service endpoint URL" },
          { name: "keys", type: "object", required: true, description: "Push subscription keys object with p256dh and auth fields" }
        ],
        responseExample: `{ "message": "Push subscription registered successfully" }`
      },
      {
        method: "DELETE",
        path: "/api/user/push-subscription",
        summary: "Unsubscribe from Push",
        description: "Remove the browser push notification subscription for the authenticated user. Stops all push notifications to this device.",
        requiresAuth: true,
        responseExample: `{ "message": "Push subscription removed successfully" }`
      },
      {
        method: "GET",
        path: "/api/users/:idOrSlug/favorites",
        summary: "Get User's Favorites",
        description: "Get another user's favorite stations. Only visible if the user has a public profile.",
        params: [
          { name: "idOrSlug", type: "string", required: true, description: "User ID or profile slug" }
        ],
        queryParams: [
          { name: "page", type: "number", default: "1", description: "Page number" },
          { name: "limit", type: "number", default: "20", description: "Results per page" }
        ],
        responseExample: `{
  "favorites": [...station objects...],
  "count": 25,
  "user": { "name": "John Doe", "slug": "john-doe" }
}`
      },
      {
        method: "GET",
        path: "/api/users/:id/recent",
        summary: "Get User's Recent Plays",
        description: "Get another user's recently played stations. Only visible if the user has a public profile.",
        params: [
          { name: "id", type: "string", required: true, description: "User ID" }
        ],
        responseExample: `{
  "recentlyPlayed": [...station objects with playedAt timestamps...],
  "count": 10
}`
      },
      {
        method: "GET",
        path: "/api/users/search",
        summary: "Search Users",
        description: "Search for users by name or slug. Returns public profiles matching the query.",
        queryParams: [
          { name: "q", type: "string", required: true, description: "Search query" },
          { name: "limit", type: "number", default: "20", description: "Max results" }
        ],
        responseExample: `{
  "users": [
    { "_id": "...", "name": "John Doe", "slug": "john-doe", "profilePhoto": "...", "followers": 15 }
  ],
  "count": 5
}`
      },
      {
        method: "GET",
        path: "/api/users/stats",
        summary: "User Statistics",
        description: "Get aggregate user statistics. Requires admin authentication. Returns total users, active users, and engagement metrics.",
        requiresAuth: true,
        tags: ["admin"],
        responseExample: `{
  "totalUsers": 15000,
  "activeUsers": 3500,
  "newUsersThisWeek": 120,
  "totalListeningHours": 45000,
  "averageSessionDuration": 1800
}`
      },
      {
        method: "GET",
        path: "/api/users/activity",
        summary: "User Activity Feed",
        description: "Get the activity feed showing recent actions by users you follow (favorites added, stations rated, new follows).",
        responseExample: `{
  "activities": [
    {
      "type": "favorite_added",
      "user": { "name": "Jane Doe", "slug": "jane-doe" },
      "station": { "name": "BBC Radio 1", "slug": "bbc-radio-1" },
      "timestamp": "2025-12-10T10:00:00.000Z"
    }
  ],
  "count": 20
}`
      },
      {
        method: "GET",
        path: "/api/users/:userId",
        summary: "Get User Details",
        description: "Get detailed information about a specific user. Returns public profile data including listening stats, favorites count, and follower count.",
        params: [
          { name: "userId", type: "string", required: true, description: "User MongoDB ObjectId" }
        ],
        responseExample: `{
  "_id": "507f1f77bcf86cd799439011",
  "name": "John Doe",
  "slug": "john-doe",
  "profilePhoto": "https://...",
  "isPublicProfile": true,
  "totalListeningTime": 36000,
  "favoriteCount": 25,
  "followers": 15,
  "following": 8,
  "joinedAt": "2025-01-15T10:00:00.000Z"
}`
      },
      {
        method: "PUT",
        path: "/api/users/:userId",
        summary: "Update User",
        description: "Update a user's profile. Requires authentication. Users can only update their own profile unless they are admins.",
        requiresAuth: true,
        params: [
          { name: "userId", type: "string", required: true, description: "User MongoDB ObjectId" }
        ],
        bodyParams: [
          { name: "name", type: "string", description: "Updated display name" },
          { name: "bio", type: "string", description: "User bio/description" },
          { name: "isPublicProfile", type: "boolean", description: "Make profile public or private" }
        ],
        responseExample: `{
  "message": "User updated successfully",
  "user": { ...updated user object... }
}`
      },
      {
        method: "POST",
        path: "/api/users/:userId/follow",
        summary: "Follow User (Alt)",
        description: "Follow another user. Alternative endpoint using the users prefix. Creates a follow relationship and optionally sends a notification.",
        requiresAuth: true,
        params: [
          { name: "userId", type: "string", required: true, description: "User ID to follow" }
        ],
        responseExample: `{ "message": "Followed successfully", "followers": 16 }`
      },
      {
        method: "POST",
        path: "/api/users/:userId/unfollow",
        summary: "Unfollow User (Alt)",
        description: "Unfollow a user. Alternative endpoint using the users prefix. Removes the follow relationship.",
        requiresAuth: true,
        params: [
          { name: "userId", type: "string", required: true, description: "User ID to unfollow" }
        ],
        responseExample: `{ "message": "Unfollowed successfully", "followers": 15 }`
      }
    ]
  },
  {
    id: "discover",
    name: "Discovery & Recommendations",
    icon: "🔍",
    description: "AI-powered recommendations, Top 100 charts, music search, and ML-based personalization.",
    endpoints: [
      {
        method: "GET",
        path: "/api/recommendations/diverse",
        summary: "Diverse Recommendations",
        description: "Get station recommendations using multiple strategies (popular, genre-based, country-based).",
        queryParams: [
          { name: "limit", type: "number", default: "20", description: "Number of results" },
          { name: "country", type: "string", description: "User's country for localization" }
        ],
        responseExample: `{
  "stations": [...],
  "strategies": ["popular", "genre_based", "country_based"],
  "excluded_count": 5,
  "total_unique": 20
}`
      },
      {
        method: "GET",
        path: "/api/discover/top100",
        summary: "Top 100 Songs (iTunes)",
        description: "Fetch the iTunes Top 100 songs chart for a specific country. Data is sourced from Apple's RSS feed and cached for 1 hour. Returns song titles, artists, album art, and preview URLs.",
        queryParams: [
          { name: "country", type: "string", default: "US", description: "ISO country code for localized chart", options: ["US", "TR", "DE", "GB", "FR", "JP"] },
          { name: "limit", type: "number", default: "100", description: "Number of top songs to return (max 200)" }
        ],
        responseExample: `{
  "results": [
    {
      "title": "Die With A Smile",
      "artist": "Lady Gaga & Bruno Mars",
      "album": "Die With A Smile",
      "artwork": "https://is1-ssl.mzstatic.com/image/...",
      "previewUrl": "https://audio-ssl.itunes.apple.com/...",
      "genre": "Pop",
      "releaseDate": "2024-08-16",
      "trackId": 1234567890
    }
  ],
  "cached": false
}`
      },
      {
        method: "GET",
        path: "/api/discover/search",
        summary: "Discovery Search",
        description: "Search across stations for the discovery/explore page.",
        queryParams: [
          { name: "q", type: "string", required: true, description: "Search query" },
          { name: "limit", type: "number", default: "20", description: "Max results" }
        ],
        responseExample: `[...matching station objects...]`
      },
      {
        method: "POST",
        path: "/api/ml/track-interaction",
        summary: "Track ML Interaction",
        description: "Track user interaction for machine learning recommendations. Builds user preference profile.",
        bodyParams: [
          { name: "sessionId", type: "string", required: true, description: "Unique session identifier" },
          { name: "stationId", type: "string", required: true, description: "Station ObjectId" },
          { name: "action", type: "string", required: true, description: "Interaction type", options: ["play", "skip", "favorite"] }
        ],
        responseExample: `{ "success": true }`
      },
      {
        method: "GET",
        path: "/api/ml/recommendations/:sessionId",
        summary: "ML Recommendations",
        description: "Get personalized recommendations based on user's interaction history within a session.",
        params: [
          { name: "sessionId", type: "string", required: true, description: "Session identifier" }
        ],
        queryParams: [
          { name: "limit", type: "number", default: "10", description: "Number of results" }
        ],
        responseExample: `[...personalized station objects...]`
      },
      {
        method: "GET",
        path: "/api/discover/track/:id",
        summary: "Get Track Info",
        description: "Get detailed information about a specific music track including title, artist, album, duration, and artwork URLs.",
        params: [
          { name: "id", type: "string", required: true, description: "Track identifier" }
        ],
        responseExample: `{
  "id": "track_abc123",
  "title": "Levitating",
  "artist": "Dua Lipa",
  "album": "Future Nostalgia",
  "duration": 203,
  "artwork": "https://themegaradio.com/artwork/track_abc123.jpg",
  "genre": "Pop"
}`
      },
      {
        method: "GET",
        path: "/api/discover/album/:id",
        summary: "Get Album Info",
        description: "Get detailed information about a music album including tracks, artist, release date, and cover artwork.",
        params: [
          { name: "id", type: "string", required: true, description: "Album identifier" }
        ],
        responseExample: `{
  "id": "album_xyz789",
  "title": "Future Nostalgia",
  "artist": "Dua Lipa",
  "releaseDate": "2020-03-27",
  "tracks": 11,
  "artwork": "https://themegaradio.com/artwork/album_xyz789.jpg",
  "genre": "Pop"
}`
      },
      {
        method: "GET",
        path: "/api/discover/artist/:id",
        summary: "Get Artist Info",
        description: "Get detailed information about a music artist including bio, popular tracks, and related artists.",
        params: [
          { name: "id", type: "string", required: true, description: "Artist identifier" }
        ],
        responseExample: `{
  "id": "artist_def456",
  "name": "Dua Lipa",
  "bio": "Dua Lipa is an English-Albanian singer and songwriter...",
  "image": "https://themegaradio.com/artists/dua-lipa.jpg",
  "genres": ["Pop", "Dance"],
  "popularTracks": ["Levitating", "Don't Start Now"],
  "relatedArtists": ["Charli XCX", "Rina Sawayama"]
}`
      },
      {
        method: "GET",
        path: "/api/discover/artwork/:trackId",
        summary: "Get Track Artwork",
        description: "Get the artwork image for a specific track. Returns the image binary data. Useful for displaying album art in the player UI.",
        params: [
          { name: "trackId", type: "string", required: true, description: "Track identifier" }
        ],
        responseExample: `Binary image data (Content-Type: image/jpeg)`
      }
    ]
  },
  {
    id: "interaction",
    name: "Interaction & Rating",
    icon: "⭐",
    description: "Station clicks, votes, ratings, and error reporting.",
    endpoints: [
      {
        method: "POST",
        path: "/api/stations/:id/click",
        summary: "Record Click",
        description: "Record a station click/play event. Increments clickCount.",
        params: [
          { name: "id", type: "string", required: true, description: "Station ObjectId" }
        ],
        responseExample: `{ "clickCount": 45679 }`
      },
      {
        method: "POST",
        path: "/api/stations/:id/vote",
        summary: "Vote for Station",
        description: "Cast a vote for a station. Increments vote count.",
        params: [
          { name: "id", type: "string", required: true, description: "Station ObjectId" }
        ],
        responseExample: `{ "votes": 15231 }`
      },
      {
        method: "POST",
        path: "/api/stations/:id/rate",
        summary: "Rate Station",
        description: "Give a rating (1-5) to a station.",
        params: [
          { name: "id", type: "string", required: true, description: "Station ObjectId" }
        ],
        bodyParams: [
          { name: "rating", type: "number", required: true, description: "Rating value (1-5)" }
        ],
        responseExample: `{ "averageRating": 4.2, "totalRatings": 150 }`
      },
      {
        method: "GET",
        path: "/api/stations/:id/ratings",
        summary: "Get Ratings",
        description: "Get rating statistics for a station.",
        params: [
          { name: "id", type: "string", required: true, description: "Station ObjectId" }
        ],
        responseExample: `{
  "averageRating": 4.2,
  "totalRatings": 150,
  "distribution": { "1": 5, "2": 10, "3": 25, "4": 60, "5": 50 }
}`
      },
      {
        method: "POST",
        path: "/api/stations/report-error",
        summary: "Report Error",
        description: "Report a broken or problematic station.",
        bodyParams: [
          { name: "stationId", type: "string", required: true, description: "Station ObjectId" },
          { name: "errorType", type: "string", required: true, description: "Error type", options: ["no_audio", "wrong_content", "buffering", "other"] },
          { name: "description", type: "string", description: "Optional description" }
        ],
        responseExample: `{ "message": "Error reported successfully" }`
      }
    ]
  },
  {
    id: "translations",
    name: "Translations (i18n)",
    icon: "🌐",
    description: "Multilingual support with 599 translation keys across 57 languages.",
    endpoints: [
      {
        method: "GET",
        path: "/api/translations/:lang",
        summary: "Get Translations",
        description: "Get all translation strings for a language. 599 keys covering the entire UI. Cached for performance.",
        params: [
          { name: "lang", type: "string", required: true, description: "Language code (2-letter ISO)", options: ["en", "tr", "de", "fr", "es", "ar", "zh", "ja", "ko", "pt", "ru", "it", "nl", "pl", "sv", "hi"] }
        ],
        responseExample: `{
  "home": "Home",
  "search": "Search",
  "favorites": "Favorites",
  "nowPlaying": "Now Playing",
  "settings": "Settings",
  "login": "Login",
  "signup": "Sign Up",
  ...596 more keys...
}`
      },
      {
        method: "GET",
        path: "/api/translations/:lang/critical",
        summary: "Critical Translations",
        description: "Minimum translations needed for initial page render. Faster than full translations endpoint.",
        params: [
          { name: "lang", type: "string", required: true, description: "Language code" }
        ],
        responseExample: `{ ...subset of critical translation keys... }`
      }
    ]
  },
  {
    id: "misc",
    name: "Miscellaneous",
    icon: "🔧",
    description: "Image proxy, advertisements, push notifications, and SEO data.",
    endpoints: [
      {
        method: "GET",
        path: "/api/image/*",
        summary: "Image Proxy",
        description: "Proxies and optimizes external images. Auto-converts to WebP. Server-side caching.",
        responseExample: `Binary image data (Content-Type: image/webp)`
      },
      {
        method: "GET",
        path: "/api/advertisements",
        summary: "Active Advertisements",
        description: "Get currently active advertisements for display in the app.",
        responseExample: `[...advertisement objects...]`
      },
      {
        method: "GET",
        path: "/api/push/vapid-public-key",
        summary: "VAPID Public Key",
        description: "Get the VAPID public key for web push notification subscription.",
        responseExample: `{ "publicKey": "BL..." }`
      },
      {
        method: "GET",
        path: "/api/seo/page-data",
        summary: "SEO Page Data",
        description: "Get SEO metadata (title, description, FAQ) for the current page.",
        responseExample: `{
  "seoTags": {
    "title": "Mega Radio: Listen to 40,000+ Radio Stations",
    "description": "...",
    "faq": [...]
  }
}`
      },
      {
        method: "GET",
        path: "/api/footer-social-media",
        summary: "Social Media Links",
        description: "Get social media links displayed in the footer.",
        responseExample: `[
  { "_id": "...", "platform": "twitter", "url": "https://twitter.com/megaradio", "icon": "..." }
]`
      },
      {
        method: "GET",
        path: "/api/codecs",
        summary: "Audio Codecs",
        description: "List of all audio codecs used by stations (MP3, AAC, OGG, etc.).",
        responseExample: `["MP3", "AAC", "AAC+", "OGG", "FLAC", "WMA", "OPUS"]`
      },
      {
        method: "GET",
        path: "/api/og-image/:stationSlug",
        summary: "Station OG Image",
        description: "Generate a dynamic Open Graph image (1200x630) for a specific station. Used for social media sharing previews on WhatsApp, Facebook, Twitter, etc.",
        params: [
          { name: "stationSlug", type: "string", required: true, description: "Station slug (e.g., bbc-radio-1)" }
        ],
        responseExample: `Binary JPEG image (Content-Type: image/jpeg, Cache-Control: 24h)`
      },
      {
        method: "GET",
        path: "/api/og-image",
        summary: "Default OG Image",
        description: "Get the default Open Graph image for the platform. Used when sharing pages that don't have a station-specific image.",
        responseExample: `Binary JPEG image (Content-Type: image/jpeg, Cache-Control: 7d)`
      },
      {
        method: "GET",
        path: "/api/dashboard/stats",
        summary: "Dashboard Statistics",
        description: "Get platform-wide dashboard statistics including total stations, users, listening hours, and daily active users. Requires admin access.",
        requiresAuth: true,
        tags: ["admin"],
        responseExample: `{
  "totalStations": 47904,
  "workingStations": 42000,
  "totalUsers": 15000,
  "dailyActiveUsers": 3500,
  "totalListeningHours": 250000,
  "topCountries": ["Germany", "Turkey", "United States"],
  "recentSignups": 45,
  "generatedAt": "2025-12-10T10:00:00.000Z"
}`
      },
      {
        method: "GET",
        path: "/api/analytics",
        summary: "Analytics Data",
        description: "Get detailed analytics data including page views, unique visitors, and session metrics. Requires admin authentication.",
        requiresAuth: true,
        tags: ["admin"],
        responseExample: `{
  "pageViews": 125000,
  "uniqueVisitors": 35000,
  "averageSessionDuration": 420,
  "bounceRate": 0.32,
  "topPages": ["/", "/stations", "/genres"],
  "period": "last_7_days"
}`
      },
      {
        method: "GET",
        path: "/api/analytics/summary",
        summary: "Analytics Summary",
        description: "Get a condensed analytics summary with key metrics. Faster than the full analytics endpoint. Requires admin authentication.",
        requiresAuth: true,
        tags: ["admin"],
        responseExample: `{
  "today": { "visitors": 5200, "pageViews": 18500 },
  "yesterday": { "visitors": 4800, "pageViews": 16200 },
  "thisWeek": { "visitors": 35000, "pageViews": 125000 },
  "trend": "+8.3%"
}`
      },
      {
        method: "GET",
        path: "/api/sync/status",
        summary: "Sync Status",
        description: "Get the current status of the Radio Browser database synchronization process. Shows last sync time, records processed, and any errors.",
        requiresAuth: true,
        tags: ["admin"],
        responseExample: `{
  "status": "idle",
  "lastSync": "2025-12-10T06:00:00.000Z",
  "recordsProcessed": 47904,
  "newStations": 15,
  "updatedStations": 230,
  "errors": 0,
  "nextScheduledSync": "2025-12-11T06:00:00.000Z"
}`
      },
      {
        method: "GET",
        path: "/api/sync/logs",
        summary: "Sync Logs",
        description: "Get recent synchronization log entries. Shows detailed sync history with timestamps and outcomes.",
        requiresAuth: true,
        tags: ["admin"],
        responseExample: `{
  "logs": [
    { "timestamp": "2025-12-10T06:00:00.000Z", "type": "sync_complete", "message": "Synced 47904 stations", "duration": 45000 }
  ],
  "count": 10
}`
      },
      {
        method: "POST",
        path: "/api/sync/force",
        summary: "Force Sync",
        description: "Manually trigger a database synchronization with the Radio Browser API. This operation runs in the background and may take several minutes.",
        requiresAuth: true,
        tags: ["admin"],
        responseExample: `{
  "message": "Sync started",
  "jobId": "sync_1702200000",
  "estimatedDuration": "2-5 minutes"
}`
      },
      {
        method: "POST",
        path: "/api/sync/stop",
        summary: "Stop Sync",
        description: "Stop a currently running synchronization process. The partial results will be kept.",
        requiresAuth: true,
        tags: ["admin"],
        responseExample: `{ "message": "Sync stopped", "recordsProcessed": 25000 }`
      },
      {
        method: "POST",
        path: "/api/push/now-playing",
        summary: "Push Now Playing",
        description: "Send a push notification about the currently playing track to subscribed users. Used by the real-time metadata system.",
        requiresAuth: true,
        bodyParams: [
          { name: "stationId", type: "string", required: true, description: "Station ObjectId" },
          { name: "title", type: "string", required: true, description: "Track title" },
          { name: "artist", type: "string", description: "Artist name" }
        ],
        responseExample: `{ "sent": 150, "failed": 2 }`
      },
      {
        method: "POST",
        path: "/api/push/favorite-added",
        summary: "Push Favorite Added",
        description: "Send a push notification when a user adds a station to favorites. Notifies followers of the user.",
        requiresAuth: true,
        bodyParams: [
          { name: "userId", type: "string", required: true, description: "User who added the favorite" },
          { name: "stationId", type: "string", required: true, description: "Station that was favorited" }
        ],
        responseExample: `{ "sent": 8, "failed": 0 }`
      },
      {
        method: "GET",
        path: "/ads.txt",
        summary: "AdSense ads.txt",
        description: "Authorized Digital Sellers file for Google AdSense verification. Required for ad monetization compliance.",
        responseExample: `google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0`
      },
      {
        method: "GET",
        path: "/robots.txt",
        summary: "Robots.txt",
        description: "Search engine crawling directives. Specifies which paths search engine bots are allowed or disallowed from crawling.",
        responseExample: `User-agent: *
Allow: /
Disallow: /api/
Disallow: /admin/
Sitemap: https://themegaradio.com/sitemap.xml`
      },
      {
        method: "GET",
        path: "/llms.txt",
        summary: "LLMs.txt",
        description: "Machine-readable file for AI crawlers and large language models. Provides structured information about the site's content and API.",
        responseExample: `# MegaRadio - Internet Radio Platform
> 40,000+ radio stations from 220 countries
...`
      },
      {
        method: "GET",
        path: "/sitemap.xml",
        summary: "Sitemap Index",
        description: "XML sitemap index file containing links to all sub-sitemaps. Supports multilingual sitemaps with hreflang annotations for 57 languages.",
        responseExample: `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://themegaradio.com/sitemap-stations.xml</loc></sitemap>
  <sitemap><loc>https://themegaradio.com/sitemap-genres.xml</loc></sitemap>
  <sitemap><loc>https://themegaradio.com/sitemap-countries.xml</loc></sitemap>
</sitemapindex>`
      }
    ]
  },
  {
    id: "radio-browser",
    name: "Radio Browser",
    icon: "🌐",
    description: "Access data from the Radio Browser community database. These endpoints mirror the community-maintained radio station database.",
    endpoints: [
      {
        method: "GET",
        path: "/api/radio-browser/stats",
        summary: "Database Statistics",
        description: "Get statistics about the Radio Browser database including total stations, countries, languages, and tags counts.",
        responseExample: `{
  "stations": 47904,
  "brokenStations": 5904,
  "tags": 2394,
  "countries": 219,
  "languages": 450,
  "lastUpdate": "2025-12-10T06:00:00.000Z"
}`
      },
      {
        method: "GET",
        path: "/api/radio-browser/top-clicked",
        summary: "Most Clicked Stations",
        description: "Get the most clicked/played stations from the Radio Browser database. Optionally filter by country for regional popularity rankings.",
        queryParams: [
          { name: "limit", type: "number", default: "50", description: "Number of results (max 250)" },
          { name: "country", type: "string", description: "Filter by country name" }
        ],
        responseExample: `[
  {
    "name": "BBC Radio 1",
    "clickCount": 45678,
    "country": "United Kingdom",
    "tags": ["pop", "rock"],
    "url": "https://stream.live.vc.bbcmedia.co.uk/bbc_radio_one"
  }
]`
      },
      {
        method: "GET",
        path: "/api/radio-browser/top-voted",
        summary: "Most Voted Stations",
        description: "Get the most voted stations from the Radio Browser database. These represent community-endorsed quality stations.",
        queryParams: [
          { name: "limit", type: "number", default: "50", description: "Number of results (max 250)" },
          { name: "country", type: "string", description: "Filter by country name" }
        ],
        responseExample: `[
  {
    "name": "SomaFM Groove Salad",
    "votes": 25000,
    "country": "United States",
    "tags": ["ambient", "chillout"],
    "url": "https://somafm.com/groovesalad.pls"
  }
]`
      },
      {
        method: "GET",
        path: "/api/radio-browser/recent",
        summary: "Recently Added Stations",
        description: "Get recently added stations to the Radio Browser database. Useful for discovering new stations.",
        queryParams: [
          { name: "limit", type: "number", default: "50", description: "Number of results (max 250)" }
        ],
        responseExample: `[
  {
    "name": "New Station FM",
    "addedAt": "2025-12-10T08:30:00.000Z",
    "country": "Germany",
    "tags": ["electronic"],
    "url": "https://stream.newstation.fm/live"
  }
]`
      },
      {
        method: "GET",
        path: "/api/radio-browser/broken",
        summary: "Broken Stations",
        description: "Get stations that have been reported or detected as broken/offline. Useful for maintenance and cleanup operations.",
        queryParams: [
          { name: "limit", type: "number", default: "50", description: "Number of results (max 250)" }
        ],
        responseExample: `[
  {
    "name": "Offline Radio",
    "lastCheckOk": false,
    "lastCheckTime": "2025-12-09T22:00:00.000Z",
    "failReason": "Connection timeout",
    "country": "France"
  }
]`
      }
    ]
  },
  {
    id: "regions",
    name: "Regions & Cities",
    icon: "🗺️",
    description: "Browse radio stations by geographic regions, countries, and cities. Hierarchical geographic navigation for station discovery.",
    endpoints: [
      {
        method: "GET",
        path: "/api/regions",
        summary: "List All Regions",
        description: "Get a list of all geographic regions/continents with their country counts and station counts. Used for hierarchical geographic navigation.",
        responseExample: `[
  {
    "name": "Europe",
    "slug": "europe",
    "countryCount": 44,
    "stationCount": 25000,
    "countries": ["Germany", "France", "United Kingdom", ...]
  },
  {
    "name": "Asia",
    "slug": "asia",
    "countryCount": 48,
    "stationCount": 8000
  }
]`
      },
      {
        method: "GET",
        path: "/api/regions/:regionSlug",
        summary: "Get Region Details",
        description: "Get detailed information about a specific region/continent including all countries within it and their station counts.",
        params: [
          { name: "regionSlug", type: "string", required: true, description: "Region slug (e.g., europe, asia, north-america)" }
        ],
        responseExample: `{
  "name": "Europe",
  "slug": "europe",
  "countries": [
    { "name": "Germany", "slug": "germany", "stationCount": 3500, "code": "DE" },
    { "name": "France", "slug": "france", "stationCount": 2800, "code": "FR" }
  ],
  "totalStations": 25000
}`
      },
      {
        method: "GET",
        path: "/api/regions/:regionSlug/:countrySlug",
        summary: "Get Country in Region",
        description: "Get detailed information about a country within a specific region. Includes cities, popular stations, and genre distribution.",
        params: [
          { name: "regionSlug", type: "string", required: true, description: "Region slug" },
          { name: "countrySlug", type: "string", required: true, description: "Country slug (e.g., germany, france)" }
        ],
        responseExample: `{
  "name": "Germany",
  "slug": "germany",
  "region": "Europe",
  "code": "DE",
  "stationCount": 3500,
  "cities": ["Berlin", "Munich", "Hamburg", "Cologne"],
  "topGenres": ["pop", "rock", "schlager", "classical"]
}`
      },
      {
        method: "GET",
        path: "/api/regions/:regionSlug/:countrySlug/stations",
        summary: "Stations in Region/Country",
        description: "Get paginated stations within a specific region and country. Optionally filter by city using the citySlug query parameter.",
        params: [
          { name: "regionSlug", type: "string", required: true, description: "Region slug" },
          { name: "countrySlug", type: "string", required: true, description: "Country slug" }
        ],
        queryParams: [
          { name: "city", type: "string", description: "Filter by city slug" },
          { name: "page", type: "number", default: "1", description: "Page number" },
          { name: "limit", type: "number", default: "25", description: "Results per page" },
          { name: "sort", type: "string", default: "votes", description: "Sort field", options: ["votes", "name", "clickCount"] }
        ],
        responseExample: `{
  "stations": [...station objects...],
  "country": "Germany",
  "region": "Europe",
  "pagination": { "page": 1, "limit": 25, "total": 3500, "pages": 140 }
}`
      },
      {
        method: "GET",
        path: "/api/cities/global",
        summary: "Global Cities List",
        description: "Get a list of all cities worldwide that have radio stations. Includes station count per city for map/browse views.",
        responseExample: `[
  { "name": "Berlin", "country": "Germany", "stationCount": 150, "slug": "berlin" },
  { "name": "Istanbul", "country": "Turkey", "stationCount": 120, "slug": "istanbul" },
  { "name": "London", "country": "United Kingdom", "stationCount": 200, "slug": "london" }
]`
      },
      {
        method: "GET",
        path: "/api/cities/precomputed",
        summary: "Precomputed City Data",
        description: "Get precomputed/cached city data optimized for fast loading. Pre-sorted by station count with country grouping. 24h cache TTL.",
        queryParams: [
          { name: "country", type: "string", description: "Filter cities by country name" }
        ],
        responseExample: `{
  "success": true,
  "data": [
    { "name": "Berlin", "slug": "berlin", "stationCount": 150, "country": "Germany" }
  ],
  "total": 5000,
  "cachedAt": "2025-12-10T06:00:00.000Z"
}`
      }
    ]
  },
  {
    id: "tv",
    name: "TV App",
    icon: "📺",
    description: "Endpoints optimized for TV and set-top-box applications. Returns slim payloads with only essential fields for 10-foot UI experiences.",
    endpoints: [
      {
        method: "GET",
        path: "/api/tv/init",
        summary: "TV App Initialization",
        description: "Get all data needed to initialize a TV application in a single request. Returns countries, genres, popular stations, and translations in a slim format optimized for low-bandwidth devices like Samsung Tizen and LG webOS. Reduces payload by ~85% compared to standard endpoints. All data is heavily cached (24h) for fast responses.",
        queryParams: [
          { name: "lang", type: "string", default: "en", description: "Language code for translations (e.g., tr, de, fr)", options: ["en", "tr", "de", "fr", "es", "ar", "ja", "ko", "zh"] },
          { name: "country", type: "string", description: "Country filter for popular stations (e.g., TR, DE, US)" }
        ],
        responseExample: `{
  "countries": [
    { "name": "Germany", "code": "DE", "stationCount": 3500 },
    { "name": "Turkey", "code": "TR", "stationCount": 2800 }
  ],
  "genres": [
    { "_id": "...", "name": "Pop", "slug": "pop", "posterImage": "...", "stationCount": 5000 }
  ],
  "popularStations": [
    {
      "_id": "...", "name": "BBC Radio 1", "slug": "bbc-radio-1",
      "url": "https://...", "favicon": "https://...",
      "country": "United Kingdom", "votes": 15230
    }
  ],
  "version": "1.0",
  "generatedAt": "2025-12-10T10:00:00.000Z"
}`
      }
    ]
  },
  {
    id: "user-engagement",
    name: "User Engagement",
    icon: "💬",
    description: "Social engagement features including user profiles, ratings, favorites, following, and trending stations. Mounted at /api/user-engagement.",
    endpoints: [
      {
        method: "GET",
        path: "/api/user-engagement/profile/:slug",
        summary: "User Engagement Profile",
        description: "Get a user's engagement profile by their slug. Includes listening stats, favorite count, follower/following counts, and recent activity.",
        params: [
          { name: "slug", type: "string", required: true, description: "User profile slug (e.g., john-doe)" }
        ],
        responseExample: `{
  "user": {
    "_id": "...",
    "name": "John Doe",
    "slug": "john-doe",
    "profilePhoto": "https://...",
    "totalListeningTime": 36000,
    "favoriteCount": 25,
    "followers": 15,
    "following": 8,
    "isFollowing": false
  }
}`
      },
      {
        method: "GET",
        path: "/api/user-engagement/profile/:slug/favorites",
        summary: "User Favorites via Engagement",
        description: "Get a user's favorite stations through the engagement API. Supports pagination. Only returns favorites if the user profile is public.",
        params: [
          { name: "slug", type: "string", required: true, description: "User profile slug" }
        ],
        queryParams: [
          { name: "page", type: "number", default: "1", description: "Page number" },
          { name: "limit", type: "number", default: "20", description: "Results per page" }
        ],
        responseExample: `{
  "favorites": [...station objects...],
  "count": 25,
  "page": 1,
  "totalPages": 2
}`
      },
      {
        method: "GET",
        path: "/api/user-engagement/trending",
        summary: "Trending Stations",
        description: "Get currently trending stations based on recent listening activity, clicks, and social engagement. Optionally filter by country.",
        queryParams: [
          { name: "country", type: "string", description: "Filter by country name" },
          { name: "limit", type: "number", default: "100", description: "Number of results" }
        ],
        responseExample: `{
  "trending": [
    {
      "station": { "_id": "...", "name": "BBC Radio 1", ... },
      "trendScore": 95.5,
      "listenersToday": 1500,
      "changePercent": "+12.3%"
    }
  ],
  "generatedAt": "2025-12-10T10:00:00.000Z"
}`
      },
      {
        method: "GET",
        path: "/api/user-engagement/community/favorites",
        summary: "Community Favorites",
        description: "Get the most favorited stations across all users. Represents community-endorsed quality stations. Optionally filter by country or genre.",
        queryParams: [
          { name: "country", type: "string", description: "Filter by country name" },
          { name: "genre", type: "string", description: "Filter by genre tag" },
          { name: "limit", type: "number", default: "100", description: "Number of results" }
        ],
        responseExample: `{
  "stations": [
    {
      "station": { "_id": "...", "name": "SomaFM Groove Salad", ... },
      "favoriteCount": 2500,
      "averageRating": 4.7
    }
  ],
  "count": 100
}`
      },
      {
        method: "POST",
        path: "/api/user-engagement/stations/:stationId/rate",
        summary: "Rate Station (Engagement)",
        description: "Rate a station on a 1-5 scale with an optional text review. Requires user authentication. Users can update their rating by posting again.",
        requiresAuth: true,
        params: [
          { name: "stationId", type: "string", required: true, description: "Station MongoDB ObjectId" }
        ],
        bodyParams: [
          { name: "rating", type: "number", required: true, description: "Rating value (1-5)" },
          { name: "review", type: "string", description: "Optional text review" },
          { name: "userId", type: "string", required: true, description: "Authenticated user ID" }
        ],
        responseExample: `{
  "message": "Rating saved",
  "averageRating": 4.3,
  "totalRatings": 151
}`
      },
      {
        method: "GET",
        path: "/api/user-engagement/stations/:stationId/ratings",
        summary: "Get Station Ratings (Engagement)",
        description: "Get all ratings and reviews for a specific station. Supports pagination and includes user info for each rating.",
        params: [
          { name: "stationId", type: "string", required: true, description: "Station MongoDB ObjectId" }
        ],
        queryParams: [
          { name: "page", type: "number", default: "1", description: "Page number" },
          { name: "limit", type: "number", default: "10", description: "Results per page" }
        ],
        responseExample: `{
  "ratings": [
    {
      "user": { "name": "John Doe", "slug": "john-doe", "profilePhoto": "..." },
      "rating": 5,
      "review": "Amazing station with great music selection!",
      "createdAt": "2025-12-10T10:00:00.000Z"
    }
  ],
  "averageRating": 4.3,
  "totalRatings": 151,
  "page": 1
}`
      },
      {
        method: "POST",
        path: "/api/user-engagement/stations/:stationId/favorite",
        summary: "Toggle Favorite (Engagement)",
        description: "Add or remove a station from favorites. Pass action 'add' or 'remove' in the body. Requires user authentication.",
        requiresAuth: true,
        params: [
          { name: "stationId", type: "string", required: true, description: "Station MongoDB ObjectId" }
        ],
        bodyParams: [
          { name: "userId", type: "string", required: true, description: "Authenticated user ID" },
          { name: "action", type: "string", required: true, description: "Action to perform", options: ["add", "remove"] }
        ],
        responseExample: `{
  "message": "Station added to favorites",
  "isFavorite": true,
  "totalFavorites": 26
}`
      },
      {
        method: "POST",
        path: "/api/user-engagement/follow/:userId",
        summary: "Follow User (Engagement)",
        description: "Follow another user through the engagement API. Creates a follow relationship and sends a notification to the target user. Requires authentication.",
        requiresAuth: true,
        params: [
          { name: "userId", type: "string", required: true, description: "Target user ID to follow" }
        ],
        responseExample: `{ "success": true, "message": "User followed successfully" }`
      },
      {
        method: "POST",
        path: "/api/user-engagement/unfollow/:userId",
        summary: "Unfollow User (Engagement)",
        description: "Unfollow a user through the engagement API. Removes the follow relationship. Requires authentication.",
        requiresAuth: true,
        params: [
          { name: "userId", type: "string", required: true, description: "Target user ID to unfollow" }
        ],
        responseExample: `{ "success": true, "message": "User unfollowed successfully" }`
      },
      {
        method: "GET",
        path: "/api/user-engagement/profiles/popular",
        summary: "Popular User Profiles",
        description: "Get the most popular user profiles ranked by follower count, listening time, and engagement. Useful for 'Top Listeners' and 'Popular Users' sections.",
        queryParams: [
          { name: "limit", type: "number", default: "20", description: "Number of results" }
        ],
        responseExample: `{
  "profiles": [
    {
      "_id": "...",
      "name": "MusicLover99",
      "slug": "musiclover99",
      "profilePhoto": "https://...",
      "followers": 250,
      "totalListeningTime": 180000,
      "favoriteCount": 85
    }
  ],
  "meta": {
    "count": 20,
    "generatedAt": "2025-12-10T10:00:00.000Z"
  }
}`
      },
      {
        method: "GET",
        path: "/api/users/:userId/followers",
        summary: "User Followers List",
        description: "Get paginated list of users who follow the specified user. Returns user profiles with basic info. Useful for social features in mobile apps.",
        params: [
          { name: "userId", type: "string", required: true, description: "Target user MongoDB ObjectId" }
        ],
        queryParams: [
          { name: "page", type: "number", default: "1", description: "Page number" },
          { name: "limit", type: "number", default: "20", description: "Results per page (max 100)" }
        ],
        responseExample: `{
  "followers": [
    {
      "_id": "...",
      "name": "MusicFan",
      "slug": "musicfan",
      "profilePhoto": "https://...",
      "followedAt": "2025-12-10T10:00:00.000Z"
    }
  ],
  "total": 15,
  "page": 1,
  "totalPages": 1
}`,
        tags: ["social", "mobile"]
      },
      {
        method: "GET",
        path: "/api/users/:userId/following",
        summary: "User Following List",
        description: "Get paginated list of users that the specified user follows. Returns user profiles with basic info. Useful for social features in mobile apps.",
        params: [
          { name: "userId", type: "string", required: true, description: "Target user MongoDB ObjectId" }
        ],
        queryParams: [
          { name: "page", type: "number", default: "1", description: "Page number" },
          { name: "limit", type: "number", default: "20", description: "Results per page (max 100)" }
        ],
        responseExample: `{
  "following": [
    {
      "_id": "...",
      "name": "RadioGuru",
      "slug": "radioguru",
      "profilePhoto": "https://...",
      "followedAt": "2025-12-08T14:30:00.000Z"
    }
  ],
  "total": 8,
  "page": 1,
  "totalPages": 1
}`,
        tags: ["social", "mobile"]
      }
    ]
  },
  {
    id: "auth-flow",
    name: "API Authentication Guide",
    icon: "🛡️",
    description: "Complete guide to authenticating with the MegaRadio API. Learn how to obtain API keys, authenticate requests, handle rate limits, and choose the right plan for your application.",
    endpoints: [
      {
        method: "GET",
        path: "Overview",
        summary: "How Authentication Works",
        description: `The MegaRadio API uses API Key authentication for external developers. API keys identify your application, enable rate limiting, and provide usage tracking per plan.

IMPORTANT: API keys are designed for external/third-party developers building apps on top of our API. Our own internal systems (MegaRadio Web, TV App, Android App, iOS App) do NOT use API keys — they connect directly via session-based authentication.

If you are building a third-party radio app, streaming aggregator, or any external integration, we strongly recommend using an API key. Keys provide you with dedicated rate limits, usage analytics, and guaranteed access. Requests without a key may be subject to stricter global rate limits in the future.`,
        responseExample: `Authentication Methods (choose one):

1. X-API-Key Header (Recommended):
   X-API-Key: mr_your_api_key_here

2. Authorization Bearer Header:
   Authorization: Bearer mr_your_api_key_here

3. Query Parameter (not recommended for production):
   ?key=mr_your_api_key_here`
      },
      {
        method: "POST",
        path: "Step 1: Get Your API Key",
        summary: "Three Ways to Get an API Key",
        description: `Choose the method that fits your needs:

OPTION A — Demo Key (Quickest, for testing only):
  Generate a temporary demo key directly from the API Docs page.
  - 1 key per IP address, 24-hour cooldown between generations
  - Limited to 10 requests/minute, 100/day
  - Expires automatically after 24 hours
  - Perfect for quick testing and exploration

OPTION B — Free Key (For development):
  Fill in the "Request API Key" form with your name and email.
  - 60 requests/minute, 1,000/day, 10,000/month
  - No expiration, up to 3 active keys per email
  - Ideal for personal projects and development

OPTION C — Developer Portal (Full control):
  Create an account at /api-user for a complete dashboard.
  - Register with email and password
  - Create, revoke, and manage multiple API keys
  - View real-time usage statistics and quota
  - Upgrade to Pro plan (300 req/min, 10K/day, 100K/month)`,
        bodyParams: [
          { name: "name", type: "string", required: true, description: "Your name or organization (for Option B)" },
          { name: "email", type: "string", required: true, description: "Contact email address (for Option B)" },
          { name: "appName", type: "string", required: false, description: "Name of your application" },
          { name: "usageReason", type: "string", required: false, description: "Brief description of your use case" }
        ],
        responseExample: `// Option A - Demo Key Response:
{
  "apiKey": "mr_demo_a1b2c3d4e5f6...",
  "plan": "demo",
  "limits": { "rateLimitPerMin": 10, "dailyQuota": 100 },
  "expiresAt": "2025-02-13T12:00:00.000Z"
}

// Option B - Free Key Response:
{
  "apiKey": "mr_f7g8h9i0j1k2l3m4...",
  "plan": "free",
  "limits": { "rateLimitPerMin": 60, "dailyQuota": 1000, "monthlyQuota": 10000 },
  "message": "Save this key securely - it will not be shown again."
}

// Option C - Developer Portal Key Response:
{
  "apiKey": "mr_n5o6p7q8r9s0t1u2...",
  "plan": "free",
  "name": "My Radio App Key",
  "message": "Key created. Copy it now - you won't see it again."
}`
      },
      {
        method: "GET",
        path: "Step 2: Make Authenticated Requests",
        summary: "Using Your API Key in Requests",
        description: `Once you have your API key, include it in EVERY API request. The recommended method is the X-API-Key header.

The API returns rate limit information in response headers so you can track your usage:
  X-RateLimit-Limit: Your per-minute limit
  X-RateLimit-Remaining: Requests remaining this minute
  X-RateLimit-Reset: Seconds until the limit resets
  X-Daily-Remaining: Requests remaining today`,
        headers: [
          { name: "X-API-Key", type: "string", required: true, description: "Your API key starting with 'mr_'" }
        ],
        responseExample: `// cURL Example:
curl -H "X-API-Key: mr_your_key_here" \\
  "https://themegaradio.com/api/stations?limit=10&country=Turkey"

// JavaScript / Node.js:
const response = await fetch("https://themegaradio.com/api/stations?limit=10", {
  headers: {
    "X-API-Key": "mr_your_key_here"
  }
});
const data = await response.json();

// Python:
import requests
headers = {"X-API-Key": "mr_your_key_here"}
response = requests.get("https://themegaradio.com/api/stations?limit=10", headers=headers)
data = response.json()

// Android (Kotlin):
val client = OkHttpClient()
val request = Request.Builder()
    .url("https://themegaradio.com/api/stations?limit=10")
    .addHeader("X-API-Key", "mr_your_key_here")
    .build()
val response = client.newCall(request).execute()

// iOS (Swift):
var request = URLRequest(url: URL(string: "https://themegaradio.com/api/stations?limit=10")!)
request.setValue("mr_your_key_here", forHTTPHeaderField: "X-API-Key")
let (data, _) = try await URLSession.shared.data(for: request)`
      },
      {
        method: "GET",
        path: "Step 3: Handle Rate Limits & Errors",
        summary: "Error Handling & Rate Limit Best Practices",
        description: `When you exceed your rate limits, the API returns HTTP 429 (Too Many Requests). Implement proper error handling:

HTTP 429 - Rate limit exceeded:
  Wait for the time specified in the 'retryAfter' field before retrying.

HTTP 429 - Daily quota exceeded:
  Your daily request limit is reached. Wait until midnight UTC for reset.

HTTP 429 - Monthly quota exceeded:
  Consider upgrading your plan for higher limits.

Best Practices:
  1. Cache responses locally — most station data doesn't change frequently
  2. Use the 'limit' parameter to fetch only what you need
  3. Monitor X-RateLimit-Remaining header to avoid hitting limits
  4. Implement exponential backoff for retries
  5. Use webhooks or polling intervals of 60+ seconds for real-time data`,
        responseExample: `// 429 Rate Limit Error Response:
{
  "error": "Rate limit exceeded",
  "retryAfter": 45,
  "limit": 60
}

// 429 Daily Quota Error Response:
{
  "error": "Daily quota exceeded",
  "dailyQuota": 1000
}

// Recommended Error Handling (JavaScript):
async function apiCall(url) {
  const res = await fetch(url, {
    headers: { "X-API-Key": "mr_your_key_here" }
  });
  
  if (res.status === 429) {
    const data = await res.json();
    const wait = (data.retryAfter || 60) * 1000;
    console.log("Rate limited, waiting " + wait + "ms");
    await new Promise(r => setTimeout(r, wait));
    return apiCall(url); // Retry
  }
  
  return res.json();
}`
      },
      {
        method: "GET",
        path: "API Key Plans Comparison",
        summary: "Plan Details & Limits",
        description: `Choose the right plan for your application:

DEMO PLAN — Quick Testing
  Rate Limit: 10 requests/minute
  Daily Quota: 100 requests
  Monthly Quota: 500 requests
  Expiry: 24 hours after generation
  Cost: Free (1 per IP, 24h cooldown)
  Best for: Quick API exploration and testing

FREE PLAN — Development & Personal Projects
  Rate Limit: 60 requests/minute
  Daily Quota: 1,000 requests
  Monthly Quota: 10,000 requests
  Expiry: Never
  Cost: Free
  Best for: Hobby projects, small apps, development

PRO PLAN — Production Applications
  Rate Limit: 300 requests/minute
  Daily Quota: 10,000 requests
  Monthly Quota: 100,000 requests
  Expiry: Never
  Cost: Contact us
  Best for: Commercial apps, high-traffic services, TV/radio aggregators`,
        responseExample: `// Check your current plan & usage:
curl -H "X-API-Key: mr_your_key_here" \\
  "https://themegaradio.com/api/api-keys/validate"

// Response:
{
  "valid": true,
  "plan": "free",
  "status": "active",
  "limits": {
    "rateLimitPerMin": 60,
    "dailyQuota": 1000,
    "monthlyQuota": 10000
  },
  "usage": {
    "todayCount": 42,
    "monthCount": 1250,
    "totalCount": 8500
  }
}`
      },
      {
        method: "GET",
        path: "Developer Portal",
        summary: "Full API Key Management Dashboard",
        description: `The Developer Portal at /api-user provides complete API key management:

REGISTRATION:
  1. Go to themegaradio.com/api-user
  2. Click "Register" tab
  3. Enter email, password (min 8 characters), and display name
  4. Your account is created instantly

KEY MANAGEMENT:
  - Create new API keys with custom names (e.g., "Production", "Staging")
  - View all your keys with usage statistics
  - Revoke compromised or unused keys instantly
  - See real-time request counts and quota usage

SECURITY NOTES:
  - API keys are hashed before storage — we never store raw keys
  - Raw key is shown ONCE at creation — save it immediately
  - Revoked keys are permanently disabled
  - Your password is bcrypt-hashed (10 rounds)
  - Session tokens expire after 7 days`,
        responseExample: `// Developer Portal Authentication:

// 1. Register:
POST /api/api-keys/user/register
Content-Type: application/json
{
  "email": "developer@example.com",
  "password": "securePass123",
  "name": "Jane Developer"
}
// Response: { "message": "Registration successful", "token": "usr_abc...", "user": {...} }

// 2. Login (returns session token):
POST /api/api-keys/user/login
Content-Type: application/json
{
  "email": "developer@example.com",
  "password": "securePass123"
}
// Response: { "token": "usr_abc123...", "user": {...} }

// 3. Get Profile & Keys:
GET /api/api-keys/user/me
X-API-User-Token: usr_abc123...
// Response: { "user": {...}, "keys": [{...}, {...}] }

// 4. Create API Key:
POST /api/api-keys/user/create-key
X-API-User-Token: usr_abc123...
Content-Type: application/json
{ "appName": "My Radio App", "usageReason": "Production" }
// Response: { "apiKey": "mr_newkey...", "message": "Save this key!" }

// 5. Revoke a Key:
POST /api/api-keys/user/revoke-key
X-API-User-Token: usr_abc123...
Content-Type: application/json
{ "keyId": "64a1b2c3d4e5f6..." }
// Response: { "message": "Key revoked successfully" }

// 6. Logout:
POST /api/api-keys/user/logout
X-API-User-Token: usr_abc123...`
      }
    ]
  },
  {
    id: "api-keys",
    name: "API Keys",
    icon: "🔑",
    description: "Manage API keys for authenticated access, rate limiting, and usage tracking.",
    endpoints: [
      {
        method: "POST",
        path: "/api/api-keys/request",
        summary: "Request New API Key",
        description: "Create a new API key for accessing the MegaRadio API. Free plan includes 60 requests/minute, 1,000 daily quota, and 10,000 monthly quota. Maximum 3 active keys per email address.",
        bodyParams: [
          { name: "name", type: "string", required: true, description: "Your name or organization name" },
          { name: "email", type: "string", required: true, description: "Contact email address" },
          { name: "appName", type: "string", description: "Name of your application" },
          { name: "appUrl", type: "string", description: "URL of your application" },
          { name: "usageReason", type: "string", description: "Brief description of how you'll use the API" }
        ],
        responseExample: `{
  "success": true,
  "apiKey": "mr_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
  "keyPrefix": "mr_a1b2",
  "plan": "free",
  "limits": {
    "rateLimitPerMin": 60,
    "dailyQuota": 1000,
    "monthlyQuota": 10000
  },
  "message": "API key created successfully. Save this key securely - it will not be shown again.",
  "expiresAt": null
}`
      },
      {
        method: "GET",
        path: "/api/api-keys/validate",
        summary: "Validate API Key",
        description: "Check if an API key is valid and view current usage statistics, plan details, and remaining quota. Pass the key via X-API-Key header, Authorization: Bearer header, or ?key= query parameter.",
        headers: [
          { name: "X-API-Key", type: "string", required: true, description: "Your API key (alternative: Authorization: Bearer <key>)" }
        ],
        responseExample: `{
  "valid": true,
  "keyPrefix": "mr_a1b2",
  "plan": "free",
  "status": "active",
  "limits": {
    "rateLimitPerMin": 60,
    "dailyQuota": 1000,
    "monthlyQuota": 10000
  },
  "usage": {
    "todayCount": 42,
    "monthCount": 1250,
    "totalCount": 8500,
    "lastUsedAt": "2025-02-12T10:30:00.000Z"
  },
  "createdAt": "2025-01-15T08:00:00.000Z",
  "expiresAt": null
}`
      },
      {
        method: "GET",
        path: "/api/api-keys/demo",
        summary: "Generate Demo API Key",
        description: "Generate a temporary demo API key for quick testing. Each IP address can generate one demo key per 24 hours (cooldown period). Demo keys expire after 24 hours and have lower rate limits (10 req/min, 100 daily). Use GET /api/api-keys/demo/status to check availability before requesting.",
        responseExample: `// Success (key generated):
{
  "apiKey": "mr_demo_a1b2c3d4e5f6...",
  "keyPrefix": "mr_demo",
  "plan": "demo",
  "limits": {
    "rateLimitPerMin": 10,
    "dailyQuota": 100,
    "monthlyQuota": 500
  },
  "expiresAt": "2025-02-13T12:00:00.000Z"
}

// Cooldown active (24h not passed):
{
  "error": "Demo key cooldown active",
  "available": false,
  "hoursRemaining": 18,
  "message": "Try again in ~18 hours or create a free account at /api-user"
}`
      },
      {
        method: "GET",
        path: "/api/api-keys/demo/status",
        summary: "Check Demo Key Availability",
        description: "Check if a demo key can be generated from the current IP address. Returns availability status and cooldown time remaining if in cooldown period.",
        responseExample: `// Available:
{ "available": true }

// In cooldown:
{
  "available": false,
  "hoursRemaining": 18,
  "message": "Demo key cooldown active. Try again in ~18 hours."
}`
      },
      {
        method: "GET",
        path: "/api/api-keys/usage",
        summary: "Get Usage Statistics",
        description: "View detailed usage statistics for your API key including today's count, monthly count, total requests, and remaining quota. Counters reset daily and monthly automatically.",
        headers: [
          { name: "X-API-Key", type: "string", required: true, description: "Your API key" }
        ],
        responseExample: `{
  "keyPrefix": "mr_a1b2",
  "plan": "free",
  "status": "active",
  "usage": {
    "today": { "used": 42, "limit": 1000, "remaining": 958 },
    "month": { "used": 1250, "limit": 10000, "remaining": 8750 },
    "total": 8500,
    "lastUsedAt": "2025-02-12T10:30:00.000Z"
  },
  "limits": {
    "rateLimitPerMin": 60,
    "dailyQuota": 1000,
    "monthlyQuota": 10000
  }
}`
      },
      {
        method: "GET",
        path: "/api/api-keys/my-keys",
        summary: "List My API Keys",
        description: "List all API keys associated with an email address. Returns key metadata without the actual key values. Useful for managing multiple keys.",
        queryParams: [
          { name: "email", type: "string", required: true, description: "Email address to look up keys for" }
        ],
        responseExample: `{
  "keys": [
    {
      "keyPrefix": "mr_a1b2",
      "name": "Sahin",
      "appName": "My Radio App",
      "plan": "free",
      "status": "active",
      "usage": {
        "todayCount": 42,
        "monthCount": 1250,
        "totalCount": 8500
      },
      "limits": {
        "rateLimitPerMin": 60,
        "dailyQuota": 1000,
        "monthlyQuota": 10000
      },
      "createdAt": "2025-01-15T08:00:00.000Z"
    }
  ],
  "total": 1
}`
      },
      {
        method: "POST",
        path: "/api/api-keys/revoke",
        summary: "Revoke API Key",
        description: "Permanently revoke an API key. The key will no longer be accepted for any requests. Demo keys cannot be revoked. Pass the key via X-API-Key header or in the request body.",
        headers: [
          { name: "X-API-Key", type: "string", required: true, description: "The API key to revoke" }
        ],
        responseExample: `{
  "success": true,
  "message": "API key has been revoked"
}`
      }
    ]
  },
  {
    id: "mobile-auth",
    name: "Mobile Auth",
    icon: "📱",
    description: "Token-based authentication for mobile (iOS/Android) and TV apps. Uses Bearer tokens instead of session cookies for stateless, cross-device auth. Tokens are prefixed with 'mrt_', valid for 90 days, and should be stored in the device's secure storage (iOS Keychain / Android Keystore). All authenticated endpoints (/api/recently-played, /api/user/favorites, etc.) accept Bearer tokens.",
    endpoints: [
      {
        method: "GET",
        path: "Integration Guide",
        summary: "How Mobile Auth Works",
        description: `MegaRadio uses a dual authentication system:

WEB (Browser): Session cookies (connect.sid) - automatic, managed by browser
MOBILE / TV: Bearer tokens (mrt_...) - stateless, stored on device

Token Lifecycle:
1. User logs in via /api/auth/mobile/login or /api/auth/mobile/google
2. Server returns a token: "mrt_a1b2c3d4..." (valid 90 days)
3. App stores token securely (iOS Keychain / Android Keystore / TV SecureStorage)
4. Every API request includes: Authorization: Bearer mrt_a1b2c3d4...
5. On app launch, call /api/auth/mobile/me to validate the stored token
6. If token expired/revoked, redirect to login screen

Token Details:
- Format: mrt_ + 64 hex characters (32 random bytes)
- Expiry: 90 days from creation
- Auto-cleanup: Expired tokens are deleted by MongoDB TTL index
- Each login creates a new token (multiple devices = multiple tokens)
- Revoking a token is instant and permanent

Supported Endpoints (all accept Bearer token):
- GET/POST /api/recently-played (recently played stations)
- GET/POST/DELETE /api/user/favorites (favorite stations)
- POST /api/user/follow/:userId (follow user)
- DELETE /api/user/unfollow/:userId (unfollow user)
- POST /api/listening/record (record listening time)
- GET /api/user/notifications (get notifications)
- PUT /api/auth/profile (update profile)
- All other endpoints with requiresAuth`,
        responseExample: `// iOS (Swift) - Store token in Keychain:
let token = response.token  // "mrt_a1b2c3d4..."
KeychainHelper.save(token, forKey: "megaradio_token")

// iOS - Use token in requests:
var request = URLRequest(url: URL(string: "https://themegaradio.com/api/recently-played")!)
request.setValue("Bearer \\(token)", forHTTPHeaderField: "Authorization")

// Android (Kotlin) - Store token:
val prefs = EncryptedSharedPreferences.create(...)
prefs.edit().putString("megaradio_token", token).apply()

// Android - Use token with Retrofit:
@GET("api/recently-played")
suspend fun getRecentlyPlayed(
    @Header("Authorization") auth: String  // "Bearer mrt_..."
): List<Station>

// React Native / Flutter:
headers: { "Authorization": "Bearer mrt_a1b2c3d4..." }

// TV App (Samsung/LG):
localStorage.setItem("megaradio_token", token);
fetch(url, { headers: { "Authorization": "Bearer " + token } });`
      },
      {
        method: "POST",
        path: "/api/auth/mobile/login",
        summary: "Mobile Login",
        description: "Authenticate with email/password and receive a Bearer token. The token is valid for 90 days. Store it securely in the device keychain/keystore. Each call creates a new token (old tokens remain valid until they expire or are revoked).",
        bodyParams: [
          { name: "email", type: "string", required: true, description: "User email address" },
          { name: "password", type: "string", required: true, description: "User password" },
          { name: "deviceType", type: "string", default: "mobile", description: "Device platform identifier", options: ["mobile", "tv", "desktop"] },
          { name: "deviceName", type: "string", description: "Human-readable device name for token management (e.g. 'iPhone 15 Pro', 'Samsung Galaxy S24', 'LG WebOS TV')" }
        ],
        responseExample: `{
  "message": "Login successful",
  "token": "mrt_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0",
  "tokenExpiresIn": "90 days",
  "user": {
    "_id": "507f1f77bcf86cd799439011",
    "fullName": "Ahmet Yilmaz",
    "username": "ahmet",
    "email": "ahmet@example.com",
    "slug": "ahmet-yilmaz",
    "avatar": "/uploads/avatars/avatar-507f1f77.webp",
    "role": "user",
    "followersCount": 42,
    "followingCount": 18,
    "favoriteStationsCount": 15,
    "totalListeningTime": 3600,
    "isPublicProfile": true
  }
}

// Errors:
{ "error": "Email and password are required" }   // 400
{ "error": "Invalid email or password" }          // 401
{ "error": "Account is suspended or inactive" }   // 403`
      },
      {
        method: "POST",
        path: "/api/auth/mobile/google",
        summary: "Mobile Google Auth",
        description: "Exchange Google Sign-In credentials for a Bearer token. Use this after completing Google Sign-In natively on the device (via Google Sign-In SDK for iOS/Android or Google Identity Services for TV). If the user doesn't exist, a new account is created automatically with the Google profile data. If the email already exists, the Google ID is linked to the existing account.",
        bodyParams: [
          { name: "googleId", type: "string", required: true, description: "Google user ID from Google Sign-In SDK (sub claim from ID token)" },
          { name: "email", type: "string", required: true, description: "Email address from Google profile" },
          { name: "fullName", type: "string", description: "Full name from Google profile (used for new account creation)" },
          { name: "avatar", type: "string", description: "Profile photo URL from Google (automatically saved for new accounts)" },
          { name: "deviceType", type: "string", default: "mobile", description: "Device platform", options: ["mobile", "tv"] },
          { name: "deviceName", type: "string", description: "Device name for token management" }
        ],
        responseExample: `{
  "message": "Login successful",
  "token": "mrt_f8e7d6c5b4a3929187654321abcdef0123456789abcdef0123456789abcdef01",
  "tokenExpiresIn": "90 days",
  "isNewUser": true,
  "user": {
    "_id": "507f1f77bcf86cd799439011",
    "fullName": "Ahmet Yilmaz",
    "username": "ahmet",
    "email": "ahmet@gmail.com",
    "slug": "ahmet-yilmaz",
    "avatar": "https://lh3.googleusercontent.com/a/photo...",
    "role": "user",
    "followersCount": 0,
    "followingCount": 0,
    "favoriteStationsCount": 0,
    "totalListeningTime": 0,
    "isPublicProfile": true
  }
}

// isNewUser: true = new account created, false = existing account
// Errors:
{ "error": "Google ID and email are required" }  // 400`
      },
      {
        method: "GET",
        path: "/api/auth/mobile/me",
        summary: "Validate Token & Get User",
        description: "Validate the stored Bearer token and get fresh user data. Call this on every app launch to: (1) Check if token is still valid, (2) Get updated user stats (followers, favorites count), (3) Refresh user profile data. If authenticated is false, delete the stored token and show the login screen. This endpoint also updates the token's lastUsedAt timestamp.",
        requiresAuth: true,
        headers: [
          { name: "Authorization", type: "string", required: true, description: "Bearer mrt_your_token_here" }
        ],
        responseExample: `// Valid token:
{
  "authenticated": true,
  "token": {
    "expiresAt": "2026-05-14T12:00:00.000Z",
    "deviceType": "mobile"
  },
  "user": {
    "_id": "507f1f77bcf86cd799439011",
    "fullName": "Ahmet Yilmaz",
    "username": "ahmet",
    "email": "ahmet@example.com",
    "slug": "ahmet-yilmaz",
    "avatar": "/uploads/avatars/avatar-507f1f77.webp",
    "role": "user",
    "followersCount": 42,
    "followingCount": 18,
    "favoriteStationsCount": 15,
    "totalListeningTime": 3600,
    "isPublicProfile": true
  }
}

// Expired, revoked, or invalid token:
{
  "authenticated": false,
  "user": null
}

// No token provided:
{
  "authenticated": false,
  "user": null
}`
      },
      {
        method: "POST",
        path: "/api/auth/mobile/logout",
        summary: "Logout (Revoke Token)",
        description: "Revoke the current Bearer token permanently. After calling this, the token is immediately invalid and cannot be reused. The user must log in again to get a new token. Always call this when the user taps 'Logout' in the app, then delete the stored token from device storage.",
        requiresAuth: true,
        headers: [
          { name: "Authorization", type: "string", required: true, description: "Bearer mrt_your_token_here" }
        ],
        responseExample: `{
  "success": true,
  "message": "Logged out successfully"
}

// After logout, delete token from device:
// iOS: KeychainHelper.delete(forKey: "megaradio_token")
// Android: prefs.edit().remove("megaradio_token").apply()`
      },
      {
        method: "POST",
        path: "/api/auth/mobile/logout-all",
        summary: "Logout All Devices",
        description: "Revoke ALL active tokens for the current user across all devices. Use this for a 'Sign out everywhere' or security-related feature (e.g., password change, suspicious activity). Returns the count of revoked tokens. After calling this, the current device's token is also invalid.",
        requiresAuth: true,
        headers: [
          { name: "Authorization", type: "string", required: true, description: "Bearer mrt_your_token_here" }
        ],
        responseExample: `{
  "success": true,
  "message": "All devices logged out",
  "revokedCount": 3
}

// revokedCount shows how many active tokens were revoked
// (e.g., 3 = user was logged in on 3 devices)`
      }
    ]
  },
  {
    id: "mobile-cache",
    name: "Mobile Cache & Performance",
    icon: "⚡",
    description: "React Native, iOS (Swift), Android (Kotlin) ve TV uygulamaları için API cache stratejisi ve performans rehberi. Backend zaten server-side cache kullanıyor - bu rehber mobil tarafta nasıl en hızlı şekilde API kullanılacağını anlatır.",
    endpoints: [
      {
        method: "GET",
        path: "Cache TTL Reference",
        summary: "Endpoint Bazlı Cache Süreleri",
        description: `Her endpoint için önerilen cache süreleri. Backend server-side cache süreleriyle uyumludur.

NADİREN DEĞİŞEN VERİLER (Uzun Cache):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GET /api/countries .................. 24 saat
GET /api/genres/all ................. 24 saat
GET /api/translations/:lang ........ 24 saat
GET /api/station/:slug ............. 30 dakika

ORTA SIKLIKTA DEĞİŞEN VERİLER:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GET /api/stations .................. 10 dakika
GET /api/stations/popular .......... 10 dakika
GET /api/stations/nearby ........... 10 dakika
GET /api/genres .................... 5 dakika
GET /api/genres/slug/:slug/stations . 1 saat
GET /api/stations/trending ......... 5 dakika

SIK DEĞİŞEN VERİLER (Kısa Cache):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GET /api/users/:id/followers ....... 2 dakika
GET /api/users/:id/following ....... 2 dakika
GET /api/user/is-following/:id ..... 2 dakika
GET /api/auth/mobile/me ............ 2 dakika
GET /api/user/favorites ............ 1 dakika
GET /api/recently-played ........... 30 saniye
GET /api/user/notifications ........ 30 saniye`,
        responseExample: `// Cache TTL sabitleri (milisaniye):
const CACHE_TTL = {
  COUNTRIES: 24 * 60 * 60 * 1000,       // 24 saat
  GENRES_ALL: 24 * 60 * 60 * 1000,      // 24 saat
  TRANSLATIONS: 24 * 60 * 60 * 1000,    // 24 saat
  STATION_DETAIL: 30 * 60 * 1000,       // 30 dakika

  STATIONS_LIST: 10 * 60 * 1000,        // 10 dakika
  POPULAR_STATIONS: 10 * 60 * 1000,     // 10 dakika
  GENRES_FILTERED: 5 * 60 * 1000,       // 5 dakika
  GENRE_STATIONS: 60 * 60 * 1000,       // 1 saat
  TRENDING: 5 * 60 * 1000,              // 5 dakika

  FOLLOWERS: 2 * 60 * 1000,             // 2 dakika
  FOLLOWING: 2 * 60 * 1000,             // 2 dakika
  IS_FOLLOWING: 2 * 60 * 1000,          // 2 dakika
  USER_PROFILE: 2 * 60 * 1000,          // 2 dakika
  FAVORITES: 60 * 1000,                 // 1 dakika
  RECENTLY_PLAYED: 30 * 1000,           // 30 saniye
  NOTIFICATIONS: 30 * 1000,             // 30 saniye
};`
      },
      {
        method: "GET",
        path: "Cache Implementation",
        summary: "2 Katmanlı Cache Sistemi (Memory + Disk)",
        description: `Mobil uygulamada en hızlı performans için 2 katmanlı cache kullanın:

KATMAN 1 - BELLEK (Memory Cache):
In-memory Map veya Dictionary. Uygulama açıkken en hızlı erişim.
Uygulama kapandığında silinir.

KATMAN 2 - DİSK (Persistent Cache):
AsyncStorage (React Native), UserDefaults (iOS), SharedPreferences (Android).
Uygulama yeniden açıldığında hâlâ mevcut.

OKUMA SÜRECİ:
1. Önce bellekten bak → bulursa hemen dön (< 1ms)
2. Bellekte yoksa diskten bak → bulursa belleğe yükle ve dön (< 10ms)
3. Hiçbirinde yoksa API'ye istek at → sonucu hem belleğe hem diske yaz

YAZMA SÜRECİ:
1. API'den veri gelince hem belleğe hem diske yaz
2. Cache key = endpoint URL + parametreler (benzersiz olmalı)
3. TTL süresi dolmuşsa eski veriyi sil, yenisini al`,
        responseExample: `// React Native - ApiCache sınıfı:
import AsyncStorage from '@react-native-async-storage/async-storage';

interface CacheEntry {
  data: any;
  timestamp: number;
  ttl: number;
}

class ApiCache {
  private memoryCache = new Map<string, CacheEntry>();

  async get<T>(key: string): Promise<T | null> {
    // 1. Bellekten bak (en hızlı)
    const memEntry = this.memoryCache.get(key);
    if (memEntry && Date.now() - memEntry.timestamp < memEntry.ttl) {
      return memEntry.data as T;
    }

    // 2. Diskten bak
    try {
      const stored = await AsyncStorage.getItem(\`cache:\${key}\`);
      if (stored) {
        const entry: CacheEntry = JSON.parse(stored);
        if (Date.now() - entry.timestamp < entry.ttl) {
          this.memoryCache.set(key, entry);
          return entry.data as T;
        }
        AsyncStorage.removeItem(\`cache:\${key}\`);
      }
    } catch {}

    return null;
  }

  async set(key: string, data: any, ttl: number): Promise<void> {
    const entry: CacheEntry = { data, timestamp: Date.now(), ttl };
    this.memoryCache.set(key, entry);
    AsyncStorage.setItem(\`cache:\${key}\`, JSON.stringify(entry)).catch(() => {});
  }

  async invalidate(pattern: string): Promise<void> {
    for (const key of this.memoryCache.keys()) {
      if (key.includes(pattern)) this.memoryCache.delete(key);
    }
    const allKeys = await AsyncStorage.getAllKeys();
    const toDelete = allKeys.filter(k =>
      k.startsWith('cache:') && k.includes(pattern)
    );
    if (toDelete.length > 0) await AsyncStorage.multiRemove(toDelete);
  }
}

export const apiCache = new ApiCache();`
      },
      {
        method: "GET",
        path: "API Usage Examples",
        summary: "Cache'li API Çağrı Örnekleri",
        description: `Her API çağrısında cache kontrol edilir. Cache'de varsa API'ye istek gitmez.

ÖNEMLİ KURALLAR:
1. Aynı endpoint'i TTL süresi içinde tekrar çağırmayın
2. Liste scroll'unda sayfalama kullanın (page=1,2,3...)
3. Arama sorgularını debounce edin (300ms bekleyin, sonra istek atın)
4. forceRefresh parametresi ile gerektiğinde cache atlayabilirsiniz
5. Station logo URL'lerinde ?w=100&format=webp ekleyin (küçük boyut)`,
        responseExample: `// api/megaRadioApi.ts
// ⚠️ MOBILE / TV APPS: MUST always add ?tv=1 to ALL API requests!
// This enables slim responses, server-side caching, and faster load times.
import axios from 'axios';
import { apiCache, CACHE_TTL } from './client';

const API = 'https://themegaradio.com';
let authToken: string | null = null;

const api = axios.create({ baseURL: API, timeout: 15000 });
api.interceptors.request.use(config => {
  if (authToken) config.headers.Authorization = \`Bearer \${authToken}\`;
  // Auto-add tv=1 to ALL requests for slim responses
  // Benefits: ~47% smaller payloads, server cache hits, faster rendering
  config.params = { ...config.params, tv: 1 };
  return config;
});

// ═══════════════════════════════════════
// TV / MOBILE INIT
// ═══════════════════════════════════════

export async function getTvInit() {
  const key = 'tv:init';
  const cached = await apiCache.get(key);
  if (cached) return cached;
  const { data } = await api.get('/api/tv/init');
  await apiCache.set(key, data, CACHE_TTL.TV_INIT);
  return data;
}

// ═══════════════════════════════════════
// STATIONS
// ═══════════════════════════════════════

export async function getPopularStations(limit = 20, forceRefresh = false) {
  const key = \`popular-stations:\${limit}\`;
  if (!forceRefresh) {
    const cached = await apiCache.get(key);
    if (cached) return cached;
  }
  const { data } = await api.get(\`/api/stations/popular?limit=\${limit}\`);
  await apiCache.set(key, data, CACHE_TTL.POPULAR_STATIONS);
  return data;
}

export async function getStations(page = 1, filters = {}) {
  const key = \`stations:\${page}:\${JSON.stringify(filters)}\`;
  const cached = await apiCache.get(key);
  if (cached) return cached;
  const { data } = await api.get('/api/stations', { params: { page, ...filters } });
  await apiCache.set(key, data, CACHE_TTL.STATIONS_LIST);
  return data;
}

export async function getStationBySlug(slug: string) {
  const key = \`station:\${slug}\`;
  const cached = await apiCache.get(key);
  if (cached) return cached;
  const { data } = await api.get(\`/api/stations/slug/\${slug}\`);
  await apiCache.set(key, data, CACHE_TTL.STATION_DETAIL);
  return data;
}

export async function getTrendingStations(country?: string) {
  const key = \`trending:\${country || 'all'}\`;
  const cached = await apiCache.get(key);
  if (cached) return cached;
  const { data } = await api.get('/api/stations/trending',
    { params: country ? { country } : {} });
  await apiCache.set(key, data, CACHE_TTL.TRENDING);
  return data;
}

// ═══════════════════════════════════════
// GENRES & COUNTRIES
// ═══════════════════════════════════════

export async function getDiscoverableGenres() {
  const key = 'genres:discoverable';
  const cached = await apiCache.get(key);
  if (cached) return cached;
  const { data } = await api.get('/api/genres/discoverable');
  await apiCache.set(key, data, CACHE_TTL.GENRES_ALL);
  return data;
}

export async function getGenreStations(slug: string, page = 1) {
  const key = \`genre-stations:\${slug}:\${page}\`;
  const cached = await apiCache.get(key);
  if (cached) return cached;
  const { data } = await api.get(\`/api/genres/\${slug}/stations\`, { params: { page } });
  await apiCache.set(key, data, CACHE_TTL.STATIONS_LIST);
  return data;
}

export async function getAllGenres() {
  const key = 'genres:all';
  const cached = await apiCache.get(key);
  if (cached) return cached;
  const { data } = await api.get('/api/genres/all');
  await apiCache.set(key, data, CACHE_TTL.GENRES_ALL);
  return data;
}

export async function getCountries() {
  const key = 'countries:all';
  const cached = await apiCache.get(key);
  if (cached) return cached;
  const { data } = await api.get('/api/countries');
  await apiCache.set(key, data, CACHE_TTL.COUNTRIES);
  return data;
}

// ═══════════════════════════════════════
// USER & SOCIAL (auth gerekli)
// ═══════════════════════════════════════

export async function getFavorites() {
  const key = 'user:favorites';
  const cached = await apiCache.get(key);
  if (cached) return cached;
  const { data } = await api.get('/api/user/favorites');
  await apiCache.set(key, data, CACHE_TTL.FAVORITES);
  return data;
}

export async function getRecentlyPlayed() {
  const key = 'recently-played';
  const cached = await apiCache.get(key);
  if (cached) return cached;
  const { data } = await api.get('/api/recently-played');
  await apiCache.set(key, data, CACHE_TTL.RECENTLY_PLAYED);
  return data;
}

export async function getFollowers(userId: string, page = 1) {
  const key = \`followers:\${userId}:\${page}\`;
  const cached = await apiCache.get(key);
  if (cached) return cached;
  const { data } = await api.get(\`/api/users/\${userId}/followers?page=\${page}\`);
  await apiCache.set(key, data, CACHE_TTL.FOLLOWERS);
  return data;
}

export async function getFollowing(userId: string, page = 1) {
  const key = \`following:\${userId}:\${page}\`;
  const cached = await apiCache.get(key);
  if (cached) return cached;
  const { data } = await api.get(\`/api/users/\${userId}/following?page=\${page}\`);
  await apiCache.set(key, data, CACHE_TTL.FOLLOWING);
  return data;
}`
      },
      {
        method: "POST",
        path: "Cache Invalidation Rules",
        summary: "Yazma İşlemlerinde Cache Temizleme",
        description: `Kullanıcı bir aksiyon yaptığında (follow, favorite, play) ilgili cache'ler temizlenmelidir. Aksi halde eski veri gösterilir.

CACHE TEMİZLEME KURALLARI:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
follow/unfollow yaptığında:
  → followers, following, is-following, user-profile cache temizle

favorite ekle/çıkar yaptığında:
  → favorites cache temizle

radyo dinlemeye başladığında:
  → recently-played cache temizle

profil güncellediğinde:
  → user-profile cache temizle

NOT: Sadece ilgili cache'leri temizleyin, tüm cache'i silmeyin!`,
        responseExample: `// Cache invalidation örnekleri:

export async function followUser(userId: string) {
  const { data } = await api.post(\`/api/user/follow/\${userId}\`);
  // İlgili tüm cache'leri temizle
  await Promise.all([
    apiCache.invalidate('followers'),
    apiCache.invalidate('following'),
    apiCache.invalidate('is-following'),
    apiCache.invalidate('user-profile'),
  ]);
  return data;
}

export async function unfollowUser(userId: string) {
  const { data } = await api.delete(\`/api/user/unfollow/\${userId}\`);
  await Promise.all([
    apiCache.invalidate('followers'),
    apiCache.invalidate('following'),
    apiCache.invalidate('is-following'),
    apiCache.invalidate('user-profile'),
  ]);
  return data;
}

export async function toggleFavorite(stationId: string, isFav: boolean) {
  if (isFav) {
    await api.delete(\`/api/user/favorites/\${stationId}\`);
  } else {
    await api.post('/api/user/favorites', { stationId });
  }
  await apiCache.invalidate('favorites');
}

export async function postRecentlyPlayed(stationId: string) {
  await api.post('/api/recently-played', { stationId });
  await apiCache.invalidate('recently-played');
}`
      },
      {
        method: "GET",
        path: "App Startup Preload",
        summary: "Uygulama Açılışında Önceden Yükleme",
        description: `Uygulama açılır açılmaz sık kullanılan verileri paralel olarak yükleyin. Bu sayede kullanıcı ana ekrana geldiğinde veriler hazır olur. İnternet yoksa disk cache'den eski veri gösterilebilir (offline-first yaklaşım).

BAŞLANGIÇTA YÜKLE:
1. Ülkeler (24 saat cache - nadiren değişir)
2. Tüm türler (24 saat cache)
3. Popüler istasyonlar (ana ekranda gösterilir)
4. Kullanıcı profili (giriş yapmışsa)
5. Favoriler (giriş yapmışsa)

LAZY LOAD (Gerektiğinde):
- İstasyon detayı (kullanıcı tıklayınca)
- Tür istasyonları (tür sayfasına girince)
- Followers/following (profil sayfasına girince)
- Bildirimler (bildirim sekmesine girince)`,
        responseExample: `// hooks/usePreloadData.ts
import { useEffect } from 'react';
import {
  getCountries,
  getAllGenres,
  getPopularStations,
  getRecentlyPlayed,
  getFavorites,
} from '../api/megaRadioApi';

export function usePreloadData(isAuthenticated: boolean) {
  useEffect(() => {
    // Herkes için paralel yükle
    Promise.all([
      getCountries(),
      getAllGenres(),
      getPopularStations(),
    ]).catch(() => {});

    // Giriş yapmış kullanıcılar için ek veriler
    if (isAuthenticated) {
      Promise.all([
        getRecentlyPlayed(),
        getFavorites(),
      ]).catch(() => {});
    }
  }, [isAuthenticated]);
}

// App.tsx'de kullanım:
function App() {
  const { isAuthenticated } = useAuth();
  usePreloadData(isAuthenticated);
  // ...
}

// ═══════════════════════════════════════
// GÖRSEL OPTİMİZASYONU
// ═══════════════════════════════════════
// Station logo'ları için küçük boyut isteyin:
// react-native-fast-image kullanın (native cache)
import FastImage from 'react-native-fast-image';

<FastImage
  source={{
    uri: station.favicon + '?w=100&format=webp',
    priority: FastImage.priority.normal,
    cache: FastImage.cacheControl.immutable,
  }}
  style={{ width: 50, height: 50, borderRadius: 8 }}
/>

// ═══════════════════════════════════════
// SONSUZ SCROLL (FlatList)
// ═══════════════════════════════════════
<FlatList
  data={stations}
  renderItem={({ item }) => <StationCard station={item} />}
  onEndReached={() => {
    if (hasNextPage) loadPage(currentPage + 1);
  }}
  onEndReachedThreshold={0.5}
/>`
      },
      {
        method: "GET",
        path: "Platform Specific Tips",
        summary: "iOS / Android / TV Özel İpuçları",
        description: `Her platform için ek performans ipuçları:

iOS (Swift/SwiftUI):
- URLCache ile HTTP cache kullanın
- NSCache ile bellekte hızlı erişim
- Keychain'de token saklayın
- Background App Refresh ile cache yenileyin

Android (Kotlin/Jetpack Compose):
- OkHttp Cache + CacheInterceptor kullanın
- Room Database ile offline-first yapın
- EncryptedSharedPreferences'da token saklayın
- WorkManager ile arka plan cache yenilemesi

TV (Samsung/LG/Android TV):
- localStorage ile basit cache yeterli
- Uzaktan kumanda navigasyonu için prefetch yapın
- Ekran boyutu büyük olduğu için daha fazla veri yükleyin (limit=50)

React Native (Tüm Platformlar):
- @react-native-async-storage/async-storage kullanın
- react-native-fast-image ile görsel cache'leyin
- react-native-mmkv daha hızlı alternatif (C++ tabanlı)
- Arama için debounce: 300ms bekleyin, sonra istek atın`,
        responseExample: `// ═══════════════════════════════════════
// iOS - URLCache kullanımı (Swift):
// ═══════════════════════════════════════
let config = URLSessionConfiguration.default
config.urlCache = URLCache(
  memoryCapacity: 50 * 1024 * 1024,   // 50 MB bellek
  diskCapacity: 200 * 1024 * 1024      // 200 MB disk
)
config.requestCachePolicy = .returnCacheDataElseLoad

// ═══════════════════════════════════════
// Android - OkHttp Cache (Kotlin):
// ═══════════════════════════════════════
val cache = Cache(
  directory = context.cacheDir,
  maxSize = 50L * 1024 * 1024  // 50 MB
)
val client = OkHttpClient.Builder()
  .cache(cache)
  .addInterceptor { chain ->
    val request = chain.request().newBuilder()
      .header("Cache-Control", "max-age=120")
      .build()
    chain.proceed(request)
  }
  .build()

// ═══════════════════════════════════════
// React Native - MMKV (Daha hızlı):
// ═══════════════════════════════════════
import { MMKV } from 'react-native-mmkv';
const storage = new MMKV();

// AsyncStorage yerine MMKV kullanın:
storage.set('cache:genres:all', JSON.stringify(entry));
const stored = storage.getString('cache:genres:all');

// ═══════════════════════════════════════
// Debounce ile Arama:
// ═══════════════════════════════════════
import { useState, useEffect } from 'react';

function useDebounce(value: string, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

// Kullanım:
const [query, setQuery] = useState('');
const debouncedQuery = useDebounce(query, 300);
useEffect(() => {
  if (debouncedQuery.length >= 2) {
    searchStations(debouncedQuery);
  }
}, [debouncedQuery]);`
      }
    ]
  }
];

const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: "#22c55e",
  POST: "#3b82f6",
  PUT: "#f59e0b",
  PATCH: "#a855f7",
  DELETE: "#ef4444"
};

function generateCurl(endpoint: ApiEndpoint, baseUrl: string): string {
  let curl = `curl -X ${endpoint.method}`;
  let url = `${baseUrl}${endpoint.path}`;
  if (endpoint.queryParams?.length) {
    const params = endpoint.queryParams
      .filter(p => p.default || p.required)
      .map(p => `${p.name}=${p.default || '{value}'}`)
      .join('&');
    if (params) url += `?${params}`;
  }
  curl += ` "${url}"`;
  if (endpoint.requiresAuth) curl += ` \\\n  -H "Cookie: connect.sid=YOUR_SESSION"`;
  if (endpoint.bodyParams?.length) {
    curl += ` \\\n  -H "Content-Type: application/json"`;
    const body: Record<string, string> = {};
    endpoint.bodyParams.forEach(p => { body[p.name] = `{${p.name}}`; });
    curl += ` \\\n  -d '${JSON.stringify(body, null, 2)}'`;
  }
  return curl;
}

function generateFetch(endpoint: ApiEndpoint, baseUrl: string): string {
  let url = `${baseUrl}${endpoint.path}`;
  const options: string[] = [];
  if (endpoint.method !== 'GET') options.push(`  method: "${endpoint.method}"`);
  if (endpoint.requiresAuth) options.push(`  credentials: "include"`);
  if (endpoint.bodyParams?.length) {
    options.push(`  headers: { "Content-Type": "application/json" }`);
    const body: Record<string, string> = {};
    endpoint.bodyParams.forEach(p => { body[p.name] = `{${p.name}}`; });
    options.push(`  body: JSON.stringify(${JSON.stringify(body, null, 4)})`);
  }
  let code = `const response = await fetch("${url}"`;
  if (options.length) code += `, {\n${options.join(",\n")}\n}`;
  code += `);\nconst data = await response.json();\nconsole.log(data);`;
  return code;
}

function generatePython(endpoint: ApiEndpoint, baseUrl: string): string {
  let url = `${baseUrl}${endpoint.path}`;
  let code = `import requests\n\n`;
  if (endpoint.method === 'GET') {
    const params: string[] = [];
    endpoint.queryParams?.filter(p => p.default || p.required).forEach(p => {
      params.push(`    "${p.name}": "${p.default || '{value}'}"`);
    });
    if (params.length) {
      code += `params = {\n${params.join(",\n")}\n}\n`;
      code += `response = requests.get("${url}", params=params)\n`;
    } else {
      code += `response = requests.get("${url}")\n`;
    }
  } else {
    if (endpoint.bodyParams?.length) {
      const body: string[] = [];
      endpoint.bodyParams.forEach(p => { body.push(`    "${p.name}": "{${p.name}}"`); });
      code += `data = {\n${body.join(",\n")}\n}\n`;
      code += `response = requests.${endpoint.method.toLowerCase()}("${url}", json=data)\n`;
    } else {
      code += `response = requests.${endpoint.method.toLowerCase()}("${url}")\n`;
    }
  }
  code += `print(response.json())`;
  return code;
}

function TryItPanel({ endpoint }: { endpoint: ApiEndpoint }) {
  const t = useTheme();
  const apiKeyCtx = useApiKey();
  const [params, setParams] = useState<Record<string, string>>({});
  const [response, setResponse] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<number | null>(null);
  const [responseTime, setResponseTime] = useState<number | null>(null);
  const [localKey, setLocalKey] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);

  const canTry = endpoint.method === "GET" && !endpoint.path.includes("stream/") && !endpoint.path.includes("image/");
  const hasValidKey = apiKeyCtx.validated && !!apiKeyCtx.key;

  const handleValidateKey = useCallback(async () => {
    if (!localKey.trim()) {
      setKeyError("Please enter an API key");
      return;
    }
    setValidating(true);
    setKeyError(null);
    try {
      const res = await fetch(`/api/api-keys/validate?key=${encodeURIComponent(localKey.trim())}`);
      const data = await res.json();
      if (data.valid) {
        apiKeyCtx.setKey(localKey.trim(), data.plan);
        setKeyError(null);
      } else {
        setKeyError(data.error || "Invalid API key");
      }
    } catch {
      setKeyError("Validation failed");
    }
    setValidating(false);
  }, [localKey, apiKeyCtx]);

  const handleGetDemoKey = useCallback(async () => {
    setDemoLoading(true);
    setDemoError(null);
    try {
      const res = await fetch("/api/api-keys/demo");
      const data = await res.json();
      if (res.ok && data.apiKey) {
        apiKeyCtx.setKey(data.apiKey, 'demo');
        setDemoError(null);
      } else {
        setDemoError(data.message || data.error || "Demo key unavailable");
      }
    } catch {
      setDemoError("Failed to get demo key");
    }
    setDemoLoading(false);
  }, [apiKeyCtx]);

  const handleTest = useCallback(async () => {
    if (!canTry || !hasValidKey) return;
    setLoading(true);
    setResponse(null);
    setStatus(null);

    let url = endpoint.path;
    endpoint.params?.forEach(p => {
      const val = params[p.name] || '';
      url = url.replace(`:${p.name}`, encodeURIComponent(val));
    });

    const qp = new URLSearchParams();
    endpoint.queryParams?.forEach(p => {
      const val = params[p.name];
      if (val) qp.set(p.name, val);
    });
    const qs = qp.toString();
    if (qs) url += `?${qs}`;

    const start = Date.now();
    try {
      const res = await fetch(url, {
        headers: { 'X-API-Key': apiKeyCtx.key! },
      });
      setResponseTime(Date.now() - start);
      setStatus(res.status);
      const text = await res.text();
      try {
        const json = JSON.parse(text);
        setResponse(JSON.stringify(json, null, 2));
      } catch {
        setResponse(text.substring(0, 5000));
      }
    } catch (err) {
      setResponseTime(Date.now() - start);
      setStatus(0);
      setResponse(`Error: ${err instanceof Error ? err.message : 'Network error'}`);
    }
    setLoading(false);
  }, [endpoint, params, canTry, hasValidKey, apiKeyCtx.key]);

  if (!canTry) return null;

  const allParams = [
    ...(endpoint.params || []).map(p => ({ ...p, source: 'path' as const })),
    ...(endpoint.queryParams || []).map(p => ({ ...p, source: 'query' as const }))
  ];

  return (
    <div style={{ background: t.tryItBg, borderRadius: 8, padding: 16, marginTop: 16, border: `1px solid ${t.tryItBorder}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "#22c55e" }}>TRY IT LIVE</span>
        <span style={{ fontSize: 11, color: t.textMuted, background: t.badgeBg, padding: "2px 8px", borderRadius: 4 }}>Read-Only</span>
        {hasValidKey && (
          <span style={{ fontSize: 10, color: "#22c55e", background: "rgba(34,197,94,0.1)", padding: "2px 8px", borderRadius: 4, fontWeight: 700 }}>
            {apiKeyCtx.plan?.toUpperCase()} KEY
          </span>
        )}
      </div>

      {!hasValidKey && (
        <div style={{ marginBottom: 16, padding: 16, background: t.codeBg, borderRadius: 8, border: `1px solid ${t.cardBorder}` }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: t.heading, marginBottom: 8 }}>API Key Required</div>
          <p style={{ fontSize: 12, color: t.textMuted, margin: "0 0 12px", lineHeight: 1.6 }}>
            Enter your API key to send live requests. Get a free demo key or request your own.
          </p>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input
              type="text"
              value={localKey}
              onChange={e => setLocalKey(e.target.value)}
              placeholder="mr_your_api_key..."
              style={{ flex: 1, padding: "8px 12px", background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: 6, color: t.text, fontSize: 12, boxSizing: "border-box" }}
              onKeyDown={e => e.key === 'Enter' && handleValidateKey()}
            />
            <button
              onClick={handleValidateKey}
              disabled={validating}
              style={{
                padding: "8px 16px", background: "#3b82f6", color: "#fff",
                border: "none", borderRadius: 6, fontWeight: 700, cursor: validating ? "wait" : "pointer",
                fontSize: 12, whiteSpace: "nowrap"
              }}
            >
              {validating ? "..." : "Validate"}
            </button>
          </div>
          {keyError && <div style={{ fontSize: 11, color: "#ef4444", marginBottom: 8 }}>{keyError}</div>}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
            <button
              onClick={handleGetDemoKey}
              disabled={demoLoading}
              style={{
                padding: "6px 14px", background: "transparent", color: "#22c55e",
                border: "1px solid #22c55e", borderRadius: 6, fontWeight: 600, cursor: demoLoading ? "wait" : "pointer",
                fontSize: 11
              }}
            >
              {demoLoading ? "Getting..." : "Get Demo Key (24h)"}
            </button>
            <a href="/api-user" style={{ fontSize: 11, color: t.link, textDecoration: "none" }}>
              or Request Free API Key &rarr;
            </a>
          </div>
          {demoError && <div style={{ fontSize: 11, color: "#f59e0b", marginTop: 6 }}>{demoError}</div>}
        </div>
      )}

      {hasValidKey && (
        <>
          {allParams.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8, marginBottom: 12 }}>
              {allParams.map(p => (
                <div key={p.name}>
                  <label style={{ fontSize: 11, color: t.textMuted, display: "block", marginBottom: 2 }}>
                    {p.name} {p.required && <span style={{ color: "#ef4444" }}>*</span>}
                    <span style={{ color: t.textDim, marginLeft: 4 }}>({p.source})</span>
                  </label>
                  {p.options ? (
                    <select
                      value={params[p.name] || ''}
                      onChange={e => setParams(prev => ({ ...prev, [p.name]: e.target.value }))}
                      style={{ width: "100%", padding: "6px 8px", background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: 4, color: t.text, fontSize: 13 }}
                    >
                      <option value="">-- select --</option>
                      {p.options.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input
                      type="text"
                      placeholder={p.default || p.type}
                      value={params[p.name] || ''}
                      onChange={e => setParams(prev => ({ ...prev, [p.name]: e.target.value }))}
                      style={{ width: "100%", padding: "6px 8px", background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: 4, color: t.text, fontSize: 13, boxSizing: "border-box" }}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={handleTest}
              disabled={loading}
              style={{
                padding: "8px 24px", background: loading ? t.badgeBg : "#22c55e", color: "#000",
                border: "none", borderRadius: 6, fontWeight: 700, cursor: loading ? "wait" : "pointer",
                fontSize: 13
              }}
            >
              {loading ? "Sending..." : "Send Request"}
            </button>
            <button
              onClick={() => apiKeyCtx.setKey(null, null)}
              style={{
                padding: "6px 12px", background: "transparent", color: t.textMuted,
                border: `1px solid ${t.cardBorder}`, borderRadius: 6, cursor: "pointer", fontSize: 11
              }}
            >
              Change Key
            </button>
          </div>
        </>
      )}

      {response !== null && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", gap: 12, marginBottom: 6, fontSize: 12 }}>
            <span style={{ color: status && status >= 200 && status < 300 ? "#22c55e" : "#ef4444" }}>
              Status: {status}
            </span>
            {responseTime !== null && <span style={{ color: t.textMuted }}>Time: {responseTime}ms</span>}
          </div>
          <pre style={{
            background: t.codeBlockBg, padding: 12, borderRadius: 6, color: t.text,
            fontSize: 12, overflow: "auto", maxHeight: 400, whiteSpace: "pre-wrap",
            border: `1px solid ${t.tableBorder}`
          }}>
            {response.substring(0, 10000)}
          </pre>
        </div>
      )}
    </div>
  );
}

function CodeExamples({ endpoint }: { endpoint: ApiEndpoint }) {
  const th = useTheme();
  const [tab, setTab] = useState<"curl" | "js" | "python">("curl");
  const baseUrl = "https://themegaradio.com";

  const code = useMemo(() => {
    switch (tab) {
      case "curl": return generateCurl(endpoint, baseUrl);
      case "js": return generateFetch(endpoint, baseUrl);
      case "python": return generatePython(endpoint, baseUrl);
    }
  }, [tab, endpoint]);

  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "flex", gap: 0, marginBottom: 0 }}>
        {(["curl", "js", "python"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "6px 16px", border: `1px solid ${th.codeTabBorder}`, borderBottom: tab === t ? "none" : `1px solid ${th.codeTabBorder}`,
              background: tab === t ? th.codeTabActiveBg : th.codeTabBg, color: tab === t ? th.heading : th.textMuted,
              cursor: "pointer", fontSize: 12, fontWeight: tab === t ? 700 : 400,
              borderRadius: t === "curl" ? "6px 0 0 0" : t === "python" ? "0 6px 0 0" : 0
            }}
          >
            {t === "curl" ? "cURL" : t === "js" ? "JavaScript" : "Python"}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          onClick={handleCopy}
          style={{
            padding: "6px 12px", background: "transparent", border: `1px solid ${th.codeTabBorder}`,
            color: copied ? "#22c55e" : th.textMuted, cursor: "pointer", fontSize: 11, borderRadius: "0 6px 0 0"
          }}
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre style={{
        background: th.codeTabActiveBg, padding: 14, borderRadius: "0 0 6px 6px", color: th.text,
        fontSize: 12, overflow: "auto", whiteSpace: "pre-wrap", border: `1px solid ${th.codeTabBorder}`, borderTop: "none", margin: 0
      }}>
        {code}
      </pre>
    </div>
  );
}

function ApiAccessPanel() {
  const t = useTheme();
  const apiKeyCtx = useApiKey();
  const [activeTab, setActiveTab] = useState<"request" | "demo" | "validate">("demo");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [appName, setAppName] = useState("");
  const [usageReason, setUsageReason] = useState("");
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [keyCopied, setKeyCopied] = useState(false);
  const [requestLoading, setRequestLoading] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  const [demoKey, setDemoKey] = useState<string | null>(null);
  const [demoLimits, setDemoLimits] = useState<any>(null);
  const [demoCopied, setDemoCopied] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoAvailable, setDemoAvailable] = useState<boolean | null>(null);
  const [demoHoursLeft, setDemoHoursLeft] = useState<number>(0);
  const [demoError, setDemoError] = useState<string | null>(null);

  const [validateKey, setValidateKey] = useState("");
  const [validateResult, setValidateResult] = useState<any>(null);
  const [validateLoading, setValidateLoading] = useState(false);

  const checkDemoStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/api-keys/demo/status");
      const data = await res.json();
      setDemoAvailable(data.available);
      if (!data.available) setDemoHoursLeft(data.hoursRemaining || 0);
    } catch {
      setDemoAvailable(true);
    }
  }, []);

  useEffect(() => { checkDemoStatus(); }, [checkDemoStatus]);

  const handleGetDemo = useCallback(async () => {
    setDemoLoading(true);
    setDemoError(null);
    try {
      const res = await fetch("/api/api-keys/demo");
      const data = await res.json();
      if (res.ok && data.apiKey) {
        setDemoKey(data.apiKey);
        setDemoLimits(data.limits);
        apiKeyCtx.setKey(data.apiKey, 'demo');
      } else {
        setDemoError(data.message || data.error || "Demo key unavailable");
        setDemoAvailable(false);
        if (data.hoursRemaining) setDemoHoursLeft(data.hoursRemaining);
      }
    } catch {
      setDemoError("Network error");
    }
    setDemoLoading(false);
  }, [apiKeyCtx]);

  const handleRequest = useCallback(async () => {
    if (!name.trim() || !email.trim()) {
      setRequestError("Name and email are required");
      return;
    }
    setRequestLoading(true);
    setRequestError(null);
    setGeneratedKey(null);
    try {
      const res = await fetch("/api/api-keys/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, appName, usageReason }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRequestError(data.error || "Failed to create API key");
      } else {
        setGeneratedKey(data.apiKey);
      }
    } catch {
      setRequestError("Network error");
    }
    setRequestLoading(false);
  }, [name, email, appName, usageReason]);

  const handleValidate = useCallback(async () => {
    if (!validateKey.trim()) return;
    setValidateLoading(true);
    setValidateResult(null);
    try {
      const res = await fetch("/api/api-keys/validate", {
        headers: { "X-API-Key": validateKey },
      });
      const data = await res.json();
      setValidateResult(data);
    } catch {
      setValidateResult({ valid: false, error: "Network error" });
    }
    setValidateLoading(false);
  }, [validateKey]);

  const copyToClipboard = (text: string, setter: (v: boolean) => void) => {
    navigator.clipboard.writeText(text);
    setter(true);
    setTimeout(() => setter(false), 2000);
  };

  const tabBtnStyle = (active: boolean) => ({
    padding: "8px 16px",
    background: active ? t.activeNavBg : "transparent",
    border: active ? `1px solid ${t.activeNavBorder}` : `1px solid ${t.cardBorder}`,
    borderRadius: 6,
    color: active ? t.heading : t.textMuted,
    cursor: "pointer" as const,
    fontSize: 12,
    fontWeight: active ? 700 : 400,
  });

  const inputStyle = {
    width: "100%",
    padding: "10px 12px",
    background: t.inputBg,
    border: `1px solid ${t.inputBorder}`,
    borderRadius: 6,
    color: t.text,
    fontSize: 13,
    boxSizing: "border-box" as const,
    outline: "none",
  };

  return (
    <div style={{
      border: `2px solid ${t.activeNavBorder}`,
      borderRadius: 12,
      overflow: "hidden",
      marginBottom: 32,
      background: t.cardBg,
    }}>
      <div style={{
        padding: "20px 24px",
        background: `linear-gradient(135deg, ${t.activeNavBg}, ${t.cardBgOpen})`,
        borderBottom: `1px solid ${t.cardBorder}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 28 }}>🔑</span>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: t.heading }}>API Access</h2>
            <p style={{ fontSize: 13, color: t.textMuted, margin: "4px 0 0" }}>
              Get your API key to start making requests. Try the demo key for quick testing.
            </p>
          </div>
        </div>
      </div>

      <div style={{ padding: "16px 24px 8px", display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => setActiveTab("demo")} style={tabBtnStyle(activeTab === "demo")}>
          Demo Key
        </button>
        <button onClick={() => setActiveTab("request")} style={tabBtnStyle(activeTab === "request")}>
          Request API Key
        </button>
        <button onClick={() => setActiveTab("validate")} style={tabBtnStyle(activeTab === "validate")}>
          Validate Key
        </button>
      </div>

      <div style={{ padding: "16px 24px 24px" }}>
        {activeTab === "demo" && (
          <div>
            <p style={{ fontSize: 13, color: t.textSecondary, margin: "0 0 16px", lineHeight: 1.6 }}>
              Get a temporary demo key to test API endpoints. Each IP gets one demo key per 24 hours with limited quota.
              For higher limits, create a free account in the <a href="/api-user" style={{ color: t.link, textDecoration: "none" }}>Developer Portal</a>.
            </p>

            {!demoKey && (
              <div style={{ marginBottom: 16 }}>
                {demoAvailable === false ? (
                  <div style={{ padding: 16, background: t.codeBg, borderRadius: 8, border: `1px solid ${t.cardBorder}` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: 16 }}>&#9203;</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#f59e0b" }}>Demo Key Cooldown</span>
                    </div>
                    <p style={{ fontSize: 12, color: t.textMuted, margin: "0 0 8px", lineHeight: 1.6 }}>
                      You already used a demo key from this IP. Try again in ~{demoHoursLeft} hour(s).
                    </p>
                    <a href="/api-user" style={{ fontSize: 12, color: t.link, textDecoration: "none", fontWeight: 600 }}>
                      Create a free account for unlimited keys &rarr;
                    </a>
                  </div>
                ) : (
                  <button
                    onClick={handleGetDemo}
                    disabled={demoLoading}
                    style={{
                      padding: "12px 24px", background: demoLoading ? t.badgeBg : "#22c55e", color: "#000",
                      border: "none", borderRadius: 8, fontWeight: 700, cursor: demoLoading ? "wait" : "pointer",
                      fontSize: 14, width: "100%",
                    }}
                  >
                    {demoLoading ? "Generating..." : "Generate Demo Key (24h, 1 per IP)"}
                  </button>
                )}
                {demoError && <div style={{ fontSize: 12, color: "#f59e0b", marginTop: 8 }}>{demoError}</div>}
              </div>
            )}

            {demoKey && (
              <div style={{
                background: t.codeBg,
                borderRadius: 8,
                padding: 16,
                border: `1px solid ${t.cardBorder}`,
                marginBottom: 16,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: "#22c55e", fontWeight: 700 }}>YOUR DEMO API KEY (24h)</span>
                  <span style={{ fontSize: 10, color: t.textDim, background: t.badgeBg, padding: "2px 6px", borderRadius: 4 }}>Save it now!</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <code style={{
                    flex: 1,
                    padding: "10px 14px",
                    background: t.codeBlockBg,
                    borderRadius: 6,
                    fontSize: 13,
                    fontFamily: "monospace",
                    color: t.link,
                    border: `1px solid ${t.tableBorder}`,
                    wordBreak: "break-all",
                  }}>
                    {demoKey}
                  </code>
                  <button
                    onClick={() => copyToClipboard(demoKey, setDemoCopied)}
                    style={{
                      padding: "10px 16px",
                      background: demoCopied ? "#22c55e" : t.activeNavBorder,
                      color: "#fff",
                      border: "none",
                      borderRadius: 6,
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: 700,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {demoCopied ? "Copied!" : "Copy"}
                  </button>
                </div>
                <p style={{ fontSize: 11, color: t.textDim, margin: "8px 0 0" }}>
                  This key is already activated for live testing. Expires in 24 hours.
                </p>
              </div>
            )}

            {demoLimits && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                <div style={{ padding: 12, background: t.codeBg, borderRadius: 8, textAlign: "center", border: `1px solid ${t.cardBorder}` }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: t.heading }}>{demoLimits.rateLimitPerMin}</div>
                  <div style={{ fontSize: 11, color: t.textMuted }}>Requests/Min</div>
                </div>
                <div style={{ padding: 12, background: t.codeBg, borderRadius: 8, textAlign: "center", border: `1px solid ${t.cardBorder}` }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: t.heading }}>{demoLimits.dailyQuota}</div>
                  <div style={{ fontSize: 11, color: t.textMuted }}>Daily Quota</div>
                </div>
                <div style={{ padding: 12, background: t.codeBg, borderRadius: 8, textAlign: "center", border: `1px solid ${t.cardBorder}` }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: t.heading }}>{demoLimits.monthlyQuota}</div>
                  <div style={{ fontSize: 11, color: t.textMuted }}>Monthly Quota</div>
                </div>
              </div>
            )}

            <div style={{ marginTop: 16, padding: 12, background: t.tryItBg, borderRadius: 8, border: `1px solid ${t.tryItBorder}` }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: t.heading, marginBottom: 8 }}>Usage Example</div>
              <pre style={{
                fontSize: 12, color: t.responseText, fontFamily: "monospace", margin: 0,
                whiteSpace: "pre-wrap", lineHeight: 1.6
              }}>
{`curl -H "X-API-Key: ${demoKey || 'mr_your_demo_key'}" \\
  https://themegaradio.com/api/stations?limit=5

// JavaScript
fetch("/api/stations?limit=5", {
  headers: { "X-API-Key": "${demoKey || 'mr_your_demo_key'}" }
})`}
              </pre>
            </div>
          </div>
        )}

        {activeTab === "request" && (
          <div>
            {generatedKey ? (
              <div>
                <div style={{
                  padding: 16,
                  background: t.tryItBg,
                  borderRadius: 8,
                  border: `1px solid ${t.tryItBorder}`,
                  marginBottom: 16,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <span style={{ fontSize: 18 }}>&#10003;</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "#22c55e" }}>API Key Created Successfully</span>
                  </div>
                  <p style={{ fontSize: 12, color: t.textSecondary, margin: "0 0 12px", lineHeight: 1.6 }}>
                    Save this key securely - it will not be shown again. Use it in the X-API-Key header or Authorization: Bearer header.
                  </p>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <code style={{
                      flex: 1,
                      padding: "12px 14px",
                      background: t.codeBlockBg,
                      borderRadius: 6,
                      fontSize: 14,
                      fontFamily: "monospace",
                      color: t.link,
                      border: `1px solid ${t.tableBorder}`,
                      wordBreak: "break-all",
                      fontWeight: 700,
                    }}>
                      {generatedKey}
                    </code>
                    <button
                      onClick={() => copyToClipboard(generatedKey, setKeyCopied)}
                      style={{
                        padding: "12px 20px",
                        background: keyCopied ? "#22c55e" : t.activeNavBorder,
                        color: "#fff",
                        border: "none",
                        borderRadius: 6,
                        cursor: "pointer",
                        fontSize: 13,
                        fontWeight: 700,
                      }}
                    >
                      {keyCopied ? "Copied!" : "Copy Key"}
                    </button>
                  </div>
                </div>
                <button
                  onClick={() => { setGeneratedKey(null); setName(""); setEmail(""); setAppName(""); setUsageReason(""); }}
                  style={{
                    padding: "8px 16px",
                    background: "transparent",
                    border: `1px solid ${t.cardBorder}`,
                    borderRadius: 6,
                    color: t.textMuted,
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  Request Another Key
                </button>
              </div>
            ) : (
              <div>
                <p style={{ fontSize: 13, color: t.textSecondary, margin: "0 0 16px", lineHeight: 1.6 }}>
                  Request your own API key for higher rate limits and usage tracking. Free plan includes 60 requests/minute and 1,000 daily requests.
                </p>

                <div style={{ display: "grid", gap: 12, marginBottom: 16 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <label style={{ fontSize: 12, color: t.textMuted, display: "block", marginBottom: 4 }}>
                        Name <span style={{ color: "#ef4444" }}>*</span>
                      </label>
                      <input
                        type="text"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder="Your name"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, color: t.textMuted, display: "block", marginBottom: 4 }}>
                        Email <span style={{ color: "#ef4444" }}>*</span>
                      </label>
                      <input
                        type="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        style={inputStyle}
                      />
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <label style={{ fontSize: 12, color: t.textMuted, display: "block", marginBottom: 4 }}>App Name</label>
                      <input
                        type="text"
                        value={appName}
                        onChange={e => setAppName(e.target.value)}
                        placeholder="My Radio App"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, color: t.textMuted, display: "block", marginBottom: 4 }}>Usage Reason</label>
                      <input
                        type="text"
                        value={usageReason}
                        onChange={e => setUsageReason(e.target.value)}
                        placeholder="Mobile app integration"
                        style={inputStyle}
                      />
                    </div>
                  </div>
                </div>

                {requestError && (
                  <div style={{ padding: "10px 14px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, color: "#dc2626", fontSize: 13, marginBottom: 12 }}>
                    {requestError}
                  </div>
                )}

                <button
                  onClick={handleRequest}
                  disabled={requestLoading}
                  style={{
                    padding: "10px 28px",
                    background: requestLoading ? t.badgeBg : "#3b82f6",
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                    cursor: requestLoading ? "wait" : "pointer",
                    fontSize: 14,
                    fontWeight: 700,
                  }}
                >
                  {requestLoading ? "Creating..." : "Request API Key"}
                </button>

                <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                  {[
                    { label: "Free", rpm: "60", daily: "1,000", monthly: "10,000", active: true },
                    { label: "Pro", rpm: "300", daily: "10,000", monthly: "100,000", active: false },
                    { label: "Demo", rpm: "10", daily: "100", monthly: "500", active: false },
                  ].map(plan => (
                    <div key={plan.label} style={{
                      padding: 14,
                      background: plan.active ? t.activeNavBg : t.codeBg,
                      borderRadius: 8,
                      border: plan.active ? `2px solid ${t.activeNavBorder}` : `1px solid ${t.cardBorder}`,
                    }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: t.heading, marginBottom: 8 }}>
                        {plan.label}
                        {plan.active && <span style={{ fontSize: 10, color: "#22c55e", marginLeft: 6 }}>CURRENT</span>}
                      </div>
                      <div style={{ fontSize: 11, color: t.textMuted, lineHeight: 2 }}>
                        <div>{plan.rpm} req/min</div>
                        <div>{plan.daily} daily</div>
                        <div>{plan.monthly} monthly</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "validate" && (
          <div>
            <p style={{ fontSize: 13, color: t.textSecondary, margin: "0 0 16px", lineHeight: 1.6 }}>
              Check if your API key is valid and view your current usage and remaining quota.
            </p>

            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <input
                type="text"
                value={validateKey}
                onChange={e => setValidateKey(e.target.value)}
                placeholder="Enter your API key (mr_...)"
                style={{ ...inputStyle, flex: 1 }}
              />
              <button
                onClick={handleValidate}
                disabled={validateLoading}
                style={{
                  padding: "10px 20px",
                  background: validateLoading ? t.badgeBg : "#3b82f6",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  cursor: validateLoading ? "wait" : "pointer",
                  fontSize: 13,
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                }}
              >
                {validateLoading ? "Checking..." : "Validate"}
              </button>
            </div>

            {validateResult && (
              <div style={{
                padding: 16,
                background: validateResult.valid ? t.tryItBg : "#fef2f2",
                borderRadius: 8,
                border: `1px solid ${validateResult.valid ? t.tryItBorder : "#fecaca"}`,
              }}>
                {validateResult.valid ? (
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                      <span style={{ color: "#22c55e", fontSize: 16 }}>&#10003;</span>
                      <span style={{ fontSize: 14, fontWeight: 700, color: "#22c55e" }}>Valid API Key</span>
                      <span style={{
                        fontSize: 10,
                        padding: "2px 8px",
                        borderRadius: 4,
                        background: t.badgeBg,
                        color: t.textMuted,
                        textTransform: "uppercase",
                        fontWeight: 700,
                      }}>
                        {validateResult.plan}
                      </span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
                      <div style={{ padding: 10, background: t.codeBg, borderRadius: 6, border: `1px solid ${t.cardBorder}` }}>
                        <div style={{ fontSize: 11, color: t.textMuted }}>Key Prefix</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: t.heading, fontFamily: "monospace" }}>{validateResult.keyPrefix}</div>
                      </div>
                      <div style={{ padding: 10, background: t.codeBg, borderRadius: 6, border: `1px solid ${t.cardBorder}` }}>
                        <div style={{ fontSize: 11, color: t.textMuted }}>Status</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#22c55e" }}>{validateResult.status}</div>
                      </div>
                      <div style={{ padding: 10, background: t.codeBg, borderRadius: 6, border: `1px solid ${t.cardBorder}` }}>
                        <div style={{ fontSize: 11, color: t.textMuted }}>Today Used</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: t.heading }}>{validateResult.usage?.todayCount || 0} / {validateResult.limits?.dailyQuota}</div>
                      </div>
                      <div style={{ padding: 10, background: t.codeBg, borderRadius: 6, border: `1px solid ${t.cardBorder}` }}>
                        <div style={{ fontSize: 11, color: t.textMuted }}>Month Used</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: t.heading }}>{validateResult.usage?.monthCount || 0} / {validateResult.limits?.monthlyQuota}</div>
                      </div>
                      <div style={{ padding: 10, background: t.codeBg, borderRadius: 6, border: `1px solid ${t.cardBorder}` }}>
                        <div style={{ fontSize: 11, color: t.textMuted }}>Total Requests</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: t.heading }}>{validateResult.usage?.totalCount || 0}</div>
                      </div>
                      <div style={{ padding: 10, background: t.codeBg, borderRadius: 6, border: `1px solid ${t.cardBorder}` }}>
                        <div style={{ fontSize: 11, color: t.textMuted }}>Rate Limit</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: t.heading }}>{validateResult.limits?.rateLimitPerMin}/min</div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ color: "#ef4444", fontSize: 16 }}>&#10007;</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "#ef4444" }}>{validateResult.error || "Invalid API Key"}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function EndpointCard({ endpoint, isOpen, isActive, onToggle }: { endpoint: ApiEndpoint; isOpen: boolean; isActive: boolean; onToggle: () => void }) {
  const t = useTheme();
  return (
    <div style={{ border: `1px solid ${isActive ? t.activeNavBorder : t.cardBorder}`, borderRadius: 8, marginBottom: 8, overflow: "hidden", transition: "border-color 0.2s" }}>
      <button
        onClick={onToggle}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "12px 16px",
          background: isOpen ? t.cardBgOpen : t.cardBg, border: "none", cursor: "pointer", textAlign: "left"
        }}
      >
        <span style={{
          padding: "3px 10px", borderRadius: 4, fontSize: 11, fontWeight: 800, letterSpacing: 0.5,
          color: "#fff", background: METHOD_COLORS[endpoint.method], minWidth: 56, textAlign: "center"
        }}>
          {endpoint.method}
        </span>
        <code style={{ color: t.text, fontSize: 13, fontFamily: "monospace", flex: 1 }}>
          {endpoint.path}
        </code>
        {endpoint.requiresAuth && (
          <span style={{ fontSize: 10, color: t.authText, background: t.authBg, padding: "2px 8px", borderRadius: 4 }}>AUTH</span>
        )}
        <span className="api-endpoint-summary" style={{ color: t.textMuted, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {endpoint.summary}
        </span>
        <span style={{ color: t.textDim, fontSize: 16, transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>▼</span>
      </button>

      {isOpen && (
        <div style={{ padding: "16px 20px", background: t.cardBg, borderTop: `1px solid ${t.cardBorder}` }}>
          <p style={{ color: t.textSecondary, fontSize: 14, margin: "0 0 16px 0", lineHeight: 1.6 }}>
            {endpoint.description}
          </p>

          {endpoint.params && endpoint.params.length > 0 && (
            <ParamTable title="Path Parameters" params={endpoint.params} />
          )}
          {endpoint.queryParams && endpoint.queryParams.length > 0 && (
            <ParamTable title="Query Parameters" params={endpoint.queryParams} />
          )}
          {endpoint.bodyParams && endpoint.bodyParams.length > 0 && (
            <ParamTable title="Request Body (JSON)" params={endpoint.bodyParams} />
          )}
          {endpoint.headers && endpoint.headers.length > 0 && (
            <ParamTable title="Headers" params={endpoint.headers} />
          )}

          {endpoint.tags && endpoint.tags.length > 0 && (
            <div style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
              {endpoint.tags.map(tag => (
                <span key={tag} style={{ fontSize: 11, color: t.tagText, background: t.tagBg, padding: "3px 10px", borderRadius: 4 }}>{tag}</span>
              ))}
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            <h4 style={{ color: t.heading, fontSize: 13, fontWeight: 700, margin: "0 0 8px 0" }}>Response Example</h4>
            <pre style={{
              background: t.codeBlockBg, padding: 14, borderRadius: 6, color: t.responseText,
              fontSize: 12, overflow: "auto", maxHeight: 300, whiteSpace: "pre-wrap",
              border: `1px solid ${t.tableBorder}`
            }}>
              {endpoint.responseExample}
            </pre>
          </div>

          <div className="api-mobile-live-test">
            <CodeExamples endpoint={endpoint} />
            <TryItPanel endpoint={endpoint} />
          </div>
        </div>
      )}
    </div>
  );
}

function RightPanel({ activeEndpoint }: { activeEndpoint: ApiEndpoint | null }) {
  const t = useTheme();

  if (!activeEndpoint) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{
          border: `1px dashed ${t.cardBorder}`,
          borderRadius: 12,
          padding: "48px 24px",
          textAlign: "center",
        }}>
          <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.4 }}>&#9881;</div>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: t.heading, margin: "0 0 8px" }}>Live API Tester</h3>
          <p style={{ fontSize: 13, color: t.textMuted, lineHeight: 1.6, margin: 0 }}>
            Select an endpoint from the left panel to test it live. You can send requests and see real responses here.
          </p>
        </div>

        <div style={{ marginTop: 24, padding: 16, background: t.codeBg, borderRadius: 8, border: `1px solid ${t.cardBorder}` }}>
          <h4 style={{ fontSize: 12, fontWeight: 700, color: t.textMuted, margin: "0 0 12px", textTransform: "uppercase", letterSpacing: 1 }}>How to Use</h4>
          <div style={{ fontSize: 12, color: t.textSecondary, lineHeight: 2 }}>
            <div>1. Browse endpoints in the left panel</div>
            <div>2. Click an endpoint to expand details</div>
            <div>3. Code examples & live tester appear here</div>
            <div>4. Fill in parameters and click Send</div>
          </div>
        </div>

        <div style={{ marginTop: 24, padding: 16, background: t.codeBg, borderRadius: 8, border: `1px solid ${t.cardBorder}` }}>
          <h4 style={{ fontSize: 12, fontWeight: 700, color: t.textMuted, margin: "0 0 12px", textTransform: "uppercase", letterSpacing: 1 }}>API Key Header</h4>
          <pre style={{ fontSize: 11, color: t.responseText, fontFamily: "monospace", margin: 0, lineHeight: 1.8 }}>
{`X-API-Key: mr_your_key_here
// or
Authorization: Bearer mr_your_key_here`}
          </pre>
        </div>

        <div style={{ marginTop: 24, padding: 16, background: t.codeBg, borderRadius: 8, border: `1px solid ${t.cardBorder}` }}>
          <h4 style={{ fontSize: 12, fontWeight: 700, color: t.textMuted, margin: "0 0 12px", textTransform: "uppercase", letterSpacing: 1 }}>Rate Limits</h4>
          <div style={{ fontSize: 12, color: t.textSecondary, lineHeight: 2 }}>
            <div><span style={{ color: "#a855f7" }}>Demo:</span> 10 req/min, 100/day</div>
            <div><span style={{ color: "#3b82f6" }}>Free:</span> 60 req/min, 1K/day</div>
            <div><span style={{ color: "#22c55e" }}>Pro:</span> 300 req/min, 10K/day</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 20 }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{
            padding: "3px 10px", borderRadius: 4, fontSize: 11, fontWeight: 800,
            color: "#fff", background: METHOD_COLORS[activeEndpoint.method],
          }}>
            {activeEndpoint.method}
          </span>
          <span style={{ fontSize: 14, fontWeight: 700, color: t.heading }}>{activeEndpoint.summary}</span>
        </div>
        <code style={{ fontSize: 12, color: t.link, fontFamily: "monospace", wordBreak: "break-all" }}>
          {activeEndpoint.path}
        </code>
      </div>

      <CodeExamples endpoint={activeEndpoint} />
      <TryItPanel endpoint={activeEndpoint} />
    </div>
  );
}

function ParamTable({ title, params }: { title: string; params: ApiParam[] }) {
  const t = useTheme();
  return (
    <div style={{ marginBottom: 16 }}>
      <h4 style={{ color: t.heading, fontSize: 13, fontWeight: 700, margin: "0 0 8px 0" }}>{title}</h4>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${t.cardBorder}` }}>
              <th style={{ textAlign: "left", padding: "8px 12px", color: t.textMuted, fontWeight: 600 }}>Name</th>
              <th style={{ textAlign: "left", padding: "8px 12px", color: t.textMuted, fontWeight: 600 }}>Type</th>
              <th style={{ textAlign: "left", padding: "8px 12px", color: t.textMuted, fontWeight: 600 }}>Required</th>
              <th style={{ textAlign: "left", padding: "8px 12px", color: t.textMuted, fontWeight: 600 }}>Default</th>
              <th style={{ textAlign: "left", padding: "8px 12px", color: t.textMuted, fontWeight: 600 }}>Description</th>
            </tr>
          </thead>
          <tbody>
            {params.map(p => (
              <tr key={p.name} style={{ borderBottom: `1px solid ${t.tableBorder}` }}>
                <td style={{ padding: "8px 12px" }}>
                  <code style={{ color: t.link, fontFamily: "monospace" }}>{p.name}</code>
                </td>
                <td style={{ padding: "8px 12px", color: t.tagText }}>{p.type}</td>
                <td style={{ padding: "8px 12px" }}>
                  {p.required ? <span style={{ color: "#ef4444" }}>Yes</span> : <span style={{ color: t.textDim }}>No</span>}
                </td>
                <td style={{ padding: "8px 12px", color: t.textMuted }}>{p.default || "-"}</td>
                <td style={{ padding: "8px 12px", color: t.textSecondary }}>
                  {p.description}
                  {p.options && (
                    <div style={{ marginTop: 4, display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {p.options.map(o => (
                        <span key={o} style={{ fontSize: 10, background: t.optionBg, padding: "1px 6px", borderRadius: 3, color: t.textMuted }}>{o}</span>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ApiDocsPage() {
  const [search, setSearch] = useState("");
  const { category } = useParams<{ category?: string }>();
  const activeCategory = category && API_CATEGORIES.some(c => c.id === category) ? category : API_CATEGORIES[0].id;
  const [, navigate] = useLocation();
  const [openEndpoints, setOpenEndpoints] = useState<Set<string>>(new Set());
  const [activeEndpointKey, setActiveEndpointKey] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [apiKey, setApiKeyRaw] = useState<string | null>(() => {
    if (typeof window !== "undefined") return sessionStorage.getItem("api-docs-key");
    return null;
  });
  const [apiKeyPlan, setApiKeyPlan] = useState<string | null>(() => {
    if (typeof window !== "undefined") return sessionStorage.getItem("api-docs-plan");
    return null;
  });
  const [apiKeyValidated, setApiKeyValidated] = useState(() => !!apiKey);
  const setApiKey = useCallback((key: string | null, plan?: string | null) => {
    setApiKeyRaw(key);
    setApiKeyPlan(plan || null);
    setApiKeyValidated(!!key);
    if (key) {
      sessionStorage.setItem("api-docs-key", key);
      if (plan) sessionStorage.setItem("api-docs-plan", plan);
    } else {
      sessionStorage.removeItem("api-docs-key");
      sessionStorage.removeItem("api-docs-plan");
    }
  }, []);
  const apiKeyCtx = useMemo<ApiKeyState>(() => ({
    key: apiKey,
    plan: apiKeyPlan,
    validated: apiKeyValidated,
    setKey: setApiKey,
  }), [apiKey, apiKeyPlan, apiKeyValidated, setApiKey]);

  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("api-docs-theme") as Theme) || "light";
    }
    return "light";
  });
  const mainRef = useRef<HTMLDivElement>(null);
  const t = THEMES[theme];

  useEffect(() => {
    localStorage.setItem("api-docs-theme", theme);
  }, [theme]);

  const filteredCategories = useMemo(() => {
    if (!search) return API_CATEGORIES;
    const q = search.toLowerCase();
    return API_CATEGORIES.map(cat => ({
      ...cat,
      endpoints: cat.endpoints.filter(ep =>
        ep.path.toLowerCase().includes(q) ||
        ep.summary.toLowerCase().includes(q) ||
        ep.description.toLowerCase().includes(q) ||
        ep.method.toLowerCase().includes(q)
      )
    })).filter(cat => cat.endpoints.length > 0);
  }, [search]);

  const activeEndpoint = useMemo(() => {
    if (!activeEndpointKey) return null;
    for (const cat of API_CATEGORIES) {
      const idx = cat.endpoints.findIndex((_, i) => `${cat.id}-${i}` === activeEndpointKey);
      if (idx !== -1) return cat.endpoints[idx];
    }
    return null;
  }, [activeEndpointKey]);

  const toggleEndpoint = useCallback((key: string) => {
    setOpenEndpoints(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
        setActiveEndpointKey(current => current === key ? null : current);
      } else {
        next.add(key);
        setActiveEndpointKey(key);
      }
      return next;
    });
  }, []);

  const expandAll = useCallback((catId: string) => {
    const cat = filteredCategories.find(c => c.id === catId);
    if (!cat) return;
    setOpenEndpoints(prev => {
      const next = new Set(prev);
      const allOpen = cat.endpoints.every((_, i) => next.has(`${catId}-${i}`));
      if (allOpen) {
        cat.endpoints.forEach((_, i) => next.delete(`${catId}-${i}`));
        setActiveEndpointKey(null);
      } else {
        cat.endpoints.forEach((_, i) => next.add(`${catId}-${i}`));
        setActiveEndpointKey(`${catId}-0`);
      }
      return next;
    });
  }, [filteredCategories]);

  const totalEndpoints = API_CATEGORIES.reduce((sum, c) => sum + c.endpoints.length, 0);

  useEffect(() => {
    const cat = API_CATEGORIES.find(c => c.id === activeCategory);
    document.title = cat ? `${cat.name} - API Documentation - MegaRadio` : "API Documentation - MegaRadio";
  }, [activeCategory]);

  return (
    <ThemeContext.Provider value={t}>
    <ApiKeyContext.Provider value={apiKeyCtx}>
      <div style={{ display: "flex", minHeight: "100vh", background: t.pageBg, color: t.text, fontFamily: "'Inter', 'Segoe UI', sans-serif", transition: "background 0.3s, color 0.3s" }}>
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          style={{
            position: "fixed", top: 16, left: 16, zIndex: 1000, padding: "8px 12px",
            background: t.cardBgOpen, border: `1px solid ${t.cardBorder}`, borderRadius: 6, color: t.heading,
            cursor: "pointer", fontSize: 18, display: "none"
          }}
          className="api-docs-mobile-toggle"
        >
          ☰
        </button>

        <aside
          style={{
            width: 260, minWidth: 260, background: t.sidebarBg, borderRight: `1px solid ${t.sidebarBorder}`,
            overflow: "auto", position: "sticky", top: 0, height: "100vh", padding: "20px 0",
            transition: "transform 0.3s, background 0.3s"
          }}
          className={sidebarOpen ? "api-docs-sidebar-open" : ""}
        >
          <div style={{ padding: "0 16px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <span style={{ fontSize: 24 }}>📻</span>
              <div style={{ flex: 1 }}>
                <h1 style={{ fontSize: 18, fontWeight: 800, margin: 0, color: t.heading }}>MegaRadio API</h1>
                <span style={{ fontSize: 11, color: t.textMuted }}>v1.0 &middot; {totalEndpoints} endpoints</span>
              </div>
              <button
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                style={{
                  padding: "6px 10px", background: t.cardBg, border: `1px solid ${t.cardBorder}`,
                  borderRadius: 6, cursor: "pointer", fontSize: 16, lineHeight: 1,
                  color: t.heading, transition: "background 0.2s"
                }}
                title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
              >
                {theme === "dark" ? "☀️" : "🌙"}
              </button>
            </div>
          </div>

          <div style={{ padding: "0 16px 12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: "#22c55e", background: t.baseUrlBadgeBg, padding: "2px 8px", borderRadius: 4 }}>BASE URL</span>
            </div>
            <code style={{ fontSize: 11, color: t.link, background: t.baseUrlBg, padding: "6px 10px", borderRadius: 4, display: "block", wordBreak: "break-all" }}>
              https://themegaradio.com
            </code>
          </div>

          <div style={{ padding: "0 16px 16px" }}>
            <input
              type="text"
              placeholder="Search endpoints..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                width: "100%", padding: "8px 12px", background: t.inputBg, border: `1px solid ${t.inputBorder}`,
                borderRadius: 6, color: t.text, fontSize: 13, outline: "none", boxSizing: "border-box"
              }}
            />
          </div>

          <nav>
            {filteredCategories.map(cat => (
              <button
                key={cat.id}
                onClick={() => {
                  navigate(`/api-docs/${cat.id}`);
                  setActiveEndpointKey(null);
                  setSidebarOpen(false);
                  mainRef.current?.scrollTo(0, 0);
                }}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 16px",
                  border: "none", background: activeCategory === cat.id ? t.activeNavBg : "transparent",
                  cursor: "pointer", textAlign: "left", borderLeft: activeCategory === cat.id ? `3px solid ${t.activeNavBorder}` : "3px solid transparent",
                  transition: "all 0.15s"
                }}
              >
                <span style={{ fontSize: 18 }}>{cat.icon}</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: activeCategory === cat.id ? 700 : 500, color: activeCategory === cat.id ? t.heading : t.textMuted }}>
                    {cat.name}
                  </div>
                  <div style={{ fontSize: 10, color: t.textDim }}>{cat.endpoints.length} endpoints</div>
                </div>
              </button>
            ))}
          </nav>

          <div style={{ padding: "20px 16px", borderTop: `1px solid ${t.quickInfoBorder}`, marginTop: 16 }}>
            <h3 style={{ fontSize: 12, fontWeight: 700, color: t.textMuted, margin: "0 0 10px 0", textTransform: "uppercase", letterSpacing: 1 }}>Quick Info</h3>
            <div style={{ fontSize: 11, color: t.textDim, lineHeight: 1.8 }}>
              <div><span style={{ color: "#22c55e" }}>●</span> CORS enabled</div>
              <div><span style={{ color: "#f59e0b" }}>●</span> API Key auth</div>
              <div><span style={{ color: "#3b82f6" }}>●</span> JSON responses</div>
              <div><span style={{ color: "#a855f7" }}>●</span> Rate limited</div>
            </div>
          </div>
        </aside>

        <main ref={mainRef} style={{ flex: 1, overflow: "auto", padding: "24px 28px", minWidth: 0 }}>
          {!search && <ApiAccessPanel />}
          {filteredCategories.filter(c => c.id === activeCategory || search).map(cat => (
            <div key={cat.id} style={{ marginBottom: 40 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
                <span style={{ fontSize: 28 }}>{cat.icon}</span>
                <div>
                  <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: t.heading }}>{cat.name}</h2>
                  <p style={{ fontSize: 13, color: t.textMuted, margin: "4px 0 0 0" }}>{cat.description}</p>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 16, marginTop: 12 }}>
                <button
                  onClick={() => expandAll(cat.id)}
                  style={{ padding: "4px 12px", background: t.cardBgOpen, border: `1px solid ${t.cardBorder}`, borderRadius: 4, color: t.textMuted, cursor: "pointer", fontSize: 11 }}
                >
                  Toggle All
                </button>
                <span style={{ fontSize: 11, color: t.textDim, lineHeight: "28px" }}>
                  {cat.endpoints.length} endpoint{cat.endpoints.length !== 1 ? 's' : ''}
                </span>
              </div>

              {cat.endpoints.map((ep, i) => (
                <EndpointCard
                  key={`${cat.id}-${i}`}
                  endpoint={ep}
                  isOpen={openEndpoints.has(`${cat.id}-${i}`)}
                  isActive={activeEndpointKey === `${cat.id}-${i}`}
                  onToggle={() => toggleEndpoint(`${cat.id}-${i}`)}
                />
              ))}
            </div>
          ))}

          {filteredCategories.length === 0 && (
            <div style={{ textAlign: "center", padding: 80, color: t.textDim }}>
              <p style={{ fontSize: 48, margin: 0 }}>🔍</p>
              <p style={{ fontSize: 16, marginTop: 12 }}>No endpoints found for "{search}"</p>
            </div>
          )}

          <div style={{ borderTop: `1px solid ${t.footerBorder}`, paddingTop: 24, marginTop: 40, color: t.textSecondary, fontSize: 12 }}>
            <h3 style={{ color: t.textMuted, fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Authentication Notes</h3>
            <ul style={{ lineHeight: 2, paddingLeft: 20 }}>
              <li><strong style={{ color: t.heading }}>API Key (Recommended):</strong> Include <code style={{ color: t.link }}>X-API-Key: mr_...</code> header or <code style={{ color: t.link }}>Authorization: Bearer mr_...</code> header</li>
              <li>Request your free API key using the panel above or use the demo key for quick testing</li>
              <li>API keys provide rate limiting, usage tracking, and quota management</li>
              <li>Endpoints marked with <span style={{ color: t.authText, background: t.authBg, padding: "1px 6px", borderRadius: 3, fontSize: 10 }}>AUTH</span> require a valid session cookie (user login)</li>
              <li>Login via POST /api/auth/login returns a <code style={{ color: t.link }}>Set-Cookie</code> header with the session ID</li>
              <li>Google OAuth available at GET /api/auth/google (opens consent screen)</li>
            </ul>
            <h3 style={{ color: t.textMuted, fontSize: 14, fontWeight: 700, marginTop: 20, marginBottom: 12 }}>Stream Playback Guide</h3>
            <ol style={{ lineHeight: 2, paddingLeft: 20 }}>
              <li>Get station from <code style={{ color: t.link }}>/api/station/:slug</code></li>
              <li>Resolve URL with <code style={{ color: t.link }}>/api/stream/resolve?url=...</code></li>
              <li>Use <code style={{ color: t.link }}>candidates[0]</code> as stream URL</li>
              <li>HTTPS streams: play directly. HTTP streams: use <code style={{ color: t.link }}>/api/stream/</code> proxy</li>
              <li>For HLS: use <code style={{ color: t.link }}>/api/stream-hls/:stationId</code></li>
            </ol>
            <h3 style={{ color: t.textMuted, fontSize: 14, fontWeight: 700, marginTop: 20, marginBottom: 12 }}>Slim Mode (?tv=1)</h3>
            <p style={{ lineHeight: 1.8 }}>
              Add <code style={{ color: t.link }}>?tv=1</code> to station endpoints for ~47% smaller payloads.
              Removes descriptions, homepage, and other non-essential fields. Ideal for mobile and TV apps.
            </p>
            <ul style={{ lineHeight: 2, paddingLeft: 20, marginTop: 8 }}>
              <li><strong style={{ color: t.heading }}>Auto-add via interceptor:</strong> Set <code style={{ color: t.link }}>config.params = {'{'} ...config.params, tv: 1 {'}'}</code> in your axios interceptor so every request includes tv=1 automatically</li>
              <li><strong style={{ color: t.heading }}>Fields removed:</strong> descriptions, homepage, lastCheckTime, geo coordinates, and other metadata not needed for playback</li>
              <li><strong style={{ color: t.heading }}>Fields kept:</strong> _id, name, slug, url, urlResolved, favicon, logoAssets, country, tags, codec, bitrate, votes, clickCount, hls, lastCheckOk</li>
              <li><strong style={{ color: t.heading }}>Server cache:</strong> tv=1 responses are cached server-side for faster repeated requests</li>
              <li><strong style={{ color: t.heading }}>Works on:</strong> /api/stations, /api/stations/popular, /api/stations/by-genre/:genre, /api/tv/init, and most listing endpoints</li>
            </ul>
            <div style={{ marginTop: 24, textAlign: "center", color: t.textDim }}>
              MegaRadio API Documentation &middot; 40,000+ Radio Stations &middot; 57 Languages
            </div>
          </div>
        </main>

        <div
          className="api-docs-right-panel"
          style={{
            width: 420,
            minWidth: 420,
            background: t.sidebarBg,
            borderLeft: `1px solid ${t.sidebarBorder}`,
            position: "sticky",
            top: 0,
            height: "100vh",
            overflow: "auto",
            transition: "background 0.3s",
          }}
        >
          <RightPanel activeEndpoint={activeEndpoint} />
        </div>

        <style>{`
          @media (max-width: 1200px) {
            .api-docs-right-panel { display: none !important; }
            .api-mobile-live-test { display: block !important; }
            .api-endpoint-summary { max-width: 200px !important; }
          }
          @media (min-width: 1201px) {
            .api-mobile-live-test { display: none !important; }
            .api-endpoint-summary { max-width: 300px !important; }
          }
          @media (max-width: 768px) {
            .api-docs-mobile-toggle { display: block !important; }
            aside { position: fixed !important; z-index: 999; transform: translateX(-100%); }
            .api-docs-sidebar-open { transform: translateX(0) !important; }
            main { padding: 16px 12px !important; }
            .api-mobile-live-test { display: block !important; }
          }
        `}</style>
      </div>
    </ApiKeyContext.Provider>
    </ThemeContext.Provider>
  );
}
