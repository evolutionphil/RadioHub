# Admin Web Vitals follow-up — 2026-09-11

## Verified cause

The deployed panel called Cloudflare with nonexistent abbreviated quantile fields and invalid grouping fields. Authenticated, read-only schema introspection confirmed `largestContentfulPaintP50/P75/P95`, `interactionToNextPaintP50/P75/P95`, and `cumulativeLayoutShiftP50/P75/P95`. LCP/INP are microseconds; negative values mean unavailable. Discovery follows [Cloudflare's schema introspection documentation](https://developers.cloudflare.com/analytics/graphql-api/features/discovery/introspection/).

Railway configuration was checked without printing values: account ID and legacy API-key variable exist; preferred API-token and email variables do not. The corrected query is accepted by the schema, but Cloudflare returns `not authorized for that account`. No key/account settings were changed. Actual field measurements remain unverified until the configured token has access to the same account. Cloudflare documents [Account / Account Analytics / Read permissions](https://developers.cloudflare.com/analytics/graphql-api/getting-started/authentication/api-token-auth/).

## Fix

- One host-scoped aggregate for `themegaradio.com` and `www.themegaradio.com`, all device types, default seven days. No averages of separately grouped percentiles. Per-vital observation totals and negative/missing sentinels prevent fabricated zero/good results.
- Account access problems and absent configuration are explicit `configuration_required`; empty measurements are `no_data`; provider/network/timeout failures are `upstream_unavailable`. These optional integration states do not assert an application outage. No raw provider errors or credentials are returned/logged.
- Eight-second deadline, shared in-flight request, bounded 16-entry cache, five-minute data cache and one-minute failure backoff; strict UTC date validation and maximum seven-day query interval. Admin auth remains in place, HTTP responses are private/no-store.
- Existing card layout retained. Clear host/date/device scope, actionable integration state, pending refresh lock, and no misleading permanently green P50/red P95. Page counts are estimates, not claimed raw samples; [Cloudflare adaptive sampling](https://developers.cloudflare.com/analytics/graphql-api/sampling/) can produce varying results. These are Cloudflare RUM values, not PageSpeed/CrUX scores.

## Verification

12 mocked service regressions, 1 local HTTP route regression and 2 frontend component regressions passed. API and frontend TypeScript checks passed. Tests cover units, no-data, per-metric missingness, access-denied sanitization, malformed ranges, timeout, caching/single-flight, auth and refresh state. No production writes, new keys, paid calls or infrastructure were created. Deployment and live post-deploy verification are owned by the root task.

The SEO-audit skill guided the distinction between real field measurements and unavailable data; frontend-design guided the bounded, layout-preserving status clarification.
