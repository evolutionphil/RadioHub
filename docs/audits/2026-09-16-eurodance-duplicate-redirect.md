# Reviewed Radio Eurodance Classic redirect

Migration `0033_verified_eurodance_duplicate_redirect.sql` is separate from the
already published immutable 0032 migration. It redirects one historical excluded
listing to an existing indexable record of the same station; it does not make
the duplicate indexable or change stream data.

## Exact identities and evidence

Source: `68a8c48bbd66579311ab4546`, `radio-eurodance-classic`, **Radio Eurodance
Classic**, Belgium/BE. Source URL is the dead Shoutcast listing
`http://listen.shoutcast.com/radioeurodanceclassic` (verified 404 HTML); its stored
resolved URL is malformed: `http:quincy.torontocast.com:2380/stream`.

Target: `68a8c48bbd66579311ab4547`,
`radio-eurodance-classic-pure-and-addictive`, **Radio Eurodance Classic - Pure and
Addictive**, Canada/CA. Its current official playlist is
`https://www.radio-eurodance-classic.eu/stream/128mp3.m3u`, which returned 200 and
contained exactly `http://quincy.torontocast.com:2380/stream` on 16 September 2026.
A bounded stream probe returned 200 `audio/mpeg`, `icy-name: Radio Eurodance
Classic`, 128 kbps; cancelled after 1,460 bytes. The [official listening page](https://radio-eurodance-classic.eu/index.php/how-can-i-listen)
identifies the Canadian Torontocast broadcast and links its station playlist.

The target's English page returned 200 with index/follow in its HTTP header and
HTML, a self-canonical and 14 language alternates. A subsequent bounded public
check of all 14 localized target URLs found 14/14 status 200, no noindex header
or robots meta, and matching self-canonicals. Both records had empty manual
ownership and no redirect; source noindex=true, target noindex=false. Countries
intentionally differ: this is an individually verified historical identity, not
a reusable heuristic for crossing countries or repairing malformed URLs.

Another Canadian same-brand stream listing,
`68a8c46dbd66579311aafbc5` / `eurodance-classic-pure-classic-addictive`, is also
indexable. It is **not changed** by this bounded repair. This migration does not
claim all Eurodance duplicates have been consolidated.

## Safety and verification

The migration runner provides its transaction and cross-replica lock; the SQL
locks only these two exact IDs in order. It requires the recorded names, slugs,
countries, country codes, raw/resolved URLs, homepages, noindex flags, absent
redirects, empty manual ownership and unique slug ownership. A changed/absent
record logs a skip instead of broadening the repair. Prior audit metadata is
never overwritten; repeated execution is a no-op.

Only source `redirect_to_slug`, audit metadata under
`source.verifiedEurodanceRedirectRepair20260916`, and `updated_at` change.
All IDs, source/target payloads outside that audit key, descriptions, aliases,
indexing flags, favorites and ratings remain untouched. The existing normalized
read uses `redirect_to_slug`; SSR preserves the requested language.

After publication check `/en/station/radio-eurodance-classic` and localized
equivalents for a single 301 to this target followed by an indexable 200. Do not
restart already-running GSC validation just for this individual repair.

## Documented rollback (not executed automatically)

Use only after review. The CAS refuses a source changed by an editor or sync
since the repair. A skipped rollback needs inspection, not weaker predicates.

```sql
BEGIN;
UPDATE stations AS s
SET redirect_to_slug = s.source #>> '{verifiedEurodanceRedirectRepair20260916,previous,redirectToSlug}',
    source = s.source - 'verifiedEurodanceRedirectRepair20260916',
    updated_at = now()
WHERE s.id = '68a8c48bbd66579311ab4546'
  AND s.slug = 'radio-eurodance-classic'
  AND s.redirect_to_slug = 'radio-eurodance-classic-pure-and-addictive'
  AND s.no_index IS TRUE AND s.manual_edit_fields = '{}'::jsonb
  AND s.source #>> '{verifiedEurodanceRedirectRepair20260916,owner}' = 'radiohub-verified-eurodance-redirect'
  AND s.source #>> '{verifiedEurodanceRedirectRepair20260916,version}' = '1'
  AND s.source #>> '{verifiedEurodanceRedirectRepair20260916,sourceId}' = '68a8c48bbd66579311ab4546'
  AND s.source #>> '{verifiedEurodanceRedirectRepair20260916,targetId}' = '68a8c48bbd66579311ab4547'
  AND s.source #>> '{verifiedEurodanceRedirectRepair20260916,targetSlug}' = 'radio-eurodance-classic-pure-and-addictive'
  AND s.source #> '{verifiedEurodanceRedirectRepair20260916,previous,redirectToSlug}' = 'null'::jsonb
  AND s.source #> '{verifiedEurodanceRedirectRepair20260916,previous,noIndex}' = 'true'::jsonb
  AND s.updated_at = (s.source #>> '{verifiedEurodanceRedirectRepair20260916,appliedAt}')::timestamptz
RETURNING s.id, s.slug, s.redirect_to_slug;
-- Inspect the returned ID (at most the one reviewed source); COMMIT only after review.
ROLLBACK;
```
