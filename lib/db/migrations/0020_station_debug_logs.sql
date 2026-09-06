-- Playback diagnostics may refer to deleted or unknown stations, so station_id is not a foreign key.
CREATE TABLE station_debug_logs (
  id text PRIMARY KEY,
  station_id text NOT NULL,
  station_name text NOT NULL,
  station_url text NOT NULL,
  error_type text NOT NULL CHECK(error_type IN ('AUDIO_ERROR','CONNECTION_TIMEOUT','STREAM_UNAVAILABLE','CODEC_UNSUPPORTED','CORS_ERROR','NETWORK_ERROR')),
  error_message text NOT NULL,
  error_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  station_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  user_agent text,
  client_ip text,
  timestamp timestamptz NOT NULL DEFAULT now(),
  is_resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  resolved_by text,
  notes text,
  reporting_users jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(reporting_users)='array'),
  unique_user_count integer NOT NULL DEFAULT 1 CHECK(unique_user_count >= 0),
  total_occurrences integer NOT NULL DEFAULT 1 CHECK(total_occurrences >= 0),
  server_logs text[] NOT NULL DEFAULT '{}'::text[]
);
CREATE INDEX station_debug_logs_group_time ON station_debug_logs(station_id,error_type,timestamp DESC);
CREATE INDEX station_debug_logs_time ON station_debug_logs(timestamp DESC);
CREATE INDEX station_debug_logs_error_time ON station_debug_logs(error_type,timestamp DESC);
CREATE INDEX station_debug_logs_resolved_time ON station_debug_logs(is_resolved,timestamp DESC);
