# A.7 — Translation Coverage Audit
Date: 2026-05-18

---

## Language Eligibility Gate (the root cause of langIneligible noindex)

### Two separate gates — do not confuse them

There are two distinct language-filtering layers in the codebase. They operate on different objects and answer different questions.

**Gate 1 — Per-station eligibility (`getEligibleLanguages` in `lib/seo-shared/src/seo-config.ts` via `junk-station-rules.ts`)**

Asks: "Does this *station* have a genuine audience for this language?"

A language is eligible for a station if ANY of the following is true:
1. The language is in `UNIVERSAL_LANGUAGES` — 14 languages always eligible for every station: `en`, `es`, `fr`, `de`, `pt`, `it`, `ru`, `ar`, `zh`, `tr`, `ja`, `ko`, `hi`, `he`
2. The language is the primary language of the station's `countryCode` via `COUNTRY_TO_LANGUAGE` map
3. The language is in `COUNTRY_EXTRA_LANGUAGES[countryCode]` (diaspora/community languages for that country)
4. The language code is present in the station's `languageCodes` field (broadcast language ISO codes)
5. The station has a non-empty `descriptions[lang].full` AND `descriptions[lang].meta` for that language (AI-generated content present)

**Gate 2 — UI translation qualification (`hasCompleteSeoTranslations` in `lib/seo-shared/src/seo-config.ts`)**

Asks: "Does the *site UI* have complete enough translations in this language to render a non-thin page?"

A language qualifies for the sitemap/indexing when its entry in the MongoDB `Translation` collection contains all 15 keys in `REQUIRED_STATION_SEO_KEYS` + `REQUIRED_HOMEPAGE_SEO_KEYS`:

**REQUIRED_STATION_SEO_KEYS (7 keys):**
- `default_station_about` — base description template
- `from` — location context word
- `genres` — "Genres" heading
- `station_additional_info` — closing CTA
- `live_radio` — "live radio"
- `online_radio` — "online radio"
- `radio_streaming` — "radio streaming"

**REQUIRED_HOMEPAGE_SEO_KEYS (8 keys):**
- `hero_worlds_best_radio` — H1 / page title
- `hero_over_100_countries` — hero subline
- `hero_listen_everywhere` — secondary hero line
- `nav_genres` — navigation: genres
- `nav_regions` — navigation: regions
- `nav_stations` — navigation: all stations
- `popular_genres_title` — section heading
- `popular_countries_title` — section heading

If ANY of these 15 keys is absent or empty for a language in the `Translation` MongoDB collection, `hasCompleteSeoTranslations` returns `false` and the language is excluded from the qualified set.

### What `getQualifiedLanguagesState` returns

`artifacts/api-server/src/seo/qualified-languages.ts` computes the qualified set by:

1. Iterating all 57 `ACTIVE_SITEMAP_LANGUAGES`
2. For each language, loading its translation map from `performanceCache` (in-memory) or from MongoDB `Translation` collection as a fallback (up to 4 concurrent queries)
3. Calling `hasCompleteSeoTranslations(translationMap)` — returns `true` only if all 15 required keys are present and non-empty
4. Returning the subset of languages that pass this check

The result is:
- Cached in-memory for 60 minutes
- Persisted to MongoDB as a Last-Known-Good (LKG) document with a 30-day TTL
- Protected against "shrink events" (if live compute returns < 50% of LKG count, the LKG is served instead — guards against cold-cache false negatives)
- Protected against thundering herd via singleflight deduplication

**What this means for station indexability:**
`isStationIndexableInLanguage(station, language, qualifiedLangs)` returns `true` only when BOTH:
- `language` is in `getEligibleLanguages(station)` (Gate 1)
- `language` is in `qualifiedLangs` (Gate 2)

A language that passes Gate 1 but not Gate 2 will still trigger `langIneligible=true` in the SSR renderer, causing `noindex, follow` + canonical redirect to the English variant.

