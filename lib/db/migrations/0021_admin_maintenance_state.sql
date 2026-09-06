-- Runtime-only jobs: never import or prune these from a legacy snapshot.
CREATE TABLE admin_maintenance_jobs (
  id text PRIMARY KEY,kind text NOT NULL CHECK(kind IN ('slug','optimization','health_check')),
  status text NOT NULL DEFAULT 'running' CHECK(status IN ('running','completed','failed','stopped')),
  owner_token text NOT NULL,payload jsonb NOT NULL DEFAULT '{}',
  started_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,lease_until timestamptz NOT NULL DEFAULT now()+interval '2 minutes'
);
CREATE UNIQUE INDEX admin_maintenance_one_active_kind ON admin_maintenance_jobs(kind) WHERE status='running';
CREATE INDEX admin_maintenance_recent ON admin_maintenance_jobs(kind,started_at DESC);
