-- Three individually reviewed retained identities, 2026-09-25.
-- Evidence: docs/audits/2026-09-25-retained-redirect-candidates.json.
-- Redirect only: no merge/delete, alias transfer, index flag or content rewrite.
-- Exact identity/URL pins deliberately fail closed if the catalogue changes.
-- The migration runner supplies the transaction and serializes migrations.
DO $repair$
DECLARE
  reviewed_pairs constant jsonb := $reviewed$
[
  {
    "source": {
      "id": "68a8c46dbd66579311aaf9f0",
      "station_uuid": "c79d806d-59d9-4d5d-9dfe-f815071d956b",
      "name": "Energy FM - Non-Stop Mixes",
      "slug": "energy-fm-non-stop-mixes-1",
      "country": "The United Kingdom Of Great Britain And Northern Ireland",
      "country_code": "GB",
      "url": "https://radio.streemlion.com:2365/stream",
      "url_resolved": "https://radio.streemlion.com:2365/stream",
      "homepage": "https://www.energyfm.co.uk/"
    },
    "target": {
      "id": "68a8c46dbd66579311aaf9ef",
      "station_uuid": "29aea530-4321-42f2-846c-d98b34fe478b",
      "name": "Energy FM - Non Stop Mixes",
      "slug": "energy-fm-non-stop-mixes",
      "country": "The United Kingdom Of Great Britain And Northern Ireland",
      "country_code": "GB",
      "url": "https://radio.streemlion.com:2365/stream",
      "url_resolved": "https://radio.streemlion.com:2365/stream",
      "homepage": "https://www.energyfm.co.uk/"
    },
    "evidence": "https://themegaradio.com/api/station/energy-fm-non-stop-mixes",
    "reason": "same-station-specific-stream-country-brand-and-official-homepage"
  },
  {
    "source": {
      "id": "68a8c477bd66579311ab1214",
      "station_uuid": "45460a0a-3b47-4080-99c0-aeb06f9002de",
      "name": "K-Kountry 95",
      "slug": "k-kountry-95-1",
      "country": "The United States Of America",
      "country_code": "US",
      "url": "https://crystalout.surfernetwork.com:8001/KAMS_MP3",
      "url_resolved": "https://crystalout.surfernetwork.com:8001/KAMS_MP3",
      "homepage": "https://www.ecommnewsnetwork.com/"
    },
    "target": {
      "id": "68a8c477bd66579311ab120d",
      "station_uuid": "e469cbfd-0a54-42e4-b9d3-7da5c41a7738",
      "name": "K Kountry 95",
      "slug": "k-kountry-95",
      "country": "The United States Of America",
      "country_code": "US",
      "url": "https://crystalout.surfernetwork.com:8001/KAMS_MP3",
      "url_resolved": "https://crystalout.surfernetwork.com:8001/KAMS_MP3",
      "homepage": "https://radio-locator.com/cgi-bin/url?id=KAMS-FM"
    },
    "evidence": "https://themegaradio.com/api/station/k-kountry-95",
    "reason": "same-exact-kams-station-stream-country-and-brand-distinct-reviewed-homepages"
  },
  {
    "source": {
      "id": "68a8c468bd66579311aaedf0",
      "station_uuid": "88baabe8-7c90-4d51-9212-3d803ce423b1",
      "name": "Classic Radio NSW (MP3)",
      "slug": "classic-radio-nsw-mp3",
      "country": "Australia",
      "country_code": "AU",
      "url": "http://stream.zeno.fm/gtevhb0m5f0uv",
      "url_resolved": "http://stream.zeno.fm/gtevhb0m5f0uv",
      "homepage": "http://www.classicradionsw.com.au/"
    },
    "target": {
      "id": "68a8c468bd66579311aaeded",
      "station_uuid": "41cc28ae-4139-4f5f-bdc7-4d331c0b0bb3",
      "name": "Classic Radio NSW",
      "slug": "classic-radio-nsw",
      "country": "Australia",
      "country_code": "AU",
      "url": "http://stream.zeno.fm/gtevhb0m5f0uv",
      "url_resolved": "http://stream.zeno.fm/gtevhb0m5f0uv",
      "homepage": "http://www.classicradionsw.com.au/"
    },
    "evidence": "https://themegaradio.com/api/station/classic-radio-nsw",
    "reason": "same-exact-zeno-station-stream-country-brand-and-homepage-not-the-separate-period-channel"
  }
]
$reviewed$::jsonb;
  pair jsonb;
  source_station stations%ROWTYPE;
  target_station stations%ROWTYPE;
  audit_key constant text := 'verifiedRetainedRedirectRepair20260925';
