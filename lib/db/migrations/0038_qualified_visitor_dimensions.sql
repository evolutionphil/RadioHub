-- Latest observed context per unique IP. Existing rows remain unknown: neither
-- browser/device guesses nor geographical history can be reconstructed safely.
ALTER TABLE qualified_visitor_presence
  ADD COLUMN country_code text CHECK (country_code ~ '^[A-Z]{2}$'),
  ADD COLUMN channel text NOT NULL DEFAULT 'unknown'
    CHECK (channel IN ('web','app','tv','unknown')),
  ADD COLUMN platform text NOT NULL DEFAULT 'unknown'
    CHECK (platform IN ('web','ios','android','tizen','webos','tvos','androidtv','desktop','unknown')),
  ADD COLUMN device_type text NOT NULL DEFAULT 'unknown'
    CHECK (device_type IN ('desktop','mobile','tablet','tv','unknown')),
  ADD COLUMN os text CHECK (char_length(os)<=64),
  ADD COLUMN browser text CHECK (char_length(browser)<=64),
  ADD COLUMN context_source text NOT NULL DEFAULT 'unknown'
    CHECK (context_source IN ('client-header','user-agent','unknown')),
  ADD COLUMN context_collected_at timestamptz;

INSERT INTO runtime_app_state(key,value)
VALUES ('unique-visitor-details:v1',jsonb_build_object('dimensionsStartedAt',now()))
ON CONFLICT(key) DO NOTHING;
