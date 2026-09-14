import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { after, before, describe, it, mock } from 'node:test';
import express from 'express';
import pg from 'pg';
import { PostgresLocalizationStore } from '../src/data/postgres-localization-store';

const connectionString = process.env.PG_TEST_DATABASE_URL;
describe('PostgreSQL localization HTTP contracts', { skip: !connectionString }, () => {
  const schema = `localization_http_${process.pid}_${randomBytes(6).toString('hex')}`;
  const ssl = process.env.PG_TEST_SSL === 'require' ? { rejectUnauthorized: true } : false;
  const admin = new pg.Pool({ connectionString, ssl, max: 1 });
  const pool = new pg.Pool({ connectionString, ssl, options: `-c search_path=${schema},public` });
  const store = new PostgresLocalizationStore(pool);
  let server: Server;
  let baseUrl: string;
  let schemaCreated = false;
  let mongoQueries = 0;
  const forbiddenMongo = new Proxy({}, { get: () => () => { mongoQueries++; throw new Error('MongoDB query in PostgreSQL localization mode'); } });

  before(async () => {
    assert.match(schema, /^localization_http_\d+_[a-f0-9]{12}$/);
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    const migrations = path.resolve(import.meta.dirname, '../../../lib/db/migrations');
    for (const file of (await readdir(migrations)).filter((file) => /^\d+.*\.sql$/.test(file)).sort()) {
      await pool.query(await readFile(path.join(migrations, file), 'utf8'));
    }
    mock.module('../src/data/postgres-localization-store', { namedExports: { localizationStore: 'postgres', pgLocalization: () => store } });
    mock.module('@workspace/legacy-migration/mongo-schemas', { namedExports: {
      TranslationKey: forbiddenMongo, Translation: forbiddenMongo, TranslationLanguage: forbiddenMongo,
      TranslationMetadata: forbiddenMongo, CountryLanguageMapping: forbiddenMongo, ClearedOverridesAuditLog: forbiddenMongo,
    } });
    const cache = { clearByPattern: async () => 0, del: async () => {} };
    mock.module('../src/cache', { defaultExport: cache, namedExports: { CacheManager: cache } });
    mock.module('../src/performance-cache', { namedExports: { performanceCache: { clearCountryLanguageMappings: () => {}, getCountryLanguageMappings: async () => new Map((await store.getCountryLanguageMappings()).map((row) => [row.countryCode, row.languageCode])) } } });
    const { registerTranslationKeyRoutes } = await import('../src/routes/translation-keys-routes');
    const { registerCountryLanguageMappingRoutes } = await import('../src/routes/country-language-mappings');
    const app = express();
    app.use(express.json());
    const requireAdmin = (req: any, res: any, next: () => void) => {
      if (req.headers['x-test-admin'] !== 'true') return void res.status(401).json({ error: 'Admin authentication required' });
      req.user = { email: 'admin@test.invalid' }; next();
    };
    await registerTranslationKeyRoutes(app, { requireAdmin });
    registerCountryLanguageMappingRoutes(app, requireAdmin);
    server = await new Promise<Server>((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    mock.restoreAll();
    await pool.end();
    try {
      if (schemaCreated) {
        assert.match(schema, /^localization_http_\d+_[a-f0-9]{12}$/);
        await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      }
    } finally { await admin.end(); }
  });

  async function request(url: string, method = 'GET', body?: unknown): Promise<{ status: number; body: any }> {
    const response = await fetch(baseUrl + url, { method, headers: { 'Content-Type': 'application/json', 'x-test-admin': 'true' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }

  it('creates keys, upserts translations, rejects an invalid bulk and cascades deletion using SQL only', async () => {
    const created = await request('/api/admin/translation-keys', 'POST', { key: 'welcome', defaultValue: 'Welcome' });
    assert.equal(created.status, 201);
    assert.match(created.body._id, /^[a-f0-9]{24}$/);
    assert.equal((await request('/api/admin/translation-keys', 'POST', { key: 'welcome', defaultValue: 'Duplicate' })).status, 400);
    assert.deepEqual(await request('/api/admin/translations/bulk-upsert', 'POST', { translations: [{ keyId: created.body._id, language: 'tr', value: 'Merhaba', isCompleted: true }] }), { status: 200, body: { success: true, updated: 1 } });
    const rows = await request('/api/admin/all-translations');
    assert.equal(rows.body[0].keyId, created.body._id);
    assert.equal(rows.body[0].value, 'Merhaba');
    const invalid = await request('/api/admin/translations/bulk-upsert', 'POST', { translations: [{ keyId: created.body._id, language: 'tr', value: 'Must not write' }, null] });
    assert.equal(invalid.status, 400);
    assert.equal((await store.findTranslation(created.body._id, 'tr')).value, 'Merhaba');
    assert.equal((await request(`/api/admin/translation-keys/${created.body._id}`, 'DELETE')).status, 200);
    assert.equal(await store.findTranslation(created.body._id, 'tr'), null);
    assert.equal(mongoQueries, 0);
  });

  it('returns compact completion counts and only requested translation values without changing the legacy contract', async () => {
    const key = await store.createKey({ key: 'compact_read_key', defaultValue: 'Source value' });
    const emptyKey = await store.createKey({ key: 'compact_empty_key', defaultValue: 'Another source' });
    for (const code of ['en', 'de', 'tr', 'fr']) {
      await store.saveTranslationLanguage({ code, name: code, isEnabled: code !== 'fr', isDefault: false });
    }
    await store.bulkUpsertTranslations([
      { keyId: key._id, language: 'de', value: 'Hallo', isCompleted: true },
      { keyId: key._id, language: 'en', value: 'Source value', isCompleted: true },
      { keyId: key._id, language: 'tr', value: 'Unfinished draft', isCompleted: false },
      { keyId: key._id, language: 'fr', value: 'Disabled language', isCompleted: true },
      { keyId: emptyKey._id, language: 'de', value: ' \t\n\u00a0\u2003\ufeff ', isCompleted: true },
    ]);
    assert.equal((await fetch(baseUrl + '/api/admin/all-translations?view=summary')).status, 401);
    const summary = await request('/api/admin/all-translations?view=summary');
    assert.deepEqual(summary, { status: 200, body: [{ keyId: key._id, completedCount: 1 }] });
    const language = await request('/api/admin/all-translations?language=de');
    assert.equal(language.status, 200);
    assert.equal(language.body.length, 2);
    assert.ok(language.body.every((row: any) => row.language === 'de'));
    assert.deepEqual(Object.keys(language.body[0]).sort(), ['_id', 'isCompleted', 'keyId', 'language', 'value'].sort());
    const selectedKey = await request(`/api/admin/all-translations?keyId=${key._id}`);
    assert.equal(selectedKey.body.length, 4);
    assert.ok(selectedKey.body.every((row: any) => row.keyId === key._id));
    const combined = await request(`/api/admin/all-translations?keyId=${key._id}&language=de`);
    assert.equal(combined.body.length, 1);
    assert.equal(combined.body[0].value, 'Hallo');
    const legacy = await request('/api/admin/all-translations');
    assert.equal(legacy.body.length, 5);
    assert.ok(Object.hasOwn(legacy.body[0], 'lastModified'));
    for (const query of ['view=other', 'view=summary&language=de', 'language=de&language=tr', 'language=', 'keyId=', 'language=' + 'x'.repeat(257)]) {
      assert.equal((await request('/api/admin/all-translations?' + query)).status, 400, query);
    }
    const legacyKeyId = 'legacy:compact/key';
    await pool.query("INSERT INTO translation_keys(id,key,default_value,category) VALUES($1,'legacy_compact_key','Legacy source','general')", [legacyKeyId]);
    await store.saveTranslationLanguage({ code: 'zh-Hant-TW', name: 'Traditional Chinese', isEnabled: true });
    await store.upsertTranslation({ keyId: legacyKeyId, language: 'zh-hant-tw', value: 'Legacy translation', isCompleted: true });
    const legacyFiltered = await request(`/api/admin/all-translations?keyId=${encodeURIComponent(legacyKeyId)}&language=zh-hant-tw`);
    assert.equal(legacyFiltered.status, 200);
    assert.equal(legacyFiltered.body[0].keyId, legacyKeyId);
    assert.equal(legacyFiltered.body[0].value, 'Legacy translation');
    await store.deleteKey(legacyKeyId);
    await store.deleteKey(key._id);
    await store.deleteKey(emptyKey._id);
  });

  it('records country mapping changes, paginates audits and exports the original deletion snapshot', async () => {
    const saved = await request('/api/admin/country-language-mappings', 'POST', { countryCode: 'de', countryName: 'Germany', languageCode: 'tr' });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.languageCode, 'tr');
    const deleted = await request('/api/admin/country-language-mappings/overrides', 'DELETE');
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.deletedCount, 1);
    const audit = await request('/api/admin/country-language-mappings/cleared-overrides-log?action=clear-overrides&country=germany&limit=1');
    assert.equal(audit.status, 200);
    assert.equal(audit.body.total, 1);
    assert.equal(audit.body.entries[0].actorEmail, 'admin@test.invalid');
    assert.equal(audit.body.entries[0].changes[0].previousLanguageCode, 'tr');
    const response = await fetch(`${baseUrl}/api/admin/country-language-mappings/cleared-overrides-log/${audit.body.entries[0].id}/csv`, { headers: { 'x-test-admin': 'true' } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('Content-Type') || '', /text\/csv/);
    assert.match(await response.text(), /Germany/);
    const restored = await request('/api/admin/country-language-mappings/restore', 'POST', { mappings: [{ countryCode: 'de', countryName: 'Germany', languageCode: 'tr' }] });
    assert.equal(restored.status, 200);
    assert.equal(restored.body.restoredCount, 1);
    assert.equal(mongoQueries, 0);
  });

  it('runs every startup localization seeder with PostgreSQL and keeps customized gap-fill translations', async () => {
    const { seedSeoTranslationKeys, seedTurkishUiTranslations } = await import('../src/routes/translation-keys-routes');
    const { seedAllLanguagesSeoTranslations } = await import('../src/seo/all-languages-seo-seed');
    const { seedHomepageFaqTranslations } = await import('../src/seo/homepage-faq-translations-seed');
    const { seedSearchPageTranslations } = await import('../src/seo/search-page-translations-seed');
    const { seedPremiumTranslations } = await import('../src/seo/premium-translations-seed');
    const { seedSubscriptionUiTranslations } = await import('../src/seo/subscription-ui-translations-seed');
    await seedSeoTranslationKeys();
    await Promise.all([seedTurkishUiTranslations(), seedAllLanguagesSeoTranslations(), seedHomepageFaqTranslations()]);
    await Promise.all([seedSearchPageTranslations(), seedPremiumTranslations(), seedSubscriptionUiTranslations()]);
    const searchKey = await store.findKey('search_page_h1');
    assert.ok((await store.findTranslation(searchKey._id, 'tr')).value);
    await store.upsertTranslation({ keyId: searchKey._id, language: 'tr', value: 'Admin-edited heading', isCompleted: true });
    await seedSearchPageTranslations();
    assert.equal((await store.findTranslation(searchKey._id, 'tr')).value, 'Admin-edited heading');
    assert.ok((await store.getTranslations('de')).nav_stations);
    const navigation = await store.findKey('nav_stations');
    const faq = await store.findKey('faq_q_what_is');
    assert.ok(faq, 'core FAQ key exists');
    await store.upsertTranslation({ keyId: navigation._id, language: 'de', value: 'Human navigation', isCompleted: true });
    await store.upsertTranslation({ keyId: navigation._id, language: 'tr', value: 'Human Turkish draft', isCompleted: false });
    await store.upsertTranslation({ keyId: faq._id, language: 'de', value: 'Human FAQ draft', isCompleted: false });
    const version = (await store.getMetadata()).languagesVersion;
    await Promise.all([seedAllLanguagesSeoTranslations(), seedHomepageFaqTranslations(), seedTurkishUiTranslations()]);
    assert.equal((await store.findTranslation(navigation._id, 'de')).value, 'Human navigation');
    assert.equal((await store.findTranslation(navigation._id, 'tr')).value, 'Human Turkish draft');
    assert.equal((await store.findTranslation(faq._id, 'de')).value, 'Human FAQ draft');
    assert.equal((await store.getMetadata()).languagesVersion, version, 'idempotent boot does not bump version');
    const forced = await request('/api/admin/seed-turkish-ui', 'POST', { force: true });
    assert.equal(forced.status, 200);
    assert.notEqual((await store.findTranslation(navigation._id, 'tr')).value, 'Human Turkish draft');
    assert.equal(mongoQueries, 0);
  });

  it('protects every legacy translation repair endpoint with admin authentication', async () => {
    for (const endpoint of ['/api/fix-turkish-genres', '/api/seed-station-translations', '/api/fix-german-translations']) {
      const response = await fetch(baseUrl + endpoint, { method: 'POST' });
      assert.equal(response.status, 401, endpoint);
    }
  });
});
