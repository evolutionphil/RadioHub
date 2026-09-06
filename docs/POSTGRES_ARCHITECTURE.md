# PostgreSQL application architecture

Implementation checkpoint: 2026-09-07. The application has one PostgreSQL write authority,
not dual writes, a MongoDB compatibility server, or a background Mongo-to-SQL sync.
See POSTGRES_VERIFICATION.md for what has actually been exercised.

## Runtime contract

API and web startup require PostgreSQL, validate the required native tables, and
record durable write-authority markers before serving application requests.
Express sessions and bearer tokens are PostgreSQL-backed. Health/readiness checks
probe PostgreSQL; no Mongo connection is required by the entrypoint code.

Legacy domain selection flags may be omitted; if supplied they must be
`postgres`. Shadow/dual/Mongo values and `STATION_CDC_ENABLED=true` are rejected.
Do not deploy a mixture of old Mongo-writing and new PostgreSQL-writing workers.

## Persistence

- Catalog: canonical station columns and ordered `station_genres` relations,
  country/language/genre tables, SQL filtering/grouping/pagination, transactional
  admin edits/imports/merges/blacklists and provider synchronization.
- Accounts: users, tokens, SQL sessions, favorites, follows, ratings, history,
  notifications and direct messages. Counters derive from or update relational
  data inside transactions.
- Localization: keys, values, languages, metadata/version, localized URLs,
  country-language mappings and audit history. Translation sync reads/writes SQL;
  it is not replication from MongoDB.
- Billing and TV: normalized subscriptions, durable provider receipt ledger,
  plans, one-time device codes, cast sessions/commands/presence/outbox and telemetry.
- Operations: API keys/developer sessions/quotas, recommendation profiles,
  settings/history/preferences, coverage/backfill state, SEO manifests, IndexNow,
  GSC, application logs, feedback and shared comparison presets.

JSONB remains for flexible fields (multilingual descriptions, logo metadata,
preferences and provider metadata). This is native PostgreSQL storage, not a
MongoDB runtime dependency. Canonical SQL columns override retained source JSON.
Opaque existing public IDs are preserved as text; new IDs do not require ObjectId.

Redis, when configured, is only a cache. Images remain in the configured object
storage/filesystem and audio is streamed from station providers; “PostgreSQL-only”
describes application database persistence, not moving audio/image binaries into SQL.

## Concurrency and failure

SQL transactions protect related mutations. Provider sync elects a leader;
every provider-write transaction holds/checks the durable run row, preventing a
replaced or cancelled worker from continuing to write. Progress cannot revive a
terminal run. Inserts also consult the current blacklist under transaction locks.
Logo workers claim a station's exact expected URL and use compare-and-swap
completion so stale workers cannot replace a newer image. Billing receipt and
entitlement updates commit together. Cast commands are claimed atomically;
cross-worker delivery uses SQL events and presence state.

Coordination sessions have their own bounded connection pool, so a held job lock
or cast listener cannot exhaust the data-query pool. Translation sync and sitemap
snapshot mutations use the same backend session that holds their leadership lock;
loss of that backend cannot authorize writes through a replacement connection.

Admin snapshot replacement keeps IDs for surviving station UUIDs, preserving
their relations, and rolls back the whole replacement on invalid input. Duplicate
merges blacklist/deallocate losers in the same transaction while moving favorites,
ratings and listening history to the survivor.

## One-time migration boundary

The source capture and normalization tools live in the separate
`@workspace/legacy-migration` operator workspace, outside production dependencies.
All four server build graphs and flat production package dependencies are checked
for Mongo drivers and legacy imports. Their purpose is a stopped-writer import before startup, not a
production compatibility layer. Strict BSON captures/checksums and migration
checkpoints are historical evidence stored in PostgreSQL. After PostgreSQL starts
accepting writes, authority markers prohibit replay/pruning from an old source.

No production deployment, migration execution against customer data, production
backup restoration drill or production load test has been performed. A separate
local PostgreSQL fixture backup/restore was verified; see POSTGRES_VERIFICATION.md.
