# Production performance and GSC review — 16 September 2026

## Measured baseline

User-supplied PageSpeed report: https://pagespeed.web.dev/analysis/https-themegaradio-com/sy09ucvpm9

| Test | Performance | FCP | LCP | TBT | CLS | SEO |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Mobile, root → /en | 68 | 3.298 s | 5.863 s | 30 ms | 0 | 100 |
| Desktop, root → /en | 96 | 0.641 s | 1.219 s | 68 ms | 0.003 | 100 |

Scores vary between runs; these are lab results, not field Core Web Vitals or an indexing guarantee.

## Verified fixes

- Express removed the mounted `/api/image` and `/api/stream` prefixes before forwarding to the stream service. Restore the original URL using the existing tested forwarding wrapper. Five healthy remote logos previously returned 404 through the web origin. Real upstream errors remain real errors.
- Subset the existing Ubuntu fonts by disjoint Unicode ranges. Three Latin startup files total 103,196 bytes, down from 310,904 bytes (66.8%). Preserve all 1,194 original Unicode characters, outlines, advances, hints and vertical metrics. Other scripts load on demand; original files remain available. SPA and server-rendered preloads use the new files.
- Footer uses the existing small, identical logo for standard-density rendering while retaining the larger responsive source.
- Repair only two catalog-verified old spellings: `kpissfm-2` resolves through persisted alias `kpiss-fm-2`; `flashbassfm-1` through `flashbass-fm-1`. Exact identities win, real database canonical targets and language are preserved, and junk/indexing gates remain enforced. Do not generalize suffix stripping.
- Add an explicit indexing setting to the existing admin station editor. Untouched settings are never submitted; deliberate changes are tracked through the existing backend manual-edit mechanism. This enables reviewed record repairs without blanket policy overrides.

## Search Console evidence

Report date shown by Google: 14 September. Indexed 5; excluded 247,341.

| Category | Report count | Findings/action |
| --- | ---: | --- |
| Server error (5xx) | 50 | Every listed URL checked: 43 final 200, 7 final 410, no 5xx, loops or timeouts. Validation started; UI confirmed 16 September 2026. |
| Not found | 646 | 18 failed-validation examples inspected. Two verified legacy spelling repairs above. Other examples mix existing records carrying old `noIndex`, merged identities and gone URLs; do not blindly restore or redirect all to home. |
| Excluded by noindex | 416 | Nine failed examples resolve to four existing station records with 14 descriptions and old `noIndex:true`. Duplicate/provenance review is required before changing stored policy. |
| Crawled, currently not indexed | 50,906 | Five sampled localized station URLs return 200, indexable robots, self-canonical and 14 language alternates. This sample does not establish corpus-wide health or Google's indexing choice. |
| Soft 404 / redirect / different canonical | 299 / 33 / 207 | Validation already in progress; not restarted. |

The noindex examples concern `radio-blacklight`, `radio-kosava-info`, `panepistimio-kritis-96-7` (also `967-1` aliases), and `radio-10-chernivtsi-ukraine`. Rich content alone does not prove these old exclusions are wrong: older duplicate cleanup also used unowned noindex flags. Preserve legitimate duplicate/manual exclusions.

## Verification before publication

- Frontend: 1,737 tests across 122 files passed; TypeScript passed.
- Production Vite build passed with `write:false` (200 chunks, 7 assets). Existing sourcemap-location warnings remain non-fatal.
- Backend: 80 integrated proxy/alias/SSR regression tests passed; backend TypeScript passed during alias verification.
- Font generator and independent font regression checks verify original language coverage and rendering metrics.

## Remaining verification

Confirm deployment and repeat public media, font, alias and PageSpeed checks. Resubmit only genuinely resolved GSC groups. Google validation and indexing are asynchronous; legitimate removed pages need not become indexable to make an exclusion report green.

## Follow-up findings and repairs

- Commit `650be1232` was pushed to main and deployed. New font URLs serve real WOFF2; four sampled Wikimedia/VRT logos now return 200 image/webp through the web origin. The WordPress-hosted RMC source is still rejected by the stream service URL guard, and some other upstream URLs are genuinely unavailable; no security guard or real error was hidden.
- Four existing station identities listed above were individually reviewed in the full admin catalogue (not merely visibility-filtered search). The Greek station's presumed numeric sibling is absent, and archived slug migration recorded only a rename. Indexing was explicitly allowed through the admin editor, preserving stream health and content. API reads confirm `noIndex:false` and manual ownership. All 56 localized pages return 200 without noindex; percent-encoded and Unicode canonical paths are equivalent.
- All 416 noindex report URLs were subsequently checked at concurrency two: 405 final 200, 11 final 410, no 5xx/timeouts. Nineteen URLs still carried noindex, mapping to nine other records; see the adjacent machine-readable audit. These require separate identity/content review, including a deliberate color-bar test and actual duplicate channels. This is not a completed whole-category validation.
- Fresh PageSpeed `/en` result after the first deployment: mobile 73 (FCP 3.270 s, LCP 4.801 s, TBT 19 ms, CLS 0), desktop 99 (FCP 0.641 s, LCP 0.761 s, TBT 32 ms, CLS 0); SEO 100 on both. The earlier test began at `/`, so the redirect differs and these are not a controlled apples-to-apples improvement estimate.
- Cold/warm origin sampling then isolated a larger problem: `/en` took about 5.3 seconds cold versus 134 ms immediately warm; an independent cold sample reached the 10-second SSR deadline and returned 503. Home SSR was counting genres by decompressing per-station JSON/tag data, unlike the browser API's native `station_genres` path. Home SSR now shares that native, whitelist-filtered, 60-second health-aware read. No visibility TTL was extended, no design removed, and optional taxonomy failure retains the existing localized fallback.
- Three exact duplicate identities now have a guarded, reversible migration plus valid-target alias handling. No records, favorites, ratings or aliases are deleted/merged. See `docs/audits/2026-09-16-verified-duplicate-redirects.md` for guards and rollback.
- Second batch verification: 140 integrated backend tests and TypeScript passed; actual SQL and rollback passed 37 isolated PostgreSQL/PGlite tests. Cross-replica advisory locking uses the established migration runner; the isolated single-connection tests do not claim to test contention.

