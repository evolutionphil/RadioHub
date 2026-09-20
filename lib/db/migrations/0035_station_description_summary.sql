-- Small, transactional projection: admin filtering must not repeatedly detoast
-- every full multilingual article. Bit order is the universal14 contract.
SET LOCAL lock_timeout = '5s';
CREATE TABLE station_description_summary (
  station_id text PRIMARY KEY REFERENCES stations(id) ON UPDATE CASCADE ON DELETE CASCADE,
  full_mask integer NOT NULL,
  meta_mask integer NOT NULL,
  language_check_needed boolean NOT NULL DEFAULT false
);

CREATE FUNCTION station_description_summary_values(descriptions jsonb)
RETURNS TABLE(full_mask integer,meta_mask integer,language_check_needed boolean)
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  WITH entries AS MATERIALIZED (
    SELECT d.key,d.value,(1 << (l.ordinality::integer-1)) AS bit,
      CASE WHEN jsonb_typeof(d.value->'full')='string' THEN d.value->>'full' ELSE '' END AS full_text,
      CASE WHEN jsonb_typeof(d.value->'meta')='string' THEN d.value->>'meta' ELSE '' END AS meta_text
    FROM jsonb_each(CASE WHEN jsonb_typeof(descriptions)='object' THEN descriptions ELSE '{}'::jsonb END) d
    JOIN unnest(ARRAY['en','es','fr','de','pt','it','ru','ar','zh','tr','ja','ko','hi','he']) WITH ORDINALITY l(language,ordinality)
      ON l.language=d.key
  ), checked AS (
    SELECT *, CASE key WHEN 'ru' THEN '[Ѐ-ӿ]' WHEN 'ar' THEN '[؀-ۿ]'
      WHEN 'zh' THEN '[㐀-鿿]' WHEN 'ja' THEN '[぀-ヿ㐀-鿿]'
      WHEN 'ko' THEN '[ᄀ-ᇿ가-힯]' WHEN 'hi' THEN '[ऀ-ॿ]' WHEN 'he' THEN '[֐-׿]' END AS script
    FROM entries
  ) SELECT
    COALESCE(sum(bit) FILTER (WHERE full_text ~ E'[^\\u0009-\\u000D\\u0020\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]'),0)::integer,
    COALESCE(sum(bit) FILTER (WHERE meta_text ~ E'[^\\u0009-\\u000D\\u0020\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]'),0)::integer,
    COALESCE(bool_or(script IS NOT NULL AND
      ((length(full_text)>24 AND length(regexp_replace(full_text,'[^'||substring(script from 2 for length(script)-2)||']','','g'))<24)
        OR (length(meta_text)>24 AND length(regexp_replace(meta_text,'[^'||substring(script from 2 for length(script)-2)||']','','g'))<24))),false)
      OR EXISTS(SELECT 1 FROM entries WHERE length(full_text)>80
        GROUP BY lower(regexp_replace(full_text,'[[:space:]]+',' ','g')) HAVING count(*)>1)
    FROM checked;
$$;

CREATE FUNCTION maintain_station_description_summary() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO station_description_summary(station_id,full_mask,meta_mask,language_check_needed)
    SELECT NEW.id,v.full_mask,v.meta_mask,v.language_check_needed FROM station_description_summary_values(NEW.descriptions) v
    ON CONFLICT(station_id) DO UPDATE SET full_mask=EXCLUDED.full_mask,meta_mask=EXCLUDED.meta_mask,
      language_check_needed=EXCLUDED.language_check_needed;
  RETURN NEW;
END;
$$;
CREATE TRIGGER station_description_summary_insert AFTER INSERT ON stations
  FOR EACH ROW EXECUTE FUNCTION maintain_station_description_summary();
CREATE TRIGGER station_description_summary_update AFTER UPDATE OF descriptions ON stations
  FOR EACH ROW WHEN (OLD.descriptions IS DISTINCT FROM NEW.descriptions)
  EXECUTE FUNCTION maintain_station_description_summary();
CREATE INDEX station_description_summary_gaps_idx ON station_description_summary(station_id)
  WHERE (full_mask & meta_mask)<>16383 OR language_check_needed;
ALTER TABLE bulk_description_jobs ADD COLUMN publish_status text;
