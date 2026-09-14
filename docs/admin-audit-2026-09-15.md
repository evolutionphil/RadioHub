# Admin reliability audit — 2026-09-15

## Scope and evidence

Authenticated production navigation checked all 41 top-level admin screens (dashboard, catalog, content, account/commerce, operations, and SEO). Each rendered its registered screen rather than a missing-route or fatal-error page. Separately, 38 read-only JSON endpoints returned HTTP 200. Rendering and read checks do not imply every destructive or paid action was executed in production.

Production records were not deleted, mass-regenerated, or charged for this audit. Write contracts were exercised with mocks and isolated disposable PostgreSQL schemas. No database schema migration or new service/variable is required.

## Fixed

- Unified custom requests with the configured API origin and authenticated session/Bearer fallback, including uploads and CSV exports. Tokens are not automatically forwarded to unrelated origins.
- Dashboard partial failures have explicit recovery; unknown/failed health is no longer displayed as healthy. Added refresh, last-check/cache information and links to existing attention queues.
- Searchable admin navigation, accessible mobile close/focus/Escape behavior, and single keyboard targets for dashboard links. Existing visual language preserved.
- Translation editor no longer calls nonexistent read/save endpoints. Existing values populate correctly; failed saves retain drafts; language/key changes remain isolated; failed bulk translations are not counted as success.
- Translation counts use a compact summary instead of downloading all 48,472 translation rows (11,748,750 response characters in the baseline). Selected-language and selected-key requests load only required text. The original unfiltered API remains compatible. Text IDs and multi-part locale codes remain supported.
- Feedback now has real server pagination/totals, response-only saves and reopen actions; API-key and IAP pagination recover after totals shrink.
- User exports, advertising uploads, genre uploads and catalog actions use authenticated transport. Advertisement deletion requires confirmation and clears stale edit state.
- Genre edits preserve existing posters; saves wait for uploads; closed-dialog late uploads cannot replace another form. Catalog/logo failures expose retry instead of false empty data.
- Station-slug generation tracks every progress update and existing jobs after navigation. Stopped/failed jobs have accurate state, and the action is correctly labelled as generating missing slugs.
- Database maintenance controls cannot overlap or run before status is known. Translation-language deletions describe their effect and require confirmation.
- Post-deploy keyboard testing exposed a Radix Select 2.2.6 delayed-focus race when typeahead was immediately followed by closing the menu. Backported the upstream null-ref guard using pnpm's reproducible patch mechanism (ESM and CJS); no selection behavior or design changes. All four Docker builds copy the patch before dependency installation. Upstream reference: [Radix Select source](https://github.com/radix-ui/primitives/blob/main/packages/react/select/src/select.tsx).

## Validation

- Final frontend regression suite: 100 files / 1,402 tests passed, including desktop-resize focus release, single-target dashboard links and two actual Select behavior tests (queued focus after unmount and normal typeahead/Enter selection). The unmount test reproduced the production error before patching and passed afterward.
- Backend feedback and localization tests: 15 passed, zero skipped, including real isolated PostgreSQL pagination/filter contracts. Additional locale/text-ID validation regression passed afterward.
- Frontend and API TypeScript checks passed.
- Production frontend build passed (203 outputs; verification build did not write artifacts).
- `git diff --check` passed.
- Frozen offline dependency installation passed with development dependencies retained and no version upgrades; ESM and CJS both contain the null-safe guard. Patch line endings are fixed to LF so Windows/Linux checkouts retain the same lockfile hash.

## Limits and rollout

Deploy frontend and API together: the compact translation summary is a new additive API contract. An older API is detected as unavailable rather than silently displaying incorrect completion counts.

Existing failed sync/backfill/error records remain visible for diagnosis; this audit does not erase history or claim all past operations succeeded. Live payment, destructive cleanup, mass merging and paid translation jobs were deliberately not triggered merely to test their buttons.

First production rollout (`05691b296`) succeeded for API and web. All 40 post-release read checks passed, including the new key/language/summary filters. Summary payload: 50,104 characters / 879 rows / 173 ms; German values: 145,291 characters / 879 rows / 161 ms; one key: 58 rows, all matching the requested key. Desktop search and refresh worked; existing modal translations populated; mobile search/navigation closed correctly with a 390 px viewport and no page overflow. A separate follow-up release includes the observed delayed-focus fix.
