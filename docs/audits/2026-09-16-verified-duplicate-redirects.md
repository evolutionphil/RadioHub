# Guarded repair of three GSC duplicate station URLs

## Reviewed scope

Migration `0032_verified_station_duplicate_redirects.sql` repairs only these
same-stream, same-country duplicate identities. Their canonical targets were
publicly checked on 16 September 2026: indexable records with localized content;
the source records were excluded duplicates without a redirect.

| Retained duplicate | Canonical target | Historical GSC alias |
| --- | --- | --- |
| `radio-gaga-1` | `radio-gaga` | `rdi-gaga` |
| `radio-fm-4` | `sro4-radio-fm` | `rdio_fm-1` |
| `smooth-1` | `radio-jazz-smooth` | `smooth-3` |

The SQL includes the six exact IDs, names, countries/codes and stream URLs.
It locks those six rows in ID order, then verifies both `url` and `url_resolved`,
source `no_index=true`, target `no_index=false`, empty manual ownership, no
existing redirect, and unambiguous source/target slugs. A mismatch skips only
that pair with a PostgreSQL NOTICE; it does not guess an alternative target.
Existing audit metadata also skips the pair, making re-execution idempotent.

Only source `redirect_to_slug`, its audit entry inside `source`, and `updated_at`
change. No rows are merged/deleted, no source is made indexable, no aliases or
favorites/ratings are transferred. Existing normalized reads take the redirect
from `redirect_to_slug`, not an old property in `source`.

The ordinary immutable migration runner supplies transaction + cross-replica
advisory lock. If a deployment has already marked a skipped migration applied,
inspect the NOTICE and current records before proposing a new reviewed repair;
do not edit this migration after deployment or delete its ledger entry.

## Alias handling

SSR previously checked the excluded alias owner before its explicit redirect,
so historical aliases still returned 410 even when the duplicate had a target.
It now checks one exact final target and redirects directly in the requested
language. Missing, noindex, junk, numeric, self/cyclic or further-redirecting
targets remain excluded. No arbitrary chains or guessed canonical identities
are followed. A current exact slug retains precedence over historical aliases.

## Recoverable audit and compare-and-set rollback

Each changed source receives `source.verifiedSeoRedirectRepair20260916`, recording
owner/version/reason, exact source/target IDs and slugs, stream, country, applied
time, and previous redirect/noIndex/update time. The source `set_updated_at`
trigger uses transaction `now()`, matching the recorded `appliedAt`.

Rollback is an explicitly reviewed operational action, **not** an automatic
down migration. The following SQL is documentation only. It restores only rows
still owned by this repair, whose redirect, exclusion flag, audit identity and
update time are unchanged since application. Any later editor/sync change makes
the CAS fail; inspect that record rather than relaxing the conditions.

```sql
BEGIN;
WITH reviewed(source_id, source_slug, target_id, target_slug) AS (VALUES
  ('68a8c48bbd66579311ab46df', 'radio-gaga-1', '68a8c48bbd66579311ab46de', 'radio-gaga'),
  ('68a8c495bd66579311ab5b29', 'radio-fm-4', '68a8c49bbd66579311ab6e32', 'sro4-radio-fm'),
  ('68a8c49bbd66579311ab6b5b', 'smooth-1', '68a8c4a8bd66579311ab8a92', 'radio-jazz-smooth')
)
UPDATE stations AS s
SET redirect_to_slug = s.source #>> '{verifiedSeoRedirectRepair20260916,previous,redirectToSlug}',
    source = s.source - 'verifiedSeoRedirectRepair20260916',
    updated_at = now()
FROM reviewed AS r
WHERE s.id = r.source_id AND s.slug = r.source_slug
  AND s.redirect_to_slug = r.target_slug AND s.no_index IS TRUE
  AND s.manual_edit_fields = '{}'::jsonb
  AND s.source #>> '{verifiedSeoRedirectRepair20260916,owner}' = 'radiohub-verified-seo-redirect'
  AND s.source #>> '{verifiedSeoRedirectRepair20260916,version}' = '1'
  AND s.source #>> '{verifiedSeoRedirectRepair20260916,sourceId}' = r.source_id
  AND s.source #>> '{verifiedSeoRedirectRepair20260916,targetId}' = r.target_id
  AND s.source #>> '{verifiedSeoRedirectRepair20260916,targetSlug}' = r.target_slug
  AND s.source #> '{verifiedSeoRedirectRepair20260916,previous,redirectToSlug}' = 'null'::jsonb
  AND s.source #> '{verifiedSeoRedirectRepair20260916,previous,noIndex}' = 'true'::jsonb
  AND s.updated_at = (s.source #>> '{verifiedSeoRedirectRepair20260916,appliedAt}')::timestamptz
RETURNING s.id, s.slug, s.redirect_to_slug;
-- Inspect returned IDs (at most these three); COMMIT only after review.
ROLLBACK;
```

After deploy, verify current source URLs and historical aliases resolve to a
single language-preserving 301 with a 200, self-canonical, indexable target.
This repair does not establish that every other GSC 404 should redirect or
index: unverified missing/junk URLs remain excluded and require separate review.
