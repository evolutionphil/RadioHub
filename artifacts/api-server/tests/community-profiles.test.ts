import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import { publicUserIdentity } from '../src/utils/public-user-identity';

const cacheCalls: Array<{ key: string; options: { ttl: number } }> = [];
const rankingCalls: number[] = [];
const refreshInputs: any[][] = [];
const clearedPrefixes: string[] = [];
const cachedRankings = new Map<string, any[]>();
let liveProfiles: any[] = [];
let refreshFails = false;

mock.module('../src/public-station-cache', { namedExports: { publicStationCache: {
  getOrSetSingleFlight: async (key: string, loader: () => Promise<any[]>, options: { ttl: number }) => {
    cacheCalls.push({ key, options });
    if (!cachedRankings.has(key)) cachedRankings.set(key, await loader());
    return cachedRankings.get(key);
  },
  clearByPattern: async (prefix: string) => {
    clearedPrefixes.push(prefix);
    for (const key of cachedRankings.keys()) if (key.startsWith(prefix)) cachedRankings.delete(key);
  },
} } });
mock.module('../src/data/postgres-engagement-store', { namedExports: {
  pgPopularProfiles: async (limit: number) => {
    rankingCalls.push(limit);
    return [{ _id: 'public-listener', name: 'Cached name', favoriteCount: 2 }];
  },
  pgRefreshPublicProfiles: async (profiles: any[]) => {
    refreshInputs.push(profiles);
    if (refreshFails) throw new Error('Live privacy check failed');
    return liveProfiles;
  },
} });
const { getCommunityProfiles, invalidateCommunityProfiles } = await import('../src/services/community-profiles');

beforeEach(() => {
  cacheCalls.length = 0;
  rankingCalls.length = 0;
  refreshInputs.length = 0;
  clearedPrefixes.length = 0;
  cachedRankings.clear();
  liveProfiles = [{ _id: 'public-listener', name: 'Current name', favoriteCount: 2 }];
  refreshFails = false;
});

test('requests a 30-second single-flight ranking cache but performs the live privacy/identity refresh on every read', async () => {
  assert.deepEqual(await getCommunityProfiles(6), liveProfiles);
  assert.deepEqual(cacheCalls, [{ key: 'community-profiles:recent:v1:6', options: { ttl: 30 } }]);
  const originalRanking = refreshInputs[0];
  liveProfiles = [];
  assert.deepEqual(await getCommunityProfiles(6), [], 'cached rankings must not bypass the live privacy filter');
  assert.deepEqual(rankingCalls, [6]);
  assert.equal(refreshInputs.length, 2);
  assert.equal(refreshInputs[1], originalRanking);
  assert.equal(cacheCalls[1].options.ttl, 30);
});

test('bounds caller limits before forming the cache key and executing the ranking query', async () => {
  for (const [requested, expected] of [[1000, 100], [-4, 1], [6.9, 6], [0, 20], [NaN, 20]]) {
    await getCommunityProfiles(requested);
    assert.equal(cacheCalls.at(-1)!.key, `community-profiles:recent:v1:${expected}`);
  }
  assert.deepEqual(rankingCalls, [100, 1, 6, 20]);
  await getCommunityProfiles();
  assert.equal(cacheCalls.at(-1)!.key, 'community-profiles:recent:v1:100');
});

test('invalidates all community limits using only the community cache prefix', async () => {
  await getCommunityProfiles(6);
  await getCommunityProfiles(20);
  cachedRankings.set('unrelated:stations', []);
  await invalidateCommunityProfiles();
  assert.deepEqual(clearedPrefixes, ['community-profiles:recent:v1:']);
  assert.deepEqual([...cachedRankings.keys()], ['unrelated:stations']);
  await getCommunityProfiles(6);
  assert.deepEqual(rankingCalls, [6, 20, 6]);
});

test('does not fall back to cached public identities when the live privacy check fails', async () => {
  await getCommunityProfiles(6);
  refreshFails = true;
  await assert.rejects(getCommunityProfiles(6), /Live privacy check failed/);
  assert.deepEqual(rankingCalls, [6]);
  assert.equal(refreshInputs.length, 2);
});

test('public identity trims real names, falls back to username and never derives a name from private email', () => {
  assert.deepEqual(publicUserIdentity({ fullName: '  Alice Weber ', username: 'alice-42', email: 'private@example.invalid' }), {
    name: 'Alice Weber', fullName: 'Alice Weber', displayName: 'Alice Weber', username: 'alice-42', avatar: null, profileImageUrl: null,
  });
  const usernameOnly = publicUserIdentity({ fullName: '  ', username: '  listener-42  ', email: 'private@example.invalid' });
  assert.equal(usernameOnly.name, 'listener-42');
  assert.equal(usernameOnly.fullName, '');
  const unnamed = publicUserIdentity({ fullName: ' ', username: ' ', email: 'private@example.invalid', passwordHash: 'secret' });
  assert.equal(unnamed.name, 'User');
  assert.equal(unnamed.displayName, 'User');
  assert.equal(Object.hasOwn(unnamed, 'email'), false);
  assert.equal(Object.hasOwn(unnamed, 'passwordHash'), false);
  assert.equal(JSON.stringify(unnamed).includes('private'), false);
});

test('public identity prefers canonical avatars and supports blank canonical values with legacy URL fallback', () => {
  const canonical = publicUserIdentity({ avatar: ' https://example.invalid/current.webp ', profileImageUrl: 'https://example.invalid/legacy.webp' });
  assert.equal(canonical.avatar, 'https://example.invalid/current.webp');
  assert.equal(canonical.profileImageUrl, canonical.avatar);
  const legacy = publicUserIdentity({ avatar: '  ', profileImageUrl: ' https://example.invalid/legacy.webp ' });
  assert.equal(legacy.avatar, 'https://example.invalid/legacy.webp');
  assert.equal(legacy.profileImageUrl, legacy.avatar);
  assert.equal(publicUserIdentity({ avatar: null, profileImageUrl: '', profile_image_url: 'https://example.invalid/older.webp' }).avatar,
    'https://example.invalid/older.webp');
});
