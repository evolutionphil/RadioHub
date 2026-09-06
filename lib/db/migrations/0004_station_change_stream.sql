CREATE TABLE IF NOT EXISTS mongo_change_stream_checkpoints (
  stream_name text PRIMARY KEY,
  resume_token jsonb,
  status text NOT NULL DEFAULT 'starting',
  events_processed bigint NOT NULL DEFAULT 0,
  last_event_at timestamptz,
  last_error text,
  owner_id text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mongo_change_stream_checkpoints_status_idx
  ON mongo_change_stream_checkpoints(status, updated_at DESC);

DROP TRIGGER IF EXISTS set_updated_at ON mongo_change_stream_checkpoints;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON mongo_change_stream_checkpoints
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
