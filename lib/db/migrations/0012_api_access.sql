CREATE TABLE IF NOT EXISTS api_developer_users (
  id text PRIMARY KEY, email text NOT NULL, password_hash text NOT NULL,
  name text NOT NULL, company text, website text,
  plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  source jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), last_login_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS api_developer_users_email_uq ON api_developer_users(lower(email));
CREATE INDEX IF NOT EXISTS api_developer_users_created_idx ON api_developer_users(created_at DESC);

CREATE TABLE IF NOT EXISTS api_keys (
  id text PRIMARY KEY, key_hash text NOT NULL UNIQUE, key_prefix text NOT NULL,
  name text NOT NULL, email text NOT NULL, app_name text, app_url text, usage_reason text,
  user_id text REFERENCES api_developer_users(id) ON DELETE CASCADE,
  plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('demo','free','pro','internal')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','expired','suspended')),
  rate_limit_per_min integer NOT NULL DEFAULT 60 CHECK (rate_limit_per_min > 0),
  daily_quota bigint NOT NULL DEFAULT 1000 CHECK (daily_quota >= 0),
  monthly_quota bigint NOT NULL DEFAULT 10000 CHECK (monthly_quota >= 0),
  today_count bigint NOT NULL DEFAULT 0 CHECK (today_count >= 0),
  month_count bigint NOT NULL DEFAULT 0 CHECK (month_count >= 0),
  total_count bigint NOT NULL DEFAULT 0 CHECK (total_count >= 0),
  last_reset_day text, last_reset_month text, last_used_at timestamptz,
  minute_count integer NOT NULL DEFAULT 0 CHECK (minute_count >= 0),
  minute_reset_at timestamptz,
  source jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz
);
CREATE INDEX IF NOT EXISTS api_keys_email_idx ON api_keys(lower(email));
CREATE INDEX IF NOT EXISTS api_keys_user_idx ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS api_keys_plan_status_idx ON api_keys(plan,status);
CREATE INDEX IF NOT EXISTS api_keys_used_idx ON api_keys(last_used_at DESC,created_at DESC);
CREATE INDEX IF NOT EXISTS api_keys_expiry_idx ON api_keys(expires_at) WHERE expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS api_demo_usage (
  id text PRIMARY KEY, ip_hash text NOT NULL UNIQUE, demo_key_hash text NOT NULL,
  last_issued_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
  usage_count bigint NOT NULL DEFAULT 1 CHECK (usage_count >= 0),
  source jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS api_demo_usage_expiry_idx ON api_demo_usage(expires_at);

CREATE TABLE IF NOT EXISTS api_developer_sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES api_developer_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS api_developer_sessions_expiry_idx ON api_developer_sessions(expires_at);
CREATE INDEX IF NOT EXISTS api_developer_sessions_user_idx ON api_developer_sessions(user_id);

CREATE TABLE IF NOT EXISTS auth_event_logs (
  id text PRIMARY KEY, ts timestamptz NOT NULL DEFAULT now(), method text NOT NULL,
  event text NOT NULL, ok boolean NOT NULL, email text, user_id text,
  ip text, user_agent text, message text, detail jsonb,
  source jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS auth_event_logs_ts_idx ON auth_event_logs(ts DESC);
CREATE INDEX IF NOT EXISTS auth_event_logs_method_ts_idx ON auth_event_logs(method,ts DESC);
CREATE INDEX IF NOT EXISTS auth_event_logs_email_ts_idx ON auth_event_logs(email,ts DESC);
CREATE INDEX IF NOT EXISTS auth_event_logs_user_idx ON auth_event_logs(user_id);
