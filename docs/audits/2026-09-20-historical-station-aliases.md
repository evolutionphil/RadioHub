# Two reviewed historical station URLs

Read-only identity checks on 20 September 2026 support the following exact repairs. The repair is an application allowlist, not a database merge, a change to indexability, or a general numeric-suffix rule.

| Historical slug | Current canonical slug | Pinned station ID |
| --- | --- | --- |
| `radio-onda-rossa-1` | `onda-rossa` | `68a8c482bd66579311ab2f5b` |
| `kiis-1065-sydney-1065-fm-mp3-1` | `kiis-106-5` | `68a8c478bd66579311ab1477` |

## Radio Onda Rossa

The [official listening instructions](https://www.ondarossa.info/ricevi-aggiornamenti) identify Radio Onda Rossa as broadcasting on 87.9 FM in Rome and its province, and recommend `https://s.streampunk.cc/ondarossa.ogg`. The [official contact page](https://www.ondarossa.info/contatti) gives its Rome address.

The live public catalog at `/api/station/onda-rossa` returned the pinned ID, `Italy` / `IT`, state `Roma`, homepage `https://www.ondarossa.info/`, the exact officially recommended OGG URL, and `noIndex: false`. The deleted archive inspected during this investigation retained the same OGG URL and station name. The separate current `radio-onda-rossa` row has the same homepage, Italy/Lazio, an MP3 stream, `noIndex: true`, and alias `radio-onda-rossa-2`.

A HEAD request to the recommended OGG endpoint returned HTTP 404 at approximately 20:42 UTC. That observation concerns current stream availability, not whether the station identity is the same. This repair does not claim playback recovery or change health/indexability fields.

## KIIS 1065 Sydney

The [official KIIS website](https://www.kiis1065.com.au/) identifies the station as KIIS 1065 Sydney and links its live iHeart station (ID 6185). The [owner's network page](https://arn.com.au/network/kiis-network/) identifies KIIS 1065 as its New South Wales station. The [official competition-winners page](https://www.kiis1065.com.au/kiis-106-5-competition-winners/) uses the `KIIS 106.5` spelling.

The live catalog at `/api/station/kiis-106-5` returned the pinned ID, Australia/AU, New South Wales, the official homepage, `noIndex: false`, and stream `https://ais-arn.streamguys1.com/au_007_icy`. The MP3 row (`68a8c478bd66579311ab1479`, slug `kiis-1065-sydney-106-5-fm-mp3`) returned the same official homepage, Australia/Sydney NSW, name `KIIS 1065 - Sydney - 106.5 FM (MP3)`, and `noIndex: true`.

At approximately 20:42 UTC, the canonical AAC stream redirected to `https://playerservices.streamtheworld.com/api/livestream-redirect/ARN_KIIS1065AAC.aac` and returned HTTP 200. The MP3 row's `http://playerservices.streamtheworld.com/api/livestream-redirect/ARN_KIIS1065.mp3` also returned HTTP 200. Both stream servers supplied `icy-name: KIIS 106.5` and `icy-url: Https://www.kiis1065.com.au`; their codecs/bitrates differed (AAC+, 48 kbps versus MP3, 128 kbps). This independently ties the format variants to the same broadcaster.

## Provenance and runtime boundaries

The official sources establish station identity and the live catalog destinations. They do not prove the exact historical `-1` database collision: the Onda deleted archive lacks a slug, and no matching deleted KIIS archive was found. Mapping those two observed historical URLs to the corresponding station is a reviewed inference; no broader family of suffixes is inferred.

Existing exact slugs and stored aliases take precedence. The two new targets must retain their pinned IDs and must not themselves redirect. Missing/reassigned/redirecting targets remain missing; noindex and junk targets retain their exclusion response. Cache repairs are resolved during the existing catalog refresh, and public/SSR fallback is bounded without recursive repairs or candidate searches. Local regression coverage exercises both targets, all fourteen supported station locales, target exclusion, ownership conflicts and redirect cycles. These checks do not establish production deployment.
