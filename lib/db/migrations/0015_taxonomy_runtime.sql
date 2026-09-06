CREATE TABLE IF NOT EXISTS genre_counts (
  id text PRIMARY KEY,
  country text NOT NULL,
  slug text NOT NULL,
  count integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (country, slug)
);
CREATE INDEX IF NOT EXISTS genre_counts_country_count_idx ON genre_counts(country, count DESC);

CREATE TABLE IF NOT EXISTS genre_whitelist_overrides (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('slug-add','slug-remove','alias-add','alias-remove')),
  slug text NOT NULL,
  canonical text,
  notes text NOT NULL DEFAULT '',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, slug)
);
CREATE INDEX IF NOT EXISTS genre_whitelist_overrides_canonical_idx ON genre_whitelist_overrides(canonical);

CREATE TABLE IF NOT EXISTS genre_station_counts_runs (
  id text PRIMARY KEY,
  trigger text NOT NULL,
  status text NOT NULL CHECK (status IN ('running','completed','failed')),
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  duration_ms integer,
  total_genres integer NOT NULL DEFAULT 0,
  updated_slugs integer NOT NULL DEFAULT 0,
  error_message text
);
CREATE INDEX IF NOT EXISTS genre_station_counts_runs_started_idx ON genre_station_counts_runs(started_at DESC,id DESC);

CREATE TABLE IF NOT EXISTS genre_whitelist_push_logs (
  id text PRIMARY KEY,
  triggered_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  triggered_by text,
  trigger text NOT NULL,
  affected_slugs text[] NOT NULL DEFAULT '{}',
  sitemap_rebuild jsonb NOT NULL,
  indexnow_sitemap jsonb NOT NULL,
  indexnow_genre_urls jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS genre_whitelist_push_logs_triggered_idx ON genre_whitelist_push_logs(triggered_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS genre_whitelist_push_logs_created_idx ON genre_whitelist_push_logs(created_at);