### Threshold that makes a language ineligible

**Gate 1 threshold:** The language must have a genuine audience connection to the station. A language that is neither universal, nor the station's country language, nor in the diaspora map, nor in `languageCodes`, nor has AI-generated descriptions will be ineligible regardless of DB translation completeness.

**Gate 2 threshold:** Every one of the 15 required keys must exist in the `Translation` collection for that language with a non-empty value. There is no partial credit — a single missing key disqualifies the entire language.

---

## Coverage Table

All 57 `SEO_LANGUAGES` with coverage status across every static template registry. "DB-backed" means the content comes from the MongoDB `Translation` collection at runtime (not a static file), so coverage depends on what has been entered in the admin panel.

| # | Code | Language | Genre | Search | Legal | Static | Region | URL-Trans | Cnt-Names | Community | Qualified (DB) |
|---|------|----------|-------|--------|-------|--------|--------|-----------|-----------|-----------|----------------|
| 1 | en | English | ✓ | ✓ | ✓ | ✓ | ✓ | — (default) | — | ✓ | Expected ✓ |
| 2 | tr | Türkçe | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ missing | ✓ | Expected ✓ |
| 3 | es | Español | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Expected ✓ |
| 4 | fr | Français | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Expected ✓ |
| 5 | de | Deutsch | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Expected ✓ |
| 6 | ar | العربية | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Expected ✓ |
| 7 | it | Italiano | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Expected ✓ |
| 8 | pt | Português | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Expected ✓ |
| 9 | nl | Nederlands | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | DB-dependent |
| 10 | ru | Русский | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Expected ✓ |
| 11 | pl | Polski | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | DB-dependent |
| 12 | sv | Svenska | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | DB-dependent |
| 13 | da | Dansk | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ missing | DB-dependent |
| 14 | no | Norsk | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ missing | DB-dependent |
| 15 | fi | Suomi | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ missing | DB-dependent |
| 16 | el | Ελληνικά | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | DB-dependent |
| 17 | hu | Magyar | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | DB-dependent |
| 18 | cs | Čeština | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | DB-dependent |
| 19 | sk | Slovenčina | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ missing | DB-dependent |
| 20 | ro | Română | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | DB-dependent |
| 21 | bg | Български | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ missing | DB-dependent |
| 22 | hr | Hrvatski | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ missing | DB-dependent |
| 23 | sr | Српски | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ missing | DB-dependent |
| 24 | sl | Slovenščina | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ missing | DB-dependent |
| 25 | lv | Latviešu | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ missing | DB-dependent |
| 26 | lt | Lietuvių | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ missing | DB-dependent |
| 27 | et | Eesti | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ missing | DB-dependent |
| 28 | zh | 中文 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Expected ✓ |
| 29 | ja | 日本語 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Expected ✓ |
| 30 | ko | 한국어 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Expected ✓ |
| 31 | hi | हिन्दी | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Expected ✓ |
| 32 | th | ไทย | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | DB-dependent |
| 33 | vi | Tiếng Việt | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | DB-dependent |
| 34 | id | Bahasa Indonesia | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | DB-dependent |
| 35 | ms | Bahasa Melayu | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ missing | DB-dependent |
| 36 | tl | Filipino | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ missing | DB-dependent |
| 37 | he | עברית | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Expected ✓ |
| 38 | fa | فارسی | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ missing | DB-dependent |
| 39 | ur | اردو | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ missing | DB-dependent |
| 40 | bn | বাংলা | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ missing | DB-dependent |
| 41 | ta | தமிழ் | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ missing | DB-dependent |
| 42 | te | తెలుగు | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ missing | DB-dependent |
| 43 | mr | मराठी | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ missing | DB-dependent |
| 44 | gu | ગુજરાતી | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ missing | DB-dependent |
| 45 | kn | ಕನ್ನಡ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ missing | DB-dependent |
| 46 | ml | മലയാളം | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ missing | DB-dependent |
| 47 | pa | ਪੰਜਾਬੀ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ missing | DB-dependent |
| 48 | sw | Kiswahili | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ missing | DB-dependent |
| 49 | am | አማርኛ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ missing | DB-dependent |
| 50 | zu | isiZulu | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ missing | DB-dependent |
| 51 | af | Afrikaans | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ missing | DB-dependent |
| 52 | sq | Shqip | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ missing | DB-dependent |
| 53 | az | Azərbaycan | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ missing | DB-dependent |
| 54 | hy | Հայերեն | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ missing | DB-dependent |
| 55 | so | Soomaali | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ missing | DB-dependent |
| 56 | uk | Українська | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | DB-dependent |
| 57 | bs | Bosanski | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ missing | DB-dependent |

