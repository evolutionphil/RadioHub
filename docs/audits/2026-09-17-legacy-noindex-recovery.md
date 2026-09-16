# Legacy noindex recovery — 17 September 2026

## Scope and evidence

The live catalog contained 62,020 stations. The sitemap eligibility audit returned
48,701 unique eligible stations per locale, not a count of Google-indexed pages.
There were 13,294 stored `noIndex` flags. Other exclusions include redirects and
numeric/invalid slugs; the 13,319 sitemap difference is not one homogeneous error.

The new read-only preview identified 453 conservatively recoverable records:
all 14 full descriptions and meta descriptions present, recent positive provider
evidence, known station identity, no plausible identity/stream/slug peer, no manual
protection, redirect or current junk rule. This is a safe subset, not proof that
every remaining exclusion is correct.

Initial disjoint preview reasons included 7,956 without positive provider-health
evidence, 1,501 plausible identity peers and 646 incomplete descriptions. Reason
ordering matters: these are not independent diagnoses. In particular, lack of
positive stream-health evidence does not justify SEO noindex. Incomplete records
must also pass peer checks before paying for translation.

## Live verification

Pilot `92-citi-fm`: public station data contained all 14 languages and `noIndex:
true`, while the English URL returned 410. After the selected recovery it returned
200, `noIndex: false`, and all 14 localized HTML URLs passed HTTP 200, absence of
noindex, self-canonical and 14 hreflang alternatives. Private repair receipts were
not exposed by the public station API.

The repair modifies only the noindex state, update timestamp and a private native
JSONB audit journal. Existing descriptions, streams, names and URLs are preserved.
Every batch uses a fresh preview and rechecks identities under a short write fence.
No automatic retry is made on an uncertain response.

One batch returned HTTP 503 after approximately eight seconds, while the subsequent
read-only preview confirmed its 25 rows were committed. A follow-up hardening fix
checks exact durable private receipts on ambiguous commit errors and bounds cache
waiting. The precise production 503 trigger was not established from HTTP logs.

## Admin stream-status explanation

`Needs verification` is not equivalent to offline and does not itself hide a radio.
Only an explicit non-visible state hides it from lists, with expiry protection.
A successful local check remains fresh for 24 hours, while the next successful
station check is scheduled seven days later; therefore a previously working radio
can legitimately show this uncertainty label. These visibility rules are separate
from the SEO noindex/redirect/content gates.

## Remaining work

All 453 preview-qualified recoveries completed in live selected batches. An
intermediate rebuild published 48,977 station entries per locale after 276 repairs;
the final rebuild was triggered after all 453 repairs. Refreshed live health rows
confirmed all 14 locales at 49,154 entries each. The final read-only preview showed
62,020 total stations, 12,841 stored noindex flags and zero remaining candidates
under this conservative recovery policy. The first two
sample stations (`92-citi-fm`, `100-hitradio`) passed HTTP/robots/canonical/hreflang
checks across all 14 locales; this does not certify every translated phrase.
The latter still exposes the English country alias “The United States Of America”
inside localized titles, which is a separate localization follow-up, not a noindex
failure. No blanket claim of perfect multilingual SEO is supported.

The public sitemap index returned HTTP200 XML with 98 children; English, German
and Turkish station chunk1 endpoints returned HTTP200 XML with10,000 URLs each.
These public spot checks are not an exhaustive download of every XML entry.
Do not equate sitemap inclusion with guaranteed Google indexing.
Do not mass-translate all excluded stations or clear unknown flags blindly.
Any incomplete-content candidates need all non-content eligibility checks before
the existing missing-only GPT-4o-mini job is started for explicit selected IDs.

Fresh Search Console overview check after recovery still showed report update
14 September: 404 (646), noindex (416), crawled-not-indexed (50,906) Failed;
soft404 (299), 5xx (50), redirected pages (33), Google-selected-other-canonical
(207) Started. No new GSC validation was initiated in this recovery operation.
Those report counts are not the database recovery candidate counts.
