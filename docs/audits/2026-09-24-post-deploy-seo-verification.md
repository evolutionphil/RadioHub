# Post-deployment SEO verification — 24 September 2026

## Release and method

Source commit: **`819ca2075`**. The main task confirmed both Railway deployments successful and active before the deployment smoke check:

- Web: `c1a63a0b-a732-4435-a7bd-4a41a733d3a7`.
- API: `02ee5625-94e5-42fc-a3e7-adb7f6da6a13`.

The final captured public HTTP pass ran **10:53:12–10:53:14 UTC** with at most two concurrent requests. **18/18 expected outcomes passed**. These were bounded GETs with explicit redirect following; no sitemap children, streams, admin actions, production writes or source edits. Existing committed audit reports were left unchanged.

The main task also observed web startup at 12:51:49 Berlin, migrations 0037/0038 already applied, and no crash in the inspected deployment log. Nonfatal `url.parse`/`util._extend` deprecation warnings and SG/TH geographic-block entries were present; this is not a claim of warning-free logs. No security setting was changed.

## Guarded one-hop redirects

Each verified eligible legacy route now uses exactly one HTTP 301 to the indexable, self-canonical HTTP 200 destination. The retained station IDs also match for Джем FM and Radio Fabro.

| Starting path | Final path | Redirects | Result |
| --- | --- | ---: | --- |
| `/af/station/fm-100` | `/en/station/dzhem-fm` | 1 | 200, indexable |
| `/af/stasie/fm-100` | `/en/station/dzhem-fm` | 1 | 200, indexable |
| `/af/station/radio-fabro` | `/en/station/radio-fabro` | 1 | 200, indexable |
| `/am/ጣቢያ/labgate-progressive-rock` | `/en/station/labgate-progressive-rock` | 1 | 200, indexable |

These are observed warm-service results, not a claim that an unavailable/cold identity cache skips its safe fallback.

## Preserved exclusions and core pages

All seven previously reviewed missing/excluded historical examples still finish at **HTTP 410, text/plain, noindex**, without a guessed replacement or homepage redirect:

- `/ar/station/france-bleu-besanon`
- `/af/station/fm-aac-1`
- `/af/station/radio-russia`
- `/af/station/naxi-radio-rock-1`
- `/am/station/1fm-movie-soundtrack`
- `/zh/station/dr-p4-kbenhavn-mp3`
- `/am/station/w-radio-885-villahermosa-885-fm-xhkv-fm-grupo-radio-can-villahermosa-tabasco-1`

The following remain direct **HTTP 200, text/html, indexable and self-canonical**:

- Homepages: `/en`, `/de`, `/tr`.
- Repaired stations: `/en/station/dzhem-fm`, `/en/station/radio-fabro`, `/en/station/radio-fox-rock`. Their original station identities are preserved.

`/sitemap-index.xml` returns **HTTP 200, application/xml**, with **112 child sitemap entries across 14 languages**: ar, de, en, es, fr, he, hi, it, ja, ko, pt, ru, tr, zh. No large child sitemap crawl was performed.

## All 39 historical server-error examples

A separate bounded pass over the exact 39 paths supplied from the current Search Console table ran **10:51:54–10:52:07 UTC**, during deployment preparation/transition:

| Current terminal result | Count |
| --- | ---: |
| HTTP 200, indexable | 33 |
| HTTP 200, noindex | 1 |
| HTTP 410 Gone | 5 |
| HTTP 5xx or request errors | **0** |

The five Gone examples are `/sy/station/angel-radio-1`, `/pt/station/q-1007-fm-1`, `/pt/station/abdulbasit-abdulsamad-33`, and the `/be/station/` and `/it/station/` variants of `fluxfm-mobys-vegan-radio`. A Gone response is not a server failure.

The one retained noindex page is `/da/station/club-fm-uae` → `/en/station/club-fm-uae`, station **`68a8c468bd66579311aaeea7`**. Public API readback: `noIndex:true`, `lastCheckOk:false`, no manual ownership flags or redirect, 14 stored descriptions, and catalog country `India`. This is a separate unresolved identity/content-quality decision, **not** a current HTTP 5xx.

The main task's separate read of the listed [clubfm.ae homepage](https://clubfm.ae/) found unrelated personal-blog material rather than usable current broadcaster identity evidence. Do not treat that domain as authoritative station proof or clear the exclusion blindly. Preserve it pending reliable primary evidence; this verification made no recovery change.

## Limits

These observations confirm public response behavior at the recorded times. They do not prove sustained uptime, playback health, the correctness of every remaining catalog exclusion, or Google indexing/validation completion. The existing server-error validation was already running; no validation or indexing request was submitted by this verifier.
