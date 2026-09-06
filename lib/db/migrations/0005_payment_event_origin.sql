ALTER TABLE payment_events
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'runtime';

CREATE INDEX IF NOT EXISTS payment_events_origin_time_idx
  ON payment_events(origin, occurred_at DESC);
