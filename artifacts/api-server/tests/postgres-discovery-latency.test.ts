import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createNativePostgresFixture } from './helpers/native-postgres-fixture';
import { PostgresCatalogStore } from '../src/data/postgres-catalog-store';

describe('indexed public discovery semantics', { skip: !process.env.PG_TEST_DATABASE_URL }, () => {
  let fixture: Awaited<ReturnType<typeof createNativePostgresFixture>>;
  let discovery: typeof import('../src/data/postgres-discovery-operations');
  before(async () => {
    fixture = await createNativePostgresFixture('discovery_latency');
    discovery = await import('../src/data/postgres-discovery-operations');
  });
  after(async () => { await fixture?.close(); });
  it('preserves substring matching, standalone source genres, literal wildcards, deduplication and public fields', async () => {
    const catalog = new PostgresCatalogStore(fixture.pool);
    const station = (id: string, extra = {}) => ({ _id: id, stationuuid: 'uuid-' + id, name: id,
      slug: id, url: 'https://example.invalid/' + id, country: 'Austria', ...extra });
    await catalog.insertMany([
      station('rock-substring', { tags: 'Rockabilly', codec: 'MP3', bitrate: 128 }),
      station('source-only', { genre: 'Soft ROCK', descriptions: { en: 'private-large-content'.repeat(1000) } }),
      station('literal-tag', { tags: '100%_music\\live' }),
      station('literal-source', { genre: '100%_music\\live' }),
      station('not-literal', { tags: '1000Xmusic-live' }),
      station('outside-country', { country: 'Germany', tags: 'rock' }),
    ]);
    await fixture.pool.query("INSERT INTO genres(id,name,slug,station_count) VALUES('g-rock','rock','rock',100),('g-literal',$1,'literal',90)", ['100%_music\\live']);
    const result = await discovery.pgDiverseStations('Austria', 50);
    assert.deepEqual(result.map(row => row._id).sort(), ['literal-source', 'literal-tag', 'rock-substring', 'source-only']);
    assert.equal(result.find(row => row._id === 'source-only').genre, 'Soft ROCK');
    assert.equal(result.find(row => row._id === 'rock-substring').codec, 'MP3');
    assert.equal(result.find(row => row._id === 'rock-substring').bitrate, 128);
    assert.ok(!JSON.stringify(result).includes('private-large-content'));
    assert.ok(!Object.hasOwn(result.find(row => row._id === 'rock-substring'), 'descriptions'));
    assert.deepEqual(await discovery.pgDiverseStations('Austria.*', 20), []);
    assert.equal(new Set(result.map(row => row._id)).size, result.length);
  });
});
