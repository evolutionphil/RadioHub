# Search Console follow-up — 24 September 2026

## What Google currently reports

Read directly from the authenticated `sc-domain:themegaradio.com` property. The
Page indexing summary is dated **21 September**, while validation failures and
individual inspections include later crawls. These are different reporting clocks.

| All known URLs | Count | Validation |
| --- | ---: | --- |
| Indexed | 6 | — |
| Not found (404) | 679 | Failed 22 September; 7 failed examples |
| Excluded by noindex | 450 | Failed 22 September; 4 failed examples |
| Crawled, currently not indexed | 49,525 | Failed 22 September; 41 failed examples |
| Soft 404 | 297 | Started; not restarted |
| Server error | 39 | Started; not restarted |
| Page with redirect | 29 | Started; not restarted |
| Google chose another canonical | 165 | Started; not restarted |
| Alternate with proper canonical | 241 | Passed |
| Duplicate without user canonical | 68 | Passed |
| Redirect error | 61 | Passed |

The **submitted URLs** filter is materially different: 185,600 discovered but not
indexed, 1,270 crawled but not indexed, one Google-selected-other-canonical,
**zero noindex**, and one indexed. Historical exclusions must not be presented as
current sitemap defects. No manual action or security issue is reported.

The earlier September22 audit's seven accepted indexing requests were not seven
confirmed indexed pages. No prior seven-URL indexed snapshot is available here,
so the identity or reason for a reported seventh URL disappearing is unproven.
Four of the six currently listed indexed examples use historical unsupported
locales. The two others are `/en` and `/ko`.

## Live evidence

- All **41 fresh failed crawled-not-indexed examples** terminate at HTTP200 with
  indexable robots directives. Exact input and redirect/canonical responses are
  in `2026-09-24-gsc-crawled-input.json` and `2026-09-24-gsc-crawled-live.json`.
  The check uses at most two concurrent requests and does not reproduce Google's
  quality or canonical selection decisions.
- Expanded the current noindex example table to all450 rows, captured every
  URL and verified identical browser/file source hash272574361. A two-worker
  public scan finished10:32UTC:437HTTP200,13HTTP410,zero network errors. After
  the Dj em FM repair, six200 responses still contained noindex, representing
  two identities (`radio-fabro`, `radio-fox-rock`) and their historical aliases.
  The13gone pages also carry noindex. They remain excluded; some historical
  identities still need evidence before a replacement redirect is justified.
  This baseline is retained
  in `2026-09-24-gsc-noindex-live.json`, not overwritten by later repair checks.
- `/de`: Google's recorded September22 crawl succeeded, allowed indexing and
  selected the inspected canonical. Google's September24 live test says the URL
  is available for indexing. Its mobile screenshot renders German content and
  station cards, with no JavaScript console messages. One of73 resources is
  blocked: private `/api/auth/me`. That intentional authentication endpoint
  exclusion must not be removed to make a diagnostic counter green.
- `/de/sender/shirley-spinoza`: the canonical-selection report refers to a
  **22 November2025** crawl. September24 live test passes and detects one valid
  breadcrumb item. The new indexing request was visibly accepted.
- Public robots and sitemap index return200. Index contains112 children covering
  the14 published locales. Googlebot-labelled public fetch also returns XML200.
  All29 directly submitted sitemap rows say Successful; several children were
  read onSeptember24. Google's index-file row still reports0 discovered and last
  readSeptember20; this is not proof the live index is empty.

## Actual defects isolated

1. Four failed noindex examples (`/af/stasie/fm-100`, `/af/station/fm-100`,
   `/en/station/fm-100`, `/en/station/dzhem-fm`) resolve to the same retained
   station `68a8c4a6bd66579311ab887d`, canonical `dzhem-fm`. All14 localized
   pages initially inherited its stored noindex. Its historical translations also
   contain English sentence starters inside Turkish, Hebrew, Hindi and Korean.
   A same-family peer `dzhem-fm-1` has no descriptions and is excluded; the safe
   recovery preview correctly refuses an automatic ambiguous-identity recovery.
2. Known non-excluded stations on retired locale URLs unnecessarily pass through
   a localized legacy route before the English canonical. Collapse these only
   when the existing identity cache knows a safe destination. Do not infer new
   aliases, revive exclusions, or route missing stations to the homepage.
3. Translation validation detects source copies and missing scripts, but did not
   detect the observed mixed English openers. A narrow proper-name-aware guard
   is warranted; it is not a general language detector or quality guarantee.

## Historical 404 validation examples

All seven now end in410/noindex, not current404. Four are retained excluded
records: `fm-aac-1` (canonical `vesti-fm-aac`), `naxi-radio-rock-1`,
`dr-p4-kbenhavn-mp3` (canonical `dr-p4-kobenhavn-mp3`) and the old W Radio
Villahermosa slug. Three missing old identities (`france-bleu-besanon`,
`radio-russia`, `1fm-movie-soundtrack`) have plausible modern name matches but
not an established historical identity link. Do not invent redirects from names
alone. A410 for intentionally retired material is valid and is not a promise
that a global “404 fixed” validation will pass.

