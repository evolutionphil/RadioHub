# Admin accounts, payments and advertisements audit — 2026-09-11

Scope: local code/route-contract review and isolated tests. Existing design and payment/ad policies retained. No production user edits, key changes, subscription grants/cancellations, purchases, messages, ad configuration changes or uploads were performed.

## Route coverage and fixes

| Screen | Contract inspected | Findings and disposition |
| --- | --- | --- |
| Users | `GET/PATCH/DELETE /api/admin/users`, subscription override routes, CSV export | Name/email save now sends only those fields instead of replaying stale account status/avatar data; valid email/name required. Pending writes lock competing profile/subscription actions and dialog dismissal. Invalid legacy expiry no longer crashes Edit. Pagination recovers after last-row deletion. Column drag listeners/global cursor are cleaned on navigation. Stripe/Paddle filter values added; CSV now carries and applies the same platform filter as the list. |
| Developer API | `/api/admin/api-keys/{stats,users,keys}`, key status/plan mutations | Read failures now show errors instead of empty tables/zero statistics. Mutation failures are visible; pending actions cannot overlap. Success invalidates all key filters, developer aggregates and usage stats. Revoke confirmation identifies the key prefix. No full key copied or generated. |
| Paddle plans | `/api/admin/stripe-plans`, `verify-paddle-price`, plan PUT | Late verification cannot modify a different price/edit session; cancelled drafts reset. Verification requests abort on change/cancel/unmount. Save uses an immutable submitted snapshot, includes verified zero prices, and locks edits while pending. Failed initial reads do not expose editable fabricated defaults. |
| Stripe plans | Same saved plan store, `verify-price`, plan PUT | Same stale-response/cancel/load-error protections. Amount/currency from an old verification cannot overwrite a new price. Zero prices render correctly; invalid amounts/currency cannot be saved. |
| TV/app version | `GET/PUT /api/admin/tv-version`, public manifest | Failed reads no longer expose an empty configuration that could overwrite saved data. Dirty drafts survive query updates; explicit discard, pending locks and accessible field names added. All existing locale maps retained. Server rejects malformed maps, version values and unsafe store links. A post-commit cache failure is not reported as a failed database save; public cache may retain prior data up to five minutes. |
| Feedback | `/api/admin/feedback`, per-record PATCH/DELETE | GET now checks HTTP status. Draft responses reset between records and dialogs close consistently after saves; pending edits cannot move to another record. Invalid legacy dates display a fallback. Delete requires confirmation. No responses were sent. |
| Sales analytics | `/api/admin/sales`, `pgSalesAnalytics` | Date selection includes the complete final day in UTC; invalid/inverted ranges are rejected. Read failures are not represented as zero revenue. Stripe/Paddle successful recorded payment receipts are distinguished from ignored/refund/lifecycle deliveries. Historical migrated Stripe sale receipts remain included. Monetary totals are separated by currency; mixed-currency scalar sums become null rather than a fictitious conversion. UI identifies the limits of the report. |
| IAP events | `/api/admin/iap-events`, `/stats` | From/to now use one inclusive UTC convention, including final milliseconds. Invalid ranges cannot be applied; failed summaries no longer appear to load forever or show invented zero counts. Refresh updates list and stats. |
| Advertisements | `/api/admin/advertisements`, upload and per-ad PATCH/DELETE | Existing create/edit/upload cancellation/error protections rechecked. Pending saves now disable all form fields, preventing edits from being silently discarded by the completing save. Ad positions, density, activation rules and delivery policies unchanged. |

Server plan validation now rejects malformed booleans, negative/non-integral amounts, invalid price-ID formats and invalid currency formats. Valid partial updates and explicitly clearing price IDs remain supported. Provider verification/checkout semantics were not changed.

## Verification

- Frontend: `admin-account-pages.test.tsx` 17 passed; existing `admin-advertisements.test.tsx` 8 passed — **25 passed**. Covers failed reads, late price verification, cancel/reset, zero prices, dirty version drafts, cross-record feedback, key cache invalidation/locking, inclusive dates, user save payloads and drag cleanup.
- Backend: `admin-account-settings.test.ts` 2 passed; `postgres-admin-account-settings.integration.test.ts` 4 passed — **6 passed**, including real PostgreSQL writes in a random disposable schema and local HTTP authorization/validation checks.
- Regression: `postgres-billing.integration.test.ts` 16 passed and `postgres-content-integration.test.ts` 8 passed — **24 passed**. Added CSV/list platform parity and footer-social HTTP validation/partial-update checks for the root agent's social-link fix.
- Frontend typecheck passed. At the last combined run, API typecheck reported only concurrent work in `admin-operations-status-routes.ts`; root notified for final whole-repository validation.

## Limitations and live verification

- The revenue panel reports stored checkout receipts, not complete provider accounting. Stripe invoice lifecycle events currently omit `amountMinor`; IAP success rows count validations, not unique purchases. Fees, refunds, currency conversion and provider reconciliation are explicitly not inferred. Financial reconciliation requires a separate read-only provider-ledger audit.
- Live billing verification with real prices, checkout, cancellations, grants, user deletion, key revocation, feedback sending and advertisement uploads were deliberately not executed. These actions affect real people or configuration; isolated mocks/PostgreSQL fixtures exercise their UI/HTTP contracts.
- `useAdminViewPrefs` may migrate an existing nondefault local filter preference to the admin-preferences endpoint on first page load, then persist deliberate filter changes. It does not alter users. Billing route registration seeds absent default plan rows at server boot; reading the page does not create prices or charge accounts.
- Root agent owns live-browser screenshots, responsive/layout inspection, final all-suite runs, commit and deployment. This report does not assert production deployment or complete provider reconciliation.
