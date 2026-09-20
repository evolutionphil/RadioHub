import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';

const chinese = { full: '这家广播电台为当地听众播放音乐节目，并通过在线音频流提供收听服务。', meta: '收听这家广播电台提供的音乐节目和在线音频流。' };
const english = { full: 'Fixture Radio broadcasts music for local listeners through its online audio stream.', meta: 'Listen to the music programming on Fixture Radio.' };
const german = { full: 'Fixture Radio bietet Musikprogramme und einen Audiostream für seine Hörer.', meta: 'Musikprogramme von Fixture Radio online hören.' };
const spanish = { full: 'Fixture Radio ofrece programas de música y una transmisión de audio para sus oyentes.', meta: 'Escucha los programas musicales de Fixture Radio.' };
let station: any, persisted: any, requests: any[], writes: any[], actions: any[], native: string;
let responses: Array<Map<string, any> | Error>, active: boolean, onRequest: (index: number) => void, manualProtected: boolean;
mock.module(new URL('../src/data/postgres-catalog-store.ts', import.meta.url).href, { namedExports: {
  pgCatalog: () => ({ update: async (filter: any, update: any) => {
    writes.push(structuredClone({filter, update}));
    const field = Object.keys(update.$set)[0], language = field.slice('descriptions.'.length);
    assert.deepEqual(filter['manualEditFields.descriptions'], {$ne: true});
    if (manualProtected || JSON.stringify(filter[field]) !== JSON.stringify(persisted[language] ?? null)) return {modifiedCount: 0};
    persisted[language] = structuredClone(update.$set[field]);
    return {modifiedCount: 1};
  } }),
} });
mock.module(new URL('../src/performance-cache.ts', import.meta.url).href, { namedExports: {
  performanceCache: {invalidateStationCache: () => {}, setQuick: () => {}},
} });
mock.module(new URL('../src/routes/shared-utils.ts', import.meta.url).href, { namedExports: {stripPlaceholders: (value: string) => value} });
mock.module(new URL('../src/services/ai-station-description.ts', import.meta.url).href, { namedExports: {
  detectStationLanguage: () => native,
  generateStationDescription: async () => { throw new Error('No generation allowed in pivot fixtures'); },
  translateDescription: async (full: string, meta: string, source: string, targets: string[], name: string, guard: () => void) => {
    assert.equal(name, 'Fixture Radio'); assert.equal(guard, assertActive);
    requests.push({full, meta, source, targets: [...targets]}); onRequest(requests.length);
    const result = responses.shift(); assert.notEqual(result, undefined, 'no unbounded translation retries');
    if (result instanceof Error) throw result;
    return result;
  },
} });
const {fillMissingStationDescriptions} = await import('../src/services/fill-missing-station-descriptions');
function assertActive() { if (!active) throw new Error('Job cancelled'); }
function run(targets = ['de', 'es'], options: any = {}) {
  return fillMissingStationDescriptions(station, targets, (action, languages) => actions.push({action, languages: [...languages]}), assertActive, options);
}
beforeEach(() => {
  station = {_id: 'fixture', name: 'Fixture Radio', slug: 'fixture', noIndex: false, descriptions: {zh: chinese, en: english}, manualEditFields: {}};
  persisted = structuredClone(station.descriptions); native = 'zh'; requests = []; writes = []; actions = [];
  responses = []; active = true; onRequest = () => {}; manualProtected = false;
});

test('only failed targets retry once from the existing English pivot; accepted native results save once', async () => {
  responses = [new Map([['de', german]]), new Map([['es', spanish]])];
  const saved: string[] = [];
  const result = await run(undefined, {repairInvalid: true, onSaved: (language: string) => saved.push(language)});
  assert.deepEqual(requests.map(({source, targets}) => ({source, targets})), [{source: 'zh', targets: ['de', 'es']}, {source: 'en', targets: ['es']}]);
  assert.equal(requests[1].full, english.full); assert.equal(requests[1].meta, english.meta);
  assert.deepEqual(result.languages, ['de', 'es']); assert.deepEqual(saved, ['de', 'es']); assert.equal(writes.length, 2);
  assert.deepEqual(persisted.zh, chinese); assert.deepEqual(persisted.en, english);
  assert.ok(writes.every(write => write.filter.noIndex === false && JSON.stringify(write.filter.redirectToSlug) === JSON.stringify({$in: [null, '']})));
});

