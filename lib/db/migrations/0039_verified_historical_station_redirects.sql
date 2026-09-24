-- Five individually reviewed historical identities, 2026-09-24.
-- Evidence: docs/audits/2026-09-24-historical-404-identity-review.md.
-- Redirect only: no merge/delete, alias transfer, noindex/content/user-data rewrite.
-- Exact URL pins deliberately fail closed on provider refresh (including tokens).
-- The runner supplies the transaction and serializes schema migrations.
DO $repair$
DECLARE
  reviewed_pairs constant jsonb := $reviewed$
[
  {
    "source": {
      "id": "68a8c4a6bd66579311ab8808",
      "station_uuid": "29a68b7f-f573-4b19-b3ba-cdbb0979e348",
      "name": "Вести FM (AAC)",
      "slug": "vesti-fm-aac",
      "country": "The Russian Federation",
      "country_code": "RU",
      "url": "https://icecast-vgtrk.cdnvideo.ru/vestifm_aac_32kbps",
      "url_resolved": "https://icecast-vgtrk.cdnvideo.ru/vestifm_aac_32kbps",
      "homepage": "https://radiovesti.ru/"
    },
    "target": {
      "id": "68a8c4a6bd66579311ab880c",
      "station_uuid": "961da649-0601-11e8-ae97-52543be04c81",
      "name": "вести фм (Vesti FM)",
      "slug": "vesti-fm-vesti-fm",
      "country": "The Russian Federation",
      "country_code": "RU",
      "url": "http://icecast.vgtrk.cdnvideo.ru/vestifm_mp3_64kbps",
      "url_resolved": "http://icecast.vgtrk.cdnvideo.ru/vestifm_mp3_64kbps",
      "homepage": "http://radiovesti.ru/"
    },
    "evidence": "https://smotrim.ru/channel/199",
    "reason": "same-official-national-service-and-matching-icy-identity-across-codecs"
  },
  {
    "source": {
      "id": "68a8c480bd66579311ab2a2a",
      "station_uuid": "365b3039-a72c-4770-99c5-1d0185553ba3",
      "name": "Naxi Radio Rock",
      "slug": "naxi-radio-rock-1",
      "country": "Serbia",
      "country_code": "RS",
      "url": "https://naxidigital-rock128ssl.streaming.rs:8182/;",
      "url_resolved": "https://naxidigital-rock128ssl.streaming.rs:8182/;",
      "homepage": "https://www.naxi.rs/"
    },
    "target": {
      "id": "68a8c480bd66579311ab2a2b",
      "station_uuid": "b873245f-c6fe-40c0-a9f3-4bbe5402c281",
      "name": "Naxi Rock radio",
      "slug": "naxi-rock-radio",
      "country": "Serbia",
      "country_code": "RS",
      "url": "https://naxidigital-rock128ssl.streaming.rs:8182/;",
      "url_resolved": "https://naxidigital-rock128ssl.streaming.rs:8182/;",
      "homepage": "https://www.naxi.rs/rock"
    },
    "evidence": "https://www.naxi.rs/rock",
    "reason": "same-official-digital-channel-and-exact-stream"
  },
  {
    "source": {
      "id": "68a8c46cbd66579311aaf66b",
      "station_uuid": "d730e041-05fd-421d-a39b-7b2da3f9bdae",
      "name": "DR P4 København (MP3)",
      "slug": "dr-p4-kobenhavn-mp3",
      "country": "Denmark",
      "country_code": "DK",
      "url": "http://live-icy.dr.dk/A/A08H.mp3",
      "url_resolved": "http://live-icy.dr.dk/A/A08H.mp3",
      "homepage": "http://www.dr.dk/p4kbh"
    },
    "target": {
      "id": "68a8c46cbd66579311aaf669",
      "station_uuid": "960f5358-0601-11e8-ae97-52543be04c81",
      "name": "DR P4 København",
      "slug": "dr-p4-kobenhavn",
      "country": "Denmark",
      "country_code": "DK",
      "url": "http://live-icy.gss.dr.dk/A/A08H.mp3.m3u",
      "url_resolved": "http://live-icy.dr.dk/A/A08H.mp3",
      "homepage": "http://www.dr.dk/p4kbh"
    },
    "evidence": "https://www.dr.dk/lyd/p4kbh",
    "reason": "same-official-regional-service-and-exact-resolved-stream"
  },
  {
    "source": {
      "id": "68a8c458bd66579311aac72f",
      "station_uuid": "c54c9b7e-925d-4b2d-b73b-9367237e3708",
      "name": "W RADIO 88.5 (Villahermosa) - 88.5 FM - XHKV-FM - Grupo Radio Cañón - Villahermosa, Tabasco.",
      "slug": "w-radio-88-5-villahermosa-88-5-fm-xhkv-fm-grupo-radio-canon-villahermosa-tabasco-1",
      "country": "Mexico",
      "country_code": "MX",
      "state": "Villahermosa, Tabasco",
      "url": "https://streaming.servicioswebmx.com/8256/stream",
      "url_resolved": "https://streaming.servicioswebmx.com/8256/stream",
      "homepage": "https://wradio.com.mx/"
    },
    "target": {
      "id": "68a8c458bd66579311aac72e",
      "station_uuid": "38a0d940-ec1a-4ad0-bca9-e10a1c9a0ed7",
      "name": "W RADIO 88.5 (Villahermosa) - 88.5 FM - XHKV-FM - Grupo Radio Cañón - Villahermosa, Tabasco",
      "slug": "w-radio-88-5-villahermosa-88-5-fm-xhkv-fm-grupo-radio-canon-villahermosa-tabasco",
      "country": "Mexico",
      "country_code": "MX",
      "state": "Villahermosa, Tabasco",
      "url": "https://streaming.servicioswebmx.com/8256/stream",
      "url_resolved": "https://streaming.servicioswebmx.com/8256/stream",
      "homepage": "https://radiocanon.com.mx/wp-content/uploads/2023/04/26_XEKV_740_XHKV_88.5_W.png"
    },
    "evidence": "https://streaming.servicioswebmx.com/8256/stream",
    "reason": "same-exact-stream-callsign-frequency-and-city-not-740-am"
  },
  {
    "source": {
      "id": "6a0791d5bef34beb9148d739",
      "station_uuid": "96109022-0601-11e8-ae97-52543be04c81",
      "name": "Sunshine Live - Classics",
      "slug": "sunshine-live-classics-1",
      "country": "Germany",
      "country_code": "DE",
      "url": "http://stream.sunshine-live.de/classics/mp3-192/stream.sunshine-live.de/",
      "url_resolved": "http://stream.sunshine-live.de/classics/mp3-192/stream.sunshine-live.de/",
      "homepage": "http://www.sunshine-live.de/"
    },
    "target": {
      "id": "68a8c49cbd66579311ab7099",
      "station_uuid": "d965b9bd-c27d-4685-a7ae-bc33fd29ac8e",
      "name": "Sunshine-Live Classics",
      "slug": "sunshine-live-classics",
      "country": "Germany",
      "country_code": "DE",
      "url": "http://sunsl.streamabc.net/sunsl-classics-mp3-192-8423201?sABC=66r6n195%230%23oq8pq46039p8rr2r88688r02rs94rop4%23&aw_0_1st.playerid=&amsparams=playerid:;skey:1726390677",
      "url_resolved": "http://sunsl.streamabc.net/sunsl-classics-mp3-192-8423201?sABC=66r6n195%230%23oq8pq46039p8rr2r88688r02rs94rop4%23&aw_0_1st.playerid=&amsparams=playerid:;skey:1726390677",
      "homepage": "https://www.sunshine-live.de/"
    },
    "evidence": "https://stream.sunshine-live.de/classics/mp3-192/stream.sunshine-live.de/play.m3u",
    "reason": "official-classics-playlist-resolves-to-exact-target-stream-host-and-path"
  }
]
$reviewed$::jsonb;
  pair jsonb;
  source_station stations%ROWTYPE;
  target_station stations%ROWTYPE;
  audit_key constant text := 'verifiedHistoricalRedirectRepair20260924';
