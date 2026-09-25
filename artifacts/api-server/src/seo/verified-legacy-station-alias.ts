/**
 * Individually reviewed old crawled station URLs.
 * These repairs point to identities verified in the current PostgreSQL catalog,
 * never to a guessed station name or a homepage. Resolve the original identity
 * first, then resolve the repaired alias through the normal catalog lookup.
 * Do not generalize this to numeric suffix stripping: those distinguish real
 * stations, and an unknown/deleted URL must remain missing.
 */
const VERIFIED_LEGACY_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  'kpissfm-2': 'kpiss-fm-2',
  'flashbassfm-1': 'flashbass-fm-1',
  // Official Rome 87.9 FM site recommends the archived and current OGG URL:
  // https://www.ondarossa.info/ricevi-aggiornamenti
  'radio-onda-rossa-1': 'onda-rossa',
  // Both Sydney entries use kiis1065.com.au; their AAC/MP3 streams identify
  // themselves as KIIS 106.5 with that same official homepage.
  // https://www.kiis1065.com.au/ and https://arn.com.au/network/kiis-network/
  'kiis-1065-sydney-1065-fm-mp3-1': 'kiis-106-5',
  // Deleted archive UUIDs + the historical ASCII slug generator + live stream
  // identity establish these exact old URLs. See the 2026-09-25 archive audit;
  // this is not a general spelling, codec, suffix or broadcaster-name rewrite.
  'france-bleu-besanon': 'france-bleu-besancon',
  'radio-russia': 'radio-rossii',
  '1fm-movie-soundtrack': 'movie-soundtracks-hits-radio-1-fm',
  '1fm-movie-soundtrack-hits': 'movie-soundtracks-hits-radio-1-fm',
});

// Pin recovered identities so a later slug reassignment cannot redirect
// their historical URLs to an unrelated station. Evidence and provenance limits:
// docs/audits/2026-09-20-historical-station-aliases.md
const EXPECTED_STATION_IDS: Readonly<Record<string, string>> = Object.freeze({
  'radio-onda-rossa-1': '68a8c482bd66579311ab2f5b',
  'kiis-1065-sydney-1065-fm-mp3-1': '68a8c478bd66579311ab1477',
  'france-bleu-besanon': '6a07916dbef34beb9148c147',
  'radio-russia': '68a8c4a8bd66579311ab8be1',
  '1fm-movie-soundtrack': '68a8c47fbd66579311ab27d0',
  '1fm-movie-soundtrack-hits': '68a8c47fbd66579311ab27d0',
});

export const verifiedLegacyStationAliases: ReadonlyArray<readonly [string, string]> =
  Object.freeze(Object.entries(VERIFIED_LEGACY_ALIASES).map(([legacy, target]) => Object.freeze([legacy, target] as const)));

export function verifiedLegacyStationAlias(identifier: string): string | null {
  return Object.hasOwn(VERIFIED_LEGACY_ALIASES, identifier)
    ? VERIFIED_LEGACY_ALIASES[identifier]
    : null;
}

export function matchesVerifiedLegacyStationTarget(identifier: string, stationId: unknown, redirectToSlug?: unknown): boolean {
  if (!Object.hasOwn(VERIFIED_LEGACY_ALIASES, identifier)) return false;
  return !Object.hasOwn(EXPECTED_STATION_IDS, identifier)
    || (EXPECTED_STATION_IDS[identifier] === stationId && !redirectToSlug);
}
