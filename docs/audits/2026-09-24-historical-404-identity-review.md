# Historical 404 identities — read-only review, 24 September 2026

## Scope and result

Reviewed the seven historical examples in `2026-09-24-post-deploy-seo-verification.md`. Their current public-page outcome was already recorded as **410**, not a new server error. This investigation used exact public station lookups, seven bounded catalogue searches, individual candidate lookups, broadcaster pages and source history. No records, redirects, descriptions, exclusions, subscriptions or production settings were changed.

**Four retained identities have strong evidence for exact, pinned redirects to existing indexable records. Three missing identities remain unresolved.** A modern name match is not proof that a deleted historical URL represented that record.

| Historical identifier | Current identity / proposed destination | Decision |
| --- | --- | --- |
| `france-bleu-besanon` | Candidate `france-bleu-besancon` | **Unresolved:** original record/UUID/alias evidence missing |
| `fm-aac-1`, canonical `vesti-fm-aac` | `vesti-fm-vesti-fm` | Strong: retained old alias + matching broadcaster and live stream identity headers |
| `radio-russia` | Candidate `radio-rossii` | **Unresolved:** generic historical name; no original identity evidence |
| `naxi-radio-rock-1` | `naxi-rock-radio` | Strong: exact same URL/resolved stream, broadcaster and country |
| `1fm-movie-soundtrack` | Candidate `movie-soundtracks-hits-radio-1-fm` | **Unresolved:** no old UUID, stream or alias evidence |
| `dr-p4-kbenhavn-mp3`, canonical `dr-p4-kobenhavn-mp3` | `dr-p4-kobenhavn` | Strong: retained old alias + exact resolved stream and official regional homepage |
| `w-radio-885-villahermosa-885-fm-xhkv-fm-grupo-radio-can-villahermosa-tabasco-1` | `w-radio-88-5-villahermosa-88-5-fm-xhkv-fm-grupo-radio-canon-villahermosa-tabasco` | Strong: same stream, XHKV-FM callsign, 88.5 frequency and city |

## Four evidence-backed mappings

All four source records still exist with `noIndex:true`, no redirect, no manual ownership flags, and 14 stored description locales. All four proposed targets were independently fetched by exact slug: **HTTP 200, indexable**, `noIndex:false`, no redirect and 14 description locales. Language-field presence is not a full editorial audit.

### Vesti FM: AAC encoding is the same national service

