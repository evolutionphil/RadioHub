# PostgreSQL recovery and release — 2026-09-07

This is an operational journal. The latest verified status below supersedes
earlier maintenance/pending entries; remaining SEO/performance work is explicit.
The SEO/code audit is recorded separately in `SEO_PERFORMANCE_AUDIT_2026-09-07.md`.

## Mobile repair follow-up — after 16:18 UTC

- The running release before this follow-up is `39ebf5737`; the verified native
  cutover and subsequent recovery evidence are retained outside Git in
  `RadioHubBackups/20260907-recovery/FINAL_RELEASE_VERIFICATION.md`.
- Rechecked the verified snapshot: 61,291 stations, 170 users, 879 translation
  keys, 48,472 translation rows and 1,680 localized URL rows. Previously verified
  native parity checks remain the baseline; this is not a new production write.
- The 272 archive-only records were inspected using READ ONLY transactions:
  uppercase legacy translation variants have all 57 corresponding native
  language values; obsolete counters, estimated language statistics and three
  old page snapshots are not missing active data. Do not overwrite current
  translations or page content with these variants.
- Per the user's revised scope, no historical GSC/log reimport is needed or
  performed. Existing records, archives and database backups are retained.
- Recent-played display repair refreshes up to 12 station IDs from PostgreSQL's
  existing batch endpoint. It does not delete local history, invent listening
  times for old records, or reconnect the application to MongoDB.
- Remaining original content issues are distinct from migration loss: legal
  page bodies contain English-only copy and company details require owner
  verification. Historical snapshots contain no missing German legal bodies.

## API recovery follow-up — after 15:44 UTC

- Deployment `5933fc27-0b73-4d22-b296-9f1c288087eb` (commit `26e3629d`)
  stopped after its internal RSS guard reported 3,245 MB. The graceful SIGTERM
  handler returned exit 0, so Railway's `ON_FAILURE` policy did not restart it;
  a deployment labelled SUCCESS was not evidence of a running API.
  Web remained ready, but API and proxied critical translations returned 502.
- Pro settings: 24 GB replica memory ceiling, V8 old-space 4 GB, no RSS overrides.
  Set `RSS_CRITICAL_MB=4500` and `RSS_RESTART_MB=6000`, preserving the guard with
  native-memory headroom; redeployed API as `897a5a10-7928-40c2-893b-e78b3c878cb4`.
  API/critical dictionary returned 200. Sampled heap rose to 3,127 MB then fell to
  1,162 MB without restarting; these samples do not establish a persistent leak.
- Fresh read-only PostgreSQL check: 61,291 stations, 170 users, 679,973 GSC
  inspections, 940,071 source captures, 13 PostgreSQL authority domains and zero
  invalid indexes/constraints. No import is needed before opening the site;
  the fully verified snapshot already includes Google crawl history.
- Search Console live inspection of `/en` reported Google can access and index
  the URL; its indexing request was accepted after sitemap resubmission.
  This is a live-test result, not a guarantee of indexing every station.
- The final 26e HTTP run passed 84 localized HTML samples, then stopped at the
  critical translation API's 502. It is not a complete passing audit.
  Final deployment verification is retained in the private recovery evidence.
- Follow-up code passes **55 targeted tests, zero skips**, including actual local
  PostgreSQL projection/mutation parity; API typecheck and production-boundary
  build also pass (387 production packages, 2,612 API inputs, zero Mongo imports).
  Internal watchdog/RSS/fatal restarts now retain failure exit intent through
  graceful cleanup; ordinary external termination remains exit 0.
- Requested catalog projections now select only their native SQL columns (and
  source only for provider-only fields), preserving returned field semantics.
  This fixes the boot GSC discovery slug-only query unnecessarily decoding all
  station descriptions/source 30 seconds after startup. Its timing matches the
  observed rise; no heap profile was captured to claim it was the only allocation.
  Sitemap diff reads at most 500 native station rows at a time instead of
  retaining a whole language's full documents. No background job was disabled.