References: [Google page indexing report](https://support.google.com/webmasters/answer/7440203?hl=en), [localized versions](https://developers.google.com/search/docs/specialty/international/localized-versions).

## Follow-up: full noindex export and reviewed production repairs

The full 416-URL noindex export was subsequently checked over public HTTP with
bounded concurrency: 405 final 200 and 11 legitimate/unresolved gone 410, no
5xx. Nineteen URLs still carried noindex and mapped to nine station slugs.
Restoration was not based solely on the presence of generated descriptions:
the public catalog and authenticated admin search were reviewed for duplicate
brand, call-sign, country and stream identities.

The following seven real primary records were deliberately saved through the
existing admin editor with `noIndex=false`. The main agent verified the exact
IDs, `manualEditFields.noIndex=true` ownership, and 14-language descriptions in
the public API after saving. This is an editorial indexing decision; their
stream-health/list-visibility controls are independent and were not overridden.

| Station | Preserved ID | Review/repair |
| --- | --- | --- |
| Radio Wey | `6a0791c7bef34beb9148d249` | Real hospital/community station. Its official stream is UK-only; a foreign probe failure is not evidence that its information page should be excluded. |
| KSOR 90.1 Jefferson Public Radio | `68a8c478bd66579311ab17f5` | Corrected both stream URL fields to the official Classics & News URL `https://stream.zeno.fm/e0czcdic3wiuv`, replacing the outdated wrong-service `/jpr-news` address. |
| RADYO FENOMEN 2010 LAR | `68a8c495bd66579311ab5da5` | Selected the non-bitrate primary; excluded bitrate variants were not restored or merged. |
| Jalisco Radio Ciudad Guzmán / XHCGJ-FM | `6a07917abef34beb9148c3cf` | Distinct Ciudad Guzmán identity/feed, not the other Guadalajara/general Jalisco feeds. |
| Echoes.gr NetRadio – Thessaloniki | `68a8c46cbd66579311aaf834` | Selected this primary; admin confirmed other Echoes variants remain noindex. |
| Principe Joinville | `68a8c485bd66579311ab3548` | Reviewed real station identity; no competing same-station result found. |
| WNOB 93.7 BOB FM Chesapeake | `68a8c4a3bd66579311ab806f` | Reviewed call-sign/city identity and official broadcaster. |

KSOR's [official stream list](https://www.ijpr.org/stream-urls-media-players)
publishes the replacement URL. A bounded check returned 200 `audio/mpeg` with
`icy-name: JPR Classics_News`; the signed CDN redirect was not persisted.
Radio Wey's [official listening instructions](https://radiowey.org/listen/listen-live/)
explicitly describe the UK restriction.

Two important exclusions were deliberately preserved:

- `cai-tiao-ce-shi-1` (`68a8c4a9bd66579311ab91d1`) is a color-bar test listing,
  not a verified radio information page. Generic junk heuristics did not catch
  it and generated translations alone would falsely qualify it. Keep noindex.
- Belgian `radio-eurodance-classic` (`68a8c48bbd66579311ab4546`) is a historical
  duplicate of an already indexable Canadian record. Its noindex and malformed
  old source stream remain unchanged. Separate immutable migration 0033 provides
  only an audited redirect to the verified existing target; see
  [the exact scope and rollback](audits/2026-09-16-eurodance-duplicate-redirect.md).

Migration 0033 and its documented rollback passed **41/41 isolated PostgreSQL
(PGlite) tests**: exact identity/ownership guards, third-listing preservation,
idempotence, transaction rollback, and compare-and-set refusal after a later
edit. The related localized SSR regression suite passed **142 tests**. These
are pre-publication checks, not a claim that 0033 has already run in production.

The main agent's later GSC **All submitted pages** view showed noindex count
**0**. That scoped result does not mean all previously known excluded URLs must
be restored. In the same scope, 194,343 discovered-not-indexed and 1,222
crawled-not-indexed URLs remained; these are Google's asynchronous indexing
decisions, not proof of a failed request. Two Google-chosen-canonical examples
were still undergoing individual review at this checkpoint.
