-- radiohub:concurrent-index
-- Preserve standalone legacy genre matches without decompressing every
-- station's archived multilingual source on each public discovery request.
CREATE INDEX CONCURRENTLY stations_source_genre_trgm_idx ON stations USING gin ((lower(source->>'genre')) gin_trgm_ops);