- Validation note: the first combined local run used the wrong `/postgres` test
  database and parallel extension setup; the new safety guard rejected it and
  another suite hit a local extension-creation race. Rerun in the established
  loopback `radiohub_test` database with serial test files passed all 55 tests.
  A global pnpm auto-install was also aborted by its no-TTY safeguard; direct
  local TypeScript/esbuild validation succeeded without reinstalling dependencies.

## Latest verified production status — 15:32 UTC

- The source-bound, fully verified local v2 PostgreSQL snapshot was uploaded
  and its remote hash matched: **1,772,706,039 bytes**, SHA256
  `48216910c0699107a3685bf14681640d670e04afcbd9c7b49fdad9800e78ab88`.
  `pg_restore --no-owner --no-privileges -j2` into the **new** production
  `radiohub_ready` database completed around 15:18. Its migration history
  truthfully retains `source_database=radiohub_backup_verify_20260907`.
- Around 15:21 the independent read-only before-cutover verifier passed all
  **100 collections / 940,071 source JSON/BSON captures and source hashes**;
  all checked native parity counters were zero. No history or completion
  markers were fabricated to substitute for this proof.
- Web deployment `ce376adc-bf45-4347-8886-97fc68cf2939` and API deployment
  `20328846-c449-4212-bbd4-37da20be0e8c` both returned `/readyz` **200**,
  `ready: true`, PostgreSQL, around 15:24. Runtime counts: **61,291 stations,
  170 users, 940,071 captures, 679,973 GSC inspection rows, 26 devices plus
  two quarantine records**, all 13 PostgreSQL authority domains, and zero
  invalid indexes/foreign keys.
- PostgreSQL `PGDATABASE`, `POSTGRES_DB` and `DATABASE_URL` defaults were aligned
  to `radiohub_ready` with skip-deploys; PostgreSQL was **not restarted**.
  Reloading Railway's database viewer displayed populated stations, page 1 of
  6,130. API/web have no MongoDB environment variables.
- Cloudflare purge of 14 localized prefixes and five root/discovery URLs
  succeeded. The live HTTP audit passed **142 requests / 84 pages / 14 locales,
  zero detected issues**, including 98 sitemap child references and 16 sampled
  XML files. Browser playback of **ORF Radio Wien** reached `paused=false`,
  `readyState=4`, `currentTime=15.36`; playback was then stopped
  (`paused=true`). No browser console errors were observed in that smoke test.
- The parallel old `radiohub` initializer was still verifying, not complete.
  Its exact deployment `15084044-5a90-4ab9-a2d4-7c15378e3f9b` was explicitly
  stopped around 15:32 **after the verified replacement was live**. Its MongoDB
  URI was removed and its future database URL points to `radiohub_ready`.
  All 21 original source TTL definitions were restored and confirmed.
  The old databases, original captures and all backups remain preserved.
- Search Console accepted resubmission of the canonical sitemap index on
  September 7. This does not establish a new Google crawl or indexing result.
- **Still pending:** The Google live-URL test and usable mobile/desktop
  PageSpeed UI measurements. The four PSI API profiles returned Google quota
  **429**, not performance results. This revision includes tested card/SSR
  alt-text, invalid distance and single-escaped H1 fixes (20 frontend + 34 API
  tests, both typechecks and frontend build passed); verify its rollout separately.

## Release update — 14:10 UTC

- The startup lock timeout was traced to one abandoned `pg_dump` connection,
  waiting in `ClientWrite` for over 11 hours and blocking migration 0025.
  The independently restored full backup's SHA256 was rechecked before terminating
  only that exact, guarded session. Migrations 0025 and 0026 then applied; no
  database rows or backups were removed. API/web commit `9c35ff8f9` is deployed
  successfully, but remains in maintenance on the old database.
