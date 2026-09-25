# Archived station URL repairs — 25 September 2026

This follow-up supersedes the **missing identity evidence** conclusions for the
three candidates in `2026-09-24-historical-404-identity-review.md`. It does not
reclassify every excluded/deleted station as indexable.

## Newly recovered evidence

Read-only authenticated `/api/admin/blacklisted-stations` searches recovered the
old station UUID, name and stream. Authentication used the owner's previously
provided admin account; session credentials were kept in process memory and the
temporary API session was logged out. No archives were restored or deleted.

| Old URL identifier | Archive ID / station UUID | Archived name and stream | Verified current target |
| --- | --- | --- | --- |
| `france-bleu-besanon` | `6a19a3cfb2b0731c7169dcdd` / `196b7bd5-6507-4a99-8a94-2c0a7e3bee73` | `France Bleu Besançon `; `http://direct.francebleu.fr/live/fbbesancon-midfi.mp3?ID=33c5hej2c2` | `france-bleu-besancon`, ID `6a07916dbef34beb9148c147`, UUID `961303cf-0601-11e8-ae97-52543be04c81` |
| `radio-russia` | `6a19a3cfb2b0731c7169e28d` / `9614750c-0601-11e8-ae97-52543be04c81` | `Радио России (Radio Russia)`; `http://icecast.vgtrk.cdnvideo.ru/rrzonam_mp3_64kbps` | `radio-rossii`, ID `68a8c4a8bd66579311ab8be1`, UUID `55b43658-ac97-11e9-88f4-52543be04c81` |
| `1fm-movie-soundtrack` | `6924e60e1a96fae5442834e4` / `962a7d59-0601-11e8-ae97-52543be04c81` | `1.FM - Movie Soundtrack`; `http://strm112.1.fm/moviesoundtracks_mobile_mp3` | `movie-soundtracks-hits-radio-1-fm`, ID `68a8c47fbd66579311ab27d0`, UUID `df8ca5a9-0a2b-4bfc-a5dd-b9af4b2b4ebf` |
| `1fm-movie-soundtrack-hits` | `6924e60c1a96fae5442834cc` / `2607c50d-b70e-4eaa-ad0f-cfcaa36c6824` | `1.fm Movie Soundtrack Hits`; `https://strm112.1.fm/moviesoundtracks_mobile_mp3?` | Same Movie Soundtracks target |

France Bleu and Radio Russia archives were removed by historical duplicate
cleanup on 29 May 2026. The two 1.FM archives were removed by a historical
URL-name cleanup on 24 November 2025. Those old cleanup reasons are not taken as
proof of station identity; the actual archived fields and live endpoints are.

## Slug and stream verification

`2026-09-25-historical-slug-provenance.json` reproduces all four identifiers using
immutable historical server/client slug generators, not today's transliterator.
Its collision caveat is preserved: generated text alone is not proof of ownership.
Here it is combined with the archive names/UUIDs and station-specific streams.

Bounded GET requests (8-second timeout, cancel body immediately after headers)
returned these results on 25 September 2026:

- Old France Bleu URL and the current Besançon stream: `200 audio/mpeg`, both
  resolve to Radio France's `/fbbesancon-midfi.mp3`, `icy-name: fbbesancon-midfi.mp3`.
  The old tracking query does not change that observed station identity.
- Radio Russia's archived 64kbps and current 192kbps endpoints: `200 audio/mpeg`,
  both `icy-name: Radio Rossii Moskva`; bitrate headers correctly differ.
- 1.FM's HTTP and HTTPS station-specific endpoints: `200 audio/mpeg`, both
  `icy-name: 1.FM Movie Soundtracks Hits Radio`, `icy-url: http://1.fm`.

Current target API reads each report `noIndex:false`, no outgoing redirect and
14 description locales. Target IDs are pinned in the repair. Only exact reviewed
historical identifiers are added; nearby names, numeric suffixes and other
broadcaster channels do not receive guessed redirects. Existing real slug/alias
owners take precedence; missing/reassigned/excluded/redirecting targets fail closed.

## Additional retained-record repair

Migration `0041` covers Energy FM Non-Stop Mixes, K-Kountry 95 and Classic Radio
NSW MP3 (25 URLs in the recorded GSC 404 set). See the exact field evidence in
`2026-09-25-retained-redirect-candidates.json`. Both source and destination records,
descriptions and user references are retained. Prior values are journaled for
rollback; manually edited or drifted records are skipped rather than overwritten.

## Validation before release

- 404 tests passed across alias reads/cache, SSR and legacy-locale redirect suites,
  including all 14 active languages for each new archived alias.
- The retained redirect migration and prior redirect SQL suites passed 29 isolated
  PGlite tests without skips. These tests do not claim native lock-contention coverage.
- Migration `0042` adds one separately reviewed canonical recovery for Radio Ora
  News and redirects its exact-stream duplicate without deleting either record.
  Its private ownership, content hashes and catalog-wide conflict guards passed
  another 12 real PGlite tests. It intentionally skips if private production
  metadata conflicts; deployment alone is not proof that this recovery applied.
- API TypeScript checking and both API/web production server builds passed.
- Production verification and GSC validation outcomes will be recorded after release.

Correctly retired URLs must not be redirected to unrelated content merely to
clear a report. Technical indexability is testable; Google's indexing selection
is not guaranteed by a successful URL fetch or validation request.
