-- Sticky cutover markers: Mongo snapshots may never replace PostgreSQL-owned data.
-- No application path deletes these markers. Rolling back ownership requires an
-- explicitly reviewed reverse migration, not simply changing an environment flag.
CREATE TABLE database_write_authority (
  domain text PRIMARY KEY,
  authority text NOT NULL CHECK (authority = 'postgres'),
  activated_at timestamptz NOT NULL DEFAULT now()
);
