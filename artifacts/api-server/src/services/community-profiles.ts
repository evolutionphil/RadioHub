import { publicStationCache } from '../public-station-cache';
import { pgPopularProfiles, pgRefreshPublicProfiles } from '../data/postgres-engagement-store';

// An absolute 30s expiry survives Redis promotion. Single flight bounds ranking
// queries even when many listeners refresh the same community section together.
const prefix = 'community-profiles:recent:v1:';
export async function getCommunityProfiles(requestedLimit = 100) {
  const limit = Math.max(1, Math.min(100, Math.trunc(Number(requestedLimit)) || 20));
  const profiles = await publicStationCache.getOrSetSingleFlight(
    `${prefix}${limit}`, () => pgPopularProfiles(limit), { ttl: 30 },
  );
  return pgRefreshPublicProfiles(profiles);
}

export async function invalidateCommunityProfiles() {
  await publicStationCache.clearByPattern(prefix);
}
