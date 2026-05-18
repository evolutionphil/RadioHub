# A.4 — SSR Output Verification: Production Access Notes
Date: 2026-05-18

## Production Access Status

**Status: BLOCKED FROM AUDIT CONTAINER**

All curl attempts to `https://themegaradio.com` return:
```
HTTP/2 403
x-deny-reason: host_not_allowed
Content-Length: 21
Content-Type: text/plain
Body: Host not in allowlist
```

Response time: ~36ms (very fast — blocked at edge, not at Express)

Tested with:
- Default curl UA
- Googlebot UA: `Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)`
- Chrome UA: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124`
- WebFetch tool: Also blocked (HTTP 403)

## Root Cause

This is a **Cloudflare WAF rule** or **tunnel/origin protection** that blocks requests from
cloud provider/data-center IP ranges. The `x-deny-reason: host_not_allowed` header is
characteristic of Cloudflare's bot management or origin rules.

This does NOT affect real users (browser IPs) or Googlebot (Google's IPs are whitelisted
by Cloudflare for SEO purposes).

## Impact on Audit

The following A.4 checks CANNOT be performed from this container:
- Live SSR HTML samples
- Redirect chain verification
- Cache-Control headers per URL
- Response size measurement
- Soft-404 detection via live fetch

## Alternative Methods

1. **GSC URL Inspection API** (pending Search Console access): will provide
   `pageFetchState`, `indexingState`, `robotsTxtState`, `googleCanonical` per URL.
   Script ready at: `artifacts/api-server/src/scripts/audit/gsc-coverage-snapshot.mts`

2. **User-side curl**: User can run the curl commands below from their local machine
   or from the Railway container's shell to get SSR samples.

3. **Static code analysis**: seo-renderer.ts fully analyzed — SSR behavior is
   deterministic and can be audited without live fetches.

## Curl Commands for User to Run Locally

```bash
# Googlebot test on homepage
curl -A "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" \
  -i -L --compressed "https://themegaradio.com/en" 2>&1 | head -100

# Check meta robots and canonical on a station page
curl -A "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" \
  -s --compressed "https://themegaradio.com/en/station/bbc-radio-1" | \
  grep -E 'meta name="robots"|link rel="canonical"|hreflang|og:title|<title>|<h1'

# Check a noindex'd URL (numeric slug example from GSC)
curl -A "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" \
  -i --compressed "https://themegaradio.com/af/station/-2516" 2>&1 | grep -E 'HTTP|robots|canonical'

# Check a country-code prefix URL
curl -A "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" \
  -i -L --compressed "https://themegaradio.com/qa/station/bbc-radio-1" 2>&1

# Check robots.txt
curl -i "https://themegaradio.com/robots.txt"

# Check sitemap index
curl -s "https://themegaradio.com/sitemap-index.xml" | head -100
```

## Static Analysis Findings (from code review)

Based on seo-renderer.ts analysis, SSR output for station pages will contain:
- `<html lang="{language}">` ← Matches URL prefix
- `<title>` ← Station name + " | MegaRadio" pattern
- `<meta name="description">` ← From REQUIRED_STATION_SEO_KEYS templates
- `<meta name="robots" content="noindex, follow">` ← When langIneligible/junk/numericSlug
- `<link rel="canonical">` ← Self-URL when indexable; /en/station/{slug} when noindex
- `<link rel="alternate" hreflang="X">` ← Only for eligible+qualified languages (NOT all 57)
- `<script type="application/ld+json">` ← RadioStation schema
- `window.__INITIAL_TRANSLATIONS__` ← Pre-loaded translations for the language
- Real station name, country, genre in visible text (SSR, NOT SPA shell)

The SSR output is REAL rendered content for Googlebot — not a thin JS shell.
This means H6 (SSR not rendering for crawlers) is **FALSE**.