- The fresh source comparison finished at 14:01:18 UTC: all 100 collections,
  940,071 documents and original raw-BSON fingerprints matched the verified
  backup. All 21 temporary TTL definitions matched before and after the scan.
  Its report is retained privately beside the archive. A subsequent redundant
  read-only scan was stopped after this completed proof was recovered.
- To reduce downtime, the tested initializer and isolated fresh rehearsal now run
  in parallel. Production deployment `15084044-5a90-4ab9-a2d4-7c15378e3f9b`
  builds commit `9c35ff8f9` with `node dist/bootstrap.mjs`, targeting the confirmed
  empty `radiohub` database on the expanded 20 GB volume. This supersedes the
  earlier sequential rehearsal-before-import plan below, not the verification
  requirement before application cutover. Old `railway` and all backups remain.
- The latest code suite passed **1,091 tests across 108 API test files** with
  no failures, cancellations or skips; API and migration typechecks also passed.
  Production native parity, application readiness and live SEO remain pending.
- At 14:16:35 UTC the pristine local bundled-bootstrap rehearsal finished with
  exit 0 in 12m51s: all 940,071 JSON/BSON captures, native content, foreign keys
  and 64 nonempty capture checkpoints passed. Counts: 61,291 stations, 170 users,
  26 runtime device records plus two preserved historical quarantine records.
  There are 26 valid applied migrations, no PostgreSQL write authority and no
  remaining connections or stderr output. Database size is 5,945,996,979 bytes.
  Runtime smoke uses a separate disposable clone of this verified database.
- Both application services are now in Virginia with one replica each. The
  post-deployment web-to-database probe measured a mean **1.2 ms** across eight
  read-only `SELECT 1` calls, versus 93–94 ms before the region alignment.

## Confirmed interruption and recovery decisions

- The previous initial capture received SIGTERM before completion. Its next
  attempt correctly refused source-count drift; MongoDB TTL expiry had changed
  the stopped application's source even without application writes.
- The old PostgreSQL database `railway` is preserved. Its 407,791 legacy captures
  were not discarded, overwritten, or promoted to native application authority.
- A separate empty PostgreSQL database, `radiohub`, was created in the same
  service for a fresh full import. API/web must not switch before verification.
- The source has 100 ordinary collections and 940,071 documents, including
  61,291 stations. These are snapshot counts, not proof of completed migration.
- Original definitions of 21 MongoDB TTL indexes were saved, their retention
  temporarily extended to 2,147,483,647 seconds after date-range checks, and all
  changes re-read and journalled. Document dates and authentication expiry values
  were not changed. Restore original retention only after capture/cutover checks.
- A database-wide change stream began at 2026-09-07T02:45:07.718Z. Its current
  zero-change observation is an additional check, not a substitute for checksums.

## Independent backups

Private backups are outside Git in
`C:/Users/mumiix/Documents/RadioHubBackups/20260907-recovery`.
Do not commit archives, credentials, or source documents.

| Artifact | Status / evidence |
| --- | --- |
| `postgres-before-recovery-2.dump` | Full restore to isolated local PostgreSQL passed. 50,695,639 bytes; SHA256 `8BC6DA522AA4AA54BC6EF528525ADAE2E016AA78281DB645E9FCC82BE1E0B72C`. All 407,791 capture checksums and typed identities verified. |
| `mongo-ttl-original.json` | Original TTL definitions and source identity fingerprint retained privately. |
| `mongo-ttl-pause-journal.jsonl` | Per-index confirmation of temporary retention changes. |
| `mongo-cloud-dump/source-ssh.archive.gz` | Official archive fully restored and verified at 03:00:26 UTC. 560,463,732 bytes; SHA256 `9ebef1759b5bb447efd94a159f6d50078c3a9d6ba3a1018896797bab6d77295f`. All 100 collections / 940,071 documents match source counts and exact `_id`-ordered raw BSON bytes and types; 61,291 stations. `VERIFIED.json` records the proof. No TTL indexes were restored locally. |
| Earlier PC MongoDB exports | Incomplete after network errors. Retained for diagnosis; **not valid full backups** and never mixed into the cloud archive. |

