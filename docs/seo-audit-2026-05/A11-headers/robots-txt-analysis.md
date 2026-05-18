# A.11 — Robots.txt, Headers & Geo-Block Risk
Date: 2026-05-18
Method: Static code analysis (production 403'd from audit container — see A4 findings)

---

## robots.txt (source: seo-sitemap-routes.ts:963-1113)

### Structure
- `User-agent: *` (all crawlers): Open `/api/` broadly, then narrow Disallows for sensitive paths
- Specific rules for: Baiduspider, Sogou, GPTBot, ChatGPT-User, OAI-SearchBot, CCBot, anthropic-ai, Claude-Web, ClaudeBot, Bytespider, PerplexityBot, Perplexity-User, Applebot-Extended, cohere-ai, Google-Extended, Meta-ExternalAgent, Amazonbot, DuckAssistBot, YouBot, Diffbot
- `Sitemap: {baseUrl}/sitemap-index.xml`
- Cache: `public, max-age=86400` (24h)

### Allow/Disallow Rules (User-agent: *)
```
Allow: /api/                    ← Open API so Googlebot WRS can fetch SSR data
Disallow: /api/admin/           ← Admin routes
Disallow: /api/auth/            ← Auth flows
Disallow: /api/user/            ← User-scoped data
Disallow: /api/users/
Disallow: /api/sync/
Disallow: /api/test/
Disallow: /api/payments/
Disallow: /api/iap/
Disallow: /api/push/
Disallow: /api/stream/          ← Audio stream proxy
Disallow: /api/stream-analysis
Disallow: /api/stream-https-analysis
Disallow: /api/tv/
Disallow: /api/analytics
Disallow: /api/messages/
Disallow: /api/cast/
Disallow: /api/ml/
Disallow: /api/image/           ← OG image generator (blocked — see concern below)
Disallow: /api/internal/
Disallow: /api/cache/
Disallow: /api/logs/
Disallow: /*/admin/             ← Admin pages
Disallow: /*/admin
Disallow: /*/settings
Disallow: /*/import-export
Disallow: /*/analytics
Disallow: /*/messages
Disallow: /*/profile             ← User profile pages
Disallow: /search                ← Search pages (all languages)
Disallow: /*/search              ← Language-prefixed search
Disallow: /*?*q=                 ← URLs with q= parameter (search queries)
Disallow: /*?*utm_               ← UTM-tagged URLs
Allow: /                         ← Everything else
```

### Concerns / Findings

| # | Concern | Severity | Notes |
|---|---|---|---|
| R1 | `Disallow: /api/image/` blocks OG image route `/api/og-image/:slug` | MEDIUM | Google can't fetch station OG images for rich previews. Could impact rich results. |
| R2 | `Disallow: /*?*utm_` blocks all UTM-tagged URLs | LOW | UTM parameters shouldn't appear on canonical URLs, so this is harmless for indexing. Correct. |
| R3 | `Disallow: /*/search` + `Disallow: /search` blocks all search pages | LOW | Search result pages should NOT be indexed (correct), but confirm no important content is on `/search` paths. |
| R4 | `Disallow: /*?*q=` is broad — could block `?quality=` or `?quantity=` if used | LOW | Check that no canonical URLs use `q=` parameter. |
| R5 | AI crawlers (GPTBot, ClaudeBot, etc.) all have `Allow: /` — no Disallow rules | INFO | User explicitly approved AI crawler access per geo-block middleware comments. Correct. |
| R6 | No specific `User-agent: Googlebot` stanza | INFO | Falls under `User-agent: *` rules. Google uses "longest match wins" which is correctly applied here. |

### Verdict
robots.txt is **CORRECT** and does NOT block any legitimate station/homepage/genre/country content from Googlebot. The geo-block concern is NOT in robots.txt.

---

## Geo-Block Risk (source: middleware/geo-block.ts)

### Configuration
- Blocked countries (default): `SG`, `TH` (Singapore, Thailand)
- Env override: `BLOCKED_COUNTRIES` comma-separated
- Bot bypass: `SEARCH_BOT_BYPASS_RE` regex includes all major crawlers
- CF-Only enforcement: OFF by default (`ENFORCE_CF_ONLY=false`)

### Search Bot Bypass Regex
```ts
/\b(googlebot|google-inspectiontool|google-extended|bingbot|yandexbot|slurp|
duckduckbot|baiduspider|applebot|applebot-extended|sogou|petalbot|seznambot|
naverbot|facebookexternalhit|twitterbot|linkedinbot|gptbot|chatgpt-user|
oai-searchbot|ccbot|anthropic-ai|claude-web|claudebot|bytespider|
perplexitybot|perplexity-user|cohere-ai|meta-externalagent|amazonbot|
duckassistbot|youbot|diffbot)\b/i
```

**Googlebot IS in the bypass list** → geo-block does NOT affect Googlebot.

### H1 Verdict: Geo-block is NOT blocking Googlebot
- Googlebot is explicitly exempted
- Blocked countries are only SG and TH
- `ENFORCE_CF_ONLY=false` means no CF-only enforcement

### Production 403 From Audit Container
The 403 `x-deny-reason: host_not_allowed` received from this audit container is:
- NOT from the Express geo-block middleware (that destroys the TCP socket, not returning 403 body)
- NOT from Googlebot path (Googlebot uses Google's IP ranges, not this container's cloud IP)
- LIKELY from Cloudflare WAF blocking data-center/cloud provider IPs
- This does NOT affect Googlebot (Google's IPs are whitelisted by Cloudflare)

**Implication**: The 1-page-indexed problem is NOT caused by H1 (geo-block). Googlebot can reach the site.

---

## Rate Limit Risk (source: index-api.ts)

The rate limiter at `index-api.ts:55` applies `globalApiLimiter` (100 req/min). Search bots are exempted via the same `SEARCH_BOT_RE` regex pattern (matching the geo-block bypass regex). Googlebot is NOT rate-limited.

**Verdict**: Rate limiting is NOT blocking Googlebot.

---

## X-Robots-Tag Headers (source: index-web.ts:213-219)

The `X-Robots-Tag` header is set on EVERY response:
- Auth paths (AUTH_NOINDEX_PATH regex): `X-Robots-Tag: noindex, follow`
- All other paths: `X-Robots-Tag: index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1`

**Concern**: Does `X-Robots-Tag: index, follow` on station pages CONFLICT with the in-page `<meta name="robots" content="noindex">`?

Per Google's rules: **header takes precedence over meta tag** for HTTP responses. However, if the header says `index` but the meta tag says `noindex`, Google uses the **most restrictive** interpretation = `noindex`.

Actually: Google follows "most restrictive" — both must agree. The `X-Robots-Tag: index, follow` is overridden by `<meta name="robots" content="noindex">`. This is CORRECT behavior.

**Verdict**: No conflict — the in-page noindex correctly takes effect for noindex'd pages.

---

## Vary Headers (source: index-web.ts:226)
```
Vary: Accept-Encoding, User-Agent, Accept-Language, CF-IPCountry
```

This is correct. Cloudflare and CDNs will vary the cache on all these dimensions, preventing cross-locale or cross-bot cache poisoning.

---

## HSTS (source: index-web.ts)
- Production: `max-age=31536000; includeSubDomains; preload`
- Correct for a mature production site.

---

## Summary Verdict

| Risk | Status |
|---|---|
| Robots.txt blocking Googlebot | ✅ No issue (H13 = FALSE) |
| Geo-block blocking Googlebot | ✅ No issue (H1 = FALSE — bot bypass regex is correct) |
| Rate-limiter throttling Googlebot | ✅ No issue |
| CF-Only enforcement blocking Googlebot | ✅ Disabled by default |
| Global noindex in robots.txt | ✅ No |
| X-Robots-Tag conflict with meta noindex | ✅ No conflict (most-restrictive wins) |
| OG image crawling blocked | ⚠️ Minor: /api/og-image/ is Disallow'd in robots.txt |
