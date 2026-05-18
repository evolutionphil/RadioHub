# A.3 — Noindex Decision Audit
Date: 2026-05-18

## All Noindex Emission Paths

For each path: condition → noindex source → canonical behavior → estimated impact

---

### Station Pages

All three station-page noindex conditions are evaluated in `artifacts/api-server/src/seo-renderer.ts` lines 959–1029, inside a single unified gate that calls `getIndexableLanguagesForStation(stationData, qualifiedLangs)` from `artifacts/api-server/src/seo/junk-station-rules.ts`.

#### Path 1: isJunk=true

**Condition:** `isJunkStation(stationData) === true` OR `stationData.noIndex === true`

`isJunkStation` delegates to `evaluateJunkStation`, which checks:
- Empty station name → `reason: 'empty-name'`
- No stream URL → `reason: 'empty-stream-url'`
- `lastCheckOk === false` AND `lastCheckOkTime` more than 30 days ago → `reason: 'stream-dead-30d'`
- `lastCheckOk === false`, no `lastCheckOkTime`, but `lastCheckTime` more than 30 days ago → `reason: 'stream-never-recovered-30d'`
- Slug ends with any of 16 codec/bitrate suffixes (`-mp3`, `-aac`, `-128`, `-320`, etc.) → `reason: 'codec-suffix:<suffix>'`
- Slug contains test-feed substrings (`dolby-atmos-test`, `test-stream`, `pink-noise`, etc.) → `reason: 'test-feed:<sub>'`
- Name matches song/program regex (`/\bremix\b/i`, `/\bphonk\b/i`, `/\bnon-stop music\b/i`, etc.) → `reason: 'song-or-program-name'`

`stationData.noIndex === true` is set by:
- `services/sync.ts` at import time for new stations that match `evaluateJunkStation`
- `services/sync.ts` on update when a previously-ok station newly matches
- `routes/station-public-routes.ts` and `routes/slug-routes.ts` during slug finalization
- Admin manual toggle via `routes/admin-station-routes.ts`
- `utils/clean-content-quality-urls.ts` maintenance script

**Noindex source:** `seoTags.robots = 'noindex, follow'` + `seoTags.noIndex = true` (meta tag in HTML)

**Canonical behavior:**
- `getIndexableLanguagesForStation` returns `[]` for junk stations
- `canonicalLang` falls through to `'en'` (no eligible language)
- Canonical is set to `https://<domain>/en/station/<slug>` but the page is simultaneously upgraded to **HTTP 410 Gone** by `index-web.ts` (line 927), which calls `send-junk-gone.ts`
- `seoTags.hreflangs = []` — all hreflang alternates suppressed

**Estimated impact:** Any station with a dead stream (30+ days), codec-variant slug, or test feed is fully removed from the index via 410. Canonical on a 410 is largely moot.

---

#### Path 2: langIneligible=true

**Condition:** `!isJunk && !isStationIndexableInLanguage(stationData, language, qualifiedLangs)`

`isStationIndexableInLanguage` is `true` when the requested `language` is in the intersection of:
- `getEligibleLanguages(station)`: the set of languages with an "appropriate audience match" for this station, built from:
  - The 14 `UNIVERSAL_LANGUAGES` (`en`, `es`, `fr`, `de`, `pt`, `it`, `ru`, `ar`, `zh`, `tr`, `ja`, `ko`, `hi`, `he`) — always included for every station
  - The station's country-of-origin primary language via `COUNTRY_TO_LANGUAGE[countryCode]`
  - Extra diaspora/community languages from `COUNTRY_EXTRA_LANGUAGES[countryCode]`
  - The station's broadcast `languageCodes` field (if codes are known SEO language codes)
  - Any language where the station has BOTH a non-empty `descriptions[lang].full` AND `descriptions[lang].meta`

- `qualifiedLangs` from `getCachedQualifiedLanguages()`: the subset of all 57 `SEO_LANGUAGES` whose UI translations pass `hasCompleteSeoTranslations` (i.e., every key in `REQUIRED_STATION_SEO_KEYS` + `REQUIRED_HOMEPAGE_SEO_KEYS` is present and non-empty in the MongoDB `Translation` collection for that language).

**Noindex source:** `seoTags.robots = 'noindex, follow'` + `seoTags.noIndex = true`

