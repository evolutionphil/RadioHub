import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import pg from 'pg';
import { PostgresLocalizationStore } from '../src/data/postgres-localization-store';
import { PostgresAdminSettingsStore } from '../src/data/postgres-admin-settings-store';

describe('PostgreSQL localization runtime state and settings', { skip: !process.env.PG_TEST_DATABASE_URL }, () => {
  const schema = `localization_state_${process.pid}_${randomBytes(6).toString('hex')}`;
  const options = { connectionString: process.env.PG_TEST_DATABASE_URL, ssl: process.env.PG_TEST_SSL === 'require' ? { rejectUnauthorized: true } : false };
  const admin = new pg.Pool({ ...options, max: 1 });
  const pool = new pg.Pool({ ...options, max: 8, options: `-c search_path=${schema},public` });
  const localization = new PostgresLocalizationStore(pool);
  const settings = new PostgresAdminSettingsStore(pool);
  const cache = new Map<string, Record<string, string>>();
  let schemaCreated = false;
  let server: Server;
  let baseUrl = '';
  let qualified: typeof import('../src/seo/qualified-languages');
  let settingsService: typeof import('../src/services/mapping-audit-digest-settings');
  let digest: typeof import('../src/services/scheduled-mapping-audit-digest');
  let sync: typeof import('../src/services/translation-sync');
  let delivered: any[] = [];
  const originalApiKey = process.env.OPENAI_API_KEY;

  before(async () => {
    assert.match(schema, /^localization_state_\d+_[a-f0-9]{12}$/);
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    const migrations = path.resolve(import.meta.dirname, '../../../lib/db/migrations');
    for (const file of (await readdir(migrations)).filter((file) => /^\d+.*\.sql$/.test(file)).sort()) {
      await pool.query(await readFile(path.join(migrations, file), 'utf8'));
    }
    mock.module('../src/postgres-runtime', { namedExports: { getPostgresPool: () => pool, getPostgresCoordinationPool: () => pool } });
    mock.module('../src/data/postgres-localization-store', { namedExports: { pgLocalization: () => localization } });
    mock.module('../src/data/postgres-admin-settings-store', { namedExports: { pgAdminSettings: () => settings, getAdminSetting: (key: string) => settings.get(key) } });
    mock.module('../src/performance-cache', { namedExports: { performanceCache: {
      getTranslations: (language: string) => cache.get(language) || null,
      setTranslations: (language: string, map: Record<string, string>) => cache.set(language, map),
    } } });
    mock.module('@workspace/seo-shared/seo-config', { namedExports: {
      ACTIVE_SITEMAP_LANGUAGES: ['en', 'de', 'fr'],
      SITEMAP_PRIORITY_LANGUAGES: { universal14: ['en'] },
      hasCompleteSeoTranslations: (map: Record<string, string>) => !!map.seo_title,
    } });
    mock.module('../src/services/admin-audit-email', { namedExports: { emailMappingAuditDigest: async (args: any) => {
      delivered.push(args);
      return { skipped: args.entries.length === 0, totalEntries: args.entries.length };
    } } });
    mock.module('openai', { defaultExport: class {
      chat = { completions: { create: async (args: any) => ({ choices: [{ message: {
        content: JSON.stringify(Object.fromEntries(JSON.parse(args.messages[1].content).map((entry: any) => [entry.key, `DE: ${entry.english}`]))),
      } }] }) } };
    } });
    process.env.OPENAI_API_KEY = 'test-local-mocked-no-network';
    sync = await import('../src/services/translation-sync');
    qualified = await import('../src/seo/qualified-languages');
    settingsService = await import('../src/services/mapping-audit-digest-settings');
    digest = await import('../src/services/scheduled-mapping-audit-digest');
    const { registerAdminMappingAuditDigestSettingsRoutes } = await import('../src/routes/admin-mapping-audit-digest-settings-routes');
    const app = express();
    app.use(express.json());
    registerAdminMappingAuditDigestSettingsRoutes(app, { requireAdmin: (req: any, res: any, next: () => void) => {
      if (req.headers['x-test-admin'] !== 'true') return void res.status(401).end();
      req.session = { adminAuth: { username: 'test-admin' } }; next();
    } });
    server = await new Promise<Server>((resolve) => { const result = app.listen(0, '127.0.0.1', () => resolve(result)); });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE admin_settings,admin_setting_history,seo_qualified_languages_lkg,translations,translation_keys,country_language_mapping_audit CASCADE');
    cache.clear(); delivered = [];
    await qualified.invalidateQualifiedLanguages();
    settingsService.invalidateMappingAuditDigestSettingsCache();
  });
  after(async () => {
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalApiKey;
    if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    mock.restoreAll(); await pool.end();
    try {
      if (schemaCreated) {
        assert.match(schema, /^localization_state_\d+_[a-f0-9]{12}$/);
        await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      }
    } finally { await admin.end(); }
  });
  async function request(suffix = '', method = 'GET', body?: unknown) {
    const response = await fetch(baseUrl + '/api/admin/settings/mapping-audit-digest' + suffix, {
      method, headers: { 'content-type': 'application/json', 'x-test-admin': 'true' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as any };
  }

  it('preserves mixed JSON values, identity and actor metadata through update and clear history', async () => {
    const value = { null: null, boolean: false, array: ['ü', 0, { nested: true }], text: "O'Reilly" };
    await settings.save({ key: 'mixed', value, changedBy: 'first' });
    const first = await settings.get('mixed');
    assert.deepEqual(first.value, value);
    assert.deepEqual((await settings.save({ key: 'mixed', value: [false, 42], changedBy: 'second' })).previousValue, value);
    const second = await settings.get('mixed');
    assert.equal(second._id, first._id);
    assert.equal(second.createdAt.getTime(), first.createdAt.getTime());
    assert.deepEqual((await settings.clear({ key: 'mixed', changedBy: 'third' })).previousValue, [false, 42]);
    const history = await settings.history('mixed', 100);
    assert.deepEqual(history.map((row) => row.changedBy), ['third', 'second', 'first']);
    assert.deepEqual(history[1].previousValue, value);
    assert.equal(await settings.get('mixed'), null);
  });
  it('keeps previous imported JSONB numeric precision intact in audit history', async () => {
    await pool.query(`INSERT INTO admin_settings(id,key,value) VALUES ('precise','precise','{"large":9007199254740993,"fraction":0.123456789123456789}'::jsonb)`);
    await settings.save({ key: 'precise', value: { fresh: 1 }, changedBy: 'editor' });
    const exact = (await pool.query("SELECT previous_value->>'large' AS large,previous_value->>'fraction' AS fraction FROM admin_setting_history WHERE key='precise'")).rows[0];
    assert.deepEqual(exact, { large: '9007199254740993', fraction: '0.123456789123456789' });
  });
  it('serializes concurrent writes into an unbroken previous-value history chain', async () => {
    await Promise.all(Array.from({ length: 16 }, (_, n) => settings.save({ key: 'concurrent', value: n, changedBy: `actor-${n}` })));
    const rows = await settings.history('concurrent', 100);
    assert.equal(rows.length, 16);
    assert.equal(rows.filter((row) => row.previousValue === null).length, 1);
    const previous = new Set(rows.filter((row) => row.previousValue !== null).map((row) => row.previousValue));
    const final = (await settings.get('concurrent')).value;
    assert.ok(!previous.has(final));
    assert.equal(previous.size, 15);
  });
  it('rolls back both value changes and deletes if the audit insert fails', async () => {
    await settings.save({ key: 'rollback', value: 'original', changedBy: 'owner' });
    await pool.query("ALTER TABLE admin_setting_history ADD CONSTRAINT test_actor CHECK (changed_by <> 'reject')");
    try {
      await assert.rejects(settings.save({ key: 'rollback', value: 'wrong', changedBy: 'reject' }), (error: any) => error.code === '23514');
      await assert.rejects(settings.clear({ key: 'rollback', changedBy: 'reject' }), (error: any) => error.code === '23514');
      assert.equal((await settings.get('rollback')).value, 'original');
      assert.equal((await settings.history('rollback', 100)).length, 1);
    } finally { await pool.query('ALTER TABLE admin_setting_history DROP CONSTRAINT test_actor'); }
  });
  it('rejects lossy JSON inputs before writing and supports absent-clear history semantics', async () => {
    for (const value of [NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, { x: undefined }]) {
      await assert.rejects(settings.save({ key: 'invalid', value, changedBy: null }), TypeError);
    }
    assert.equal(await settings.get('invalid'), null);
    assert.equal((await settings.clear({ key: 'absent', changedBy: null, skipHistoryWhenAbsent: true })).existed, false);
    assert.equal((await settings.history('absent', 100)).length, 0);
    await settings.clear({ key: 'absent', changedBy: null });
    assert.equal((await settings.history('absent', 100)).length, 1);
  });
  it('prunes settings history per key with deterministic tied-timestamp ordering', async () => {
    await pool.query(`INSERT INTO admin_setting_history(id,key,action,changed_at)
      SELECT 'history-'||lpad(n::text,4,'0'),'hot','update',now() FROM generate_series(1,505) n`);
    await settings.save({ key: 'quiet', value: true, changedBy: null });
    assert.deepEqual(await settings.pruneHistory(), { keysProcessed: 2, rowsTrimmed: 5 });
    assert.equal((await pool.query("SELECT count(*)::integer AS count FROM admin_setting_history WHERE key='hot'")).rows[0].count, 500);
    assert.equal((await pool.query("SELECT id FROM admin_setting_history WHERE id='history-0005'")).rowCount, 0);
    assert.equal((await settings.history('quiet', 100)).length, 1);
  });
  it('settings HTTP edits validate cadence, record actors and restore defaults when cleared', async () => {
    assert.equal((await request('', 'PUT', { cadence: 'hourly' })).status, 400);
    const saved = await request('', 'PUT', { cadence: 'weekly' });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.effective.cadence, 'weekly');
    assert.equal(saved.body.effective.source, 'db');
    assert.equal(saved.body.updatedBy, 'test-admin');
    const history = await request('/history');
    assert.equal(history.body.entries[0].changedBy, 'test-admin');
    assert.equal((await request('', 'DELETE')).status, 200);
    assert.notEqual((await request()).body.effective.source, 'db');
    assert.equal((await fetch(baseUrl + '/api/admin/settings/mapping-audit-digest')).status, 401);
  });
  it('does not turn a PostgreSQL settings outage into successful defaults or an empty result', async () => {
    const fault = mock.method(settings, 'get', async () => { throw new Error('Injected PostgreSQL settings outage'); });
    try {
      assert.equal((await request()).status, 500);
      await assert.rejects(settingsService.resolveMappingAuditDigestSettings());
    } finally { fault.mock.restore(); }
  });
  it('persists qualified languages natively and bootstraps from an unexpired LKG', async () => {
    const key = await localization.createKey({ key: 'seo_title', defaultValue: 'Title' });
    await localization.upsertTranslation({ keyId: key._id, language: 'de', value: 'Titel' });
    const state = await qualified.getQualifiedLanguagesState();
    assert.deepEqual([...state.languages].sort(), ['de', 'en']);
    const lkg = await localization.getQualifiedLanguagesLkg('qualified_languages');
    assert.equal(lkg.hash, state.hash);
    await qualified.invalidateQualifiedLanguages(); cache.clear();
    const boot = await qualified.initializeQualifiedLanguages();
    assert.equal(boot.source, 'lkg');
    assert.deepEqual([...boot.languages].sort(), ['de', 'en']);
  });
  it('rejects expired LKGs, retains identity on refresh, and fails closed when SQL is unavailable', async () => {
    const now = new Date();
    await localization.saveQualifiedLanguagesLkg({ key: 'qualified_languages', languages: ['de'], hash: 'old', source: 'computed', computedAt: now, expiresAt: new Date(now.getTime() - 1) });
    assert.equal(await localization.getQualifiedLanguagesLkg('qualified_languages'), null);
    const id = (await pool.query('SELECT id FROM seo_qualified_languages_lkg')).rows[0].id;
    await localization.saveQualifiedLanguagesLkg({ key: 'qualified_languages', languages: ['de'], hash: 'new', source: 'computed', computedAt: now, expiresAt: new Date(now.getTime() + 60_000) });
    assert.equal((await pool.query('SELECT id FROM seo_qualified_languages_lkg')).rows[0].id, id);
    const fault = mock.method(localization, 'getTranslations', async () => { throw new Error('Injected PostgreSQL translation outage'); });
    try {
      assert.equal((await qualified.getQualifiedLanguagesState()).source, 'lkg');
      await qualified.invalidateQualifiedLanguages();
      await pool.query('DELETE FROM seo_qualified_languages_lkg');
      await assert.rejects(qualified.initializeQualifiedLanguages());
      assert.equal((await pool.query('SELECT count(*)::integer AS count FROM seo_qualified_languages_lkg')).rows[0].count, 0);
    } finally { fault.mock.restore(); }
  });
  it('digest uses native audit rows in its time window and respects scheduled-off/manual-run behavior', async () => {
    await settings.save({ key: 'mapping-audit-digest', value: { cadence: 'off' }, changedBy: 'editor' });
    const skipped = await digest.scheduledMappingAuditDigest.runOnce('test', { respectCadence: true });
    assert.equal(skipped?.reason, 'cadence-off');
    assert.equal(delivered.length, 0);
    await pool.query(`INSERT INTO country_language_mapping_audit(id,action,actor_email,created_at) VALUES
      ('recent','edit','editor',now()-interval '1 hour'),('old','edit','editor',now()-interval '2 days')`);
    const result = await digest.scheduledMappingAuditDigest.runOnce('manual:test');
    assert.equal(result?.totalEntries, 1);
    assert.equal(delivered[0].entries[0].actorEmail, 'editor');
    assert.equal(delivered[0].entries[0].action, 'edit');
  });

  it('translation discovery and missing-language generation persist native keys and never overwrite admin text', async () => {
    const scan = mock.method(sync.TranslationSyncService, 'scanFrontendForKeys', async () => [
      { key: 'nav_discovery_test', defaultValue: 'Hello {name}', filePath: '/fixture.tsx', lineNumber: 1 },
    ]);
    try {
      assert.deepEqual(await sync.TranslationSyncService.syncNewKeys(), { added: 1, existing: 0 });
      assert.deepEqual(await sync.TranslationSyncService.syncNewKeys(), { added: 0, existing: 1 });
      await localization.saveTranslationLanguage({ code: 'de', name: 'German', isEnabled: true });
      assert.deepEqual(await sync.TranslationSyncService.translateMissingForLanguage('de'), { translated: 1, failed: 0 });
      const key = await localization.findKey('nav_discovery_test');
      assert.equal((await localization.findTranslation(key._id, 'de')).value, 'DE: Hello {name}');
      await localization.upsertTranslation({ keyId: key._id, language: 'de', value: 'Admin customized', isCompleted: true });
      assert.deepEqual(await sync.TranslationSyncService.translateMissingForLanguage('de'), { translated: 0, failed: 0 });
      assert.equal((await localization.findTranslation(key._id, 'de')).value, 'Admin customized');
    } finally { scan.mock.restore(); }
  });
  it('translation sync propagates PostgreSQL key-write failure instead of returning an empty success', async () => {
    const scan = mock.method(sync.TranslationSyncService, 'scanFrontendForKeys', async () => [
      { key: 'failed_key', defaultValue: 'Hello', filePath: '/fixture.tsx', lineNumber: 1 },
    ]);
    await pool.query("ALTER TABLE translation_keys ADD CONSTRAINT test_postgres_key_outage CHECK (key <> 'failed_key')");
    try { await assert.rejects(sync.TranslationSyncService.syncNewKeys(), /test_postgres_key_outage/); }
    finally { scan.mock.restore(); await pool.query('ALTER TABLE translation_keys DROP CONSTRAINT test_postgres_key_outage'); }
  });
});
