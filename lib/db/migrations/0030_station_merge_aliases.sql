-- Keep saved links and client station identifiers valid after a reviewed merge.
-- Slug aliases remain in stations.slug_aliases; this indexed mapping is for IDs/UUIDs.
CREATE TABLE station_merge_aliases (
  alias text PRIMARY KEY,
  station_id text NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(alias) > 0)
);
CREATE INDEX station_merge_aliases_station_idx ON station_merge_aliases(station_id);