**Canonical behavior (the key behavior — NOT self-canonical):**
```
canonicalLang = indexable.includes('en') ? 'en' : indexable[0] || 'en'
seoTags.canonical = `${domain}/${canonicalLang}/${urlTranslations.get(`${canonicalLang}:station`) || 'station'}/${stationData.slug}`
```
- The canonical points at an **indexable language variant** of the same station — not at the noindex page itself
- The `indexable` array used for canonical is the **same** array fed to `generateLanguageUrls` for hreflang (architect gate invariant: they can never diverge)
- `'en'` is preferred as the canonical target because it is always in `UNIVERSAL_LANGUAGES` and always qualifies as eligible (though it still must pass the qualified-languages gate to appear in hreflang)

**Hreflang behavior on noindex langIneligible pages:**
- `generateLanguageUrls` is called with the `indexable` array (eligible ∩ qualified), NOT all 57 languages
- So the noindex language variant still emits hreflang alternates pointing to the indexable languages
- The indexable language variants point back via their own hreflang sets — they include only the indexable set, not the noindex languages

**Does the indexable language page include the noindex language in its hreflang?**
No. `generateLanguageUrls` filters to `indexable`, which excludes languages that are not in `getIndexableLanguagesForStation(station, qualifiedLangs)`. Since `langIneligible` means the requested language is NOT in `indexable`, it will not appear in the hreflang alternates of the canonical page either. This is correct behavior per Google policy (a noindex URL should not appear as an alternate).

**Estimated impact:** A station from Turkey (`countryCode: 'tr'`) has `UNIVERSAL_LANGUAGES` (14) + Turkish primary (`tr`) + `COUNTRY_EXTRA_LANGUAGES['tr']` = `['de']` → eligible set of ~16 languages. The remaining ~41 languages will be langIneligible → noindex for that station. If the qualified set contains 20 languages, then 57 − 16 = 41 get noindex, but only 57 − 20 = 37 are excluded from the sitemap entirely.

---

#### Path 3: numericOnlySlug=true

**Condition:** `!isJunk && isNumericOnlySlug(stationData.slug)` — slug matches `/^-?\d+$/`

**Noindex source:** `seoTags.robots = 'noindex, follow'` + `seoTags.noIndex = true`

**Canonical behavior:** Same as langIneligible — canonical points to the indexable main-language variant

**Distinction from isJunk:** The page is NOT upgraded to 410. The station itself may be legitimate (a numeric callsign brand); only this URL variant is noindexed. Hreflang alternates are still emitted for the indexable set.

**Estimated impact:** Low. Numeric-only slugs are edge cases from the old slug generator producing bare collision IDs.

---

### Auth / Admin Pages (middleware injection)

**Source:** `artifacts/api-server/src/index-web.ts` lines 40–46, 214–218

**Condition:** `AUTH_NOINDEX_PATH` regex matches the request path:
```
/^(?:\/[a-z]{2})?\/(?:auth(?:\/.*)?|login|signup|sign-in|sign-up|register|forgot-password|reset-password|change-password)(?:\/|$)/i
```
Covers auth variants with or without a `/<lang>/` prefix.

**Noindex source:** `X-Robots-Tag: noindex, follow` HTTP response header only. No `<meta name="robots">` tag is set by the renderer for these paths.

**Canonical behavior:** No canonical is set by the middleware. These pages are SPA-rendered; the renderer does not generate canonical tags for auth paths.

**Admin 404 fallback:** `index-web.ts` line 493–497 serves a static 404 HTML page with `<meta name="robots" content="noindex, nofollow">` + `X-Robots-Tag: noindex, nofollow` for unmatched admin routes.

---

### Genre Pages

**Source:** `artifacts/api-server/src/seo-renderer.ts` lines 1043–1075

Two sub-conditions both resolve to `seoTags.robots = 'noindex, follow'`:

1. **genreNotWhitelisted:** The genre slug is not on the curated whitelist in `src/seo/genre-whitelist.ts`. Raw tag-noise genres (frequencies, city names, station brand fragments) are excluded.
2. **tooThin:** The genre IS on the whitelist but has fewer than `MIN_STATIONS_FOR_GENRE_INDEX` indexable popular stations (threshold defined in seo-renderer.ts). A sparse grid page is the same low-quality signal as a missing whitelist entry.

**Special case — hard 404 promotion:** If `genreNotWhitelisted && popularStations.length === 0`, the response is upgraded to 404 (not just noindex-200) via `additionalData.notFound = true`. Whitelisted-but-thin genres stay at noindex-200 because real users may still type the URL.

**Canonical behavior:** No explicit canonical redirect — the page stays at its URL with noindex. `seoTags.hreflangs = []` (all 57 alternates suppressed for noindex genre pages).

---

### Search Pages

