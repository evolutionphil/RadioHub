import { useState, useEffect, useCallback, memo, useMemo } from "react";
import { useRoute, useLocation } from "wouter";
import { Copy, Check, ChevronRight, Search, Radio, Zap, Shield, Globe, Tv, Cast, Code, BookOpen, AlertTriangle, Users, Heart, Menu, X, ExternalLink, ArrowRight } from "lucide-react";

type Method = "GET" | "POST" | "PUT" | "DELETE";
type CodeLang = "curl" | "javascript" | "python" | "swift" | "kotlin";

interface Param {
  name: string;
  type: string;
  required?: boolean;
  default?: string;
  description: string;
}

interface Endpoint {
  id: string;
  method: Method;
  path: string;
  title: string;
  description: string;
  params?: Param[];
  bodyParams?: Param[];
  responseExample: string;
  codeExamples: Partial<Record<CodeLang, string>>;
}

interface NavSection {
  id: string;
  label: string;
  icon: any;
  items: { id: string; label: string }[];
}

const METHOD_STYLES: Record<Method, { bg: string; text: string; border: string }> = {
  GET: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/20" },
  POST: { bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/20" },
  PUT: { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/20" },
  DELETE: { bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/20" },
};

const CODE_LANG_LABELS: Record<CodeLang, string> = {
  curl: "cURL",
  javascript: "JavaScript",
  python: "Python",
  swift: "Swift",
  kotlin: "Kotlin",
};

const BASE_URL = "https://themegaradio.com";

const NAV_SECTIONS: NavSection[] = [
  {
    id: "overview",
    label: "Getting Started",
    icon: BookOpen,
    items: [
      { id: "introduction", label: "Introduction" },
      { id: "authentication", label: "Authentication" },
      { id: "rate-limits", label: "Rate Limits" },
      { id: "errors", label: "Error Handling" },
    ],
  },
  {
    id: "stations",
    label: "Stations",
    icon: Radio,
    items: [
      { id: "list-stations", label: "List Stations" },
      { id: "get-station", label: "Get Station" },
      { id: "popular-stations", label: "Popular Stations" },
      { id: "search-stations", label: "Search Stations" },
      { id: "nearby-stations", label: "Nearby Stations" },
      { id: "similar-stations", label: "Similar Stations" },
      { id: "random-station", label: "Random Station" },
      { id: "station-stats", label: "Station Statistics" },
    ],
  },
  {
    id: "discovery",
    label: "Discovery",
    icon: Globe,
    items: [
      { id: "list-genres", label: "List Genres" },
      { id: "list-countries", label: "List Countries" },
      { id: "list-languages", label: "List Languages" },
      { id: "trending", label: "Trending Stations" },
    ],
  },
  {
    id: "streaming",
    label: "Streaming",
    icon: Zap,
    items: [
      { id: "resolve-stream", label: "Resolve Stream URL" },
      { id: "now-playing", label: "Now Playing" },
    ],
  },
  {
    id: "engagement",
    label: "Engagement",
    icon: Heart,
    items: [
      { id: "favorite-station", label: "Favorite a Station" },
      { id: "rate-station", label: "Rate a Station" },
      { id: "user-profile", label: "User Profile" },
    ],
  },
  {
    id: "user-auth",
    label: "User Authentication",
    icon: Users,
    items: [
      { id: "web-login", label: "Web Login" },
      { id: "mobile-login", label: "Mobile Login" },
      { id: "register", label: "Register" },
      { id: "current-user", label: "Current User" },
    ],
  },
  {
    id: "tv",
    label: "TV & Cast",
    icon: Tv,
    items: [
      { id: "tv-request-code", label: "TV: Request Code" },
      { id: "tv-poll-status", label: "TV: Poll Status" },
      { id: "tv-activate", label: "TV: Activate Device" },
      { id: "cast-create", label: "Cast: Create Session" },
      { id: "cast-command", label: "Cast: Send Command" },
    ],
  },
  {
    id: "sdks",
    label: "SDKs & Guides",
    icon: Code,
    items: [
      { id: "guide-javascript", label: "JavaScript / Web" },
      { id: "guide-react-native", label: "React Native" },
      { id: "guide-ios", label: "iOS (Swift)" },
      { id: "guide-android", label: "Android (Kotlin)" },
    ],
  },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);
  return (
    <button onClick={handleCopy} className="absolute top-3 right-3 p-1.5 rounded-md bg-white/5 hover:bg-white/10 transition-colors" aria-label="Copy">
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
    </button>
  );
}

function MethodBadge({ method }: { method: Method }) {
  const s = METHOD_STYLES[method];
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold tracking-wider ${s.bg} ${s.text} border ${s.border}`}>{method}</span>;
}

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  return (
    <div className="relative group rounded-lg bg-[#0d1117] border border-white/5 overflow-hidden">
      {lang && <div className="px-4 py-1.5 text-[10px] uppercase tracking-widest text-slate-500 border-b border-white/5 font-medium">{lang}</div>}
      <CopyButton text={code} />
      <pre className="p-4 overflow-x-auto text-[13px] leading-relaxed"><code className="text-slate-300 font-mono">{code}</code></pre>
    </div>
  );
}

function CodeTabs({ examples }: { examples: Partial<Record<CodeLang, string>> }) {
  const langs = Object.keys(examples) as CodeLang[];
  const [active, setActive] = useState<CodeLang>(langs[0]);
  if (langs.length === 0) return null;
  return (
    <div className="rounded-lg bg-[#0d1117] border border-white/5 overflow-hidden">
      <div className="flex border-b border-white/5 overflow-x-auto">
        {langs.map((lang) => (
          <button key={lang} onClick={() => setActive(lang)} className={`px-4 py-2 text-xs font-medium whitespace-nowrap transition-colors ${active === lang ? "text-white bg-white/5 border-b-2 border-blue-400" : "text-slate-500 hover:text-slate-300"}`}>
            {CODE_LANG_LABELS[lang]}
          </button>
        ))}
      </div>
      <div className="relative">
        <CopyButton text={examples[active] || ""} />
        <pre className="p-4 overflow-x-auto text-[13px] leading-relaxed"><code className="text-slate-300 font-mono">{examples[active]}</code></pre>
      </div>
    </div>
  );
}

function ParamTable({ params, title }: { params: Param[]; title: string }) {
  if (!params.length) return null;
  return (
    <div className="mt-6">
      <h4 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wider">{title}</h4>
      <div className="border border-white/5 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="bg-white/[0.02]">
            <th className="text-left px-4 py-2.5 text-slate-400 font-medium text-xs uppercase tracking-wider">Parameter</th>
            <th className="text-left px-4 py-2.5 text-slate-400 font-medium text-xs uppercase tracking-wider">Type</th>
            <th className="text-left px-4 py-2.5 text-slate-400 font-medium text-xs uppercase tracking-wider">Description</th>
          </tr></thead>
          <tbody>
            {params.map((p, i) => (
              <tr key={p.name} className={i % 2 === 0 ? "bg-transparent" : "bg-white/[0.01]"}>
                <td className="px-4 py-3 font-mono text-[13px]">
                  <span className="text-sky-400">{p.name}</span>
                  {p.required && <span className="ml-1.5 text-[10px] text-red-400 font-sans font-medium">required</span>}
                  {p.default && <span className="ml-1.5 text-[10px] text-slate-500 font-sans">= {p.default}</span>}
                </td>
                <td className="px-4 py-3 text-amber-300/80 font-mono text-[13px]">{p.type}</td>
                <td className="px-4 py-3 text-slate-400">{p.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EndpointCard({ endpoint }: { endpoint: Endpoint }) {
  return (
    <div id={endpoint.id} className="scroll-mt-20 mb-12">
      <div className="flex items-center gap-3 mb-3">
        <MethodBadge method={endpoint.method} />
        <code className="text-sm font-mono text-slate-300 bg-white/5 px-3 py-1 rounded-md">{endpoint.path}</code>
      </div>
      <h3 className="text-xl font-semibold text-white mb-2">{endpoint.title}</h3>
      <p className="text-slate-400 leading-relaxed mb-6">{endpoint.description}</p>
      {endpoint.params && <ParamTable params={endpoint.params} title="Query Parameters" />}
      {endpoint.bodyParams && <ParamTable params={endpoint.bodyParams} title="Body Parameters" />}
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <h4 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wider">Request</h4>
          <CodeTabs examples={endpoint.codeExamples} />
        </div>
        <div>
          <h4 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wider">Response</h4>
          <CodeBlock code={endpoint.responseExample} lang="JSON" />
        </div>
      </div>
    </div>
  );
}

const IntroductionContent = memo(() => (
  <div>
    <div className="mb-12">
      <h1 className="text-4xl font-bold text-white mb-4">Mega Radio API</h1>
      <p className="text-lg text-slate-400 leading-relaxed max-w-2xl">Access 40,000+ radio stations worldwide. Build radio apps, integrate live streaming, and create personalized listening experiences with our REST API.</p>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12">
      {[
        { icon: Radio, title: "40,000+ Stations", desc: "Global radio stations with metadata, logos, and stream URLs" },
        { icon: Zap, title: "Real-time Streaming", desc: "HLS and direct stream resolution with now-playing metadata" },
        { icon: Globe, title: "57 Languages", desc: "Multilingual support with localized content and search" },
      ].map((f) => (
        <div key={f.title} className="rounded-xl bg-white/[0.03] border border-white/5 p-5 hover:border-white/10 transition-colors">
          <f.icon className="w-8 h-8 text-blue-400 mb-3" />
          <h3 className="text-white font-semibold mb-1">{f.title}</h3>
          <p className="text-sm text-slate-400">{f.desc}</p>
        </div>
      ))}
    </div>
    <h2 className="text-2xl font-bold text-white mb-4">Base URL</h2>
    <CodeBlock code={`${BASE_URL}/api`} lang="Base URL" />
    <div className="mt-8">
      <h2 className="text-2xl font-bold text-white mb-4">Quick Start</h2>
      <p className="text-slate-400 mb-4">Get a demo API key and make your first request in seconds:</p>
      <CodeBlock code={`# 1. Get a free demo API key (valid 24h)\ncurl ${BASE_URL}/api/api-keys/demo\n\n# 2. Search for stations\ncurl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/stations?search=jazz&limit=5"\n\n# 3. Get station details\ncurl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/station/bbc-radio-1"`} lang="Quick Start" />
    </div>
  </div>
));

const AuthenticationContent = memo(() => (
  <div>
    <h1 className="text-4xl font-bold text-white mb-4">Authentication</h1>
    <p className="text-lg text-slate-400 leading-relaxed mb-8">All API requests require authentication via an API key. Include your key in every request using one of these methods:</p>
    <div className="space-y-4 mb-8">
      {[
        { title: "X-API-Key Header (Recommended)", code: `curl -H "X-API-Key: mr_your_api_key" ${BASE_URL}/api/stations` },
        { title: "Authorization Bearer", code: `curl -H "Authorization: Bearer mr_your_api_key" ${BASE_URL}/api/stations` },
      ].map((m) => (
        <div key={m.title}>
          <h3 className="text-white font-semibold mb-2">{m.title}</h3>
          <CodeBlock code={m.code} />
        </div>
      ))}
    </div>
    <h2 className="text-2xl font-bold text-white mb-4">Getting an API Key</h2>
    <div className="space-y-6">
      <div className="rounded-xl bg-white/[0.03] border border-white/5 p-6">
        <h3 className="text-lg font-semibold text-white mb-2">Demo Key (Instant)</h3>
        <p className="text-slate-400 mb-3">Get a temporary key instantly. Valid for 24 hours, limited to 10 req/min. One per IP address.</p>
        <CodeBlock code={`curl -X GET ${BASE_URL}/api/api-keys/demo`} />
      </div>
      <div className="rounded-xl bg-white/[0.03] border border-white/5 p-6">
        <h3 className="text-lg font-semibold text-white mb-2">Free Key (Register)</h3>
        <p className="text-slate-400 mb-3">Register for a permanent key with higher limits. 60 req/min, 1,000 requests/day.</p>
        <CodeBlock code={`curl -X POST ${BASE_URL}/api/api-keys/user/register \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "email": "dev@example.com",\n    "password": "securepassword",\n    "name": "Your Name",\n    "appName": "My Radio App",\n    "appDescription": "A radio streaming app"\n  }'`} />
      </div>
      <div className="rounded-xl bg-white/[0.03] border border-white/5 p-6">
        <h3 className="text-lg font-semibold text-white mb-2">Developer Portal</h3>
        <p className="text-slate-400 mb-3">Manage your API keys, view usage statistics, and upgrade your plan.</p>
        <a href="/api-user" className="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300 font-medium transition-colors">
          Open Developer Portal <ExternalLink className="w-4 h-4" />
        </a>
      </div>
    </div>
  </div>
));

const RateLimitsContent = memo(() => (
  <div>
    <h1 className="text-4xl font-bold text-white mb-4">Rate Limits</h1>
    <p className="text-lg text-slate-400 leading-relaxed mb-8">Rate limits protect the API from abuse and ensure fair usage. Limits vary by plan tier.</p>
    <div className="border border-white/5 rounded-xl overflow-hidden mb-8">
      <table className="w-full text-sm">
        <thead><tr className="bg-white/[0.03]">
          <th className="text-left px-5 py-3.5 text-slate-400 font-semibold text-xs uppercase tracking-wider">Plan</th>
          <th className="text-left px-5 py-3.5 text-slate-400 font-semibold text-xs uppercase tracking-wider">Requests/Min</th>
          <th className="text-left px-5 py-3.5 text-slate-400 font-semibold text-xs uppercase tracking-wider">Daily Quota</th>
          <th className="text-left px-5 py-3.5 text-slate-400 font-semibold text-xs uppercase tracking-wider">Monthly Quota</th>
          <th className="text-left px-5 py-3.5 text-slate-400 font-semibold text-xs uppercase tracking-wider">Price</th>
        </tr></thead>
        <tbody>
          {[
            { plan: "Demo", rpm: "10", daily: "100", monthly: "500", price: "Free (24h)", color: "text-slate-300" },
            { plan: "Free", rpm: "60", daily: "1,000", monthly: "10,000", price: "Free", color: "text-emerald-400" },
            { plan: "Pro", rpm: "300", daily: "10,000", monthly: "100,000", price: "Contact us", color: "text-blue-400" },
            { plan: "Internal", rpm: "Unlimited", daily: "Unlimited", monthly: "Unlimited", price: "—", color: "text-purple-400" },
          ].map((r, i) => (
            <tr key={r.plan} className={i % 2 === 0 ? "" : "bg-white/[0.01]"}>
              <td className={`px-5 py-3.5 font-semibold ${r.color}`}>{r.plan}</td>
              <td className="px-5 py-3.5 text-slate-300 font-mono">{r.rpm}</td>
              <td className="px-5 py-3.5 text-slate-300 font-mono">{r.daily}</td>
              <td className="px-5 py-3.5 text-slate-300 font-mono">{r.monthly}</td>
              <td className="px-5 py-3.5 text-slate-400">{r.price}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <h2 className="text-2xl font-bold text-white mb-4">Rate Limit Headers</h2>
    <p className="text-slate-400 mb-4">Every API response includes these headers so you can track your usage:</p>
    <CodeBlock code={`X-RateLimit-Limit: 60          # Max requests per minute\nX-RateLimit-Remaining: 58      # Remaining requests this minute\nX-RateLimit-Reset: 45          # Seconds until window resets\nX-Daily-Remaining: 950         # Remaining daily quota`} lang="Response Headers" />
    <div className="mt-6 p-4 rounded-lg bg-amber-500/5 border border-amber-500/20">
      <div className="flex gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-amber-200 font-medium text-sm">Rate Limit Exceeded</p>
          <p className="text-amber-200/60 text-sm mt-1">When you exceed your rate limit, the API returns <code className="bg-white/5 px-1.5 py-0.5 rounded text-xs">429 Too Many Requests</code>. Back off and retry after the reset window.</p>
        </div>
      </div>
    </div>
  </div>
));

const ErrorsContent = memo(() => (
  <div>
    <h1 className="text-4xl font-bold text-white mb-4">Error Handling</h1>
    <p className="text-lg text-slate-400 leading-relaxed mb-8">The API uses conventional HTTP status codes. Errors include a JSON body with details.</p>
    <div className="border border-white/5 rounded-xl overflow-hidden mb-8">
      <table className="w-full text-sm">
        <thead><tr className="bg-white/[0.03]">
          <th className="text-left px-5 py-3 text-slate-400 font-semibold text-xs uppercase tracking-wider">Code</th>
          <th className="text-left px-5 py-3 text-slate-400 font-semibold text-xs uppercase tracking-wider">Status</th>
          <th className="text-left px-5 py-3 text-slate-400 font-semibold text-xs uppercase tracking-wider">Description</th>
        </tr></thead>
        <tbody>
          {[
            { code: "200", status: "OK", desc: "Request succeeded", color: "text-emerald-400" },
            { code: "400", status: "Bad Request", desc: "Invalid parameters or missing required fields", color: "text-amber-400" },
            { code: "401", status: "Unauthorized", desc: "Missing or invalid API key", color: "text-red-400" },
            { code: "403", status: "Forbidden", desc: "API key lacks permission for this action", color: "text-red-400" },
            { code: "404", status: "Not Found", desc: "Resource not found", color: "text-amber-400" },
            { code: "429", status: "Too Many Requests", desc: "Rate limit or quota exceeded", color: "text-red-400" },
            { code: "500", status: "Internal Error", desc: "Server error — please retry or contact support", color: "text-red-400" },
          ].map((e, i) => (
            <tr key={e.code} className={i % 2 === 0 ? "" : "bg-white/[0.01]"}>
              <td className={`px-5 py-3 font-mono font-bold ${e.color}`}>{e.code}</td>
              <td className="px-5 py-3 text-white font-medium">{e.status}</td>
              <td className="px-5 py-3 text-slate-400">{e.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <h2 className="text-2xl font-bold text-white mb-4">Error Response Format</h2>
    <CodeBlock code={`{\n  "error": "Station not found",\n  "statusCode": 404\n}`} lang="JSON" />
  </div>
));

const STATION_ENDPOINTS: Endpoint[] = [
  {
    id: "list-stations",
    method: "GET",
    path: "/api/stations",
    title: "List Stations",
    description: "Retrieve a paginated list of radio stations. Supports filtering by country, genre, language, codec, and more. Results can be sorted by popularity, name, bitrate, or click count.",
    params: [
      { name: "page", type: "number", default: "1", description: "Page number for pagination" },
      { name: "limit", type: "number", default: "20", description: "Number of stations per page (max 100)" },
      { name: "country", type: "string", description: "Filter by country name (e.g., 'Germany', 'Turkey')" },
      { name: "genre", type: "string", description: "Filter by genre/tag (e.g., 'rock', 'jazz', 'pop')" },
      { name: "language", type: "string", description: "Filter by language (e.g., 'english', 'turkish')" },
      { name: "codec", type: "string", description: "Filter by audio codec (e.g., 'MP3', 'AAC', 'OGG')" },
      { name: "sort", type: "string", default: "votes", description: "Sort field: votes, clickcount, name, bitrate, random" },
      { name: "order", type: "string", default: "desc", description: "Sort order: asc or desc" },
      { name: "search", type: "string", description: "Full-text search across station name and tags" },
    ],
    responseExample: `{
  "stations": [
    {
      "_id": "64a1b2c3d4e5f6a7b8c9d0e1",
      "name": "BBC Radio 1",
      "slug": "bbc-radio-1",
      "url": "https://stream.live.vc.bbcmedia.co.uk/bbc_radio_one",
      "favicon": "https://cdn-radiotime-logos.tunein.com/s24939q.png",
      "country": "United Kingdom",
      "countryCode": "GB",
      "tags": "pop,dance,electronic",
      "codec": "MP3",
      "bitrate": 128,
      "votes": 15234,
      "clickCount": 89421,
      "lastCheckOk": true
    }
  ],
  "total": 42150,
  "page": 1,
  "totalPages": 2108
}`,
    codeExamples: {
      curl: `curl -H "X-API-Key: YOUR_KEY" \\\n  "${BASE_URL}/api/stations?country=Germany&genre=rock&limit=10"`,
      javascript: `const response = await fetch('${BASE_URL}/api/stations?country=Germany&genre=rock&limit=10', {\n  headers: { 'X-API-Key': 'YOUR_KEY' }\n});\nconst data = await response.json();\nconsole.log(data.stations);`,
      python: `import requests\n\nresponse = requests.get(\n    '${BASE_URL}/api/stations',\n    headers={'X-API-Key': 'YOUR_KEY'},\n    params={'country': 'Germany', 'genre': 'rock', 'limit': 10}\n)\nstations = response.json()['stations']`,
      swift: `let url = URL(string: "${BASE_URL}/api/stations?country=Germany&genre=rock&limit=10")!\nvar request = URLRequest(url: url)\nrequest.setValue("YOUR_KEY", forHTTPHeaderField: "X-API-Key")\n\nlet (data, _) = try await URLSession.shared.data(for: request)\nlet result = try JSONDecoder().decode(StationsResponse.self, from: data)`,
      kotlin: `val client = OkHttpClient()\nval request = Request.Builder()\n    .url("${BASE_URL}/api/stations?country=Germany&genre=rock&limit=10")\n    .header("X-API-Key", "YOUR_KEY")\n    .build()\n\nval response = client.newCall(request).execute()\nval json = JSONObject(response.body?.string() ?: "")`,
    },
  },
  {
    id: "get-station",
    method: "GET",
    path: "/api/station/:identifier",
    title: "Get Station Details",
    description: "Retrieve detailed information about a specific station by its ID or slug. Returns full metadata including stream URL, logo assets, ratings, and localized descriptions.",
    params: [
      { name: "identifier", type: "string", required: true, description: "Station ID (MongoDB ObjectId) or slug (e.g., 'bbc-radio-1')" },
    ],
    responseExample: `{
  "_id": "64a1b2c3d4e5f6a7b8c9d0e1",
  "name": "BBC Radio 1",
  "slug": "bbc-radio-1",
  "url": "https://stream.live.vc.bbcmedia.co.uk/bbc_radio_one",
  "urlResolved": "https://stream.live.vc.bbcmedia.co.uk/bbc_radio_one",
  "favicon": "https://cdn-radiotime-logos.tunein.com/s24939q.png",
  "logoAssets": {
    "webp256": "https://s3.amazonaws.com/megaradio/logos/bbc-radio-1-256.webp",
    "status": "completed"
  },
  "homepage": "https://www.bbc.co.uk/radio1",
  "country": "United Kingdom",
  "countryCode": "GB",
  "tags": "pop,dance,electronic,bbc",
  "language": "english",
  "codec": "MP3",
  "bitrate": 128,
  "hls": false,
  "votes": 15234,
  "clickCount": 89421,
  "averageRating": 4.5,
  "totalRatings": 312,
  "lastCheckOk": true,
  "geoLat": 51.5074,
  "geoLong": -0.1278,
  "descriptions": {
    "en": "BBC Radio 1 is the BBC's popular music and youth culture station...",
    "tr": "BBC Radio 1, BBC'nin popüler müzik ve gençlik kültürü istasyonudur..."
  }
}`,
    codeExamples: {
      curl: `curl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/station/bbc-radio-1"`,
      javascript: `const response = await fetch('${BASE_URL}/api/station/bbc-radio-1', {\n  headers: { 'X-API-Key': 'YOUR_KEY' }\n});\nconst station = await response.json();`,
      python: `response = requests.get(\n    '${BASE_URL}/api/station/bbc-radio-1',\n    headers={'X-API-Key': 'YOUR_KEY'}\n)\nstation = response.json()`,
    },
  },
  {
    id: "popular-stations",
    method: "GET",
    path: "/api/stations/popular",
    title: "Popular Stations",
    description: "Get the most popular stations globally or filtered by country. Sorted by a combination of votes and recent click trends.",
    params: [
      { name: "country", type: "string", description: "Filter by country name" },
      { name: "limit", type: "number", default: "20", description: "Number of stations to return (max 50)" },
    ],
    responseExample: `[
  {
    "name": "NRJ France",
    "slug": "nrj-france",
    "country": "France",
    "votes": 28410,
    "clickCount": 145200,
    "favicon": "https://..."
  }
]`,
    codeExamples: {
      curl: `curl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/stations/popular?country=Turkey&limit=10"`,
      javascript: `const response = await fetch('${BASE_URL}/api/stations/popular?country=Turkey&limit=10', {\n  headers: { 'X-API-Key': 'YOUR_KEY' }\n});\nconst popular = await response.json();`,
    },
  },
  {
    id: "search-stations",
    method: "GET",
    path: "/api/stations?search=:query",
    title: "Search Stations",
    description: "Full-text search across station names, tags, and metadata. Combine with country, genre, and language filters for refined results.",
    params: [
      { name: "search", type: "string", required: true, description: "Search query (e.g., 'jazz', 'bbc', 'classical piano')" },
      { name: "country", type: "string", description: "Narrow results to a specific country" },
      { name: "genre", type: "string", description: "Narrow results to a specific genre" },
      { name: "limit", type: "number", default: "20", description: "Number of results (max 100)" },
    ],
    responseExample: `{
  "stations": [
    {
      "name": "WBGO Jazz 88.3",
      "slug": "wbgo-jazz-88-3",
      "tags": "jazz,blues,soul",
      "country": "United States",
      "votes": 5420
    }
  ],
  "total": 847,
  "page": 1
}`,
    codeExamples: {
      curl: `curl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/stations?search=jazz&country=United%20States&limit=5"`,
      javascript: `const response = await fetch(\n  '${BASE_URL}/api/stations?search=jazz&country=United%20States&limit=5',\n  { headers: { 'X-API-Key': 'YOUR_KEY' } }\n);\nconst results = await response.json();`,
    },
  },
  {
    id: "nearby-stations",
    method: "GET",
    path: "/api/stations/nearby",
    title: "Nearby Stations",
    description: "Find radio stations near a geographic location using latitude and longitude coordinates. Perfect for location-based discovery in mobile apps.",
    params: [
      { name: "lat", type: "number", required: true, description: "Latitude coordinate (e.g., 41.0082)" },
      { name: "lng", type: "number", required: true, description: "Longitude coordinate (e.g., 28.9784)" },
      { name: "radius", type: "number", default: "100", description: "Search radius in kilometers" },
      { name: "limit", type: "number", default: "20", description: "Max stations to return" },
    ],
    responseExample: `[
  {
    "name": "Power FM Turkey",
    "slug": "power-fm-turkey",
    "country": "Turkey",
    "geoLat": 41.0082,
    "geoLong": 28.9784,
    "distance": 2.3,
    "votes": 8920
  }
]`,
    codeExamples: {
      curl: `curl -H "X-API-Key: YOUR_KEY" \\\n  "${BASE_URL}/api/stations/nearby?lat=41.0082&lng=28.9784&radius=50&limit=10"`,
      javascript: `navigator.geolocation.getCurrentPosition(async (pos) => {\n  const { latitude, longitude } = pos.coords;\n  const response = await fetch(\n    \`${BASE_URL}/api/stations/nearby?lat=\${latitude}&lng=\${longitude}&radius=50\`,\n    { headers: { 'X-API-Key': 'YOUR_KEY' } }\n  );\n  const nearby = await response.json();\n});`,
      swift: `import CoreLocation\n\nlet lat = location.coordinate.latitude\nlet lng = location.coordinate.longitude\nlet url = URL(string: "${BASE_URL}/api/stations/nearby?lat=\\(lat)&lng=\\(lng)&radius=50")!\nvar request = URLRequest(url: url)\nrequest.setValue("YOUR_KEY", forHTTPHeaderField: "X-API-Key")`,
    },
  },
  {
    id: "similar-stations",
    method: "GET",
    path: "/api/stations/similar/:id",
    title: "Similar Stations",
    description: "Find stations similar to a given station based on genre, country, and tags. Useful for building 'You might also like' features.",
    params: [
      { name: "id", type: "string", required: true, description: "Station ID" },
      { name: "limit", type: "number", default: "10", description: "Number of similar stations to return" },
    ],
    responseExample: `[
  {
    "name": "Kiss FM UK",
    "slug": "kiss-fm-uk",
    "country": "United Kingdom",
    "tags": "dance,pop,electronic",
    "votes": 12500
  }
]`,
    codeExamples: {
      curl: `curl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/stations/similar/64a1b2c3d4e5f6a7b8c9d0e1?limit=5"`,
      javascript: `const response = await fetch('${BASE_URL}/api/stations/similar/64a1b2c3d4e5f6a7b8c9d0e1?limit=5', {\n  headers: { 'X-API-Key': 'YOUR_KEY' }\n});\nconst similar = await response.json();`,
    },
  },
  {
    id: "random-station",
    method: "GET",
    path: "/api/stations?sort=random&limit=1",
    title: "Random Station",
    description: "Get a random radio station. Use the sort=random parameter with limit=1 for a single random station, or higher limits for multiple random picks.",
    params: [
      { name: "sort", type: "string", required: true, description: "Set to 'random' for random selection" },
      { name: "limit", type: "number", default: "1", description: "Number of random stations" },
      { name: "country", type: "string", description: "Optional country filter for regional random picks" },
    ],
    responseExample: `{
  "stations": [
    {
      "name": "Radio Nova",
      "slug": "radio-nova",
      "country": "Finland",
      "tags": "pop,rock",
      "votes": 3200
    }
  ],
  "total": 1
}`,
    codeExamples: {
      curl: `curl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/stations?sort=random&limit=1"`,
      javascript: `const response = await fetch('${BASE_URL}/api/stations?sort=random&limit=1', {\n  headers: { 'X-API-Key': 'YOUR_KEY' }\n});\nconst { stations: [randomStation] } = await response.json();`,
    },
  },
  {
    id: "station-stats",
    method: "GET",
    path: "/api/stations/stats",
    title: "Station Statistics",
    description: "Get aggregate statistics about the station database including total counts, top countries, popular genres, and codec distribution.",
    responseExample: `{
  "totalStations": 42150,
  "activeStations": 38420,
  "countries": 215,
  "genres": 850,
  "topCountries": [
    { "country": "Germany", "count": 3450 },
    { "country": "United States", "count": 3120 },
    { "country": "France", "count": 2890 }
  ]
}`,
    codeExamples: {
      curl: `curl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/stations/stats"`,
      javascript: `const response = await fetch('${BASE_URL}/api/stations/stats', {\n  headers: { 'X-API-Key': 'YOUR_KEY' }\n});\nconst stats = await response.json();`,
    },
  },
];

const DISCOVERY_ENDPOINTS: Endpoint[] = [
  {
    id: "list-genres",
    method: "GET",
    path: "/api/genres",
    title: "List Genres",
    description: "Get all available radio genres with station counts. Results are sorted by station count descending.",
    responseExample: `[
  {
    "name": "Pop",
    "slug": "pop",
    "stationCount": 8520,
    "isDiscoverable": true
  },
  {
    "name": "Rock",
    "slug": "rock",
    "stationCount": 6210,
    "isDiscoverable": true
  }
]`,
    codeExamples: {
      curl: `curl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/genres"`,
      javascript: `const response = await fetch('${BASE_URL}/api/genres', {\n  headers: { 'X-API-Key': 'YOUR_KEY' }\n});\nconst genres = await response.json();`,
    },
  },
  {
    id: "list-countries",
    method: "GET",
    path: "/api/countries",
    title: "List Countries",
    description: "Get all countries that have radio stations, with station counts per country.",
    responseExample: `[
  {
    "name": "Germany",
    "code": "DE",
    "stationCount": 3450
  },
  {
    "name": "United States",
    "code": "US",
    "stationCount": 3120
  }
]`,
    codeExamples: {
      curl: `curl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/countries"`,
      javascript: `const response = await fetch('${BASE_URL}/api/countries', {\n  headers: { 'X-API-Key': 'YOUR_KEY' }\n});\nconst countries = await response.json();`,
    },
  },
  {
    id: "list-languages",
    method: "GET",
    path: "/api/languages",
    title: "List Languages",
    description: "Get all languages available across radio stations.",
    responseExample: `[
  { "name": "english", "stationCount": 12500 },
  { "name": "german", "stationCount": 3200 },
  { "name": "turkish", "stationCount": 1800 }
]`,
    codeExamples: {
      curl: `curl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/languages"`,
      javascript: `const response = await fetch('${BASE_URL}/api/languages', {\n  headers: { 'X-API-Key': 'YOUR_KEY' }\n});\nconst languages = await response.json();`,
    },
  },
  {
    id: "trending",
    method: "GET",
    path: "/api/stations/trending",
    title: "Trending Stations",
    description: "Get stations that are currently trending based on recent user engagement — favorites, ratings, and click activity in the past 7 days.",
    params: [
      { name: "limit", type: "number", default: "20", description: "Number of trending stations" },
      { name: "country", type: "string", description: "Filter trending by country" },
    ],
    responseExample: `[
  {
    "name": "Radio Energy",
    "slug": "radio-energy",
    "trendingScore": 95.4,
    "weeklyFavorites": 120,
    "votes": 9800
  }
]`,
    codeExamples: {
      curl: `curl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/stations/trending?limit=10"`,
      javascript: `const response = await fetch('${BASE_URL}/api/stations/trending?limit=10', {\n  headers: { 'X-API-Key': 'YOUR_KEY' }\n});\nconst trending = await response.json();`,
    },
  },
];

const STREAMING_ENDPOINTS: Endpoint[] = [
  {
    id: "resolve-stream",
    method: "GET",
    path: "/api/stream/resolve",
    title: "Resolve Stream URL",
    description: "Resolve the best available stream URL for a station. Handles redirects, playlist parsing (M3U/PLS), and returns the direct audio stream URL. Essential for building reliable audio players.",
    params: [
      { name: "stationId", type: "string", required: true, description: "Station ID to resolve" },
    ],
    responseExample: `{
  "url": "https://stream.live.vc.bbcmedia.co.uk/bbc_radio_one",
  "resolvedUrl": "https://stream.live.vc.bbcmedia.co.uk/bbc_radio_one",
  "codec": "MP3",
  "bitrate": 128,
  "hls": false
}`,
    codeExamples: {
      curl: `curl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/stream/resolve?stationId=64a1b2c3d4e5f6a7b8c9d0e1"`,
      javascript: `const response = await fetch(\n  '${BASE_URL}/api/stream/resolve?stationId=64a1b2c3d4e5f6a7b8c9d0e1',\n  { headers: { 'X-API-Key': 'YOUR_KEY' } }\n);\nconst stream = await response.json();\n\nconst audio = new Audio(stream.url);\naudio.play();`,
      swift: `let url = URL(string: "${BASE_URL}/api/stream/resolve?stationId=STATION_ID")!\nvar request = URLRequest(url: url)\nrequest.setValue("YOUR_KEY", forHTTPHeaderField: "X-API-Key")\n\nlet (data, _) = try await URLSession.shared.data(for: request)\nlet stream = try JSONDecoder().decode(StreamInfo.self, from: data)\n\nlet player = AVPlayer(url: URL(string: stream.url)!)\nplayer.play()`,
    },
  },
  {
    id: "now-playing",
    method: "GET",
    path: "/api/now-playing/:stationId",
    title: "Now Playing",
    description: "Get the currently playing track information for a station. Returns artist, title, and artwork when available from the stream metadata.",
    params: [
      { name: "stationId", type: "string", required: true, description: "Station ID" },
    ],
    responseExample: `{
  "title": "Blinding Lights",
  "artist": "The Weeknd",
  "station": "BBC Radio 1",
  "artwork": "https://...",
  "timestamp": "2025-03-02T22:00:00Z"
}`,
    codeExamples: {
      curl: `curl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/now-playing/64a1b2c3d4e5f6a7b8c9d0e1"`,
      javascript: `const response = await fetch('${BASE_URL}/api/now-playing/STATION_ID', {\n  headers: { 'X-API-Key': 'YOUR_KEY' }\n});\nconst nowPlaying = await response.json();\nconsole.log(\`Now playing: \${nowPlaying.artist} - \${nowPlaying.title}\`);`,
    },
  },
];

const ENGAGEMENT_ENDPOINTS: Endpoint[] = [
  {
    id: "favorite-station",
    method: "POST",
    path: "/api/stations/:id/favorite",
    title: "Favorite a Station",
    description: "Add or remove a station from the authenticated user's favorites list. Requires user authentication (session or auth token).",
    bodyParams: [
      { name: "stationId", type: "string", required: true, description: "Station ID to favorite/unfavorite" },
    ],
    responseExample: `{
  "success": true,
  "favorited": true,
  "totalFavorites": 12
}`,
    codeExamples: {
      curl: `curl -X POST "${BASE_URL}/api/stations/STATION_ID/favorite" \\\n  -H "Authorization: Bearer USER_AUTH_TOKEN" \\\n  -H "Content-Type: application/json"`,
      javascript: `const response = await fetch('${BASE_URL}/api/stations/STATION_ID/favorite', {\n  method: 'POST',\n  headers: {\n    'Authorization': 'Bearer USER_AUTH_TOKEN',\n    'Content-Type': 'application/json'\n  }\n});\nconst result = await response.json();`,
    },
  },
  {
    id: "rate-station",
    method: "POST",
    path: "/api/stations/:id/rate",
    title: "Rate a Station",
    description: "Submit a star rating (1-5) with an optional text comment for a station. Users can update their existing rating.",
    bodyParams: [
      { name: "rating", type: "number", required: true, description: "Star rating from 1 to 5" },
      { name: "comment", type: "string", description: "Optional review text (max 1000 characters)" },
    ],
    responseExample: `{
  "success": true,
  "rating": {
    "rating": 5,
    "comment": "Amazing station!",
    "createdAt": "2025-03-02T22:00:00Z"
  },
  "stats": {
    "averageRating": 4.5,
    "totalRatings": 312,
    "ratingBreakdown": {
      "stars1": 5, "stars2": 8,
      "stars3": 25, "stars4": 89, "stars5": 185
    }
  }
}`,
    codeExamples: {
      curl: `curl -X POST "${BASE_URL}/api/stations/STATION_ID/rate" \\\n  -H "Content-Type: application/json" \\\n  -d '{"rating": 5, "comment": "Amazing station!"}'`,
      javascript: `const response = await fetch('${BASE_URL}/api/stations/STATION_ID/rate', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify({ rating: 5, comment: 'Amazing station!' })\n});\nconst result = await response.json();`,
    },
  },
  {
    id: "user-profile",
    method: "GET",
    path: "/api/users/:id/profile",
    title: "User Profile",
    description: "Get a user's public profile including their favorite stations, listening history, and social connections.",
    params: [
      { name: "id", type: "string", required: true, description: "User ID" },
    ],
    responseExample: `{
  "user": {
    "name": "John Doe",
    "avatar": "https://...",
    "favoriteStations": 24,
    "followers": 150,
    "following": 89,
    "joinedAt": "2024-06-15T10:00:00Z"
  }
}`,
    codeExamples: {
      curl: `curl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/users/USER_ID/profile"`,
      javascript: `const response = await fetch('${BASE_URL}/api/users/USER_ID/profile', {\n  headers: { 'X-API-Key': 'YOUR_KEY' }\n});\nconst profile = await response.json();`,
    },
  },
];

const USER_AUTH_ENDPOINTS: Endpoint[] = [
  {
    id: "web-login",
    method: "POST",
    path: "/api/auth/login",
    title: "Web Login",
    description: "Authenticate a user with email and password. Returns a session cookie for web clients.",
    bodyParams: [
      { name: "email", type: "string", required: true, description: "User's email address" },
      { name: "password", type: "string", required: true, description: "User's password" },
    ],
    responseExample: `{
  "success": true,
  "user": {
    "_id": "64a1b2c3d4e5f6a7b8c9d0e1",
    "name": "John Doe",
    "email": "john@example.com",
    "avatar": "https://..."
  }
}`,
    codeExamples: {
      curl: `curl -X POST "${BASE_URL}/api/auth/login" \\\n  -H "Content-Type: application/json" \\\n  -d '{"email": "john@example.com", "password": "secret"}'`,
      javascript: `const response = await fetch('${BASE_URL}/api/auth/login', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json' },\n  credentials: 'include',\n  body: JSON.stringify({ email: 'john@example.com', password: 'secret' })\n});\nconst { user } = await response.json();`,
    },
  },
  {
    id: "mobile-login",
    method: "POST",
    path: "/api/auth/mobile/login",
    title: "Mobile Login",
    description: "Authenticate from a mobile app. Returns a long-lived auth token (mrt_...) instead of a session cookie. Use this token in the Authorization header for subsequent requests.",
    bodyParams: [
      { name: "email", type: "string", required: true, description: "User's email address" },
      { name: "password", type: "string", required: true, description: "User's password" },
      { name: "deviceInfo", type: "object", description: "Optional device metadata (platform, model, os)" },
    ],
    responseExample: `{
  "success": true,
  "token": "mrt_a1b2c3d4e5f6...",
  "user": {
    "_id": "64a1b2c3d4e5f6a7b8c9d0e1",
    "name": "John Doe",
    "email": "john@example.com"
  }
}`,
    codeExamples: {
      curl: `curl -X POST "${BASE_URL}/api/auth/mobile/login" \\\n  -H "Content-Type: application/json" \\\n  -d '{"email": "john@example.com", "password": "secret"}'`,
      swift: `let body = ["email": "john@example.com", "password": "secret"]\nlet jsonData = try JSONSerialization.data(withJSONObject: body)\n\nvar request = URLRequest(url: URL(string: "${BASE_URL}/api/auth/mobile/login")!)\nrequest.httpMethod = "POST"\nrequest.setValue("application/json", forHTTPHeaderField: "Content-Type")\nrequest.httpBody = jsonData\n\nlet (data, _) = try await URLSession.shared.data(for: request)\nlet result = try JSONDecoder().decode(LoginResponse.self, from: data)\nlet token = result.token  // Store securely in Keychain`,
      kotlin: `val body = JSONObject().apply {\n    put("email", "john@example.com")\n    put("password", "secret")\n}\n\nval request = Request.Builder()\n    .url("${BASE_URL}/api/auth/mobile/login")\n    .post(body.toString().toRequestBody("application/json".toMediaType()))\n    .build()\n\nval response = client.newCall(request).execute()\nval token = JSONObject(response.body?.string() ?: "").getString("token")`,
    },
  },
  {
    id: "register",
    method: "POST",
    path: "/api/auth/register",
    title: "Register",
    description: "Create a new user account with email and password.",
    bodyParams: [
      { name: "name", type: "string", required: true, description: "Display name" },
      { name: "email", type: "string", required: true, description: "Email address" },
      { name: "password", type: "string", required: true, description: "Password (min 6 characters)" },
    ],
    responseExample: `{
  "success": true,
  "user": {
    "_id": "64a1b2c3d4e5f6a7b8c9d0e1",
    "name": "John Doe",
    "email": "john@example.com"
  }
}`,
    codeExamples: {
      curl: `curl -X POST "${BASE_URL}/api/auth/register" \\\n  -H "Content-Type: application/json" \\\n  -d '{"name": "John Doe", "email": "john@example.com", "password": "securepass"}'`,
      javascript: `const response = await fetch('${BASE_URL}/api/auth/register', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify({\n    name: 'John Doe',\n    email: 'john@example.com',\n    password: 'securepass'\n  })\n});`,
    },
  },
  {
    id: "current-user",
    method: "GET",
    path: "/api/auth/me",
    title: "Current User",
    description: "Get the currently authenticated user's profile. Works with both session cookies (web) and auth tokens (mobile).",
    responseExample: `{
  "authenticated": true,
  "user": {
    "_id": "64a1b2c3d4e5f6a7b8c9d0e1",
    "name": "John Doe",
    "email": "john@example.com",
    "avatar": "https://...",
    "favoriteStations": ["id1", "id2"],
    "role": "user"
  }
}`,
    codeExamples: {
      curl: `curl -H "Authorization: Bearer mrt_your_token" "${BASE_URL}/api/auth/me"`,
      javascript: `const response = await fetch('${BASE_URL}/api/auth/me', {\n  headers: { 'Authorization': 'Bearer mrt_your_token' }\n});\nconst { user, authenticated } = await response.json();`,
    },
  },
];

const TV_CAST_ENDPOINTS: Endpoint[] = [
  {
    id: "tv-request-code",
    method: "POST",
    path: "/api/cast/session/create",
    title: "TV: Request Pairing Code",
    description: "Generate a 6-digit pairing code for TV device login. Display this code on the TV screen for the user to enter on their mobile device. Netflix/YouTube-style device activation flow.",
    responseExample: `{
  "sessionId": "cast_abc123",
  "pairingCode": "482915",
  "expiresAt": "2025-03-03T22:00:00Z"
}`,
    codeExamples: {
      curl: `curl -X POST "${BASE_URL}/api/cast/session/create" \\\n  -H "Content-Type: application/json" \\\n  -d '{"deviceType": "tv", "deviceName": "Living Room TV"}'`,
      kotlin: `val body = JSONObject().apply {\n    put("deviceType", "tv")\n    put("deviceName", "Living Room TV")\n}\n\nval request = Request.Builder()\n    .url("${BASE_URL}/api/cast/session/create")\n    .post(body.toString().toRequestBody("application/json".toMediaType()))\n    .build()`,
    },
  },
  {
    id: "tv-poll-status",
    method: "GET",
    path: "/api/cast/session/:sessionId/status",
    title: "TV: Poll Activation Status",
    description: "Poll from the TV device to check if the mobile user has entered the pairing code and activated the session. Poll every 2-3 seconds.",
    params: [
      { name: "sessionId", type: "string", required: true, description: "The session ID from the create step" },
    ],
    responseExample: `{
  "status": "paired",
  "userId": "64a1b2c3d4e5f6a7b8c9d0e1",
  "userName": "John Doe"
}`,
    codeExamples: {
      curl: `curl "${BASE_URL}/api/cast/session/cast_abc123/status"`,
      javascript: `const pollStatus = async (sessionId) => {\n  const response = await fetch(\`${BASE_URL}/api/cast/session/\${sessionId}/status\`);\n  const { status } = await response.json();\n  if (status === 'paired') {\n    console.log('TV activated!');\n  } else {\n    setTimeout(() => pollStatus(sessionId), 3000);\n  }\n};`,
    },
  },
  {
    id: "tv-activate",
    method: "POST",
    path: "/api/cast/session/pair",
    title: "TV: Activate Device (Mobile)",
    description: "Called from the mobile app to enter the pairing code displayed on TV. Links the user's account to the TV session.",
    bodyParams: [
      { name: "pairingCode", type: "string", required: true, description: "6-digit code displayed on TV" },
    ],
    responseExample: `{
  "success": true,
  "sessionId": "cast_abc123",
  "message": "TV device paired successfully"
}`,
    codeExamples: {
      curl: `curl -X POST "${BASE_URL}/api/cast/session/pair" \\\n  -H "Authorization: Bearer mrt_your_token" \\\n  -H "Content-Type: application/json" \\\n  -d '{"pairingCode": "482915"}'`,
      swift: `var request = URLRequest(url: URL(string: "${BASE_URL}/api/cast/session/pair")!)\nrequest.httpMethod = "POST"\nrequest.setValue("Bearer \\(authToken)", forHTTPHeaderField: "Authorization")\nrequest.setValue("application/json", forHTTPHeaderField: "Content-Type")\nrequest.httpBody = try JSONEncoder().encode(["pairingCode": code])`,
    },
  },
  {
    id: "cast-create",
    method: "POST",
    path: "/api/cast/session/create",
    title: "Cast: Create Session",
    description: "Create a Chromecast-style cast session to control playback on a remote device (TV, speaker). The mobile device becomes the controller.",
    bodyParams: [
      { name: "deviceType", type: "string", required: true, description: "'mobile' for the controller device" },
      { name: "stationId", type: "string", description: "Optional: station to start playing immediately" },
    ],
    responseExample: `{
  "sessionId": "cast_xyz789",
  "pairingCode": "319847",
  "wsUrl": "wss://themegaradio.com/ws/cast?session=cast_xyz789&role=mobile"
}`,
    codeExamples: {
      curl: `curl -X POST "${BASE_URL}/api/cast/session/create" \\\n  -H "Authorization: Bearer mrt_your_token" \\\n  -H "Content-Type: application/json" \\\n  -d '{"deviceType": "mobile"}'`,
      javascript: `const response = await fetch('${BASE_URL}/api/cast/session/create', {\n  method: 'POST',\n  headers: {\n    'Authorization': 'Bearer mrt_your_token',\n    'Content-Type': 'application/json'\n  },\n  body: JSON.stringify({ deviceType: 'mobile' })\n});\nconst { sessionId, wsUrl } = await response.json();\n\nconst ws = new WebSocket(wsUrl);\nws.onopen = () => console.log('Connected to cast session');`,
    },
  },
  {
    id: "cast-command",
    method: "POST",
    path: "/api/cast/session/:id/command",
    title: "Cast: Send Command",
    description: "Send playback commands to the paired TV/receiver device through the cast session. Commands are relayed in real-time via WebSocket.",
    bodyParams: [
      { name: "command", type: "string", required: true, description: "Command: play, pause, stop, volume_up, volume_down, change_station" },
      { name: "stationId", type: "string", description: "Station ID (required for change_station command)" },
      { name: "volume", type: "number", description: "Volume level 0-100 (for volume commands)" },
    ],
    responseExample: `{
  "success": true,
  "command": "play",
  "deliveredTo": "tv"
}`,
    codeExamples: {
      curl: `curl -X POST "${BASE_URL}/api/cast/session/cast_xyz789/command" \\\n  -H "Authorization: Bearer mrt_your_token" \\\n  -H "Content-Type: application/json" \\\n  -d '{"command": "change_station", "stationId": "STATION_ID"}'`,
      javascript: `await fetch('${BASE_URL}/api/cast/session/SESSION_ID/command', {\n  method: 'POST',\n  headers: {\n    'Authorization': 'Bearer mrt_your_token',\n    'Content-Type': 'application/json'\n  },\n  body: JSON.stringify({\n    command: 'change_station',\n    stationId: 'STATION_ID'\n  })\n});`,
    },
  },
];

const GuidesContent = memo(({ guideId }: { guideId: string }) => {
  const guides: Record<string, { title: string; lang: string; code: string }> = {
    "guide-javascript": {
      title: "JavaScript / Web Integration",
      lang: "JavaScript",
      code: `import MegaRadio from './mega-radio-client';

const radio = new MegaRadio('YOUR_API_KEY');

// Search for stations
const results = await radio.stations.search('jazz', {
  country: 'Germany',
  limit: 10
});

// Play a station
const station = results.stations[0];
const stream = await radio.stream.resolve(station._id);

const audio = new Audio(stream.url);
audio.play();

// Get now playing info
setInterval(async () => {
  const np = await radio.nowPlaying(station._id);
  document.getElementById('now-playing').textContent =
    \`\${np.artist} - \${np.title}\`;
}, 10000);

// Favorite a station (requires user auth)
await radio.stations.favorite(station._id);`
    },
    "guide-react-native": {
      title: "React Native Integration",
      lang: "React Native",
      code: `import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity } from 'react-native';
import TrackPlayer from 'react-native-track-player';

const API_KEY = 'YOUR_API_KEY';
const BASE = 'https://themegaradio.com/api';

function RadioApp() {
  const [stations, setStations] = useState([]);

  useEffect(() => {
    fetch(\`\${BASE}/stations/popular?limit=20\`, {
      headers: { 'X-API-Key': API_KEY }
    })
      .then(res => res.json())
      .then(setStations);
  }, []);

  const playStation = async (station) => {
    const res = await fetch(
      \`\${BASE}/stream/resolve?stationId=\${station._id}\`,
      { headers: { 'X-API-Key': API_KEY } }
    );
    const { url } = await res.json();

    await TrackPlayer.reset();
    await TrackPlayer.add({
      id: station._id,
      url: url,
      title: station.name,
      artist: station.country,
      artwork: station.favicon
    });
    await TrackPlayer.play();
  };

  return (
    <FlatList
      data={stations}
      renderItem={({ item }) => (
        <TouchableOpacity onPress={() => playStation(item)}>
          <Text>{item.name}</Text>
          <Text>{item.country}</Text>
        </TouchableOpacity>
      )}
    />
  );
}`
    },
    "guide-ios": {
      title: "iOS (Swift) Integration",
      lang: "Swift",
      code: `import Foundation
import AVFoundation

class MegaRadioClient {
    private let apiKey: String
    private let baseURL = "https://themegaradio.com/api"
    private var player: AVPlayer?

    init(apiKey: String) {
        self.apiKey = apiKey
        // Configure audio session for background playback
        try? AVAudioSession.sharedInstance().setCategory(
            .playback, mode: .default
        )
        try? AVAudioSession.sharedInstance().setActive(true)
    }

    func searchStations(
        query: String,
        country: String? = nil,
        limit: Int = 20
    ) async throws -> [Station] {
        var components = URLComponents(
            string: "\\(baseURL)/stations"
        )!
        components.queryItems = [
            URLQueryItem(name: "search", value: query),
            URLQueryItem(name: "limit", value: "\\(limit)")
        ]
        if let country = country {
            components.queryItems?.append(
                URLQueryItem(name: "country", value: country)
            )
        }

        var request = URLRequest(url: components.url!)
        request.setValue(apiKey, forHTTPHeaderField: "X-API-Key")

        let (data, _) = try await URLSession.shared.data(for: request)
        let response = try JSONDecoder().decode(
            StationsResponse.self, from: data
        )
        return response.stations
    }

    func play(stationId: String) async throws {
        var request = URLRequest(
            url: URL(string: "\\(baseURL)/stream/resolve?stationId=\\(stationId)")!
        )
        request.setValue(apiKey, forHTTPHeaderField: "X-API-Key")

        let (data, _) = try await URLSession.shared.data(for: request)
        let stream = try JSONDecoder().decode(StreamInfo.self, from: data)

        let playerItem = AVPlayerItem(url: URL(string: stream.url)!)
        player = AVPlayer(playerItem: playerItem)
        player?.play()
    }
}`
    },
    "guide-android": {
      title: "Android (Kotlin) Integration",
      lang: "Kotlin",
      code: `import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import android.media.MediaPlayer

class MegaRadioClient(private val apiKey: String) {
    private val client = OkHttpClient()
    private val baseUrl = "https://themegaradio.com/api"
    private var mediaPlayer: MediaPlayer? = null

    suspend fun searchStations(
        query: String,
        country: String? = null,
        limit: Int = 20
    ): List<Station> {
        val url = buildString {
            append("$baseUrl/stations?search=$query&limit=$limit")
            country?.let { append("&country=$it") }
        }

        val request = Request.Builder()
            .url(url)
            .header("X-API-Key", apiKey)
            .build()

        val response = client.newCall(request).execute()
        val json = JSONObject(response.body?.string() ?: "")
        val stations = json.getJSONArray("stations")

        return (0 until stations.length()).map { i ->
            val s = stations.getJSONObject(i)
            Station(
                id = s.getString("_id"),
                name = s.getString("name"),
                country = s.optString("country", ""),
                favicon = s.optString("favicon", "")
            )
        }
    }

    suspend fun playStation(stationId: String) {
        val request = Request.Builder()
            .url("$baseUrl/stream/resolve?stationId=$stationId")
            .header("X-API-Key", apiKey)
            .build()

        val response = client.newCall(request).execute()
        val json = JSONObject(response.body?.string() ?: "")
        val streamUrl = json.getString("url")

        mediaPlayer?.release()
        mediaPlayer = MediaPlayer().apply {
            setDataSource(streamUrl)
            prepareAsync()
            setOnPreparedListener { start() }
        }
    }
}`
    },
  };

  const guide = guides[guideId];
  if (!guide) return <div className="text-slate-400">Guide not found.</div>;

  return (
    <div>
      <h1 className="text-4xl font-bold text-white mb-4">{guide.title}</h1>
      <p className="text-lg text-slate-400 leading-relaxed mb-8">Complete example showing how to integrate Mega Radio API into your {guide.lang} application.</p>
      <CodeBlock code={guide.code} lang={guide.lang} />
    </div>
  );
});

function EndpointSection({ title, description, endpoints }: { title: string; description: string; endpoints: Endpoint[] }) {
  return (
    <div>
      <h1 className="text-4xl font-bold text-white mb-4">{title}</h1>
      <p className="text-lg text-slate-400 leading-relaxed mb-10">{description}</p>
      {endpoints.map((ep) => <EndpointCard key={ep.id} endpoint={ep} />)}
    </div>
  );
}

function Sidebar({ activeId, onNavigate, searchQuery, onSearchChange, mobileOpen, onMobileClose }: {
  activeId: string;
  onNavigate: (id: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}) {
  const filteredSections = useMemo(() => {
    if (!searchQuery) return NAV_SECTIONS;
    const q = searchQuery.toLowerCase();
    return NAV_SECTIONS.map((section) => ({
      ...section,
      items: section.items.filter((item) => item.label.toLowerCase().includes(q) || section.label.toLowerCase().includes(q)),
    })).filter((s) => s.items.length > 0);
  }, [searchQuery]);

  const content = (
    <>
      <div className="p-4 border-b border-white/5">
        <a href="/en" className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
            <Radio className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="text-white font-bold text-sm leading-none">Mega Radio</div>
            <div className="text-[10px] text-slate-500 uppercase tracking-widest mt-0.5">API Reference</div>
          </div>
        </a>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search docs..."
            className="w-full bg-white/5 border border-white/5 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500/50 transition-colors"
          />
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto p-3 space-y-1">
        {filteredSections.map((section) => (
          <div key={section.id} className="mb-3">
            <div className="flex items-center gap-2 px-3 py-1.5 text-[10px] uppercase tracking-[0.15em] text-slate-500 font-semibold">
              <section.icon className="w-3.5 h-3.5" />
              {section.label}
            </div>
            {section.items.map((item) => (
              <button
                key={item.id}
                onClick={() => { onNavigate(item.id); onMobileClose(); }}
                className={`w-full text-left px-3 py-1.5 rounded-md text-[13px] transition-colors ${
                  activeId === item.id
                    ? "bg-blue-500/10 text-blue-400 font-medium"
                    : "text-slate-400 hover:text-white hover:bg-white/5"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="p-4 border-t border-white/5">
        <a href="/api-user" className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-500/10 text-blue-400 text-sm font-medium hover:bg-blue-500/20 transition-colors">
          <Shield className="w-4 h-4" />
          Developer Portal
          <ArrowRight className="w-3.5 h-3.5 ml-auto" />
        </a>
      </div>
    </>
  );

  return (
    <>
      <aside className="hidden lg:flex flex-col w-[260px] h-screen sticky top-0 bg-[#0a0a14] border-r border-white/5 shrink-0">
        {content}
      </aside>
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/60" onClick={onMobileClose} />
          <aside className="absolute left-0 top-0 bottom-0 w-[280px] bg-[#0a0a14] flex flex-col shadow-2xl">
            <div className="flex items-center justify-end p-2 border-b border-white/5">
              <button onClick={onMobileClose} className="p-2 text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            {content}
          </aside>
        </div>
      )}
    </>
  );
}

const SECTION_CONTENT: Record<string, () => JSX.Element> = {
  introduction: () => <IntroductionContent />,
  authentication: () => <AuthenticationContent />,
  "rate-limits": () => <RateLimitsContent />,
  errors: () => <ErrorsContent />,
  "list-stations": () => <EndpointSection title="Stations" description="Browse, search, and discover radio stations from our database of 40,000+ stations worldwide." endpoints={STATION_ENDPOINTS} />,
  "get-station": () => <EndpointSection title="Stations" description="Browse, search, and discover radio stations." endpoints={STATION_ENDPOINTS} />,
  "popular-stations": () => <EndpointSection title="Stations" description="Browse, search, and discover radio stations." endpoints={STATION_ENDPOINTS} />,
  "search-stations": () => <EndpointSection title="Stations" description="Browse, search, and discover radio stations." endpoints={STATION_ENDPOINTS} />,
  "nearby-stations": () => <EndpointSection title="Stations" description="Browse, search, and discover radio stations." endpoints={STATION_ENDPOINTS} />,
  "similar-stations": () => <EndpointSection title="Stations" description="Browse, search, and discover radio stations." endpoints={STATION_ENDPOINTS} />,
  "random-station": () => <EndpointSection title="Stations" description="Browse, search, and discover radio stations." endpoints={STATION_ENDPOINTS} />,
  "station-stats": () => <EndpointSection title="Stations" description="Browse, search, and discover radio stations." endpoints={STATION_ENDPOINTS} />,
  "list-genres": () => <EndpointSection title="Discovery" description="Explore genres, countries, languages, and trending stations to help users discover new content." endpoints={DISCOVERY_ENDPOINTS} />,
  "list-countries": () => <EndpointSection title="Discovery" description="Explore genres, countries, languages, and trending stations." endpoints={DISCOVERY_ENDPOINTS} />,
  "list-languages": () => <EndpointSection title="Discovery" description="Explore genres, countries, languages, and trending stations." endpoints={DISCOVERY_ENDPOINTS} />,
  trending: () => <EndpointSection title="Discovery" description="Explore genres, countries, languages, and trending stations." endpoints={DISCOVERY_ENDPOINTS} />,
  "resolve-stream": () => <EndpointSection title="Streaming" description="Resolve stream URLs and get real-time now-playing metadata for live radio playback." endpoints={STREAMING_ENDPOINTS} />,
  "now-playing": () => <EndpointSection title="Streaming" description="Resolve stream URLs and get real-time now-playing metadata." endpoints={STREAMING_ENDPOINTS} />,
  "favorite-station": () => <EndpointSection title="Engagement" description="User engagement features including favorites, ratings, and profile management." endpoints={ENGAGEMENT_ENDPOINTS} />,
  "rate-station": () => <EndpointSection title="Engagement" description="User engagement features." endpoints={ENGAGEMENT_ENDPOINTS} />,
  "user-profile": () => <EndpointSection title="Engagement" description="User engagement features." endpoints={ENGAGEMENT_ENDPOINTS} />,
  "web-login": () => <EndpointSection title="User Authentication" description="Authenticate users via web sessions, mobile tokens, or account registration." endpoints={USER_AUTH_ENDPOINTS} />,
  "mobile-login": () => <EndpointSection title="User Authentication" description="Authenticate users via web sessions, mobile tokens, or account registration." endpoints={USER_AUTH_ENDPOINTS} />,
  register: () => <EndpointSection title="User Authentication" description="Authenticate users." endpoints={USER_AUTH_ENDPOINTS} />,
  "current-user": () => <EndpointSection title="User Authentication" description="Authenticate users." endpoints={USER_AUTH_ENDPOINTS} />,
  "tv-request-code": () => <EndpointSection title="TV & Cast" description="Control playback on TV devices and Chromecast receivers. Supports Netflix-style device pairing and real-time command relay via WebSocket." endpoints={TV_CAST_ENDPOINTS} />,
  "tv-poll-status": () => <EndpointSection title="TV & Cast" description="TV device pairing and cast control." endpoints={TV_CAST_ENDPOINTS} />,
  "tv-activate": () => <EndpointSection title="TV & Cast" description="TV device pairing and cast control." endpoints={TV_CAST_ENDPOINTS} />,
  "cast-create": () => <EndpointSection title="TV & Cast" description="TV device pairing and cast control." endpoints={TV_CAST_ENDPOINTS} />,
  "cast-command": () => <EndpointSection title="TV & Cast" description="TV device pairing and cast control." endpoints={TV_CAST_ENDPOINTS} />,
  "guide-javascript": () => <GuidesContent guideId="guide-javascript" />,
  "guide-react-native": () => <GuidesContent guideId="guide-react-native" />,
  "guide-ios": () => <GuidesContent guideId="guide-ios" />,
  "guide-android": () => <GuidesContent guideId="guide-android" />,
};

export default function ApiDocs() {
  const [, params] = useRoute("/api-docs/:category");
  const [, navigate] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);

  const activeId = params?.category || "introduction";

  const handleNavigate = useCallback((id: string) => {
    navigate(`/api-docs/${id}`);
    window.scrollTo(0, 0);
  }, [navigate]);

  useEffect(() => {
    if (activeId && SECTION_CONTENT[activeId]) {
      const el = document.getElementById(activeId);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [activeId]);

  const ContentComponent = SECTION_CONTENT[activeId] || SECTION_CONTENT["introduction"];

  const breadcrumbSection = NAV_SECTIONS.find((s) => s.items.some((i) => i.id === activeId));
  const breadcrumbItem = breadcrumbSection?.items.find((i) => i.id === activeId);

  return (
    <div className="flex min-h-screen bg-[#0d0d1a] text-white">
      <Sidebar
        activeId={activeId}
        onNavigate={handleNavigate}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />
      <main className="flex-1 min-w-0">
        <header className="sticky top-0 z-10 bg-[#0d0d1a]/80 backdrop-blur-xl border-b border-white/5">
          <div className="flex items-center gap-3 px-6 py-3">
            <button onClick={() => setMobileOpen(true)} className="lg:hidden p-1.5 text-slate-400 hover:text-white">
              <Menu className="w-5 h-5" />
            </button>
            {breadcrumbSection && breadcrumbItem && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-slate-500">{breadcrumbSection.label}</span>
                <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
                <span className="text-white font-medium">{breadcrumbItem.label}</span>
              </div>
            )}
            <div className="ml-auto flex items-center gap-3">
              <a href="/api-user" className="text-xs text-slate-400 hover:text-white transition-colors">Dashboard</a>
              <a href="/en" className="text-xs text-slate-400 hover:text-white transition-colors">Back to Radio</a>
            </div>
          </div>
        </header>
        <div className="max-w-4xl mx-auto px-6 py-10">
          <ContentComponent />
        </div>
        <footer className="border-t border-white/5 mt-20">
          <div className="max-w-4xl mx-auto px-6 py-8 text-center">
            <p className="text-sm text-slate-500">Mega Radio API v1.0 — Need help? Contact <a href="mailto:api@themegaradio.com" className="text-blue-400 hover:text-blue-300">api@themegaradio.com</a></p>
          </div>
        </footer>
      </main>
    </div>
  );
}
