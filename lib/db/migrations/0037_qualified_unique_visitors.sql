-- A new measurement series: old request/IP records contain crawler and admin
-- traffic, so do not relabel or backfill them as qualified visitors.
CREATE TABLE qualified_visitor_presence (
  ip_address inet PRIMARY KEY,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CHECK (masklen(ip_address)=CASE family(ip_address) WHEN 4 THEN 32 ELSE 128 END)
);
CREATE INDEX qualified_visitor_presence_last_seen_idx ON qualified_visitor_presence(last_seen_at);
INSERT INTO runtime_app_state(key,value)
VALUES ('unique-visitor-metrics:v1',jsonb_build_object('collectionStartedAt',now()))
ON CONFLICT(key) DO NOTHING;
