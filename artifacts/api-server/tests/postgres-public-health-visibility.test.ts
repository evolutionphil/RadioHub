import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createNativePostgresFixture } from './helpers/native-postgres-fixture';

describe('Native public station health visibility', { skip: !process.env.PG_TEST_DATABASE_URL }, () => {
  let fixture: Awaited<ReturnType<typeof createNativePostgresFixture>>;
  let read: typeof import('../src/data/station-read-store');
  let engagement: typeof import('../src/data/postgres-engagement-store');
  let taxonomy: typeof import('../src/data/postgres-taxonomy-store');
  before(async () => {
    fixture = await createNativePostgresFixture('public_health');
    read = await import('../src/data/station-read-store');
    engagement = await import('../src/data/postgres-engagement-store');
    taxonomy = await import('../src/data/postgres-taxonomy-store');
    await fixture.insert('users', { _id: 'viewer', email: 'fixture@example.invalid', username: 'viewer', fullName: 'Fixture Viewer', isPublicProfile: true,
      recentlyPlayedStations: [{ stationId: 'offline' }, { stationId: 'healthy' }, { stationId: 'healthy2' }] });
    for (const [id, healthy, votes] of [['offline', false, 10000], ['healthy', true, 20], ['healthy2', true, 10]] as const) {
      await fixture.insert('stations', { _id: id, stationuuid: `fixture-${id}`, name: id, slug: id, country: 'Germany', countryCode: 'DE',
        url: `https://stream.invalid/${id}`, tags: 'jazz', lastCheckOk: healthy, isListVisible: healthy, votes, latitude: 52.5, longitude: 13.4,
        source: { lastCheckOk: !healthy, descriptions: { de: { full: 'Retained editorial content' } } } });
      await fixture.insert('station_genres', { stationId: id, genreSlug: 'jazz' });
      await fixture.insert('user_favorites', { userId: 'viewer', stationId: id });
    }
    await fixture.insert('genres', { _id: 'jazz-genre', name: 'Jazz Music', slug: 'jazz', isDiscoverable: true });
  });
  after(async () => { await fixture?.close(); });
  it('filters before pagination and totals even when legacy excludeBroken=false', async () => {
    const result = await read.listStationsFromPostgres({ page: 1, limit: 1, excludeBroken: false });
    assert.equal(result.totalCount, 2); assert.equal(result.pagination.pages, 2);
    assert.deepEqual(result.stations.map(s => s._id), ['healthy']); assert.equal(result.stations[0].lastCheckOk, true);
    assert.equal((await read.listStationsFromPostgres({ page: 1, limit: 10, search: 'offline' })).totalCount, 0);
    assert.equal((await read.listStationsFromPostgres({ page: 1, limit: 10, genre: 'jazz' })).totalCount, 2);
  });
  it('keeps offline detail/raw records and honest health stats while offering healthy alternatives', async () => {
    assert.equal((await read.getStationByIdentifier('offline')).lastCheckOk, false);
    assert.equal(await read.getPublicStationByIdentifier('offline'), null);
    assert.deepEqual((await read.getRelatedStationsFromPostgres('offline', 10))?.map(s => s._id), ['healthy', 'healthy2']);
    const stats = await read.getStationStatsFromPostgres(); assert.equal(stats.total, 3); assert.equal(stats.broken, 1);
  });
  it('filters geo, nearby, random and visible taxonomy counts from the same native column', async () => {
    assert.equal((await read.getGeoStationsFromPostgres(10)).length, 2);
    assert.equal((await read.getNearbyStationsFromPostgres({ latitude: 52.5, longitude: 13.4, radiusKm: 10, limit: 10, excludeBroken: false })).length, 2);
    assert.notEqual((await read.getRandomCountryStationFromPostgres('Germany'))._id, 'offline');
    assert.deepEqual(await taxonomy.pgCountryCounts(), [{ name: 'Germany', count: 2 }]);
    assert.equal((await taxonomy.pgGenreBySlug('jazz')).stationCount, 2);
  });
  it('preserves favorite/history associations, limits after visibility and restores them on recovery', async () => {
    assert.equal((await engagement.pgFavoriteStationsForUser('viewer', 'newest', 1, 1)).total, 2);
    assert.deepEqual((await engagement.pgRecentlyPlayedStations('viewer', 1)).map(s => s._id), ['healthy']);
    assert.equal((await engagement.pgUserFavorites('viewer', 1, 10)).total, 2);
    assert.equal((await engagement.pgTrendingStations(undefined, 10)).trending.length, 2);
    assert.equal((await engagement.pgCommunityFavorites(undefined, undefined, 10)).favorites.length, 2);
    const before = (await fixture.pool.query("SELECT source FROM users WHERE id='viewer'")).rows[0].source;
    assert.equal((await fixture.pool.query('SELECT count(*)::int count FROM user_favorites')).rows[0].count, 3);
    await fixture.pool.query("UPDATE stations SET is_list_visible=true WHERE id='offline'");
    assert.equal((await engagement.pgFavoriteStationsForUser('viewer', 'newest', 1, 10)).total, 3);
    assert.deepEqual((await engagement.pgRecentlyPlayedStations('viewer', 1)).map(s => s._id), ['offline']);
    assert.equal((await read.listStationsFromPostgres({ page: 1, limit: 10 })).totalCount, 3);
    assert.equal((await taxonomy.pgGenreBySlug('jazz')).stationCount, 3);
    assert.deepEqual((await fixture.pool.query("SELECT source FROM users WHERE id='viewer'")).rows[0].source, before);
  });
  it('source-only false stays visible across SQL lists, compact cards and favorites without pretending verified healthy', async () => {
    const raw = await read.getStationByIdentifier('offline');
    assert.equal(raw.lastCheckOk,false);assert.equal(raw.isListVisible,true);assert.equal(raw.availabilityStatus,'unverified');
    const listed = await read.listStationsFromPostgres({page:1,limit:10,search:'offline'});
    assert.equal(listed.totalCount,1);assert.equal(listed.stations[0].lastCheckOk,false);
    assert.equal(listed.stations[0].isListVisible,true);assert.equal(listed.stations[0].availabilityStatus,'unverified');
    const favorite = (await engagement.pgUserFavorites('viewer',1,10)).favorites.find((station:any)=>station._id==='offline');
    assert.equal(favorite.isListVisible,true);assert.equal(favorite.lastCheckOk,false);
  });
});
