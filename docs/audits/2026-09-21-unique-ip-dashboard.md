# Unique-IP dashboard measurement

## Requested definition

One canonical IP counts once per displayed time window, irrespective of tabs,
sessions or accounts. IPv4-mapped IPv6 and equivalent IPv6 spellings deduplicate.
Shared networks therefore count as one IP, not necessarily one person.

## Implementation

- Additive migration `0037_qualified_unique_visitors.sql`; a dedicated INET primary
  key stores first/last activity. No legacy data is relabeled or backfilled.
- Successful eligible API/app requests update presence asynchronously after the
  response. Known bots, administrative traffic, monitoring, assets and prefetches
  are excluded. Native app user agents remain eligible.
- Counters: last 30 minutes, current Europe/Berlin calendar day, rolling 7 days.
  Inactive presence expires after 30 days based on last activity.
- Admin-only `/api/admin/visitor-metrics` has a 15-second coalesced cache. Existing
  catalogue totals remain separately cached. Dashboard polls every 30 seconds
  while visible; unavailable/error responses show a dash, never fabricated zero.
- The existing dashboard design is preserved. Labels, time zone, measurement
  timestamp and collection-start timestamp explain exactly what is measured.

## Limitations

These are observed IPs, not verified humans or simultaneous radio listeners.
UA filtering is best-effort. Edge-only/cache-only visits without an eligible API
request are not measured; no additional client heartbeat was introduced.
The existing private proxy must preserve edge-overwritten CF-Connecting-IP;
origin/header spoofing is not eliminated by this application-only change.
Per-process admission is capped at 50,000 recent identities and 128 pending
writes. Measurement can undercount on database failure or saturation rather than
block user responses or grow an unbounded queue. Failures emit generic warnings.
Old visitor records are not imported because their bot/admin provenance is not
recoverable. The first day/week of the new series is necessarily partial.

## Validation

- 21 backend tests passed, including PGlite migration/query tests, IPv4/IPv6
  deduplication, Berlin summer/winter day boundaries, midnight throttle rollover,
  request exclusions, bounded writes, retention, cache expiry and error recovery.
- 14 dashboard tests passed; genuine zero, unavailable/stale data, retry and
  refresh-all are covered.
- API and frontend TypeScript checks passed.
- API, web-server and frontend production builds passed.
- Real-PostgreSQL discovery-suite fixture updated for the new table; that full
  suite needs `PG_TEST_DATABASE_URL` and was not run against production.

## Release status

Not deployed yet. Production has an active bulk-description repair job with
14,526 candidates (2,569 processed at the read-only check). The existing worker
does not automatically resume on a deployment restart; completed descriptions
are persisted, but the remaining job would be interrupted. Therefore no push or
Railway restart was performed during this release preparation. Deploy after that
job finishes, then verify the migration, new dashboard and collection timestamp.
No new service or environment variable is required.
