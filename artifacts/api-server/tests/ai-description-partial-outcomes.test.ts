import { after, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { SITEMAP_PRIORITY_LANGUAGES } from '@workspace/seo-shared/seo-config';

type Description = { full: string; meta: string };
const description = (language: string): Description => ({ full: `${language}: Fixture Radio has a complete localized description and regional programming for its listeners.`, meta: `${language}: A localized Fixture Radio summary.` });
const oldPartial = { full: '', meta: 'old' };
let fixture: any;
let persisted: Record<string, Description>;
let writes: Array<{ filter: any; update: any }>;
let snapshots: any[];
let messages: string[];
let backgrounds: Array<() => Promise<void>>;
let sourceLanguage: string;
let phase: 'empty' | 'partial';
let translate: (languages: string[]) => Promise<Map<string, Description>>;
let manualEdit = false;
let translationCalls = 0;
let generationCalls = 0;
let activeJobId: string;
let registeredRoutes: Map<string, any>;
let strip: (value: unknown) => unknown = value => value;

const catalog = {
  count: async () => 1,
  find: async (_query: any, options: any) => options?.offset > 0 ? [] : [structuredClone(fixture)],
  findOne: async () => structuredClone(fixture),
  descriptionFillCandidates: async function* (requestedPhase: string) {
    if (requestedPhase === phase) yield structuredClone(fixture);
  },
  update: async (filter: any, update: any) => {
    writes.push(structuredClone({ filter, update }));
    if (filter['manualEditFields.descriptions'] && manualEdit) return { modifiedCount: 0 };
    for (const [field, value] of Object.entries(update.$set || {})) {
      assert.ok(field.startsWith('descriptions.'), 'test must only save description fields');
      const language = field.slice('descriptions.'.length);
      if (Object.hasOwn(filter, field) && JSON.stringify(filter[field]) !== JSON.stringify(persisted[language] ?? null)) return { modifiedCount: 0 };
      persisted[language] = structuredClone(value) as Description;
    }
    return { modifiedCount: 1 };
  },
};
mock.module(new URL('../src/data/postgres-catalog-store.ts', import.meta.url).href, { namedExports: { pgCatalog: () => catalog } });
mock.module(new URL('../src/data/postgres-runtime-operations.ts', import.meta.url).href, { namedExports: {
  pgSaveDescriptionJob: async (_jobId: string, _total: number, snapshot: any) => snapshots.push(snapshot),
  pgReadDescriptionJob: async () => null,
} });
mock.module(new URL('../src/data/postgres-admin-catalog-store.ts', import.meta.url).href, { namedExports: { pgAdminDescriptionCoverage: async () => ({}) } });
mock.module(new URL('../src/postgres-runtime.ts', import.meta.url).href, { namedExports: {
  getPostgresCoordinationPool: () => ({ connect: async () => ({
    on: () => {}, removeListener: () => {}, release: () => {},
    query: async () => ({ rows: [{ acquired: true }] }),
  }) }),
} });
mock.module(new URL('../src/routes/shared-utils.ts', import.meta.url).href, { namedExports: { stripPlaceholders: (value: unknown) => strip(value), TV_STATION_PROJECTION: {} } });
mock.module(new URL('../src/performance-cache.ts', import.meta.url).href, { namedExports: { performanceCache: { invalidateStationCache: () => {}, setQuick: () => {} } } });
mock.module(new URL('../src/utils/logger.ts', import.meta.url).href, { namedExports: { logger: {
  log: (...args: unknown[]) => messages.push(args.join(' ')), warn: (...args: unknown[]) => messages.push(args.join(' ')), error: (...args: unknown[]) => messages.push(args.join(' ')),
} } });
mock.module(new URL('../src/services/ai-station-description.ts', import.meta.url).href, { namedExports: {
  detectStationLanguage: () => sourceLanguage,
  generateStationDescription: async () => { generationCalls++; return { success: true, fullDescription: description(sourceLanguage).full, metaDescription: description(sourceLanguage).meta, language: sourceLanguage }; },
  translateDescription: async (_full: string, _meta: string, _source: string, languages: string[]) => { translationCalls++; return translate(languages); },
} });
mock.module('node-cron', { defaultExport: { schedule: () => { throw new Error('No cron jobs may be started by this test'); } } });
const { registerAiDescriptionRoutes } = await import('../src/routes/ai-description-routes');
const { scheduledDescriptionFill } = await import('../src/services/scheduled-description-fill');
const realTimeout = globalThis.setTimeout;
mock.method(globalThis, 'setTimeout', ((callback: any, _delay: unknown, ...args: any[]) => realTimeout(callback, 0, ...args)) as any);
mock.method(globalThis, 'setImmediate', ((callback: () => Promise<void>) => { backgrounds.push(callback); return {}; }) as any);
mock.method(globalThis, 'setInterval', (() => ({})) as any);
after(() => mock.restoreAll());

beforeEach(() => {
  fixture = { _id: 'fixture-station', name: 'Fixture Radio', slug: 'fixture-radio', descriptions: {}, manualEditFields: {} };
  persisted = {}; writes = []; snapshots = []; messages = []; backgrounds = []; sourceLanguage = 'en'; phase = 'partial'; manualEdit = false; translationCalls = 0; generationCalls = 0;
  strip = value => value;
  translate = async languages => new Map(languages.map(language => [language, description(language)]));
});

async function runAdminJob(route: string, languages: string[]) {
  const routes = new Map<string, any>();
  registeredRoutes = routes;
  const app: any = { post: (path: string, ...handlers: any[]) => routes.set(`POST ${path}`, handlers.at(-1)), get: (path: string, ...handlers: any[]) => routes.set(`GET ${path}`, handlers.at(-1)) };
  await registerAiDescriptionRoutes(app, { requireAdmin: () => {} });
  let response: any;
  const res: any = { json: (value: any) => { response = value; return res; }, status: (_status: number) => res };
  await routes.get(`POST ${route}`)({ body: { selectedStationIds: [fixture._id], languages }, params: {} }, res);
  assert.equal(response.success, true);
  const jobId = response.jobId;
  activeJobId = jobId;
  assert.equal(backgrounds.length, 1);
  await backgrounds.shift()!();
  await routes.get('GET /api/admin/stations/description-job-status/:jobId')({ params: { jobId } }, res);
  return response;
}

for (const route of ['fix-missing-english', 'generate-bulk-descriptions']) {
  for (const useExistingSource of [true, false]) {
    test(`${route}, ${useExistingSource ? 'existing source' : 'new native source'}: service failures preserve data and populate failure status`, async () => {
      sourceLanguage = useExistingSource ? 'de' : 'en';
      fixture.descriptions = useExistingSource ? { de: description('de'), fr: oldPartial } : { fr: oldPartial };
      persisted = structuredClone(fixture.descriptions);
      translate = async () => { throw new Error('Mock service unavailable'); };
      const job = await runAdminJob(`/api/admin/stations/${route}`, ['en', 'de', 'fr']);
      assert.equal(job.processed, 1);
      assert.equal(job.successful, 0);
      assert.equal(job.failed, 1);
      assert.equal(job.failedStations.length, 1);
      assert.match(job.failedStations[0].error, /Mock service unavailable/);
      assert.deepEqual(persisted.fr, oldPartial);
      assert.deepEqual(persisted[sourceLanguage], description(sourceLanguage));
      assert.equal(writes.length, useExistingSource ? 0 : 1);
    });

    for (const outcome of ['empty', 'partial', 'complete'] as const) {
      test(`${route}, ${useExistingSource ? 'existing source' : 'new native source'}, ${outcome}: count only complete requested-language results as successful`, async () => {
        sourceLanguage = useExistingSource ? 'de' : 'en';
        fixture.descriptions = useExistingSource ? { de: description('de'), fr: oldPartial } : { fr: oldPartial };
        persisted = structuredClone(fixture.descriptions);
        let requested: string[] = [];
        let accepted: string[] = [];
        translate = async languages => {
          requested = languages;
          accepted = outcome === 'complete' ? languages : outcome === 'partial' ? languages.slice(0, 1) : [];
          return new Map(accepted.map(language => [language, description(language)]));
        };
        const job = await runAdminJob(`/api/admin/stations/${route}`, ['en', 'de', 'fr']);
        assert.equal(job.status, 'completed', 'finished job lifecycle does not imply every station succeeded');
        assert.equal(job.processed, 1);
        assert.equal(job.successful, outcome === 'complete' ? 1 : 0);
        assert.equal(job.failed, outcome === 'complete' ? 0 : 1);
        assert.equal(job.successfulStations.length, outcome === 'complete' ? 1 : 0);
        assert.equal(job.failedStations.length, outcome === 'complete' ? 0 : 1);
        for (const language of requested.filter(language => !accepted.includes(language))) assert.ok(job.failedStations[0].error.includes(language));
        for (const language of accepted) assert.deepEqual(persisted[language], language === 'fr' ? { ...description(language), meta: oldPartial.meta } : description(language));
        if (!accepted.includes('fr')) assert.deepEqual(persisted.fr, oldPartial, 'a rejected target must not overwrite previous data');
        assert.deepEqual(persisted[sourceLanguage], description(sourceLanguage), 'existing/native source must survive partial target failures');
        assert.equal(writes.length, accepted.length + (useExistingSource ? 0 : 1), 'write accepted translations only');
        if (route === 'generate-bulk-descriptions') assert.equal(snapshots.at(-1).failedCount, job.failed);
        if (outcome !== 'complete') assert.equal(messages.some(message => message.includes('now has all')), false);
      });
    }
  }
}

for (const candidatePhase of ['empty', 'partial'] as const) {
  for (const outcome of ['empty', 'partial', 'complete'] as const) {
    test(`scheduled ${candidatePhase} phase, ${outcome}: distinguish failed attempts from accepted language writes`, async () => {
      phase = candidatePhase;
      fixture.descriptions = phase === 'empty' ? {} : Object.fromEntries(SITEMAP_PRIORITY_LANGUAGES.universal14.filter(language => !['de', 'fr'].includes(language)).map(language => [language, description(language)]));
      fixture.descriptions.fr = oldPartial;
      persisted = structuredClone(fixture.descriptions);
      let accepted: string[] = [];
      translate = async languages => {
        accepted = outcome === 'complete' ? languages : outcome === 'partial' ? languages.slice(0, 1) : [];
        return new Map(accepted.map(language => [language, description(language)]));
      };
      const result = await scheduledDescriptionFill.runOnce('unit-test-no-external-services');
      assert.equal(result.stoppedEarly, false);
      assert.equal(result.generated, phase === 'empty' ? 1 : 0);
      assert.equal(result.translated, accepted.length);
      assert.equal(result.failed, outcome === 'complete' ? 0 : 1);
      for (const language of accepted) assert.deepEqual(persisted[language], description(language));
      if (!accepted.includes('fr')) assert.deepEqual(persisted.fr, oldPartial);
      for (const write of writes) {
        assert.deepEqual(write.filter['manualEditFields.descriptions'], { $ne: true });
        assert.ok(Object.keys(write.filter).some(key => key.startsWith('descriptions.')), 'compare-and-set must remain on every scheduled write');
      }
      assert.ok(messages.some(message => message.includes('translatedLanguageWrites=')));
      if (outcome !== 'complete') assert.ok(messages.some(message => message.includes('failed languages:')));
    });
  }
}

test('scheduled partial successes never overwrite a concurrent manual translation', async () => {
  fixture.descriptions = Object.fromEntries(SITEMAP_PRIORITY_LANGUAGES.universal14.filter(language => !['de', 'fr'].includes(language)).map(language => [language, description(language)]));
  fixture.descriptions.fr = oldPartial;
  persisted = structuredClone(fixture.descriptions);
  const manual = { full: 'Existing manual French description must survive.', meta: 'Existing manual metadata.' };
  translate = async languages => {
    persisted.fr = manual;
    return new Map(languages.map(language => [language, description(language)]));
  };
  const result = await scheduledDescriptionFill.runOnce('unit-test-concurrent-edit');
  assert.equal(result.translated, 1, 'only the non-concurrent language write counts');
  assert.equal(result.failed, 0, 'model produced every requested translation; CAS preserves concurrent edits');
  assert.deepEqual(persisted.fr, manual);
  assert.deepEqual(persisted.de, description('de'));
});

test('admin metadata-only gaps preserve full text and locale extensions without model calls', async () => {
  fixture.descriptions = { en: { ...description('en'), meta: '  ', reviewed: true }, de: description('de') };
  persisted = structuredClone(fixture.descriptions);
  const job = await runAdminJob('/api/admin/stations/generate-bulk-descriptions', ['en', 'de']);
  assert.equal(job.successful, 1);
  assert.equal(job.failed, 0);
  assert.equal(persisted.en.full, fixture.descriptions.en.full);
  assert.equal((persisted.en as any).reviewed, true);
  assert.ok(persisted.en.meta.trim());
  assert.deepEqual(persisted.de, fixture.descriptions.de);
  assert.equal(generationCalls + translationCalls, 0);
  assert.equal(snapshots.at(-1).processedStations, 1);
});

test('admin full-only repair preserves existing metadata and rerunning completed content makes no model calls', async () => {
  fixture.descriptions = { en: description('en'), fr: { full: '', meta: 'Preserve this manually written French metadata.', reviewed: true } };
  persisted = structuredClone(fixture.descriptions);
  const job = await runAdminJob('/api/admin/stations/generate-bulk-descriptions', ['en', 'fr']);
  assert.equal(job.successful, 1);
  assert.equal(persisted.fr.meta, fixture.descriptions.fr.meta);
  assert.equal((persisted.fr as any).reviewed, true);
  fixture.descriptions = structuredClone(persisted);
  const again = await runAdminJob('/api/admin/stations/generate-bulk-descriptions', ['en', 'fr']);
  assert.equal(again.skipped, 1);
  assert.equal(translationCalls, 1);
  assert.equal(generationCalls, 0);
});

test('admin manually protected station is skipped before any paid generation or writes', async () => {
  fixture.manualEditFields = { descriptions: true };
  const job = await runAdminJob('/api/admin/stations/generate-bulk-descriptions', ['en', 'fr']);
  assert.equal(job.skipped, 1);
  assert.equal(generationCalls + translationCalls, 0);
  assert.equal(writes.length, 0);
});

test('malformed description arrays are reported before paid generation or a false successful save', async () => {
  fixture.descriptions = [];
  const job = await runAdminJob('/api/admin/stations/generate-bulk-descriptions', ['en', 'fr']);
  assert.equal(job.failed, 1);
  assert.match(job.failedStations[0].error, /Malformed description collection/);
  assert.equal(generationCalls + translationCalls, 0);
  assert.equal(writes.length, 0);
});

test('admin concurrent edits survive and prevent a false successful station result', async () => {
  fixture.descriptions = { en: description('en') };
  persisted = structuredClone(fixture.descriptions);
  const manual = { full: 'Concurrent French content must survive.', meta: 'Concurrent summary.' };
  translate = async languages => {
    persisted.fr = manual;
    return new Map(languages.map(language => [language, description(language)]));
  };
  const job = await runAdminJob('/api/admin/stations/generate-bulk-descriptions', ['en', 'fr']);
  assert.equal(job.successful, 0);
  assert.equal(job.failed, 1);
  assert.deepEqual(persisted.fr, manual);
  assert.match(job.failedStations[0].error, /concurrently/);
  assert.deepEqual(writes[0].filter['manualEditFields.descriptions'], { $ne: true });
});

test('admin cancellation during translation prevents saving and cannot become completed', async () => {
  fixture.descriptions = { en: description('en') };
  persisted = structuredClone(fixture.descriptions);
  translate = async languages => {
    const res: any = { json: () => res, status: () => res };
    await registeredRoutes.get('POST /api/admin/stations/description-job/:jobId/cancel')({ params: { jobId: activeJobId } }, res);
    return new Map(languages.map(language => [language, description(language)]));
  };
  const job = await runAdminJob('/api/admin/stations/generate-bulk-descriptions', ['en', 'fr']);
  assert.equal(job.status, 'cancelled');
  assert.equal(job.successful, 0);
  assert.equal(persisted.fr, undefined);
  assert.equal(snapshots.at(-1).status, 'cancelled');
});

test('scheduled manual-edit guard skips native persistence and does not request target translations', async () => {
  phase = 'empty'; manualEdit = true;
  const result = await scheduledDescriptionFill.runOnce('unit-test-manual-edit');
  assert.equal(result.generated, 0);
  assert.equal(result.translated, 0);
  assert.equal(result.skipped, 1);
  assert.equal(translationCalls, 0);
  assert.deepEqual(persisted, {});
});

test('scheduled metadata-only repairs preserve every localized full text and require no translation service', async () => {
  fixture.descriptions = Object.fromEntries(SITEMAP_PRIORITY_LANGUAGES.universal14.map(language => [language, description(language)]));
  fixture.descriptions.en.meta = '';
  fixture.descriptions.es.meta = ' \n\t ';
  delete fixture.descriptions.fr.meta;
  fixture.descriptions.he.meta = null;
  fixture.descriptions.hi.meta = 17;
  fixture.descriptions.fr.reviewer = 'keep existing per-language metadata';
  persisted = structuredClone(fixture.descriptions);
  const before = structuredClone(persisted);
  translate = async () => { throw new Error('Metadata-only repairs must not call the external translator'); };

  const result = await scheduledDescriptionFill.runOnce('unit-test-metadata-only');
  assert.equal(result.partialCount, 1);
  assert.equal(result.translated, 5);
  assert.equal(result.failed, 0);
  assert.equal(translationCalls, 0);
  for (const language of SITEMAP_PRIORITY_LANGUAGES.universal14) {
    assert.equal(persisted[language].full, before[language].full);
    assert.ok(persisted[language].meta.trim().length > 0);
    if (!['en', 'es', 'fr', 'he', 'hi'].includes(language)) assert.deepEqual(persisted[language], before[language]);
  }
  assert.equal((persisted.fr as any).reviewer, 'keep existing per-language metadata');
  for (const write of writes) {
    const field = Object.keys(write.update.$set)[0];
    assert.deepEqual(write.filter[field], before[field.slice('descriptions.'.length)]);
    assert.deepEqual(write.filter['manualEditFields.descriptions'], { $ne: true });
  }
});

test('scheduled metadata repair survives a separate missing-language translation failure', async () => {
  fixture.descriptions = Object.fromEntries(SITEMAP_PRIORITY_LANGUAGES.universal14.filter(language => language !== 'fr').map(language => [language, description(language)]));
  fixture.descriptions.en.meta = '';
  persisted = structuredClone(fixture.descriptions);
  translate = async languages => {
    assert.deepEqual(languages, ['fr']);
    throw new Error('Translation service unavailable');
  };
  const result = await scheduledDescriptionFill.runOnce('unit-test-metadata-plus-translation');
  assert.equal(result.translated, 1);
  assert.equal(result.failed, 1);
  assert.equal(persisted.en.full, fixture.descriptions.en.full);
  assert.ok(persisted.en.meta.trim());
  assert.equal(persisted.fr, undefined);
});

test('scheduled metadata repairs respect manual and concurrent edits', async () => {
  fixture.descriptions = Object.fromEntries(SITEMAP_PRIORITY_LANGUAGES.universal14.map(language => [language, description(language)]));
  fixture.descriptions.fr.meta = '';
  persisted = structuredClone(fixture.descriptions);
  const manual = { full: 'Manual French prose that must remain unchanged.', meta: 'A manually supplied French summary.' };
  persisted.fr = manual;
  const concurrent = await scheduledDescriptionFill.runOnce('unit-test-metadata-concurrent-edit');
  assert.equal(concurrent.translated, 0);
  assert.deepEqual(persisted.fr, manual);
  persisted = structuredClone(fixture.descriptions);
  manualEdit = true;
  const protectedResult = await scheduledDescriptionFill.runOnce('unit-test-metadata-manual-guard');
  assert.equal(protectedResult.translated, 0);
  assert.deepEqual(persisted, fixture.descriptions);
  assert.equal(translationCalls, 0);
});

test('scheduled metadata repair never saves an ellipsis when cleanup removes all prose', async () => {
  fixture.descriptions = Object.fromEntries(SITEMAP_PRIORITY_LANGUAGES.universal14.map(language => [language, description(language)]));
  const placeholder = '[TRANSLATED FULL DESCRIPTION PLACEHOLDER]';
  fixture.descriptions.fr = { full: placeholder, meta: '' };
  persisted = structuredClone(fixture.descriptions);
  strip = value => value === placeholder ? '' : value;
  translate = async languages => { assert.deepEqual(languages, ['fr']); return new Map(); };
  const result = await scheduledDescriptionFill.runOnce('unit-test-empty-cleaned-excerpt');
  assert.equal(result.translated, 0);
  assert.equal(result.failed, 1);
  assert.deepEqual(persisted.fr, fixture.descriptions.fr);
  assert.equal(writes.length, 0);
});