## References and limits

- Google Page indexing report: https://support.google.com/webmasters/answer/7440203
- Recrawl requests: https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl
- Localized variants: https://developers.google.com/search/docs/specialty/international/localized-versions
- Station identity: retained provider homepage redirects to
  https://pcradio.app/radio/dzhem-fm-ekaterinburg-live-pcr-27lg1un/ and identifies
  Джем FM in Yekaterinburg,102.5FM, linking https://jamfm.ru/.
  https://jamfm.ru/contacts corroborates the city/address. Prefer the existing
  rich canonical identity, without deleting the peer or transferring user data.

The installed squirrel0.0.95 audit tool rejected its generated configuration
before scanning, and does not bound huge sitemap discovery with its page cap.
Direct scoped HTTP checks were used instead. No fresh squirrel score is claimed.
Neither successful live tests nor accepted requests guarantee indexing. Validation
must be specific to the repaired issue: an intentionally retired410 URL need not
be revived to clear a historical noindex report. A global all-URLs-indexed claim,
or an assertion that every historical404 now has a proven replacement, is not
supported.

## Changes and post-deployment verification

- Repaired `dzhem-fm` through the existing authenticated station editor: all14
  reviewed full/meta pairs and the allow-indexing setting were saved. Public API
  readback confirms `noIndex:false` and `manualEditFields:{noIndex:true,
  descriptions:true}`. No station was deleted/merged and no stream, playback,
  favorites or user data was changed. The ambiguous peer remains untouched.
- Rebuilt the sitemap manifests through the SEO Maintenance UI. All42 manifests
  cover14 locales and now show generatedAt24September12:23 (Berlin). The repaired
  station's content timestamp is12:18. No mass timestamp rewriting was used.
- Added a cache-only, guarded single-hop shortcut for known non-excluded retired
  locale station identities. Active14 locales, missing/excluded/numeric records,
  cold-cache and non-GET/HEAD behavior retain existing policy. Encoded/Unicode
  slug components are deliberately not shortcut: a fixture exposed an existing
  English raw-slug lookup inconsistency, not a verified live regression.
- Added proper-name-aware English-opener checks to full/meta generation and
  translation validation. Failed full translations are rejected without replacing
  existing content; a bad meta may be derived only from accepted full prose.
- Validation: redirect/identity suites271/271; description suites101/101; API
  TypeScript noEmit passes. Production builds pass for index.ts, index-api.ts and
  index-web.ts. No new migration, model call, background AI job or dependency.
- Before release, read all37 `bulk_description_jobs` records in Railway. None
  running. The September21 main job is completed14526/14526,11085successful,
  40failed,3401skipped, publication completed. A subsequent repair scan completed
  with40failures and4119skips; these are not relabeled as successes. Historical
  paused/cancelled records were not resumed or edited.

- `/en/station/dzhem-fm`: Google's September24 12:23 live test says the URL is
  available and indexable, with one valid breadcrumb. The subsequent request
  visibly reached **Dizine eklenmesi istendi** (accepted into the crawl queue).
  The stored September21 noindex report is historical, not the new live result.

Source release outcomes are recorded after observation.

## Additional live content repairs

The complete450-URL scan isolated two additional live noindex identities, not
450 new broken pages. Through the authenticated station editor, repaired:

- `radio-fabro`, ID `68a8c48bbd66579311ab457f`: official
  https://radiofabro.com/ identifies the Jesuit station in Córdoba, Argentina,
  presenting music, spiritual programmes and podcasts. Replaced mixed-language
  and unsupported promotional prose with14 factual full/meta pairs.
- `radio-fox-rock`, ID `68a8c48bbd66579311ab4678`: official
  https://radiofoxrock.com.br/ identifies Sorocaba, Brazil,87.7FM, and classic/
  contemporary rock. Replaced14 full/meta pairs, including mixed English
  Hindi/Arabic prose and a broken Spanish opener.

Both old rich canonical records had `noIndex:true` without a recorded manual
reason. After identity/content review, enabled search indexing on those records.
Their newer thin peers were not merged, deleted or re-enabled. Official player
links differ from the old records' streams; stream replacement/playback recovery
is not claimed by this SEO change. No favorites, user data or station ID changed.
These edits are manually protected against subsequent automatic overwrites.
The sitemap rebuild was requested again after the final edit, without any bulk
timestamp operation. The separate verification report records actual HTTP results.

The final sitemap UI readback confirms42 active manifests across14 locales,
786,492URL entries, generated24September12:44Berlin (28 more entries than the
Dzhem-only rebuild, corresponding to the two additional14-language records).

## Search Console resubmission

After the targeted production edits, started a new validation for **Excluded by
noindex**. Search Console visibly reports **Doğrulama Başladı**, start date
24September2026,450pending and0failed. This is the initial accepted validation
state, not a completed pass or450 indexed URLs. Existing in-progress5xx, soft404,
redirect and canonical validations were not restarted. The failed historical404
category was not marked repaired without proven replacement identities. The
crawled-not-indexed category remains a Google indexing selection issue after
the41-example live checks; no claim that resubmission forces indexing is made.
