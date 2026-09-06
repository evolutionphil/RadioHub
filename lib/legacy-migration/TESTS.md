# Offline legacy tooling and retained tests

This workspace is not a production dependency. MongoDB models, BSON codecs,
one-time import/verification and archived change-stream regression tooling live
here. API/web/proxy bundles reject imports of this package at build time.
The API manifest has no direct MongoDB driver, Mongoose or memory-server
dependency, including development dependencies. Fidelity tests import BSON from
this offline package; Mongoose is retained only for archived model regressions.

No legacy assertion was deleted or silently excluded from the default API test
command. `pnpm --filter @workspace/api-server test:legacy` exposes the remaining
historical Mongo-model/mock tests as a separate compatibility lane. Some encode
retired Mongo implementation details and need native dependency mocks; failures
in that lane are not evidence that PostgreSQL runtime behavior was exercised.

Native replacements use real PostgreSQL and HTTP where applicable:

| Domain | Native test files in artifacts/api-server/tests |
| --- | --- |
| Catalog/search/admin stations | postgres-catalog-integration, postgres-public-catalog, postgres-admin-catalog-routes |
| Translations/settings/language seeding | postgres-localization-integration, postgres-localization-routes, postgres-localization-runtime-state |
| Genre whitelist/counts/cleanup | postgres-taxonomy-runtime, postgres-genre-cleanup |
| Coverage/backfills | postgres-coverage-operations |
| SEO sitemaps/IndexNow/GSC | postgres-seo-indexing.integration, postgres-seo-sitemap-routes.integration |
| Content/feedback/log privacy | postgres-content-integration |
| Auth/API access/quota | postgres-core-integration, postgres-api-access-integration, postgres-quota-guard |
| TV/cast/payment | postgres-tv-cast.integration, postgres-billing.integration, postgres-payment-migration-integration |
| Messaging/recommendations | postgres-messages-routes, postgres-recommendation-integration |
| Regions/slugs/maintenance | postgres-discovery-maintenance-integration |

Each file ends in `.test.ts`. Import fidelity/parity remains covered separately by
`postgres-etl-integration`, `postgres-native-migration-integration`,
`postgres-payment-migration-integration`, and `postgres-migration-foundation`.
`postgres-station-cdc` retains the archived CDC/fidelity regression plus the new
PostgreSQL-only counter contract; it does not enable production CDC.

The standard translation coverage tests require `PG_TEST_DATABASE_URL` and use
isolated PostgreSQL schemas. Search-page coverage executes the real multilingual
boot seeder. General-page coverage checks source discovery, SQL round trips and
missing/blank translation diagnostics with explicit synthetic admin fixtures;
it does not certify the translation content of a deployed database.

`postgres-production-boundary.test.ts` enforces the source import boundary,
installed production dependency graph, and build-time fail-closed behavior.
Every server build also checks its complete esbuild input and external-import
graph and writes `dist/production-dependency-report.json`.

Tests exit naturally with an explicit timeout. `--test-force-exit` is avoided
because it can race Windows Node 24 module-mock cleanup and crash libuv.
The standard and PostgreSQL API suites limit file concurrency to four workers
to bound database connections and runner pressure; no tests are excluded.