BEGIN
  -- Prevent new conflicting slug owners/incoming chains between check and write.
  -- Reads remain available; do not queue behind a busy catalogue writer. A lock
  -- error rolls back this migration, allowing a later deployment to retry.
  LOCK TABLE stations IN SHARE ROW EXCLUSIVE MODE NOWAIT;
  PERFORM id FROM stations
  WHERE id IN (
    SELECT value->'source'->>'id' FROM jsonb_array_elements(reviewed_pairs)
    UNION ALL
    SELECT value->'target'->>'id' FROM jsonb_array_elements(reviewed_pairs)
  )
  ORDER BY id FOR UPDATE;

  FOR pair IN SELECT value FROM jsonb_array_elements(reviewed_pairs)
  LOOP
    SELECT * INTO source_station FROM stations WHERE id = pair->'source'->>'id';
    SELECT * INTO target_station FROM stations WHERE id = pair->'target'->>'id';
    IF source_station.id IS NULL OR target_station.id IS NULL THEN
      RAISE NOTICE '[historical redirect repair] skipped %: source or target absent', pair->'source'->>'slug';
      CONTINUE;
    END IF;
    IF source_station.source ? audit_key THEN
      RAISE NOTICE '[historical redirect repair] skipped %: prior audit marker exists', source_station.slug;
      CONTINUE;
    END IF;
    -- The JSON pins include BOTH IDs/UUIDs, names, slugs, countries, homepages,
    -- and input/resolved streams. This is not a generic name/URL matching rule.
    IF (to_jsonb(source_station) @> (pair->'source')) IS DISTINCT FROM true
       OR (to_jsonb(target_station) @> (pair->'target')) IS DISTINCT FROM true
       OR source_station.no_index IS DISTINCT FROM true
       OR target_station.no_index IS DISTINCT FROM false
       OR source_station.manual_edit_fields IS DISTINCT FROM '{}'::jsonb
       OR target_station.manual_edit_fields IS DISTINCT FROM '{}'::jsonb
       OR source_station.redirect_to_slug IS NOT NULL
       OR target_station.redirect_to_slug IS NOT NULL
       OR jsonb_typeof(source_station.source) IS DISTINCT FROM 'object'
       OR EXISTS (SELECT 1 FROM stations WHERE slug = source_station.slug AND id <> source_station.id)
       OR EXISTS (SELECT 1 FROM stations WHERE slug = target_station.slug AND id <> target_station.id)
       -- Source-owned historical aliases must not resolve to a third record.
       -- A target's old alias matching the source canonical is intentional:
       -- direct canonical ownership wins, and neither alias array is changed.
       OR EXISTS (
         SELECT 1 FROM stations other
         WHERE other.id NOT IN (source_station.id, target_station.id)
           AND (other.slug = ANY(source_station.slug_aliases)
             OR source_station.slug = ANY(other.slug_aliases)
             OR target_station.slug = ANY(other.slug_aliases)
             OR other.slug_aliases && source_station.slug_aliases)
       )
       OR EXISTS (
         SELECT 1 FROM stations
         WHERE redirect_to_slug = ANY(ARRAY[source_station.slug] || COALESCE(source_station.slug_aliases, ARRAY[]::text[]))
       )
    THEN
      RAISE NOTICE '[historical redirect repair] skipped %: reviewed identity, ownership or redirect graph changed', source_station.slug;
      CONTINUE;
    END IF;
    IF jsonb_typeof(target_station.descriptions) IS DISTINCT FROM 'object'
       OR EXISTS (
         SELECT 1 FROM unnest(ARRAY['en','es','fr','de','pt','it','ru','ar','zh','tr','ja','ko','hi','he']) AS locale(code)
         WHERE jsonb_typeof(target_station.descriptions #> ARRAY[locale.code,'full']) IS DISTINCT FROM 'string'
            OR jsonb_typeof(target_station.descriptions #> ARRAY[locale.code,'meta']) IS DISTINCT FROM 'string'
            OR (target_station.descriptions #>> ARRAY[locale.code,'full']) !~ '[^[:space:]]'
            OR (target_station.descriptions #>> ARRAY[locale.code,'meta']) !~ '[^[:space:]]'
       )
    THEN
      RAISE NOTICE '[historical redirect repair] skipped %: destination lacks complete 14-language content', source_station.slug;
      CONTINUE;
    END IF;

    UPDATE stations
    SET redirect_to_slug = target_station.slug,
        source = source || jsonb_build_object(
          'redirectToSlug', target_station.slug,
          audit_key, jsonb_build_object(
            'owner', 'radiohub-verified-historical-redirect', 'version', 1,
            'reason', pair->>'reason', 'evidencePage', pair->>'evidence',
            'reviewedSource', pair->'source', 'reviewedTarget', pair->'target',
            'appliedAt', now(),
            'previous', jsonb_build_object(
              'redirectToSlug', source_station.redirect_to_slug,
              'sourceHadRedirectToSlug', source_station.source ? 'redirectToSlug',
              'sourceRedirectToSlug', source_station.source->'redirectToSlug',
              'noIndex', source_station.no_index,
              'updatedAt', source_station.updated_at
            )
          )
        ),
        updated_at = now()
    WHERE id = source_station.id;
    RAISE NOTICE '[historical redirect repair] applied % -> %; source row retained', source_station.slug, target_station.slug;
  END LOOP;
END
$repair$;
