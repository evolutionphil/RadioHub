# Club FM UAE identity review — 24 September 2026

## Decision

**Verified historical identity: Mathrubhumi's Club FM 99.6, a Malayalam service in Dubai / United Arab Emirates. Treat it as a discontinued service, not a verified live station or a renamed Indian station.** No supported successor or canonical redirect destination was found. The exact final broadcast date remains unverified; a date repeated by secondary directories is not sufficient to publish it as fact.

Keep the existing exclusion pending an intentional historical-page content correction. This is not another erroneous noindex recovery like Radio Fabro or Radio Fox Rock. A properly labelled, useful historical directory page could subsequently be considered for indexing; the existing inaccurate live-station copy is not ready for that decision. No change was made to production, playback, source code or flags.

## Identity and cessation evidence

- **Broadcaster-controlled identity:** the [ClubFM UAE Google Play listing](https://play.google.com/store/apps/details?id=com.clubfm&hl=en) identifies Club FM 99.6 as a Malayalam UAE service, names Mathrubhumi Printing and Publishing Co. Ltd. as its developer, gives a Dubai Media City address and links `clubfm.ae`. Its last update is **31 August 2023**. This establishes historical identity and homepage provenance, not present-day broadcasting.
- **Parent corroboration:** [Mathrubhumi's archived rate card](https://images.mathrubhumi.com/pdf/2020/Apr/rateCard.pdf) describes six Club FM stations in Kerala and one in the UAE. The [Club FM network website](https://www.clubfm.in/) also describes its expansion into Dubai; the search-visible copy is dated in substance and must not be read as proof the UAE service still operates. Direct retrieval of that network homepage failed during this review.
- **Explicit discontinuation evidence:** [ICRA's 5 December 2025 Mathrubhumi issuer report](https://www.icra.in/Rating/GetRationalReportFilePdf?id=139437), page 1, states: “the company's decision to discontinue the FM operations in Dubai to contain its losses.” Page 3 identifies the remaining six operating Club FM stations in Kerala. This is the rating agency's original company-analysis publication, not a broadcaster announcement. It supports discontinued-operation classification, but supplies no precise last-broadcast date and does not prove whether a residual automated carrier still exists.
- **Homepage no longer suitable as official station proof:** [clubfm.ae](https://clubfm.ae/) now presents a Rahul Sharma personal blog with unrelated posts, alongside inherited Club FM branding. Its surviving station claims do not override the discontinuation evidence. Current domain ownership was not investigated. No verified replacement UAE homepage or rebrand was identified; the Kerala network homepage is not an equivalent station identity.

## Exact catalog / provider observations

Fresh read-only [public catalog lookup](https://api.themegaradio.com/api/station/club-fm-uae):

| Field | Observed value |
| --- | --- |
| ID / slug | `68a8c468bd66579311aaeea7` / `club-fm-uae` |
| Retained provider UUID | `e47aab8f-91d9-4ba3-baf3-ac8a38049370` |
| Country / state | `India` / `IN`; state `UAE` — country is incorrect for this service |
| Language metadata | `en`; codes `en,ml` — primary broadcaster evidence identifies Malayalam |
| Homepage | `https://clubfm.ae/` — historically official, not verified current broadcaster content |
| Exclusion / health | `noIndex:true`; `lastCheckOk:false`; last check `2025-11-23T09:41:54Z` |
| Identity links | Empty `slugAliases`, `mergedUrls`, `mergedStationUuids`; `redirectToSlug:null`; empty `manualEditFields` |

The catalog retains 14 descriptions; the English text incorrectly presents an India-based, currently listenable service. The retained FastCast stream URL was inspected as metadata only, never opened. A single [Radio Browser lookup of the exact UUID](https://de1.api.radio-browser.info/json/stations/byuuid/e47aab8f-91d9-4ba3-baf3-ac8a38049370) returned HTTP 200 with `[]`; that node supplies no current replacement or identity history, and absence alone is not closure evidence. Narrow repository search found no additional retained alias/merge evidence.

At **13:12:17 UTC**, [the English page](https://themegaradio.com/en/station/club-fm-uae) returned **200, text/html**, self-canonical, with both robots meta and `X-Robots-Tag: noindex, follow`. It is not a current server error. See the separate [post-deployment report](2026-09-24-post-deploy-seo-verification.md) for the historical GSC 5xx sample.

## Bounded follow-up recommendation

1. Preserve this ID and slug. Correct country to **United Arab Emirates / AE**, location to Dubai and primary language to Malayalam when an editorial update is authorized.
2. Replace unsupported current shows/listening claims with factual historical wording, explicitly explaining discontinuation and uncertainty about the exact closure date. Remove `clubfm.ae` as a currently endorsed official link; retain it only as labelled historical provenance if supported by the UI. A parent-network link may be labelled as such, not as a replacement station homepage.
3. Retain noindex for the existing page now. Indexability may be reconsidered only after a coherent historical-page treatment across visible text, metadata and structured data; do not promise Google indexing. Do not redirect to Kerala Club FM, another UAE broadcaster, the network homepage or a category merely because names/frequency overlap.
4. Do not blindly stamp `manualEditFields.noIndex`: the current 200 information-page exception requires that field to be absent ([gate](../../artifacts/api-server/src/seo/junk-station-rules.ts), lines 232–236; [renderer](../../artifacts/api-server/src/seo-renderer.ts), lines 1258–1275). A manual exclusion would change response behavior and is a separate removal-policy decision.

This review used the SEO-audit evidence-first distinction between identity/content quality and crawl failures. No streams, large crawls, paid generation, admin writes or indexing requests were used.
