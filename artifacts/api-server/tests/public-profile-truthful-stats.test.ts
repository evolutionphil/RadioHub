import assert from 'node:assert/strict';
import { after, mock, test } from 'node:test';

let favoriteRows: any[] = [];
mock.module('../src/postgres-runtime', { namedExports: { getPostgresPool: () => ({ query: async (sql: string) => {
  if (sql.includes('SELECT u.*')) return { rows: [{ id: 'fixture-user', username: 'Listener', email: 'private@example.test',
    created_at: new Date('2024-03-12T12:00:00Z'), updated_at: new Date('2026-09-08T12:00:00Z'), is_public_profile: true,
    followers_count: 0, following_count: 0, is_following: false }] };
  assert.match(sql, /FROM user_favorites/);
  return { rows: favoriteRows, rowCount: favoriteRows.length };
} }) } });
const { pgPublicProfile } = await import('../src/data/postgres-engagement-store');
after(() => mock.restoreAll());
test('empty favorite data never manufactures listening hours, unique played stations or peak hours', async () => {
  favoriteRows = [];
  const profile = await pgPublicProfile('fixture-user');
  assert.equal(profile.listeningStats.totalListenHours, null);
  assert.equal(profile.listeningStats.uniqueStationsListened, null);
  assert.deepEqual(profile.listeningStats.peakListeningHours, []);
  assert.equal(profile.favoriteStationsCount, 0);
  assert.equal(new Date(profile.createdAt).toISOString(), '2024-03-12T12:00:00.000Z');
  assert.equal(profile.email, undefined);
});
test('real favorites determine favorite total/preferences only, never fabricated playback metrics', async () => {
  favoriteRows = [{ tags_raw: 'rock', country: 'Austria' }, { tags_raw: 'pop', country: 'Germany' }];
  const profile = await pgPublicProfile('fixture-user');
  assert.equal(profile.favoriteStationsCount, 2);
  assert.equal(profile.listeningStats.favoriteGenres.length, 2);
  assert.equal(profile.listeningStats.totalListenHours, null);
  assert.equal(profile.listeningStats.uniqueStationsListened, null);
});
