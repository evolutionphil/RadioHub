# PostgreSQL-only production cutover gates

Checkpoint: 2026-09-07. The application implementation is PostgreSQL-native.
This is not a record of deployment or migration of customer data.

## Completed locally

- Native SQL persistence covers catalog and provider sync, accounts/sessions,
  localization and automatic/admin translation, billing, TV/cast, recommendations,
  SEO/indexing, coverage/backfill, notifications and administrative operations.
- Mongo/dual-write/CDC runtime modes are rejected. API/web/proxy production
  dependencies exclude MongoDB, Mongoose, connect-mongo and the offline importer;
  build-time and regression checks enforce this boundary.
- One-time source capture, historical BSON/model fixtures and old Mongo operator
  scripts are isolated in `lib/legacy-migration`. They are not runtime fallbacks.
- The complete API suite, native PostgreSQL suite, frontend tests and workspace
  typechecking pass. Exact evidence and limitations are in POSTGRES_VERIFICATION.md.
- All 24 migrations install on a new database and rerun idempotently. A local
  PostgreSQL backup was restored separately and all 89 public tables matched in
  row counts and row-content digests.
- Deployment packaging, PostgreSQL-only readiness, production process smoke
  verification and a CI workflow are provided. CI has not been run remotely.

## Required before admitting production traffic

1. Provision the real PostgreSQL service, credentials/TLS, replica connection
   budgets, monitoring and backup/PITR retention. Measure representative query
   load and capacity; small disposable fixtures do not establish production scale.
2. Back up the actual source independently. Drain all old and destination writers,
   apply the schema, and execute the offline import and identity/content/relation
   verification against a fresh destination **before its first application boot**.
3. Restore a backup of that actual migrated data into a separate database and
   verify it. The completed local restore used fixtures, not customer data or the
   production backup service.
4. Exercise a migrated staging copy with real provider configuration: OAuth,
   payments/webhook redelivery, email/push, storage, radio sync, AI translation,
   SEO integrations and multi-replica jobs. Automated tests use controlled
   substitutes and the production smoke harness intentionally blocks external
   network access.
5. Build/deploy the container images in the target environment, remove source
   credentials/legacy flags, then verify readiness and authenticated/public/worker
   behavior before opening traffic. Docker itself was unavailable locally.
6. Retain the old database read-only until the reconciliation and recovery window
   has passed. Decommission it separately; it has not been deleted by this work.

Follow POSTGRES_MIGRATION_RUNBOOK.md in order. Once PostgreSQL has accepted writes,
do not replay an old source snapshot or switch flags back to MongoDB. Recover from
PostgreSQL backups/PITR or an explicitly reviewed reverse-reconciliation plan.
