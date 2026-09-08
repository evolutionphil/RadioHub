# Genres repair — 2026-09-08

## Reproduced production defects

- Austria's public genre list showed only Rock (27) and Jazz (3), despite Pop (34), Dance (7) and Classical (2) having indexed station memberships.
- Jazz's metadata used the editorial name `Jazz Music`. The stations endpoint filtered by that name instead of canonical slug `jazz`, returning an empty detail page.
- Responsive list limits were absent from the query cache key. URL pagination, browser back/forward and country/search changes could retain the wrong page.
- The detail heading hardcoded English `Stations`, and its directory breadcrumb dropped the active locale.

## Repair boundaries

- Separate public whitelisted navigation from homepage feature selection (`is_discoverable`). Preserve whitelist removals, cleanup demotions and homepage preferences.
- Read current counts from indexed PostgreSQL station/genre membership; use canonical slugs for station queries. Version affected cache keys so old empty results are not reused.
- Make pagination URL-driven, include country/page size in cache scope, cancel obsolete requests, reset page on filter changes and expose localized loading/error/retry/empty states.
- Supply localized labels for all 14 supported languages and preserve localized directory links. Existing card layout, player, advertising and premium behavior are unchanged.
- Register the already-existing `0027_station_source_genre_search.sql` in migration journal metadata; no new SQL migration or data rewrite.

The website-audit checklist guided navigation, empty-state and localization validation. Squirrelscan was unavailable; no scanner health score is claimed. This is a focused Genres repair, not a new site-wide SEO audit.

## Verification before deployment

- Frontend: 73 test files / 1,115 tests passed, including the new locale and pagination cases.
- Frontend and API TypeScript checks passed.
- Production API and web builds passed; runtime bundle/package audits found no MongoDB dependency.
- Native PostgreSQL public catalog tests: 18 passed, including non-featured Pop/Dance/Classical visibility, unchanged administrator flags, current counts and renamed Jazz membership.
- Broad PostgreSQL/genre suite: 543 tests, 541 passed, zero failed, two explicitly skipped real MongoDB initial-import/resume tests. A prior Node test-runner deserialization failure did not recur in the isolated SEO indexing run (9/9 passed) or the complete rerun at concurrency two.
- The broad suite also exposed the missing migration journal entry, now repaired and verified.

No production database records, credentials or administrator settings were edited. Live verification follows successful deployment of both API and web services; successful automated tests alone are not evidence of deployment.