## Railway controls

- API and web use `/healthz` for deployment liveness. During migration this may
  return 200 with `ready: false`; `/readyz` must return 200 before the application
  is considered ready. A green Railway deployment alone is insufficient.
- The initializer (`discerning-empathy`) is temporarily held with an idle Node
  start command while remote backup files are downloaded. Clear that command
  before the actual initializer deployment; its normal Docker CMD is
  `node dist/bootstrap.mjs`.
- Initializer auto-deploy is disabled to prevent a GitHub push from interrupting
  capture. Restart retries are limited to three; no HTTP healthcheck is attached
  to this one-off job.
- After verified source-backup restoration, the initializer's next-deployment
  `DATABASE_URL` was changed to private database `radiohub` with deployment
  explicitly skipped. Its existing held container and API/web URLs are unchanged.
- API/web remain attached to the preserved old database and in maintenance.
  Their unused `MONGODB_URI` settings must be removed during final cutover.
- A read-only web-to-PostgreSQL probe measured 93–94 ms for each `SELECT 1`
  (Amsterdam application, Virginia database). API/web region changes to Virginia
  are staged for the release, keeping one replica each. The Postgres volume and
  stream service are not moved. Post-deploy latency must be measured again.
- The initializer itself is already colocated with PostgreSQL. An eight-query
  read-only probe measured 0.68–2.05 ms (mean 1.02 ms), independently confirming
  that the large per-record normalization does not cross the Atlantic.
- Temporary operator SSH access and container-only backup tools must be cleaned
  up after verification. Backups and the old database remain retained.

### Storage preflight and approved expansion

- PostgreSQL's persistent volume is 5.00 GB in Railway. `df` reports
  4,725,096 KiB total and 3,323,292 KiB available; the original database and WAL
  already consume space.
- The first fresh rehearsal database occupies 5,667 MiB. The diagnostic clone
  occupies 5,929 MiB; `legacy_documents` (3,004 MiB) and `stations` (2,106 MiB)
  alone exceed 5 GiB, before GSC native rows, other tables and WAL headroom.
- Therefore the current volume cannot hold the complete import. Do not start
  it, delete old data, discard capture history, or disable integrity safeguards
  to fit the limit. Sufficient persistent capacity must be available first.
- The initial authenticated workspace Plans page confirmed **Hobby**, explicitly
  **up to 5 GB storage**. The volume UI exposes no Live Resize control. Pro is
  offered at **$20 minimum usage per month**, including $20 usage; excess
  resource usage is billed separately. Its stated storage ceiling is 1 TB.
  A subscription upgrade required explicit user approval; no upgrade was made
  before it was received.
- The user approved the upgrade and then performed it themselves. The active
  **Pro** plan was verified in the authenticated UI. The operator then resized
  only `postgres-volume` from **5 GB to 20 GB** via Live Resize. Read-only `df`
  confirmed **19,138,976 KiB total / 17,737,172 KiB available**, while `radiohub`
  still had zero public tables. No data, old database, volume or backups were
  removed. Capacity is no longer a blocker.
- Production import/cutover still awaits the verification gates below. The
  initializer remains deliberately held, its
  auto-deploy stays disabled, old `railway` is preserved, and `radiohub` has not
  received the production import. API/web region changes remain staged only.
- During the approval pause, source TTL retention remained temporarily extended.
  The original watcher last recorded zero changes/errors at 08:57:39 UTC, then
  its SSH session ended. A new watcher was established at **13:45:49.565 UTC**.
  Do not claim continuous coverage across that gap; a fresh raw-BSON source
  fingerprint comparison is running before production import. Restore original TTLs
  after verified cutover, or use a separately reviewed abort/backup-refresh
  procedure if the migration is cancelled; do not falsely assert cutover to
  bypass the restore helper's guard.