**Legend:**
- ✓ — entry present in static file
- ✗ missing — no entry in static file for this language
- — — not applicable (en has no URL prefix; en/tr have no country name translation map since the DB-backed renderer uses English country names as keys and falls back to the canonical English name)
- Expected ✓ — almost certainly qualified given they are in UNIVERSAL_LANGUAGES and the project has clearly invested heavily in them
- DB-dependent — qualification depends entirely on whether the 15 required keys are present in the MongoDB `Translation` collection for this language

**Note on `faq-schema.ts`:** This file does not contain a per-language static map. It defines `FAQ_PAGE_ITEMS` as an array of `{ qKey, aKey, qFallback, aFallback }` structs that reference MongoDB translation keys at runtime. FAQ coverage therefore follows the same DB-backed qualification gate as the rest of the translation system.

---

## Which Languages Are Likely Qualified vs Ineligible?

### Likely always qualified (14 UNIVERSAL_LANGUAGES — also heavily invested in the codebase)

These languages appear in `UNIVERSAL_LANGUAGES` and represent the languages explicitly called out as having AI-generated station descriptions. They will pass Gate 1 for every station regardless of country, and they are the languages the project has most deeply invested in.

`en`, `es`, `fr`, `de`, `pt`, `it`, `ru`, `ar`, `zh`, `tr`, `ja`, `ko`, `hi`, `he`

For these to be qualified (Gate 2), the 15 required DB translation keys must be present. Given the codebase history and admin investment, it is highly likely all 14 pass Gate 2 in production.

### Languages that are eligible for a subset of stations (Gate 1 conditional)

These 43 languages are NOT in UNIVERSAL_LANGUAGES. They are only eligible for stations where:
- The station's `countryCode` maps to them via `COUNTRY_TO_LANGUAGE` or `COUNTRY_EXTRA_LANGUAGES`, OR
- The station has explicit AI-generated descriptions for them, OR
- The station's `languageCodes` field lists them

They will be `langIneligible` (noindex) for the majority of stations even if Gate 2 is satisfied.

**Languages that appear in community-page-seo-templates (25 languages) — likely have reasonable DB coverage:**
`nl`, `pl`, `sv`, `el`, `hu`, `cs`, `ro`, `uk`, `th`, `vi`, `id`

**Languages NOT in community-page-seo-templates (32 languages) — DB coverage uncertain:**
`da`, `no`, `fi`, `sk`, `bg`, `hr`, `sr`, `sl`, `lv`, `lt`, `et`, `ms`, `tl`, `fa`, `ur`, `bn`, `ta`, `te`, `mr`, `gu`, `kn`, `ml`, `pa`, `sw`, `am`, `zu`, `af`, `sq`, `az`, `hy`, `so`, `bs`

These 32 languages are the most likely to trigger `langIneligible=true` for the majority of stations because:
1. They are not in UNIVERSAL_LANGUAGES (Gate 1 fails for most stations)
2. They may lack complete DB translations (Gate 2 may also fail)

### Practical scenarios

**A US station (countryCode: 'us'):**
- Eligible: 14 universal + `en` (already in universal) + `es` (COUNTRY_EXTRA_LANGUAGES['us']) = ~14 unique languages
- langIneligible for: remaining 43 languages → ~43 noindex variants per US station

