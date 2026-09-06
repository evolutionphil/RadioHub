CREATE TABLE IF NOT EXISTS genre_slug_cleanup_runs (
  id text PRIMARY KEY, trigger text NOT NULL, status text NOT NULL CHECK(status IN ('running','completed','failed')),
  started_at timestamptz NOT NULL, finished_at timestamptz, duration_ms double precision,
  scanned integer NOT NULL DEFAULT 0, already_valid integer NOT NULL DEFAULT 0,
  normalized integer NOT NULL DEFAULT 0, marked_undiscoverable integer NOT NULL DEFAULT 0,
  empty_slug_marked integer NOT NULL DEFAULT 0, collision_marked integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0, rewarmed boolean NOT NULL DEFAULT false, error_message text
);
CREATE INDEX IF NOT EXISTS genre_slug_cleanup_runs_started_idx ON genre_slug_cleanup_runs(started_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS genre_slug_cleanup_runs_status_idx ON genre_slug_cleanup_runs(status,started_at DESC);

-- Hidden legacy collision losers have no public slug. Never drop slug uniqueness.
ALTER TABLE genres ALTER COLUMN slug DROP NOT NULL;
ALTER TABLE genres ADD CONSTRAINT genres_discoverable_slug_check CHECK(slug IS NOT NULL OR is_discoverable=false);