- Continue by completing the pristine bundled-bootstrap rehearsal and local
  application smoke, then committing/pushing and releasing in the gated order
  below. No production-ready or live SEO completion claim is made.

### Code regression evidence

- All 107 API test files passed in fresh OS processes: 1,077 tests, zero failures,
  cancellations or skips. Node 24.16.0 nested test-runner IPC had failed to
  deserialize one unchanged genres test file; running each file in its own OS
  process with `--test-isolation=none` avoids that runner transport while
  retaining file isolation and executing every assertion. No tests were hidden.
- Frontend: 132 tests / 13 files passed. API/frontend TypeScript checks pass.
- These are local code/test results, not proof of production migration or readiness.

## Required release gates

### Real-data rehearsal findings

- First full rehearsal captured all 940,071 documents, then exposed an omitted
  `cancelled` value in the description-job status constraint. Eleven historical
  cancelled jobs are legitimate: the current application already supports this
  state. Additive migration 0025 preserves it, with journal/Drizzle consistency
  and valid/invalid state tests; published migration files remain unchanged.
- A second diagnostic found two stale device pairings whose nonempty user IDs
  have no matching source user. Their newest activity is over 200 days old.
  Do not invent users, activate these devices, relax the runtime owner FK, or
  silently discard records. Additive migration 0026 provides an operator-only quarantine
  with original capture/checksum references and exact disjoint-union verification
  (26 legitimate devices plus two historical quarantined records = 28 source).
- Independent code review and ten real-PostgreSQL quarantine tests passed:
  runtime ownership constraints remain strict; checksum tampering, overlap,
  owner revival and capture/prune replay fail closed. Explicit operator
  normalize-then-verify recovery without MongoDB is tested and documented in
  `POSTGRES_AUTOMATIC_SETUP.md`; automatic all-phase replay remains prohibited.
- A new diagnostic clone completed normalization of every native domain,
  including all 679,973 GSC inspection rows and the 26+2 device split. Full
  checksum/content verification and a subsequent pristine bundled-bootstrap
  rehearsal are still required before production import.
- The subsequent real-data verification exposed an additional performance
  defect before release: comparing a non-null native primary key with
  `IS NOT DISTINCT FROM` prevents an indexed point lookup in the observed GSC
  query plan. Repeated checks accumulated 3,152 sequential scans and over
  706 million tuple reads; bounded EXPLAIN shows `id=$1` can use the index.
  The fix now uses strict equality for proven non-null unique identity fields,
  retaining null-safe comparisons for other content. Seven actual-PostgreSQL
  query-plan/parity tests and independent review passed. The stopped diagnostic
  was **not a verified import snapshot**; corrected verification is being rerun
  before a pristine bundled-bootstrap rehearsal.
- Rehearsal/diagnostic failures remain in isolated local databases for evidence.
  They are not approved release snapshots; production `radiohub` remains empty.

1. Verify cloud archive hash, restore every collection locally with no TTL index
   restoration, and match each collection's `_id`-ordered raw BSON checksum.
2. Rehearse full capture, normalization and native parity against the verified
   local source, in a new disposable PostgreSQL database. Fix demonstrated
   normalization errors without dropping or silently skipping source records.
3. Run the tested operator against pristine production `radiohub` with stopped
   writers. Preserve all capture, checksum, authority and resume protections.
4. Verify completed migration/checkpoints and native data parity, then switch
   API/web and the database viewer to `radiohub` and deploy tested `main`.
5. Check real readiness, API/player/navigation and translations; audit rendered
   production HTML, all 14 SEO locales, sitemap contents and structured data.
6. Measure healthy mobile/desktop PageSpeed; use Search Console live inspection
   and sitemap submission only after origin responses are healthy.
7. Restore original MongoDB TTL settings, retire initializer source access, and
   revoke only task-owned temporary SSH access. Record actual release evidence.

Google decides indexing independently. A valid sitemap and technically
indexable pages do not guarantee every translated URL will be indexed.
