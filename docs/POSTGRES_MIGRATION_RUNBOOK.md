# PostgreSQL cutover runbook

Checkpoint: 2026-09-07. Do not deploy the earlier shadow/dual-write instructions:
those modes are now rejected. This document is a deployment procedure, not
approval that customer-data migration and production verification have occurred.
No production data has been changed.

## Automatic first installation

See [POSTGRES_AUTOMATIC_SETUP.md](POSTGRES_AUTOMATIC_SETUP.md) for the one-time
Railway operator service (`Dockerfile.migration`, `railway.migration.json`). It
creates the schema, reads the stopped MongoDB primary once, imports all data and
verifies it. Successful runs and existing PostgreSQL authority are skipped on
later starts without contacting MongoDB. A source URL, real writer quiescence
and an independently recoverable backup remain prerequisites; the script cannot
infer or create these external conditions from `DATABASE_URL`.

API/web Docker entrypoints now automatically apply immutable schema migrations
and wait for a verified import before loading the application. The same readiness
guard runs under the data-import lock before recording first write authority.
The default `POSTGRES_INIT_MODE=import` protects existing installations.
`POSTGRES_INIT_MODE=empty` is an explicit new-installation-only alternative, not a
workaround for pending/failed imports. Existing PostgreSQL authority allows normal
restarts without reimport. The old manual operator sequence below remains valid.

## Application configuration

Set `DATABASE_URL` (or `POSTGRES_URL`) to a PostgreSQL URL and a strong
`SESSION_SECRET`. PostgreSQL TLS verifies certificates by default; supply
`POSTGRES_SSL_CA` when required. `POSTGRES_SSL=disable` is for trusted local
development/private deployments whose transport security has been reviewed.

Remove legacy `*_STORE`, `STATION_READ_MODE`, `STATION_WRITE_MODE`,
`DATABASE_MIGRATION_MODE` and `STATION_CDC_ENABLED` settings. If deployment
templates still supply store/read/write flags, their only supported value is
`postgres`; migration mode may only be `off`, and CDC must not be enabled.
The application does not need `MONGODB_URI`.

Pool defaults: max 10, connect timeout 10 seconds, idle timeout 30 seconds,
server statement timeout 60 seconds and idle-transaction timeout 60 seconds.
Tune `POSTGRES_POOL_MAX`, `POSTGRES_CONNECT_TIMEOUT_MS`,
`POSTGRES_IDLE_TIMEOUT_MS`, `POSTGRES_STATEMENT_TIMEOUT_MS` and
`POSTGRES_IDLE_TRANSACTION_TIMEOUT_MS` against total replica/worker connection
budgets. SSR uses a shorter transaction-local query deadline.

Session advisory locks and cast LISTEN connections use a separate coordination
pool (`POSTGRES_COORDINATION_POOL_MAX`, default 10). They do not occupy data-query
capacity, so a data pool of one connection remains usable. Budget the sum of both
pool maxima across API/web replicas, plus migrations and administrative tools.
Use direct PostgreSQL connections or session-pooling for coordination: transaction
poolers cannot preserve session advisory locks or LISTEN subscriptions.

`BACKGROUND_JOBS_ENABLED=false` disables API scheduled provider/AI jobs and boot
maintenance on a staging/read-serving replica; it does not disable explicit
admin actions or normal PostgreSQL-backed application requests. Default is enabled.

## Safe deployment order

1. Finish the verification gates in POSTGRES_VERIFICATION.md. Provision the
   PostgreSQL service with monitored capacity, access controls and tested backups.
   Keep independent source backups and an identified recovery point.
2. Apply the versioned schema with
   `pnpm --filter @workspace/api-server run db:schema:postgres`.
   The runner takes a database advisory lock, uses transactions and verifies
   checksums of previously applied files. Never edit already-deployed migration
   files or use schema-push as a production substitute.
3. Stop/drain every writer to both source and destination: API/web replicas,
   WebSockets, external workers and scheduled jobs. Maintenance middleware alone
   does not stop background work. Do not start the new application yet: startup
   records permanent PostgreSQL write authority.
4. Run the separate offline import tool against the independently verified source
   and the stopped, fresh destination. Confirm
   `MIGRATION_TARGET_WRITERS_STOPPED=true`. Capture every collection, normalize,
   and verify exact IDs, relations, fields, checksums and foreign-key integrity.
   The CLI command is `pnpm --filter @workspace/legacy-migration migrate`;
   it is a development/operator command, not a production request handler.
   Supply the source `MONGODB_URI` only to that operator process, together with
   the destination `DATABASE_URL`; never add the source credential to new runtime
   deployments. Use `pnpm --filter @workspace/legacy-migration verify` to rerun
   verification of the captured/normalized destination before startup.
5. If reconciling source deletions before the authority switch, additionally set
   `DATABASE_MAINTENANCE_READ_ONLY=true`, `MIGRATION_PRUNE=true` and the exact
   `MIGRATION_EXPECT_SOURCE_DATABASE`. Do not combine pruning with a collection
   allowlist. An empty source is rejected unless deliberately confirmed using
   the dedicated empty-source option.
6. Require the import/verification command to exit zero and save its run/checkpoint
   evidence. Restore a backup to a separate database and verify it. Exercise a
   disposable migrated staging copy before the production cutover.
7. Remove source credentials and migration-only settings from the runtime.
   Deploy only the PostgreSQL-native version; drain all earlier versions. Check
   API and web `/readyz` and real authenticated/public operations, then admit traffic.
   Verify database sessions, TV/cast, translations, payment redelivery, sync,
   backfill and scheduled jobs. Monitor error rates, latency, locks and pool use.
8. Keep the old source read-only until the backup/reconciliation/payment-event
   observation plan is satisfied. This task has not deleted or decommissioned it.

Never run integration tests against production. Each PostgreSQL test creates and
drops its own random schema, but the test account must still be restricted to an
explicitly disposable database.

## Recovery boundary

Once any PostgreSQL-only writes exist, do not re-import, normalize or prune from
an older Mongo snapshot. Both runtime flags and durable
`database_write_authority` markers protect this boundary. Never delete those
markers to force a replay. Recover with PostgreSQL backups/PITR or a separately
reviewed reverse-reconciliation plan; a flag flip would lose new writes.

Historical BSON captures are useful for migration verification, not a complete
substitute for independent source backups. Verify normalized data by identity and
content, not only collection counts. Preserve runtime payment receipts even when
a historical source document used a different physical ID.