**Source:** `artifacts/api-server/src/seo-renderer.ts` lines 1394–1408

**Condition:** `pageType === 'search'` — all `/search` paths regardless of query.

**Noindex source:** `baseSeoTags.robots = 'noindex, follow'` (no `noIndex = true` flag, so `X-Robots-Tag` mirror is not set by the SSR pipeline — only the meta tag is present)

**Canonical behavior:** No special canonical; normal self-canonical.

**Rationale:** Standard Google guidance to noindex search result pages. Content is query-dependent and not linkable.

---

### Utility Pages

**Source:** `artifacts/api-server/src/seo-renderer.ts` lines 697–713, 1330–1342

**Condition:** `pageType === 'utility'` — paths: `/feedback`, `/llms`, `/notifications`, `/profile` (with optional `/<lang>/` prefix)

**Noindex source:** `baseSeoTags.robots = 'noindex, follow'` + `baseSeoTags.noIndex = true`

**Canonical behavior:** No explicit canonical. Standard utility page treatment.

---

### Slug-Shape 404 Pages

**Source:** `artifacts/api-server/src/middleware/slug-shape-404.ts` lines 323–339

**Condition:** Request path has an invalid slug shape (checked by the middleware before the SSR renderer runs).

**Noindex source:** `X-Robots-Tag: noindex, follow` HTTP header on the 404 response. The SPA shell HTML is served as the 404 body (or a minimal text body if no build exists).

---

### API-Only Server Routes

**Source:** `artifacts/api-server/src/index-api.ts` line 286

**Condition:** Any request that reaches the API-only server's catch-all route.

**Noindex source:** `X-Robots-Tag: noindex, nofollow` — note `nofollow` (not `follow`), since API responses should not pass link equity.

---

## Critical Finding: Canonical on Noindex Pages

### For langIneligible and numericOnlySlug

**Exact canonical behavior (lines 995–1006 of seo-renderer.ts):**
```typescript
const canonicalLang = indexable.includes('en')
  ? 'en'
  : indexable[0] || 'en';

const translatedSegment =
  urlTranslations?.get(`${canonicalLang}:station`) || 'station';
seoTags.canonical = `${domain}/${canonicalLang}/${translatedSegment}/${stationData.slug}`;
```

This is **NOT self-canonical** — it is the correct behavior. The noindex page explicitly delegates canonical authority to the indexable English (or first eligible) variant.

### Gate Invariant

The `indexable` array used for canonical selection and the `indexable` array passed to `generateLanguageUrls` are the **same object** (computed once at line 976). This ensures:
- Canonical always points to a language that is actually in the hreflang alternate set
- No divergence between what the sitemap advertises and what the canonical/hreflang on the page itself advertises

### Hreflang on Noindex Pages

For `langIneligible` pages, hreflang IS emitted (pointing to the indexable set). This is technically debated but follows the pattern Google recommends when you have many language variants of a page — the noindex variant still tells crawlers where the authoritative alternatives are.

For `isJunk` pages, `seoTags.hreflangs = []` — no hreflang alternates are emitted, consistent with Google policy that a gone/junk page should not advertise alternatives.

---

## Estimated Scale

The scale depends on the live qualified-languages set and the station corpus. Based on the code:

- **Total SEO_LANGUAGES:** 57
- **UNIVERSAL_LANGUAGES (always eligible):** 14 (`en`, `es`, `fr`, `de`, `pt`, `it`, `ru`, `ar`, `zh`, `tr`, `ja`, `ko`, `hi`, `he`)
- **Average eligible set per station:** ~14–20 languages (14 universal + country language + diaspora languages; stations with AI-generated descriptions in all 14 languages will cap at 14 unless country extras expand it)
- **langIneligible noindex pages per station:** 57 − ~16 = **~41 noindex pages per non-junk station** (before the qualified-languages gate trims it further)
- **Additional filter (qualified-languages gate):** Only languages passing `hasCompleteSeoTranslations` are in the indexable set. If, say, 20 languages are currently qualified, then a Turkish station's indexable set is the intersection of ~16 eligible and ~20 qualified = ~15 languages → **42 noindex language variants per Turkish station**

For a corpus of ~50,000 non-junk stations, this implies approximately **2,000,000–2,100,000 total noindex station-language pages** in the index horizon, compared to roughly **750,000–1,000,000 indexable station-language pages** (50,000 stations × ~15–20 indexable languages each).

The noindex pages are intentionally served rather than 404'd because the station itself is valid — they consolidate signals on the canonical variant rather than disappearing entirely from crawlers that discover them via old links.
