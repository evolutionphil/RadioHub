# Джем FM: production indexing repair verification

Checked **24 September 2026, 10:25–10:26 UTC**, after the operator's targeted admin repair and sitemap rebuild. Read-only public HTTP checks; no production writes or paid generation were performed by this verification.

## Repaired record

The public API returns station `68a8c4a6bd66579311ab887d`, canonical slug `dzhem-fm`, with `noIndex: false`, all **14 full/meta description pairs**, and `manualEditFields: { noIndex: true, descriptions: true }`. Historical alias `fm-100` still resolves to this record. The separate candidate `dzhem-fm-1` was not merged or modified by this check.

## Fourteen localized pages

**14/14 passed** for `en`, `tr`, `es`, `fr`, `de`, `ar`, `it`, `pt`, `ru`, `zh`, `ja`, `ko`, `hi`, and `he`:

- HTTP 200 directly at each localized canonical URL.
- Both robots meta and `X-Robots-Tag` permit indexing and following links; neither contains `noindex`.
- Correct HTML language and self-canonical, including encoded CJK paths.
- An identical reciprocal cluster of **14 language variants plus `x-default`** on every page.
- Meta description and the compact station bootstrap's full description exactly match the reviewed locale text.
- Valid JSON-LD containing `RadioBroadcastService` with the reviewed localized full description and localized URL; `WebPage` and `WebSite` carry the correct `inLanguage`.
- Mega Radio and Vision GO organization descriptions and navigation breadcrumbs are localized. Station/brand proper names remain unchanged.

This verifies server-delivered HTML and JSON-LD, not a JavaScript-rendered Rich Results Test or Google's indexing decision.

## Previously failing Search Console examples

All four finish at **HTTP 200, indexable** `https://themegaradio.com/en/station/dzhem-fm`:

| Starting path | Redirects before final 200 |
| --- | ---: |
| `/af/stasie/fm-100` | 2 |
| `/af/station/fm-100` | 3 |
| `/en/station/fm-100` | 1 |
| `/en/station/dzhem-fm` | 0 |

No loop or 4xx/5xx was observed. These are pre-deployment redirect counts; shortening the historical chains is a separate code release. Afrikaans is not one of the 14 published locales.

## Published sitemap evidence

`/sitemap-index.xml` returned HTTP 200, XML MIME, 112 child entries, and the expected 14 languages. Its EN station chunk 3 reports the repair timestamp.

A **single bounded stream** of `/sitemap-stations-en-3.xml` found the exact `dzhem-fm` entry after **344,064 decoded bytes**, then cancelled the remaining response. The entry has:

- `<lastmod>2026-09-24T10:18:00.443Z</lastmod>`;
- all 14 localized destinations, regional/script aliases, and English `x-default`;
- the station's own S3 logo.

No full sitemap crawl was run. Membership as `<loc>` in the other 13 large child files was not independently downloaded; their destinations are present in the verified EN entry and all return the canonical indexable pages described above.

## Remaining non-blocking editorial observations

Some country/title templates still produce awkward case or word order, notably Turkish `Rusya'den` and Russian `из Россия`. The station schema's category retains the source tag `смешанный` outside Russian. These do not reintroduce `noindex`; they remain separate localization improvements, not claimed fixed by this targeted repair.

The installed Squirrel CLI was not rerun because its sitemap discovery is not bounded by the page limit. **No new whole-site score or PageSpeed score is claimed.**
