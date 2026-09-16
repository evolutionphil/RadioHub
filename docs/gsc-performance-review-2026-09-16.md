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

References: [Google page indexing report](https://support.google.com/webmasters/answer/7440203?hl=en), [localized versions](https://developers.google.com/search/docs/specialty/international/localized-versions).
