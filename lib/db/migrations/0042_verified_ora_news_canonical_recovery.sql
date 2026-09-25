-- One explicitly reviewed canonical recovery, 2026-09-25; not a policy change.
-- Evidence/content snapshot: docs/audits/2026-09-25-radio-ora-news-recovery.json.
-- Both retained rows, descriptions, aliases, health evidence and user links survive.
-- The runner supplies one transaction. Any changed/unknown ownership skips BOTH rows.
DO $repair$
DECLARE
  reviewed constant jsonb := $reviewed$
{
  "duplicate": {
    "id": "68a8c490bd66579311ab4fb6",
    "station_uuid": "d8d3a887-761e-4a7d-81d8-00d2fcda1b8a",
    "name": "Radio Ora News - Tirana 96.7 FM",
    "slug": "radio-ora-news-tirana-96-7-fm",
    "slug_aliases": [
      "radio-ora-news-tirana-967-fm"
    ],
    "country": "Albania",
    "country_code": "AL",
    "url": "https://radio.oranews.tv:8443/stream",
    "url_resolved": "https://radio.oranews.tv:8443/stream",
    "homepage": "https://www.oranews.tv/"
  },
  "canonical": {
    "id": "68a8c490bd66579311ab4fb5",
    "station_uuid": "bc65059a-991c-42b2-8550-4e895d9b210a",
    "name": "Radio Ora News",
    "slug": "radio-ora-news",
    "slug_aliases": [],
    "country": "Albania",
    "country_code": "AL",
    "url": "https://radio.oranews.tv:8443/stream",
    "url_resolved": "https://radio.oranews.tv:8443/stream",
    "homepage": "https://www.oranews.tv/"
  },
  "checkedAt": "2026-09-25T20:25:03.688Z",
  "contentSha256": {
    "duplicate": {
      "ar": {
        "full": "6577749110570818ce144cf2ced3d0edaccc88a00e53b32fe0cb825050057b2f",
        "meta": "2771775d6a0deed37611d6fa2047eaa017d91fe98da347596a06c7ee6b3aae37"
      },
      "de": {
        "full": "030ac615cd143c53d61a8a57aed7a92c9c4e0db370198f012c5eef0354426f69",
        "meta": "bdf76cf9c8307ec2387274e32f65c602cb31f261670983bb26024bbc0b3b2ca9"
      },
      "en": {
        "full": "597fcc3412dbe21997325940302fa5cee0521455ed33670261bc0d0a3a5cb981",
        "meta": "6cf3d137fefa072e49899773b0ac406037f8979aed899f5ae6e2bd9beaa8fa7e"
      },
      "es": {
        "full": "cf3b79a2d1e26e49b791a0883ce41eb55740aae7a5762b1961538a0520958858",
        "meta": "6c2e6d04856e5c3ddaa7cbcdc609830d99972f5ab862e69cde609effd6149496"
      },
      "fr": {
        "full": "682a12fc30f74469eca70931d98396ab063cb8737f5ef12d5f6c269045b07b1d",
        "meta": "f59582317cfdb026cd7f329e9b2ef583e5e9e063ab389e958d452eac96e4f56b"
      },
      "he": {
        "full": "8029ae30090c9b318ec94b4e34563b34cb5820084e6bb39ae0127ccfbbc1fb84",
        "meta": "6cf3d137fefa072e49899773b0ac406037f8979aed899f5ae6e2bd9beaa8fa7e"
      },
      "hi": {
        "full": "fcdc0c3d7e8ad73c522a8b5c63a926f96ace3cf97ed930356424c29c1c73ef88",
        "meta": "56175db7bba8528928af4058d44c61f04759c261771c26a3bda37a9fcd5d93d5"
      },
      "it": {
        "full": "253abdf73bc152b4296a667cca62226ced3a14914fc618e8c05aaabbf033ada6",
        "meta": "75965df906a340c973a14651da585bd2e9a95e85bda8ddd8d3c331f278dedc02"
      },
      "ja": {
        "full": "72095e8fe918415e912e381a6f12efd9d8d2986ee0109ea806029d774c85398c",
        "meta": "d63fa86889a07c7c29caa99293b4f8943d203c3712ca24af9d322b327368ece7"
      },
      "ko": {
        "full": "2e25f5469a47d8d36dbd4b9572355f24a5f2360c8c2ec10b390bafab836a2e3a",
        "meta": "616d388620544dd242113c96124d0f710eaa28f7c60d6577fdac9dbf29a6b35b"
      },
      "pt": {
        "full": "e88de3f94fe14c464d246fd74fc0ae1fc470ad7989f1c7ed6c1d2de082e729f8",
        "meta": "431c8c9ffd807a27faa8e8cbe7796fa280184a20dd6b48b6dc19b7c4001a1375"
      },
      "ru": {
        "full": "86f0872bb88b38b5f2b22f89d2c937dd3241ca67c51459b8ecb1d725ad2f7a7d",
        "meta": "ec0bd7fa2540cd241a22fbc3e2d57b1541d73e6c4b335f3c1456303b87f89ca7"
      },
      "tr": {
        "full": "9873327b519a10caf227e88d03eb6892f38a627eb26480a424b4d1cd8b11df39",
        "meta": "271de1e8be3604ede3a54749f48a5f76d4def15f485fe53073ccbf2f55d2a819"
      },
      "zh": {
        "full": "76955c127680686e3b47869f14808ab77010ac0ce9f4d0236166bc7dfcccf086",
        "meta": "4a675650d0574bc63ea477b01a444e327b1386b9aef52a76859eb77fa6b468fb"
      }
    },
    "canonical": {
      "ar": {
        "full": "48ba7bf53c65acc044c7e2bb52154ca2dc71b9c0c9143bf158826de10c736a89",
        "meta": "cd2de43674020a60411ca3b4a61ba1d009ebed3a82a90e0757801324e0f9d154"
      },
      "de": {
        "full": "ef4d2097def3871950ae0470b2beaedbc1d707b7bc6e0fa02866a4f24d13ae48",
        "meta": "835721121249d88349dd3094eeb29691b7a24b005c3a07321e86809b81ca3394"
      },
      "en": {
        "full": "36b4a344851fa3d01b39b19ad30df65baf45f8673c5e45bdea3a66944aebfbd6",
        "meta": "7f7b3f661427b0ba98db9d342a45af964548eaf09cb7f7181b55810efa9f8911"
      },
      "es": {
        "full": "a68271c55a05d02a5df5640ec9c27e89eff15e384cbd221fbef87db549641047",
        "meta": "d25cafdc8f1f7fbb62dd4fc0248694d77eca0a726769e53f46a9fd48dcda8068"
      },
      "fr": {
        "full": "f82fca7000dacf810843b29827d415e6cc9807c1ce3208fa29d5b0f3bd4556ce",
        "meta": "293caeefa85b2452d5ffb5c8fc6740bc0424eb4333ef32912a2e6ddc220d36b9"
      },
      "he": {
        "full": "88f16b8462af04bacb749c12e9583e3b2a0f89f58c2a46b6cffe075e375ad6cb",
        "meta": "b6976de2670f93f6aa1cb5584fa96e1391162c7784d24cae73df9abf63a91dcf"
      },
      "hi": {
        "full": "f78d21a2637cbb3f953c0dd4f89de1f2ce844d504ba947a30892175ea49ceedb",
        "meta": "eb9635479a6c24f9bd4779446d516b03ef81a0c44ba9c214a413d57e20503ccc"
      },
      "it": {
        "full": "70c01a00cf07abf4858e82532a2cfb413ff91b9e7211587f6cac4cbb4385fb73",
        "meta": "739c631d268a365e0874f8eb518502c008a54e09602e17d69c241d2308cce435"
      },
      "ja": {
        "full": "a1b64102ebd874f983d902eaa9710edbca81e053c7bc5e9ba882c6a26056d889",
        "meta": "915a51cc8de76168cf737261deab98e488d247566f625967108505de2f4d95df"
      },
      "ko": {
        "full": "fe718999ce647d4b35d7925163cd49144fcb4a8133ca2a8420c83bb9d09df9b8",
        "meta": "88a348afd392bff71c15fca8c8ba7096b6e4442879ae7846a58129f4befd09b6"
      },
      "pt": {
        "full": "74a98ac89ea10ee59fb19f8b7b74719a782014a504b7f1f564d338be34383aa9",
        "meta": "cdf8f8291761ff37296ff4664f030fc54522e1879d7ab5970bd90f44d1971ff8"
      },
      "ru": {
        "full": "8b5083a15cf293dc7dd00ea59ed9fbb6ec7a56db0e527bc05d5a8fcd3e48556f",
        "meta": "c384a97ef0a3572cd6d67813de0bfd1b463f630b2d9bf6c1d3ac29a1de2708d8"
      },
      "sq": {
        "full": "36b4a344851fa3d01b39b19ad30df65baf45f8673c5e45bdea3a66944aebfbd6",
        "meta": "7f7b3f661427b0ba98db9d342a45af964548eaf09cb7f7181b55810efa9f8911"
      },
      "tr": {
        "full": "d2b39952cbd94fc3e4218031327006489f39cc62aac09613077a3e3879fe2e83",
        "meta": "ea9e12e6098ede3ad5312e5bfc9538897378699e22975a1e8c95a5a74f7c6070"
      },
      "zh": {
        "full": "126f85c2ad4bfde9b9750709e8e4916b8045c87019f7acdb010d47904c2e73d3",
        "meta": "746a098e710fbd6091526e3ce8d80442bc5f9acc1e052c14b2c5189154d4c4e9"
      }
    }
  }
}
$reviewed$::jsonb;
  duplicate_station stations%ROWTYPE;
  canonical_station stations%ROWTYPE;
  checked_station stations%ROWTYPE;
  content_pins jsonb;
  locale record;
  owned_identifiers text[];
  audit_key constant text := 'verifiedOraNewsCanonicalRecovery20260925';
  affected integer;
