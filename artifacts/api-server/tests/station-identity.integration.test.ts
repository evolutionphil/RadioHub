import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createNativePostgresFixture, type NativePostgresFixture } from './helpers/native-postgres-fixture';

describe('public station identity survives duplicate merges', { skip: !process.env.PG_TEST_DATABASE_URL }, () => {
  let fixture: NativePostgresFixture;
  let ids: typeof import('../src/data/station-identity-store');
  let reads: typeof import('../src/data/station-read-store');
  let engagement: typeof import('../src/data/postgres-engagement-store');
  let counters: typeof import('../src/data/station-write-store');
  let casts: typeof import('../src/data/postgres-cast-store');
  before(async () => {
    fixture = await createNativePostgresFixture('merged_public_identity');
    ids = await import('../src/data/station-identity-store');
    reads = await import('../src/data/station-read-store');
    engagement = await import('../src/data/postgres-engagement-store');
    counters = await import('../src/data/station-write-store');
    casts = await import('../src/data/postgres-cast-store');
    await fixture.insert('users', { _id: 'viewer', username: 'identity-viewer', fullName: 'Identity Fixture', email: 'identity@example.invalid', isPublicProfile: true });
    await fixture.insert('stations', { _id: 'survivor', stationuuid: 'current-uuid', name: 'Radio Test',
      slug: 'radio-test', slugAliases: ['old-slug'], url: 'https://stream.example.invalid/live', isListVisible: true });
    await fixture.pool.query("INSERT INTO station_merge_aliases(alias,station_id) VALUES ('old-id','survivor'),('old-uuid','survivor')");
  });
  after(async () => { await fixture?.close(); });

  it('resolves mixed public ID/UUID batches without losing requested keys', async () => {
    const result = await ids.resolveStationIds(['survivor', 'old-id', 'current-uuid', 'old-uuid', 'missing', 'old-id']);
    assert.deepEqual(Object.fromEntries(result), { survivor: 'survivor', 'old-id': 'survivor', 'current-uuid': 'survivor', 'old-uuid': 'survivor' });
    assert.equal(await ids.resolveStationId('missing'), null);
  });

  it('keeps old URLs and current/merged UUID detail reads reachable', async () => {
    for (const alias of ['old-id', 'old-uuid', 'old-slug', 'current-uuid', 'radio-test']) {
      const row = await reads.getStationByIdentifier(alias);
      assert.equal(row?._id, 'survivor', alias);
      assert.equal(row?.slug, 'radio-test');
    }
    assert.equal(await reads.getStationByIdentifier('missing'), null);
  });

  it('routes favorites and anonymous ratings to the survivor only', async () => {
    await engagement.pgSetFavorite('viewer', 'old-id', true);
    assert.equal(await engagement.pgIsFavorite('viewer', 'old-uuid'), true);
    await engagement.pgSetFavorite('viewer', 'old-uuid', false);
    assert.equal(await engagement.pgIsFavorite('viewer', 'survivor'), false);
    const identity = { sessionId: 'test-session' };
    await engagement.pgRateStationIdentity(identity, 'old-id', 4, 'First review');
    await engagement.pgRateStationIdentity(identity, 'old-uuid', 5, 'Updated review');
    assert.equal((await engagement.pgFindStationRating('old-id', identity))?.stationId, 'survivor');
    const ratings = await engagement.pgStationRatingsDetailed('old-uuid', 1, 10);
    assert.equal(ratings.stats.totalRatings, 1);
    assert.equal(ratings.stats.averageRating, 5);
    assert.equal(ratings.ratings[0].comment, 'Updated review');
  });

  it('updates counters, recent history and cast with stale client IDs', async () => {
    assert.equal(await counters.incrementStationClick('old-id'), true);
    assert.ok((await counters.incrementStationVote('old-uuid'))! > 0);
    assert.equal(await counters.incrementStationClick('missing'), false);
    assert.equal(await engagement.pgAddRecentlyPlayed('viewer', 'old-id'), true);
    assert.equal(await engagement.pgAddRecentlyPlayed('viewer', 'old-uuid'), true);
    const recent = await engagement.pgRecentlyPlayedStations('viewer');
    assert.equal(recent.length, 1);
    assert.equal(recent[0]._id, 'survivor');
    const cast = await casts.createCastSession('viewer', undefined, undefined, 'old-uuid');
    assert.equal(cast.currentStation.stationId, 'survivor');
    assert.equal(cast.currentStation.streamUrl, 'https://stream.example.invalid/live');
  });

  it('re-resolves when a station is merged while the public write awaits its lock', async () => {
    await fixture.insert('stations', { _id: 'race-loser', stationuuid: 'race-uuid', name: 'Race', url: 'https://stream.example.invalid/race' });
    const merge = await fixture.pool.connect();
    let pending: Promise<any> | undefined;
    try {
      await merge.query('BEGIN');
      await merge.query("SELECT id FROM stations WHERE id='race-loser' FOR UPDATE");
      pending = engagement.pgSetFavorite('viewer', 'race-loser', true);
      // Observe a real lock waiter rather than assume timing via a fixed sleep.
      const deadline = Date.now() + 4000;
      let waiting = false;
      while (Date.now() < deadline) {
        const result = await merge.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT id FROM stations WHERE id=%' LIMIT 1");
        if (result.rowCount) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
        await merge.query('SELECT pg_stat_clear_snapshot()');
      }
      assert.ok(waiting, 'public request waits for the merging station');
      await merge.query("INSERT INTO station_merge_aliases(alias,station_id) VALUES ('race-loser','survivor')");
      await merge.query("DELETE FROM stations WHERE id='race-loser'");
      await merge.query('COMMIT');
      await pending;
      assert.equal(await engagement.pgIsFavorite('viewer', 'survivor'), true);
    } finally {
      await merge.query('ROLLBACK');
      merge.release();
      await pending?.catch(() => undefined);
    }
  });
});
