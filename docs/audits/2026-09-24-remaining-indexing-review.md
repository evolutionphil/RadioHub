# Remaining historical indexing cases — 24 September 2026

## Scope and decisions

Follow-up to the [production verification](2026-09-24-post-deploy-seo-verification.md), not a new site-wide crawl. Historical Search Console exclusions were compared with exact public API identities, the signed-in Deleted Stations archive, and broadcaster evidence. No blanket noindex reset, station deletion, paid generation or name-based bulk redirect was used.

Five retained duplicate identities now have sufficient evidence for a reversible, exact-ID redirect repair: Vesti FM AAC, Naxi Rock, DR P4 København MP3, W Radio 88.5 Villahermosa and Sunshine Live Classics. See the [four-identity evidence report](2026-09-24-historical-404-identity-review.md) and [Sunshine evidence report](2026-09-24-sunshine-classics-identity-review.md). Deployment and live results are recorded below when verified.

## Other 410 samples from the 450-URL noindex audit

The thirteen 410 URLs represent six identities, not thirteen separate lost stations. Locale variants include retired languages. A 410 for a genuinely removed or unverified identity is not an application outage; these addresses must not be redirected to a homepage to make an error counter disappear.

| Historical slug | Evidence collected | Decision |
| --- | --- | --- |
| `sunshine-live-classics-1` | Retained exact ID; official playlist links its official stream URL to the existing canonical record's CDN endpoint | Verified duplicate; include in the five-record repair |
| `cai-tiao-ce-shi-1` | Retained ID `68a8c4a9bd66579311ab91d1`, name `彩条测试1` (colour-bar test), explicit manual noindex, failed health check and inconsistent TV homepage | Preserve intentional exclusion; do not relabel a test feed as a radio station |
| `cnr-15-1` | No exact current identity. Deleted archive contains CNR-15 中国交通广播, removed during duplicate merge on 29 May 2026, using a `satellitepull.cnr.cn/live/wxzgjtgb/` URL. Candidate `cnr-15-zhong-guo-jiao-tong-guang-bo`, ID `6a07915dbef34beb9148bd5e`, uses `ngcdn002.cnr.cn/live/gsgljtgb/`; its retained alias does not contain the old slug. Another Liaoning regional entry also exists | Plausible national-service candidate, but no recovered old slug/UUID binding or verified delivery-chain equivalence. Keep unresolved |
| `jalisco-radio-fm-ciudad-guzmn-1071-fm-xhcgj-fm-gobierno-del-estado-de-jalisco-ciudad-guzmn-jc-1` | Deleted archive contains the same callsign/city/frequency, removed on 29 May 2026, stream path `/8136/cdadguzman`. Current candidate ID `6a07917abef34beb9148c3cf` uses `/8136/ciudadguzman`, with 14 descriptions and noindex false. Bounded checks of both endpoints returned HTML, not audio identity headers | Strong station candidate; missing exact historical slug/UUID provenance remains. Do not invent a binding or infer playback from HTTP 200 |
| `rdio-mundi-993-fm` | Exact lookup missing. Current `radio-mundi-99-3-fm`, ID `6a0791bdbef34beb9148cfc0`, is indexable with 14 locales. Deleted search found only the different station Mundial Rock | Name/frequency similarity alone is insufficient to recover an old record; unresolved |
| `salsa-927-fm-1` | Exact lookup missing. Current `salsa-92-7-fm`, ID `6a0791cfbef34beb9148d544`, is a Dominican Republic listing with 14 locales. Deleted search returned other Salsa stations, not this old identity; external listings are geographically inconsistent | Do not redirect between potentially different countries/stations; unresolved |

