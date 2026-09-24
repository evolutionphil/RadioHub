# Sunshine Live Classics duplicate identity review — 24 September 2026

## Decision

**The two records are verified representations of the same SUNSHINE LIVE Classics channel.** There is sufficient identity evidence for a deliberate permanent redirect from `sunshine-live-classics-1` to the existing canonical `sunshine-live-classics`; restoring a second indexable page is unnecessary. This conclusion is stronger than a name match: the official source playlist resolves to the exact target stream host and path.

No production, code, stream or metadata changes were made. This is an identity recommendation, not a fresh playback-health certification.

## Decisive primary evidence

1. The broadcaster's [official stream directory](https://stream.sunshine-live.de/) identifies **sunshine live - Classics**, Mannheim, Germany, as an internet channel. Its MP3 192 kbps address is `https://stream.sunshine-live.de/classics/mp3-192/stream.sunshine-live.de/`, the source record's address with HTTPS instead of HTTP.
2. The linked [official M3U playlist](https://stream.sunshine-live.de/classics/mp3-192/stream.sunshine-live.de/play.m3u) returned **HTTP 200, `audio/x-mpegurl`**. A bounded text read returned one URL with host/path **`https://sunsl.streamabc.net/sunsl-classics-mp3-192-8423201`**, followed by player/query parameters. That is exactly the target record's host/path; its stored version uses HTTP and older query values. No stream URL from the playlist was opened and no audio was read.
3. The [official Classics channel page](https://www.sunshine-live.de/classics-channel) currently describes SUNSHINE LIVE's electronic classics channel. Its page configuration also contains `https://stream.sunshine-live.de/classics/mp3-192/`. This corroborates the channel identity independently of the catalog.

## Exact retained records

| | Source duplicate | Existing canonical target |
| --- | --- | --- |
| ID | `6a0791d5bef34beb9148d739` | `68a8c49cbd66579311ab7099` |
| Slug | `sunshine-live-classics-1` | `sunshine-live-classics` |
| Provider UUID | `96109022-0601-11e8-ae97-52543be04c81` | `d965b9bd-c27d-4685-a7ae-bc33fd29ac8e` |
| Country / homepage | Germany / DE; `http://www.sunshine-live.de/` | Germany / DE; `https://www.sunshine-live.de/` |
| noIndex / manual fields | `true` / `{}` | `false` / `{}` |
| Recorded lastCheckOk | `true`, checked 21 September 2026 | `true`, checked 15 January 2026 |
| Stored slug aliases | `sunshine-live-classics-4`, `sunshine-live-classics-2` | `sunshine-live-classics-3`, **`sunshine-live-classics-1`** |

Both records have `redirectToSlug:null`, empty merged URL/UUID arrays and 14 description-language keys. Fresh [source API](https://api.themegaradio.com/api/station/sunshine-live-classics-1) and [target API](https://api.themegaradio.com/api/station/sunshine-live-classics) reads confirm that the target already claims the source slug as an alias, while the source still exists as a separate record. The official playlist supplies the independent evidence needed beyond that retained alias.

At **13:15:37–13:15:38 UTC**, the English source page returned **410, text/plain, noindex**; the target returned **200, text/html, indexable and self-canonical**. The current alias collision therefore does not already provide the desired public redirect.

## Recommended bounded action and checks

- Use the existing target identity and content as canonical. If authorized, apply the supported explicit source-to-target redirect without deleting either identity or overwriting playback URLs, target descriptions or health fields.
- Include the source's `-2` and `-4` aliases when verifying canonical resolution; preserve the target's `-3` alias. Check source, aliases and legacy locale variants for a single permanent redirect to the corresponding valid canonical locale, no loop, and a final indexable 200.
- Keep identity consolidation separate from optional future stream maintenance. The official M3U's current query differs from the target's old query, and this audit neither proves the old stream fails nor authorizes replacing it.

The SEO-audit skill's evidence-first canonicalization approach informed this scoped recommendation. Requests were bounded and read-only, with at most two concurrent HTTP checks; no broad crawl, playback or indexing request was performed.