test('pivot failure reports remaining languages and retains earlier native successes without another attempt', async () => {
  responses = [new Map([['de', german]]), new Map()];
  await assert.rejects(run(), /Translation failed for languages: es/);
  assert.equal(requests.length, 2); assert.equal(writes.length, 1); assert.deepEqual(persisted.de, german); assert.equal(persisted.es, undefined);
});

test('provider exceptions do not trigger fallback or discard already accepted native output', async () => {
  responses = [new Map([['de', german]]), new Error('Pivot provider unavailable')];
  await assert.rejects(run(), /Pivot provider unavailable/);
  assert.deepEqual(persisted.de, german); assert.equal(requests.length, 2); assert.equal(writes.length, 1);
  requests = []; writes = []; responses = [new Error('Native provider unavailable')];
  await assert.rejects(run(), /Native provider unavailable/); assert.equal(requests.length, 1); assert.equal(writes.length, 0);
});

test('already-English source never retries itself', async () => {
  native = 'en'; responses = [new Map()];
  await assert.rejects(run(), /de, es/); assert.equal(requests.length, 1);
});

test('missing, incomplete or normalized-native-copy English cannot become a pivot', async () => {
  for (const candidate of [undefined, {full: english.full, meta: ''}, {full: '  '+chinese.full+' \n ', meta: 'complete'}]) {
    station.descriptions.en = candidate; persisted = structuredClone(station.descriptions); requests = []; responses = [new Map()];
    await assert.rejects(run(), /de, es/); assert.equal(requests.length, 1); assert.equal(writes.length, 0);
  }
});

test('English created by the first batch does not initiate an additional pivot chain', async () => {
  delete station.descriptions.en; persisted = structuredClone(station.descriptions);
  responses = [new Map([['en', english]])];
  await assert.rejects(run(['en', 'es']), /languages: es/);
  assert.equal(requests.length, 1); assert.deepEqual(persisted.en, english);
});

test('cancellation after native results or during pivot prevents later writes', async () => {
  onRequest = index => { if (index === 1) active = false; };
  responses = [new Map()];
  await assert.rejects(run(), /Job cancelled/); assert.equal(requests.length, 1); assert.equal(writes.length, 0);
  active = true; requests = []; onRequest = index => { if (index === 2) active = false; };
  responses = [new Map([['de', german]]), new Map([['es', spanish]])];
  await assert.rejects(run(), /Job cancelled/); assert.equal(requests.length, 2); assert.equal(writes.length, 1);
  assert.deepEqual(persisted.de, german); assert.equal(persisted.es, undefined);
});

test('pivot compare-and-set and manual guard preserve concurrently supplied content', async () => {
  station.descriptions.es = {full: '', meta: 'Retain this supplied metadata', reviewer: 'keep'};
  persisted = structuredClone(station.descriptions);
  responses = [new Map(), new Map([['es', spanish]])];
  const manual = {full: 'A concurrent manual article', meta: 'A concurrent manual summary'};
  onRequest = index => { if (index === 2) persisted.es = manual; };
  await assert.rejects(run(['es']), /concurrently or is protected/); assert.deepEqual(persisted.es, manual);
  requests = []; writes = []; persisted = structuredClone(station.descriptions); responses = [new Map(), new Map([['es', spanish]])];
  onRequest = index => { if (index === 2) manualProtected = true; };
  await assert.rejects(run(['es']), /concurrently or is protected/); assert.deepEqual(persisted.es, station.descriptions.es);
});

test('pivot repairs a missing full field without replacing supplied metadata or extensions', async () => {
  station.descriptions.es = {full: '', meta: 'Retain supplied metadata', reviewer: 'keep'}; persisted = structuredClone(station.descriptions);
  responses = [new Map(), new Map([['es', spanish]])];
  await run(['es']);
  assert.deepEqual(persisted.es, {full: spanish.full, meta: 'Retain supplied metadata', reviewer: 'keep'});
  assert.equal(writes.length, 1);
});
