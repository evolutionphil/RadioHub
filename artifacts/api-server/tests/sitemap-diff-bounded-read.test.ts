import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import type { StationSitemapDoc } from '../src/services/sitemap-diff-indexnow';

let languages: string[], chunks: Array<{ chunk: number; stationIds: string[] }>;
let docs: Map<string, StationSitemapDoc>;
let reads: string[][], events: string[], writes: Array<{ language: string; chunk: number; urls: string[] }>;
let previous: string[], submitCalls: number, loseLock: boolean, failRead: boolean;
let activeReads = 0, maximumConcurrentReads = 0;

mock.module(new URL('../src/data/postgres-catalog-store.ts', import.meta.url).href, {
  namedExports: { pgCatalog: () => { throw new Error('Unbounded full catalog read is forbidden'); } },
});
mock.module(new URL('../src/data/postgres-seo-indexing-store.ts', import.meta.url).href, {
  namedExports: {
    SITEMAP_STATION_READ_BATCH_SIZE: 500,
    pgSitemapStationBatch: async (ids: string[]) => {
      assert.ok(ids.length > 0 && ids.length <= 500);
      reads.push([...ids]); events.push(`read:${ids[0]}`);
      maximumConcurrentReads = Math.max(maximumConcurrentReads, ++activeReads);
      try {
        await Promise.resolve();
        if (failRead && reads.length === 2) throw new Error('Database unavailable');
        return ids.map(id => docs.get(id)).filter(Boolean).reverse();
      } finally { activeReads--; }
    },
    pgActiveManifest: async (type: string) => type === 'stations' ? { chunks } : null,
    pgActiveManifests: async () => [], pgSeoGenres: async () => [],
    pgGetUrlSnapshot: async (_type: string, language: string, chunk: number) => {
      events.push(`snapshot:${language}:${chunk}`); return { urls: previous };
    },
    pgSaveUrlSnapshot: async (_type: string, language: string, chunk: number, urls: string[]) => {
      writes.push({ language, chunk, urls });
    },
    withSeoJobLock: async (_key: string, run: (lock: unknown) => unknown) => run({
      assertOwned: () => { if (loseLock && reads.length) throw new Error('Lock no longer owned'); },
    }),
  },
});
mock.module(new URL('../src/seo/sitemap-manifest-builder.ts', import.meta.url).href, {
  namedExports: { buildAllSitemapManifests: async () => {}, extractTopCountriesFromChunk: () => [] },
});
mock.module(new URL('../src/performance-cache.ts', import.meta.url).href, {
  namedExports: { performanceCache: { getUrlTranslations: async () => new Map([['fr:station', 'poste']]) } },
});
mock.module(new URL('../src/seo/qualified-languages.ts', import.meta.url).href, {
  namedExports: { getQualifiedLanguagesState: async () => ({ languages }), QualifiedLanguagesUnavailableError: class extends Error {} },
});
mock.module(new URL('../src/services/indexnow.ts', import.meta.url).href, {
  namedExports: { IndexNowService: { submitToIndexNow: async () => ({ success: ++submitCalls === 1, error: 'retry later' }) } },
});
mock.module(new URL('../src/utils/logger.ts', import.meta.url).href, {
  namedExports: { logger: { log: () => {}, warn: () => {}, error: () => {} } },
});
const { runSitemapDiffSubmission } = await import('../src/services/sitemap-diff-indexnow');

beforeEach(() => {
  languages = ['en']; chunks = []; docs = new Map(); reads = []; events = []; writes = [];
  previous = []; submitCalls = 0; loseLock = false; failRead = false; activeReads = 0; maximumConcurrentReads = 0;
});
function station(id: string, extra: Partial<StationSitemapDoc> = {}): StationSitemapDoc {
  return { _id: id, slug: `radio-${id}`, name: `Radio ${id}`, url: 'https://stream.example.invalid/live',
    tags: 'pop', bitrate: 128, lastCheckOk: true, countryCode: 'US', languageCodes: 'en', ...extra };
}
function populate(count: number): string[] {
  return Array.from({ length: count }, (_, n) => {
    const id = String(n).padStart(4, '0'); docs.set(id, station(id)); return id;
  });
}

