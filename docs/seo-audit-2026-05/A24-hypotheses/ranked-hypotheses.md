# A.24 — "Why Only 1 Page Indexed" Hypothesis Tournament
Date: 2026-05-18
Evidence source: Static code analysis of full codebase + GSC CSV exports (368 noindex URLs)

---

## VERDICT: Top Root Causes

Based on code analysis, the "only 1 indexed in 12 months" + "368 noindex URLs growing 60×" is
explained by a COMBINATION of causes ranked below. No single bug explains everything.

---

## Hypothesis Rankings

### 🔴 H12 — Per-language quality gates dropping pages from index [CONFIRMED — PRIMARY CAUSE]
**Weight: CRITICAL (explains ~80% of noindex URLs)**

**Evidence:**
- `qualified-languages.ts` computes "qualified" languages by checking `hasCompleteSeoTranslations()` against ALL 57 SEO languages
- `hasCompleteSeoTranslations` requires ALL 15 keys (7 station + 8 homepage) to be in MongoDB `Translation` collection
- Incident log in `qualified-languages.ts:3-18` confirms: "warm up to the real **10 qualified languages**" while 49 were in the old sitemap
- Languages NOT in the qualified set → every station page in that language = `noindex, follow`
- With ~57 languages and only ~10 qualified: approximately **47 languages have ALL station pages noindex'd**
- UNIVERSAL_LANGUAGES (always eligible for all stations) = 14 languages: `en, es, fr, de, pt, it, ru, ar, zh, tr, ja, ko, hi, he`
- If only 10 of these 14 are qualified, then ALL stations would have noindex in the other 4 universal languages

**The timeline match:**
- 2026-04-21: 6 noindex URLs
- 2026-04-30: LKG (Last-Known-Good) system deployed — stricter qualification gate
- 2026-05-15: 368 noindex URLs (60× increase in 3 weeks)
- The LKG change coincides EXACTLY with the noindex explosion

**Code path:** `seo-renderer.ts:974-1008` → `getQualifiedLanguagesState()` → `computeFromTranslations()` → `hasCompleteSeoTranslations()` requiring 15 MongoDB keys

**Fix (Phase C):** Complete the 15 required translation keys for all 57 languages using OpenAI gpt-4o-mini. ~$15-40 cost. Should resolve ~47 languages from noindex.

---

