-- Bounded, resumable health work; station and user data are never deleted.
CREATE TABLE station_stream_health (
  station_id text PRIMARY KEY REFERENCES stations(id) ON DELETE CASCADE,
  next_check_at timestamptz NOT NULL DEFAULT now(),
  lease_token text,
  lease_until timestamptz,
  stream_url text,
  checked_at timestamptz,
  outcome text CHECK (outcome IN ('healthy','failed','inconclusive')),
  failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count BETWEEN 0 AND 2),
  first_failure_at timestamptz,
  reason text,
  bytes_read integer NOT NULL DEFAULT 0
);
CREATE INDEX station_stream_health_due_idx ON station_stream_health(next_check_at,station_id);
CREATE TABLE station_stream_health_control (
  id integer PRIMARY KEY CHECK (id=1),
  next_run_at timestamptz NOT NULL DEFAULT now(),
  last_run_at timestamptz,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb
);
INSERT INTO station_stream_health_control(id) VALUES(1);
