# Radio Fabro and Rádio Fox Rock: public repair verification

Checked **24 September 2026, 10:45–10:47 UTC**, after the targeted admin repairs. Public HTTP only, with at most two concurrent requests across the two station checks. No source files, station data, playback settings, peers or admin state were changed by this verification.

## Result

**28/28 localized canonical pages pass; all six historical noindex examples now finish at HTTP 200 with indexing allowed.**

| Retained canonical identity | Station ID | Localized pages |
| --- | --- | --- |
| `radio-fabro` | `68a8c48bbd66579311ab457f` | 14/14 pass |
| `radio-fox-rock` | `68a8c48bbd66579311ab4678` | 14/14 pass |

Both public API records return `noIndex: false`, all 14 reviewed full/meta pairs, and `manualEditFields: { noIndex: true, descriptions: true }`. The manual flags record ownership of the edits; they do **not** mean that the resulting page is noindex.

## Fourteen-language checks

Verified `en`, `es`, `fr`, `de`, `pt`, `it`, `ru`, `ar`, `zh`, `tr`, `ja`, `ko`, `hi`, and `he` for each station:

- Direct HTTP 200 at the localized canonical URL; correct HTML language and self-canonical, including percent-encoded CJK paths.
- Robots meta and `X-Robots-Tag` explicitly allow indexing and following links, with no `noindex` directive.
- The same reciprocal cluster of 14 localized URLs plus English `x-default` on every page. Regional/script labels are intentional: `tr-TR`, `it-IT`, `ru-RU`, `zh-Hans`, `ja-JP`, `ko-KR`, `hi-IN`, `he-IL`; the other six use base language codes.
- Meta descriptions and the compact station bootstrap's localized full text exactly match the saved public API descriptions and original station ID.
- JSON-LD parses successfully. `RadioBroadcastService` uses the reviewed localized full description and correct localized URL; `WebPage` and `WebSite` have the page's `inLanguage`. The broadcast service's own language describes the broadcast, not the page translation.

Final complete runs: Fox Rock **10:46:10–10:46:18 UTC**; Fabro **10:47:05–10:47:10 UTC**. This checks server-delivered HTML/bootstrap/JSON-LD, not JavaScript-rendered Rich Results validation or Google's eventual indexing choice.

## Six previously excluded examples

| Starting path | Redirects | Final canonical path | Final result |
| --- | ---: | --- | --- |
| `/af/stasie/radio-fabro` | 1 | `/en/station/radio-fabro` | 200, indexable |
| `/af/station/radio-fabro` | 2 | `/en/station/radio-fabro` | 200, indexable |
| `/en/station/radio-fabro` | 0 | `/en/station/radio-fabro` | 200, indexable |
| `/ar/mahta/radio-fox-rock` | 0 | `/ar/mahta/radio-fox-rock` | 200, indexable |
| `/ar/mahta/rdio-fox-rock` | 1 | `/ar/mahta/radio-fox-rock` | 200, indexable |
| `/ar/station/rdio-fox-rock` | 2 | `/ar/mahta/radio-fox-rock` | 200, indexable |

These are the observed pre-release redirect counts, not a claim that the pending middleware release has deployed. No loops or 4xx/5xx responses were observed for these examples.

## Scope and validation status

The earlier complete 450-URL audit remains preserved in `2026-09-24-gsc-noindex-input.json` and `2026-09-24-gsc-noindex-live.json` (source hash `272574361`, checked at 10:32:21 UTC): 431 indexable responses, these six then-noindex responses, and 13 Gone responses; zero request errors. This follow-up rechecks the repaired pages, **not** all 450 URLs again. The Gone identities and separate same-brand catalog peers were not revived or merged.

The main task observed Search Console's new noindex validation as **Started, 24 September 2026: 450 pending, 0 failed**. That is a submitted validation run, not a completed pass or an indexing guarantee. No large sitemap crawl, unit-test rerun or production mutation was performed by this verification.
