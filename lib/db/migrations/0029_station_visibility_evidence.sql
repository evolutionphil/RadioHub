-- Provider flags are evidence, not an automatic public exclusion.
ALTER TABLE stations ADD COLUMN is_list_visible boolean NOT NULL DEFAULT true;
ALTER TABLE stations ADD COLUMN visibility_expires_at timestamptz;
ALTER TABLE stations ADD COLUMN availability_outcome text CHECK (availability_outcome IN ('healthy','failed','inconclusive'));
ALTER TABLE stations ADD COLUMN availability_checked_at timestamptz;
-- Preserve explicit human blocks, but never turn imported false into fake health=true.
UPDATE stations SET is_list_visible=false WHERE last_check_ok=false
  AND manual_edit_fields->>'lastCheckOk'='true';
ALTER TABLE station_stream_health ADD COLUMN stream_fingerprint text;
CREATE INDEX stations_visibility_country_popular_idx ON stations(country,is_list_visible,votes DESC);
CREATE INDEX stations_visibility_expiry_idx ON stations(visibility_expires_at) WHERE is_list_visible=false;
