CREATE TABLE indexnow_logs (
  id text PRIMARY KEY, timestamp timestamptz NOT NULL DEFAULT now(), host text NOT NULL,
  url_count integer NOT NULL, status text NOT NULL CHECK(status IN ('success','failed')),
  status_code integer, trigger text NOT NULL, error_message text, sample_urls text[] NOT NULL DEFAULT '{}',
  retry_attempt integer NOT NULL DEFAULT 0, response_time integer, run_date text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX indexnow_logs_timestamp ON indexnow_logs(timestamp DESC);
CREATE INDEX indexnow_logs_host_time ON indexnow_logs(host,timestamp DESC);
CREATE INDEX indexnow_logs_trigger_time ON indexnow_logs(trigger,timestamp DESC);
CREATE TABLE indexnow_submission_urls (
  id text PRIMARY KEY, log_id text NOT NULL UNIQUE REFERENCES indexnow_logs(id) ON DELETE CASCADE,
  timestamp timestamptz NOT NULL,host text NOT NULL,trigger text NOT NULL,urls text[] NOT NULL DEFAULT '{}',
  url_count integer NOT NULL,expires_at timestamptz NOT NULL
);
CREATE INDEX indexnow_submission_urls_expiry ON indexnow_submission_urls(expires_at);
CREATE TABLE sitemap_url_snapshots (
  id text PRIMARY KEY,type text NOT NULL CHECK(type IN ('main','genres','stations')),language text NOT NULL,
  chunk integer NOT NULL DEFAULT 0,urls text[] NOT NULL DEFAULT '{}',url_count integer NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(type,language,chunk)
);
CREATE TABLE sitemap_manifests (
  id text PRIMARY KEY,type text NOT NULL CHECK(type IN ('main','genres','stations')),language text NOT NULL,
  version text NOT NULL,status text NOT NULL CHECK(status IN ('building','active','superseded','failed','retired')),
  qualified_languages_hash text NOT NULL,qualified_languages text[] NOT NULL DEFAULT '{}',chunks jsonb NOT NULL DEFAULT '[]',
  total_urls integer NOT NULL DEFAULT 0,chunk_count integer NOT NULL DEFAULT 0,generated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,error_message text
);
CREATE INDEX sitemap_manifests_read ON sitemap_manifests(type,language,status,generated_at DESC);
CREATE UNIQUE INDEX sitemap_manifests_one_build ON sitemap_manifests(type,language) WHERE status='building';
CREATE UNIQUE INDEX sitemap_manifests_one_active ON sitemap_manifests(type,language) WHERE status='active';
CREATE INDEX sitemap_manifests_expiry ON sitemap_manifests(expires_at) WHERE status<>'active';
CREATE TABLE gsc_url_inspections (
  id text PRIMARY KEY,url text NOT NULL UNIQUE,language text NOT NULL,url_group text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('indexed','crawled-not-indexed','discovered-not-indexed','excluded','error','unknown','pending')),
  coverage_state text,verdict text,robots_txt_state text,indexing_state text,page_fetch_state text,last_crawl_time timestamptz,
  google_canonical text,user_canonical text,inspection_result_link text,last_inspected_at timestamptz,last_error text,
  error_count integer NOT NULL DEFAULT 0,discovered_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
  not_indexed_since timestamptz,last_resubmit_at timestamptz,last_resubmit_status text,last_resubmit_error text,
  resubmit_count integer NOT NULL DEFAULT 0,inspection_lease_token text,inspection_lease_until timestamptz,
  resubmit_lease_token text,resubmit_lease_until timestamptz
);
CREATE INDEX gsc_url_inspections_group_state ON gsc_url_inspections(language,url_group,state);
CREATE INDEX gsc_url_inspections_rotation ON gsc_url_inspections(last_inspected_at NULLS FIRST,discovered_at DESC,id);
CREATE INDEX gsc_url_inspections_stuck ON gsc_url_inspections(state,not_indexed_since,last_resubmit_at);
CREATE INDEX gsc_url_inspections_url_prefix ON gsc_url_inspections(url text_pattern_ops);
CREATE TABLE gsc_indexing_snapshots (
  id text PRIMARY KEY,date timestamptz NOT NULL,language text NOT NULL,url_group text NOT NULL,
  total integer NOT NULL DEFAULT 0,indexed integer NOT NULL DEFAULT 0,crawled_not_indexed integer NOT NULL DEFAULT 0,
  discovered_not_indexed integer NOT NULL DEFAULT 0,excluded integer NOT NULL DEFAULT 0,error integer NOT NULL DEFAULT 0,
  pending integer NOT NULL DEFAULT 0,unknown integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(date,language,url_group)
);
CREATE INDEX gsc_indexing_snapshots_date ON gsc_indexing_snapshots(date DESC);
CREATE TABLE gsc_oauth_tokens (
  id text PRIMARY KEY,refresh_token text NOT NULL,access_token text,expiry_date bigint,
  scope text NOT NULL DEFAULT 'https://www.googleapis.com/auth/webmasters.readonly',connected_email text,
  created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gsc_oauth_tokens_created ON gsc_oauth_tokens(created_at DESC);
-- Runtime-only quota ledger: reserve attempts before leaving the transaction so
-- concurrent workers and process crashes cannot exceed the daily property quota.
CREATE TABLE gsc_inspection_quota (
  day date NOT NULL,site_url text NOT NULL,requests integer NOT NULL DEFAULT 0,PRIMARY KEY(day,site_url)
);
CREATE TABLE gsc_oauth_states (
  state_hash text PRIMARY KEY,session_id text NOT NULL,expires_at timestamptz NOT NULL
);
CREATE INDEX gsc_oauth_states_expiry ON gsc_oauth_states(expires_at);
