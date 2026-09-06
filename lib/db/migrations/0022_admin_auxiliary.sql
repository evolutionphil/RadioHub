CREATE TABLE admin_preferences (
  id text PRIMARY KEY,admin_username text NOT NULL,key text NOT NULL,value jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(admin_username,key)
);
CREATE TABLE shared_comparison_presets (
  id text PRIMARY KEY,name text NOT NULL CHECK(char_length(btrim(name)) BETWEEN 1 AND 60),
  countries text[] NOT NULL,owner_username text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX shared_comparison_presets_name_uq ON shared_comparison_presets(lower(name));
CREATE INDEX shared_comparison_presets_owner_idx ON shared_comparison_presets(owner_username);
CREATE TABLE semrush_issues (
  id text PRIMARY KEY,url text NOT NULL,status_code integer NOT NULL DEFAULT 0,
  issue_type text NOT NULL,issue_description text NOT NULL DEFAULT '',
  priority text NOT NULL CHECK(priority IN ('High','Medium','Low','Info')),
  imported_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL
);
CREATE INDEX semrush_issues_expiry_idx ON semrush_issues(expires_at);
CREATE INDEX semrush_issues_priority_import_idx ON semrush_issues(priority,imported_at DESC);
CREATE INDEX semrush_issues_type_idx ON semrush_issues(issue_type);
CREATE TABLE analytics_events (
  id text PRIMARY KEY,event text NOT NULL,station_id text,user_id text,session_id text,
  timestamp timestamptz NOT NULL DEFAULT now(),source jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX analytics_events_timestamp_idx ON analytics_events(timestamp DESC);
CREATE INDEX analytics_events_station_idx ON analytics_events(station_id,timestamp DESC);
