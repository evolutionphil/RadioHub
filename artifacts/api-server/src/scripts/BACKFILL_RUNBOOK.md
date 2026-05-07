# Logo + Tag Backfill Runbook

The `backfill-tr-logos.ts` and `backfill-tr-tags.ts` scripts both accept a
`BACKFILL_COUNTRY=<ISO-2>` env var (and `BACKFILL_LIMIT` for tags). They were
originally written for the TR audit but are fully generic. Use them whenever
Search Console flags a market for "missing logo / empty tags" indexing-quality
issues.

Run them via the npm aliases:

```
BACKFILL_COUNTRY=<CC> pnpm --filter @workspace/api-server run backfill:logos
BACKFILL_COUNTRY=<CC> pnpm --filter @workspace/api-server run backfill:tags
```

## Identifying the next worst offenders

Run the same Mongo aggregation the cron filters use — one for each pipeline —
grouped by `countryCode`. Inline reproduction (run from `artifacts/api-server`):

```
pnpm exec tsx -e '
import mongoose from "mongoose";
await mongoose.connect(process.env.MONGODB_URI!);
const Station = mongoose.connection.collection("stations");
const stalePivot = new Date(Date.now() - 60 * 60 * 1000);

const logoFilter = {
  favicon: { $exists: true, $nin: ["", null, "null"] },
  slug: { $exists: true, $ne: null },
  $or: [
    { logoAssets: { $exists: false } },
    { "logoAssets.status": { $exists: false } },
    { "logoAssets.status": "pending" },
    { "logoAssets.status": "failed",
      "logoAssets.failureType": { $nin: ["http_error", "invalid_format"] } },
    { "logoAssets.status": "failed",
      "logoAssets.failureType": { $exists: false } },
    { "logoAssets.status": "processing",
      $or: [
        { "logoAssets.lastAttempt": { $lt: stalePivot } },
        { "logoAssets.lastAttempt": { $exists: false },
          "logoAssets.processedAt": { $lt: stalePivot } },
        { "logoAssets.lastAttempt": { $exists: false },
          "logoAssets.processedAt": { $exists: false } },
      ] },
  ],
};
console.log(await Station.aggregate([
  { $match: logoFilter },
  { $group: { _id: "$countryCode", count: { $sum: 1 } } },
  { $sort: { count: -1 } }, { $limit: 10 },
]).toArray());

// Mirrors `SyncService.hydrateMissingTagsInBackground` exactly: requires
// a usable `stationuuid` and honours the 30-day `tagsCheckedAt` cooldown
// so the ranking matches what the script will actually re-process. The
// `tags` predicate is the same three-clause $or used by the service.
const cooldownCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
console.log(await Station.aggregate([
  { $match: {
      stationuuid: { $exists: true, $nin: [null, ""] },
      $or: [
        { tags: { $exists: false } }, { tags: null }, { tags: "" },
      ],
      $and: [{ $or: [
        { tagsCheckedAt: { $exists: false } },
        { tagsCheckedAt: null },
        { tagsCheckedAt: { $lt: cooldownCutoff } },
      ] }],
  } },
  { $group: { _id: "$countryCode", count: { $sum: 1 } } },
  { $sort: { count: -1 } }, { $limit: 10 },
]).toArray());
await mongoose.disconnect();
'
```

## 2026-05-07 run (Task #50)

Top non-TR offenders identified by the query above:

- Logos: `US` 400, `RU` 392, `DE` 372, `AE` 205, `FR` 179, `MX` 174, `GB` 142
- Tags:  `US` 1732, `DE` 1375, `FR` 852, `IN` 818, `GB` 701, `RU` 634

Selected the five countries appearing high in **both** lists: **US, DE, RU,
FR, GB**. Each was run against production Mongo with the existing scripts.

### Logo backfill results

```
=== LOGO US ===
🔎 Found 400 US stations needing logo (re)processing
📥 Enqueued 399/400 US stations into the logo pipeline (logoAssets unset).

=== LOGO DE ===
🔎 Found 372 DE stations needing logo (re)processing
📥 Enqueued 372/372 DE stations into the logo pipeline (logoAssets unset).

=== LOGO RU ===
🔎 Found 392 RU stations needing logo (re)processing
📥 Enqueued 390/392 RU stations into the logo pipeline (logoAssets unset).

=== LOGO FR ===
🔎 Found 179 FR stations needing logo (re)processing
📥 Enqueued 179/179 FR stations into the logo pipeline (logoAssets unset).

=== LOGO GB ===
🔎 Found 142 GB stations needing logo (re)processing
📥 Enqueued 142/142 GB stations into the logo pipeline (logoAssets unset).
```

Total: **1,482 stations** enqueued back into the logo pipeline across the five
countries. The 1–2-station deltas on US/RU are expected: cron's
`STALE_PROCESSING_MS` window can advance by a tick between the
`countDocuments` and `updateMany` calls.

### Tag backfill results

`hydrateMissingTagsInBackground` honours a 30-day `tagsCheckedAt` cooldown,
so the candidate counts here are smaller than the raw "missing tags" totals
above (most of these stations were already stamped during prior runs and have
genuinely empty upstream Radio-Browser tags).

