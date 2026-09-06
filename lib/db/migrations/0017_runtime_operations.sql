CREATE TABLE visitor_sessions (
  id text PRIMARY KEY,
  ip_address text NOT NULL UNIQUE,
  last_active_date timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_agent text,
  visit_count bigint NOT NULL DEFAULT 1 CHECK (visit_count >= 0)
);
CREATE INDEX visitor_sessions_active_idx ON visitor_sessions(last_active_date);
CREATE INDEX visitor_sessions_created_idx ON visitor_sessions(created_at);

CREATE TABLE runtime_app_state (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bulk_description_jobs (
  id text PRIMARY KEY, job_id text NOT NULL UNIQUE, filter_by_country text,
  status text NOT NULL DEFAULT 'running' CHECK(status IN ('running','paused','completed','failed')),
  total_stations integer NOT NULL, processed_stations integer NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0, failed_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0, last_processed_station_id text,
  last_processed_skip integer NOT NULL DEFAULT 0, error_message text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bulk_description_jobs_status_created_idx ON bulk_description_jobs(status,created_at DESC);
