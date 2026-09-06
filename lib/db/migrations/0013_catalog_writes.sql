CREATE TABLE catalog_sync_runs (
  id text PRIMARY KEY,
  sync_type text NOT NULL CHECK (sync_type IN ('full','incremental')),
  status text NOT NULL CHECK (status IN ('running','completed','failed','stopped')),
  counters jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  cancel_requested boolean NOT NULL DEFAULT false
);
CREATE INDEX catalog_sync_runs_started_idx ON catalog_sync_runs(started_at DESC);
CREATE TABLE station_blacklist (
  id text PRIMARY KEY,
  station_uuid text,
  url text NOT NULL,
  name text NOT NULL,
  reason text,
  deleted_by text,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  source jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX station_blacklist_uuid_idx ON station_blacklist(station_uuid);
CREATE INDEX station_blacklist_url_idx ON station_blacklist(url);
CREATE INDEX stations_content_key_idx ON stations(name,url,country_code);
CREATE INDEX stations_source_gin_idx ON stations USING gin(source jsonb_path_ops);
