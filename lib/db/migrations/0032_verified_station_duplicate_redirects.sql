-- Three individually reviewed duplicate identities from the GSC 404 report.
-- No merge/delete/un-noindex: retain every station, alias, favorite and rating.
-- The migration runner supplies the transaction and cross-replica advisory lock.
DO $repair$
DECLARE
  pair record;
  source_station stations%ROWTYPE;
  target_station stations%ROWTYPE;
  audit_key constant text := 'verifiedSeoRedirectRepair20260916';
BEGIN
  -- Lock the complete, exact six-row set in a stable order before any changes.
  PERFORM id FROM stations
  WHERE id = ANY(ARRAY[
    '68a8c48bbd66579311ab46df', '68a8c48bbd66579311ab46de',
    '68a8c495bd66579311ab5b29', '68a8c49bbd66579311ab6e32',
    '68a8c49bbd66579311ab6b5b', '68a8c4a8bd66579311ab8a92'
  ]::text[])
  ORDER BY id FOR UPDATE;

  FOR pair IN SELECT * FROM (VALUES
    ('68a8c48bbd66579311ab46df', 'radio-gaga-1', 'Rádió Gaga',
     '68a8c48bbd66579311ab46de', 'radio-gaga', 'Radio Gaga',
     'Romania', 'RO', 'http://rc.radiogaga.ro:8000/live'),
    ('68a8c495bd66579311ab5b29', 'radio-fm-4', 'RÁDIO_FM',
     '68a8c49bbd66579311ab6e32', 'sro4-radio-fm', 'SRo4 Rádio FM',
     'Slovakia', 'SK', 'http://live.slovakradio.sk:8000/FM_256.mp3'),
    ('68a8c49bbd66579311ab6b5b', 'smooth-1', 'smooth',
     '68a8c4a8bd66579311ab8a92', 'radio-jazz-smooth', 'Радио Jazz Smooth',
     'The Russian Federation', 'RU', 'http://jfm1.hostingradio.ru:14536/sjstream.mp3')
  ) AS reviewed(source_id, source_slug, source_name, target_id, target_slug, target_name,
                expected_country, expected_country_code, expected_stream)
  LOOP
    SELECT * INTO source_station FROM stations WHERE id = pair.source_id;
    SELECT * INTO target_station FROM stations WHERE id = pair.target_id;

    IF source_station.id IS NULL OR target_station.id IS NULL THEN
      RAISE NOTICE '[seo redirect repair] skipped %: source or target is absent', pair.source_slug;
      CONTINUE;
    END IF;
    -- Never replace prior repair metadata (including after an intervening edit).
    IF source_station.source ? audit_key THEN
      RAISE NOTICE '[seo redirect repair] skipped %: prior audit marker exists', pair.source_slug;
      CONTINUE;
    END IF;
    IF source_station.slug IS DISTINCT FROM pair.source_slug
       OR source_station.name IS DISTINCT FROM pair.source_name
       OR target_station.slug IS DISTINCT FROM pair.target_slug
       OR target_station.name IS DISTINCT FROM pair.target_name
       OR source_station.country IS DISTINCT FROM pair.expected_country
       OR target_station.country IS DISTINCT FROM pair.expected_country
       OR source_station.country_code IS DISTINCT FROM pair.expected_country_code
       OR target_station.country_code IS DISTINCT FROM pair.expected_country_code
       OR source_station.url IS DISTINCT FROM pair.expected_stream
       OR target_station.url IS DISTINCT FROM pair.expected_stream
       OR source_station.url_resolved IS DISTINCT FROM pair.expected_stream
       OR target_station.url_resolved IS DISTINCT FROM pair.expected_stream
       OR source_station.no_index IS DISTINCT FROM true
       OR target_station.no_index IS DISTINCT FROM false
       OR source_station.manual_edit_fields IS DISTINCT FROM '{}'::jsonb
       OR target_station.manual_edit_fields IS DISTINCT FROM '{}'::jsonb
       OR source_station.redirect_to_slug IS NOT NULL
       OR target_station.redirect_to_slug IS NOT NULL
       OR jsonb_typeof(source_station.source) IS DISTINCT FROM 'object'
       -- The reviewed exact target name/slug/URL are nonjunk. Reject another
       -- row owning either slug, rather than redirecting an ambiguous identity.
       OR EXISTS (SELECT 1 FROM stations WHERE slug = pair.target_slug AND id <> pair.target_id)
       OR EXISTS (SELECT 1 FROM stations WHERE slug = pair.source_slug AND id <> pair.source_id)
    THEN
      RAISE NOTICE '[seo redirect repair] skipped %: reviewed identity or ownership changed', pair.source_slug;
      CONTINUE;
    END IF;

    UPDATE stations
    SET redirect_to_slug = pair.target_slug,
        source = source || jsonb_build_object(audit_key, jsonb_build_object(
          'owner', 'radiohub-verified-seo-redirect', 'version', 1,
          'reason', 'reviewed-gsc-404-same-stream-country-duplicate',
          'sourceId', pair.source_id, 'sourceSlug', pair.source_slug,
          'targetId', pair.target_id, 'targetSlug', pair.target_slug,
          'expectedStream', pair.expected_stream, 'country', pair.expected_country,
          'appliedAt', now(),
          'previous', jsonb_build_object(
            'redirectToSlug', source_station.redirect_to_slug,
            'noIndex', source_station.no_index,
            'updatedAt', source_station.updated_at
          )
        )),
        updated_at = now()
    WHERE id = pair.source_id;
    RAISE NOTICE '[seo redirect repair] applied % -> %; source row retained', pair.source_slug, pair.target_slug;
  END LOOP;
END
$repair$;