**A German station (countryCode: 'de'):**
- Eligible: 14 universal + `de` (already in universal) + `tr` (COUNTRY_EXTRA_LANGUAGES['de'], already in universal) = ~14 unique languages
- langIneligible for: remaining 43 languages

**An Indian station (countryCode: 'in') with all AI descriptions:**
- Eligible: 14 universal + `hi` (already universal) + `ta`, `te`, `bn`, `mr`, `gu`, `ur` (COUNTRY_EXTRA_LANGUAGES['in']) = ~19 unique languages
- langIneligible for: remaining ~38 languages

**A station with AI descriptions for all 14 UNIVERSAL_LANGUAGES:**
- Eligible for exactly the 14 universal languages (unless country extras or broadcast codes add more)
- langIneligible for: 43 languages

---

## Key Missing Registries

### community-page-seo-templates.ts — 25/57 languages (32 missing)

This is the only static template registry with incomplete coverage across all 57 languages. Missing 32 languages:

`da`, `no`, `fi`, `sk`, `bg`, `hr`, `sr`, `sl`, `lv`, `lt`, `et`, `ms`, `tl`, `fa`, `ur`, `bn`, `ta`, `te`, `mr`, `gu`, `kn`, `ml`, `pa`, `sw`, `am`, `zu`, `af`, `sq`, `az`, `hy`, `so`, `bs`

**Impact:** The community/social pages (`/users`, `/recommendations`, `/stations` listing) will render with English community-page titles and descriptions for these 32 languages. However, since these page types do not trigger the `qualified-languages` gate and are not station pages, this does not directly cause `langIneligible` noindex events. The risk is duplicate-meta audit errors in GSC/Bing if these pages are indexed at all — but since they have no station noindex gate, they would show English copy under non-English paths.

### country-name-translations.ts — 55/57 languages (missing `en` and `tr`)

**`en` missing:** Expected — English is the canonical key language in the data structure. `getLocalizedCountryName(canonicalName, 'en')` falls back to `canonicalName` itself (the English canonical form), so no content gap.

**`tr` missing:** Turkish country names are not present in the static file. When `getLocalizedCountryName(canonicalName, 'tr')` is called for the Turkish-language station page or region page, it falls back to the English canonical name. This means Turkish region/country pages display English country names (e.g., "Germany" instead of "Almanya", "Turkey" instead of "Türkiye"). This is a real UX and thin-content risk for Turkish-language country/region pages, which are among the highest-traffic non-English pages in the platform given `tr` is the second language (position 2 in SEO_LANGUAGES).

### url-translations.ts — 56/57 languages (missing `en`)

**`en` missing:** Expected and correct. English is the default path with no prefix (`/station/` not `/en/station/`). The URL translations map provides localized path segments for all other 56 languages. No gap.

---

## Summary of Static File Coverage

| Registry | Entries | Missing from 57 | Notes |
|----------|---------|-----------------|-------|
| genre-seo-templates | 57/57 | none | Complete |
| search-seo-templates | 57/57 | none | Complete |
| legal-seo-templates | 57/57 | none | Complete |
| static-page-seo-templates | 57/57 | none | Complete |
| region-seo-templates | 57/57 | none | Complete |
| url-translations | 56/57 | `en` (expected) | Complete |
| country-name-translations | 55/57 | `en` (expected), `tr` (gap) | `tr` gap affects Turkish region pages |
| community-page-seo-templates | 25/57 | 32 languages | Largest coverage gap in static files |
| faq-schema | N/A | N/A | Uses DB translation keys, not static per-lang map |

The qualified-languages gate (`hasCompleteSeoTranslations`) operates on the MongoDB `Translation` collection, not these static files. Static file coverage determines the quality of server-rendered page content; DB translation coverage determines which languages enter the sitemap and avoid the `langIneligible` noindex trigger.
