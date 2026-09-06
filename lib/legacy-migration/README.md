# Offline legacy import tooling

This package is deliberately outside the API/web production dependency graph.
The running application uses PostgreSQL only. MongoDB is needed here solely to
read the old database once during an explicitly authorized migration.

The guarded automatic entrypoint is `pnpm --filter @workspace/legacy-migration
bootstrap`, packaged separately by `Dockerfile.migration`. It installs the schema,
imports a pristine target from the stopped source primary and verifies completion.
It never replays over PostgreSQL authority. See `docs/POSTGRES_AUTOMATIC_SETUP.md`
for one-time Railway setup and the mandatory real writer-stop/backup conditions.

From a development/operator workspace with dependencies installed:

```sh
pnpm --filter @workspace/legacy-migration migrate
pnpm --filter @workspace/legacy-migration verify
```

All original snapshot safeguards remain mandatory: stop every target writer,
verify the source database identity, retain lossless BSON checksums, and never
replay a snapshot over durable PostgreSQL write authority. Read the repository
PostgreSQL migration runbook before running the command.

The archived Mongoose models, old connection adapter, and catalog CDC code are
retained solely for legacy regression coverage. They are not production fallback
paths and must never be imported by API, web, proxy, or combined entrypoints.