BEGIN
  -- Prevent an ownership/graph change between validation and update. NOWAIT
  -- leaves busy catalogue writers alone; a lock error rolls back for retry.
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
      RAISE NOTICE '[retained redirect repair] skipped %: reviewed row absent', pair->'source'->>'slug';
      CONTINUE;
    END IF;
    IF source_station.source ? audit_key THEN
      RAISE NOTICE '[retained redirect repair] skipped %: prior audit marker exists', source_station.slug;
      CONTINUE;
    END IF;
    -- These exact pins identify six specific records, not a matching heuristic.
    -- Keep both copies of redirect metadata unambiguous before changing either.
    IF (to_jsonb(source_station) @> (pair->'source')) IS DISTINCT FROM true
       OR (to_jsonb(target_station) @> (pair->'target')) IS DISTINCT FROM true
       OR source_station.no_index IS DISTINCT FROM true
       OR target_station.no_index IS DISTINCT FROM false
       OR source_station.manual_edit_fields IS DISTINCT FROM '{}'::jsonb
       OR target_station.manual_edit_fields IS DISTINCT FROM '{}'::jsonb
       OR source_station.redirect_to_slug IS NOT NULL
       OR target_station.redirect_to_slug IS NOT NULL
       OR jsonb_typeof(source_station.source) IS DISTINCT FROM 'object'
       OR jsonb_typeof(target_station.source) IS DISTINCT FROM 'object'
       OR (source_station.source ? 'redirectToSlug' AND source_station.source->'redirectToSlug' <> 'null'::jsonb)
       OR (target_station.source ? 'redirectToSlug' AND target_station.source->'redirectToSlug' <> 'null'::jsonb)
       OR EXISTS (SELECT 1 FROM stations WHERE slug = source_station.slug AND id <> source_station.id)
       OR EXISTS (SELECT 1 FROM stations WHERE slug = target_station.slug AND id <> target_station.id)
       -- Source/target alias overlap is retained, but neither may be claimed by
       -- a third identity. Do not transfer or rebuild any historical alias list.
       OR EXISTS (
         SELECT 1 FROM stations other
         WHERE other.id NOT IN (source_station.id, target_station.id)
           AND (other.slug = ANY(COALESCE(source_station.slug_aliases, ARRAY[]::text[])
                               || COALESCE(target_station.slug_aliases, ARRAY[]::text[]))
             OR source_station.slug = ANY(other.slug_aliases)
             OR target_station.slug = ANY(other.slug_aliases)
             OR other.slug_aliases && (COALESCE(source_station.slug_aliases, ARRAY[]::text[])
                                    || COALESCE(target_station.slug_aliases, ARRAY[]::text[])))
       )
       OR EXISTS (
         SELECT 1 FROM stations
         WHERE redirect_to_slug = ANY(ARRAY[source_station.slug]
                                      || COALESCE(source_station.slug_aliases, ARRAY[]::text[]))
       )
    THEN
      RAISE NOTICE '[retained redirect repair] skipped %: identity, manual state, ownership or graph changed', source_station.slug;
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
      RAISE NOTICE '[retained redirect repair] skipped %: target lacks complete 14-language content', source_station.slug;
      CONTINUE;
    END IF;

    UPDATE stations
    SET redirect_to_slug = target_station.slug,
        source = source || jsonb_build_object(
          'redirectToSlug', target_station.slug,
          audit_key, jsonb_build_object(
            'owner', 'radiohub-verified-retained-redirect', 'version', 1,
            'reason', pair->>'reason', 'evidencePage', pair->>'evidence',
            'evidenceAudit', 'docs/audits/2026-09-25-retained-redirect-candidates.json',
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
    RAISE NOTICE '[retained redirect repair] applied % -> %; both identities retained', source_station.slug, target_station.slug;
  END LOOP;
END
$repair$;
