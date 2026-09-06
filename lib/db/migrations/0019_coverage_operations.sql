CREATE TABLE IF NOT EXISTS coverage_snapshots (
  id text PRIMARY KEY, country_code text NOT NULL, snapshot_date timestamptz NOT NULL,
  total integer NOT NULL DEFAULT 0, with_logo integer NOT NULL DEFAULT 0, with_tags integer NOT NULL DEFAULT 0,
  logo_coverage_pct double precision NOT NULL DEFAULT 0, tag_coverage_pct double precision NOT NULL DEFAULT 0,
  source text CHECK(source IN ('cron','backfill')), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(country_code,snapshot_date)
);
CREATE INDEX IF NOT EXISTS coverage_snapshots_date_idx ON coverage_snapshots(snapshot_date DESC);

CREATE TABLE IF NOT EXISTS coverage_backfill_status (
  id text PRIMARY KEY, key text NOT NULL UNIQUE DEFAULT 'latest', outcome text NOT NULL,
  message text NOT NULL, observed_at timestamptz NOT NULL, started_at timestamptz, finished_at timestamptz,
  duration_ms double precision, threshold_days integer, historical_day_count integer, seed_days integer,
  days_seeded integer, inserted integer, preserved integer, error text, updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(outcome IN ('skipped-env','skipped-already-seeded','skipped-count-error','running','done','done-no-stations','failed'))
);
CREATE TABLE IF NOT EXISTS coverage_backfill_runs (
  id text PRIMARY KEY, outcome text NOT NULL, message text NOT NULL, observed_at timestamptz NOT NULL,
  started_at timestamptz, finished_at timestamptz, duration_ms double precision, threshold_days integer,
  historical_day_count integer, seed_days integer, days_seeded integer, inserted integer, preserved integer,
  error text, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(outcome IN ('skipped-env','skipped-already-seeded','skipped-count-error','running','done','done-no-stations','failed'))
);
CREATE INDEX IF NOT EXISTS coverage_backfill_runs_observed_idx ON coverage_backfill_runs(observed_at DESC,id DESC);

CREATE TABLE IF NOT EXISTS backfill_runs (
  id text PRIMARY KEY, trigger text NOT NULL, status text NOT NULL CHECK(status IN ('running','completed','failed')),
  top_n integer NOT NULL DEFAULT 5, override_country text, started_at timestamptz NOT NULL,
  finished_at timestamptz, duration_ms double precision, logos jsonb NOT NULL DEFAULT '[]'::jsonb,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb, error_message text, attempts jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS backfill_runs_started_idx ON backfill_runs(started_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS backfill_runs_status_idx ON backfill_runs(status,started_at DESC);
