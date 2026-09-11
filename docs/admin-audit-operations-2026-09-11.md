# Admin operations audit — 2026-09-11

Scope: assigned 13 operational screens, their request/response contracts, startup effects, error/empty states, filters, pagination and job polling. Source inspection plus isolated PostgreSQL and browser-component regressions; no production writes, stream tests, imports, cleanup, AI jobs or restarts were triggered. The website-audit checklist was adapted to authenticated source/API inspection rather than crawling mutation-capable admin screens. Live browser tour and deployment are coordinated by the parent task.

## Checked route matrix

| Route | Result / fixes | Opening the screen |
| --- | --- | --- |
| `/admin/sync` | Start/stop use authenticated API transport. Status/log errors render retry instead of false idle/empty. Existing periodic read queries retained. | GET status/logs only; synchronization requires button. |
| `/admin/radio-browser` | Four nonexistent endpoints replaced by bounded native catalogue GET. Search preserves explicit false flags and submitted filters; literal text/bitrate/HTTPS supported. Play now invokes the existing player instead of merely recording a click. Corrected misleading live-provider labels. | Reads local trending sample plus provider statistics; no import/probe. Other provider tabs are on-demand. |
| `/admin/status-monitoring` | Replaced public first-page sample as totals with exact catalogue aggregates and bounded recent/problem/trend samples. Local health vs provider flags distinguished. Corrected performance and sync DTO fields; unavailable measurements shown as unmeasured, not fabricated zero. Malformed check dates no longer throw. | Read-only database snapshot, cached/coalesced 60 seconds; SQL statement timeout 2 seconds. |
| `/admin/codecs` | Auth-aware/cancellable fetch; explicit failure and retry. Count/filter/empty rendering checked. | Facet GET only. |
| `/admin/cities` | Reject failed/malformed responses; don't render failed merge as success or preserve actionable stale analysis. Explicit confirmation before merge. Success result no longer erased by delayed analysis timer. | No request or mutation until Analyze is clicked. |
| `/admin/performance` | Correct nested `{success,job}` contract; single-flight abortable polling with terminal/error stop. Start errors visible; late response cannot start polling after unmount. Corrected unsupported action. Full/cleanup operation requires explicit deletion warning. Removed Google-recrawl guarantee from cache text. | Metrics and stored Web Vitals GET; maintenance only on explicit buttons. |
| `/admin/logos` | Finished/cancelled jobs cannot be reattached by cached active-job data. Timers bound to job ID and cleaned up. Stop on polling errors/terminal states; cancellation failures visible. Auth-aware read requests. | Stats/active-job/failure GET; storage-health performs a sample storage reachability GET periodically. No processing/retry job auto-started. |
| `/admin/db-management` | Removed fictitious MongoDB 512MB quota; PostgreSQL table/estimated-row labels. Native table names mapped to existing allow-listed cleanup aliases. Native sync/blacklist counts in flush preview. Clear preserves schema; explicit cleanup confirmations and mutation error feedback added. | PostgreSQL size report only. Flush/cleanup/clear never run on mount. |
| `/admin/coverage` | Per-job reads single-flight, aborted on unmount, guarded by job ID and stopped on errors. Fixed completion timer cleanup that stranded results. Reconstruction/backfill errors stop endless polling and provide retry. Main fetch failures no longer look like zero coverage/no alerts. | Coverage/trends/alerts/status reads. History drawers lazy-load. All jobs, webhook tests and settings writes require user action. |
| `/admin/coverage/:countryCode` | Country/range query isolation and URL encoding checked. Explicit failed-load retry added, rather than missing-country/empty graph ambiguity. | GET coverage/trends only. |
| `/admin/coverage/compare` | Comparison selection/presets/trend contracts reviewed; explicit coverage/trend errors with retry. Dashed reconstructed-history rendering preserved. | GET coverage/trends/shared presets. Preset writes require button. |
| `/admin/app-logs` | Auth/cancellation support, refresh includes crash summary. Added missing server-backed pagination, reset on filter changes. Page-only counters and capped crash sample labeled accurately. Non-CarPlay filter no longer mislabeled iPhone-only. | Bounded log/crash reads. |
| `/admin/error-logs` | Auth/cancellation support, explicit failed-load message. Page counters labeled as page-only; navigation back remains available if retention shrinks a previously valid page. | Paginated read only; filter changes reset page. |

## Regression evidence

- `artifacts/api-server/tests/admin-operations-status.test.ts`: **5/5 passed**, actual isolated PostgreSQL schema on loopback55437. Tests admin protection, thin payload, source-false/local-positive separation, expired exclusion, accurate totals, literal wildcard search, quality/HTTPS/limits, 60-second snapshot cache and absence of legacy source/document SQL reads.
- `artifacts/megaradio/tests/admin-operations.test.tsx`: **12/12 passed**. Tests non-overlap/abort/error-stop polling, paused vs terminal logo states, city failure/success/confirmation, real optimization response, catalogue health totals, native DB actions, stale completed-logo reattachment, log pagination/filter reset and partial dashboard availability when one endpoint fails.
- Existing `admin-coverage-compare-dashed.test.tsx`: **3/3 passed**. Existing fixture emits missing-default-query-function warnings; assertions pass and production supplies that default.
- Frontend and API TypeScript checks passed after final server-side statement-timeout tightening. Existing `admin-log-pages.test.tsx` also **4/4 passed** alongside the 11 new frontend regressions.

## Limits / follow-up evidence

- Production follow-up: both new operational endpoints returned HTTP 503, while performance and sync reads succeeded. Removed legacy `source` JSON reads from all status aggregates, filters and sample projections; only small native columns are queried now. Historical SSL data is explicitly **Not measured**, not zero. Server-side 2-second statement deadlines remain, with sanitized query-phase/PostgreSQL-code diagnostics. Independent working dashboard sections remain visible if another section fails. Native and frontend regressions plus both TypeScript checks passed. Live SQL timing could not be measured because the authorized Postgres environment has only a private connection URL and no public TCP endpoint; no infrastructure change or production database mutation was performed. Production verification of this follow-up remains with the parent rollout.

- No production mutation was exercised. Destructive/expensive controls were inspected and mocked, not actually executed.
- Existing logo jobs are process-local and can report `lost` after restart. This pass fixes the UI lifecycle and reports that state honestly; it does not claim durable logo-job recovery.
- Provider statistics/storage reachability depend on external services and can fail independently; no availability guarantee was inferred.
- 60-second operational snapshot is deliberately bounded/stale; narrow samples are labeled and are not a complete station export. No claim of exhaustive every-data-variant testing or measured production latency is made.
- Public design, 14-language SEO, imports and stream-health scheduler policy were not changed by this pass.
