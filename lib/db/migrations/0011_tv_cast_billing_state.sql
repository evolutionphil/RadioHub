CREATE TABLE tv_device_codes (
  id text PRIMARY KEY, kind text NOT NULL CHECK (kind IN ('login','subscription')),
  code text NOT NULL CHECK (code ~ '^[0-9]{6}$'), device_id text NOT NULL,
  platform text NOT NULL DEFAULT 'other', status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','activated','completed','expired')),
  user_id text REFERENCES users(id) ON DELETE CASCADE, token text, plan text, stripe_session_id text,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE UNIQUE INDEX tv_device_codes_live_code ON tv_device_codes(kind,code) WHERE status<>'expired';
CREATE UNIQUE INDEX tv_device_codes_pending_device ON tv_device_codes(kind,device_id) WHERE status='pending';
CREATE INDEX tv_device_codes_device_time ON tv_device_codes(kind,device_id,created_at DESC);
CREATE INDEX tv_device_codes_expiry ON tv_device_codes(expires_at);
CREATE TABLE user_devices (
  id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id text NOT NULL, device_name text NOT NULL, platform text NOT NULL DEFAULT 'other',
  is_active boolean NOT NULL DEFAULT true, paired_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,device_id)
);
CREATE INDEX user_devices_owner_seen ON user_devices(user_id,is_active,last_seen_at DESC);
CREATE TABLE cast_sessions (
  id text PRIMARY KEY, session_id text NOT NULL UNIQUE, pairing_code text,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, mobile_device_id text, tv_device_id text,
  status text NOT NULL CHECK (status IN ('waiting_for_pair','paired','active','expired')),
  current_station jsonb, is_playing boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
  paired_at timestamptz, expires_at timestamptz NOT NULL, last_activity_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX cast_sessions_pending_code ON cast_sessions(pairing_code) WHERE status='waiting_for_pair';
CREATE INDEX cast_sessions_owner ON cast_sessions(user_id,status,expires_at);
CREATE INDEX cast_sessions_expiry ON cast_sessions(expires_at);
CREATE TABLE cast_commands (
  id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id text NOT NULL, type text NOT NULL CHECK(type IN ('cast:play','cast:pause','cast:resume','cast:stop')),
  station jsonb, timestamp bigint NOT NULL, consumed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cast_commands_poll ON cast_commands(user_id,device_id,timestamp,id) WHERE consumed=false;
CREATE INDEX cast_commands_expiry ON cast_commands(created_at);
CREATE TABLE cast_now_playing (
  id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id text NOT NULL, platform text NOT NULL DEFAULT 'other', station_name text,
  title text, artist text, is_playing boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,device_id)
);
CREATE TABLE push_tokens (
  id text PRIMARY KEY, token text NOT NULL UNIQUE, user_id text REFERENCES users(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK(platform IN ('ios','android')),
  token_type text NOT NULL CHECK(token_type IN ('expo','apns','fcm')),
  device_name text NOT NULL DEFAULT '',country text NOT NULL DEFAULT '',language text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_tokens_audience ON push_tokens(platform,is_active,country);
CREATE INDEX push_tokens_owner ON push_tokens(user_id);
CREATE TABLE tv_version_config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), id text NOT NULL,
  latest jsonb NOT NULL DEFAULT '{}', minimum jsonb NOT NULL DEFAULT '{}',
  release_notes jsonb NOT NULL DEFAULT '{}', store_url jsonb NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tv_telemetry (
  id text PRIMARY KEY, ts timestamptz NOT NULL DEFAULT now(), src text NOT NULL DEFAULT 'remote',
  v text, plat text NOT NULL DEFAULT 'other', app text, did text, country text
);
CREATE INDEX tv_telemetry_expiry ON tv_telemetry(ts);
CREATE TABLE tv_telemetry_daily (
  id text PRIMARY KEY, day text NOT NULL, plat text NOT NULL DEFAULT 'other',src text NOT NULL DEFAULT 'remote',
  v text NOT NULL DEFAULT '', count bigint NOT NULL DEFAULT 0,
  unique_dids text[] NOT NULL DEFAULT ARRAY[]::text[], updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(day,plat,src,v)
);
CREATE INDEX tv_telemetry_daily_day ON tv_telemetry_daily(day DESC);
CREATE TABLE stripe_subscription_plans (
  id text PRIMARY KEY, plan_id text NOT NULL UNIQUE CHECK(plan_id IN ('remove_ads','premium_monthly','premium_yearly','premium_lifetime')),
  stripe_price_id text NOT NULL DEFAULT '', paddle_price_id text, label text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',currency text NOT NULL DEFAULT 'usd',amount integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE cast_events (
  id bigserial PRIMARY KEY, session_id text NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cast_events_expiry ON cast_events(created_at);
CREATE TABLE cast_connections (
  connection_id text PRIMARY KEY, node_id text NOT NULL, session_id text NOT NULL,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id text, role text NOT NULL CHECK(role IN ('mobile','tv')), expires_at timestamptz NOT NULL
);
CREATE INDEX cast_connections_presence ON cast_connections(session_id,role,expires_at);
CREATE INDEX cast_connections_node ON cast_connections(node_id);
