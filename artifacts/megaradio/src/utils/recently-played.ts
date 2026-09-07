type RecentStation = Record<string, any> & { _id: string; playedAt?: string };
const HISTORY_LIMIT = 12;

export function recentStationList(value: unknown): RecentStation[] {
  return Array.isArray(value) ? value.filter(station => station && typeof station === 'object' &&
    (typeof station._id === 'string' || typeof station._id === 'number')) : [];
}

export function readRecentlyPlayed(stored: string | null): RecentStation[] {
  try { return recentStationList(stored ? JSON.parse(stored) : []); } catch { return []; }
}

export function addRecentlyPlayed(stored: string | null, station: Record<string, any>, now = new Date()): RecentStation[] {
  const previous = readRecentlyPlayed(stored).filter(row => String(row._id) !== String(station._id));
  return [{ ...station, _id: String(station._id), playedAt: now.toISOString() }, ...previous].slice(0, HISTORY_LIMIT);
}

const playTime = (station: RecentStation): number => {
  const value = Date.parse(station.playedAt || '');
  return Number.isFinite(value) ? value : 0;
};

export function mergeRecentlyPlayed(local: unknown, remote: unknown): RecentStation[] {
  const merged = new Map<string, RecentStation>();
  // Stable insertion order retains undated legacy history without inventing
  // play times. A newer local replay must win over an older API snapshot.
  for (const station of [...recentStationList(local), ...recentStationList(remote)]) {
    const key = String(station._id), existing = merged.get(key);
    if (!existing || playTime(station) > playTime(existing)) merged.set(key, station);
  }
  return [...merged.values()].sort((a, b) => playTime(b) - playTime(a)).slice(0, HISTORY_LIMIT);
}

export function hydrateRecentlyPlayed(history: RecentStation[], catalog: Record<string, any>): RecentStation[] {
  return history.map(entry => {
    const current = catalog[String(entry._id)];
    if (!current || typeof current !== 'object' || String(current._id) !== String(entry._id)) return entry;
    // Current catalogue owns logos/stream metadata; history owns recency.
    // A removed image must not resurrect a stale localStorage logo. Missing
    // catalogue rows and outages retain their original history snapshot.
    return { ...entry, ...current, favicon: current.favicon, logoAssets: current.logoAssets,
      localImagePath: current.localImagePath, playedAt: entry.playedAt };
  });
}
