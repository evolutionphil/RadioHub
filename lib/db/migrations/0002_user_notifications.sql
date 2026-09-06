CREATE TABLE IF NOT EXISTS user_notifications (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_user_id text REFERENCES users(id) ON DELETE SET NULL,
  type text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_read boolean NOT NULL DEFAULT false,
  read_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_notifications_user_created_idx
  ON user_notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_notifications_user_unread_idx
  ON user_notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS user_notifications_expiry_idx
  ON user_notifications(expires_at) WHERE expires_at IS NOT NULL;

DROP TRIGGER IF EXISTS set_updated_at ON user_notifications;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON user_notifications
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
