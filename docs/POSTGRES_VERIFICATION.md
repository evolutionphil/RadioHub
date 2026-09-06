# PostgreSQL verification report

Date: 2026-09-07. Local implementation and verification are complete. No production
database was migrated, deleted or switched, and no production deployment occurred.

## Final local evidence

Environment: Windows, Node 24.16, pnpm 11.19 and PostgreSQL 17.11. SQL tests ran on
an explicitly disposable, loopback-only cluster with isolated per-suite schemas.

| Check | Result |
| --- | --- |
| Complete API suite (`tests/**/*.test.ts`) | 829 passed, 0 failed, 0 skipped |
| PostgreSQL-specific suite (`tests/postgres*.test.ts`) | 307 passed, 0 failed, 0 skipped |
| Frontend suite | 40 passed |
| Additional SEO soft-404 suite | 19 passed |
| Workspace typecheck and offline importer typecheck | Passed |
| Frozen dependency installation | Passed |
| Fresh schema installation and repeat runner | All 24 migrations; unchanged files skipped |
| Schema/constraint verification | Passed, including final rerun |
| Local custom-format backup and separate restore | All 89 public tables matched counts and row-content digests |
| API + frontend installed production dependency graph | 387 packages, 0 Mongo dependencies |
| Each flat API/web production package | 377 packages, 0 Mongo dependencies |
| Real packaged API/web production smoke | 10 checks passed, no external egress |

The PostgreSQL suite is a subset of the complete API suite, not an additional 307
unique tests. Tests exit naturally without forced process termination.

Final runs use `--test-concurrency=4`, also configured in the two API test scripts,
to bound test-worker and SQL-connection pressure. One earlier full run at default
parallelism hit a Node test-runner IPC deserialization error with no assertion
failure; its sitemap tests passed independently and the complete bounded rerun
passed. The exact cause of that runner-level error was not established.

All four final server builds passed the import/dependency boundary: proxy 250,
API 2608, web 1187 and unified 2609 input modules. Each reported zero Mongo inputs
or dependencies. The final local default `dist/index.mjs` is the unified build.
The frontend production build also passed (4737 modules). Existing frontend
bundle-size/sourcemap/asset warnings and test-fixture queryFn warnings remain;
these results are not a claim of a warning-free frontend.

The production smoke harness launches freshly packaged API/web processes with
`NODE_ENV=production`, PostgreSQL, no Mongo installation or credentials, optional
provider credentials omitted, and scheduled jobs disabled. It checks API/web
health and readiness, a real SQL station through the API, the web API proxy,
web-local SQL SEO rendering, admin SPA HTML/JavaScript delivery and zero external
network access. It removes its fixture and terminates its own child processes.
This does not certify real OAuth/payment/provider connections or load capacity.

## Important SQL behavior exercised

- Catalog/admin transactions, rollback, duplicate merge relations, snapshot ID
  preservation, current blacklists and SQL pagination/filtering.
- Provider run fencing on replacement/cancellation, monotonic terminal progress,
  manual-field protection and stale logo-worker compare-and-swap rejection.
- Translation leadership loss, source-language/key races, concurrent human edits,
  deleted-row protection, empty/invalid AI output, retry behavior and atomic
  translation/version commits. Boot seeds preserve existing human translations.
- Data-query pool availability while coordination locks are held, including a
  data pool of one connection; real backend termination tests cover stale leaders.
- Sessions/account revalidation, API quotas, payment replay/revocation, one-time
  TV codes, cast queue claims/cross-worker delivery, coverage and maintenance jobs.
- SEO canonical redirects, XML/304/410 responses, metadata, indexing snapshots
  and SQL query deadlines without leaking timeout settings to pooled connections.
- Offline import identity/content/BSON fidelity and recovery-authority guards.

Search translation coverage runs the real multilingual seed. General-page
coverage uses explicitly synthetic translations to test source discovery and
missing/blank diagnostics; it does not certify deployed translation content.

## Reproduce

Use an explicitly disposable database, never production:

```powershell
$env:PG_TEST_DATABASE_URL='postgresql://test_user@127.0.0.1:55437/test_database'
$env:NODE_ENV='development'
pnpm --config.verify-deps-before-run=false --filter @workspace/api-server run test
pnpm --config.verify-deps-before-run=false --filter @workspace/api-server run test:postgres-migration
pnpm --config.verify-deps-before-run=false --filter @workspace/megaradio run test
pnpm --config.verify-deps-before-run=false run typecheck
```

The pnpm option prevents its implicit pre-run install from changing the installed
verification environment; first install with `pnpm install --frozen-lockfile`.
Do not use `--test-force-exit` in this Windows Node 24 environment: it caused a
native shutdown crash. Missing-database skips are not certification.

The `.github/workflows/postgres-migration.yml` workflow reproduces schema checks,
test suites, builds, flat production packaging and the guarded process smoke on
Linux. The smoke command is
`node artifacts/api-server/scripts/verify-postgres-production.mjs --api-dir=<flat-api-package> --web-dir=<flat-web-package>`;
it requires `POSTGRES_PRODUCTION_SMOKE=true` and a loopback disposable
`PG_TEST_DATABASE_URL`. API packaging includes the frontend source tree needed by
translation scanning, SPA assets, the schema runner and migration files.

## Not certified by local work

Actual customer-data import/parity, deployed translation completeness, production
backup/PITR configuration and restore, real external-provider behavior, realistic
load, or production deployment. Docker was unavailable, so Linux container images
were not built locally; the CI workflow has not been executed remotely.

Mongo source tooling remains only in the isolated offline operator/test workspace,
not in the application runtime or production package. PostgreSQL JSONB and opaque
historical IDs are native data representations, not a Mongo compatibility server.
See POSTGRES_REMAINING_WORK.md and POSTGRES_MIGRATION_RUNBOOK.md before cutover.
