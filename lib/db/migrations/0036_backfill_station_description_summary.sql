-- Separate migration/transaction from trigger installation: the one-time JSON
-- scan must not hold a DDL lock on stations. A concurrently updated row already
-- has a newer trigger-written summary; never overwrite it with this snapshot.
-- KEY SHARE permits concurrent description updates, while a concurrent delete
-- waits until its summary exists and can cascade it. Never resurrect an orphan.
SET LOCAL lock_timeout = '5s';
WITH candidates AS MATERIALIZED (
  SELECT s.id,s.descriptions FROM stations s
  WHERE NOT EXISTS(SELECT 1 FROM station_description_summary d WHERE d.station_id=s.id)
  ORDER BY s.id FOR KEY SHARE OF s
)
INSERT INTO station_description_summary(station_id,full_mask,meta_mask,language_check_needed)
SELECT s.id,v.full_mask,v.meta_mask,v.language_check_needed FROM candidates s
CROSS JOIN LATERAL station_description_summary_values(s.descriptions) v
ON CONFLICT(station_id) DO NOTHING;
