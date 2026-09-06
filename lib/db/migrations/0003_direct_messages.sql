CREATE TABLE IF NOT EXISTS direct_messages (
  id text PRIMARY KEY,
  from_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content text NOT NULL,
  message_type text NOT NULL DEFAULT 'text',
  image_url text,
  is_read boolean NOT NULL DEFAULT false,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_user_id <> to_user_id),
  CHECK (length(content) <= 2000)
);

CREATE INDEX IF NOT EXISTS direct_messages_conversation_time_idx
  ON direct_messages(from_user_id, to_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS direct_messages_recipient_unread_idx
  ON direct_messages(to_user_id, is_read, created_at DESC);

DROP TRIGGER IF EXISTS set_updated_at ON direct_messages;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON direct_messages
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