The [Jalisco government coverage document](https://transparencia.info.jalisco.gob.mx/sites/default/files/COBERTURA%20EN%20RADIO%20%281%29.pdf) corroborates XHCGJ 107.1 Ciudad Guzmán, but does not establish the missing RadioHub record's UUID. Official identity evidence and historical URL ownership are separate questions.

## Club FM UAE

The [separate review](2026-09-24-club-fm-identity-review.md) establishes Mathrubhumi's former Dubai Malayalam service and a documented decision to discontinue Dubai FM operations. No successor was verified. Preserve the record and current noindex, with no guessed redirect. Its existing India/current-service copy needs a coherent historical-content treatment before reconsidering indexing; this review does not claim that copy has been rewritten. The old `clubfm.ae` domain is no longer suitable as proof of an active official station.

## Remaining evidence limitations

- Seven missing historical identities remain unproven: the four missing rows above plus France Bleu `besanon`, `radio-russia`, and `1fm-movie-soundtrack` from the separate review. Recovery needs a historical export/UUID/stream or retained alias tying the exact old address to the candidate. New names or the same network alone are insufficient.
- Search Console's indexed count cannot be made to rise by an application flag or a validation request. A successful redirect only supplies the correct consolidation signal; Google decides whether and when to index its destination.
- Existing Started validations are not marked Passed locally and are not repeatedly resubmitted. The known unresolved URLs are not represented as repaired.
- The audit skill's evidence-first approach led to narrowly pinned repairs instead of broad suffix stripping, restoration or noindex removal. Squirrelscan was not rerun because the previously observed configuration/discovery problem prevents a trustworthy bounded audit; no synthetic audit score is claimed.

## Release verification

Published commit **`14a47806007f726a217eebe6d211f10e34302d71`** to `evolutionphil/RadioHub` main through the existing GitHub Desktop session; remote hash matched. Only the reviewed repair, tests, migration metadata and audit documents were committed. Unrelated visitor-details/indexing-request edits were preserved.

- Web deployment `f530e9b8-872f-4e30-b5d3-f3dae5121668`: **Active / Deployment successful**, exact commit confirmed in Details. Startup log records `[schema] applied: 0039_verified_historical_station_redirects.sql` at **15:27:52 Europe/Berlin**.
- API deployment `8fc33f2e-d36c-4a74-aeab-d8a5ce6cc10d`: **Active / Deployment successful**, same repair title and GitHub publication.
- Public reads show **all five** intended redirects set, all five target redirects still null. Hash comparison of the ten records' identity, URL, alias, country, manual/noindex and description fields is **unchanged in 10/10 records**.
- At **13:29:15 UTC**, **70/70 checks passed**: five stations × fourteen published localized routes each return exactly one 301 to their corresponding self-canonical, indexable 200 destination. Hreflang region/script subtags are accounted for (`tr-TR`, `zh-Hans`, etc.); an initial audit-script bare-language filter undercounted them and was corrected, not the application.
- Sunshine aliases `-2`, `-3`, `-4` each return one 301 to the canonical English station. The five exact historical GSC sample URLs now reach correct 200 destinations with no loop. Some obsolete-language/untranslated-path inputs still use two or three redirects through existing normalization; this release does not claim to collapse those legacy chains.
- Unproven France Bleu, Radio Russia and 1.FM historical examples, plus the explicitly excluded colour-bar test feed, still terminate at 410 as intended for this bounded decision. Club FM was not unexcluded or redirected.
- Both `/healthz` endpoints and EN/DE/TR homepages return **200**. `/sitemap-index.xml` returns **200 application/xml**, retaining **112 child sitemaps**. No large sitemap recrawl was triggered.

No additional restart, Postgres operation or new AI job was issued. The existing GitHub auto-deploy configuration also triggered its normal stream-service build; no stream-service control was manually changed. These results confirm the observed release, not perpetual uptime or Google indexing completion. This post-release addendum is local verification evidence; it was not pushed again solely to trigger another deployment.

Pre-release checks: 228 existing redirect/SSR/API tests passed (one native-PostgreSQL test explicitly skipped); 20 migration foundation/lifecycle tests passed; API TypeScript checking and default/API/web production bundles passed. Existing migration journal metadata for 0034–0038 was missing and was aligned with the existing immutable SQL files when adding 0039. No older SQL migration was edited.

The new migration also passed **9 actual SQL/PLpgSQL tests in isolated PGlite 0.3.14**, including reversible restoration, unchanged source/target content and user-reference fixtures, identity/ownership/content guards and idempotence. Native multi-connection contention remains untested. Before release, exact public reads of all ten records captured hashes of ID/UUID, name, slug/aliases, URLs, homepage, country/code, manual/noindex fields and all descriptions for post-release comparison.

Search Console live test at **24 September 2026, 15:22 Europe/Berlin** for `https://themegaradio.com/de/sender/sunshine-live-classics` returned **URL is available to Google / Page can be indexed**, with one valid Breadcrumb item. The indexed-data view previously said the URL was unknown. A subsequent request visibly returned **“Dizine eklenmesi istendi”** (added to the priority crawl queue). This is one accepted request, not proof of indexing; no repeated submission was made. The noindex issue validation remained **Started, 24 September 2026**, and was not restarted.
