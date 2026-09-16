-- One reviewed historical Belgian listing of the same Radio Eurodance Classic
-- now identified by its official Canadian Torontocast stream and playlist.
-- Unlike 0032, the exact countries intentionally differ; never generalize this
-- into a country/name or malformed-URL matching rule. No merge or deletion.
DO $repair$
DECLARE
  source_station stations%ROWTYPE;
  target_station stations%ROWTYPE;
  audit_key constant text := 'verifiedEurodanceRedirectRepair20260916';
BEGIN
  PERFORM id FROM stations
  WHERE id = ANY(ARRAY['68a8c48bbd66579311ab4546', '68a8c48bbd66579311ab4547']::text[])
  ORDER BY id FOR UPDATE;
  SELECT * INTO source_station FROM stations WHERE id = '68a8c48bbd66579311ab4546';
  SELECT * INTO target_station FROM stations WHERE id = '68a8c48bbd66579311ab4547';
  IF source_station.id IS NULL OR target_station.id IS NULL THEN
    RAISE NOTICE '[eurodance redirect repair] skipped: source or target is absent';
    RETURN;
  END IF;
  IF source_station.source ? audit_key THEN
    RAISE NOTICE '[eurodance redirect repair] skipped: prior audit marker exists';
    RETURN;
  END IF;
  IF source_station.slug IS DISTINCT FROM 'radio-eurodance-classic'
     OR source_station.name IS DISTINCT FROM 'Radio Eurodance Classic'
     OR source_station.country IS DISTINCT FROM 'Belgium'
     OR source_station.country_code IS DISTINCT FROM 'BE'
     OR source_station.url IS DISTINCT FROM 'http://listen.shoutcast.com/radioeurodanceclassic'
     OR source_station.url_resolved IS DISTINCT FROM 'http:quincy.torontocast.com:2380/stream'
     OR source_station.homepage IS DISTINCT FROM 'http://www.radio-euro-classic.eu/'
     OR target_station.slug IS DISTINCT FROM 'radio-eurodance-classic-pure-and-addictive'
     OR target_station.name IS DISTINCT FROM 'Radio Eurodance Classic - Pure and Addictive'
     OR target_station.country IS DISTINCT FROM 'Canada'
     OR target_station.country_code IS DISTINCT FROM 'CA'
     OR target_station.url IS DISTINCT FROM 'https://www.radio-eurodance-classic.eu/stream/128mp3.m3u'
     OR target_station.url_resolved IS DISTINCT FROM 'http://quincy.torontocast.com:2380/stream'
     OR target_station.homepage IS DISTINCT FROM 'https://www.radio-eurodance-classic.eu/'
     OR source_station.no_index IS DISTINCT FROM true
     OR target_station.no_index IS DISTINCT FROM false
     OR source_station.manual_edit_fields IS DISTINCT FROM '{}'::jsonb
     OR target_station.manual_edit_fields IS DISTINCT FROM '{}'::jsonb
     OR source_station.redirect_to_slug IS NOT NULL
     OR target_station.redirect_to_slug IS NOT NULL
     OR jsonb_typeof(source_station.source) IS DISTINCT FROM 'object'
     OR EXISTS (SELECT 1 FROM stations WHERE slug = source_station.slug AND id <> source_station.id)
     OR EXISTS (SELECT 1 FROM stations WHERE slug = target_station.slug AND id <> target_station.id)
  THEN
    RAISE NOTICE '[eurodance redirect repair] skipped: reviewed identity or ownership changed';
    RETURN;
  END IF;

  UPDATE stations
  SET redirect_to_slug = target_station.slug,
      source = source || jsonb_build_object(audit_key, jsonb_build_object(
        'owner', 'radiohub-verified-eurodance-redirect', 'version', 1,
        'reason', 'reviewed-gsc-exclusion-same-official-station-playlist',
        'sourceId', source_station.id, 'sourceSlug', source_station.slug,
        'targetId', target_station.id, 'targetSlug', target_station.slug,
        'evidencePage', 'https://radio-eurodance-classic.eu/index.php/how-can-i-listen',
        'verifiedPlaylist', target_station.url,
        'verifiedStream', target_station.url_resolved,
        'appliedAt', now(),
        'previous', jsonb_build_object(
          'redirectToSlug', source_station.redirect_to_slug,
          'noIndex', source_station.no_index,
          'updatedAt', source_station.updated_at
        )
      )),
      updated_at = now()
  WHERE id = source_station.id;
  RAISE NOTICE '[eurodance redirect repair] applied % -> %; source row retained', source_station.slug, target_station.slug;
END
$repair$;
