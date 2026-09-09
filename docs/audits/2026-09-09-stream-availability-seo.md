# Stream availability and SEO preservation — 2026-09-09

Public discovery and page indexability are separate policies. A failed stream is
not proof that the station's existing information and translations have lost
their value.

## Implemented behavior

- Public SSR station grids, catalogues and related-station links include only
  native `lastCheckOk === true` records. The direct station lookup is not filtered.
- A normally indexable station whose audio is offline retains its rich localized
  detail content, successful HTTP handling, self-canonical and qualified hreflang
  cluster. No health-based sitemap removal or new noindex is introduced.
- SSR and React share the same 14-language temporary-unavailability notice.
  The bootstrap already includes the explicit false health value, so hydration
  does not have to infer availability from the presence of a stream URL.
- Stream failure, including the former `stream-dead-30d` condition, is no longer
  classified as content-quality junk. Actual test-feed, codec, duplicate and
  other quality rules are retained.
- The existing sync/nightly cleanup may retire only a proven, active,
  version-1 `radiohub-junk-policy` health-only exclusion. Whole policy/manual/
  redirect/health before-image checks remain under the native update's row lock.
  Another quality reason, manual exclusion, missing/incompatible provenance or
  failed required duplicate lookup prevents this transition. Retirement does
  not claim the audio recovered and does not change playback health.
- Unknown historical `noIndex: true` is **not cleared**. An offline record with
  no explicit manual noindex marker, real quality issue, numeric artifact or
  redirect may display its retained detail page successfully, but it still has
  **noindex**, no indexable hreflang and remains excluded from the sitemap.
  This is not an assertion that every old offline URL is indexable. Explicit
  manual/quality exclusions and duplicate redirects keep their existing handling.
- Station-dependent page/HTML caches and A–Z datasource caching are bounded to
  60 seconds in a new namespace. Absolute expiry is inherited from cached
  upstream station data, so a 55-second-old pool has at most 5 seconds left in
  the page/HTML layers. Normal informational-page and translation TTLs remain
  unchanged. Existing HTML HTTP headers require browser/CDN revalidation.

## Validation and limitations

Regression tests exercise actual SSR rendering across 14 locales, full text and
canonical/hreflang preservation, unknown versus manual noindex behavior, shared
notice text, bootstrap false values, public grid filtering, sitemap URL inclusion,
actual sync/cleanup calls with isolated mocks, conservative policy CAS inputs and
absolute cache deadlines. Probe tests use synthetic local HTTP fixtures only.
No production station data was modified by this audit, no cleanup job was run
manually, and no fake stream recovery or indexing guarantee is asserted.

Google documents that persistent 5xx responses can reduce crawl activity and
eventually remove URLs from the index. Keeping useful information available while
temporarily restricting the affected functionality is a safer fit for an audio
outage than turning the information page into a lasting server error. The latter
is an application of Google's temporary-business-pause guidance to radio pages,
not a radio-specific Google rule.

- [Google HTTP status handling](https://developers.google.com/crawling/docs/troubleshooting/http-status-codes)
- [Google guidance on temporarily restricting functionality](https://developers.google.com/search/blog/2020/03/how-to-pause-your-business-online-in)
