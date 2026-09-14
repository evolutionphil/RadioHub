# SEO administration repair — 2026-09-15

Scope: GSC URL Inspection and the existing SEO administration screens. The public site's design and playback behavior are unchanged.

## Production findings

- The configured Google OAuth connection successfully inspected one URL (1 attempted, 1 succeeded, 0 failed); no authorization error was reported. This is an inspection, not a guarantee or request of indexing.
- Twenty-four of twenty-five read-only SEO endpoint checks returned HTTP 200. The cold server-indexability report first hit an upstream 502; a subsequent complete report took 25.1 seconds.
- Server-indexability filtering ran after pagination. As a result, filtered pages and their advertised totals could disagree.
- Background maintenance acknowledgements were displayed as completed work, and some failures looked like empty data or endless loading.
- The preview left Twitter card type blank and counted `x-default` as an additional language.

## Repairs

- Complete indexability reporting uses a bounded, single-flight catalog scan and a five-minute cache. Cold HTTP requests return a pending response after one second; the UI polls for the complete result. Exception keys, rather than every station URL/body, are retained.
- GSC filters now apply before SQL count and pagination. Unknown Google states are represented explicitly; completed background batches refresh the displayed rows and totals.
- OAuth callback refreshes connection state; same-tab authorization avoids asynchronous popup blocking. Duplicate manual inspection batches are rejected while one is running.
- SEO screen requests use the configured API destination and existing authentication helpers. Coverage, maintenance and import errors have recoverable states.
- Maintenance controls distinguish queued, running, successful and failed work. Unknown status blocks conflicting operations. Copy no longer claims that IndexNow submits to Google or that changing timestamps guarantees crawling.
- SEO translation regeneration requests one incomplete language at a time, preserves completed writes, refreshes coverage after partial failures and displays AI usage costs. Model requests have a bounded timeout and no automatic retry amplification.
- SEMrush CSV import correctly handles quoted multiline fields, BOM, escaped quotes and regional delimiters. Malformed/oversized imports are rejected before replacing stored issues.
- SEO preview displays the actual Twitter card default and separates language alternates from `x-default`.

## Verification

- Frontend regression suite: 1,364 tests across 96 files passed. TypeScript checks passed for frontend and API; the production frontend build passed (203 output chunks/assets, checked without writing build artifacts).
- Focused backend tests: 24 GSC/PostgreSQL tests and 5 CSV-import tests passed. They cover real PostgreSQL indexability totals/filtering, background report readiness, cache reuse and CSV import safety.
- Production checks use read-only requests, apart from creating/closing a diagnostic login session and a single Google URL inspection. No paid AI batch, data deletion, bulk timestamp rewrite or mass resubmission was triggered.
- GitHub push and post-deployment verification are reported separately; this document does not claim deployment merely because local tests passed.

## Operational notes

A report may display “calculating” on its first read; partial counts are never presented as final. Google inspection history updates on actual completed inspections. Neither a valid sitemap nor a successful submission ensures indexing.

Keep sitemap `lastmod` tied to significant real content changes, per [Google's sitemap documentation](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap). IndexNow participating engines are listed in the [official engine registry](https://www.indexnow.org/searchengines.json); it is not Google's URL Inspection service.
