-- Independent, sampled request activity. Never backfill or change unique-IP counters.
CREATE TABLE visitor_activity_subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address inet NOT NULL CHECK (masklen(ip_address)=CASE family(ip_address) WHEN 4 THEN 32 ELSE 128 END),
  traffic_kind text NOT NULL CHECK (traffic_kind IN ('qualified','automated')),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  country_code text CHECK (country_code ~ '^[A-Z]{2}$'),
  channel text NOT NULL CHECK (channel IN ('web','app','tv','unknown')),
  platform text NOT NULL CHECK (platform IN ('web','ios','android','tizen','webos','tvos','androidtv','desktop','unknown')),
  device_type text NOT NULL CHECK (device_type IN ('desktop','mobile','tablet','tv','unknown')),
  os text CHECK (char_length(os)<=64), browser text CHECK (char_length(browser)<=64),
  context_source text NOT NULL CHECK (context_source IN ('client-header','user-agent','unknown')),
  hour_started_at timestamptz NOT NULL DEFAULT date_trunc('hour',now()),
  hour_events integer NOT NULL DEFAULT 1 CHECK (hour_events BETWEEN 1 AND 60),
  UNIQUE(ip_address,traffic_kind)
);
CREATE INDEX visitor_activity_subjects_kind_seen_idx ON visitor_activity_subjects(traffic_kind,last_seen_at DESC,id DESC);
CREATE INDEX visitor_activity_subjects_seen_idx ON visitor_activity_subjects(last_seen_at);

CREATE TABLE visitor_activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid NOT NULL REFERENCES visitor_activity_subjects(id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  path text NOT NULL CHECK (char_length(path) BETWEEN 1 AND 256 AND path LIKE '/%' AND path !~ '[?#]' AND position(chr(92) in path)=0),
  action text NOT NULL CHECK (action IN ('page-view','station-view','play-request','favorite-add','favorite-remove','rating-submit')),
  method text NOT NULL CHECK (method IN ('GET','POST','PUT','PATCH','DELETE')),
  status integer NOT NULL CHECK (status BETWEEN 200 AND 299),
  source text NOT NULL CHECK (source IN ('http','client-pageview')),
  referral_category text NOT NULL CHECK (referral_category IN ('google','search','social','internal','direct-or-unknown','other-referral')),
  automation_status text NOT NULL CHECK (automation_status IN ('unknown','browser-like','automated'))
);
CREATE INDEX visitor_activity_events_subject_time_idx ON visitor_activity_events(subject_id,occurred_at DESC,id DESC);
CREATE INDEX visitor_activity_events_time_idx ON visitor_activity_events(occurred_at);

INSERT INTO runtime_app_state(key,value)
VALUES ('visitor-activity:v1',jsonb_build_object('collectionStartedAt',now()))
ON CONFLICT(key) DO NOTHING;