test('real diff reads sequential <=500 rows, dedupes across batches and preserves per-language qualification and chunk order', async () => {
  const ids = populate(1101);
  for (const doc of docs.values()) doc.descriptions = { fr: { full: 'Description française.', meta: 'Résumé français.' } };
  docs.get('0500')!.slug = docs.get('0000')!.slug; // Same URL across a batch boundary.
  docs.get('0501')!.noIndex = true;
  docs.get('0502')!.slug = undefined;
  docs.delete('0503');
  docs.get('0504')!.descriptions = { fr: { full: 'Incomplete translation.' } };
  docs.get('0505')!.lastCheckOk = false;
  docs.get('0505')!.lastCheckTime = new Date(Date.now() - 31 * 86400000);
  docs.set('second', station('second', { descriptions: { fr: { full: 'Deuxième.', meta: 'Radio.' } } }));
  languages = ['en', 'fr']; chunks = [{ chunk: 2, stationIds: ['second'] }, { chunk: 1, stationIds: [...ids, '0000'] }];
  const result = await runSitemapDiffSubmission({ ensureManifestFresh: false, dryRun: true });
  assert.deepEqual(reads.map(batch => batch.length), [500, 500, 102, 1, 500, 500, 102, 1]);
  assert.equal(maximumConcurrentReads, 1);
  assert.deepEqual(result.perLanguage.map(row => [row.language, row.chunk, row.todayCount]), [
    ['en', 1, 1096], ['en', 2, 1], ['fr', 1, 1095], ['fr', 2, 1],
  ]);
  assert.ok(events.indexOf('snapshot:en:1') < events.indexOf('read:second'));
  for (const row of result.perLanguage) {
    assert.deepEqual(row.additions, [...new Set(row.additions)].sort());
    if (row.language === 'fr') assert.ok(row.additions.every(url => url.includes('/fr/poste/')));
  }
  assert.equal(writes.length, 0); assert.equal(submitCalls, 0);
});

test('bounded reads preserve successful-only snapshot advancement and stale URL removal after partial submission failure', async () => {
  const ids = populate(1002); chunks = [{ chunk: 7, stationIds: ids }];
  previous = ['https://themegaradio.com/en/station/radio-0000', 'https://themegaradio.com/en/station/deleted'];
  const result = await runSitemapDiffSubmission({ ensureManifestFresh: false });
  assert.deepEqual(reads.map(batch => batch.length), [500, 500, 2]);
  assert.equal(submitCalls, 2); assert.equal(result.perLanguage[0].submitSuccess, false);
  assert.equal(writes.length, 1); assert.equal(writes[0].chunk, 7);
  assert.equal(writes[0].urls.length, 1001);
  assert.ok(writes[0].urls.includes(previous[0]));
  assert.ok(!writes[0].urls.includes(previous[1]));
  assert.ok(!writes[0].urls.includes('https://themegaradio.com/en/station/radio-1001'));
});

test('lock loss between batches stops reads before submitting or advancing the snapshot', async () => {
  chunks = [{ chunk: 1, stationIds: populate(1001) }]; loseLock = true;
  await assert.rejects(runSitemapDiffSubmission({ ensureManifestFresh: false }), /Lock no longer owned/);
  assert.equal(reads.length, 1); assert.equal(writes.length, 0); assert.equal(submitCalls, 0);
});

test('failed later batch never publishes a partial chunk snapshot', async () => {
  chunks = [{ chunk: 1, stationIds: populate(1001) }]; failRead = true;
  await assert.rejects(runSitemapDiffSubmission({ ensureManifestFresh: false }), /Database unavailable/);
  assert.equal(reads.length, 2); assert.equal(writes.length, 0); assert.equal(submitCalls, 0);
});
