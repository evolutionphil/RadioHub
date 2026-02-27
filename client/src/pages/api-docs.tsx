import { useState, useEffect, useRef, useCallback } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type Plan = "demo" | "free" | "pro";
type SdkLang = "curl" | "js" | "rn" | "swift" | "kotlin";

interface Param {
  name: string;
  type: string;
  required?: boolean;
  default?: string;
  description: string;
  options?: string[];
}

interface CodeExample {
  curl?: string;
  js?: string;
  rn?: string;
  swift?: string;
  kotlin?: string;
}

interface Endpoint {
  id: string;
  method: Method;
  path: string;
  summary: string;
  description: string;
  auth?: boolean;
  params?: Param[];
  queryParams?: Param[];
  bodyParams?: Param[];
  response?: string;
  code?: CodeExample;
}

interface Section {
  id: string;
  label: string;
  icon: string;
  endpoints?: Endpoint[];
  content?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const BASE_URL = "https://themegaradio.com";

const PLANS: Record<Plan, { label: string; color: string; rpm: number; daily: number; monthly: number }> = {
  demo: { label: "Demo", color: "#f97316", rpm: 10, daily: 100, monthly: 500 },
  free: { label: "Free", color: "#3b82f6", rpm: 60, daily: 1000, monthly: 10000 },
  pro: { label: "Pro", color: "#8b5cf6", rpm: 300, daily: 10000, monthly: 100000 },
};

// ─── Method Badge ─────────────────────────────────────────────────────────────
const METHOD_COLORS: Record<Method, string> = {
  GET: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  POST: "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
  PUT: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  PATCH: "bg-violet-50 text-violet-700 ring-1 ring-violet-200",
  DELETE: "bg-red-50 text-red-700 ring-1 ring-red-200",
};

function MethodBadge({ method }: { method: Method }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-semibold tracking-wider ${METHOD_COLORS[method]}`}>
      {method}
    </span>
  );
}

// ─── Copy Button ──────────────────────────────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      onClick={copy}
      className="absolute top-3 right-3 px-2 py-1 rounded text-xs font-medium transition-all duration-200 bg-white/10 hover:bg-white/20 text-white/70 hover:text-white"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

// ─── Code Block ───────────────────────────────────────────────────────────────
function CodeBlock({ code, lang = "bash" }: { code: string; lang?: string }) {
  return (
    <div className="relative group rounded-xl overflow-hidden bg-[#0d1117] border border-white/8">
      <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-white/8 bg-white/4">
        <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
        <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
        <div className="w-3 h-3 rounded-full bg-[#28c840]" />
        <span className="ml-2 text-xs text-white/40 font-mono">{lang}</span>
      </div>
      <div className="relative">
        <pre className="p-4 text-sm font-mono leading-relaxed text-[#e6edf3] overflow-x-auto whitespace-pre">
          <code>{code.trim()}</code>
        </pre>
        <CopyButton text={code.trim()} />
      </div>
    </div>
  );
}

// ─── Multi-language Code Block ────────────────────────────────────────────────
const LANG_LABELS: Record<SdkLang, string> = {
  curl: "cURL",
  js: "JavaScript",
  rn: "React Native",
  swift: "Swift",
  kotlin: "Kotlin",
};

function MultiLangCode({ examples }: { examples: CodeExample }) {
  const langs = (Object.keys(examples) as SdkLang[]).filter(k => examples[k]);
  const [active, setActive] = useState<SdkLang>(langs[0]);

  return (
    <div className="rounded-xl overflow-hidden border border-white/8 bg-[#0d1117]">
      <div className="flex items-center gap-0 border-b border-white/8 bg-white/4 overflow-x-auto">
        <div className="flex items-center gap-1.5 px-4 py-2.5 border-r border-white/8">
          <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
          <div className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
          <div className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
        </div>
        {langs.map(lang => (
          <button
            key={lang}
            onClick={() => setActive(lang)}
            className={`px-4 py-2.5 text-xs font-medium transition-all border-r border-white/8 whitespace-nowrap ${
              active === lang
                ? "text-white bg-white/10"
                : "text-white/50 hover:text-white/80 hover:bg-white/5"
            }`}
          >
            {LANG_LABELS[lang]}
          </button>
        ))}
      </div>
      <div className="relative">
        <pre className="p-4 text-sm font-mono leading-relaxed text-[#e6edf3] overflow-x-auto whitespace-pre">
          <code>{(examples[active] || "").trim()}</code>
        </pre>
        <CopyButton text={(examples[active] || "").trim()} />
      </div>
    </div>
  );
}

// ─── Param Table ──────────────────────────────────────────────────────────────
function ParamTable({ params, title }: { params: Param[]; title: string }) {
  return (
    <div className="mt-5">
      <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">{title}</h4>
      <div className="rounded-xl overflow-hidden border border-gray-100 dark:border-white/8">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-white/4 border-b border-gray-100 dark:border-white/8">
              <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-white/60 w-40">Parameter</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-white/60 w-24">Type</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-white/60 w-20">Required</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-white/60">Description</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-white/6">
            {params.map((p, i) => (
              <tr key={i} className="bg-white dark:bg-transparent hover:bg-gray-50/50 dark:hover:bg-white/4 transition-colors">
                <td className="px-4 py-3">
                  <code className="text-[#0071e3] dark:text-blue-400 font-mono text-xs font-semibold">{p.name}</code>
                </td>
                <td className="px-4 py-3">
                  <span className="font-mono text-xs text-gray-500 dark:text-white/50">{p.type}</span>
                </td>
                <td className="px-4 py-3">
                  {p.required ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-600 ring-1 ring-red-100">Required</span>
                  ) : (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500 dark:bg-white/8 dark:text-white/50">Optional</span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-600 dark:text-white/70">
                  {p.description}
                  {p.default && <span className="ml-2 text-gray-400 dark:text-white/40">Default: <code className="font-mono text-xs">{p.default}</code></span>}
                  {p.options && <span className="ml-2 text-gray-400 dark:text-white/40">Options: <code className="font-mono text-xs">{p.options.join(", ")}</code></span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Endpoint Card ────────────────────────────────────────────────────────────
function EndpointCard({ ep }: { ep: Endpoint }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      id={ep.id}
      className={`rounded-2xl border transition-all duration-300 scroll-mt-20 ${
        open
          ? "border-gray-200 dark:border-white/12 shadow-lg shadow-gray-100/80 dark:shadow-black/20"
          : "border-gray-100 dark:border-white/8 hover:border-gray-200 dark:hover:border-white/12 hover:shadow-md hover:shadow-gray-100/50 dark:hover:shadow-black/10"
      } bg-white dark:bg-[#161b22] overflow-hidden`}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full text-left p-5 flex items-start gap-4"
      >
        <MethodBadge method={ep.method} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <code className="text-[15px] font-mono font-medium text-gray-900 dark:text-white/90">{ep.path}</code>
            {ep.auth && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:ring-amber-800/50">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd"/></svg>
                Auth Required
              </span>
            )}
          </div>
          <p className="mt-1 text-sm font-medium text-gray-700 dark:text-white/60">{ep.summary}</p>
        </div>
        <svg
          className={`w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="px-5 pb-6 space-y-5 border-t border-gray-100 dark:border-white/8 pt-5">
          <p className="text-[15px] text-gray-600 dark:text-white/70 leading-relaxed">{ep.description}</p>

          {ep.params && ep.params.length > 0 && (
            <ParamTable params={ep.params} title="Path Parameters" />
          )}
          {ep.queryParams && ep.queryParams.length > 0 && (
            <ParamTable params={ep.queryParams} title="Query Parameters" />
          )}
          {ep.bodyParams && ep.bodyParams.length > 0 && (
            <ParamTable params={ep.bodyParams} title="Request Body" />
          )}

          {ep.code && (
            <div>
              <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Code Examples</h4>
              <MultiLangCode examples={ep.code} />
            </div>
          )}

          {ep.response && (
            <div>
              <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Response Example</h4>
              <CodeBlock code={ep.response} lang="json" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── All Endpoints Data ────────────────────────────────────────────────────────
const ENDPOINTS: Record<string, Endpoint[]> = {
  stations: [
    {
      id: "stations-list",
      method: "GET",
      path: "/api/stations",
      summary: "List Stations",
      description: "Browse all radio stations with powerful filtering options. Supports full-text search, country, language, genre, codec, and bitrate filters. Returns paginated results with total counts.",
      queryParams: [
        { name: "search", type: "string", description: "Full-text search across name, country, tags" },
        { name: "country", type: "string", description: "Filter by country name or ISO code (e.g. Germany, DE)" },
        { name: "language", type: "string", description: "Filter by language (e.g. english, turkish)" },
        { name: "genre", type: "string", description: "Filter by genre/tag" },
        { name: "codec", type: "string", description: "Filter by audio codec (MP3, AAC, OGG, HLS)" },
        { name: "minBitrate", type: "number", description: "Minimum bitrate in kbps" },
        { name: "page", type: "number", default: "1", description: "Page number" },
        { name: "limit", type: "number", default: "25", description: "Results per page (max 100)" },
        { name: "sort", type: "string", default: "votes", description: "Sort field", options: ["votes", "clickCount", "name", "bitrate"] },
        { name: "tv", type: "string", description: "Slim response mode for TV/mobile", options: ["1"] },
      ],
      code: {
        curl: `curl "${BASE_URL}/api/stations?country=Germany&limit=10&sort=votes" \\
  -H "Authorization: Bearer mr_your_api_key"`,
        js: `const response = await fetch(
  '${BASE_URL}/api/stations?country=Germany&limit=10',
  { headers: { 'Authorization': 'Bearer mr_your_api_key' } }
);
const data = await response.json();
console.log(data.stations);`,
        rn: `import { useState, useEffect } from 'react';

export function useStations(country?: string) {
  const [stations, setStations] = useState([]);

  useEffect(() => {
    const params = new URLSearchParams({ limit: '25' });
    if (country) params.set('country', country);

    fetch(\`${BASE_URL}/api/stations?\${params}\`, {
      headers: { 'Authorization': 'Bearer mr_your_api_key' }
    })
      .then(r => r.json())
      .then(data => setStations(data.stations));
  }, [country]);

  return stations;
}`,
        swift: `import Foundation

struct StationResponse: Codable {
    let stations: [Station]
    let totalCount: Int
    let count: Int
}

func fetchStations(country: String? = nil) async throws -> StationResponse {
    var components = URLComponents(string: "${BASE_URL}/api/stations")!
    var queryItems = [URLQueryItem(name: "limit", value: "25")]
    if let country { queryItems.append(URLQueryItem(name: "country", value: country)) }
    components.queryItems = queryItems

    var request = URLRequest(url: components.url!)
    request.setValue("Bearer mr_your_api_key", forHTTPHeaderField: "Authorization")

    let (data, _) = try await URLSession.shared.data(for: request)
    return try JSONDecoder().decode(StationResponse.self, from: data)
}`,
        kotlin: `import okhttp3.*
import com.google.gson.Gson

data class StationResponse(val stations: List<Station>, val totalCount: Int)

fun fetchStations(country: String? = null): StationResponse {
    val url = HttpUrl.Builder()
        .scheme("https").host("themegaradio.com")
        .addPathSegments("api/stations")
        .addQueryParameter("limit", "25")
        .apply { country?.let { addQueryParameter("country", it) } }
        .build()

    val request = Request.Builder()
        .url(url)
        .header("Authorization", "Bearer mr_your_api_key")
        .build()

    val response = OkHttpClient().newCall(request).execute()
    return Gson().fromJson(response.body?.string(), StationResponse::class.java)
}`,
      },
      response: `{
  "stations": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "name": "Bayern 1",
      "slug": "bayern-1",
      "url": "https://stream.br.de/bayern1/eu/mp3/128/stream.mp3",
      "favicon": "https://example.com/logo.png",
      "logoAssets": { "webp48": "https://cdn.../48.webp", "webp96": "https://cdn.../96.webp" },
      "country": "Germany",
      "language": "german",
      "tags": ["pop", "news", "talk"],
      "codec": "MP3",
      "bitrate": 128,
      "votes": 9421,
      "clickCount": 125000,
      "hls": false,
      "lastCheckOk": true
    }
  ],
  "totalCount": 47904,
  "count": 25,
  "pagination": { "page": 1, "limit": 25, "total": 47904, "pages": 1917 }
}`,
    },
    {
      id: "station-detail",
      method: "GET",
      path: "/api/station/:identifier",
      summary: "Get Station by Slug or ID",
      description: "Retrieve complete station details including multilingual AI-generated descriptions in 57 languages, logo assets, and stream metadata.",
      params: [
        { name: "identifier", type: "string", required: true, description: "Station slug (e.g. bbc-radio-1) or MongoDB ObjectId" },
      ],
      code: {
        curl: `curl "${BASE_URL}/api/station/bbc-radio-1" \\
  -H "Authorization: Bearer mr_your_api_key"`,
        js: `const res = await fetch('${BASE_URL}/api/station/bbc-radio-1', {
  headers: { 'Authorization': 'Bearer mr_your_api_key' }
});
const station = await res.json();
console.log(station.descriptions.en); // English description`,
        swift: `func fetchStation(slug: String) async throws -> Station {
    var request = URLRequest(url: URL(string: "${BASE_URL}/api/station/\\(slug)")!)
    request.setValue("Bearer mr_your_api_key", forHTTPHeaderField: "Authorization")
    let (data, _) = try await URLSession.shared.data(for: request)
    return try JSONDecoder().decode(Station.self, from: data)
}`,
        kotlin: `fun fetchStation(slug: String): Station {
    val request = Request.Builder()
        .url("${BASE_URL}/api/station/${'$'}slug")
        .header("Authorization", "Bearer mr_your_api_key")
        .build()
    val response = OkHttpClient().newCall(request).execute()
    return Gson().fromJson(response.body?.string(), Station::class.java)
}`,
      },
      response: `{
  "_id": "507f1f77bcf86cd799439011",
  "name": "BBC Radio 1",
  "slug": "bbc-radio-1",
  "url": "https://stream.live.vc.bbcmedia.co.uk/bbc_radio_one",
  "favicon": "https://cdn-profiles.tunein.com/s24939/images/logog.png",
  "logoAssets": {
    "webp48": "https://s3.amazonaws.com/.../48.webp",
    "webp96": "https://s3.amazonaws.com/.../96.webp",
    "webp256": "https://s3.amazonaws.com/.../256.webp"
  },
  "country": "United Kingdom",
  "language": "english",
  "tags": ["pop", "rock", "dance"],
  "codec": "MP3",
  "bitrate": 128,
  "votes": 15230,
  "hls": false,
  "lastCheckOk": true,
  "descriptions": {
    "en": "BBC Radio 1 is the UK's number one youth radio station...",
    "tr": "BBC Radio 1, Birleşik Krallık'ın bir numaralı gençlik radyosu...",
    "de": "BBC Radio 1 ist der führende Jugendsender des Vereinigten Königreichs..."
  }
}`,
    },
    {
      id: "stations-popular",
      method: "GET",
      path: "/api/stations/popular",
      summary: "Popular Stations",
      description: "Get top stations by vote count. Supports country filtering with intelligent deduplication and logo-priority sorting.",
      queryParams: [
        { name: "country", type: "string", description: "Country name or ISO code" },
        { name: "limit", type: "number", default: "12", description: "Number of results (max 50)" },
        { name: "excludeBroken", type: "boolean", default: "false", description: "Exclude stations with failed last check" },
        { name: "tv", type: "string", description: "Slim response mode", options: ["1"] },
      ],
      code: {
        curl: `curl "${BASE_URL}/api/stations/popular?country=Turkey&limit=20" \\
  -H "Authorization: Bearer mr_your_api_key"`,
        js: `const res = await fetch('${BASE_URL}/api/stations/popular?country=Turkey', {
  headers: { 'Authorization': 'Bearer mr_your_api_key' }
});
const { stations } = await res.json();`,
      },
      response: `{
  "stations": [...],
  "count": 12,
  "country": "Turkey"
}`,
    },
    {
      id: "stations-precomputed",
      method: "GET",
      path: "/api/stations/precomputed",
      summary: "Precomputed Stations (Ultra-Fast)",
      description: "Pre-sorted, server-cached station lists optimized for instant page loads. Logo-first, vote-sorted. 24-hour cache TTL. Recommended for homepage/browsing use cases.",
      queryParams: [
        { name: "country", type: "string", description: "ISO country code (DE, US, TR, GB...)" },
        { name: "countryName", type: "string", description: "Country name or 'global' for worldwide" },
        { name: "page", type: "number", default: "1", description: "Page number" },
        { name: "limit", type: "number", default: "33", description: "Results per page" },
      ],
      code: {
        curl: `curl "${BASE_URL}/api/stations/precomputed?country=DE&page=1&limit=33" \\
  -H "Authorization: Bearer mr_your_api_key"`,
        js: `const res = await fetch(
  '${BASE_URL}/api/stations/precomputed?country=US&limit=33',
  { headers: { 'Authorization': 'Bearer mr_your_api_key' } }
);
const data = await res.json();`,
      },
      response: `{
  "success": true,
  "data": [...station objects...],
  "total": 1500,
  "page": 1,
  "limit": 33,
  "totalPages": 46,
  "country": "DE"
}`,
    },
    {
      id: "stations-nearby",
      method: "GET",
      path: "/api/stations/nearby",
      summary: "Nearby Stations",
      description: "Discover radio stations near a geographic coordinate. Calculates distance from user's GPS location and returns sorted by proximity.",
      queryParams: [
        { name: "lat", type: "number", required: true, description: "Latitude (-90 to 90)" },
        { name: "lon", type: "number", required: true, description: "Longitude (-180 to 180)" },
        { name: "limit", type: "number", default: "20", description: "Number of results" },
        { name: "radius", type: "number", default: "500", description: "Search radius in km" },
      ],
      code: {
        curl: `curl "${BASE_URL}/api/stations/nearby?lat=48.8566&lon=2.3522&radius=200" \\
  -H "Authorization: Bearer mr_your_api_key"`,
        rn: `import Geolocation from 'react-native-geolocation-service';

function useNearbyStations() {
  const [stations, setStations] = useState([]);

  useEffect(() => {
    Geolocation.getCurrentPosition(
      async ({ coords: { latitude, longitude } }) => {
        const url = \`${BASE_URL}/api/stations/nearby?lat=\${latitude}&lon=\${longitude}&radius=300\`;
        const res = await fetch(url, {
          headers: { 'Authorization': 'Bearer mr_your_api_key' }
        });
        const data = await res.json();
        setStations(data.stations);
      },
      err => console.error(err)
    );
  }, []);

  return stations;
}`,
        swift: `import CoreLocation

func fetchNearbyStations(location: CLLocation) async throws -> [Station] {
    let lat = location.coordinate.latitude
    let lon = location.coordinate.longitude
    let url = URL(string: "${BASE_URL}/api/stations/nearby?lat=\\(lat)&lon=\\(lon)&radius=300")!
    var request = URLRequest(url: url)
    request.setValue("Bearer mr_your_api_key", forHTTPHeaderField: "Authorization")
    let (data, _) = try await URLSession.shared.data(for: request)
    let response = try JSONDecoder().decode(NearbyResponse.self, from: data)
    return response.stations
}`,
        kotlin: `import android.location.Location

fun fetchNearbyStations(location: Location): List<Station> {
    val url = "${BASE_URL}/api/stations/nearby?lat=${'$'}{location.latitude}&lon=${'$'}{location.longitude}&radius=300"
    val request = Request.Builder()
        .url(url)
        .header("Authorization", "Bearer mr_your_api_key")
        .build()
    val response = OkHttpClient().newCall(request).execute()
    return Gson().fromJson(response.body?.string(), Array<Station>::class.java).toList()
}`,
      },
      response: `{
  "stations": [
    {
      "name": "Énergie Paris",
      "slug": "energie-paris",
      "country": "France",
      "distance": 2.4,
      "distanceUnit": "km"
    }
  ],
  "count": 15,
  "searchLocation": { "lat": 48.8566, "lon": 2.3522 }
}`,
    },
    {
      id: "stations-similar",
      method: "GET",
      path: "/api/stations/similar/:id",
      summary: "Similar Stations",
      description: "Find radio stations similar to a given station based on shared tags, country, language, and genre matching.",
      params: [
        { name: "id", type: "string", required: true, description: "Station slug or MongoDB ObjectId" },
      ],
      queryParams: [
        { name: "limit", type: "number", default: "10", description: "Number of similar stations to return" },
      ],
      code: {
        curl: `curl "${BASE_URL}/api/stations/similar/bbc-radio-1?limit=6" \\
  -H "Authorization: Bearer mr_your_api_key"`,
        js: `const res = await fetch('${BASE_URL}/api/stations/similar/bbc-radio-1', {
  headers: { 'Authorization': 'Bearer mr_your_api_key' }
});
const { stations } = await res.json();`,
      },
      response: `{
  "stations": [...],
  "basedOn": { "name": "BBC Radio 1", "tags": ["pop", "rock"] },
  "count": 10
}`,
    },
    {
      id: "stations-random",
      method: "GET",
      path: "/api/stations/country-random",
      summary: "Random Station",
      description: "Get a random radio station from a specific country. Uses MongoDB $sample aggregation for true randomness and high performance.",
      queryParams: [
        { name: "country", type: "string", required: true, description: "Country name or ISO code" },
      ],
      code: {
        curl: `curl "${BASE_URL}/api/stations/country-random?country=Japan" \\
  -H "Authorization: Bearer mr_your_api_key"`,
        js: `const res = await fetch('${BASE_URL}/api/stations/country-random?country=Japan', {
  headers: { 'Authorization': 'Bearer mr_your_api_key' }
});
const station = await res.json();`,
      },
      response: `{
  "name": "FM Yokohama 84.7",
  "slug": "fm-yokohama-847",
  "country": "Japan",
  "url": "https://...",
  "votes": 3241
}`,
    },
    {
      id: "stations-stats",
      method: "GET",
      path: "/api/stations/stats",
      summary: "Platform Statistics",
      description: "Get aggregated platform statistics including total station counts by country, language, and genre.",
      code: {
        curl: `curl "${BASE_URL}/api/stations/stats" \\
  -H "Authorization: Bearer mr_your_api_key"`,
        js: `const res = await fetch('${BASE_URL}/api/stations/stats', {
  headers: { 'Authorization': 'Bearer mr_your_api_key' }
});
const stats = await res.json();`,
      },
      response: `{
  "totalStations": 47904,
  "totalCountries": 196,
  "totalLanguages": 120,
  "totalGenres": 350,
  "activeStations": 42108,
  "stationsWithLogos": 18500
}`,
    },
  ],

  genres: [
    {
      id: "genres-list",
      method: "GET",
      path: "/api/genres",
      summary: "List All Genres",
      description: "Get all music genres available on the platform with station counts per country. Supports country filtering and translation.",
      queryParams: [
        { name: "country", type: "string", description: "Filter genres by country (only genres with stations in that country)" },
        { name: "lang", type: "string", description: "Language code for translated genre names" },
        { name: "limit", type: "number", default: "100", description: "Maximum number of genres" },
      ],
      code: {
        curl: `curl "${BASE_URL}/api/genres?country=France&lang=fr"`,
        js: `const res = await fetch('${BASE_URL}/api/genres?country=Germany');
const { genres } = await res.json();`,
      },
      response: `{
  "genres": [
    { "_id": "507f...", "name": "Pop", "slug": "pop", "stationCount": 4521 },
    { "_id": "507f...", "name": "Rock", "slug": "rock", "stationCount": 3214 }
  ],
  "count": 350
}`,
    },
    {
      id: "genres-discoverable",
      method: "GET",
      path: "/api/genres/discoverable",
      summary: "Discoverable Genres",
      description: "Get genres that have enough stations to be worth browsing. Filters out genres with fewer than a threshold of stations.",
      queryParams: [
        { name: "country", type: "string", description: "Country filter" },
        { name: "minStations", type: "number", default: "5", description: "Minimum station count" },
      ],
      code: {
        curl: `curl "${BASE_URL}/api/genres/discoverable?minStations=10"`,
      },
      response: `{
  "genres": [...],
  "count": 120
}`,
    },
    {
      id: "countries-list",
      method: "GET",
      path: "/api/countries",
      summary: "List Countries",
      description: "Get all countries available on the platform with station counts and metadata.",
      code: {
        curl: `curl "${BASE_URL}/api/countries"`,
        js: `const res = await fetch('${BASE_URL}/api/countries');
const { countries } = await res.json();`,
      },
      response: `{
  "countries": [
    {
      "_id": "507f...",
      "name": "Germany",
      "code": "DE",
      "stationCount": 3240,
      "flag": "🇩🇪"
    }
  ],
  "count": 196
}`,
    },
  ],

  auth: [
    {
      id: "auth-login",
      method: "POST",
      path: "/api/auth/login",
      summary: "Web Login",
      description: "Authenticate with email and password. Returns session cookie for web browsers. For mobile apps, use /api/auth/mobile/login to get a Bearer token.",
      bodyParams: [
        { name: "email", type: "string", required: true, description: "User email address" },
        { name: "password", type: "string", required: true, description: "Password (min 8 characters)" },
        { name: "rememberMe", type: "boolean", description: "Extend session to 30 days" },
      ],
      code: {
        curl: `curl -X POST "${BASE_URL}/api/auth/login" \\
  -H "Content-Type: application/json" \\
  -d '{"email":"user@example.com","password":"your_password"}'`,
        js: `const res = await fetch('${BASE_URL}/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify({ email: 'user@example.com', password: 'your_password' })
});
const user = await res.json();`,
      },
      response: `{
  "authenticated": true,
  "user": {
    "_id": "507f...",
    "email": "user@example.com",
    "username": "johndoe",
    "avatar": "https://..."
  }
}`,
    },
    {
      id: "auth-mobile-login",
      method: "POST",
      path: "/api/auth/mobile/login",
      summary: "Mobile Login (Bearer Token)",
      description: "Authenticate from a mobile or TV app. Returns a persistent Bearer token with `mrt_` prefix. Store this token securely — it's valid for 90 days.",
      bodyParams: [
        { name: "email", type: "string", required: true, description: "User email address" },
        { name: "password", type: "string", required: true, description: "Password" },
        { name: "deviceName", type: "string", description: "Human-readable device name (e.g. iPhone 15 Pro)" },
        { name: "platform", type: "string", description: "Platform identifier", options: ["ios", "android", "tv"] },
      ],
      code: {
        curl: `curl -X POST "${BASE_URL}/api/auth/mobile/login" \\
  -H "Content-Type: application/json" \\
  -d '{"email":"user@example.com","password":"pass","platform":"ios","deviceName":"iPhone 15"}'`,
        rn: `import AsyncStorage from '@react-native-async-storage/async-storage';

async function loginUser(email: string, password: string) {
  const res = await fetch('${BASE_URL}/api/auth/mobile/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      platform: Platform.OS,
      deviceName: DeviceInfo.getDeviceNameSync()
    })
  });

  const data = await res.json();
  if (data.token) {
    // Store token securely
    await AsyncStorage.setItem('mrt_token', data.token);
  }
  return data;
}`,
        swift: `import Foundation
import KeychainSwift

struct LoginResponse: Codable {
    let token: String
    let user: User
}

func mobileLogin(email: String, password: String) async throws -> LoginResponse {
    let url = URL(string: "${BASE_URL}/api/auth/mobile/login")!
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONSerialization.data(withJSONObject: [
        "email": email,
        "password": password,
        "platform": "ios",
        "deviceName": UIDevice.current.name
    ])

    let (data, _) = try await URLSession.shared.data(for: request)
    let response = try JSONDecoder().decode(LoginResponse.self, from: data)

    // Store securely in Keychain
    let keychain = KeychainSwift()
    keychain.set(response.token, forKey: "mrt_token")

    return response
}`,
        kotlin: `import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences

fun mobileLogin(context: Context, email: String, password: String): LoginResponse {
    val body = JSONObject().apply {
        put("email", email); put("password", password)
        put("platform", "android"); put("deviceName", Build.MODEL)
    }
    val request = Request.Builder()
        .url("${BASE_URL}/api/auth/mobile/login")
        .post(body.toString().toRequestBody("application/json".toMediaType()))
        .build()

    val response = OkHttpClient().newCall(request).execute()
    val loginResponse = Gson().fromJson(response.body?.string(), LoginResponse::class.java)

    // Store securely in EncryptedSharedPreferences
    getEncryptedPrefs(context).edit()
        .putString("mrt_token", loginResponse.token).apply()

    return loginResponse
}`,
      },
      response: `{
  "token": "mrt_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890",
  "user": {
    "_id": "507f...",
    "email": "user@example.com",
    "username": "johndoe",
    "avatar": "https://..."
  },
  "expiresAt": "2025-07-01T00:00:00.000Z"
}`,
    },
    {
      id: "auth-signup",
      method: "POST",
      path: "/api/auth/signup",
      summary: "Register Account",
      description: "Create a new user account. Username must be 3-30 characters (alphanumeric, dash, dot, underscore). Email is normalized and validated.",
      bodyParams: [
        { name: "email", type: "string", required: true, description: "Valid email address" },
        { name: "password", type: "string", required: true, description: "Password (min 8 characters)" },
        { name: "username", type: "string", required: true, description: "Username (3-30 chars, alphanumeric/-/_/.)" },
      ],
      code: {
        curl: `curl -X POST "${BASE_URL}/api/auth/signup" \\
  -H "Content-Type: application/json" \\
  -d '{"email":"new@example.com","password":"securepass123","username":"johndoe"}'`,
        js: `const res = await fetch('${BASE_URL}/api/auth/signup', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'new@example.com',
    password: 'securepass123',
    username: 'johndoe'
  })
});
const data = await res.json();`,
      },
      response: `{
  "authenticated": true,
  "user": {
    "_id": "507f...",
    "email": "new@example.com",
    "username": "johndoe"
  }
}`,
    },
    {
      id: "auth-me",
      method: "GET",
      path: "/api/auth/me",
      summary: "Get Current User",
      description: "Returns the authenticated user's profile. Works with both session cookies (web) and Bearer tokens (mobile).",
      auth: true,
      code: {
        curl: `curl "${BASE_URL}/api/auth/me" \\
  -H "Authorization: Bearer mrt_your_token"`,
        rn: `async function getMe(token: string) {
  const res = await fetch('${BASE_URL}/api/auth/me', {
    headers: { 'Authorization': \`Bearer \${token}\` }
  });
  return res.json();
}`,
        swift: `func getMe(token: String) async throws -> User {
    var request = URLRequest(url: URL(string: "${BASE_URL}/api/auth/me")!)
    request.setValue("Bearer \\(token)", forHTTPHeaderField: "Authorization")
    let (data, _) = try await URLSession.shared.data(for: request)
    return try JSONDecoder().decode(AuthResponse.self, from: data).user
}`,
      },
      response: `{
  "authenticated": true,
  "user": {
    "_id": "507f...",
    "email": "user@example.com",
    "username": "johndoe",
    "avatar": "https://...",
    "role": "user",
    "createdAt": "2024-01-15T12:00:00.000Z"
  }
}`,
    },
    {
      id: "auth-mobile-me",
      method: "GET",
      path: "/api/auth/mobile/me",
      summary: "Get Mobile Auth Status",
      description: "Check if a mobile Bearer token is still valid and get the associated user profile. Includes device information.",
      auth: true,
      code: {
        curl: `curl "${BASE_URL}/api/auth/mobile/me" \\
  -H "Authorization: Bearer mrt_your_token"`,
        rn: `async function checkAuth(token: string) {
  const res = await fetch('${BASE_URL}/api/auth/mobile/me', {
    headers: { 'Authorization': \`Bearer \${token}\` }
  });
  if (!res.ok) {
    // Token expired — redirect to login
    await AsyncStorage.removeItem('mrt_token');
    return null;
  }
  return res.json();
}`,
      },
      response: `{
  "valid": true,
  "user": { "_id": "507f...", "username": "johndoe" },
  "token": { "expiresAt": "2025-07-01T00:00:00.000Z", "deviceName": "iPhone 15" }
}`,
    },
  ],

  engagement: [
    {
      id: "engagement-favorite",
      method: "POST",
      path: "/api/user-engagement/stations/:stationId/favorite",
      summary: "Favorite / Unfavorite Station",
      description: "Toggle a station as a user favorite. Calling this endpoint on an already-favorited station will remove it (toggle behavior).",
      auth: true,
      params: [
        { name: "stationId", type: "string", required: true, description: "Station MongoDB ObjectId" },
      ],
      code: {
        curl: `curl -X POST "${BASE_URL}/api/user-engagement/stations/507f1f77bcf86cd799439011/favorite" \\
  -H "Authorization: Bearer mrt_your_token"`,
        rn: `async function toggleFavorite(stationId: string, token: string) {
  const res = await fetch(
    \`${BASE_URL}/api/user-engagement/stations/\${stationId}/favorite\`,
    {
      method: 'POST',
      headers: { 'Authorization': \`Bearer \${token}\` }
    }
  );
  return res.json(); // { favorited: true } or { favorited: false }
}`,
      },
      response: `{
  "favorited": true,
  "stationId": "507f1f77bcf86cd799439011"
}`,
    },
    {
      id: "engagement-rate",
      method: "POST",
      path: "/api/user-engagement/stations/:stationId/rate",
      summary: "Rate a Station",
      description: "Submit a 1-5 star rating for a radio station. Only one rating per user per station — submitting again updates the existing rating.",
      auth: true,
      params: [
        { name: "stationId", type: "string", required: true, description: "Station MongoDB ObjectId" },
      ],
      bodyParams: [
        { name: "rating", type: "number", required: true, description: "Rating from 1 to 5" },
        { name: "review", type: "string", description: "Optional text review" },
      ],
      code: {
        curl: `curl -X POST "${BASE_URL}/api/user-engagement/stations/507f.../rate" \\
  -H "Authorization: Bearer mrt_your_token" \\
  -H "Content-Type: application/json" \\
  -d '{"rating": 5, "review": "Amazing station!"}'`,
      },
      response: `{
  "success": true,
  "rating": 5,
  "averageRating": 4.7,
  "totalRatings": 1204
}`,
    },
    {
      id: "engagement-trending",
      method: "GET",
      path: "/api/user-engagement/trending",
      summary: "Trending Stations",
      description: "Get trending stations based on real user favorites and listening data. Powered by authentic engagement metrics.",
      queryParams: [
        { name: "limit", type: "number", default: "20", description: "Number of trending stations" },
        { name: "country", type: "string", description: "Filter by country" },
      ],
      code: {
        curl: `curl "${BASE_URL}/api/user-engagement/trending?limit=10"`,
        js: `const res = await fetch('${BASE_URL}/api/user-engagement/trending?limit=10');
const { stations } = await res.json();`,
      },
      response: `{
  "stations": [
    {
      "_id": "507f...",
      "name": "TRT FM",
      "slug": "trt-fm",
      "trendingScore": 9.4,
      "weeklyFavorites": 1203,
      "totalFavorites": 45210
    }
  ],
  "count": 10
}`,
    },
    {
      id: "engagement-profile",
      method: "GET",
      path: "/api/user-engagement/profile/:slug",
      summary: "User Profile",
      description: "Get a user's public profile including follower/following counts and biography.",
      params: [
        { name: "slug", type: "string", required: true, description: "Username or user ID" },
      ],
      code: {
        curl: `curl "${BASE_URL}/api/user-engagement/profile/johndoe"`,
      },
      response: `{
  "user": {
    "username": "johndoe",
    "avatar": "https://...",
    "bio": "Radio enthusiast",
    "followersCount": 142,
    "followingCount": 87,
    "isPublic": true
  }
}`,
    },
  ],

  tv: [
    {
      id: "tv-request-code",
      method: "POST",
      path: "/api/auth/tv/code",
      summary: "Request TV Login Code",
      description: "Netflix/YouTube-style TV login. TV app requests a 6-digit code, displays it on screen, and user enters it on mobile to authenticate.",
      bodyParams: [
        { name: "deviceId", type: "string", required: true, description: "Unique TV device identifier" },
        { name: "deviceName", type: "string", description: "Human-readable TV name (e.g. Living Room Fire TV)" },
      ],
      code: {
        curl: `curl -X POST "${BASE_URL}/api/auth/tv/code" \\
  -H "Content-Type: application/json" \\
  -d '{"deviceId":"tv-unique-uuid","deviceName":"Living Room TV"}'`,
        kotlin: `fun requestTVCode(deviceId: String): TVCodeResponse {
    val body = JSONObject().apply {
        put("deviceId", deviceId)
        put("deviceName", "${'{'}android.os.Build.MODEL${'}'}")
    }.toString().toRequestBody("application/json".toMediaType())

    val request = Request.Builder()
        .url("${BASE_URL}/api/auth/tv/code")
        .post(body)
        .build()

    val response = OkHttpClient().newCall(request).execute()
    return Gson().fromJson(response.body?.string(), TVCodeResponse::class.java)
}

// TVCodeResponse:
data class TVCodeResponse(val code: String, val expiresIn: Int)
// Display code on screen, poll /api/auth/tv/code/{code}/status every 3s`,
        swift: `func requestTVCode(deviceId: String) async throws -> TVCodeResponse {
    let url = URL(string: "${BASE_URL}/api/auth/tv/code")!
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONSerialization.data(withJSONObject: [
        "deviceId": deviceId,
        "deviceName": UIDevice.current.name
    ])
    let (data, _) = try await URLSession.shared.data(for: request)
    return try JSONDecoder().decode(TVCodeResponse.self, from: data)
}

// Then display the code and poll status every 3 seconds`,
      },
      response: `{
  "code": "847392",
  "expiresIn": 600,
  "message": "Display this code on your TV screen. Go to themegaradio.com/tv on mobile to activate."
}`,
    },
    {
      id: "tv-code-status",
      method: "GET",
      path: "/api/auth/tv/code/:code/status",
      summary: "Poll TV Code Status",
      description: "TV app polls this every 3 seconds to check if the user has entered the code on their mobile. Once activated, returns a long-lived Bearer token.",
      params: [
        { name: "code", type: "string", required: true, description: "6-digit TV login code" },
      ],
      code: {
        curl: `curl "${BASE_URL}/api/auth/tv/code/847392/status"`,
        kotlin: `// Poll every 3 seconds
fun pollTVCodeStatus(code: String): TVStatusResponse {
    val request = Request.Builder()
        .url("${BASE_URL}/api/auth/tv/code/${'$'}code/status")
        .build()
    val response = OkHttpClient().newCall(request).execute()
    return Gson().fromJson(response.body?.string(), TVStatusResponse::class.java)
}

// TVStatusResponse:
data class TVStatusResponse(
    val status: String, // "pending" | "activated" | "expired"
    val token: String?, // mrt_tv_ token if activated
    val user: User?
)`,
      },
      response: `// Pending:
{ "status": "pending" }

// Activated:
{
  "status": "activated",
  "token": "mrt_tv_AbCdEfGhIjKlMnOpQrStUv...",
  "user": { "_id": "507f...", "username": "johndoe" }
}

// Expired:
{ "status": "expired" }`,
    },
    {
      id: "tv-activate",
      method: "POST",
      path: "/api/auth/tv/activate",
      summary: "Activate TV Code (Mobile)",
      description: "Mobile app activates a TV login code on behalf of the authenticated user. After this, the TV's polling will receive the token.",
      auth: true,
      bodyParams: [
        { name: "code", type: "string", required: true, description: "6-digit code shown on TV" },
      ],
      code: {
        curl: `curl -X POST "${BASE_URL}/api/auth/tv/activate" \\
  -H "Authorization: Bearer mrt_your_mobile_token" \\
  -H "Content-Type: application/json" \\
  -d '{"code":"847392"}'`,
        rn: `async function activateTVCode(code: string, token: string) {
  const res = await fetch('${BASE_URL}/api/auth/tv/activate', {
    method: 'POST',
    headers: {
      'Authorization': \`Bearer \${token}\`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ code })
  });
  return res.json(); // { success: true }
}`,
      },
      response: `{ "success": true, "message": "TV device authenticated successfully" }`,
    },
  ],

  cast: [
    {
      id: "cast-create",
      method: "POST",
      path: "/api/cast/session/create",
      summary: "Create Cast Session",
      description: "Create a new casting session for Chromecast or AirPlay. Returns a sessionId that mobile and receiver apps use to exchange commands. Google Cast App ID: 94952E1F",
      bodyParams: [
        { name: "deviceId", type: "string", required: true, description: "Unique device identifier (mobile)" },
        { name: "deviceName", type: "string", description: "Human-readable device name" },
      ],
      code: {
        curl: `curl -X POST "${BASE_URL}/api/cast/session/create" \\
  -H "Content-Type: application/json" \\
  -d '{"deviceId":"mobile-uuid","deviceName":"My iPhone"}'`,
        rn: `async function createCastSession(deviceId: string) {
  const res = await fetch('${BASE_URL}/api/cast/session/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, deviceName: 'My Phone' })
  });
  const { sessionId } = await res.json();
  return sessionId; // Use for pairing and commands
}`,
      },
      response: `{
  "sessionId": "sess_AbCdEfGh",
  "pairingCode": "4829",
  "expiresAt": "2025-01-15T13:30:00.000Z"
}`,
    },
    {
      id: "cast-command",
      method: "POST",
      path: "/api/cast/command",
      summary: "Send Cast Command",
      description: "Send a playback command to a paired cast receiver. Commands are relayed in real-time via WebSocket.",
      bodyParams: [
        { name: "sessionId", type: "string", required: true, description: "Active cast session ID" },
        { name: "command", type: "string", required: true, description: "Command type", options: ["play", "pause", "stop", "volume", "seek"] },
        { name: "stationId", type: "string", description: "Station ID (for play command)" },
        { name: "volume", type: "number", description: "Volume 0-100 (for volume command)" },
      ],
      code: {
        curl: `curl -X POST "${BASE_URL}/api/cast/command" \\
  -H "Content-Type: application/json" \\
  -d '{"sessionId":"sess_AbCdEfGh","command":"play","stationId":"507f..."}'`,
      },
      response: `{ "success": true, "delivered": true }`,
    },
  ],
};

// ─── SDK Section Content ───────────────────────────────────────────────────────
const SDK_EXAMPLES = {
  web: {
    install: `npm install @megaradio/sdk  # coming soon
# OR use the REST API directly with fetch/axios`,
    quickstart: `// Quick Start — no SDK needed, pure REST
const BASE_URL = '${BASE_URL}';
const API_KEY = 'mr_your_api_key';

const headers = { 'Authorization': \`Bearer \${API_KEY}\` };

// 1. Fetch popular stations
const res = await fetch(\`\${BASE_URL}/api/stations/popular?country=Germany\`, { headers });
const { stations } = await res.json();

// 2. Get a station by slug
const station = await fetch(\`\${BASE_URL}/api/station/bbc-radio-1\`, { headers }).then(r => r.json());

// 3. Stream it (just use the URL directly in an <audio> element)
const audio = new Audio(station.url);
audio.play();`,
    hls: `import Hls from 'hls.js';

function playStation(station) {
  const audio = document.getElementById('player');

  if (station.hls || station.url.includes('.m3u8')) {
    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(station.url);
      hls.attachMedia(audio);
      hls.on(Hls.Events.MANIFEST_PARSED, () => audio.play());
    } else if (audio.canPlayType('application/vnd.apple.mpegurl')) {
      audio.src = station.url;
      audio.play();
    }
  } else {
    audio.src = station.url;
    audio.play();
  }
}`,
  },
  rn: {
    install: `# Install required packages
npm install react-native-track-player
npm install @react-native-async-storage/async-storage
npm install react-native-geolocation-service

# iOS
cd ios && pod install`,
    setup: `// megaradio.ts — API client setup
const BASE_URL = '${BASE_URL}';

class MegaRadioClient {
  private token: string | null = null;

  constructor(private apiKey: string) {}

  setAuthToken(token: string) { this.token = token; }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Authorization': \`Bearer \${this.apiKey}\` };
    if (this.token) h['X-User-Token'] = this.token;
    return h;
  }

  async getStations(params?: { country?: string; limit?: number; search?: string }) {
    const qs = new URLSearchParams(params as Record<string, string> || {}).toString();
    const res = await fetch(\`\${BASE_URL}/api/stations?\${qs}\`, { headers: this.headers() });
    return res.json();
  }

  async getStation(slug: string) {
    const res = await fetch(\`\${BASE_URL}/api/station/\${slug}\`, { headers: this.headers() });
    return res.json();
  }

  async getPopular(country?: string) {
    const qs = country ? \`?country=\${encodeURIComponent(country)}\` : '';
    const res = await fetch(\`\${BASE_URL}/api/stations/popular\${qs}\`, { headers: this.headers() });
    return res.json();
  }

  async login(email: string, password: string, platform = 'react-native') {
    const res = await fetch(\`\${BASE_URL}/api/auth/mobile/login\`, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, platform })
    });
    const data = await res.json();
    if (data.token) this.setAuthToken(data.token);
    return data;
  }
}

export const megaRadio = new MegaRadioClient('mr_your_api_key');`,
    player: `import TrackPlayer, { State, usePlaybackState } from 'react-native-track-player';

// Setup player once at app launch
export async function setupPlayer() {
  await TrackPlayer.setupPlayer({
    maxCacheSize: 1024 * 5, // 5MB buffer
  });

  await TrackPlayer.updateOptions({
    capabilities: [
      TrackPlayer.CAPABILITY_PLAY,
      TrackPlayer.CAPABILITY_PAUSE,
      TrackPlayer.CAPABILITY_STOP,
    ],
  });
}

// Play a MegaRadio station
export async function playStation(station: any) {
  await TrackPlayer.reset();
  await TrackPlayer.add({
    id: station.slug,
    url: station.url,
    title: station.name,
    artist: station.country,
    artwork: station.logoAssets?.webp256 || station.favicon,
    isLiveStream: true,
  });
  await TrackPlayer.play();
}

// Usage in component:
function PlayerButton({ station }) {
  const state = usePlaybackState();
  const isPlaying = state === State.Playing;

  return (
    <TouchableOpacity onPress={() => isPlaying ? TrackPlayer.pause() : playStation(station)}>
      <Text>{isPlaying ? '⏸ Pause' : '▶ Play'}</Text>
    </TouchableOpacity>
  );
}`,
  },
  ios: {
    setup: `// MegaRadioAPI.swift
import Foundation

struct MegaRadioAPI {
    static let baseURL = "${BASE_URL}"
    static var apiKey = "mr_your_api_key"
    static var userToken: String?

    private static var headers: [String: String] {
        var h = ["Authorization": "Bearer \\(apiKey)"]
        if let token = userToken { h["X-User-Token"] = token }
        return h
    }

    static func stations(country: String? = nil, limit: Int = 25) async throws -> StationResponse {
        var components = URLComponents(string: "\\(baseURL)/api/stations")!
        var items = [URLQueryItem(name: "limit", value: "\\(limit)")]
        if let c = country { items.append(URLQueryItem(name: "country", value: c)) }
        components.queryItems = items

        var request = URLRequest(url: components.url!)
        headers.forEach { request.setValue($1, forHTTPHeaderField: $0) }

        let (data, _) = try await URLSession.shared.data(for: request)
        return try JSONDecoder().decode(StationResponse.self, from: data)
    }

    static func station(slug: String) async throws -> Station {
        var request = URLRequest(url: URL(string: "\\(baseURL)/api/station/\\(slug)")!)
        headers.forEach { request.setValue($1, forHTTPHeaderField: $0) }
        let (data, _) = try await URLSession.shared.data(for: request)
        return try JSONDecoder().decode(Station.self, from: data)
    }
}`,
    player: `// RadioPlayer.swift — AVFoundation streaming
import AVFoundation

class RadioPlayer: ObservableObject {
    private var player: AVPlayer?
    private var playerItem: AVPlayerItem?
    @Published var isPlaying = false
    @Published var currentStation: Station?

    func play(_ station: Station) {
        guard let url = URL(string: station.url) else { return }
        currentStation = station

        // Configure audio session for background playback
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
        try? AVAudioSession.sharedInstance().setActive(true)

        playerItem = AVPlayerItem(url: url)
        player = AVPlayer(playerItem: playerItem)
        player?.play()
        isPlaying = true

        // Now Playing Info Center
        var info = [String: Any]()
        info[MPMediaItemPropertyTitle] = station.name
        info[MPMediaItemPropertyArtist] = station.country
        info[MPNowPlayingInfoPropertyIsLiveStream] = true
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    func pause() { player?.pause(); isPlaying = false }
    func stop() { player?.replaceCurrentItem(with: nil); isPlaying = false; currentStation = nil }
}

// SwiftUI usage:
struct PlayerView: View {
    @StateObject var player = RadioPlayer()
    let station: Station

    var body: some View {
        Button(player.isPlaying ? "Pause" : "Play") {
            player.isPlaying ? player.pause() : player.play(station)
        }
    }
}`,
  },
  android: {
    setup: `// build.gradle (app)
dependencies {
    implementation 'com.squareup.okhttp3:okhttp:4.12.0'
    implementation 'com.google.code.gson:gson:2.10.1'
    implementation 'androidx.media3:media3-exoplayer:1.2.0'
    implementation 'androidx.media3:media3-exoplayer-hls:1.2.0'
    implementation 'androidx.media3:media3-ui:1.2.0'
}`,
    api: `// MegaRadioAPI.kt
import okhttp3.*
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken

object MegaRadioAPI {
    private const val BASE_URL = "${BASE_URL}"
    var apiKey = "mr_your_api_key"
    var userToken: String? = null

    private val client = OkHttpClient.Builder().build()
    private val gson = Gson()

    private fun headers() = Headers.Builder().apply {
        add("Authorization", "Bearer ${'$'}apiKey")
        userToken?.let { add("X-User-Token", it) }
    }.build()

    suspend fun getStations(country: String? = null, limit: Int = 25): StationResponse {
        val url = HttpUrl.Builder()
            .scheme("https").host("themegaradio.com")
            .addPathSegments("api/stations")
            .addQueryParameter("limit", limit.toString())
            .apply { country?.let { addQueryParameter("country", it) } }
            .build()

        val request = Request.Builder().url(url).headers(headers()).build()

        return withContext(Dispatchers.IO) {
            client.newCall(request).execute().use { response ->
                gson.fromJson(response.body?.charStream(), StationResponse::class.java)
            }
        }
    }

    suspend fun getStation(slug: String): Station {
        val request = Request.Builder()
            .url("${'$'}BASE_URL/api/station/${'$'}slug")
            .headers(headers()).build()

        return withContext(Dispatchers.IO) {
            client.newCall(request).execute().use { response ->
                gson.fromJson(response.body?.charStream(), Station::class.java)
            }
        }
    }
}`,
    player: `// RadioPlayerService.kt — ExoPlayer + MediaSession
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata

class RadioPlayerService : MediaSessionService() {
    private lateinit var player: ExoPlayer

    override fun onCreate() {
        super.onCreate()
        player = ExoPlayer.Builder(this).build()
    }

    fun playStation(station: Station) {
        val mediaItem = MediaItem.Builder()
            .setUri(station.url)
            .setMediaMetadata(
                MediaMetadata.Builder()
                    .setTitle(station.name)
                    .setArtist(station.country)
                    .setIsPlayable(true)
                    .build()
            )
            .build()

        player.setMediaItem(mediaItem)
        player.prepare()
        player.play()
    }

    fun pause() = player.pause()
    fun stop() = player.stop()

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo) = mediaSession
    override fun onDestroy() { player.release(); super.onDestroy() }
}`,
  },
};

// ─── Navigation Data ───────────────────────────────────────────────────────────
const NAV_SECTIONS = [
  { id: "introduction", label: "Introduction", icon: "⬡" },
  { id: "authentication", label: "Authentication", icon: "🔐" },
  { id: "rate-limits", label: "Rate Limits", icon: "⚡" },
  {
    id: "stations", label: "Stations", icon: "📻",
    children: [
      { id: "stations-list", label: "List Stations" },
      { id: "station-detail", label: "Get Station" },
      { id: "stations-popular", label: "Popular" },
      { id: "stations-precomputed", label: "Precomputed (Fast)" },
      { id: "stations-nearby", label: "Nearby" },
      { id: "stations-similar", label: "Similar" },
      { id: "stations-random", label: "Random" },
      { id: "stations-stats", label: "Statistics" },
    ]
  },
  {
    id: "genres", label: "Genres & Countries", icon: "🌍",
    children: [
      { id: "genres-list", label: "List Genres" },
      { id: "genres-discoverable", label: "Discoverable Genres" },
      { id: "countries-list", label: "Countries" },
    ]
  },
  {
    id: "auth", label: "User Auth", icon: "👤",
    children: [
      { id: "auth-login", label: "Web Login" },
      { id: "auth-mobile-login", label: "Mobile Login" },
      { id: "auth-signup", label: "Register" },
      { id: "auth-me", label: "Current User" },
      { id: "auth-mobile-me", label: "Token Status" },
    ]
  },
  {
    id: "engagement", label: "Engagement", icon: "❤️",
    children: [
      { id: "engagement-favorite", label: "Favorite Station" },
      { id: "engagement-rate", label: "Rate Station" },
      { id: "engagement-trending", label: "Trending" },
      { id: "engagement-profile", label: "User Profile" },
    ]
  },
  {
    id: "tv", label: "TV Auth", icon: "📺",
    children: [
      { id: "tv-request-code", label: "Request Code" },
      { id: "tv-code-status", label: "Poll Status" },
      { id: "tv-activate", label: "Activate (Mobile)" },
    ]
  },
  {
    id: "cast", label: "Chromecast", icon: "🎬",
    children: [
      { id: "cast-create", label: "Create Session" },
      { id: "cast-command", label: "Send Command" },
    ]
  },
  { id: "sdk-web", label: "Web / JS Guide", icon: "🌐" },
  { id: "sdk-rn", label: "React Native", icon: "📱" },
  { id: "sdk-ios", label: "iOS (Swift)", icon: "" },
  { id: "sdk-android", label: "Android (Kotlin)", icon: "🤖" },
];

// ─── Main Component ────────────────────────────────────────────────────────────
export default function ApiDocs() {
  const [dark, setDark] = useState(true);
  const [activeSection, setActiveSection] = useState("introduction");
  const [searchQuery, setSearchQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(["stations", "genres", "auth", "engagement", "tv", "cast"])
  );
  const contentRef = useRef<HTMLDivElement>(null);

  const toggleSection = (id: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const scrollTo = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveSection(id);
      setSidebarOpen(false);
    }
  }, []);

  // Filter nav items by search
  const filteredNav = searchQuery
    ? NAV_SECTIONS.filter(s =>
        s.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (s as any).children?.some((c: any) => c.label.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : NAV_SECTIONS;

  const themeClass = dark
    ? "bg-[#0d1117] text-white"
    : "bg-[#f6f8fa] text-gray-900";

  const sidebarClass = dark
    ? "bg-[#010409] border-r border-white/8"
    : "bg-white border-r border-gray-200";

  const cardClass = dark
    ? "bg-[#161b22] border border-white/8"
    : "bg-white border border-gray-200";

  const inputClass = dark
    ? "bg-[#21262d] border border-white/10 text-white placeholder-white/40 focus:border-blue-500"
    : "bg-gray-100 border border-gray-200 text-gray-900 placeholder-gray-400 focus:border-blue-500";

  return (
    <div className={`min-h-screen font-sans ${themeClass} transition-colors duration-200`}
      style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif" }}>

      {/* Top Bar */}
      <header className={`fixed top-0 left-0 right-0 z-50 h-14 flex items-center justify-between px-4 border-b ${dark ? "bg-[#010409]/90 border-white/8 backdrop-blur-xl" : "bg-white/90 border-gray-200 backdrop-blur-xl"}`}>
        <div className="flex items-center gap-3">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="lg:hidden p-2 rounded-lg hover:bg-white/10">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <a href="/" className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <span className="text-white text-xs font-bold">M</span>
            </div>
            <div>
              <span className={`text-sm font-semibold ${dark ? "text-white" : "text-gray-900"}`}>MegaRadio</span>
              <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full font-medium ${dark ? "bg-blue-900/50 text-blue-300" : "bg-blue-100 text-blue-700"}`}>API v1</span>
            </div>
          </a>
        </div>

        <div className="flex items-center gap-3">
          <a href="/developer" className={`hidden sm:flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg transition-colors ${dark ? "text-white/70 hover:text-white hover:bg-white/8" : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"}`}>
            Get API Key
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
          </a>
          <button
            onClick={() => setDark(!dark)}
            className={`p-2 rounded-lg transition-colors ${dark ? "hover:bg-white/8 text-white/60" : "hover:bg-gray-100 text-gray-500"}`}
          >
            {dark ? (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/></svg>
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/></svg>
            )}
          </button>
        </div>
      </header>

      <div className="flex pt-14 min-h-screen">
        {/* Sidebar */}
        <aside className={`fixed left-0 top-14 bottom-0 w-64 z-40 flex flex-col overflow-hidden transition-transform duration-300 ${sidebarClass} ${sidebarOpen ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0`}>
          {/* Search */}
          <div className="p-4 border-b border-inherit">
            <div className="relative">
              <svg className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${dark ? "text-white/30" : "text-gray-400"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
              </svg>
              <input
                type="search"
                placeholder="Search docs..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className={`w-full pl-9 pr-3 py-2 rounded-lg text-sm outline-none transition-colors ${inputClass}`}
              />
            </div>
          </div>

          {/* Nav */}
          <nav className="flex-1 overflow-y-auto py-4 px-2">
            {filteredNav.map(section => (
              <div key={section.id} className="mb-0.5">
                {(section as any).children ? (
                  <>
                    <button
                      onClick={() => toggleSection(section.id)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        activeSection === section.id
                          ? dark ? "text-white bg-white/10" : "text-gray-900 bg-gray-100"
                          : dark ? "text-white/60 hover:text-white hover:bg-white/6" : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                      }`}
                    >
                      <span className="text-base leading-none">{section.icon}</span>
                      <span className="flex-1 text-left">{section.label}</span>
                      <svg className={`w-3.5 h-3.5 transition-transform ${expandedSections.has(section.id) ? "rotate-180" : ""} ${dark ? "text-white/30" : "text-gray-400"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
                      </svg>
                    </button>
                    {expandedSections.has(section.id) && (
                      <div className="ml-4 pl-3 border-l border-inherit mt-0.5 mb-1 space-y-0.5">
                        {(section as any).children.map((child: any) => (
                          <button
                            key={child.id}
                            onClick={() => scrollTo(child.id)}
                            className={`w-full text-left px-3 py-1.5 rounded-lg text-[13px] transition-colors ${
                              activeSection === child.id
                                ? dark ? "text-blue-400 bg-blue-500/10" : "text-blue-600 bg-blue-50"
                                : dark ? "text-white/50 hover:text-white/80 hover:bg-white/5" : "text-gray-500 hover:text-gray-800 hover:bg-gray-50"
                            }`}
                          >
                            {child.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <button
                    onClick={() => scrollTo(section.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      activeSection === section.id
                        ? dark ? "text-blue-400 bg-blue-500/10" : "text-blue-600 bg-blue-50"
                        : dark ? "text-white/60 hover:text-white hover:bg-white/6" : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                    }`}
                  >
                    <span className="text-base leading-none">{section.icon}</span>
                    <span>{section.label}</span>
                  </button>
                )}
              </div>
            ))}
          </nav>

          {/* Base URL */}
          <div className={`p-4 border-t border-inherit ${dark ? "bg-white/3" : "bg-gray-50"}`}>
            <p className={`text-xs font-medium mb-1.5 ${dark ? "text-white/40" : "text-gray-400"}`}>Base URL</p>
            <code className={`text-xs font-mono break-all ${dark ? "text-blue-400" : "text-blue-600"}`}>{BASE_URL}</code>
          </div>
        </aside>

        {/* Overlay for mobile */}
        {sidebarOpen && <div className="fixed inset-0 bg-black/50 z-30 lg:hidden" onClick={() => setSidebarOpen(false)} />}

        {/* Main Content */}
        <main ref={contentRef} className="flex-1 lg:ml-64 max-w-full">
          <div className="max-w-4xl mx-auto px-4 sm:px-8 lg:px-12 py-12 space-y-20">

            {/* ── Introduction ─────────────────────────────────────────── */}
            <section id="introduction" className="scroll-mt-20">
              <div className="mb-8">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold mb-6 bg-gradient-to-r from-blue-500/20 to-purple-500/20 border border-blue-500/30 text-blue-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                  REST API · JSON · HTTPS
                </div>
                <h1 className={`text-4xl font-bold tracking-tight mb-4 ${dark ? "text-white" : "text-gray-900"}`}>
                  MegaRadio API
                </h1>
                <p className={`text-lg leading-relaxed ${dark ? "text-white/60" : "text-gray-600"}`}>
                  Stream and discover 40,000+ radio stations from 196 countries. Build radio apps, smart devices, and music experiences with our comprehensive REST API.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
                {[
                  { value: "40,000+", label: "Radio Stations", icon: "📻" },
                  { value: "196", label: "Countries", icon: "🌍" },
                  { value: "57", label: "Languages", icon: "🗣" },
                ].map(stat => (
                  <div key={stat.label} className={`rounded-2xl p-5 ${cardClass}`}>
                    <div className="text-2xl mb-2">{stat.icon}</div>
                    <p className={`text-2xl font-bold ${dark ? "text-white" : "text-gray-900"}`}>{stat.value}</p>
                    <p className={`text-sm ${dark ? "text-white/50" : "text-gray-500"}`}>{stat.label}</p>
                  </div>
                ))}
              </div>

              <div className={`rounded-2xl p-6 ${cardClass}`}>
                <h2 className={`text-lg font-semibold mb-4 ${dark ? "text-white" : "text-gray-900"}`}>Quick Start</h2>
                <CodeBlock code={`# Get popular stations in Germany
curl "${BASE_URL}/api/stations/popular?country=Germany" \\
  -H "Authorization: Bearer mr_your_api_key"`} lang="bash" />
                <div className={`mt-4 p-4 rounded-xl text-sm ${dark ? "bg-blue-900/20 border border-blue-500/20 text-blue-300" : "bg-blue-50 border border-blue-100 text-blue-700"}`}>
                  <strong>Get your API key</strong> at <a href="/developer" className="underline">/developer</a> — Free tier includes 1,000 requests/day.
                </div>
              </div>
            </section>

            {/* ── Authentication ────────────────────────────────────────── */}
            <section id="authentication" className="scroll-mt-20">
              <SectionHeader dark={dark} icon="🔐" title="Authentication" description="MegaRadio uses API keys for developer access and Bearer tokens for user authentication on mobile/TV apps." />

              <div className="space-y-4 mt-6">
                <div className={`rounded-2xl p-6 ${cardClass}`}>
                  <h3 className={`font-semibold mb-2 ${dark ? "text-white" : "text-gray-900"}`}>API Key Authentication</h3>
                  <p className={`text-sm mb-4 ${dark ? "text-white/60" : "text-gray-600"}`}>Include your API key in every request as a Bearer token.</p>
                  <CodeBlock code={`Authorization: Bearer mr_your_api_key`} lang="http" />
                </div>

                <div className={`rounded-2xl p-6 ${cardClass}`}>
                  <h3 className={`font-semibold mb-2 ${dark ? "text-white" : "text-gray-900"}`}>User Bearer Token (Mobile/TV)</h3>
                  <p className={`text-sm mb-4 ${dark ? "text-white/60" : "text-gray-600"}`}>After mobile login, use the returned <code className="font-mono text-blue-400">mrt_</code> token for user-specific endpoints.</p>
                  <CodeBlock code={`Authorization: Bearer mrt_AbCdEfGhIjKlMnOpQrStUvWxYz...`} lang="http" />
                  <p className={`mt-3 text-xs ${dark ? "text-white/40" : "text-gray-400"}`}>TV tokens use <code className="font-mono">mrt_tv_</code> prefix and are valid for 90 days.</p>
                </div>
              </div>
            </section>

            {/* ── Rate Limits ───────────────────────────────────────────── */}
            <section id="rate-limits" className="scroll-mt-20">
              <SectionHeader dark={dark} icon="⚡" title="Rate Limits" description="Choose the plan that fits your use case. Rate limits are enforced per API key." />

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
                {(Object.entries(PLANS) as [Plan, typeof PLANS[Plan]][]).map(([key, plan]) => (
                  <div key={key} className={`rounded-2xl p-5 border ${key === "pro" ? "border-purple-500/40 bg-purple-500/5" : dark ? "border-white/8 bg-[#161b22]" : "border-gray-200 bg-white"}`}>
                    <div className="flex items-center justify-between mb-4">
                      <span className="font-semibold" style={{ color: plan.color }}>{plan.label}</span>
                      {key === "pro" && <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400 font-medium">Popular</span>}
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className={dark ? "text-white/50" : "text-gray-500"}>Rate limit</span>
                        <span className={`font-mono font-medium ${dark ? "text-white" : "text-gray-900"}`}>{plan.rpm}/min</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className={dark ? "text-white/50" : "text-gray-500"}>Daily quota</span>
                        <span className={`font-mono font-medium ${dark ? "text-white" : "text-gray-900"}`}>{plan.daily.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className={dark ? "text-white/50" : "text-gray-500"}>Monthly quota</span>
                        <span className={`font-mono font-medium ${dark ? "text-white" : "text-gray-900"}`}>{plan.monthly.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className={`mt-4 rounded-2xl p-5 ${cardClass}`}>
                <h3 className={`font-semibold mb-3 ${dark ? "text-white" : "text-gray-900"}`}>Rate Limit Headers</h3>
                <CodeBlock code={`RateLimit-Limit: 60
RateLimit-Remaining: 47
RateLimit-Reset: 1704067260
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 47`} lang="http" />
              </div>
            </section>

            {/* ── Stations ─────────────────────────────────────────────── */}
            <section id="stations" className="scroll-mt-20">
              <SectionHeader dark={dark} icon="📻" title="Stations" description="Core endpoints for discovering and browsing radio stations." />
              <div className="space-y-3 mt-6">
                {ENDPOINTS.stations.map(ep => <EndpointCard key={ep.id} ep={ep} />)}
              </div>
            </section>

            {/* ── Genres & Countries ────────────────────────────────────── */}
            <section id="genres" className="scroll-mt-20">
              <SectionHeader dark={dark} icon="🌍" title="Genres & Countries" description="Discover available music genres and supported countries." />
              <div className="space-y-3 mt-6">
                {ENDPOINTS.genres.map(ep => <EndpointCard key={ep.id} ep={ep} />)}
              </div>
            </section>

            {/* ── User Auth ─────────────────────────────────────────────── */}
            <section id="auth" className="scroll-mt-20">
              <SectionHeader dark={dark} icon="👤" title="User Authentication" description="Register users, authenticate, and manage sessions across web and mobile platforms." />
              <div className="space-y-3 mt-6">
                {ENDPOINTS.auth.map(ep => <EndpointCard key={ep.id} ep={ep} />)}
              </div>
            </section>

            {/* ── Engagement ────────────────────────────────────────────── */}
            <section id="engagement" className="scroll-mt-20">
              <SectionHeader dark={dark} icon="❤️" title="User Engagement" description="Favorites, ratings, follows, trending stations, and user profiles." />
              <div className="space-y-3 mt-6">
                {ENDPOINTS.engagement.map(ep => <EndpointCard key={ep.id} ep={ep} />)}
              </div>
            </section>

            {/* ── TV Auth ───────────────────────────────────────────────── */}
            <section id="tv" className="scroll-mt-20">
              <SectionHeader dark={dark} icon="📺" title="TV Authentication" description="Netflix-style TV login flow using 6-digit codes. TV displays the code → user enters on mobile → TV gets a persistent token." />

              <div className={`my-6 rounded-2xl p-5 ${cardClass} border-l-4 border-blue-500`}>
                <h3 className={`font-semibold mb-2 ${dark ? "text-white" : "text-gray-900"}`}>TV Login Flow</h3>
                <div className="flex items-start gap-4 flex-wrap">
                  {["TV requests 6-digit code", "TV displays code on screen", "User enters code on mobile", "TV polls for token", "TV authenticated!"].map((step, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${dark ? "bg-blue-500/20 text-blue-400" : "bg-blue-100 text-blue-700"}`}>{i + 1}</span>
                      <span className={`text-sm ${dark ? "text-white/70" : "text-gray-600"}`}>{step}</span>
                      {i < 4 && <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>}
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                {ENDPOINTS.tv.map(ep => <EndpointCard key={ep.id} ep={ep} />)}
              </div>
            </section>

            {/* ── Cast ─────────────────────────────────────────────────── */}
            <section id="cast" className="scroll-mt-20">
              <SectionHeader dark={dark} icon="🎬" title="Chromecast / Cast" description="Cast radio stations to TV or speakers. Supports both WebSocket real-time and HTTP polling modes. Google Cast App ID: 94952E1F" />
              <div className="space-y-3 mt-6">
                {ENDPOINTS.cast.map(ep => <EndpointCard key={ep.id} ep={ep} />)}
              </div>
            </section>

            {/* ── Web SDK ───────────────────────────────────────────────── */}
            <section id="sdk-web" className="scroll-mt-20">
              <SectionHeader dark={dark} icon="🌐" title="Web / JavaScript Guide" description="Integrate MegaRadio into any web app, Next.js, Nuxt, or vanilla JavaScript." />
              <div className="space-y-4 mt-6">
                <div className={`rounded-2xl p-6 ${cardClass}`}>
                  <h3 className={`font-semibold mb-3 ${dark ? "text-white" : "text-gray-900"}`}>Quick Start</h3>
                  <CodeBlock code={SDK_EXAMPLES.web.quickstart} lang="javascript" />
                </div>
                <div className={`rounded-2xl p-6 ${cardClass}`}>
                  <h3 className={`font-semibold mb-3 ${dark ? "text-white" : "text-gray-900"}`}>HLS Stream Playback</h3>
                  <p className={`text-sm mb-4 ${dark ? "text-white/60" : "text-gray-600"}`}>For stations with HLS streams (<code className="font-mono">hls: true</code> or <code className="font-mono">.m3u8</code> URL), use HLS.js for cross-browser support:</p>
                  <CodeBlock code={SDK_EXAMPLES.web.hls} lang="javascript" />
                </div>
                <div className={`rounded-2xl p-6 ${cardClass}`}>
                  <h3 className={`font-semibold mb-3 ${dark ? "text-white" : "text-gray-900"}`}>Error Handling</h3>
                  <CodeBlock code={`async function getStations(params) {
  const res = await fetch(\`${BASE_URL}/api/stations?\${new URLSearchParams(params)}\`, {
    headers: { 'Authorization': 'Bearer mr_your_key' }
  });

  if (res.status === 429) {
    const reset = res.headers.get('RateLimit-Reset');
    throw new Error(\`Rate limit exceeded. Retry after \${reset}\`);
  }
  if (!res.ok) throw new Error(\`API error: \${res.status}\`);

  return res.json();
}`} lang="javascript" />
                </div>
              </div>
            </section>

            {/* ── React Native SDK ──────────────────────────────────────── */}
            <section id="sdk-rn" className="scroll-mt-20">
              <SectionHeader dark={dark} icon="📱" title="React Native & Expo" description="Complete integration guide for React Native and Expo apps with audio playback and background audio support." />
              <div className="space-y-4 mt-6">
                <div className={`rounded-2xl p-6 ${cardClass}`}>
                  <h3 className={`font-semibold mb-3 ${dark ? "text-white" : "text-gray-900"}`}>Installation</h3>
                  <CodeBlock code={SDK_EXAMPLES.rn.install} lang="bash" />
                  <div className={`mt-4 p-4 rounded-xl text-sm ${dark ? "bg-amber-900/20 border border-amber-500/20 text-amber-300" : "bg-amber-50 border border-amber-200 text-amber-700"}`}>
                    <strong>Expo:</strong> Use <code className="font-mono">expo-av</code> instead of <code className="font-mono">react-native-track-player</code> for managed workflow.
                  </div>
                </div>
                <div className={`rounded-2xl p-6 ${cardClass}`}>
                  <h3 className={`font-semibold mb-3 ${dark ? "text-white" : "text-gray-900"}`}>API Client Setup</h3>
                  <CodeBlock code={SDK_EXAMPLES.rn.setup} lang="typescript" />
                </div>
                <div className={`rounded-2xl p-6 ${cardClass}`}>
                  <h3 className={`font-semibold mb-3 ${dark ? "text-white" : "text-gray-900"}`}>Audio Player with Background Playback</h3>
                  <CodeBlock code={SDK_EXAMPLES.rn.player} lang="typescript" />
                </div>
                <div className={`rounded-2xl p-6 ${cardClass}`}>
                  <h3 className={`font-semibold mb-3 ${dark ? "text-white" : "text-gray-900"}`}>Expo AV Alternative</h3>
                  <CodeBlock code={`// For Expo managed workflow
import { Audio } from 'expo-av';

async function playStation(station) {
  await Audio.setAudioModeAsync({
    playsInSilentModeIOS: true,
    staysActiveInBackground: true,
    shouldDuckAndroid: true,
  });

  const { sound } = await Audio.Sound.createAsync(
    { uri: station.url },
    { shouldPlay: true, isLooping: false }
  );

  return sound; // store reference to control playback
}`} lang="typescript" />
                </div>
              </div>
            </section>

            {/* ── iOS SDK ───────────────────────────────────────────────── */}
            <section id="sdk-ios" className="scroll-mt-20">
              <SectionHeader dark={dark} icon="" title="iOS (Swift)" description="Native iOS integration with AVFoundation, background audio, Now Playing Info Center, and Siri support." />
              <div className="space-y-4 mt-6">
                <div className={`rounded-2xl p-6 ${cardClass}`}>
                  <h3 className={`font-semibold mb-2 ${dark ? "text-white" : "text-gray-900"}`}>Required Capabilities</h3>
                  <p className={`text-sm mb-4 ${dark ? "text-white/60" : "text-gray-600"}`}>Add these to your <code className="font-mono">Info.plist</code>:</p>
                  <CodeBlock code={`<key>UIBackgroundModes</key>
<array>
    <string>audio</string>
</array>
<key>NSMicrophoneUsageDescription</key>
<string>For audio playback controls</string>`} lang="xml" />
                </div>
                <div className={`rounded-2xl p-6 ${cardClass}`}>
                  <h3 className={`font-semibold mb-3 ${dark ? "text-white" : "text-gray-900"}`}>API Client</h3>
                  <CodeBlock code={SDK_EXAMPLES.ios.setup} lang="swift" />
                </div>
                <div className={`rounded-2xl p-6 ${cardClass}`}>
                  <h3 className={`font-semibold mb-3 ${dark ? "text-white" : "text-gray-900"}`}>AVFoundation Radio Player</h3>
                  <CodeBlock code={SDK_EXAMPLES.ios.player} lang="swift" />
                </div>
                <div className={`rounded-2xl p-6 ${cardClass}`}>
                  <h3 className={`font-semibold mb-3 ${dark ? "text-white" : "text-gray-900"}`}>Remote Control (Lock Screen)</h3>
                  <CodeBlock code={`// Handle remote control events (lock screen / AirPods)
func setupRemoteControls(player: RadioPlayer) {
    let commandCenter = MPRemoteCommandCenter.shared()

    commandCenter.playCommand.addTarget { _ in
        player.resume(); return .success
    }
    commandCenter.pauseCommand.addTarget { _ in
        player.pause(); return .success
    }
    commandCenter.stopCommand.addTarget { _ in
        player.stop(); return .success
    }
    commandCenter.nextTrackCommand.isEnabled = false
    commandCenter.previousTrackCommand.isEnabled = false
}`} lang="swift" />
                </div>
              </div>
            </section>

            {/* ── Android SDK ───────────────────────────────────────────── */}
            <section id="sdk-android" className="scroll-mt-20">
              <SectionHeader dark={dark} icon="🤖" title="Android (Kotlin)" description="Native Android integration with ExoPlayer, MediaSession, notification controls, and background playback." />
              <div className="space-y-4 mt-6">
                <div className={`rounded-2xl p-6 ${cardClass}`}>
                  <h3 className={`font-semibold mb-3 ${dark ? "text-white" : "text-gray-900"}`}>Gradle Dependencies</h3>
                  <CodeBlock code={SDK_EXAMPLES.android.setup} lang="groovy" />
                </div>
                <div className={`rounded-2xl p-6 ${cardClass}`}>
                  <h3 className={`font-semibold mb-3 ${dark ? "text-white" : "text-gray-900"}`}>API Client</h3>
                  <CodeBlock code={SDK_EXAMPLES.android.api} lang="kotlin" />
                </div>
                <div className={`rounded-2xl p-6 ${cardClass}`}>
                  <h3 className={`font-semibold mb-3 ${dark ? "text-white" : "text-gray-900"}`}>ExoPlayer Service</h3>
                  <CodeBlock code={SDK_EXAMPLES.android.player} lang="kotlin" />
                </div>
                <div className={`rounded-2xl p-6 ${cardClass}`}>
                  <h3 className={`font-semibold mb-3 ${dark ? "text-white" : "text-gray-900"}`}>AndroidManifest.xml</h3>
                  <CodeBlock code={`<service
    android:name=".RadioPlayerService"
    android:exported="true"
    android:foregroundServiceType="mediaPlayback">
    <intent-filter>
        <action android:name="androidx.media3.session.MediaSessionService" />
    </intent-filter>
</service>

<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />
<uses-permission android:name="android.permission.INTERNET" />`} lang="xml" />
                </div>
              </div>
            </section>

            {/* ── Footer ────────────────────────────────────────────────── */}
            <footer className={`pt-12 border-t text-sm ${dark ? "border-white/8 text-white/40" : "border-gray-200 text-gray-400"}`}>
              <div className="flex flex-wrap gap-6 justify-between items-center">
                <div>
                  <p className={`font-semibold mb-1 ${dark ? "text-white/60" : "text-gray-600"}`}>MegaRadio API</p>
                  <p>© {new Date().getFullYear()} MegaRadio. All rights reserved.</p>
                </div>
                <div className="flex gap-4">
                  <a href="/developer" className={`hover:underline ${dark ? "hover:text-white" : "hover:text-gray-900"}`}>Developer Portal</a>
                  <a href="/" className={`hover:underline ${dark ? "hover:text-white" : "hover:text-gray-900"}`}>Website</a>
                </div>
              </div>
            </footer>
          </div>
        </main>
      </div>
    </div>
  );
}

// ─── Section Header ────────────────────────────────────────────────────────────
function SectionHeader({ dark, icon, title, description }: { dark: boolean; icon: string; title: string; description: string }) {
  return (
    <div className="mb-2">
      <div className="flex items-center gap-3 mb-2">
        <span className="text-2xl">{icon}</span>
        <h2 className={`text-2xl font-bold tracking-tight ${dark ? "text-white" : "text-gray-900"}`}>{title}</h2>
      </div>
      <p className={`text-base leading-relaxed ${dark ? "text-white/60" : "text-gray-600"}`}>{description}</p>
    </div>
  );
}