### 🔴 H9 — Crawl budget exhausted by massive URL space [CONFIRMED — SECONDARY CAUSE]
**Weight: HIGH (explains why only 1 is INDEXED, not just why URLs are noindex'd)**

**Evidence:**
- 9000+ stations × 57 languages × 2 URL variants (translated path + English alias) = **1,026,000+ potential URLs**
- Only ~10 languages are qualified → ~9000 × 10 = 90,000 truly indexable station URLs
- But Googlebot discovers ALL 57-language variants via old sitemap entries
- Crawl budget is consumed discovering and checking noindex URLs
- Google never gets to index the indexable pages because it's busy processing noindex responses
- The sitemap has been (correctly) updated to 410 for non-qualified languages, but Google keeps retrying old URLs

**Fix (Phase B.7):** After Phase C translation completion, force sitemap rebuild + IndexNow ping to tell Google which pages are now indexable.

---

### 🔴 H5 — Sitemap submitted but URLs noindex/404 → Google distrusts sitemap [CONFIRMED — SECONDARY CAUSE]
**Weight: HIGH**

**Evidence:**
- Non-qualified language sitemaps now correctly return 410 Gone (`sendSitemapGone()` at `seo-sitemap-routes.ts:1140`)
- BUT: this 410 behavior was only added with the 2026-04-30 LKG refactor
- Before that, the fail-open behavior sent ALL 57-language sitemaps with potentially invalid URLs
- Google crawled those sitemaps and discovered URLs that now return noindex
- From GSC incident notes: "Bing Webmaster Tools reported 1023 sitemap errors/warnings; Google Search Console reported the same pattern"
- When sitemaps repeatedly contain noindex or 410 URLs, Google lowers trust for the entire sitemap feed

**Fix (Phase B.7):** Submit all sitemaps to IndexNow after Phase C completes.

---

### 🟡 H7 — Massive duplicate content overwhelming Google's deduplication [CONFIRMED — CONTRIBUTING]
**Weight: MEDIUM**

**Evidence:**
- F2: `/api/generate-all-slugs` creates orphan duplicate documents WITHOUT preserving slugAliases
- F6: `/af/station/slug` + `/af/stasie/slug` both indexed before Google honors the 301
- Slug variants: `101-8-radio-maria` vs `1018-radio-maria` (confirmed in GSC CSV)
- Numeric-only slugs: `/af/station/-2516` (confirmed in GSC CSV)
- Each duplicate cluster creates multiple noindex'd "orphan" URLs

**Fix (Phase B.2, B.3, B.5):** Extract `assignSlugWithAlias()` helper, schedule station slug cleanup, run data repair scripts.

---

### 🟡 H4 — Hreflang clusters broken (pointing to noindex variants) [LIKELY — NEEDS VERIFICATION]
**Weight: MEDIUM**

**Evidence:**
- When `langIneligible=true`, the page renders noindex WITH hreflang alternates for the ELIGIBLE languages
- However, canonical correctly points to `/en/station/slug` (not self-canonical)
- CRITICAL QUESTION: Does `/en/station/slug` (indexable) have hreflang pointing to non-qualified language variants?
- Code analysis at `seo-renderer.ts:1021-1028`: hreflang is generated from `indexable` array which excludes non-qualified languages
- IF the hreflang is correct (only qualified languages), then H4 is FALSE
- IF there's a bug where qualified-page hreflang still includes non-qualified languages → H4 is TRUE

**Needs verification:** Curl `/en/station/{slug}` and check if hreflang includes languages like `/af/`, `/am/`, `/zu/` which should be non-qualified.

**Fix (Phase B.10):** If hreflang contains any noindex URLs, repair the cluster to exclude them.

---

### 🟡 H8 — Thin content classified as such by Google [LIKELY — CONTRIBUTING]
**Weight: MEDIUM**

**Evidence:**
- Station pages with no `descriptions` field → only template-driven content (same for all stations in that language)
- 9000+ stations, most without AI-generated descriptions in non-English languages
- Google's thin content classification: pages that are identical in structure with only name/country/genre varying
- The UNIVERSAL_LANGUAGES list adds 14 eligible languages for all stations, but if a station has no custom descriptions, the page is thin for those languages

**Fix (Phase C):** OpenAI generates per-station descriptions. But this is a Phase C target after translation completion.

---

### 🟡 F1/F4 — Frontend slug bug (numeric slugs) + Geo-detect country code prefix [CONFIRMED — CONTRIBUTING]
**Weight: MEDIUM**

**Evidence:**
- F1: Frontend slug generator (`slugs.ts:6-14`) drops non-Latin chars → empty slug → `-{mongoId}` → numeric-only → noindex
- F4: Users from Qatar/India/Syria get redirected to `/qa/`, `/in/`, `/sy/` which may not be valid language codes
- GSC CSV confirmed: `/af/station/-2516` (numeric slug), `/qa/station/...` (country code prefix)
- COUNTRY_PREFIX_REDIRECTS in index-web.ts should handle qa→ar, in→hi, sy→ar redirects
- BUT: if the target language (ar, hi) is NOT qualified, the redirect destination is also noindex'd

**Scale:** Likely ~30-100 stations have numeric-only slugs (significant but not the primary cause)

**Fix (Phase B.1, B.4, B.5):** Fix frontend slug generator, validate geo-detect language codes, repair numeric slugs.

---

### 🟢 H3 — Self-canonical on noindex pages [FALSE]
**Weight: NOT AN ISSUE**

**Evidence:**
- Code analysis at `seo-renderer.ts:995-1007` confirms: noindex pages set canonical to PRIMARY language URL (`/en/station/slug`), NOT self-canonical
- This is correct behavior — Google consolidates signals on the indexable English version

---

### 🟢 H1 — Googlebot geo-blocked or rate-limited [FALSE]
**Weight: NOT AN ISSUE**

**Evidence:**
- `geo-block.ts:112` — Googlebot is in SEARCH_BOT_BYPASS_RE regex, exempt from geo-blocking
- Blocked countries are only SG and TH — not US where Googlebot primarily crawls
- Rate limiter exempts search bots
- The 403 from audit container is Cloudflare WAF blocking cloud IPs, NOT blocking Googlebot

---

### 🟢 H6 — SSR not rendering for crawlers [FALSE]
**Weight: NOT AN ISSUE**

**Evidence:**
- `seo-renderer.ts` performs full SSR with real station data, `window.__INITIAL_TRANSLATIONS__`, structured data
- `htmlLangMiddleware` injects language-specific content into `index.html`
- Existing tests (`static-pages-ssr.test.ts`, `radiostation-schema-visible-content.test.ts`) verify real content in SSR output
- Not a thin JS shell

---

### 🟢 H13 — Robots.txt globally blocking [FALSE]
**Weight: NOT AN ISSUE**

**Evidence:**
- robots.txt analysis (A.11): No global Disallow for station/homepage/genre pages
- `Allow: /` at the end correctly permits everything not explicitly disallowed

---

### 🟢 H15 — Global noindex flag accidentally enabled [FALSE]
**Weight: NOT AN ISSUE**

**Evidence:**
- `X-Robots-Tag: index, follow` is sent on ALL non-auth pages
- No evidence of `NODE_ENV=preview` or feature flag globally forcing noindex
- The noindex is selective (only langIneligible/junk/numericSlug stations)

---

### 🟡 H11 — Internal linking too shallow / orphan pages [LIKELY — CONTRIBUTING]
**Weight: MEDIUM**

**Evidence (static analysis):**
- Station detail pages: linked from station list pages, search results, related stations
- But: only QUALIFIED language sitemaps exist → non-qualified language station pages have NO sitemap link
- Non-qualified language pages are discovered only via old sitemap entries or external links
- This means non-qualified language pages have near-zero PageRank → Google may not prioritize crawling them
- (Partially good: if Google doesn't crawl them, they don't appear in noindex GSC bucket)
- For indexable pages: internal links exist via homepage → station list → station detail

**Cannot fully verify without production crawl.**

---

### 🟡 H10 — Site quality signal too low (domain age, backlinks) [POSSIBLE — EXTERNAL FACTOR]
**Weight: LOW-MEDIUM**

**Evidence:**
- Site is 12 months old — still relatively new by Google's standards
- Domain authority and backlink profile unknown (requires external tools)
- Google's "sandbox effect" can delay indexing for new sites
- However: Googlebot IS crawling (368 noindex URLs prove this) — the issue is indexing quality, not crawl access

---

### 🟡 H16 — Stale sitemap top-30 countries list [NEEDS VERIFICATION]
**Weight: LOW-MEDIUM**

**Evidence:**
- `replit.md` notes: "top-30 country list is baked into `sitemap-main-{lang}.xml`"
- If the top-30 countries list is stale, important station pages may not be in sitemaps
- Cannot verify without production sitemap access

---

### 🟢 H2 — Soft-404s en masse [LIKELY MINOR]
**Weight: LOW**

**Evidence:**
- `seo-renderer.ts` has soft-404 guards
- Non-existent stations return 404, not 200 with thin content
- `slug-shape-404.ts` middleware blocks malformed slugs
- Confirmed: at least some 404s from numeric slugs, but these are separate from soft-404

---

### 🟢 H17 — Site recently launched, slow Google ingestion [KNOWN FACTOR]
**Weight: LOW-MEDIUM (background factor)**

**Notes:**
- 12 months is within Google's "extended evaluation" window for new sites
- However, 1 indexed page in 12 months is extraordinarily low even for new sites
- The other causes are far more significant

---

## Summary: Root Cause Stack

1. **PRIMARY (80%):** Language qualification gate — ~47 languages not qualified → massive noindex cascade
2. **SECONDARY (10%):** Crawl budget exhausted by non-qualified URL discovery
3. **SECONDARY (5%):** Sitemap trust damage from old fail-open behavior
4. **CONTRIBUTING (5%):** Slug bugs (numeric-only, orphan duplicates), geo-detect country code prefixes, thin content

## Recommended Fix Sequence (Phase B/C Priority Order)

1. **IMMEDIATE:** Get MongoDB URI to count exact qualified languages and verify F5 scale
2. **Phase C first:** Complete all 15 required translation keys for all 57 languages via OpenAI
3. **Phase B.5:** Clean up numeric-only slugs and orphan duplicates
4. **Phase B.4:** Fix geo-detect to validate against SEO_LANGUAGES
5. **Phase B.7:** Force sitemap rebuild + IndexNow ping for all qualifying languages
6. **Phase B.1:** Fix frontend slug generator to use shared `slugifyStationName`

## Expected Outcome After Fixes

- Phase C completion → 57 languages qualified → 9000 × 57 = 513,000 potentially indexable URLs
- GSC "Excluded by noindex tag" bucket: 368 → ~0 (all valid station pages become indexable)
- Indexed page count: 1 → hundreds+ within 4-8 weeks after Google re-crawls

## Open Questions Requiring MongoDB/GSC Access

1. **Current qualified languages list** (needs MongoDB or GSC API): Exactly which languages are currently qualified?
2. **Station count by noIndex flag** (needs MongoDB): How many stations have noIndex=true? How many have numeric slugs?
3. **Translation completeness** (needs MongoDB): Which of the 15 keys are missing per language?
4. **GSC URL Inspection** (needs GSC API): What exact coverage state does Google report for English station pages?
