# Indexability follow-up — 20 September 2026

## Completion follow-up (same evening)

- Deployed commit `0f35e7c4867185c5ceb9a70d3e5f9d435beeb3e1` to main. Railway API and web both displayed **Active / Deployment successful**.
- Repaired the two remaining historical station URLs using exact, reviewed mappings with pinned destination IDs. Official broadcaster identity/stream evidence is documented in `2026-09-20-historical-station-aliases.md`; the old numeric suffix mapping is a reviewed inference, not a recovered archive field. No generic suffix stripping, database merge or deletion was performed.
- Regression checks: **248 tests passed**, API TypeScript check passed, production API build passed. Independent source review found no outstanding issue.
- Live checks: **31/31 passed**, including both mappings in all 14 languages plus all three previously failed GSC 404 examples. Destinations returned 200, self-canonical URLs, no noindex, and 14 language alternatives. Evidence: `2026-09-20-historical-alias-live.json`. The verifier normalizes equivalent percent-encoded/non-ASCII URL forms.
- Restarted the **404** validation after those live checks. GSC visibly reported **Validation Started, 20 September 2026; 676 pending, zero failed**. This is acceptance of a new validation, not a Google success/indexing guarantee.
- Started one full provider-catalog synchronization at `2026-09-20T20:52:03.506Z`, persisted run ID `5623c4d94d6140e45f2100f0`. It failed after 50,000 processed rows at `21:07:17.920Z`; this is NOT counted as a completed import. The two malformed provider rows were safely skipped. Evidence is preserved in `2026-09-20-production-sync-result.json`.
- Railway deployment logs identify the exact cause: provider page 11 failed with `ECONNRESET` on both de2/de1, while fr1/nl1/at1/uk1 failed DNS lookup (`ENOTFOUND`). There was no deployment/restart during the run. The old catch message incorrectly called this a cold database cluster; the failure was the upstream HTTP request.
- Implemented official SRV-based server discovery, cached/coalesced and restricted to valid Radio Browser HTTPS hosts, with known working de1/de2 fallbacks. Catalog pages opt into up to three retry rounds, a 30-second request limit and a three-minute total page budget. Retries preserve the exact GET offset; database writes are not replayed. Cancellation/leadership checks bracket attempts. Interactive by-UUID calls do not inherit the longer retry rounds. Errors now identify the provider page/run/progress instead of claiming a cold database. [Official discovery guidance](https://api.radio-browser.info/).
- API TypeScript validation and production build passed for the provider recovery patch. Targeted tests reproduce the exact page-11 reset and verify bounded exhaustion, deadline allocation, DNS filtering/cache, cancellation, and propagation of leadership errors. A new full production run must still be verified after deployment; a successful test/build is not a successful import.
- The earlier estimate based on a failed run's 4,800 progress counter was discarded: old counters were page-local. Previous successful full runs processed about 64,700 rows in 18–23 minutes. No speculative concurrency/performance change was shipped.

The sections below retain the earlier audit chronology. The two historical 404 follow-ups listed there are now repaired and submitted.

## Production changes verified

- Resumed the deployed, explicit-selection legacy-noindex recovery. Starting catalog: 62,711 records, 12,849 stored noindex flags, 5,742 eligible candidates. Applied the 5,742 candidates in bounded batches; final recovery preview returned zero further eligible candidates and 7,107 stored noindex flags. The recovery does not alter stream health, playback visibility, descriptions, or station identities. Eligibility is a structural safety screen, not a human certification of every station's editorial quality.
- Manually restored indexing for verified `classical-kdfc` (US, San Francisco) and `kiss-98-1` (US, Spokane). KISS had been conservatively blocked by unrelated Kiss-branded stations with different cities and streams. Its historical `/ly/station/kiss-981` now redirects to the Arabic canonical page and returns 200 without noindex. All 14 KISS canonical language pages passed status, noindex, self-canonical, and alternate-link checks.
- Restored the original noindex protection for `cai-tiao-ce-shi-1` / `彩条测试1`: the exact color-bar-test name escaped the previous English-only test-feed screen. No stream-content verification or station deletion was performed. A narrowly scoped name-policy regression fix is prepared locally.
- Corrected `classical-kdfc-1` from the erroneous US Minor Outlying Islands country to US. Both KDFC entries share the exact primary stream and name. After deployment, saved the reversible redirect to `classical-kdfc`. The duplicate retains its original noindex/health/content and both database records remain intact; it was NOT destructively merged. All 14 canonical destination pages passed live status/noindex/self-canonical/alternate checks, including localized country names.
- Filled the one missing Korean full description and meta description for `radio-disney-uruguay-103-7-aac-stream`. Corrected visible untranslated fragments in that record's Arabic/Hebrew descriptions and German/Chinese/Hebrew meta descriptions, preserving the other translations.
- Rebuilt sitemaps. The refreshed production health table at 22:09 Europe/Berlin reports **55,580 station URLs in each of all 14 languages**, plus 73 main and 240 genre URLs per language: **782,502 URLs**, 42 manifests. These are published sitemap counts, NOT Google's indexed-page counts. The rebuild does not fake content modification dates.
- Public sitemap-index check: HTTP 200, XML MIME type, 112 unique child sitemap URLs, all 14 languages with a sixth station chunk. Resubmitted the existing `sitemap-index.xml` in Search Console; Google displayed **Site haritası başarıyla gönderildi** (successfully submitted). EN/DE/TR home pages and robots.txt also returned 200. These HTTP checks are not Lighthouse/PageSpeed scores.
- Triggered the admin's URL discovery after the rebuild. The button returned to idle and its local GSC inspection inventory increased from 702,363 to 782,640 URLs. This historical inspection inventory is distinct from both current sitemap membership and Google's indexed count; it does not mean 782,640 Google inspections or indexing submissions were made.

## Search Console evidence

Report last updated 18 September; failed validations were started 17 September and failed 19 September.

| Group | GSC affected count | What was checked / done |
| --- | ---: | --- |
| Excluded by noindex | 440 | Exported and checked all 440 URLs (source hash 2960116571). Before the final targeted edits: 422 indexable 200 responses, six 200/noindex duplicate KDFC URLs, and twelve historical 410s; no request errors. After deployment, rechecked all seven failed WLYN/FAITH URLs plus the six KDFC URLs: all 13 end at indexable 200 pages. Restarted validation; GSC visibly confirmed **Validation Started, 20 September 2026**. The intentionally excluded color-bar test is not a legitimate station to force-index; intentional exclusions need not disappear from Google's historical report. |
| Not found (404) | 676 | Checked all three failed-validation examples. KISS is fixed. Historical `radio-onda-rossa-1` and `kiis-1065-sydney-1065-fm-mp3-1` still end in 410; no exact archived-slug ownership proof was available, so no speculative redirect was created. This validation was not restarted. |
| Crawled, currently not indexed | 49,599 | Checked **all 44 failed-validation URLs**: final 200, no noindex, zero request errors. Restarted validation; GSC visibly confirmed **Validation Started, 20 September 2026; 49,599 pending, zero failed**. This is not an indexing guarantee. |
| Soft 404 / 5xx / redirected / Google-selected canonical | 297 / 41 / 33 / 188 | Existing validations already Started; did not restart or claim completion. |
| Correct canonical / duplicate without canonical / redirect error | 266 / 69 / 61 | GSC already reports Passed. |

Evidence files: `2026-09-20-all-gsc-noindex.json`, `2026-09-20-gsc-crawled-failed.json`, and `2026-09-20-noindex-final-examples.json`. The first is the initial full audit snapshot, before the final targeted edits described above.

Historical duplicate deletion explains some lost aliases: the old bulk-delete path archived records without retaining redirect aliases. A valid repair needs the exact archived slug, a uniquely verified same-station destination and conflict checks. Similar names or stripping a numeric suffix are not sufficient proof.

KDFC's identity/location was checked against its [official public-file page](https://www.classicalcalifornia.org/kdfc-local-public-file), and KISS's Spokane identity against its [official contact page](https://kiss981.iheart.com/contact/). The recovery safety check was deliberately not broadened to treat unrelated Kiss frequencies as one station.

## Code changes / deployment boundary

- Commit `6f136ee00`: provider rows missing required UUID/name/URL are skipped with bounded diagnostic samples and cumulative counters instead of aborting the daily sync transaction. Real database failures still fail visibly. 24 focused sync tests passed; API typecheck passed before the additional changes below.
- Additional local changes: exact Chinese color-bar test-name exclusion; ISO-code-based localization for generated station SEO country names; a reversible duplicate redirect admin operation; dated public GSC audit outputs. English source wording, stored descriptions and editorial overrides are preserved by the localization change.
- The redirect editor saves/clears only the redirect field. It requires an existing indexable, unredirected target with all 14 full/meta descriptions and the exact normalized station name and primary stream endpoint; rejects stale edits, chains/cycles and ambiguous canonical slugs; preserves both records and user references. Existing cached permanent redirects can remain for five minutes after clearing.
- Verification batches: 197 focused SEO/policy/localization tests; 47 backend redirect/regression tests (including real SQL via PGlite); 36 frontend editor tests; API and frontend TypeScript checks. Both production builds passed. Frontend emitted non-fatal source-map and large-chunk warnings; no claim of a perfect PageSpeed score is made.
- Initial CLI pushes failed with 403 because Git Credential Manager uses `Mooxergames`. Desktop initially offered a fork, which was cancelled; later its existing session completed the main push. GitHub Desktop's commit-author avatar is not evidence of which authentication account performs a push. No fork, credential extraction, account modification or force-push was performed.
- Remote main was verified at `4afebf625969f47d4d317d514021fda615c378dd`. Railway then showed both API and web **Active / Deployment successful** for `Add reversible station redirects and verify multilingual indexing`. The earlier sync fix `6f136ee00` was also verified deployed. The browser's new redirect editor was used successfully in production.
- A complete post-fix catalog sync has **not** been run/verified this turn. Its scheduled execution remains configured; build and regression success is not proof of a completed production sync. Public EN/DE/TR home pages, robots.txt, sitemap XML and the KDFC canonical pages were checked after the relevant changes.

## Remaining follow-up

1. Finish identity-backed historical alias repairs (or keep genuinely removed URLs at 410). Do not redirect unrelated/missing stations to the home page to hide 404s. The two remaining failed 404 examples were not speculatively reassigned or resubmitted as fixed.
2. Verify the next repaired catalog sync; refresh sitemap/GSC discovery if its catalog changes.
3. Review Google's asynchronous validation results. Started does not mean Passed, and crawlability does not guarantee indexing.
4. Continue editorial/duplicate review for records excluded by recovery's conservative safety rules. The remaining stored noindex count is not a promise that every record should be indexed.

## Guidance followed

The SEO-audit workflow separated crawl/index directives from Google's discretionary indexing and preserved intentional exclusions. Google explains these states and validation behavior in the [Page indexing report documentation](https://support.google.com/webmasters/answer/7440203); robots directives are covered by the [robots meta documentation](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag). Safe computer-use handling prevented an unintended repository fork or credential disclosure.
