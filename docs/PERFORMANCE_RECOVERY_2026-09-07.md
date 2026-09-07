# PostgreSQL production speed repair

## Measured baseline

Google PageSpeed Insights, `/de`, 2026-09-07 19:03 Europe/Berlin:

| Lab metric | Mobile | Desktop |
| --- | ---: | ---: |
| Performance | 36 | 61 |
| SEO | 100 | 100 |
| LCP | 8.1 s | 1.5 s |
| Total Blocking Time | 1,920 ms | 2,640 ms |

CrUX field data was unavailable. These lab samples are not field-percentile
measurements or proof every URL is indexed. Cold public directory HTML took
about 4.6 seconds to its first byte; warm HTML took about 0.2 seconds.

## Root causes and repairs

- Optional Redis is not configured. Values larger than the small cache's
  512KB gate were silently uncached, rebuilding station lists repeatedly.
  Added a separate bounded hot tier: 32MB serialized-size budget, 8MB per value,
  32 entries, LRU/TTL eviction, cross-tier invalidation, existing SWR/singleflight.
  Serialized-size accounting is an estimate, not exact V8 heap accounting.
- PostgreSQL global ranking still used serial country loops. One window-ranked
  query now retains the global 200-per-country cap. Popular ranking retains
  featured priority, its 40-per-country cap and post-ranking junk exclusion;
  only final winners are hydrated. No new schema/data migration is required.
- A requested legacy extra loaded the entire duplicate `source` document.
  Projection now returns only requested source roots, preserving missing/null
  and native-column override semantics.
- Public list payloads included every station's translated articles, twice
  through compatibility aliases. Explicit `slim=1` selects card/player fields
  in SQL. Full/default API and station-detail responses remain available.
  The frontend uses compact list and nearby reads; cache keys distinguish shape,
  nearby limit and country preference. Compact directory reads coalesce for 60s.
- On the verified local read-only snapshot, the same 200 global IDs/total changed
  from 10,740,569 bytes to 544,289 bytes (~95% less); Austria changed from
  10,358,467 to 530,799 bytes. No station records or articles were removed.
- Popular homepage requests now need 12 cards, not a 200-card download to slice12.
  Speculative recommendation prefetch waits for interaction or post-load idle.
- Closed authentication UI is lazy; initial static JS dependency closure reduced
  by ~115KB. Removed unused per-card notification polling/listeners, preserving
  one application notification bridge. Translation merges are shared by weak
  reference, avoiding dictionary copies on every card render.
- Image fallback failures have a short, bounded per-page negative cache.
  S3 remains preferred; new jobs publish actual 48/96/256 variants and truthful
  original MIME/extensions. Existing objects were neither deleted nor rewritten.
- The existing 600/700 Ubuntu font files have identical rendering tables. Both
  CSS faces now share the 700 URL and preload once, avoiding 97,072 duplicate
  bytes without changing weights, metrics, Unicode coverage or original files.
- Public genre navigation now uses the existing admin-managed whitelist and
  discoverability flags. Popularity ordering happens before pagination; raw
  taxonomy remains unchanged. Cache keys fingerprint whitelist contents so
  edits cannot leave stale navigation. Footer labels reuse translated keys.

## Content and SEO invariants

The page locale belongs to WebPage metadata; a station's broadcast language
must come from actual station language data, never the visitor's UI language.
Unknown broadcast language is omitted. Localized legal bodies now share one
source between raw SSR and React; see the separate legal verification note.

Kral FM's 14 locale pages passed canonical/hreflang/H1/indexability checks.
Fourteen first station sitemap chunks contained it exactly once per locale;
140,000 sampled entries were valid XML. The largest sampled chunk was 31.9MB,
below the 50MB uncompressed limit. This is not a crawl of every station URL.

## Validation and limits

- Frontend full suite: 299 tests passed, including 14-locale legal SSR/SPA parity.
- Backend focused suites: 157 tests passed, including actual PostgreSQL ranking,
  public response/filter/counter tests, projection parity, memory-cache limits,
  schema/SSR, static-asset cache behavior and mocked image uploads.
- API/frontend typechecks and isolated production builds passed. Production
  dependency boundary: 387 packages, zero Mongo dependencies.
- All database verification used disposable fixtures or a read-only verified
  backup; no new Mongo/GSC/history import, paid bulk translation or S3 backfill.
- External station logo URLs can genuinely be unavailable. Fallbacks do not
  pretend those images loaded, and this release does not verify every S3 object.
- Legal operator details still need owner review. Google controls indexing;
  Lighthouse SEO100 is a basic technical result, not an indexing guarantee.

Production deployment IDs, post-release HTTP/PSI measurements and browser checks
are recorded in the local release evidence after deployment, not fabricated here.