BEGIN
  -- Fence station AND historical-ID/UUID-alias writers between checks and writes.
  -- NOWAIT never queues behind a busy catalog writer; the runner can retry later.
  LOCK TABLE stations IN SHARE ROW EXCLUSIVE MODE NOWAIT;
  LOCK TABLE station_merge_aliases IN SHARE ROW EXCLUSIVE MODE NOWAIT;
  PERFORM id FROM stations
    WHERE id IN (reviewed->'duplicate'->>'id', reviewed->'canonical'->>'id')
    ORDER BY id FOR UPDATE;
  SELECT * INTO duplicate_station FROM stations WHERE id=reviewed->'duplicate'->>'id';
  SELECT * INTO canonical_station FROM stations WHERE id=reviewed->'canonical'->>'id';
  IF duplicate_station.id IS NULL OR canonical_station.id IS NULL THEN
    RAISE NOTICE '[Ora News recovery] skipped: a reviewed row is absent';
    RETURN;
  END IF;

  -- Full immutable identity pins, including the observed historical slug aliases.
  IF (to_jsonb(duplicate_station) @> (reviewed->'duplicate')) IS DISTINCT FROM true
     OR (to_jsonb(canonical_station) @> (reviewed->'canonical')) IS DISTINCT FROM true
     OR to_jsonb(duplicate_station.slug_aliases) IS DISTINCT FROM reviewed->'duplicate'->'slug_aliases'
     OR to_jsonb(canonical_station.slug_aliases) IS DISTINCT FROM reviewed->'canonical'->'slug_aliases'
  THEN
    RAISE NOTICE '[Ora News recovery] skipped: reviewed identity or aliases changed';
    RETURN;
  END IF;

  FOR checked_station IN SELECT * FROM stations
    WHERE id IN (duplicate_station.id,canonical_station.id) ORDER BY id
  LOOP
    -- Unknown legacy noindex is not itself proof. This exception requires an
    -- explicit reviewed pair and rejects any private manual/provenance/journal
    -- state rather than overriding a decision hidden by the public API mapper.
    IF checked_station.no_index IS DISTINCT FROM true
       OR checked_station.manual_edit_fields IS DISTINCT FROM '{}'::jsonb
       OR checked_station.redirect_to_slug IS NOT NULL
       OR jsonb_typeof(checked_station.source) IS DISTINCT FROM 'object'
       OR (checked_station.no_index_recovery_journal IS NOT NULL
           AND checked_station.no_index_recovery_journal IS DISTINCT FROM '{}'::jsonb)
    THEN
      RAISE NOTICE '[Ora News recovery] skipped: private ownership or index state conflicts';
      RETURN;
    END IF;
    IF (checked_station.source ? 'noIndex' AND checked_station.source->'noIndex' IS DISTINCT FROM 'true'::jsonb)
       OR (checked_station.source ? 'redirectToSlug' AND checked_station.source->'redirectToSlug' IS DISTINCT FROM 'null'::jsonb)
       OR (checked_station.source ? 'manualEditFields' AND checked_station.source->'manualEditFields' IS DISTINCT FROM '{}'::jsonb)
       OR (checked_station.source ? 'isManuallyEdited' AND checked_station.source->'isManuallyEdited' IS DISTINCT FROM 'false'::jsonb)
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(checked_station.source) AS k(key)
          WHERE lower(k.key) ~ '(journal|automaticnoindex|noindexreason|manualnoindex|manualredirect|verified.*(repair|recovery))')
       OR EXISTS (SELECT 1 FROM unnest(ARRAY['excludeFromSitemap','excludeFromSeo']) AS flag(key)
          WHERE checked_station.source ? flag.key
            AND checked_station.source->flag.key NOT IN ('false'::jsonb,'null'::jsonb))
    THEN
      RAISE NOTICE '[Ora News recovery] skipped: conflicting or ambiguous archived ownership flags';
      RETURN;
    END IF;

    -- Pin actual reviewed full/meta text, not just fourteen present keys.
    -- sha256(bytea) is built into PostgreSQL; no extension is required.
    content_pins := reviewed->'contentSha256'->CASE WHEN checked_station.id=duplicate_station.id THEN 'duplicate' ELSE 'canonical' END;
    IF jsonb_typeof(checked_station.descriptions) IS DISTINCT FROM 'object' THEN
      RAISE NOTICE '[Ora News recovery] skipped: nonobject descriptions';
      RETURN;
    END IF;
    IF (SELECT count(*) FROM jsonb_object_keys(checked_station.descriptions)) <>
       (SELECT count(*) FROM jsonb_object_keys(content_pins))
       OR NOT (checked_station.descriptions ?& ARRAY['en','es','fr','de','pt','it','ru','ar','zh','tr','ja','ko','hi','he'])
    THEN
      RAISE NOTICE '[Ora News recovery] skipped: description locales changed or incomplete';
      RETURN;
    END IF;
    FOR locale IN SELECT key,value FROM jsonb_each(content_pins)
    LOOP
      IF jsonb_typeof(checked_station.descriptions #> ARRAY[locale.key,'full']) IS DISTINCT FROM 'string'
         OR jsonb_typeof(checked_station.descriptions #> ARRAY[locale.key,'meta']) IS DISTINCT FROM 'string'
         OR encode(sha256(convert_to(checked_station.descriptions #>> ARRAY[locale.key,'full'],'UTF8')),'hex') IS DISTINCT FROM locale.value->>'full'
         OR encode(sha256(convert_to(checked_station.descriptions #>> ARRAY[locale.key,'meta'],'UTF8')),'hex') IS DISTINCT FROM locale.value->>'meta'
      THEN
        RAISE NOTICE '[Ora News recovery] skipped: reviewed description text changed';
        RETURN;
      END IF;
    END LOOP;
  END LOOP;

  owned_identifiers := ARRAY[duplicate_station.id,canonical_station.id,
    duplicate_station.station_uuid,canonical_station.station_uuid,
    duplicate_station.slug,canonical_station.slug]
    || duplicate_station.slug_aliases || canonical_station.slug_aliases
    || COALESCE((SELECT array_agg(alias) FROM station_merge_aliases
                 WHERE station_id IN (duplicate_station.id,canonical_station.id)),ARRAY[]::text[]);
  IF EXISTS (SELECT 1 FROM stations other WHERE other.id NOT IN (duplicate_station.id,canonical_station.id)
       AND (other.slug=ANY(owned_identifiers) OR other.slug_aliases && owned_identifiers))
     OR EXISTS (SELECT 1 FROM station_merge_aliases
       WHERE alias=ANY(owned_identifiers) AND station_id NOT IN (duplicate_station.id,canonical_station.id))
     OR EXISTS (SELECT 1 FROM stations
       WHERE redirect_to_slug=ANY(owned_identifiers) OR source->>'redirectToSlug'=ANY(owned_identifiers))
     -- A third plausible sibling means this is no longer the reviewed two-row
     -- situation. Include hidden/redirected rows, not only public search results.
     OR EXISTS (SELECT 1 FROM stations other WHERE other.id NOT IN (duplicate_station.id,canonical_station.id)
       AND (other.url=canonical_station.url OR other.url_resolved=canonical_station.url_resolved
         OR other.station_uuid IN (duplicate_station.station_uuid,canonical_station.station_uuid)
         OR other.slug LIKE 'radio-ora-news%'
         OR (lower(regexp_replace(other.name,'[^a-zA-Z0-9]','','g')) IN ('radiooranews','radiooranewstirana967fm')
           AND (other.country_code IS NULL OR other.country_code='' OR other.country_code='AL'
             OR other.country IS NULL OR other.country='' OR other.country='Albania'))))
  THEN
    RAISE NOTICE '[Ora News recovery] skipped: third ownership, incoming redirect or identity peer';
    RETURN;
  END IF;

  -- One statement changes exactly the pinned pair. Private receipts retain the
  -- previous changed fields, key presence and journal nullness for exact rollback.
  -- Never publish recovery receipts in source (public catalog JSON).
  UPDATE stations s
  SET no_index=(s.id=duplicate_station.id),
      redirect_to_slug=CASE WHEN s.id=duplicate_station.id THEN canonical_station.slug ELSE s.redirect_to_slug END,
      source=s.source || jsonb_build_object('noIndex',s.id=duplicate_station.id)
        || CASE WHEN s.id=duplicate_station.id THEN jsonb_build_object('redirectToSlug',canonical_station.slug) ELSE '{}'::jsonb END,
      no_index_recovery_journal=COALESCE(s.no_index_recovery_journal,'{}'::jsonb) || jsonb_build_object(audit_key,jsonb_build_object(
        'owner','radiohub-verified-canonical-recovery','version',1,
        'action',CASE WHEN s.id=duplicate_station.id THEN 'retain-duplicate-redirect' ELSE 'recover-reviewed-canonical' END,
        'reason','same-exact-station-stream-resolved-stream-country-brand-and-official-homepage',
        'evidenceAudit','docs/audits/2026-09-25-radio-ora-news-recovery.json',
        'reviewedDuplicate',reviewed->'duplicate','reviewedCanonical',reviewed->'canonical',
        'reviewedContentSha256',reviewed->'contentSha256','snapshotAt',reviewed->>'checkedAt','appliedAt',now(),
        'previous',jsonb_build_object(
          'noIndex',s.no_index,'sourceHadNoIndex',s.source ? 'noIndex','sourceNoIndex',s.source->'noIndex',
          'redirectToSlug',s.redirect_to_slug,'sourceHadRedirectToSlug',s.source ? 'redirectToSlug',
          'sourceRedirectToSlug',s.source->'redirectToSlug','updatedAt',s.updated_at,
          'journalWasNull',s.no_index_recovery_journal IS NULL))),
      updated_at=now()
  WHERE s.id IN (duplicate_station.id,canonical_station.id);
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>2 THEN RAISE EXCEPTION '[Ora News recovery] expected exactly two reviewed updates, got %',affected; END IF;
  RAISE NOTICE '[Ora News recovery] recovered % and redirected %; both rows/content/user references retained',
    canonical_station.slug,duplicate_station.slug;
END
$repair$;
