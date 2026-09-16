/**
 * Old crawled URLs whose punctuation was removed by the previous slugger.
 * These repairs point to aliases verified in the current PostgreSQL catalog,
 * never to a guessed station name or a homepage. Resolve the original identity
 * first, then resolve the repaired alias through the normal catalog lookup.
 * Do not generalize this to numeric suffix stripping: those distinguish real
 * stations, and an unknown/deleted URL must remain missing.
 */
const VERIFIED_LEGACY_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  'kpissfm-2': 'kpiss-fm-2',
  'flashbassfm-1': 'flashbass-fm-1',
});

export function verifiedLegacyStationAlias(identifier: string): string | null {
  return Object.hasOwn(VERIFIED_LEGACY_ALIASES, identifier)
    ? VERIFIED_LEGACY_ALIASES[identifier]
    : null;
}
