import { useState, useEffect, useCallback, memo, useMemo } from "react";
import { useRoute, useLocation } from "wouter";
import { Copy, Check, ChevronRight, Search, Radio, Zap, Shield, Globe, Tv, Cast, Code, BookOpen, AlertTriangle, Users, Heart, Menu, X, ExternalLink, ArrowRight, Bell, Clock, Music, MessageSquare } from "lucide-react";

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
  headers?: Param[];
  responseExample: string;
  codeExamples: Partial<Record<CodeLang, string>>;
  notes?: string[];
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
      { id: "track-click", label: "Track Click" },
    ],
  },
  {
    id: "discovery",
    label: "Discovery",
    icon: Globe,
    items: [
      { id: "list-genres", label: "List Genres" },
      { id: "genre-stations", label: "Genre Stations" },
      { id: "discoverable-genres", label: "Discoverable Genres" },
      { id: "list-countries", label: "List Countries" },
      { id: "list-languages", label: "List Languages" },
      { id: "trending", label: "Trending Stations" },
      { id: "community-favorites", label: "Community Favorites" },
      { id: "diverse-recommendations", label: "Recommendations" },
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
    id: "user-auth",
    label: "Authentication",
    icon: Users,
    items: [
      { id: "signup", label: "Sign Up" },
      { id: "web-login", label: "Web Login" },
      { id: "mobile-login", label: "Mobile Login" },
      { id: "google-login", label: "Google Sign-In" },
      { id: "apple-login", label: "Apple Sign-In" },
      { id: "current-user", label: "Current User" },
    ],
  },
  {
    id: "user-data",
    label: "User Data",
    icon: Heart,
    items: [
      { id: "list-favorites", label: "List Favorites" },
      { id: "add-favorite", label: "Add Favorite" },
      { id: "remove-favorite", label: "Remove Favorite" },
      { id: "list-recently-played", label: "Recently Played" },
      { id: "add-recently-played", label: "Add Recently Played" },
      { id: "rate-station", label: "Rate a Station" },
      { id: "register-push-token", label: "Register Push Token" },
      { id: "unregister-push-token", label: "Unregister Push Token" },
    ],
  },
  {
    id: "tv",
    label: "TV & Cast",
    icon: Tv,
    items: [
      { id: "tv-init", label: "TV/Mobile Init" },
      { id: "tv-request-code", label: "TV: Request Code" },
      { id: "tv-poll-status", label: "TV: Poll Status" },
      { id: "tv-activate", label: "TV: Activate Device" },
      { id: "cast-create", label: "Cast: Create Session" },
      { id: "cast-command", label: "Cast: Send Command" },
    ],
  },
  {
    id: "messaging",
    label: "Messaging",
    icon: MessageSquare,
    items: [
      { id: "msg-conversations", label: "List Conversations" },
      { id: "msg-conversation", label: "Get Conversation" },
      { id: "msg-send", label: "Send Message" },
      { id: "msg-contacts", label: "List Contacts" },
      { id: "msg-unread", label: "Unread Count" },
      { id: "msg-search-users", label: "Search Users" },
      { id: "msg-online-status", label: "Online Status" },
      { id: "msg-upload-image", label: "Upload Image" },
      { id: "msg-websocket", label: "WebSocket (Real-time)" },
    ],
  },
  {
    id: "misc",
    label: "Misc",
    icon: Music,
    items: [
      { id: "translations", label: "App Translations" },
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
      {endpoint.headers && <ParamTable params={endpoint.headers} title="Headers" />}
      {endpoint.notes && endpoint.notes.length > 0 && (
        <div className="mt-4 p-4 rounded-lg bg-blue-500/5 border border-blue-500/20">
          <div className="flex gap-3">
            <AlertTriangle className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              {endpoint.notes.map((note, i) => (
                <p key={i} className="text-blue-200/80 text-sm">{note}</p>
              ))}
            </div>
          </div>
        </div>
      )}
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
      <CodeBlock code={`# 1. Get a free demo API key (valid 24h)\ncurl ${BASE_URL}/api/api-keys/demo\n\n# 2. Search for stations\ncurl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/stations?search=jazz&limit=5"\n\n# 3. Get station details\ncurl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/station/bbc-radio-1"\n\n# 4. Get stations by country (supports English, native, ISO-2, ISO-3 codes)\ncurl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/stations?country=Turkey&limit=10"\ncurl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/stations?country=DE&limit=10"\ncurl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/stations?country=AUT&limit=10"`} lang="Quick Start" />
    </div>
    <div className="mt-8">
      <h2 className="text-2xl font-bold text-white mb-4">Country Filter Formats</h2>
      <p className="text-slate-400 mb-4">The <code className="bg-white/5 px-1.5 py-0.5 rounded text-xs text-sky-400">country</code> parameter accepts multiple formats across all endpoints:</p>
      <div className="border border-white/5 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="bg-white/[0.03]">
            <th className="text-left px-5 py-3 text-slate-400 font-semibold text-xs uppercase tracking-wider">Format</th>
            <th className="text-left px-5 py-3 text-slate-400 font-semibold text-xs uppercase tracking-wider">Example</th>
            <th className="text-left px-5 py-3 text-slate-400 font-semibold text-xs uppercase tracking-wider">Resolves To</th>
          </tr></thead>
          <tbody>
            {[
              { format: "English Name", example: "Germany", resolves: "Germany" },
              { format: "ISO-2 Code", example: "DE", resolves: "Germany" },
              { format: "ISO-3 Code", example: "DEU", resolves: "Germany" },
              { format: "Native Name", example: "Deutschland", resolves: "Germany" },
              { format: "Turkish Name", example: "Almanya", resolves: "Germany" },
              { format: "Case-insensitive", example: "turkey, TURKEY, Turkey", resolves: "Turkey" },
              { format: "ASCII variant", example: "turkiye, Turkiye", resolves: "Turkey" },
            ].map((r, i) => (
              <tr key={r.format} className={i % 2 === 0 ? "" : "bg-white/[0.01]"}>
                <td className="px-5 py-3 text-white font-medium">{r.format}</td>
                <td className="px-5 py-3 text-sky-400 font-mono text-[13px]">{r.example}</td>
                <td className="px-5 py-3 text-slate-400">{r.resolves}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
            { plan: "Internal", rpm: "Unlimited", daily: "Unlimited", monthly: "Unlimited", price: "--", color: "text-purple-400" },
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
            { code: "401", status: "Unauthorized", desc: "Missing or invalid API key / auth token", color: "text-red-400" },
            { code: "403", status: "Forbidden", desc: "API key lacks permission for this action", color: "text-red-400" },
            { code: "404", status: "Not Found", desc: "Resource not found", color: "text-amber-400" },
            { code: "429", status: "Too Many Requests", desc: "Rate limit or quota exceeded", color: "text-red-400" },
            { code: "500", status: "Internal Error", desc: "Server error -- please retry or contact support", color: "text-red-400" },
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
    description: "Retrieve a paginated list of radio stations. Supports filtering by country, genre, language, tags, and more. The country parameter accepts English names, native names, Turkish names, ISO-2 codes (DE), and ISO-3 codes (DEU).",
    params: [
      { name: "page", type: "number", default: "1", description: "Page number for pagination" },
      { name: "limit", type: "number", default: "25", description: "Number of stations per page (max 100)" },
      { name: "country", type: "string", description: "Filter by country. Accepts: English (Germany), native (Deutschland), Turkish (Almanya), ISO-2 (DE), ISO-3 (DEU)" },
      { name: "state", type: "string", description: "Filter by state/region (e.g., 'Bavaria', 'Wien')" },
      { name: "genre", type: "string", description: "Filter by genre (e.g., 'rock', 'jazz', 'pop')" },
      { name: "tags", type: "string", description: "Filter by tags (partial match, e.g., 'electronic')" },
      { name: "language", type: "string", description: "Filter by language (e.g., 'english', 'turkish', 'german')" },
      { name: "search", type: "string", description: "Full-text search across station name, country, genre, and tags" },
      { name: "sort", type: "string", default: "votes", description: "Sort field: votes, az (A-Z), za (Z-A), newest, oldest" },
      { name: "order", type: "string", default: "desc", description: "Sort order: asc or desc" },
      { name: "excludeBroken", type: "boolean", default: "false", description: "Exclude stations that failed last health check" },
      { name: "minVotes", type: "number", default: "0", description: "Minimum vote count filter" },
      { name: "tv", type: "string", description: "Set to '1' for optimized TV/mobile response with fewer fields" },
      { name: "excludeStationIds", type: "string", description: "Comma-separated station IDs to exclude from results" },
    ],
    notes: [
      "The country param supports 219 countries in multiple name formats (English, native, Turkish, ISO-2, ISO-3).",
      "When tv=1 is set, the response uses a slimmer projection optimized for TV/mobile apps.",
    ],
    responseExample: `{
  "stations": [
    {
      "_id": "64a1b2c3d4e5f6a7b8c9d0e1",
      "name": "BBC Radio 1",
      "slug": "bbc-radio-1",
      "url": "https://stream.live.vc.bbcmedia.co.uk/bbc_radio_one",
      "favicon": "https://cdn-radiotime-logos.tunein.com/s24939q.png",
      "country": "The United Kingdom Of Great Britain And Northern Ireland",
      "countrycode": "GB",
      "state": "",
      "language": "english",
      "genre": "pop",
      "tags": "pop,dance,electronic",
      "codec": "MP3",
      "bitrate": 128,
      "votes": 15234,
      "clickCount": 89421,
      "lastCheckOk": true,
      "hls": false,
      "logoAssets": { "webp256": "https://...", "status": "completed" }
    }
  ],
  "totalCount": 42150,
  "count": 42150,
  "pagination": {
    "page": 1,
    "limit": 25,
    "total": 42150,
    "pages": 1686
  }
}`,
    codeExamples: {
      curl: `# Filter by country (English name)\ncurl -H "X-API-Key: YOUR_KEY" \\\n  "${BASE_URL}/api/stations?country=Germany&genre=rock&limit=10"\n\n# Filter by ISO-2 code\ncurl -H "X-API-Key: YOUR_KEY" \\\n  "${BASE_URL}/api/stations?country=DE&genre=rock&limit=10"\n\n# Filter by ISO-3 code\ncurl -H "X-API-Key: YOUR_KEY" \\\n  "${BASE_URL}/api/stations?country=DEU&genre=rock&limit=10"\n\n# Filter by Turkish name\ncurl -H "X-API-Key: YOUR_KEY" \\\n  "${BASE_URL}/api/stations?country=Almanya&genre=rock&limit=10"\n\n# TV/Mobile optimized response\ncurl -H "X-API-Key: YOUR_KEY" \\\n  "${BASE_URL}/api/stations?country=TR&limit=20&tv=1"`,
      javascript: `const response = await fetch('${BASE_URL}/api/stations?country=DE&genre=rock&limit=10', {\n  headers: { 'X-API-Key': 'YOUR_KEY' }\n});\nconst data = await response.json();\nconsole.log(data.stations);       // Array of stations\nconsole.log(data.totalCount);     // Total matching stations\nconsole.log(data.pagination);     // { page, limit, total, pages }`,
      python: `import requests\n\nresponse = requests.get(\n    '${BASE_URL}/api/stations',\n    headers={'X-API-Key': 'YOUR_KEY'},\n    params={\n        'country': 'DE',       # or 'Germany', 'DEU', 'Deutschland'\n        'genre': 'rock',\n        'limit': 10\n    }\n)\ndata = response.json()\nstations = data['stations']\ntotal = data['totalCount']`,
      swift: `var components = URLComponents(string: "${BASE_URL}/api/stations")!\ncomponents.queryItems = [\n    URLQueryItem(name: "country", value: "DE"),\n    URLQueryItem(name: "genre", value: "rock"),\n    URLQueryItem(name: "limit", value: "10"),\n    URLQueryItem(name: "tv", value: "1")\n]\nvar request = URLRequest(url: components.url!)\nrequest.setValue("YOUR_KEY", forHTTPHeaderField: "X-API-Key")`,
      kotlin: `val url = "${BASE_URL}/api/stations?country=DE&genre=rock&limit=10&tv=1"\nval request = Request.Builder()\n    .url(url)\n    .header("X-API-Key", "YOUR_KEY")\n    .build()\n\nval response = client.newCall(request).execute()\nval json = JSONObject(response.body?.string() ?: "")\nval stations = json.getJSONArray("stations")\nval totalCount = json.getInt("totalCount")`,
    },
  },
  {
    id: "get-station",
    method: "GET",
    path: "/api/station/:identifier",
    title: "Get Station Details",
    description: "Retrieve detailed information about a specific station by its slug or MongoDB ID. Returns full metadata including stream URL, logo assets, ratings, and localized AI descriptions.",
    params: [
      { name: "identifier", type: "string", required: true, description: "Station slug (e.g., 'bbc-radio-1') or MongoDB ObjectId" },
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
  "country": "The United Kingdom Of Great Britain And Northern Ireland",
  "countrycode": "GB",
  "state": "",
  "tags": "pop,dance,electronic,bbc",
  "language": "english",
  "genre": "pop",
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
    "tr": "BBC Radio 1, BBC'nin populer muzik ve genclik kulturu istasyonudur..."
  }
}`,
    codeExamples: {
      curl: `# By slug\ncurl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/station/bbc-radio-1"\n\n# By MongoDB ID\ncurl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/station/64a1b2c3d4e5f6a7b8c9d0e1"`,
      javascript: `const response = await fetch('${BASE_URL}/api/station/bbc-radio-1', {\n  headers: { 'X-API-Key': 'YOUR_KEY' }\n});\nconst station = await response.json();`,
      python: `response = requests.get(\n    '${BASE_URL}/api/station/bbc-radio-1',\n    headers={'X-API-Key': 'YOUR_KEY'}\n)\nstation = response.json()`,
      swift: `let url = URL(string: "${BASE_URL}/api/station/bbc-radio-1")!\nvar request = URLRequest(url: url)\nrequest.setValue("YOUR_KEY", forHTTPHeaderField: "X-API-Key")\nlet (data, _) = try await URLSession.shared.data(for: request)`,
      kotlin: `val request = Request.Builder()\n    .url("${BASE_URL}/api/station/bbc-radio-1")\n    .header("X-API-Key", "YOUR_KEY")\n    .build()`,
    },
  },
  {
    id: "popular-stations",
    method: "GET",
    path: "/api/stations/popular",
    title: "Popular Stations",
    description: "Get the most popular stations globally or filtered by country/state. Sorted by a combination of votes and recent click trends. Uses precomputed data for fast response.",
    params: [
      { name: "country", type: "string", description: "Filter by country (supports all country formats: English, ISO-2, ISO-3, native, Turkish)" },
      { name: "state", type: "string", description: "Filter by state/region" },
      { name: "limit", type: "number", default: "20", description: "Number of stations to return (max 50)" },
      { name: "excludeBroken", type: "boolean", default: "false", description: "Exclude stations that failed health check" },
      { name: "tv", type: "string", description: "Set to '1' for TV/mobile optimized slim response" },
    ],
    responseExample: `[
  {
    "_id": "64a1b2c3d4e5f6a7b8c9d0e1",
    "name": "NRJ France",
    "slug": "nrj-france",
    "url": "https://stream.nrj.fr/nrj/nrj_mp3_128k",
    "favicon": "https://...",
    "country": "France",
    "countrycode": "FR",
    "genre": "pop",
    "tags": "pop,dance,hits",
    "codec": "MP3",
    "bitrate": 128,
    "votes": 28410,
    "clickCount": 145200,
    "lastCheckOk": true
  }
]`,
    codeExamples: {
      curl: `# Global popular\ncurl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/stations/popular?limit=10"\n\n# Popular in Turkey (using ISO-2)\ncurl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/stations/popular?country=TR&limit=10"\n\n# TV/Mobile optimized\ncurl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/stations/popular?country=DE&limit=20&tv=1"`,
      javascript: `const response = await fetch('${BASE_URL}/api/stations/popular?country=TR&limit=10', {\n  headers: { 'X-API-Key': 'YOUR_KEY' }\n});\nconst popular = await response.json(); // Array of stations`,
      python: `response = requests.get(\n    '${BASE_URL}/api/stations/popular',\n    headers={'X-API-Key': 'YOUR_KEY'},\n    params={'country': 'TR', 'limit': 10}\n)\npopular = response.json()  # List of stations`,
    },
  },
  {
    id: "search-stations",
    method: "GET",
    path: "/api/stations?search=:query",
    title: "Search Stations",
    description: "Full-text search across station names, country, genre, and tags. Combine with country, genre, and language filters for refined results. Genre-specific searches (e.g., 'jazz', 'rock') receive automatic relevance boosting.",
    params: [
      { name: "search", type: "string", required: true, description: "Search query (e.g., 'jazz', 'bbc', 'classical piano')" },
      { name: "country", type: "string", description: "Narrow results to a specific country (all formats supported)" },
      { name: "genre", type: "string", description: "Narrow results to a specific genre" },
      { name: "language", type: "string", description: "Filter by language" },
      { name: "limit", type: "number", default: "25", description: "Number of results (max 100)" },
      { name: "page", type: "number", default: "1", description: "Page number for pagination" },
    ],
    responseExample: `{
  "stations": [
    {
      "_id": "64a1b2c3d4e5f6a7b8c9d0e1",
      "name": "WBGO Jazz 88.3",
      "slug": "wbgo-jazz-88-3",
      "url": "https://...",
      "favicon": "https://...",
      "tags": "jazz,blues,soul",
      "country": "The United States Of America",
      "countrycode": "US",
      "genre": "jazz",
      "votes": 5420
    }
  ],
  "totalCount": 847,
  "count": 847,
  "pagination": {
    "page": 1,
    "limit": 25,
    "total": 847,
    "pages": 34
  }
}`,
    codeExamples: {
      curl: `curl -H "X-API-Key: YOUR_KEY" \\\n  "${BASE_URL}/api/stations?search=jazz&country=US&limit=5"`,
      javascript: `const response = await fetch(\n  '${BASE_URL}/api/stations?search=jazz&country=US&limit=5',\n  { headers: { 'X-API-Key': 'YOUR_KEY' } }\n);\nconst { stations, totalCount, pagination } = await response.json();`,
      python: `response = requests.get(\n    '${BASE_URL}/api/stations',\n    headers={'X-API-Key': 'YOUR_KEY'},\n    params={'search': 'jazz', 'country': 'US', 'limit': 5}\n)\nresults = response.json()`,
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
      { name: "id", type: "string", required: true, description: "Station ID (MongoDB ObjectId)" },
      { name: "limit", type: "number", default: "6", description: "Number of similar stations to return" },
    ],
    responseExample: `[
  {
    "_id": "64a1b2c3d4e5f6a7b8c9d0e1",
    "name": "Kiss FM UK",
    "slug": "kiss-fm-uk",
    "url": "https://...",
    "favicon": "https://...",
    "country": "The United Kingdom Of Great Britain And Northern Ireland",
    "tags": "dance,pop,electronic",
    "votes": 12500
  }
]`,
    codeExamples: {
      curl: `curl -H "X-API-Key: YOUR_KEY" \\\n  "${BASE_URL}/api/stations/similar/64a1b2c3d4e5f6a7b8c9d0e1?limit=5"`,
      javascript: `const response = await fetch(\n  '${BASE_URL}/api/stations/similar/STATION_ID?limit=5',\n  { headers: { 'X-API-Key': 'YOUR_KEY' } }\n);\nconst similar = await response.json();`,
    },
  },
  {
    id: "random-station",
    method: "GET",
    path: "/api/stations/country-random",
    title: "Random Station",
    description: "Get a random radio station from a specific country using MongoDB $sample aggregation. The country parameter is required. Returns a single random station.",
    params: [
      { name: "country", type: "string", required: true, description: "Country to pick a random station from (all formats supported: English, ISO-2, ISO-3, native, Turkish)" },
    ],
    responseExample: `{
  "_id": "64a1b2c3d4e5f6a7b8c9d0e1",
  "name": "Radio Nova",
  "slug": "radio-nova",
  "url": "https://...",
  "favicon": "https://...",
  "country": "Finland",
  "countrycode": "FI",
  "tags": "pop,rock",
  "votes": 3200,
  "lastCheckOk": true
}`,
    codeExamples: {
      curl: `# Random station from Turkey\ncurl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/stations/country-random?country=TR"\n\n# Random station from Germany\ncurl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/stations/country-random?country=Germany"`,
      javascript: `const response = await fetch(\n  '${BASE_URL}/api/stations/country-random?country=TR',\n  { headers: { 'X-API-Key': 'YOUR_KEY' } }\n);\nconst randomStation = await response.json();`,
    },
  },
  {
    id: "track-click",
    method: "POST",
    path: "/api/stations/:id/click",
    title: "Track Station Click",
    description: "Increment the click count for a station. Call this when a user starts playing a station to improve popularity rankings and trending data.",
    params: [
      { name: "id", type: "string", required: true, description: "Station ID (MongoDB ObjectId)" },
    ],
    responseExample: `{
  "success": true
}`,
    codeExamples: {
      curl: `curl -X POST -H "X-API-Key: YOUR_KEY" \\\n  "${BASE_URL}/api/stations/64a1b2c3d4e5f6a7b8c9d0e1/click"`,
      javascript: `await fetch('${BASE_URL}/api/stations/STATION_ID/click', {\n  method: 'POST',\n  headers: { 'X-API-Key': 'YOUR_KEY' }\n});`,
    },
  },
];

const DISCOVERY_ENDPOINTS: Endpoint[] = [
  {
    id: "list-genres",
    method: "GET",
    path: "/api/genres/precomputed",
    title: "List Genres (Precomputed)",
    description: "Get precomputed genres with station counts. Supports pagination and search. Optionally filter by country to see genres available in a specific country. Results are cached for fast response.",
    params: [
      { name: "countryName", type: "string", description: "Filter genres by country (e.g., 'Germany', 'TR', 'DEU'). Defaults to 'global'." },
      { name: "country", type: "string", description: "Alias for countryName parameter" },
      { name: "page", type: "number", default: "1", description: "Page number for pagination" },
      { name: "limit", type: "number", default: "27", description: "Genres per page (max 200)" },
      { name: "search", type: "string", description: "Search genre name/slug" },
    ],
    responseExample: `{
  "success": true,
  "data": [
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
  ],
  "genres": [...],
  "count": 850,
  "total": 850,
  "currentPage": 1,
  "page": 1,
  "perPage": 27,
  "limit": 27,
  "totalPages": 32,
  "computedAt": "2025-03-02T10:00:00Z",
  "countryName": "global"
}`,
    codeExamples: {
      curl: `# All genres globally\ncurl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/genres/precomputed"\n\n# Genres in Germany\ncurl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/genres/precomputed?countryName=Germany"\n\n# Search genres\ncurl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/genres/precomputed?search=rock&limit=10"`,
      javascript: `const response = await fetch('${BASE_URL}/api/genres/precomputed?countryName=DE&limit=20', {\n  headers: { 'X-API-Key': 'YOUR_KEY' }\n});\nconst { data: genres, totalPages, count } = await response.json();`,
      python: `response = requests.get(\n    '${BASE_URL}/api/genres/precomputed',\n    headers={'X-API-Key': 'YOUR_KEY'},\n    params={'countryName': 'DE', 'limit': 20}\n)\ndata = response.json()\ngenres = data['data']  # or data['genres']\ntotal = data['count']`,
    },
  },
  {
    id: "genre-stations",
    method: "GET",
    path: "/api/genres/:slug/stations",
    title: "Get Stations by Genre",
    description: "Get paginated stations for a specific genre by its slug. Optionally filter by country. Returns genre metadata alongside the station list.",
    params: [
      { name: "slug", type: "string", required: true, description: "Genre slug (e.g., 'rock', 'jazz', 'electronic')" },
      { name: "country", type: "string", description: "Filter stations within this genre by country (all formats supported)" },
      { name: "page", type: "number", default: "1", description: "Page number" },
      { name: "limit", type: "number", default: "20", description: "Stations per page (max 100)" },
    ],
    responseExample: `{
  "genre": {
    "name": "Rock",
    "slug": "rock",
    "stationCount": 6210
  },
  "stations": [
    {
      "_id": "...",
      "name": "Classic Rock FM",
      "slug": "classic-rock-fm",
      "url": "https://...",
      "favicon": "https://...",
      "country": "Germany",
      "tags": "rock,classic rock",
      "votes": 4500
    }
  ],
  "total": 6210,
  "page": 1,
  "pages": 311
}`,
    codeExamples: {
      curl: `# All rock stations\ncurl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/genres/rock/stations?limit=20"\n\n# Rock stations in Turkey\ncurl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/genres/rock/stations?country=TR&limit=10"\n\n# Jazz stations page 2\ncurl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/genres/jazz/stations?page=2&limit=20"`,
      javascript: `const response = await fetch(\n  '${BASE_URL}/api/genres/rock/stations?country=TR&limit=20',\n  { headers: { 'X-API-Key': 'YOUR_KEY' } }\n);\nconst { genre, stations, total, page, pages } = await response.json();`,
      python: `response = requests.get(\n    '${BASE_URL}/api/genres/rock/stations',\n    headers={'X-API-Key': 'YOUR_KEY'},\n    params={'country': 'TR', 'limit': 20}\n)\ndata = response.json()\nstations = data['stations']\ngenre_info = data['genre']`,
      swift: `let url = URL(string: "${BASE_URL}/api/genres/rock/stations?country=TR&limit=20")!\nvar request = URLRequest(url: url)\nrequest.setValue("YOUR_KEY", forHTTPHeaderField: "X-API-Key")\nlet (data, _) = try await URLSession.shared.data(for: request)`,
      kotlin: `val request = Request.Builder()\n    .url("${BASE_URL}/api/genres/rock/stations?country=TR&limit=20")\n    .header("X-API-Key", "YOUR_KEY")\n    .build()\nval response = client.newCall(request).execute()`,
    },
  },
  {
    id: "discoverable-genres",
    method: "GET",
    path: "/api/genres/discoverable",
    title: "Discoverable Genres",
    description: "Get featured/discoverable genres for the home page or genre discovery UI. Returns a curated subset of genres marked as discoverable, optionally filtered by country.",
    params: [
      { name: "country", type: "string", description: "Filter genres that have stations in this country" },
      { name: "limit", type: "number", default: "13", description: "Number of genres to return (max 50)" },
    ],
    responseExample: `[
  {
    "name": "Pop",
    "slug": "pop",
    "isDiscoverable": true,
    "stationCount": 8520
  },
  {
    "name": "Rock",
    "slug": "rock",
    "isDiscoverable": true,
    "stationCount": 6210
  }
]`,
    codeExamples: {
      curl: `curl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/genres/discoverable?limit=10"\n\n# Discoverable genres for Turkey\ncurl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/genres/discoverable?country=TR"`,
      javascript: `const response = await fetch('${BASE_URL}/api/genres/discoverable?country=TR', {\n  headers: { 'X-API-Key': 'YOUR_KEY' }\n});\nconst genres = await response.json(); // Array of genre objects`,
    },
  },
  {
    id: "list-countries",
    method: "GET",
    path: "/api/countries",
    title: "List Countries",
    description: "Get all countries that have radio stations. Use format=rich for detailed country info including localized names, flags, and station counts.",
    params: [
      { name: "format", type: "string", description: "Set to 'rich' for enriched data with station counts, localized names, and flags" },
    ],
    responseExample: `// Default format (plain list)
[
  "Germany",
  "The United States Of America",
  "France",
  "Turkey"
]

// format=rich
[
  {
    "name": "Germany",
    "code": "DE",
    "stationCount": 3450,
    "flag": "...",
    "localizedNames": { "de": "Deutschland", "tr": "Almanya" }
  }
]`,
    codeExamples: {
      curl: `# Plain list\ncurl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/countries"\n\n# Rich format with station counts\ncurl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/countries?format=rich"`,
      javascript: `// Plain list\nconst response = await fetch('${BASE_URL}/api/countries', {\n  headers: { 'X-API-Key': 'YOUR_KEY' }\n});\nconst countries = await response.json();\n\n// Rich format\nconst rich = await fetch('${BASE_URL}/api/countries?format=rich', {\n  headers: { 'X-API-Key': 'YOUR_KEY' }\n}).then(r => r.json());`,
    },
  },
  {
    id: "list-languages",
    method: "GET",
    path: "/api/languages",
    title: "List Languages",
    description: "Get all languages available across radio stations with station counts.",
    responseExample: `[
  { "name": "english", "stationCount": 12500 },
  { "name": "german", "stationCount": 3200 },
  { "name": "turkish", "stationCount": 1800 },
  { "name": "spanish", "stationCount": 2900 }
]`,
    codeExamples: {
      curl: `curl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/languages"`,
      javascript: `const response = await fetch('${BASE_URL}/api/languages', {\n  headers: { 'X-API-Key': 'YOUR_KEY' }\n});\nconst languages = await response.json();`,
    },
  },
  {
    id: "trending",
    method: "GET",
    path: "/api/user-engagement/trending",
    title: "Trending Stations",
    description: "Get stations that are currently trending based on recent user engagement -- favorites, ratings, and click activity in the past 7 days.",
    params: [
      { name: "limit", type: "number", default: "100", description: "Number of trending stations" },
      { name: "country", type: "string", description: "Filter trending by country (all formats supported)" },
    ],
    responseExample: `[
  {
    "_id": "...",
    "name": "Radio Energy",
    "slug": "radio-energy",
    "url": "https://...",
    "favicon": "https://...",
    "country": "Germany",
    "votes": 9800,
    "clickCount": 45000
  }
]`,
    codeExamples: {
      curl: `curl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/user-engagement/trending?limit=10"\n\n# Trending in Turkey\ncurl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/user-engagement/trending?country=TR&limit=10"`,
      javascript: `const response = await fetch('${BASE_URL}/api/user-engagement/trending?limit=10', {\n  headers: { 'X-API-Key': 'YOUR_KEY' }\n});\nconst trending = await response.json();`,
    },
  },
  {
    id: "community-favorites",
    method: "GET",
    path: "/api/community-favorites",
    title: "Community Favorites",
    description: "Get stations most favorited by the community. Shows what real users love the most, optionally filtered by country.",
    params: [
      { name: "country", type: "string", description: "Filter by country (all formats supported)" },
    ],
    responseExample: `[
  {
    "_id": "...",
    "name": "BBC Radio 1",
    "slug": "bbc-radio-1",
    "url": "https://...",
    "favicon": "https://...",
    "country": "The United Kingdom Of Great Britain And Northern Ireland",
    "favoriteCount": 523,
    "votes": 15234
  }
]`,
    codeExamples: {
      curl: `curl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/community-favorites?country=TR"`,
      javascript: `const response = await fetch('${BASE_URL}/api/community-favorites?country=TR', {\n  headers: { 'X-API-Key': 'YOUR_KEY' }\n});\nconst favorites = await response.json();`,
    },
  },
  {
    id: "diverse-recommendations",
    method: "GET",
    path: "/api/recommendations/diverse",
    title: "Diverse Recommendations",
    description: "Get a diverse mix of recommended stations sampled across different genres. Ensures variety in the results rather than clustering around one genre. Useful for 'Discover new stations' features.",
    params: [
      { name: "country", type: "string", description: "Filter by country (all formats supported)" },
      { name: "limit", type: "number", default: "20", description: "Number of stations (max 50)" },
    ],
    responseExample: `{
  "stations": [
    {
      "_id": "...",
      "name": "Jazz FM",
      "slug": "jazz-fm",
      "genre": "jazz",
      "country": "The United Kingdom Of Great Britain And Northern Ireland"
    },
    {
      "_id": "...",
      "name": "Rock Antenne",
      "slug": "rock-antenne",
      "genre": "rock",
      "country": "Germany"
    }
  ],
  "total": 20
}`,
    codeExamples: {
      curl: `curl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/recommendations/diverse?limit=20"\n\n# Diverse recommendations for Turkey\ncurl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/recommendations/diverse?country=TR&limit=15"`,
      javascript: `const response = await fetch('${BASE_URL}/api/recommendations/diverse?limit=20', {\n  headers: { 'X-API-Key': 'YOUR_KEY' }\n});\nconst { stations } = await response.json();`,
    },
  },
];

const STREAMING_ENDPOINTS: Endpoint[] = [
  {
    id: "resolve-stream",
    method: "GET",
    path: "/api/stream/resolve",
    title: "Resolve Stream URL",
    description: "Resolve a stream or playlist URL to its direct audio stream URL(s). Handles M3U, PLS, and HLS playlist parsing. Pass the station's stream URL to get the actual playable audio URLs. Essential for building reliable audio players.",
    params: [
      { name: "url", type: "string", required: true, description: "Stream or playlist URL to resolve (the station's url or urlResolved field)" },
    ],
    notes: [
      "Pass the station's 'url' or 'urlResolved' field as the url parameter.",
      "The resolver handles M3U, PLS, HLS playlists and HTTP redirects.",
      "Returns one or more direct stream URLs as candidates.",
    ],
    responseExample: `{
  "originalUrl": "https://stream.example.com/playlist.m3u",
  "playlistType": "m3u",
  "candidates": [
    "https://stream.example.com/stream1.mp3",
    "https://stream.example.com/stream2.mp3"
  ]
}`,
    codeExamples: {
      curl: `# Resolve a station's stream URL\ncurl -H "X-API-Key: YOUR_KEY" \\\n  "${BASE_URL}/api/stream/resolve?url=https://stream.example.com/playlist.m3u"`,
      javascript: `// First get the station\nconst stationRes = await fetch('${BASE_URL}/api/station/bbc-radio-1', {\n  headers: { 'X-API-Key': 'YOUR_KEY' }\n});\nconst station = await stationRes.json();\n\n// Then resolve its stream URL\nconst streamRes = await fetch(\n  \`${BASE_URL}/api/stream/resolve?url=\${encodeURIComponent(station.url)}\`,\n  { headers: { 'X-API-Key': 'YOUR_KEY' } }\n);\nconst { candidates } = await streamRes.json();\n\nconst audio = new Audio(candidates[0]);\naudio.play();`,
      swift: `// Resolve stream URL\nlet streamUrl = station.url.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed)!\nlet url = URL(string: "${BASE_URL}/api/stream/resolve?url=\\(streamUrl)")!\nvar request = URLRequest(url: url)\nrequest.setValue("YOUR_KEY", forHTTPHeaderField: "X-API-Key")\n\nlet (data, _) = try await URLSession.shared.data(for: request)\nlet result = try JSONDecoder().decode(StreamResolveResponse.self, from: data)\nlet directUrl = result.candidates.first!`,
    },
  },
  {
    id: "now-playing",
    method: "GET",
    path: "/api/now-playing/:id",
    title: "Now Playing",
    description: "Get the currently playing track information for a station. Returns title, artist, and station info when available from the stream metadata. Accepts station slug or MongoDB ID.",
    params: [
      { name: "id", type: "string", required: true, description: "Station slug (e.g., 'bbc-radio-1') or MongoDB ObjectId" },
    ],
    responseExample: `{
  "title": "Blinding Lights",
  "artist": "The Weeknd",
  "station": "BBC Radio 1",
  "genre": "pop"
}`,
    codeExamples: {
      curl: `# By slug\ncurl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/now-playing/bbc-radio-1"\n\n# By ID\ncurl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/now-playing/64a1b2c3d4e5f6a7b8c9d0e1"`,
      javascript: `const response = await fetch('${BASE_URL}/api/now-playing/bbc-radio-1', {\n  headers: { 'X-API-Key': 'YOUR_KEY' }\n});\nconst nowPlaying = await response.json();\nconsole.log(\`Now playing: \${nowPlaying.artist} - \${nowPlaying.title}\`);`,
    },
  },
];

const USER_AUTH_ENDPOINTS: Endpoint[] = [
  {
    id: "signup",
    method: "POST",
    path: "/api/auth/signup",
    title: "Sign Up",
    description: "Create a new user account. Requires fullName, username, email, and password. Username must be 3-30 characters (alphanumeric, underscore, dot, hyphen). Password must be at least 8 characters.",
    bodyParams: [
      { name: "fullName", type: "string", required: true, description: "User's full display name" },
      { name: "username", type: "string", required: true, description: "Unique username (3-30 chars: a-z, 0-9, _, ., -)" },
      { name: "email", type: "string", required: true, description: "Email address" },
      { name: "password", type: "string", required: true, description: "Password (min 8 characters)" },
    ],
    responseExample: `{
  "success": true,
  "user": {
    "_id": "64a1b2c3d4e5f6a7b8c9d0e1",
    "fullName": "John Doe",
    "username": "johndoe",
    "email": "john@example.com"
  }
}`,
    codeExamples: {
      curl: `curl -X POST "${BASE_URL}/api/auth/signup" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "fullName": "John Doe",\n    "username": "johndoe",\n    "email": "john@example.com",\n    "password": "securepass123"\n  }'`,
      javascript: `const response = await fetch('${BASE_URL}/api/auth/signup', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify({\n    fullName: 'John Doe',\n    username: 'johndoe',\n    email: 'john@example.com',\n    password: 'securepass123'\n  })\n});\nconst { user } = await response.json();`,
      swift: `let body: [String: Any] = [\n    "fullName": "John Doe",\n    "username": "johndoe",\n    "email": "john@example.com",\n    "password": "securepass123"\n]\nlet jsonData = try JSONSerialization.data(withJSONObject: body)\n\nvar request = URLRequest(url: URL(string: "${BASE_URL}/api/auth/signup")!)\nrequest.httpMethod = "POST"\nrequest.setValue("application/json", forHTTPHeaderField: "Content-Type")\nrequest.httpBody = jsonData`,
      kotlin: `val body = JSONObject().apply {\n    put("fullName", "John Doe")\n    put("username", "johndoe")\n    put("email", "john@example.com")\n    put("password", "securepass123")\n}\n\nval request = Request.Builder()\n    .url("${BASE_URL}/api/auth/signup")\n    .post(body.toString().toRequestBody("application/json".toMediaType()))\n    .build()`,
    },
  },
  {
    id: "web-login",
    method: "POST",
    path: "/api/auth/login",
    title: "Web Login",
    description: "Authenticate a user with email and password. For web clients, returns a session cookie. For mobile/TV clients, set deviceType to 'mobile' or 'tv' (or send X-Device-Type header) to receive a long-lived auth token (mrt_...) in the response.",
    bodyParams: [
      { name: "email", type: "string", required: true, description: "User's email address" },
      { name: "password", type: "string", required: true, description: "User's password" },
      { name: "deviceType", type: "string", description: "Device type: 'web' (default), 'mobile', or 'tv'. Mobile/TV returns an auth token." },
      { name: "deviceName", type: "string", description: "Device name for identification (e.g., 'iPhone 15', 'Samsung TV')" },
      { name: "rememberMe", type: "boolean", description: "Remember session for longer duration" },
    ],
    headers: [
      { name: "X-Device-Type", type: "string", description: "Alternative to deviceType body param. Set to 'mobile' or 'tv' to receive auth token." },
    ],
    notes: [
      "For mobile apps: Set deviceType='mobile' or header X-Device-Type='mobile' to receive a token in the response.",
      "For TV apps: Set deviceType='tv' to receive a token.",
      "For web apps: Use credentials: 'include' to receive session cookie.",
    ],
    responseExample: `// Web response (session cookie set)
{
  "success": true,
  "user": {
    "_id": "64a1b2c3d4e5f6a7b8c9d0e1",
    "fullName": "John Doe",
    "email": "john@example.com",
    "avatar": "https://..."
  }
}

// Mobile/TV response (includes token)
{
  "success": true,
  "token": "mrt_a1b2c3d4e5f6...",
  "user": {
    "_id": "64a1b2c3d4e5f6a7b8c9d0e1",
    "fullName": "John Doe",
    "email": "john@example.com"
  }
}`,
    codeExamples: {
      curl: `# Web login (session cookie)\ncurl -X POST "${BASE_URL}/api/auth/login" \\\n  -H "Content-Type: application/json" \\\n  -d '{"email": "john@example.com", "password": "secret"}'\n\n# Mobile login (get auth token)\ncurl -X POST "${BASE_URL}/api/auth/login" \\\n  -H "Content-Type: application/json" \\\n  -H "X-Device-Type: mobile" \\\n  -d '{"email": "john@example.com", "password": "secret"}'`,
      javascript: `// Web login\nconst response = await fetch('${BASE_URL}/api/auth/login', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json' },\n  credentials: 'include',\n  body: JSON.stringify({ email: 'john@example.com', password: 'secret' })\n});\nconst { user } = await response.json();`,
      swift: `let body: [String: Any] = [\n    "email": "john@example.com",\n    "password": "secret",\n    "deviceType": "mobile"\n]\nlet jsonData = try JSONSerialization.data(withJSONObject: body)\n\nvar request = URLRequest(url: URL(string: "${BASE_URL}/api/auth/login")!)\nrequest.httpMethod = "POST"\nrequest.setValue("application/json", forHTTPHeaderField: "Content-Type")\nrequest.httpBody = jsonData\n\nlet (data, _) = try await URLSession.shared.data(for: request)\nlet result = try JSONDecoder().decode(LoginResponse.self, from: data)\nlet token = result.token  // Store securely in Keychain`,
      kotlin: `val body = JSONObject().apply {\n    put("email", "john@example.com")\n    put("password", "secret")\n    put("deviceType", "mobile")\n}\n\nval request = Request.Builder()\n    .url("${BASE_URL}/api/auth/login")\n    .post(body.toString().toRequestBody("application/json".toMediaType()))\n    .build()\n\nval response = client.newCall(request).execute()\nval token = JSONObject(response.body?.string() ?: "").getString("token")`,
    },
  },
  {
    id: "mobile-login",
    method: "POST",
    path: "/api/auth/mobile/login",
    title: "Mobile Login (Dedicated)",
    description: "Dedicated mobile login endpoint. Always returns an auth token (mrt_...) for mobile clients. Alternative to using /api/auth/login with deviceType='mobile'. Accepts optional deviceType and deviceName.",
    bodyParams: [
      { name: "email", type: "string", required: true, description: "User's email address" },
      { name: "password", type: "string", required: true, description: "User's password" },
      { name: "deviceType", type: "string", default: "mobile", description: "Device type (default: 'mobile')" },
      { name: "deviceName", type: "string", description: "Device name for identification" },
    ],
    responseExample: `{
  "success": true,
  "token": "mrt_a1b2c3d4e5f6...",
  "user": {
    "_id": "64a1b2c3d4e5f6a7b8c9d0e1",
    "fullName": "John Doe",
    "email": "john@example.com"
  }
}`,
    codeExamples: {
      curl: `curl -X POST "${BASE_URL}/api/auth/mobile/login" \\\n  -H "Content-Type: application/json" \\\n  -d '{"email": "john@example.com", "password": "secret"}'`,
      swift: `let body: [String: Any] = [\n    "email": "john@example.com",\n    "password": "secret"\n]\nlet jsonData = try JSONSerialization.data(withJSONObject: body)\n\nvar request = URLRequest(url: URL(string: "${BASE_URL}/api/auth/mobile/login")!)\nrequest.httpMethod = "POST"\nrequest.setValue("application/json", forHTTPHeaderField: "Content-Type")\nrequest.httpBody = jsonData\n\nlet (data, _) = try await URLSession.shared.data(for: request)\nlet result = try JSONDecoder().decode(LoginResponse.self, from: data)\nlet token = result.token  // Store in Keychain`,
      kotlin: `val body = JSONObject().apply {\n    put("email", "john@example.com")\n    put("password", "secret")\n}\n\nval request = Request.Builder()\n    .url("${BASE_URL}/api/auth/mobile/login")\n    .post(body.toString().toRequestBody("application/json".toMediaType()))\n    .build()\n\nval response = client.newCall(request).execute()\nval token = JSONObject(response.body?.string() ?: "").getString("token")`,
    },
  },
  {
    id: "google-login",
    method: "POST",
    path: "/api/auth/google",
    title: "Google Sign-In (Mobile)",
    description: "Authenticate with Google using an ID token from the Google Sign-In SDK. Verifies the token server-side using Google's auth library. Creates a new account or links to an existing one. Returns an auth token for mobile/TV use.",
    bodyParams: [
      { name: "idToken", type: "string", required: true, description: "Google ID token from GoogleSignin.signIn()" },
      { name: "email", type: "string", description: "User's email (not used for linking - only token email is trusted)" },
      { name: "name", type: "string", description: "Fallback display name if not present in token" },
      { name: "googleId", type: "string", description: "Google user ID (not used - verified from token)" },
      { name: "platform", type: "string", default: "mobile", description: "'mobile' or 'tv'" },
    ],
    headers: [
      { name: "X-Device-Type", type: "string", description: "Set to 'mobile' for mobile apps" },
    ],
    notes: [
      "The idToken is verified server-side using google-auth-library. Body email/googleId are NOT trusted for security.",
      "If a user with this Google ID exists, they are logged in. If email matches an existing account, Google ID is linked.",
      "New users are created automatically with emailVerified=true.",
      "Suspended/inactive accounts are rejected with 403.",
      "Token type (mobile/tv) is determined by the 'platform' body param, not X-Device-Type header.",
    ],
    responseExample: `{
  "success": true,
  "token": "mrt_a1b2c3d4e5f6...",
  "expiresIn": "90 days",
  "user": {
    "_id": "64a1b2c3d4e5f6a7b8c9d0e1",
    "fullName": "John Doe",
    "username": "user_1702234567890_abc123def",
    "email": "john@gmail.com",
    "role": "user",
    "avatar": "https://lh3.googleusercontent.com/..."
  }
}`,
    codeExamples: {
      curl: `curl -X POST "${BASE_URL}/api/auth/google" \\\n  -H "Content-Type: application/json" \\\n  -H "X-Device-Type: mobile" \\\n  -d '{\n    "idToken": "GOOGLE_ID_TOKEN_FROM_SDK",\n    "platform": "mobile"\n  }'`,
      javascript: `import { GoogleSignin } from '@react-native-google-signin/google-signin';\n\nconst userInfo = await GoogleSignin.signIn();\nconst response = await fetch('${BASE_URL}/api/auth/google', {\n  method: 'POST',\n  headers: {\n    'Content-Type': 'application/json',\n    'X-Device-Type': 'mobile'\n  },\n  body: JSON.stringify({\n    idToken: userInfo.idToken,\n    platform: 'mobile'\n  })\n});\nconst { success, token, user } = await response.json();\n// Store token securely (SecureStore, Keychain)`,
      swift: `// After Google Sign-In SDK returns idToken\nlet body: [String: Any] = [\n    "idToken": googleIdToken,\n    "platform": "mobile"\n]\nlet jsonData = try JSONSerialization.data(withJSONObject: body)\n\nvar request = URLRequest(url: URL(string: "${BASE_URL}/api/auth/google")!)\nrequest.httpMethod = "POST"\nrequest.setValue("application/json", forHTTPHeaderField: "Content-Type")\nrequest.setValue("mobile", forHTTPHeaderField: "X-Device-Type")\nrequest.httpBody = jsonData\n\nlet (data, _) = try await URLSession.shared.data(for: request)\nlet result = try JSONDecoder().decode(AuthResponse.self, from: data)\n// Store result.token in Keychain`,
      kotlin: `// After Google Sign-In SDK returns idToken\nval body = JSONObject().apply {\n    put("idToken", googleIdToken)\n    put("platform", "mobile")\n}\n\nval request = Request.Builder()\n    .url("${BASE_URL}/api/auth/google")\n    .header("X-Device-Type", "mobile")\n    .post(body.toString().toRequestBody("application/json".toMediaType()))\n    .build()\n\nval response = client.newCall(request).execute()\nval result = JSONObject(response.body?.string() ?: "")\nval token = result.getString("token")\n// Store token in EncryptedSharedPreferences`,
    },
  },
  {
    id: "apple-login",
    method: "POST",
    path: "/api/auth/apple",
    title: "Apple Sign-In (Mobile)",
    description: "Authenticate with Apple using an identity token from Apple Sign-In. Verifies the JWT server-side using Apple's JWKS endpoint. Creates a new account or links to an existing one. Returns an auth token for mobile/TV use.",
    bodyParams: [
      { name: "identityToken", type: "string", required: true, description: "Apple identity token (JWT) from AppleAuthentication.signInAsync()" },
      { name: "authorizationCode", type: "string", description: "Apple authorization code (reserved for future use)" },
      { name: "fullName", type: "object", description: "{ givenName, familyName } - Apple only provides this on FIRST sign-in" },
      { name: "email", type: "string", description: "User's email (not used for linking - only token email is trusted)" },
      { name: "user", type: "string", description: "Apple user identifier" },
      { name: "platform", type: "string", default: "mobile", description: "'mobile' or 'tv'" },
    ],
    headers: [
      { name: "X-Device-Type", type: "string", description: "Set to 'mobile' for mobile apps" },
    ],
    notes: [
      "The identityToken JWT is verified against Apple's JWKS (https://appleid.apple.com/auth/keys).",
      "Apple provides fullName and email ONLY on first sign-in. On subsequent sign-ins, these will be null.",
      "Apple does NOT provide profile photos. New Apple-only accounts will have null avatar. Existing accounts linked via email may retain their previous avatar.",
      "If user selects 'Hide My Email', a relay address (xxx@privaterelay.appleid.com) is used.",
      "Audience is verified against APPLE_CLIENT_ID env var or defaults to com.visiongo.megaradio.",
      "Suspended/inactive accounts are rejected with 403.",
    ],
    responseExample: `{
  "success": true,
  "token": "mrt_a1b2c3d4e5f6...",
  "expiresIn": "90 days",
  "user": {
    "_id": "64a1b2c3d4e5f6a7b8c9d0e1",
    "fullName": "John Doe",
    "username": "user_1702234567890_abc123def",
    "email": "john@icloud.com",
    "role": "user",
    "avatar": null
  }
}`,
    codeExamples: {
      curl: `curl -X POST "${BASE_URL}/api/auth/apple" \\\n  -H "Content-Type: application/json" \\\n  -H "X-Device-Type: mobile" \\\n  -d '{\n    "identityToken": "APPLE_IDENTITY_TOKEN_JWT",\n    "fullName": { "givenName": "John", "familyName": "Doe" },\n    "platform": "mobile"\n  }'`,
      javascript: `import * as AppleAuthentication from 'expo-apple-authentication';\n\nconst credential = await AppleAuthentication.signInAsync({\n  requestedScopes: [\n    AppleAuthentication.AppleAuthenticationScope.FULL_NAME,\n    AppleAuthentication.AppleAuthenticationScope.EMAIL,\n  ],\n});\n\nconst response = await fetch('${BASE_URL}/api/auth/apple', {\n  method: 'POST',\n  headers: {\n    'Content-Type': 'application/json',\n    'X-Device-Type': 'mobile'\n  },\n  body: JSON.stringify({\n    identityToken: credential.identityToken,\n    authorizationCode: credential.authorizationCode,\n    fullName: credential.fullName,\n    email: credential.email,\n    user: credential.user,\n    platform: 'mobile'\n  })\n});\nconst { success, token, user } = await response.json();\n// Store token securely`,
      swift: `// After ASAuthorizationAppleIDCredential is received\nlet body: [String: Any] = [\n    "identityToken": String(data: credential.identityToken!, encoding: .utf8)!,\n    "authorizationCode": String(data: credential.authorizationCode!, encoding: .utf8)!,\n    "fullName": [\n        "givenName": credential.fullName?.givenName ?? "",\n        "familyName": credential.fullName?.familyName ?? ""\n    ],\n    "email": credential.email ?? "",\n    "user": credential.user,\n    "platform": "mobile"\n]\n\nvar request = URLRequest(url: URL(string: "${BASE_URL}/api/auth/apple")!)\nrequest.httpMethod = "POST"\nrequest.setValue("application/json", forHTTPHeaderField: "Content-Type")\nrequest.httpBody = try JSONSerialization.data(withJSONObject: body)`,
      kotlin: `// After Apple Sign-In returns credentials\nval body = JSONObject().apply {\n    put("identityToken", appleIdentityToken)\n    put("authorizationCode", appleAuthCode)\n    put("fullName", JSONObject().apply {\n        put("givenName", givenName)\n        put("familyName", familyName)\n    })\n    put("platform", "mobile")\n}\n\nval request = Request.Builder()\n    .url("${BASE_URL}/api/auth/apple")\n    .header("X-Device-Type", "mobile")\n    .post(body.toString().toRequestBody("application/json".toMediaType()))\n    .build()`,
    },
  },
  {
    id: "current-user",
    method: "GET",
    path: "/api/auth/me",
    title: "Current User",
    description: "Get the currently authenticated user's profile. Works with both session cookies (web) and auth tokens (mobile). For mobile clients, you can also use /api/auth/mobile/me with a Bearer token.",
    notes: [
      "Web: Uses session cookie (credentials: 'include').",
      "Mobile: Uses Authorization: Bearer mrt_... header.",
      "Alternative mobile endpoint: GET /api/auth/mobile/me",
    ],
    responseExample: `{
  "authenticated": true,
  "user": {
    "_id": "64a1b2c3d4e5f6a7b8c9d0e1",
    "fullName": "John Doe",
    "username": "johndoe",
    "email": "john@example.com",
    "avatar": "https://...",
    "role": "user",
    "followersCount": 150,
    "followingCount": 89,
    "favoriteStationsCount": 24
  }
}`,
    codeExamples: {
      curl: `# With auth token\ncurl -H "Authorization: Bearer mrt_your_token" "${BASE_URL}/api/auth/me"\n\n# Mobile-specific endpoint\ncurl -H "Authorization: Bearer mrt_your_token" "${BASE_URL}/api/auth/mobile/me"`,
      javascript: `// Web (session)\nconst response = await fetch('${BASE_URL}/api/auth/me', {\n  credentials: 'include'\n});\nconst { user, authenticated } = await response.json();\n\n// Mobile (token)\nconst mobileRes = await fetch('${BASE_URL}/api/auth/me', {\n  headers: { 'Authorization': 'Bearer mrt_your_token' }\n});`,
    },
  },
];

const USER_DATA_ENDPOINTS: Endpoint[] = [
  {
    id: "list-favorites",
    method: "GET",
    path: "/api/user/favorites",
    title: "List User Favorites",
    description: "Get the authenticated user's favorite stations list. Supports sorting and pagination. Returns full station data with the date each station was favorited.",
    params: [
      { name: "sort", type: "string", default: "newest", description: "Sort order: newest, oldest, name" },
      { name: "page", type: "number", default: "1", description: "Page number" },
      { name: "limit", type: "number", default: "20", description: "Stations per page" },
    ],
    headers: [
      { name: "Authorization", type: "string", required: true, description: "Bearer mrt_your_token (mobile) or session cookie (web)" },
    ],
    responseExample: `[
  {
    "_id": "64a1b2c3d4e5f6a7b8c9d0e1",
    "name": "BBC Radio 1",
    "slug": "bbc-radio-1",
    "url": "https://...",
    "favicon": "https://...",
    "country": "The United Kingdom Of Great Britain And Northern Ireland",
    "genre": "pop",
    "votes": 15234,
    "favoritedAt": "2025-01-15T10:00:00Z"
  }
]`,
    codeExamples: {
      curl: `curl -H "Authorization: Bearer mrt_your_token" \\\n  "${BASE_URL}/api/user/favorites?sort=newest&limit=20"`,
      javascript: `const response = await fetch('${BASE_URL}/api/user/favorites?sort=newest', {\n  headers: { 'Authorization': 'Bearer mrt_your_token' }\n});\nconst favorites = await response.json();`,
      swift: `var request = URLRequest(url: URL(string: "${BASE_URL}/api/user/favorites?sort=newest")!)\nrequest.setValue("Bearer \\(authToken)", forHTTPHeaderField: "Authorization")\nlet (data, _) = try await URLSession.shared.data(for: request)`,
    },
  },
  {
    id: "add-favorite",
    method: "POST",
    path: "/api/user/favorites",
    title: "Add Favorite",
    description: "Add a station to the authenticated user's favorites list. Requires user authentication via session or auth token.",
    bodyParams: [
      { name: "stationId", type: "string", required: true, description: "Station ID (MongoDB ObjectId) to favorite" },
    ],
    headers: [
      { name: "Authorization", type: "string", required: true, description: "Bearer mrt_your_token (mobile) or session cookie (web)" },
    ],
    responseExample: `{
  "success": true,
  "message": "Station added to favorites"
}`,
    codeExamples: {
      curl: `curl -X POST "${BASE_URL}/api/user/favorites" \\\n  -H "Authorization: Bearer mrt_your_token" \\\n  -H "Content-Type: application/json" \\\n  -d '{"stationId": "64a1b2c3d4e5f6a7b8c9d0e1"}'`,
      javascript: `await fetch('${BASE_URL}/api/user/favorites', {\n  method: 'POST',\n  headers: {\n    'Authorization': 'Bearer mrt_your_token',\n    'Content-Type': 'application/json'\n  },\n  body: JSON.stringify({ stationId: 'STATION_ID' })\n});`,
      swift: `var request = URLRequest(url: URL(string: "${BASE_URL}/api/user/favorites")!)\nrequest.httpMethod = "POST"\nrequest.setValue("Bearer \\(authToken)", forHTTPHeaderField: "Authorization")\nrequest.setValue("application/json", forHTTPHeaderField: "Content-Type")\nrequest.httpBody = try JSONEncoder().encode(["stationId": stationId])`,
      kotlin: `val body = JSONObject().apply { put("stationId", "STATION_ID") }\nval request = Request.Builder()\n    .url("${BASE_URL}/api/user/favorites")\n    .header("Authorization", "Bearer $authToken")\n    .post(body.toString().toRequestBody("application/json".toMediaType()))\n    .build()`,
    },
  },
  {
    id: "remove-favorite",
    method: "DELETE",
    path: "/api/user/favorites/:stationId",
    title: "Remove Favorite",
    description: "Remove a station from the authenticated user's favorites list.",
    params: [
      { name: "stationId", type: "string", required: true, description: "Station ID to remove from favorites" },
    ],
    headers: [
      { name: "Authorization", type: "string", required: true, description: "Bearer mrt_your_token (mobile) or session cookie (web)" },
    ],
    responseExample: `{
  "success": true,
  "message": "Station removed from favorites"
}`,
    codeExamples: {
      curl: `curl -X DELETE \\\n  -H "Authorization: Bearer mrt_your_token" \\\n  "${BASE_URL}/api/user/favorites/64a1b2c3d4e5f6a7b8c9d0e1"`,
      javascript: `await fetch('${BASE_URL}/api/user/favorites/STATION_ID', {\n  method: 'DELETE',\n  headers: { 'Authorization': 'Bearer mrt_your_token' }\n});`,
    },
  },
  {
    id: "list-recently-played",
    method: "GET",
    path: "/api/recently-played",
    title: "Recently Played",
    description: "Get the authenticated user's recently played stations, ordered by most recent. Returns up to 12 entries.",
    headers: [
      { name: "Authorization", type: "string", required: true, description: "Bearer mrt_your_token (mobile) or session cookie (web)" },
    ],
    responseExample: `[
  {
    "_id": "64a1b2c3d4e5f6a7b8c9d0e1",
    "name": "BBC Radio 1",
    "slug": "bbc-radio-1",
    "url": "https://...",
    "favicon": "https://...",
    "country": "The United Kingdom Of Great Britain And Northern Ireland",
    "playedAt": "2025-03-02T22:30:00Z"
  }
]`,
    codeExamples: {
      curl: `curl -H "Authorization: Bearer mrt_your_token" "${BASE_URL}/api/recently-played"`,
      javascript: `const response = await fetch('${BASE_URL}/api/recently-played', {\n  headers: { 'Authorization': 'Bearer mrt_your_token' }\n});\nconst recentlyPlayed = await response.json();`,
    },
  },
  {
    id: "add-recently-played",
    method: "POST",
    path: "/api/recently-played",
    title: "Add to Recently Played",
    description: "Record a station as recently played. The list maintains up to 12 entries with the most recent at the top. Duplicate entries are moved to the top.",
    bodyParams: [
      { name: "stationId", type: "string", required: true, description: "Station ID (MongoDB ObjectId) that was played" },
    ],
    headers: [
      { name: "Authorization", type: "string", required: true, description: "Bearer mrt_your_token (mobile) or session cookie (web)" },
    ],
    responseExample: `{
  "success": true
}`,
    codeExamples: {
      curl: `curl -X POST "${BASE_URL}/api/recently-played" \\\n  -H "Authorization: Bearer mrt_your_token" \\\n  -H "Content-Type: application/json" \\\n  -d '{"stationId": "64a1b2c3d4e5f6a7b8c9d0e1"}'`,
      javascript: `await fetch('${BASE_URL}/api/recently-played', {\n  method: 'POST',\n  headers: {\n    'Authorization': 'Bearer mrt_your_token',\n    'Content-Type': 'application/json'\n  },\n  body: JSON.stringify({ stationId: 'STATION_ID' })\n});`,
    },
  },
  {
    id: "rate-station",
    method: "POST",
    path: "/api/stations/:id/rate",
    title: "Rate a Station",
    description: "Submit a star rating (1-5) with an optional text comment for a station. Users can update their existing rating. Requires authentication.",
    bodyParams: [
      { name: "rating", type: "number", required: true, description: "Star rating from 1 to 5" },
      { name: "comment", type: "string", description: "Optional review text (max 1000 characters, HTML stripped)" },
    ],
    headers: [
      { name: "Authorization", type: "string", required: true, description: "Bearer mrt_your_token (mobile) or session cookie (web)" },
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
      curl: `curl -X POST "${BASE_URL}/api/stations/STATION_ID/rate" \\\n  -H "Authorization: Bearer mrt_your_token" \\\n  -H "Content-Type: application/json" \\\n  -d '{"rating": 5, "comment": "Amazing station!"}'`,
      javascript: `const response = await fetch('${BASE_URL}/api/stations/STATION_ID/rate', {\n  method: 'POST',\n  headers: {\n    'Authorization': 'Bearer mrt_your_token',\n    'Content-Type': 'application/json'\n  },\n  body: JSON.stringify({ rating: 5, comment: 'Amazing station!' })\n});\nconst { stats } = await response.json();`,
    },
  },
  {
    id: "register-push-token",
    method: "POST",
    path: "/api/user/push-token",
    title: "Register Push Token",
    description: "Register a device push notification token. Supports Expo, APNs (iOS), and FCM (Android) tokens. Authentication is optional -- if authenticated, the token is linked to the user account.",
    bodyParams: [
      { name: "token", type: "string", required: true, description: "Push notification token from the device" },
      { name: "platform", type: "string", required: true, description: "Platform: 'ios' or 'android'" },
      { name: "tokenType", type: "string", description: "Token type: 'expo', 'apns', or 'fcm'. Auto-detected if not specified." },
      { name: "deviceName", type: "string", description: "Device name for identification (e.g., 'iPhone 15 Pro')" },
      { name: "country", type: "string", description: "User's country for targeted notifications" },
      { name: "language", type: "string", description: "User's language preference" },
    ],
    headers: [
      { name: "Authorization", type: "string", description: "Optional: Bearer mrt_your_token to link token to user account" },
    ],
    responseExample: `{
  "success": true,
  "message": "Push token registered successfully"
}`,
    codeExamples: {
      curl: `curl -X POST "${BASE_URL}/api/user/push-token" \\\n  -H "Authorization: Bearer mrt_your_token" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "token": "ExponentPushToken[xxxxx]",\n    "platform": "ios",\n    "tokenType": "expo",\n    "deviceName": "iPhone 15 Pro",\n    "country": "Turkey",\n    "language": "tr"\n  }'`,
      swift: `let body: [String: Any] = [\n    "token": deviceToken,\n    "platform": "ios",\n    "tokenType": "apns",\n    "deviceName": UIDevice.current.name,\n    "country": "Turkey",\n    "language": "tr"\n]\nvar request = URLRequest(url: URL(string: "${BASE_URL}/api/user/push-token")!)\nrequest.httpMethod = "POST"\nrequest.setValue("Bearer \\(authToken)", forHTTPHeaderField: "Authorization")\nrequest.setValue("application/json", forHTTPHeaderField: "Content-Type")\nrequest.httpBody = try JSONSerialization.data(withJSONObject: body)`,
      kotlin: `val body = JSONObject().apply {\n    put("token", fcmToken)\n    put("platform", "android")\n    put("tokenType", "fcm")\n    put("deviceName", Build.MODEL)\n    put("country", "Turkey")\n    put("language", "tr")\n}\nval request = Request.Builder()\n    .url("${BASE_URL}/api/user/push-token")\n    .header("Authorization", "Bearer $authToken")\n    .post(body.toString().toRequestBody("application/json".toMediaType()))\n    .build()`,
    },
  },
  {
    id: "unregister-push-token",
    method: "DELETE",
    path: "/api/user/push-token",
    title: "Unregister Push Token",
    description: "Deactivate a push notification token. The token is soft-deleted (marked inactive) rather than permanently removed. Call this when the user logs out or disables notifications.",
    bodyParams: [
      { name: "token", type: "string", required: true, description: "Push notification token to deactivate" },
    ],
    responseExample: `{
  "success": true,
  "message": "Push token deactivated"
}`,
    codeExamples: {
      curl: `curl -X DELETE "${BASE_URL}/api/user/push-token" \\\n  -H "Content-Type: application/json" \\\n  -d '{"token": "ExponentPushToken[xxxxx]"}'`,
      javascript: `await fetch('${BASE_URL}/api/user/push-token', {\n  method: 'DELETE',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify({ token: 'ExponentPushToken[xxxxx]' })\n});`,
    },
  },
];

const TV_CAST_ENDPOINTS: Endpoint[] = [
  {
    id: "tv-init",
    method: "GET",
    path: "/api/tv/init",
    title: "TV/Mobile App Initialization",
    description: "Single-request app startup endpoint. Returns popular stations, trending stations, genres, and countries in one response. Optimized for TV and mobile app cold start. Response is cached for 10 minutes.",
    params: [
      { name: "country", type: "string", description: "Country name for personalized results (all formats supported)" },
      { name: "countryCode", type: "string", description: "ISO-2 country code (e.g., 'TR', 'DE'). Alternative to country param." },
      { name: "limit", type: "number", default: "20", description: "Number of popular/trending stations per section" },
      { name: "genreLimit", type: "number", default: "13", description: "Number of genres to return" },
    ],
    notes: [
      "This endpoint is designed for app startup -- call it once when the app launches.",
      "Response is cached server-side for 10 minutes for fast response.",
      "Popular stations are deduplicated by normalized name.",
    ],
    responseExample: `{
  "popularStations": [
    {
      "_id": "...",
      "name": "Power FM",
      "slug": "power-fm",
      "url": "https://...",
      "favicon": "https://...",
      "country": "Turkey",
      "votes": 8920
    }
  ],
  "trendingStations": [
    {
      "_id": "...",
      "name": "Virgin Radio Turkey",
      "slug": "virgin-radio-turkey",
      "url": "https://...",
      "votes": 6500
    }
  ],
  "genres": [
    { "name": "Pop", "slug": "pop", "stationCount": 8520 },
    { "name": "Rock", "slug": "rock", "stationCount": 6210 }
  ],
  "countries": ["Germany", "Turkey", "France", "..."],
  "meta": {
    "country": "Turkey",
    "cachedAt": "2025-03-02T10:00:00Z"
  }
}`,
    codeExamples: {
      curl: `# Global init\ncurl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/tv/init"\n\n# Init for Turkey\ncurl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/tv/init?country=Turkey&limit=30"\n\n# Init with country code\ncurl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/tv/init?countryCode=TR&genreLimit=20"`,
      javascript: `const response = await fetch('${BASE_URL}/api/tv/init?countryCode=TR', {\n  headers: { 'X-API-Key': 'YOUR_KEY' }\n});\nconst {\n  popularStations,\n  trendingStations,\n  genres,\n  countries\n} = await response.json();`,
      swift: `let url = URL(string: "${BASE_URL}/api/tv/init?countryCode=TR&limit=30")!\nvar request = URLRequest(url: url)\nrequest.setValue("YOUR_KEY", forHTTPHeaderField: "X-API-Key")\n\nlet (data, _) = try await URLSession.shared.data(for: request)\nlet initData = try JSONDecoder().decode(TVInitResponse.self, from: data)`,
      kotlin: `val request = Request.Builder()\n    .url("${BASE_URL}/api/tv/init?countryCode=TR&limit=30")\n    .header("X-API-Key", "YOUR_KEY")\n    .build()\n\nval response = client.newCall(request).execute()\nval json = JSONObject(response.body?.string() ?: "")\nval popular = json.getJSONArray("popularStations")\nval trending = json.getJSONArray("trendingStations")`,
    },
  },
  {
    id: "tv-request-code",
    method: "POST",
    path: "/api/auth/tv/code",
    title: "TV: Request Login Code",
    description: "Generate a 6-digit login code for TV device authentication. Display this code on the TV screen for the user to enter on their mobile app. Netflix/YouTube-style device activation flow. Code expires in 10 minutes.",
    bodyParams: [
      { name: "deviceId", type: "string", required: true, description: "Unique device identifier for the TV" },
      { name: "platform", type: "string", default: "other", description: "TV platform: 'tizen' (Samsung), 'webos' (LG), or 'other'" },
    ],
    responseExample: `{
  "success": true,
  "code": "482915",
  "expiresIn": 600
}`,
    codeExamples: {
      curl: `curl -X POST "${BASE_URL}/api/auth/tv/code" \\\n  -H "Content-Type: application/json" \\\n  -d '{"deviceId": "tv-unique-id-123", "platform": "tizen"}'`,
      kotlin: `val body = JSONObject().apply {\n    put("deviceId", deviceId)\n    put("platform", "tizen")\n}\n\nval request = Request.Builder()\n    .url("${BASE_URL}/api/auth/tv/code")\n    .post(body.toString().toRequestBody("application/json".toMediaType()))\n    .build()`,
    },
  },
  {
    id: "tv-poll-status",
    method: "GET",
    path: "/api/auth/tv/code/:code/status",
    title: "TV: Poll Activation Status",
    description: "Poll from the TV device to check if the user has activated the login code from their mobile app. Poll every 2-3 seconds. When status is 'activated', the response includes an auth token for the TV to use.",
    params: [
      { name: "code", type: "string", required: true, description: "The 6-digit code from the request step" },
      { name: "deviceId", type: "string", required: true, description: "The same device ID used when requesting the code" },
    ],
    notes: [
      "Poll this endpoint every 2-3 seconds until status becomes 'activated'.",
      "When activated, the response includes a long-lived auth token (90 days) for TV use.",
      "If the code expires (10 min), status returns 'expired' with a 404.",
    ],
    responseExample: `// Pending (keep polling)
{
  "status": "pending"
}

// Activated (stop polling, save token)
{
  "status": "activated",
  "token": "mrt_tv_token...",
  "expiresIn": 7776000,
  "user": {
    "id": "64a1b2c3d4e5f6a7b8c9d0e1",
    "displayName": "John Doe",
    "email": "john@example.com",
    "avatar": "https://..."
  }
}

// Expired
{
  "status": "expired",
  "message": "Code has expired"
}`,
    codeExamples: {
      curl: `curl "${BASE_URL}/api/auth/tv/code/482915/status?deviceId=tv-unique-id-123"`,
      javascript: `const pollTVStatus = async (code, deviceId) => {\n  const response = await fetch(\n    \`${BASE_URL}/api/auth/tv/code/\${code}/status?deviceId=\${deviceId}\`\n  );\n  const data = await response.json();\n  if (data.status === 'activated') {\n    console.log('TV logged in! Token:', data.token);\n    // Store token for future API calls\n  } else if (data.status === 'pending') {\n    setTimeout(() => pollTVStatus(code, deviceId), 3000);\n  } else {\n    console.log('Code expired, request a new one');\n  }\n};`,
      kotlin: `suspend fun pollStatus(code: String, deviceId: String) {\n    while (true) {\n        val request = Request.Builder()\n            .url("${BASE_URL}/api/auth/tv/code/$code/status?deviceId=$deviceId")\n            .build()\n        val response = client.newCall(request).execute()\n        val json = JSONObject(response.body?.string() ?: "")\n        when (json.getString("status")) {\n            "activated" -> {\n                val token = json.getString("token")\n                // Save token, navigate to home\n                return\n            }\n            "expired" -> { /* Request new code */ return }\n            else -> delay(3000)\n        }\n    }\n}`,
    },
  },
  {
    id: "tv-activate",
    method: "POST",
    path: "/api/auth/tv/activate",
    title: "TV: Activate Device (from Mobile)",
    description: "Called from the mobile app to activate a TV login code. The user enters the code displayed on their TV and submits it from the mobile app. Links the user's account to the TV device. Requires mobile auth (Bearer token or session).",
    bodyParams: [
      { name: "code", type: "string", required: true, description: "6-digit code displayed on TV" },
    ],
    headers: [
      { name: "Authorization", type: "string", required: true, description: "Bearer mrt_your_token (mobile auth)" },
    ],
    responseExample: `{
  "success": true,
  "deviceName": "Samsung TV",
  "deviceId": "tv-unique-id-123",
  "message": "Samsung TV successfully logged in as johndoe"
}`,
    codeExamples: {
      curl: `curl -X POST "${BASE_URL}/api/auth/tv/activate" \\\n  -H "Authorization: Bearer mrt_your_token" \\\n  -H "Content-Type: application/json" \\\n  -d '{"code": "482915"}'`,
      swift: `var request = URLRequest(url: URL(string: "${BASE_URL}/api/auth/tv/activate")!)\nrequest.httpMethod = "POST"\nrequest.setValue("Bearer \\(authToken)", forHTTPHeaderField: "Authorization")\nrequest.setValue("application/json", forHTTPHeaderField: "Content-Type")\nrequest.httpBody = try JSONEncoder().encode(["code": tvCode])`,
      kotlin: `val body = JSONObject().apply { put("code", tvCode) }\nval request = Request.Builder()\n    .url("${BASE_URL}/api/auth/tv/activate")\n    .header("Authorization", "Bearer $authToken")\n    .post(body.toString().toRequestBody("application/json".toMediaType()))\n    .build()`,
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
    headers: [
      { name: "Authorization", type: "string", required: true, description: "Bearer mrt_your_token" },
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
    path: "/api/cast/command",
    title: "Cast: Send Command",
    description: "Send playback commands to the paired TV/receiver device. Commands are relayed in real-time via WebSocket to the active cast session.",
    bodyParams: [
      { name: "sessionId", type: "string", required: true, description: "Cast session ID from the create step" },
      { name: "command", type: "string", required: true, description: "Command: play, pause, resume, stop, change_station, volume_up, volume_down, set_volume" },
      { name: "data", type: "object", description: "Additional data for the command (e.g., { stationId: '...' } for change_station, { volume: 75 } for set_volume)" },
    ],
    headers: [
      { name: "Authorization", type: "string", required: true, description: "Bearer mrt_your_token" },
    ],
    responseExample: `{
  "success": true,
  "command": "play",
  "sessionId": "cast_xyz789"
}`,
    codeExamples: {
      curl: `curl -X POST "${BASE_URL}/api/cast/command" \\\n  -H "Authorization: Bearer mrt_your_token" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "sessionId": "cast_xyz789",\n    "command": "change_station",\n    "data": { "stationId": "STATION_ID" }\n  }'`,
      javascript: `await fetch('${BASE_URL}/api/cast/command', {\n  method: 'POST',\n  headers: {\n    'Authorization': 'Bearer mrt_your_token',\n    'Content-Type': 'application/json'\n  },\n  body: JSON.stringify({\n    sessionId: 'cast_xyz789',\n    command: 'change_station',\n    data: { stationId: 'STATION_ID' }\n  })\n});`,
    },
  },
];

const MISC_ENDPOINTS: Endpoint[] = [
  {
    id: "translations",
    method: "GET",
    path: "/api/translations/:lang",
    title: "App Translations",
    description: "Get localized translation strings for the app UI. Supports 57 languages. Returns a key-value map of translation keys to localized strings.",
    params: [
      { name: "lang", type: "string", required: true, description: "Language code (e.g., 'en', 'tr', 'de', 'fr', 'es', 'ja', 'ko', 'zh')" },
    ],
    responseExample: `{
  "popular_stations": "Popular Stations",
  "trending": "Trending",
  "genres": "Genres",
  "countries": "Countries",
  "search_placeholder": "Search stations...",
  "now_playing": "Now Playing",
  "favorites": "Favorites",
  "recently_played": "Recently Played",
  "settings": "Settings"
}`,
    codeExamples: {
      curl: `# English\ncurl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/translations/en"\n\n# Turkish\ncurl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/translations/tr"\n\n# German\ncurl -H "X-API-Key: YOUR_KEY" "${BASE_URL}/api/translations/de"`,
      javascript: `const lang = 'tr';\nconst response = await fetch(\`${BASE_URL}/api/translations/\${lang}\`, {\n  headers: { 'X-API-Key': 'YOUR_KEY' }\n});\nconst translations = await response.json();`,
      swift: `let lang = Locale.current.language.languageCode?.identifier ?? "en"\nlet url = URL(string: "${BASE_URL}/api/translations/\\(lang)")!\nvar request = URLRequest(url: url)\nrequest.setValue("YOUR_KEY", forHTTPHeaderField: "X-API-Key")\nlet (data, _) = try await URLSession.shared.data(for: request)`,
      kotlin: `val lang = Locale.getDefault().language\nval request = Request.Builder()\n    .url("${BASE_URL}/api/translations/$lang")\n    .header("X-API-Key", "YOUR_KEY")\n    .build()`,
    },
  },
];

const MESSAGING_ENDPOINTS: Endpoint[] = [
  {
    id: "msg-conversations",
    method: "GET",
    path: "/api/messages/conversations",
    title: "List Conversations",
    description: "Get a list of all conversations for the authenticated user, sorted by most recent. Returns the last message, unread count, partner info, and online status for each conversation. Limited to 50 most recent conversations.",
    notes: [
      "Requires authentication (Bearer token or session).",
      "Conversations are grouped by partner - one entry per unique chat partner.",
      "Unread count shows messages from that partner you haven't read yet.",
    ],
    responseExample: `{
  "conversations": [
    {
      "partnerId": "64a1b2c3d4e5f6a7b8c9d0e1",
      "partner": {
        "_id": "64a1b2c3d4e5f6a7b8c9d0e1",
        "username": "johndoe",
        "fullName": "John Doe",
        "avatar": "https://..."
      },
      "lastMessage": "Hey, are you listening to Jazz FM?",
      "lastMessageAt": "2026-03-10T15:30:00.000Z",
      "unreadCount": 2,
      "online": true
    }
  ]
}`,
    codeExamples: {
      curl: `curl -H "Authorization: Bearer mrt_your_token" \\\n  "${BASE_URL}/api/messages/conversations"`,
      javascript: `const response = await fetch('${BASE_URL}/api/messages/conversations', {\n  headers: { 'Authorization': 'Bearer ' + token }\n});\nconst { conversations } = await response.json();`,
      swift: `var request = URLRequest(url: URL(string: "${BASE_URL}/api/messages/conversations")!)\nrequest.setValue("Bearer \\(token)", forHTTPHeaderField: "Authorization")\nlet (data, _) = try await URLSession.shared.data(for: request)`,
      kotlin: `val request = Request.Builder()\n    .url("${BASE_URL}/api/messages/conversations")\n    .header("Authorization", "Bearer $token")\n    .build()`,
    },
  },
  {
    id: "msg-conversation",
    method: "GET",
    path: "/api/messages/conversation/:partnerId",
    title: "Get Conversation Messages",
    description: "Get messages in a conversation with a specific user. Returns messages in chronological order. Automatically marks received messages as read. Supports pagination with cursor-based loading.",
    params: [
      { name: "partnerId", type: "string", required: true, description: "The user ID of the conversation partner (URL path)" },
      { name: "limit", type: "number", default: "50", description: "Number of messages to return (max 100) - query param" },
      { name: "before", type: "string", description: "Message ID cursor - load messages before this ID (for pagination) - query param" },
    ],
    notes: [
      "Requires authentication (Bearer token or session).",
      "Messages from the partner are automatically marked as read when you fetch them.",
      "The partner is notified via WebSocket that their messages were read (chat:read event).",
      "Related new_message notifications from this partner are also marked as read.",
    ],
    responseExample: `{
  "messages": [
    {
      "_id": "64b2c3d4e5f6a7b8c9d0e1f2",
      "fromUserId": "64a1b2c3d4e5f6a7b8c9d0e1",
      "toUserId": "64a9b8c7d6e5f4a3b2c1d0e9",
      "content": "Hey, are you listening to Jazz FM?",
      "messageType": "text",
      "read": true,
      "createdAt": "2026-03-10T15:30:00.000Z"
    },
    {
      "_id": "64b2c3d4e5f6a7b8c9d0e1f3",
      "fromUserId": "64a9b8c7d6e5f4a3b2c1d0e9",
      "toUserId": "64a1b2c3d4e5f6a7b8c9d0e1",
      "content": "Yes! Great station!",
      "messageType": "text",
      "read": false,
      "createdAt": "2026-03-10T15:31:00.000Z"
    }
  ],
  "partner": {
    "_id": "64a1b2c3d4e5f6a7b8c9d0e1",
    "username": "johndoe",
    "fullName": "John Doe",
    "avatar": "https://...",
    "online": true
  },
  "hasMore": false
}`,
    codeExamples: {
      curl: `# Get latest messages\ncurl -H "Authorization: Bearer mrt_your_token" \\\n  "${BASE_URL}/api/messages/conversation/PARTNER_ID?limit=50"\n\n# Load older messages (pagination)\ncurl -H "Authorization: Bearer mrt_your_token" \\\n  "${BASE_URL}/api/messages/conversation/PARTNER_ID?limit=50&before=LAST_MESSAGE_ID"`,
      javascript: `// Get latest messages\nconst response = await fetch(\n  '${BASE_URL}/api/messages/conversation/' + partnerId + '?limit=50',\n  { headers: { 'Authorization': 'Bearer ' + token } }\n);\nconst { messages, partner, hasMore } = await response.json();\n\n// Load more (pagination)\nif (hasMore) {\n  const oldestId = messages[0]._id;\n  const older = await fetch(\n    '${BASE_URL}/api/messages/conversation/' + partnerId + '?before=' + oldestId,\n    { headers: { 'Authorization': 'Bearer ' + token } }\n  );\n}`,
    },
  },
  {
    id: "msg-send",
    method: "POST",
    path: "/api/messages/send",
    title: "Send Message",
    description: "Send a direct message to another user. You can only message users you follow or who follow you (mutual follow not required, one-way is enough). Messages are delivered in real-time via WebSocket and stored in the database.",
    bodyParams: [
      { name: "toUserId", type: "string", required: true, description: "Recipient's user ID" },
      { name: "content", type: "string", required: true, description: "Message text (max 2000 characters)" },
      { name: "messageType", type: "string", default: "text", description: "Message type: 'text', 'image', or 'emoji'" },
      { name: "imageUrl", type: "string", description: "Image URL (only used when messageType is 'image'). Upload via /api/messages/upload-image first." },
    ],
    notes: [
      "Requires authentication (Bearer token or session).",
      "You can only message users you follow or who follow you.",
      "Cannot send messages to yourself.",
      "Message is delivered in real-time via WebSocket (chat:message event).",
      "A notification is created for the recipient if they're not currently viewing the conversation.",
      "Max message length: 2000 characters.",
    ],
    responseExample: `{
  "success": true,
  "message": {
    "_id": "64b2c3d4e5f6a7b8c9d0e1f4",
    "fromUserId": "64a9b8c7d6e5f4a3b2c1d0e9",
    "toUserId": "64a1b2c3d4e5f6a7b8c9d0e1",
    "content": "Hey, check out this station!",
    "messageType": "text",
    "read": false,
    "createdAt": "2026-03-10T16:00:00.000Z"
  }
}`,
    codeExamples: {
      curl: `curl -X POST "${BASE_URL}/api/messages/send" \\\n  -H "Authorization: Bearer mrt_your_token" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "toUserId": "64a1b2c3d4e5f6a7b8c9d0e1",\n    "content": "Hey, check out this station!",\n    "messageType": "text"\n  }'`,
      javascript: `const response = await fetch('${BASE_URL}/api/messages/send', {\n  method: 'POST',\n  headers: {\n    'Authorization': 'Bearer ' + token,\n    'Content-Type': 'application/json'\n  },\n  body: JSON.stringify({\n    toUserId: partnerId,\n    content: 'Hey, check out this station!',\n    messageType: 'text'\n  })\n});\nconst { success, message } = await response.json();`,
      swift: `let body: [String: Any] = [\n    "toUserId": partnerId,\n    "content": "Hey, check out this station!",\n    "messageType": "text"\n]\n\nvar request = URLRequest(url: URL(string: "${BASE_URL}/api/messages/send")!)\nrequest.httpMethod = "POST"\nrequest.setValue("Bearer \\(token)", forHTTPHeaderField: "Authorization")\nrequest.setValue("application/json", forHTTPHeaderField: "Content-Type")\nrequest.httpBody = try JSONSerialization.data(withJSONObject: body)`,
      kotlin: `val body = JSONObject().apply {\n    put("toUserId", partnerId)\n    put("content", "Hey, check out this station!")\n    put("messageType", "text")\n}\n\nval request = Request.Builder()\n    .url("${BASE_URL}/api/messages/send")\n    .header("Authorization", "Bearer $token")\n    .post(body.toString().toRequestBody("application/json".toMediaType()))\n    .build()`,
    },
  },
  {
    id: "msg-contacts",
    method: "GET",
    path: "/api/messages/contacts",
    title: "List Contacts",
    description: "Get a list of users you can chat with. Returns all users you follow and who follow you, with their online status and follow relationship details.",
    notes: [
      "Requires authentication.",
      "Returns users from both your following list and your followers list.",
      "Each contact includes iFollow (you follow them) and followsMe (they follow you) flags.",
    ],
    responseExample: `{
  "contacts": [
    {
      "_id": "64a1b2c3d4e5f6a7b8c9d0e1",
      "username": "johndoe",
      "fullName": "John Doe",
      "avatar": "https://...",
      "iFollow": true,
      "followsMe": true,
      "online": false
    }
  ]
}`,
    codeExamples: {
      curl: `curl -H "Authorization: Bearer mrt_your_token" \\\n  "${BASE_URL}/api/messages/contacts"`,
      javascript: `const response = await fetch('${BASE_URL}/api/messages/contacts', {\n  headers: { 'Authorization': 'Bearer ' + token }\n});\nconst { contacts } = await response.json();`,
    },
  },
  {
    id: "msg-unread",
    method: "GET",
    path: "/api/messages/unread-count",
    title: "Unread Message Count",
    description: "Get the total number of unread messages for the authenticated user across all conversations. Useful for showing a badge on the messages tab.",
    responseExample: `{
  "count": 5
}`,
    codeExamples: {
      curl: `curl -H "Authorization: Bearer mrt_your_token" \\\n  "${BASE_URL}/api/messages/unread-count"`,
      javascript: `const response = await fetch('${BASE_URL}/api/messages/unread-count', {\n  headers: { 'Authorization': 'Bearer ' + token }\n});\nconst { count } = await response.json();\n// Show badge: count > 0`,
    },
  },
  {
    id: "msg-search-users",
    method: "GET",
    path: "/api/messages/search-users",
    title: "Search Users to Chat",
    description: "Search for users you can start a conversation with. Only searches among your contacts (people you follow or who follow you). Minimum 2 characters required for search query.",
    params: [
      { name: "q", type: "string", required: true, description: "Search query (min 2 characters). Searches username and fullName." },
    ],
    responseExample: `{
  "users": [
    {
      "_id": "64a1b2c3d4e5f6a7b8c9d0e1",
      "username": "johndoe",
      "fullName": "John Doe",
      "avatar": "https://...",
      "online": true
    }
  ]
}`,
    codeExamples: {
      curl: `curl -H "Authorization: Bearer mrt_your_token" \\\n  "${BASE_URL}/api/messages/search-users?q=john"`,
      javascript: `const response = await fetch(\n  '${BASE_URL}/api/messages/search-users?q=' + encodeURIComponent(query),\n  { headers: { 'Authorization': 'Bearer ' + token } }\n);\nconst { users } = await response.json();`,
    },
  },
  {
    id: "msg-online-status",
    method: "GET",
    path: "/api/messages/online-status",
    title: "Online Status",
    description: "Check the online/offline status of multiple users at once. Pass a comma-separated list of user IDs. Returns a map of userId to boolean online status.",
    params: [
      { name: "userIds", type: "string", required: true, description: "Comma-separated list of user IDs to check" },
    ],
    responseExample: `{
  "status": {
    "64a1b2c3d4e5f6a7b8c9d0e1": true,
    "64a9b8c7d6e5f4a3b2c1d0e9": false
  }
}`,
    codeExamples: {
      curl: `curl -H "Authorization: Bearer mrt_your_token" \\\n  "${BASE_URL}/api/messages/online-status?userIds=USER_ID_1,USER_ID_2"`,
      javascript: `const userIds = ['id1', 'id2'].join(',');\nconst response = await fetch(\n  '${BASE_URL}/api/messages/online-status?userIds=' + userIds,\n  { headers: { 'Authorization': 'Bearer ' + token } }\n);\nconst { status } = await response.json();\n// status['id1'] === true means online`,
    },
  },
  {
    id: "msg-upload-image",
    method: "POST",
    path: "/api/messages/upload-image",
    title: "Upload Chat Image",
    description: "Upload an image to send in a chat message. Returns the image URL to use when sending a message with messageType='image'. Max file size: 5MB. Only image files are accepted.",
    bodyParams: [
      { name: "image", type: "file", required: true, description: "Image file (multipart/form-data). Max 5MB. Supported: jpg, png, gif, webp." },
    ],
    notes: [
      "Use multipart/form-data encoding (not JSON).",
      "After uploading, use the returned imageUrl in POST /api/messages/send with messageType='image'.",
      "Max file size: 5MB.",
    ],
    responseExample: `{
  "imageUrl": "/uploads/chat/1709654321-a1b2c3d4e5f6.jpg"
}`,
    codeExamples: {
      curl: `curl -X POST "${BASE_URL}/api/messages/upload-image" \\\n  -H "Authorization: Bearer mrt_your_token" \\\n  -F "image=@/path/to/photo.jpg"`,
      javascript: `const formData = new FormData();\nformData.append('image', {\n  uri: imageUri,\n  type: 'image/jpeg',\n  name: 'photo.jpg',\n});\n\nconst response = await fetch('${BASE_URL}/api/messages/upload-image', {\n  method: 'POST',\n  headers: { 'Authorization': 'Bearer ' + token },\n  body: formData\n});\nconst { imageUrl } = await response.json();\n\n// Now send the image as a message\nawait fetch('${BASE_URL}/api/messages/send', {\n  method: 'POST',\n  headers: {\n    'Authorization': 'Bearer ' + token,\n    'Content-Type': 'application/json'\n  },\n  body: JSON.stringify({\n    toUserId: partnerId,\n    content: 'Photo',\n    messageType: 'image',\n    imageUrl: imageUrl\n  })\n});`,
    },
  },
  {
    id: "msg-websocket",
    method: "GET",
    path: "/ws/chat?ticket=TICKET",
    title: "WebSocket Connection (Real-time)",
    description: "Connect to the real-time messaging WebSocket for live message delivery, typing indicators, read receipts, and online status updates. First obtain a one-time ticket via GET /api/messages/ws-ticket, then connect to the WebSocket with that ticket.",
    notes: [
      "Step 1: GET /api/messages/ws-ticket to get a one-time ticket (expires in 60 seconds).",
      "Step 2: Connect to wss://themegaradio.com/ws/chat?ticket=TICKET",
      "On connect, you receive a chat:connected event with your userId and online users list.",
      "Send chat:ping periodically to keep the connection alive (server responds with chat:pong).",
      "Send chat:typing { toUserId } when user is typing.",
      "Send chat:read { fromUserId } to mark messages as read.",
      "Send chat:active { withUserId } when user opens/closes a conversation (suppresses duplicate notifications).",
      "Receive chat:message for new messages, chat:typing for typing indicators, chat:read for read receipts.",
      "Receive chat:online_status for contact online/offline changes.",
      "Receive notification:new_message for message notifications (when not viewing that conversation).",
    ],
    responseExample: `// Events you RECEIVE:

// On connection
{ "type": "chat:connected", "userId": "YOUR_ID", "onlineUsers": ["id1", "id2"] }

// New message
{
  "type": "chat:message",
  "message": {
    "_id": "msg_id",
    "fromUserId": "sender_id",
    "toUserId": "your_id",
    "content": "Hello!",
    "messageType": "text",
    "read": false,
    "createdAt": "2026-03-10T16:00:00Z"
  },
  "sender": { "username": "johndoe", "fullName": "John Doe", "avatar": "..." }
}

// Typing indicator
{ "type": "chat:typing", "fromUserId": "sender_id" }

// Read receipt
{ "type": "chat:read", "byUserId": "reader_id" }

// Online status change
{ "type": "chat:online_status", "userId": "user_id", "online": true }

// Events you SEND:
// { "type": "chat:typing", "toUserId": "partner_id" }
// { "type": "chat:read", "fromUserId": "partner_id" }
// { "type": "chat:active", "withUserId": "partner_id" }  // opened conversation
// { "type": "chat:active", "withUserId": null }           // closed conversation
// { "type": "chat:ping" }                                  // keepalive`,
    codeExamples: {
      curl: `# Step 1: Get ticket\nTICKET=$(curl -s -H "Authorization: Bearer mrt_your_token" \\\n  "${BASE_URL}/api/messages/ws-ticket" | jq -r '.ticket')\n\n# Step 2: Connect (use wscat or similar tool)\nwscat -c "wss://themegaradio.com/ws/chat?ticket=$TICKET"`,
      javascript: `// Step 1: Get ticket\nconst ticketRes = await fetch('${BASE_URL}/api/messages/ws-ticket', {\n  headers: { 'Authorization': 'Bearer ' + token }\n});\nconst { ticket } = await ticketRes.json();\n\n// Step 2: Connect WebSocket\nconst ws = new WebSocket('wss://themegaradio.com/ws/chat?ticket=' + ticket);\n\nws.onopen = () => console.log('Connected!');\n\nws.onmessage = (event) => {\n  const data = JSON.parse(event.data);\n  switch (data.type) {\n    case 'chat:connected':\n      console.log('Online users:', data.onlineUsers);\n      break;\n    case 'chat:message':\n      console.log('New message:', data.message.content);\n      // Show message in UI\n      break;\n    case 'chat:typing':\n      // Show typing indicator for data.fromUserId\n      break;\n    case 'chat:read':\n      // Mark messages as read for data.byUserId\n      break;\n    case 'chat:online_status':\n      // Update online status for data.userId\n      break;\n  }\n};\n\n// Send typing indicator\nws.send(JSON.stringify({ type: 'chat:typing', toUserId: partnerId }));\n\n// Mark messages as read\nws.send(JSON.stringify({ type: 'chat:read', fromUserId: partnerId }));\n\n// Keepalive ping every 30s\nsetInterval(() => ws.send(JSON.stringify({ type: 'chat:ping' })), 30000);`,
      swift: `// Step 1: Get ticket\nvar ticketReq = URLRequest(url: URL(string: "${BASE_URL}/api/messages/ws-ticket")!)\nticketReq.setValue("Bearer \\(token)", forHTTPHeaderField: "Authorization")\nlet (ticketData, _) = try await URLSession.shared.data(for: ticketReq)\nlet ticket = try JSONDecoder().decode(TicketResponse.self, from: ticketData).ticket\n\n// Step 2: Connect WebSocket\nlet wsURL = URL(string: "wss://themegaradio.com/ws/chat?ticket=\\(ticket)")!\nlet wsTask = URLSession.shared.webSocketTask(with: wsURL)\nwsTask.resume()\n\n// Receive messages\nfunc receiveMessage() {\n    wsTask.receive { result in\n        switch result {\n        case .success(let message):\n            if case .string(let text) = message {\n                // Parse JSON and handle event types\n            }\n            receiveMessage() // Continue listening\n        case .failure(let error):\n            print("WS error: \\(error)")\n        }\n    }\n}\nreceiveMessage()`,
      kotlin: `// Step 1: Get ticket\nval ticketReq = Request.Builder()\n    .url("${BASE_URL}/api/messages/ws-ticket")\n    .header("Authorization", "Bearer $token")\n    .build()\nval ticketRes = client.newCall(ticketReq).execute()\nval ticket = JSONObject(ticketRes.body?.string() ?: "").getString("ticket")\n\n// Step 2: Connect WebSocket\nval wsReq = Request.Builder()\n    .url("wss://themegaradio.com/ws/chat?ticket=$ticket")\n    .build()\n\nclient.newWebSocket(wsReq, object : WebSocketListener() {\n    override fun onMessage(ws: WebSocket, text: String) {\n        val data = JSONObject(text)\n        when (data.getString("type")) {\n            "chat:message" -> { /* Handle new message */ }\n            "chat:typing" -> { /* Show typing indicator */ }\n            "chat:read" -> { /* Update read status */ }\n            "chat:online_status" -> { /* Update online status */ }\n        }\n    }\n})`,
    },
  },
];

const GuidesContent = memo(({ guideId }: { guideId: string }) => {
  const guides: Record<string, { title: string; lang: string; code: string }> = {
    "guide-javascript": {
      title: "JavaScript / Web Integration",
      lang: "JavaScript",
      code: `const API_KEY = 'YOUR_API_KEY';
const BASE = 'https://themegaradio.com/api';

async function fetchAPI(path, params = {}) {
  const url = new URL(BASE + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, { headers: { 'X-API-Key': API_KEY } });
  return res.json();
}

// Search for stations (country accepts: English, ISO-2, ISO-3, native names)
const results = await fetchAPI('/stations', {
  search: 'jazz',
  country: 'DE',  // or 'Germany', 'DEU', 'Deutschland', 'Almanya'
  limit: '10'
});
console.log(results.stations);
console.log(results.pagination);

// Get genres for a specific country
const genres = await fetchAPI('/genres/precomputed', { countryName: 'TR' });
console.log(genres.data);

// Get stations by genre
const rockStations = await fetchAPI('/genres/rock/stations', {
  country: 'TR',
  limit: '20'
});
console.log(rockStations.stations);

// App startup (single request for all init data)
const initData = await fetchAPI('/tv/init', { countryCode: 'TR' });
console.log(initData.popularStations);
console.log(initData.trendingStations);
console.log(initData.genres);

// Resolve and play a stream
const station = results.stations[0];
const stream = await fetchAPI('/stream/resolve', {
  url: station.url
});
const audio = new Audio(stream.candidates[0]);
audio.play();

// Get now playing info (accepts slug or ID)
const np = await fetchAPI('/now-playing/' + station.slug);
console.log(\`Now: \${np.artist} - \${np.title}\`);`
    },
    "guide-react-native": {
      title: "React Native Integration",
      lang: "React Native",
      code: `import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity } from 'react-native';
import TrackPlayer from 'react-native-track-player';

const API_KEY = 'YOUR_API_KEY';
const BASE = 'https://themegaradio.com/api';

const api = async (path, params = {}) => {
  const url = new URL(BASE + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: { 'X-API-Key': API_KEY }
  });
  return res.json();
};

function RadioApp() {
  const [initData, setInitData] = useState(null);

  useEffect(() => {
    // Single init request for app startup
    api('/tv/init', { countryCode: 'TR', limit: '20' })
      .then(setInitData);
  }, []);

  const playStation = async (station) => {
    const stream = await api('/stream/resolve', { url: station.url });
    const directUrl = stream.candidates?.[0] || station.url;

    await TrackPlayer.reset();
    await TrackPlayer.add({
      id: station._id,
      url: directUrl,
      title: station.name,
      artist: station.country,
      artwork: station.favicon
    });
    await TrackPlayer.play();

    // Track the click
    await fetch(BASE + '/stations/' + station._id + '/click', {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY }
    });
  };

  if (!initData) return <Text>Loading...</Text>;

  return (
    <FlatList
      data={initData.popularStations}
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
        try? AVAudioSession.sharedInstance().setCategory(
            .playback, mode: .default
        )
        try? AVAudioSession.sharedInstance().setActive(true)
    }

    // App init - single request for startup data
    func getInitData(countryCode: String = "TR") async throws -> TVInitData {
        let url = URL(string: "\\(baseURL)/tv/init?countryCode=\\(countryCode)")!
        var request = URLRequest(url: url)
        request.setValue(apiKey, forHTTPHeaderField: "X-API-Key")
        let (data, _) = try await URLSession.shared.data(for: request)
        return try JSONDecoder().decode(TVInitData.self, from: data)
    }

    // Search stations (country: English, ISO-2, ISO-3, native all work)
    func searchStations(
        query: String,
        country: String? = nil,
        limit: Int = 20
    ) async throws -> StationsResponse {
        var components = URLComponents(string: "\\(baseURL)/stations")!
        components.queryItems = [
            URLQueryItem(name: "search", value: query),
            URLQueryItem(name: "limit", value: "\\(limit)")
        ]
        if let country { components.queryItems?.append(
            URLQueryItem(name: "country", value: country)
        )}

        var request = URLRequest(url: components.url!)
        request.setValue(apiKey, forHTTPHeaderField: "X-API-Key")
        let (data, _) = try await URLSession.shared.data(for: request)
        return try JSONDecoder().decode(StationsResponse.self, from: data)
    }

    // Get stations by genre (with optional country filter)
    func getGenreStations(
        slug: String, country: String? = nil, limit: Int = 20
    ) async throws -> GenreStationsResponse {
        var comps = URLComponents(string: "\\(baseURL)/genres/\\(slug)/stations")!
        comps.queryItems = [URLQueryItem(name: "limit", value: "\\(limit)")]
        if let country { comps.queryItems?.append(
            URLQueryItem(name: "country", value: country)
        )}
        var request = URLRequest(url: comps.url!)
        request.setValue(apiKey, forHTTPHeaderField: "X-API-Key")
        let (data, _) = try await URLSession.shared.data(for: request)
        return try JSONDecoder().decode(GenreStationsResponse.self, from: data)
    }

    func play(station: Station) async throws {
        // Resolve the stream URL
        let streamUrl = station.url.addingPercentEncoding(
            withAllowedCharacters: .urlQueryAllowed
        )!
        let url = URL(string: "\\(baseURL)/stream/resolve?url=\\(streamUrl)")!
        var request = URLRequest(url: url)
        request.setValue(apiKey, forHTTPHeaderField: "X-API-Key")
        let (data, _) = try await URLSession.shared.data(for: request)
        let result = try JSONDecoder().decode(StreamResolve.self, from: data)
        let directUrl = result.candidates.first ?? station.url

        let playerItem = AVPlayerItem(url: URL(string: directUrl)!)
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

    // App init - single request for startup data
    suspend fun getInitData(countryCode: String = "TR"): JSONObject {
        val request = Request.Builder()
            .url("$baseUrl/tv/init?countryCode=$countryCode&limit=30")
            .header("X-API-Key", apiKey)
            .build()
        val response = client.newCall(request).execute()
        return JSONObject(response.body?.string() ?: "")
    }

    // Search stations (country: English, ISO-2, ISO-3, native all work)
    suspend fun searchStations(
        query: String,
        country: String? = null,
        limit: Int = 20
    ): JSONObject {
        val url = buildString {
            append("$baseUrl/stations?search=$query&limit=$limit")
            country?.let { append("&country=$it") }
        }
        val request = Request.Builder()
            .url(url)
            .header("X-API-Key", apiKey)
            .build()
        val response = client.newCall(request).execute()
        return JSONObject(response.body?.string() ?: "")
    }

    // Get stations by genre (with optional country filter)
    suspend fun getGenreStations(
        slug: String,
        country: String? = null,
        limit: Int = 20
    ): JSONObject {
        val url = buildString {
            append("$baseUrl/genres/$slug/stations?limit=$limit")
            country?.let { append("&country=$it") }
        }
        val request = Request.Builder()
            .url(url)
            .header("X-API-Key", apiKey)
            .build()
        val response = client.newCall(request).execute()
        return JSONObject(response.body?.string() ?: "")
    }

    suspend fun playStation(station: JSONObject) {
        // Resolve stream URL
        val stationUrl = station.getString("url")
        val request = Request.Builder()
            .url("$baseUrl/stream/resolve?url=$stationUrl")
            .header("X-API-Key", apiKey)
            .build()
        val response = client.newCall(request).execute()
        val json = JSONObject(response.body?.string() ?: "")
        val candidates = json.getJSONArray("candidates")
        val streamUrl = if (candidates.length() > 0)
            candidates.getString(0) else stationUrl

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

  "list-stations": () => <EndpointSection title="Stations" description="Browse, search, and discover radio stations from our database of 40,000+ stations worldwide. The country parameter supports English names, native names, Turkish names, ISO-2 codes (DE), and ISO-3 codes (DEU)." endpoints={STATION_ENDPOINTS} />,
  "get-station": () => <EndpointSection title="Stations" description="Browse, search, and discover radio stations." endpoints={STATION_ENDPOINTS} />,
  "popular-stations": () => <EndpointSection title="Stations" description="Browse, search, and discover radio stations." endpoints={STATION_ENDPOINTS} />,
  "search-stations": () => <EndpointSection title="Stations" description="Browse, search, and discover radio stations." endpoints={STATION_ENDPOINTS} />,
  "nearby-stations": () => <EndpointSection title="Stations" description="Browse, search, and discover radio stations." endpoints={STATION_ENDPOINTS} />,
  "similar-stations": () => <EndpointSection title="Stations" description="Browse, search, and discover radio stations." endpoints={STATION_ENDPOINTS} />,
  "random-station": () => <EndpointSection title="Stations" description="Browse, search, and discover radio stations." endpoints={STATION_ENDPOINTS} />,
  "track-click": () => <EndpointSection title="Stations" description="Browse, search, and discover radio stations." endpoints={STATION_ENDPOINTS} />,

  "list-genres": () => <EndpointSection title="Discovery" description="Explore genres, countries, languages, trending stations, community favorites, and diverse recommendations. All country parameters support multiple formats." endpoints={DISCOVERY_ENDPOINTS} />,
  "genre-stations": () => <EndpointSection title="Discovery" description="Explore genres, countries, languages, and discover new content." endpoints={DISCOVERY_ENDPOINTS} />,
  "discoverable-genres": () => <EndpointSection title="Discovery" description="Explore genres, countries, languages, and discover new content." endpoints={DISCOVERY_ENDPOINTS} />,
  "list-countries": () => <EndpointSection title="Discovery" description="Explore genres, countries, languages, and discover new content." endpoints={DISCOVERY_ENDPOINTS} />,
  "list-languages": () => <EndpointSection title="Discovery" description="Explore genres, countries, languages, and discover new content." endpoints={DISCOVERY_ENDPOINTS} />,
  trending: () => <EndpointSection title="Discovery" description="Explore genres, countries, languages, and discover new content." endpoints={DISCOVERY_ENDPOINTS} />,
  "community-favorites": () => <EndpointSection title="Discovery" description="Explore genres, countries, languages, and discover new content." endpoints={DISCOVERY_ENDPOINTS} />,
  "diverse-recommendations": () => <EndpointSection title="Discovery" description="Explore genres, countries, languages, and discover new content." endpoints={DISCOVERY_ENDPOINTS} />,

  "resolve-stream": () => <EndpointSection title="Streaming" description="Resolve stream URLs and get real-time now-playing metadata for live radio playback." endpoints={STREAMING_ENDPOINTS} />,
  "now-playing": () => <EndpointSection title="Streaming" description="Resolve stream URLs and get real-time now-playing metadata." endpoints={STREAMING_ENDPOINTS} />,

  signup: () => <EndpointSection title="User Authentication" description="Create accounts, authenticate users via web sessions or mobile tokens. Supports separate web and mobile login flows." endpoints={USER_AUTH_ENDPOINTS} />,
  "web-login": () => <EndpointSection title="User Authentication" description="Authenticate users via web sessions or mobile tokens." endpoints={USER_AUTH_ENDPOINTS} />,
  "mobile-login": () => <EndpointSection title="User Authentication" description="Authenticate users via web sessions or mobile tokens." endpoints={USER_AUTH_ENDPOINTS} />,
  "current-user": () => <EndpointSection title="User Authentication" description="Authenticate users via web sessions or mobile tokens." endpoints={USER_AUTH_ENDPOINTS} />,

  "list-favorites": () => <EndpointSection title="User Data" description="Manage user favorites, recently played stations, ratings, and push notification tokens. All endpoints require authentication." endpoints={USER_DATA_ENDPOINTS} />,
  "add-favorite": () => <EndpointSection title="User Data" description="Manage user favorites, recently played, and push tokens." endpoints={USER_DATA_ENDPOINTS} />,
  "remove-favorite": () => <EndpointSection title="User Data" description="Manage user favorites, recently played, and push tokens." endpoints={USER_DATA_ENDPOINTS} />,
  "list-recently-played": () => <EndpointSection title="User Data" description="Manage user favorites, recently played, and push tokens." endpoints={USER_DATA_ENDPOINTS} />,
  "add-recently-played": () => <EndpointSection title="User Data" description="Manage user favorites, recently played, and push tokens." endpoints={USER_DATA_ENDPOINTS} />,
  "rate-station": () => <EndpointSection title="User Data" description="Manage user favorites, recently played, and push tokens." endpoints={USER_DATA_ENDPOINTS} />,
  "register-push-token": () => <EndpointSection title="User Data" description="Manage user favorites, recently played, and push tokens." endpoints={USER_DATA_ENDPOINTS} />,
  "unregister-push-token": () => <EndpointSection title="User Data" description="Manage user favorites, recently played, and push tokens." endpoints={USER_DATA_ENDPOINTS} />,

  "tv-init": () => <EndpointSection title="TV & Cast" description="TV/Mobile app initialization, device pairing, and cast session control. The TV init endpoint provides all startup data in a single request." endpoints={TV_CAST_ENDPOINTS} />,
  "tv-request-code": () => <EndpointSection title="TV & Cast" description="TV device pairing and cast control." endpoints={TV_CAST_ENDPOINTS} />,
  "tv-poll-status": () => <EndpointSection title="TV & Cast" description="TV device pairing and cast control." endpoints={TV_CAST_ENDPOINTS} />,
  "tv-activate": () => <EndpointSection title="TV & Cast" description="TV device pairing and cast control." endpoints={TV_CAST_ENDPOINTS} />,
  "cast-create": () => <EndpointSection title="TV & Cast" description="TV device pairing and cast control." endpoints={TV_CAST_ENDPOINTS} />,
  "cast-command": () => <EndpointSection title="TV & Cast" description="TV device pairing and cast control." endpoints={TV_CAST_ENDPOINTS} />,

  "google-login": () => <EndpointSection title="User Authentication" description="Authenticate users via web sessions, mobile tokens, or social login (Google, Apple)." endpoints={USER_AUTH_ENDPOINTS} />,
  "apple-login": () => <EndpointSection title="User Authentication" description="Authenticate users via web sessions, mobile tokens, or social login (Google, Apple)." endpoints={USER_AUTH_ENDPOINTS} />,

  "msg-conversations": () => <EndpointSection title="Messaging" description="Real-time direct messaging between users. Send messages, share images, get typing indicators and read receipts via WebSocket. Users can message anyone they follow or who follows them." endpoints={MESSAGING_ENDPOINTS} />,
  "msg-conversation": () => <EndpointSection title="Messaging" description="Real-time direct messaging between users." endpoints={MESSAGING_ENDPOINTS} />,
  "msg-send": () => <EndpointSection title="Messaging" description="Real-time direct messaging between users." endpoints={MESSAGING_ENDPOINTS} />,
  "msg-contacts": () => <EndpointSection title="Messaging" description="Real-time direct messaging between users." endpoints={MESSAGING_ENDPOINTS} />,
  "msg-unread": () => <EndpointSection title="Messaging" description="Real-time direct messaging between users." endpoints={MESSAGING_ENDPOINTS} />,
  "msg-search-users": () => <EndpointSection title="Messaging" description="Real-time direct messaging between users." endpoints={MESSAGING_ENDPOINTS} />,
  "msg-online-status": () => <EndpointSection title="Messaging" description="Real-time direct messaging between users." endpoints={MESSAGING_ENDPOINTS} />,
  "msg-upload-image": () => <EndpointSection title="Messaging" description="Real-time direct messaging between users." endpoints={MESSAGING_ENDPOINTS} />,
  "msg-websocket": () => <EndpointSection title="Messaging" description="Real-time direct messaging between users. Connect via WebSocket for live updates." endpoints={MESSAGING_ENDPOINTS} />,

  translations: () => <EndpointSection title="Misc" description="Utility endpoints for app localization and other features." endpoints={MISC_ENDPOINTS} />,

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
            <p className="text-sm text-slate-500">Mega Radio API v1.0 -- Need help? Contact <a href="mailto:api@themegaradio.com" className="text-blue-400 hover:text-blue-300">api@themegaradio.com</a></p>
          </div>
        </footer>
      </main>
    </div>
  );
}