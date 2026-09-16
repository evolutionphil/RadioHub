import assert from 'node:assert/strict';
import { after, beforeEach, mock, test } from 'node:test';
import { getPublicStationDeadline, limitPublicStationDeadline, withPublicStationDeadline } from '../src/utils/public-station-deadline';

let now = 1_000_000, revision = 0, reads = 0;
let genres: Array<{ slug: string; name: string; stationCount: number; stationIds?: string[] }>;
let load: () => Promise<typeof genres>;
mock.module('../src/services/public-genre-navigation', { namedExports: {
  publicGenreWhitelistVersion: () => String(revision),
  getCachedPublicGenres: () => { reads++; return load(); },
} });
const { getHomeGenreNavigation } = await import('../src/services/home-genre-navigation');
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
beforeEach(() => {
  now += 1_000_000; revision++; reads = 0;
  mock.method(Date, 'now', () => now);
  genres = Array.from({ length: 30 }, (_, index) => ({
    slug: `genre-${index.toString().padStart(2, '0')}`, name: `Curated ${index}`,
    stationCount: index, stationIds: ['must-not-be-retained'],
  }));
  load = async () => { limitPublicStationDeadline(now + 60_000); return genres; };
});
after(() => mock.restoreAll());

test('cold navigation never waits and coalesces a slow native read without retaining counts or station data', async () => {
  let finish!: (value: typeof genres) => void;
  load = () => new Promise(resolve => { finish = resolve; });
  for (let index = 0; index < 20; index++) assert.equal(getHomeGenreNavigation(), undefined);
  assert.equal(reads, 1);
  finish(genres); await flush();
  const links = getHomeGenreNavigation();
  assert.deepEqual(links, [...genres].reverse().slice(0, 24).map(({ slug, name }) => ({ slug, name })));
  assert.equal(reads, 1);
  assert.ok(Object.isFrozen(links));
  assert.ok(links?.every(link => Object.isFrozen(link) && Object.keys(link).length === 2));
});

test('expired freshness serves links immediately during one refresh and drops them at the 120s hard limit', async () => {
  getHomeGenreNavigation(); await flush();
  const original = getHomeGenreNavigation();
  now += 60_001;
  let finish!: (value: typeof genres) => void;
  load = () => new Promise(resolve => { finish = resolve; });
  assert.equal(getHomeGenreNavigation(), original);
  assert.equal(reads, 2);
  assert.equal(getHomeGenreNavigation(), original);
  assert.equal(reads, 2);
  now += 60_000;
  assert.equal(getHomeGenreNavigation(), undefined, 'No stale fallback beyond the bounded navigation grace');
  finish(genres); await flush();
});

test('whitelist changes immediately reject old links and cannot publish a previous in-flight revision', async () => {
  getHomeGenreNavigation(); await flush();
  now += 60_001;
  let finish!: (value: typeof genres) => void;
  load = () => new Promise(resolve => { finish = resolve; });
  assert.ok(getHomeGenreNavigation());
  revision++;
  assert.equal(getHomeGenreNavigation(), undefined);
  finish(genres); await flush();
  load = async () => [{ slug: 'approved', name: 'New approved name', stationCount: 10 }];
  assert.equal(getHomeGenreNavigation(), undefined);
  await flush();
  assert.deepEqual(getHomeGenreNavigation(), [{ slug: 'approved', name: 'New approved name' }]);
});

test('refresh failures keep only bounded links and back off instead of retrying on every visit', async () => {
  getHomeGenreNavigation(); await flush();
  now += 60_001;
  load = async () => { throw new Error('native data unavailable'); };
  assert.ok(getHomeGenreNavigation()); await flush();
  for (let index = 0; index < 20; index++) assert.ok(getHomeGenreNavigation());
  assert.equal(reads, 2);
  now += 5_001;
  assert.ok(getHomeGenreNavigation()); await flush();
  assert.equal(reads, 3);
  now += 60_000;
  assert.equal(getHomeGenreNavigation(), undefined);
  await flush();
});

test('snapshot age inherits the source deadline and cannot be extended by HTML caching or background work', async () => {
  load = async () => { limitPublicStationDeadline(now + 1_000); return genres; };
  await withPublicStationDeadline(async () => {
    limitPublicStationDeadline(now + 30_000);
    assert.equal(getHomeGenreNavigation(), undefined);
    await flush();
    assert.equal(getPublicStationDeadline(), now + 30_000, 'Detached refresh does not mutate the page deadline');
  });
  now += 59_000;
  load = async () => { throw new Error('refresh unavailable'); };
  await withPublicStationDeadline(async () => {
    assert.ok(getHomeGenreNavigation());
    assert.equal(getPublicStationDeadline(), now + 2_000, 'The rendered HTML inherits the remaining link deadline');
    await flush();
  });
  now += 2_001;
  assert.equal(getHomeGenreNavigation(), undefined, 'Cache promotion does not restart the source snapshot age');
});

test('ties use the API slug ordering and successful refresh replaces names without mutating native data', async () => {
  genres = [ { slug: 'rock', name: 'Editorial Rock', stationCount: 4 }, { slug: 'jazz', name: 'Editorial Jazz', stationCount: 4 } ];
  const original = structuredClone(genres);
  getHomeGenreNavigation(); await flush();
  assert.deepEqual(getHomeGenreNavigation(), [{ slug: 'jazz', name: 'Editorial Jazz' }, { slug: 'rock', name: 'Editorial Rock' }]);
  assert.deepEqual(genres, original);
  now += 60_001;
  genres = [{ slug: 'pop', name: 'Updated Pop', stationCount: 8 }];
  assert.equal(getHomeGenreNavigation()?.length, 2);
  await flush();
  assert.deepEqual(getHomeGenreNavigation(), [{ slug: 'pop', name: 'Updated Pop' }]);
});
