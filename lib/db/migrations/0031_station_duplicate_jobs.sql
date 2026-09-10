-- Durable, bounded duplicate previews/merges. No automatic merge runs at deploy.
CREATE TABLE station_duplicate_jobs (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('preview','manual','automatic')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed')),
  phase text NOT NULL DEFAULT 'scan' CHECK (phase IN ('scan','evaluate')),
  threshold real NOT NULL DEFAULT 0.85,
  preview_job_id text REFERENCES station_duplicate_jobs(id),
  total_groups integer NOT NULL DEFAULT 0,
  groups_processed integer NOT NULL DEFAULT 0,
  eligible_groups integer NOT NULL DEFAULT 0,
  skipped_groups integer NOT NULL DEFAULT 0,
  merged_groups integer NOT NULL DEFAULT 0,
  stations_to_delete integer NOT NULL DEFAULT 0,
  stations_deleted integer NOT NULL DEFAULT 0,
  merged_stations jsonb NOT NULL DEFAULT '[]',
  errors jsonb NOT NULL DEFAULT '[]',
  skipped_reasons jsonb NOT NULL DEFAULT '{}',
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE(preview_job_id)
);
CREATE INDEX station_duplicate_jobs_active_idx ON station_duplicate_jobs(created_at)
  WHERE status IN ('queued','running');
CREATE INDEX station_duplicate_jobs_kind_created_idx ON station_duplicate_jobs(kind,created_at DESC);
CREATE TABLE station_duplicate_job_groups (
  job_id text NOT NULL REFERENCES station_duplicate_jobs(id) ON DELETE CASCADE,
  ordinal integer NOT NULL,
  station_ids text[] NOT NULL,
  station_count integer NOT NULL,
  group_name text NOT NULL,
  country text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','eligible','skipped','merged')),
  reason text,
  attempts integer NOT NULL DEFAULT 0,
  PRIMARY KEY(job_id,ordinal)
);
CREATE INDEX station_duplicate_groups_pending_idx ON station_duplicate_job_groups(job_id,ordinal) WHERE status='pending';
CREATE TABLE station_duplicate_merge_control (
  id integer PRIMARY KEY CHECK (id=1),
  next_auto_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',
  next_cycle_at timestamptz NOT NULL DEFAULT now(),
  last_run_at timestamptz,
  lease_owner text,
  lease_until timestamptz,
  summary jsonb NOT NULL DEFAULT '{}'
);
INSERT INTO station_duplicate_merge_control(id) VALUES(1);
