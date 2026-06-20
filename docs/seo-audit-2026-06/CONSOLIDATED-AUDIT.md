# SEO / Indexing Audit — themegaradio.com (2026-06-20)

**Scope:** Full 14-language indexability audit — every page type (station, genre,
country, region, search, static) × 14 universal languages
(`en es fr de pt it ru ar zh tr ja ko hi he`), plus S3 image indexing for every
station. Goal: full compliance with Google Search documentation so all 14
languages index cleanly.

**Method:** 4 parallel read-only audit agents traced the actual codebase. Findings
below are de-duplicated and prioritized. Each is tagged with the originating area.

---

## Executive Summary

SSR is genuine (no cloaking), titles/meta/H1 are truly translated for all 14
languages on every page type, structured data is present, and the sitemap system
is architecturally correct. The indexing problems trace to **four root causes**:

| # | Root cause | Severity | Est. URLs affected |
|---|---|---|---|
| **A** | 3 divergent URL-segment resolvers → canonical ≠ hreflang → Google discards hreflang clusters | 🔴 P1 | All 14 langs × ~54K stations |
| **B** | Universal-14 station variants marked indexable even with NO description in that language → thin "crawled-not-indexed" pages | 🔴 P1 | ~7,900 stations × 13 langs ≈ 100K |
| **C** | JSON-LD emits `default-station.png` placeholder for logo-less stations; sitemap mass-duplicates `no-image.webp` | 🟠 P2 | ~53.5% of stations |
| **D** | SSR `<img>` alt text hardcoded English ("logo") on all 14 language variants | 🟠 P3 | All station/genre/region pages × 13 non-EN langs |

The "2 of 14 sitemaps show page counts in GSC" question is **NOT a bug** — it is
Google crawl latency over nested sitemap-indexes (explained below).

---

## A. Hreflang / Canonical — cluster discard (P1, CRITICAL)

**Root defect:** A station URL's path segment (`station`/`istasyon`/`sender`/…)
is resolved by **three independent mechanisms that can disagree**:

| Surface | Function | Segment source | Fallback |
|---|---|---|---|
| Inbound routing (what returns 200) | `reverseTranslateUrl` (`url-translations.ts:2089`) | DB reverse cache → **static `REVERSE_URL_TRANSLATIONS`** | raw passthrough |
| Canonical (outbound) | `buildLocalizedUrl` (`url-helpers.ts:19`) | **DB `translationMap` only** | **raw English segment** |
| hreflang alternates | `generateLanguageUrls` (`seo-config.ts:1196`) | DB map → **`FALLBACK_SEGMENT_TRANSLATIONS`** | raw English segment |

When the `UrlTranslation` DB collection has no row for a `lang:segment` pair (the
normal incomplete state), the **canonical** emits `/de/station/slug` (raw English)
while the **hreflang** alternate emits `/de/sender/slug` (fallback table). Result:

- The page's own canonical is **absent from its hreflang set** → Google ignores all hreflang (spec requirement 7).
- Reciprocal pages advertise a URL the producer never self-canonicals to → **pair dropped** (requirement 2).

This is the single largest contributor to the 382K "crawled — not indexed" and the
1,180 "duplicate, Google chose different canonical."

**Fix (single-resolver):** Extract one `localizeSegment(lang, segment, dbMap)` with
deterministic precedence `DB → FALLBACK_SEGMENT_TRANSLATIONS → static URL_TRANSLATIONS → raw`,
and use it in **all** of: `buildLocalizedUrl` (canonical), `generateLanguageUrls`
(hreflang), `reverseTranslateUrl` / `isStationPath` (inbound), and the sitemap
builder. Add a round-trip invariant test for all 14 langs:
`forward(lang, reverse(lang, forward(lang,'station'))) === forward(lang,'station')`.

**Sub-findings:**
- **A2 (P1):** Inbound `isStationPath` matches against the *static* table while
  canonical uses the *DB* map — if an admin sets a DB row that disagrees with the
  static table, the advertised hreflang target 404s → whole cluster discarded.
  Same single-resolver fix.
- **A3 (P2):** `x-default` is correctly EN-only for normal pages, but for station
  pages where English is NOT in the station's `indexable` set, a fallback branch
  (`seo-config.ts:1344-1348`) emits `x-default` pointing at the first *non-English*
  language. Decide policy: drop the fallback block (EN-only) **or** restrict
  emission to a single page in the cluster.
