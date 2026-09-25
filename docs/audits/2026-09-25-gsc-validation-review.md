# Search Console failed validation review — 25 September 2026

## Fresh authenticated evidence

Property: `sc-domain:themegaradio.com`. UI read during the evening in Europe/Berlin.
The Page indexing summary still says **last updated 21 September**. Both failed
validations began 20 September and failed **22 September**, before the verified
historical redirects deployed on 24 September. These are not new failures of
today's deployment.

| All known URLs | Reported count | Validation |
| --- | ---: | --- |
| Crawled, currently not indexed | 49,525 | Failed; 41 failed examples, 49,484 pending |
| Not found (404) | 679 | Failed; 7 failed examples, 672 pending |
| Excluded by noindex | 450 | Started; do not restart |

The separate **all submitted pages** filter reports 185,600 discovered-not-indexed,
1,270 crawled-not-indexed, one different canonical, zero noindex, and one indexed.
No 404 category appears in that submitted-page view. This is Google's dated
report, not a complete real-time sitemap crawl.

## Crawled, currently not indexed

Captured all 41 **failed validation** URLs, not merely the first ten examples.
Their sorted source hash is **3521457917**, matching the retained 24 September
input exactly. Re-ran public GET checks with two concurrent workers, bounded
timeouts, and same-origin redirect following. Completed 25 September 18:49 UTC:

- 41/41 final HTTP200; zero noindex, network errors or final canonical mismatches.
- 28 unique final destinations: historical aliases are not separate broken pages.
- Results: `2026-09-25-gsc-crawled-live.json`.

Independently inspected **`/tr/istasyon/kral-fm`** in Google URL Inspection.
Google's recorded 22 September 01:52:35 smartphone crawl succeeded, allowed
crawling and indexing, and selected the inspected self-canonical URL. The sitemap
field says temporary processing error; that field alone does not establish that
the current sitemap is invalid or that it prevents indexing.

Google's fresh live test at **25 September 20:57 Berlin** says the URL is available
to Google and can be indexed, with one valid breadcrumb. Its rendered smartphone
screenshot shows the logo, station player, Turkish description and ratings, not a
blank page or access barrier. A successful live test is **not an indexing decision**.

The failed validation means Google's checked examples were still not indexed on
22 September. No current robots, noindex, canonical or fetch failure was found
for those 41 examples. The UI does not disclose a more specific selection/quality
reason; do not claim a proven algorithmic cause or promise that clicking validation
again forces indexing.

One content-quality concern is visible in Kral FM's current Turkish description:
generic promotional paragraphs and an English “Listen on Mega Radio” phrase.
This is an editorial finding, **not proof of Google's exclusion reason**. Do not
replace station facts, fabricate programmes or bulk-generate more text merely to
clear this report. Earlier unpublished blog work is separate from this review.

## Complete historical 404 example scan

Read both table pages (500 + 179). Grouped source file
`2026-09-25-gsc-404-groups.json` reconstructs exactly **679 URLs**, verified against
the current UI's sorted source hash **1844214405** before any HTTP scan.
Completed 18:58 UTC with two public GET workers:

| Current final response | URLs |
| --- | ---: |
| HTTP200, indexable | 129 |
| HTTP200, noindex | 29 |
| HTTP410, noindex | 521 |
| HTTP404 / 5xx / request errors | 0 |

The 521 Gone URLs resolve to 406 distinct final URLs. This does **not** prove
that every historical removal was correct; exact retained identities and stored
exclusion state must be reviewed before restoring content or adding a redirect.
Results: `2026-09-25-gsc-404-live.json`.

The seven failed validation examples are unchanged from 24 September. Four
verified identities were already repaired in migration0039: Vesti FM AAC, Naxi
Rock, DR P4 København MP3, W Radio Villahermosa. The three unresolved old identities
are `france-bleu-besanon`, `radio-russia`, `1fm-movie-soundtrack`. Their plausible
name matches do not establish original station identity. See the earlier
historical-404 identity review for evidence and limitations. No guessed suffix
stripping, cross-station redirect, homepage fallback or fabricated200 page is used.

## Code review scope

### Exact-identity follow-up (read-only)

The retained API audit (`2026-09-25-gsc-404-identities.json`) classifies the
550 nonindexable responses: one genre URL and 549 station URLs. Of those station
URLs, 322 have no current exact identity, 225 resolve to records whose exclusion
ownership is not recorded, and two resolve to an explicitly manually excluded
colour-bar test feed. The 29 HTTP200/noindex URLs represent 26 retained stations.
Nonempty translations alone do not establish identity continuity or permission
to remove an exclusion. No guessed redirects or bulk noindex removal were made.

Production's read-only recovery preview examined 63,068 stations, including
7,106 noindex records. Its conservative identity/content safeguards admitted only
`somoa` (ID `68a8c49bbd66579311ab6cc3`), which is absent from these 679 GSC URLs.
It was therefore left unchanged; no recovery operation was applied.

Two independently reproducible routing issues were uncovered during review:

1. English percent-encoded Unicode station identifiers were not decoded before
   exact lookup, unlike other locales. Fix one-pass segment decoding with tests
   across all14 locales, including malformed/double-encoded input.
2. Direct `redirectToSlug` handling trusted the stored destination without checking
   whether it remained an eligible, existing final station. Validate the target
   and preserve temporary database error semantics, rather than permanently
   pointing crawlers into missing/excluded targets.

Neither is asserted to be the cause of the 41 Google exclusions. Regression and
release results are recorded after they are observed. Pre-existing dirty blog
work is preserved and must not be silently included in a scoped release.

### Local verification

- 321 tests passed across seven focused regression suites, covering localized
  URL handling, direct redirects, transient failures, canonical/hreflang and
  compatibility with the separate blog work.
- API-server and shared SEO TypeScript checks passed.
- Both production server entries (`src/index-api.ts`, `src/index-web.ts`) built
  successfully, with the PostgreSQL-only dependency boundary enforced.
- These checks used the current working tree; deployment status is not implied.

## Google guidance

- [Page indexing report](https://support.google.com/webmasters/answer/7440203):
  crawled-not-indexed is a selection state, not necessarily an implementation
  error; removed URLs without an equivalent replacement need not be redirected.
- [HTTP status handling](https://developers.google.com/crawling/docs/troubleshooting/http-status-codes):
  real gone/not-found content must keep an appropriate non-success status.

No new validation or repeated indexing request has been submitted in this review
so far. In-progress validations are preserved. A global “all404 fixed” claim is
not justified while historical identity recovery remains unresolved.
