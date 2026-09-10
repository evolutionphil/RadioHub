/** A merged loser must not be imported again, but its shared endpoint remains
 * usable by the survivor. Ordinary/manual bans retain their URL-wide scope.
 */
export function buildSyncBlacklist(rows: Array<{ stationUuid?: string; url?: string; blocksUrl?: boolean }>) {
  return {
    blacklistedUuids: new Set(rows.map(row => row.stationUuid).filter((value): value is string => Boolean(value))),
    blacklistedUrls: new Set(rows.filter(row => row.blocksUrl !== false).map(row => row.url).filter((value): value is string => Boolean(value))),
  };
}