- Source ID: `68a8c4a6bd66579311ab8808`; provider UUID: `29a68b7f-f573-4b19-b3ba-cdbb0979e348`.
- Source canonical: `vesti-fm-aac`; stored aliases include `fm-aac-1` and `vesti-fm-aac-1`.
- Target ID: `68a8c4a6bd66579311ab880c`; provider UUID: `961da649-0601-11e8-ae97-52543be04c81`; canonical: `vesti-fm-vesti-fm`.
- Both records identify the national Vesti FM broadcaster and `radiovesti.ru`. Its [official homepage](https://radiovesti.ru/) redirects to [Smotrim's Vesti FM channel](https://smotrim.ru/channel/199).
- A bounded header-only observation of the two exact catalogue endpoints returned:

| Endpoint | HTTP / format | `icy-name` | `icy-description` |
| --- | --- | --- | --- |
| `https://icecast-vgtrk.cdnvideo.ru/vestifm_aac_32kbps` | 200 / audio-aacp, 32 kbps | Radio Vesti FM | Radio Vesti FM (VGTRK) |
| `http://icecast.vgtrk.cdnvideo.ru/vestifm_mp3_64kbps` | 200 / audio-mpeg, 64 kbps | Radio Vesti FM | Radio Vesti FM (VGTRK) |

Both response bodies were cancelled immediately after headers; no audio playback or sustained download was performed. This supports a codec-variant identity mapping, not a general rule that similar stream filenames or regional Vesti stations are interchangeable.

### Naxi Rock

- Source ID: `68a8c480bd66579311ab2a2a`; provider UUID: `365b3039-a72c-4770-99c5-1d0185553ba3`.
- Target ID: `68a8c480bd66579311ab2a2b`; provider UUID: `b873245f-c6fe-40c0-a9f3-4bbe5402c281`.
- Both `url` and `urlResolved` are exactly `https://naxidigital-rock128ssl.streaming.rs:8182/;`; both records specify Serbia and the Naxi broadcaster.
- The target's [official Naxi Rock page](https://www.naxi.rs/rock) returns 200 and identifies that digital channel. The broadcaster's [launch announcement](https://www.naxi.rs/premijerno-naxi-rock-radio) independently distinguishes it from Naxi's other channels.

### DR P4 København

- Source ID: `68a8c46cbd66579311aaf66b`; provider UUID: `d730e041-05fd-421d-a39b-7b2da3f9bdae`.
- Target ID: `68a8c46cbd66579311aaf669`; provider UUID: `960f5358-0601-11e8-ae97-52543be04c81`.
- Both resolved streams are exactly `http://live-icy.dr.dk/A/A08H.mp3`. The target's catalogue URL is the corresponding `.mp3.m3u` playlist.
- Both share the official `http://www.dr.dk/p4kbh` homepage, which a direct HTTP fetch followed to the 200 [DR P4 København page](https://www.dr.dk/lyd/p4kbh). Country is Denmark. This does not authorize redirects to another P4 region.

### W Radio 88.5, Villahermosa

- Source ID: `68a8c458bd66579311aac72f`; provider UUID: `c54c9b7e-925d-4b2d-b73b-9367237e3708`.
- Target ID: `68a8c458bd66579311aac72e`; provider UUID: `38a0d940-ec1a-4ad0-bca9-e10a1c9a0ed7`.
- Both URL fields exactly match `https://streaming.servicioswebmx.com/8256/stream`. Both names specify **XHKV-FM, 88.5 FM, Villahermosa, Tabasco**; country/city agree. The source's historical malformed slug is retained in `slugAliases`.
- The proposed target is the suffix-free 88.5 record, **not** the separate 740 AM/XEKV entry. That AM entry and another 88.5-labelled candidate use a different `/8274/stream` endpoint; they are outside this decision.
- The target's stored homepage is an old Radio Cañón image URL, not a station page. The current Radio Cañón website could not be independently retrieved (502); no current ownership/rebranding claim is made. The exact retained stream/callsign/frequency/city evidence supports this limited mapping.

## Three unresolved historical identities

Exact `/api/station/{historical-identifier}` requests returned **404 Station not found** for these three. These lookups check the application's normal direct/UUID/merge-alias/slug-alias resolution. No corresponding exception exists in `verified-legacy-station-alias.ts`; inspected audit/source history supplied no earlier provider identity or stream binding.

### `france-bleu-besanon`

Current plausible candidate: `france-bleu-besancon`, ID `6a07916dbef34beb9148c147`, UUID `961303cf-0601-11e8-ae97-52543be04c81`, official `francebleu.fr/besancon` homepage and `direct.francebleu.fr/live/fbbesancon-midfi.mp3` stream. Its stored alias is `france-bleu-besancon-1`, not the missing `besanon` spelling.

The [official ARCOM decision published on Légifrance](https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000050853629) confirms France Bleu Besançon's rename to ici Besançon from 6 January 2025. That verifies broadcaster continuity, **not the absent RadioHub URL's original UUID**. Retain the unresolved outcome until an old record/export or verified alias history establishes the missing link.

### `radio-russia`

Current plausible candidate: `radio-rossii`, ID `68a8c4a8bd66579311ab8be1`, UUID `55b43658-ac97-11e9-88f4-52543be04c81`, stream `http://icecast.vgtrk.cdnvideo.ru/rrzonam_mp3_192kbps`. The historical slug is generic and could denote a regional service or a different broadcaster. No preserved old UUID, homepage or stream was found. Do not map it to the national station merely because the English name resembles a translation.

### `1fm-movie-soundtrack`

Current plausible candidate: `movie-soundtracks-hits-radio-1-fm`, ID `68a8c47fbd66579311ab27d0`, UUID `df8ca5a9-0a2b-4bfc-a5dd-b9af4b2b4ebf`, stream `https://strm112.1.fm/moviesoundtracks_mobile_mp3`. Its stored alias is `movie-soundtracks-hits-radio-1fm`, not the historical identifier.

The stored [1.FM station URL](https://www.1.fm/station/moviesoundtracks) currently redirects to the broadcaster's [1cloud homepage](https://radio.1cloud.fm/). This is not a station-specific redirect proving an old RadioHub identity. Preserve the unresolved outcome until historical record/UUID/stream evidence is available.

## Safe implementation boundary

For the four strong mappings above, plus the separately verified Sunshine Classics pair below, use explicitly reviewed **source ID + target ID** checks before issuing a locale-preserving permanent redirect. Recheck that the destination remains non-excluded, has no redirect and supports the requested published locale; retired locales may use the existing English fallback. Fail closed if either identity changes. Keep source records, user history, ratings and descriptions intact; no bulk merge, deletion, suffix stripping, name similarity rule or homepage fallback is justified by this review.

Search is a discovery aid, not an exhaustive duplicate census: multiword queries use broad matching, and each request was capped at 30 results. Candidate details above were rechecked by exact slug. No sitemap crawl, paid AI task, GSC submission or production mutation was performed. The three unresolved cases are **not claimed fixed**.

## Additional verified pair: Sunshine Live Classics

The separate historical-Gone review verified that the broadcaster's [official Classics playlist](https://stream.sunshine-live.de/classics/mp3-192/stream.sunshine-live.de/play.m3u) returns the same `sunsl.streamabc.net/sunsl-classics-mp3-192-8423201` stream host/path retained by the destination, with a fresh query token. Exact public API identity fields were independently rechecked for migration guards:

- Source: `sunshine-live-classics-1`, ID `6a0791d5bef34beb9148d739`, UUID `96109022-0601-11e8-ae97-52543be04c81`; aliases `sunshine-live-classics-4` and `sunshine-live-classics-2`.
- Target: `sunshine-live-classics`, ID `68a8c49cbd66579311ab7099`, UUID `d965b9bd-c27d-4685-a7ae-bc33fd29ac8e`.
- Both identify the German Sunshine Live Classics service and official Sunshine homepage. Source remains excluded; target remains indexable with all 14 description locales; both have empty manual-edit flags and no existing redirect.
- The target also contains an old `sunshine-live-classics-1` alias. The retained source is the direct canonical owner of that slug and therefore wins lookup precedence. No alias is removed or transferred.

## Local implementation and regression evidence

`0039_verified_historical_station_redirects.sql` implements exactly these **five** pairs. It pins both IDs/UUIDs, names, country/code, homepage and both URL fields (including the stored Sunshine query string), preserves source and target data, and journals the previous redirect/mirrored metadata/timestamp for an explicit reversible repair. Changed identity, manual ownership, exclusions, incomplete full/meta content in any of 14 languages, conflicting canonical/alias owners or incoming redirect chains cause that pair to be skipped. Existing audit markers are never overwritten. There is no broad name matching or normalization exception.

The migration takes a brief `NOWAIT` writer lock while checking and updating to prevent new conflicting owners between those steps; ordinary reads remain allowed. Contention raises an error and leaves the migration unapplied for a later retry, rather than claiming success. Existing target aliases are preserved. The journal metadata was also aligned with existing migrations 0034–0038 before adding 0039; previous SQL files were not edited.

Actual SQL/PLpgSQL regression execution with isolated **PGlite 0.3.14: 9 tests passed, 0 failed, 0 skipped**. Coverage includes all five successful mappings; idempotence; every identity-field guard; manual/exclusion/existing-redirect guards; missing/malformed language content; conflicting canonical/alias owners; incoming chains; missing source rows; preservation of all unrelated fields and user references; and restoring exact previous values from the audit journal. PGlite is single-process: native PostgreSQL concurrency/lock contention was **not** exercised. This document does not claim deployment or post-deployment verification.