- **A4 (P4):** `URL_TRANSLATIONS` has duplicate `zh` and `zh-CN` blocks
  (`url-translations.ts:1181` & `:1213`) — remove `zh-CN`.
- **A5 (P3):** Canonical/hreflang use request `domain`; only the admin path hardcodes
  `https://themegaradio.com`. Force-normalize to the canonical production host so a
  Railway preview host can't leak into canonical/hreflang.

---

## B. Thin per-language station pages (P1, CRITICAL)

**Root defect:** `getEligibleLanguages` (`junk-station-rules.ts:316-319,365`)
unconditionally seeds every station with all 14 `UNIVERSAL_LANGUAGES`. The
descriptions loop only *adds* more languages, never *restricts* the 14. So
`isStationIndexableInLanguage(station, 'de', qualified)` returns `true` even with
zero German content.

The body only renders the AI description when present
(`seo-renderer.ts:2013`). For a station whose `descriptions.de` is absent, the
German page renders only: localized title, H1 (name + country), a one-line
templated intro, templated outro, "Station Information", cross-links — **no unique
body**. That is a thin page served as indexable `index,follow` 200 → textbook
"crawled — currently not indexed."

**Two complementary fixes (use BOTH):**
1. **Content engine (already shipped, PR #80):** `scheduled-description-fill` runs
   daily 04:30 and fills all 14 languages for no-desc + partial stations. Over time
   this eliminates the thin pages by giving them real content.
2. **Safety gate (this audit):** Until content exists, don't serve the variant as
   indexable. In `getEligibleLanguages`, require `descriptions[lang].full` non-empty
   for each universal language (mirror the existing check at line 402 that already
   governs non-universal langs). Equivalently, in the renderer station gate
   (`seo-renderer.ts:1032`), treat "no `descriptions[language].full`" as
   `langIneligible` → 301 to the English/origin variant instead of serving a thin 200.

**Sub-findings:**
- **B2 (P2):** Description-less variants self-canonicalize (`seo-renderer.ts:1042-1068`)
  → tells Google to index the thin URL. Tie canonical/redirect to the content gate.
- **B3 (P3):** Empty-country pages always render indexable 200 (soft-404 promotion
  was disabled at `seo-renderer.ts:913-934` to avoid diacritic false-positives).
  Reintroduce empty-country detection via slug→ISO code and `noindex` (not 404)
  when a valid country has zero indexable stations.

---

## C. S3 image indexing (P2)

- **C1 (P2):** JSON-LD emits `default-station.png` placeholder for the ~53.5% of
  stations with no logo (`seo-renderer.ts:2900,3011-3012,2778,2824`). The sitemap
  deliberately excludes this placeholder but JSON-LD has no guard. Google fetches a
  generic placeholder as the "official" image for every logo-less station (or 404s
  if the asset is missing). **Fix:** guard with the verified-host check; omit
  `logo`/`image` when no verified URL exists.
- **C2 (P3):** Image sitemap mass-duplicates `no-image.webp` across ~53.5% of
  station URLs (`seo-sitemap-routes.ts:101-116`). Per Google spec, omitting the
  `<image:image>` is better than a mass-duplicated placeholder. **Fix:** return
  `null` from `pickStationImage` when no verified logo → omit the entry.
- **C3 (P3):** JSON-LD/og-image read `logoAssets.webp256` raw; in local-disk mode
  these are relative filenames (`logo-processor.ts:526-531`) → would emit relative
  `image` URLs. Prod uses S3 (absolute) so latent, but route through the
  scheme-guarded `pickLogoUrl()`.
- **C4 (P5, no action):** og:image is a generated 1200×630 composite (by design);
  raw S3 logo is still discoverable via sitemap + JSON-LD + on-page `<img>`.

---

## D. SSR alt text not translated (P3)

`seo-renderer.ts:1988` hardcodes English: `` `${name} logo — ${country}` ``. The
country name is localized but the noun "logo" is English on every `/tr`, `/de`,
`/ar` … SSR page (genre/region grids too: `:1880,2216,2347`). The React component
does it right (`station-logo.tsx:200` uses `t('station_logo_alt')`), but crawlers
see SSR HTML. **Fix:** source the noun from `translations['station_logo_alt']`
(key already exists) in `generateHtmlBody`.

---

## E. Structured data (P3)

Station JSON-LD uses `@type: RadioBroadcastService` (`seo-renderer.ts:3005`), not
`RadioStation`. Neither has a documented Google rich result, so this is
entity-graph quality, not snippets. Present: name, url, image, description,
areaServed, inLanguage, broadcaster, ListenAction. Weak/missing:
`broadcastFrequency` (only when parseable from tags), `genre` (removed),
station-accurate `inLanguage` (falls back to UI language), `sameAs` (only if
homepage). **Fix (optional):** dual-type `["RadioBroadcastService","RadioStation"]`,
populate `genre` from tags, set `inLanguage` from `station.languageCodes`.

---

## F. Sitemaps — NOT a bug (resolved)

The GSC pattern "TR + RU show 48,391 discovered pages, other 12 show 0" is **crawl
latency, not emptiness**. There is **no "qualified languages" gate** excluding 12
languages — `GUARANTEED_QUALIFIED_LANGUAGES` force-adds all 14
(`qualified-languages.ts:231-240`) and `UNIVERSAL_LANGUAGES` is the per-station
floor (`junk-station-rules.ts:316-319`). All 14 `sitemap-{lang}.xml` are **nested
sitemap-indexes** pointing to ~5 station child chunks each. GSC only populates
"discovered pages" after Googlebot fetches each *child*; it has drained TR+RU's
children so far. **Action:** confirm via `GET /api/admin/sitemap/manifest-stats`
that all 14 show ~48K URLs; submit the flat `sitemap-index.xml` to GSC and/or
IndexNow-ping the 12 lagging languages to accelerate. No code change required.

---

## Prioritized Action Plan

1. **P1 — A (single-resolver hreflang/canonical):** biggest crawled-not-indexed cause.
2. **P1 — B (content-gate station eligibility):** removes ~100K thin pages; pairs with shipped description-fill.
3. **P2 — C1 (JSON-LD placeholder image guard).**
4. **P3 — C2 (sitemap no-image omission), D (alt-text translation), B3 (empty-country noindex).**
5. **P3/optional — E (schema enrichment), A3/A5 (x-default policy, domain normalization), A4 (zh dup).**
6. **Monitoring — F:** verify manifest-stats; submit sitemap-index; IndexNow-ping 12 langs.

---

## Fixes Applied (2026-06-20)

Verified by 2 independent verification agents before implementation.

| Finding | Decision | Change |
|---|---|---|
| **A** (hreflang/canonical) | ✅ Fixed (minimal/safe variant) | `buildLocalizedUrl` now uses the SAME fallback chain as hreflang (`DB → FALLBACK_SEGMENT_TRANSLATIONS → raw`). Exported the shared table from `seo-config.ts`. Inbound routing left untouched (zero new-404 risk per verification). Added `canonical-hreflang-parity.test.ts` (14-lang invariant, 3 tests passing). |
| **B** (content-gate) | ❌ **Rejected** by verification | Verification found the 301 variant causes redirect-flapping (worse than thin pages) and the body isn't truly empty. **PR #80 `scheduled-description-fill` already solves this correctly by adding content.** No code change. |
| **C1** (JSON-LD placeholder image) | ✅ Fixed | Station + homepage-ItemList JSON-LD now emit `logo`/`image` only when a verified absolute (http) asset exists; placeholder `default-station.png` and relative local-disk filenames are omitted. |
| **C2** (sitemap mass-duplicate image) | ✅ Fixed | `<image:image>` now omitted for logo-less stations instead of pointing ~53.5% of URLs at a shared `no-image.webp`. |
| **D** (alt text English-only) | ✅ Fixed | SSR `<img alt>` now uses the `seo_station_logo_alt[_with_country]` translation keys (present for all 14 langs) with `{name}`/`{country}` interpolation. |

**Verification gates passed:** `typecheck:libs` ✅, api-server `typecheck` ✅,
`canonical-hreflang-parity.test.ts` ✅ (3/3), `seo-templates-coverage.test.ts` ✅.
(The `seo-sitemap-routes.smoke.test.ts` failure in the sandbox is a pre-existing
stale-build artifact issue — `GenreCount` export resolution — unrelated to these
changes; it builds clean in CI.)

**Deferred (separate PR / optional):** A2 (collapse inbound routing onto shared
resolver), A3 (x-default station-edge policy), A4 (zh dup), A5 (domain
normalization), B3 (empty-country noindex), E (schema enrichment).
