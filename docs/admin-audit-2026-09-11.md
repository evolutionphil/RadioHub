# Admin audit and repairs — 2026-09-11

## Scope and method

Audited the admin route inventory, shared layout/session behavior, request/response contracts, error/empty states, filters, drafts, job lifecycles and sensitive actions. Existing design and public playback/SEO behavior were preserved. The frontend-design guidance informed the scoped admin surface/layout corrections; the audit-website workflow was adapted to source and authenticated checks because `squirrel` is not installed. No fabricated crawler score is reported.

Authenticated read-only navigation covered 41 other admin paths, plus the already-open stations page. Route-shell/headings were recorded; several screens still had asynchronous sections loading at the initial observation, so this is not a claim that every external result or button was live-tested. No production user/key/billing/ad/content mutations, uploads, paid AI runs, Google submissions, stream probes, database cleanups or imports were used as test actions. Opening some views reads provider/storage status; existing UI preference synchronization can persist view preferences.

Detailed route-by-route source/contract matrices:

- [Content, languages and SEO tools](admin-audit-content-2026-09-11.md)
- [Operations, database, jobs and logs](admin-audit-operations-2026-09-11.md)
- [Accounts, payments, applications and advertising](admin-audit-accounts-2026-09-11.md)

## Shared and general-page repairs

| Area | Confirmed problem | Repair / verification |
| --- | --- | --- |
| Shared admin surfaces | Hex-valued CSS variables were passed into `hsl(var(...))`; live cards computed as transparent. | Body-scoped HSL-channel palette includes Radix portals and leaves public colors alone. Local browser confirms white/opaque cards and confirmation dialogs at desktop and 390px mobile, without horizontal overflow. |
| Theme lifecycle | Mounting admin permanently stripped dark mode; parent theme effect could reapply dark mode over a light admin shell. | Admin palette is explicitly light without overwriting saved public preference; cleanup restores effective preference. Theme regressions pass. |
| Navigation / header | Hidden off-canvas mobile links remained reachable; route matching used ambiguous prefixes; unrelated pages were labeled Station Management. | Closed mobile drawer is hidden/inert with visibility fallback; Escape closes it. Active route boundary and `aria-current` corrected. Header is Administration, toggle state labeled, missing sync DTO cannot crash it. |
| Admin account menu | Used the public identity response rather than the separate admin session; menu/sign-out could disappear. | Reads the same admin identity as route protection, supports username-only admin sessions, uses centralized confirmed logout/revocation and preserves session on failure. Broken avatar uses React fallback, not DOM rewriting. Live sign-out deliberately not executed. |
| `/admin/dashboard` | Failed stats defaulted to zero and missing health could display System Online. | Explicit unavailable/retry state and unknown health. No fabricated positive health. |
| `/admin/settings` | GET/PUT `/api/settings` and test-email/test-database APIs no longer exist. Editable defaults implied security, SMTP, database and performance changes that were never applied. | Replaced non-functional form with actual runtime status and links to working configuration screens. Infrastructure-managed values are clearly labeled as Railway configuration; no secrets are fetched or exposed. Existing operational settings remain in their real sections. |
| `/admin/home-settings` | Buttons nested inside navigation links. | Single accessible links styled as buttons; destinations unchanged. |
| `/admin/footer-social-media` | Cancel/edit drafts leaked into new records; selector could disagree with submitted platform; failed loads appeared empty; deletion had no confirmation; unsafe URLs/types reached storage. | Single controlled draft, reset/failed-save preservation, pending guards, captured target IDs, confirmation, accessible labels, responsive URLs. Server validates platform, absolute HTTP(S) destination without credentials, boolean and bounded integer position, preserving partial updates. SQL regression confirms rejected writes leave rows unchanged. |
| `/admin/analytics` | “All Events” sent `event=all` and returned no events; end date excluded the selected day; unknown events/invalid dates could crash; failed reads looked empty. | Inclusive local calendar-day boundaries, omitted all filter, safe fallback icon/time, independent error states and refresh of both datasets. Provider check failures are no longer labeled proof of broken playback. Catalogue summary and bounded 20/100 event sample are explicitly labeled. |

`/admin/stations`, `/admin/station-slugs` and `/admin/duplicates` were revisited without running merge or slug-generation actions. Their previous fixes remain; no catalogue merge was started by this audit. Dynamic country/run pages were source/fixture tested rather than creating production runs.

## Final local validation

- API full suite: **1,960 passed, 0 failed, 2 pre-existing skips** (1,962 tests). Disposable loopback PostgreSQL, per-suite isolated schemas; never production DB.
- Frontend full suite: **89 files, 1,284 tests passed**, 0 failed.
- API, frontend and database TypeScript checks passed; `git diff --check` clean.
- Production API/web/frontend builds passed. Build dependency boundary: **0 MongoDB dependencies**. Generated files were written only into the task's temporary build directory.
- Independent source review caught and corrected the admin-vs-public identity issue before release.
- A first parallel API test run hit a Node test-runner serialization error; the affected sitemap tests passed independently and the entire suite passed on rerun. A new stylesheet test initially used a jsdom URL object with Node fs; that test harness mismatch was corrected before the clean final run.

## Live rollout findings and follow-up

The initial `ff32c3ad` rollout reached Railway SUCCESS for API and WEB. Runtime settings reported PostgreSQL Online, the admin-only user menu rendered, footer forms reset/cancelled correctly and production cards were opaque. Anonymous protected routes remained 401; fonts, manifest, favicon, API and public health endpoints passed. The existing 14-language MANGORADIO smoke check passed: all 200, matching language/self-canonical, 14 alternates, parseable JSON-LD and no noindex. This is a representative regression check, not proof of indexing every station.

Live verification also caught two issues that small SQL fixtures did not reveal: the new operation/catalogue reads returned 503 against the production catalogue, and the pre-existing Cloudflare Web Vitals query returned GraphQL errors. A fresh, temporary admin diagnostic session was used with existing deployment credentials held only in process memory; it performed GET-only business reads and then closed its own session. No browser credentials were extracted or real accounts changed.

Follow-up removes full-catalogue historical source-JSON reads, retains a server-side SQL deadline and logs only fixed query phase/error code. Optional failures no longer blank the complete status page. The unsupported historical global SSL count is explicitly unmeasured rather than fabricated. Cloudflare's actual schema, units and hostname filtering are checked; genuine missing access/data must remain visible, not replaced by zero or invented percentiles. Final follow-up deployment verification is reported with the published commit in the task handoff.

## Remaining limits

- Live rollout and post-deployment checks must use the published commit; local test/build success alone is not deployment evidence.
- Existing logo jobs remain process-local and can report `lost` after restart. UI polling/recovery feedback is repaired; durable logo recovery is not claimed.
- Sales show recorded successful checkout receipts by currency, not full provider reconciliation. IAP validation events are not unique purchases. No live transaction was created.
- Translation management still loads its complete dataset once; repeated per-row scans were removed. Server pagination is not claimed.
- No claim that every external service, data variant or destructive workflow is flawless. Production writes were tested through mocks/isolated SQL, and existing Google/provider outcomes were not resubmitted or fabricated.