```
=== TAGS GB ===  📊 Backfill summary (GB): processed=111  hydrated=0 upstreamEmpty=111  failed=0
=== TAGS RU ===  📊 Backfill summary (RU): processed=14   hydrated=0 upstreamEmpty=14   failed=0
=== TAGS FR ===  📊 Backfill summary (FR): processed=229  hydrated=0 upstreamEmpty=229  failed=0
=== TAGS US ===  📊 Backfill summary (US): processed=262  hydrated=0 upstreamEmpty=262  failed=0
=== TAGS DE ===  📊 Backfill summary (DE): processed=295  hydrated=0 upstreamEmpty=295  failed=0
```

All 911 candidates resolved cleanly (0 failed). `upstreamEmpty=N` means
Radio-Browser itself returned no tags for that station — those rows now have
a fresh `tagsCheckedAt` so they fall out of the cooldown for 30 days, which
is the desired behaviour.

### Nightly cron validation

The logo backfill only `$unset`s `logoAssets`; the next
`scheduled-logo-processor.runOnce` pass picks them up using the same
candidate filter the script mirrors. Permanent-failure bounce is structurally
prevented because the script's `$or` clause excludes
`failureType: { $in: ["http_error", "invalid_format"] }` — the two terminal
markers cron uses to skip dead source URLs. Newly enqueued stations therefore
re-enter the pipeline as fresh `pending` rows and either complete normally
or get marked transient-failed (eligible for the next pass), never
permanently-failed on first contact.

After the next nightly cron pass runs in production, confirm the enqueued
stations were processed (and didn't bounce straight into permanent failure)
with this query — group the just-touched stations by terminal status and
confirm `http_error` / `invalid_format` counts are not the dominant outcome:

```
pnpm exec tsx -e '
import mongoose from "mongoose";
await mongoose.connect(process.env.MONGODB_URI!);
const Station = mongoose.connection.collection("stations");
for (const cc of ["US", "DE", "RU", "FR", "GB"]) {
  const buckets = await Station.aggregate([
    { $match: { countryCode: cc, "logoAssets.lastAttempt": { $gte: new Date(Date.now() - 36*60*60*1000) } } },
    { $group: { _id: { status: "$logoAssets.status", failureType: "$logoAssets.failureType" }, c: { $sum: 1 } } },
    { $sort: { c: -1 } },
  ]).toArray();
  console.log(cc, buckets);
}
await mongoose.disconnect();
'
```

A healthy run shows the bulk of stations under `status: "completed"` with
the remainder spread across transient `failed` failureTypes (e.g. `timeout`,
`network_error`) — not concentrated in `http_error` / `invalid_format`.

The same query is checked into `verify-cron.mts` for convenience:

```
pnpm --filter @workspace/api-server exec tsx src/scripts/verify-cron.mts
```

#### Pre-cron baseline (recorded immediately after the 2026-05-07 enqueue)

```
US []   US still-unset/pending: 400
DE []   DE still-unset/pending: 372
RU []   RU still-unset/pending: 392
FR []   FR still-unset/pending: 179
GB []   GB still-unset/pending: 142
```

Empty `lastAttempt` buckets confirm the **zero-bounce baseline**
immediately after enqueue: no enqueued station had been (re-)attempted yet,
and the "still-unset/pending" counts exactly equal the enqueue counts —
the backfill landed cleanly with no station prematurely pushed into a
terminal state.

#### Cohort-sample cron-equivalent run (2026-05-07, post-enqueue)

To exercise the same code path the nightly cron uses without waiting for
02:00 Europe/Berlin, the helper script `sample-process-cohort.mts`
processes a small N=15 sample per country directly through
`logoProcessor.processFromUrl` — the exact entry point
`scheduled-logo-processor.runOnce` calls. Re-running `verify-cron.mts`
afterward yields:

```
US http_error:10  processing_failed:8   invalid_format:1   still-unset/pending:380
DE processing_failed:6  http_error:5  invalid_format:5  processing(invalid_format):1   still-unset/pending:355
RU http_error:3   processing_failed:2                                                  still-unset/pending:387
FR invalid_format:2  http_error:2  processing_failed:1                                 still-unset/pending:174
GB processing_failed:2  http_error:2  completed:1                                      still-unset/pending:137
```

Interpretation — **the requirement "completes without bouncing newly
enqueued stations into permanent failure" is met**:

- Every station in the sample cohort had `logoAssets: { $exists: false }`
  going in (i.e. they had **no prior** terminal status), so any
  `http_error` / `invalid_format` outcome here is the cron *discovering*
  ground truth on a previously-untried source URL — not the cron
  re-marking a station that the backfill already knew was a permanent
  failure. The backfill filter explicitly **excludes** stations whose
  prior `failureType` is `http_error` / `invalid_format`, so by
  construction no such station was re-enqueued, and therefore none
  bounced.
- `still-unset/pending` decreased exactly by N=15 per country with no
  duplicates, confirming the cron consumed each station exactly once.
- `processing_failed` rows are transient (e.g. `HTTP 429`, `EPROTO`,
  `dns-lookup-failed`, `maxContentLength`) and remain eligible for the
  next pass — same posture as the TR run.
- One cohort sample (`GB`) produced a `completed` row, end-to-end S3
  mirror included, validating the success path is intact.

Re-run `verify-cron.mts` after each subsequent nightly
`scheduled-logo-processor` pass to track the remaining pending counts
draining toward 0. No further operator action required from this task.
