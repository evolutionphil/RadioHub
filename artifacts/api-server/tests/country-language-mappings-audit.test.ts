/**
 * Country mapping audit regression contracts, exercised against real PostgreSQL.
 * Each suite owns a randomly named schema; a test database must be explicit.
 */
import { describe, it, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import pg from 'pg';
import { PostgresLocalizationStore } from '../src/data/postgres-localization-store';

describe('PostgreSQL country mapping audit regression', { skip: !process.env.PG_TEST_DATABASE_URL }, () => {
  const schema = `mapping_audit_${process.pid}_${randomBytes(6).toString('hex')}`;
  const options = { connectionString: process.env.PG_TEST_DATABASE_URL, ssl: process.env.PG_TEST_SSL === 'require' ? { rejectUnauthorized: true } : false };
  const admin = new pg.Pool({ ...options, max: 1 });
  const pool = new pg.Pool({ ...options, options: `-c search_path=${schema},public` });
  const store = new PostgresLocalizationStore(pool);
  let schemaCreated = false;
  let server: Server;
  let baseUrl = '';
  const actor = 'admin+literal_100%@example.test';

  before(async () => {
    assert.match(schema, /^mapping_audit_\d+_[a-f0-9]{12}$/);
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    const migrations = path.resolve(import.meta.dirname, '../../../lib/db/migrations');
    for (const file of (await readdir(migrations)).filter((file) => /^\d+.*\.sql$/.test(file)).sort()) {
      await pool.query(await readFile(path.join(migrations, file), 'utf8'));
    }
    mock.module('../src/data/postgres-localization-store', { namedExports: { pgLocalization: () => store } });
    mock.module('../src/performance-cache', { namedExports: { performanceCache: { clearCountryLanguageMappings() {} } } });
    mock.module('../src/seo/load-database-mappings', { namedExports: { async loadDatabaseCountryLanguageMappings() {} } });
    mock.module('@workspace/seo-shared/seo-config', { namedExports: {
      COUNTRY_TO_CODE: { 'United States': 'US', France: 'FR', Germany: 'DE' },
      COUNTRY_TO_LANGUAGE: { US: 'en', FR: 'fr', DE: 'de' },
      SEO_LANGUAGES: [{ code: 'en', name: 'English' }, { code: 'de', name: 'German' }],
    } });
    mock.module('../src/services/admin-audit-email', { namedExports: {
      async emailClearedOverridesCsv() {}, async emailResetAllMappingsCsv() {},
      buildClearedOverridesCsv: () => 'csv', buildClearedOverridesHistoryCsv: () => 'csv',
    } });
    const { registerCountryLanguageMappingRoutes } = await import('../src/routes/country-language-mappings');
    const app = express();
    app.use(express.json());
    registerCountryLanguageMappingRoutes(app, (req: any, _res: any, next: () => void) => { req.user = { email: actor }; next(); });
    server = await new Promise<Server>((resolve) => { const result = app.listen(0, '127.0.0.1', () => resolve(result)); });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  beforeEach(async () => { await pool.query('TRUNCATE country_language_mappings,country_language_mapping_audit'); });
  after(async () => {
    if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    mock.restoreAll();
    await pool.end();
    try {
      if (schemaCreated) {
        assert.match(schema, /^mapping_audit_\d+_[a-f0-9]{12}$/);
        await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      }
    } finally { await admin.end(); }
  });
  async function request(suffix = '', method = 'GET', body?: unknown) {
    const response = await fetch(baseUrl + '/api/admin/country-language-mappings' + suffix, {
      method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    assert.equal(response.status, 200);
    return response.json() as Promise<any>;
  }
  const mapping = (countryCode = 'US', languageCode = 'es') => ({ countryCode, countryName: { US: 'United States', FR: 'France', DE: 'Germany' }[countryCode] || countryCode, languageCode });
  const audits = () => store.listMappingAudit({});

  it('new mapping writes exactly one edit audit with actor and null previous language', async () => {
    await request('', 'POST', mapping());
    const rows = (await audits()).entries;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].action, 'edit');
    assert.equal(rows[0].actorEmail, actor);
    assert.deepEqual(rows[0].changes, [{ countryCode: 'US', countryName: 'United States', previousLanguageCode: null, newLanguageCode: 'es' }]);
  });
  it('existing mapping records previous and new language in its edit audit', async () => {
    await request('', 'POST', mapping());
    await request('', 'POST', mapping('US', 'de'));
    const rows = (await audits()).entries;
    assert.equal(rows.length, 2);
    assert.equal(rows[0].changes[0].previousLanguageCode, 'es');
    assert.equal(rows[0].changes[0].newLanguageCode, 'de');
  });
  it('same-language metadata edits are persisted without manufacturing a language-change audit', async () => {
    await request('', 'POST', mapping());
    await request('', 'POST', { ...mapping(), notes: 'New note' });
    assert.equal((await audits()).total, 1);
    assert.equal((await store.getCountryLanguageMappings(false))[0].notes, 'New note');
  });
  it('bulk save creates one audit containing only changed language rows', async () => {
    await request('', 'POST', mapping());
    await request('/bulk', 'POST', { mappings: [mapping(), mapping('FR', 'de')] });
    const rows = (await store.listMappingAudit({ action: 'bulk-save' })).entries;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].changes.length, 1);
    assert.equal(rows[0].changes[0].countryCode, 'FR');
  });
  it('single-country deletion records the removed language, and an absent delete is a no-op', async () => {
    await request('', 'POST', mapping());
    await request('/US', 'DELETE');
    await request('/US', 'DELETE');
    const rows = (await store.listMappingAudit({ action: 'delete' })).entries;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].changes[0].previousLanguageCode, 'es');
    assert.equal(rows[0].changes[0].newLanguageCode, null);
  });
  it('clear overrides deletes only overrides and captures their original snapshot', async () => {
    await request('/bulk', 'POST', { mappings: [mapping(), mapping('FR', 'fr')] });
    assert.equal((await request('/overrides', 'DELETE')).deletedCount, 1);
    const rows = (await store.listMappingAudit({ action: 'clear-overrides' })).entries;
    assert.deepEqual(rows[0].snapshot, [{ countryCode: 'US', countryName: 'United States', currentLanguageCode: 'es', defaultLanguageCode: 'en' }]);
    assert.deepEqual((await store.getCountryLanguageMappings(false)).map((row) => row.countryCode), ['FR']);
  });
  it('reset-all captures every mapping, including default-matching entries and empty resets', async () => {
    await request('/bulk', 'POST', { mappings: [mapping(), mapping('FR', 'fr')] });
    assert.equal((await request('', 'DELETE')).deletedCount, 2);
    assert.equal((await request('', 'DELETE')).deletedCount, 0);
    const rows = (await store.listMappingAudit({ action: 'reset-all' })).entries;
    assert.deepEqual(rows.map((row) => row.snapshot.length), [0, 2]);
  });
  it('on-write retention keeps newest 500 rows and removes rows older than 180 days', async () => {
    await pool.query(`INSERT INTO country_language_mapping_audit(id,action,created_at)
      SELECT 'old-'||n,'edit',now() - (n||' minutes')::interval FROM generate_series(1,501) n`);
    await pool.query("INSERT INTO country_language_mapping_audit(id,action,created_at) VALUES ('expired','edit',now()-interval '181 days')");
    await request('', 'POST', mapping());
    assert.equal((await audits()).total, 500);
    assert.equal((await pool.query("SELECT id FROM country_language_mapping_audit WHERE id IN ('expired','old-501','old-500')")).rowCount, 0);
    assert.equal((await pool.query("SELECT id FROM country_language_mapping_audit WHERE id='old-1'")).rowCount, 1);
  });
  it('action filter limits audit responses, while all returns every action', async () => {
    await request('', 'POST', mapping());
    await request('/US', 'DELETE');
    const edits = await request('/cleared-overrides-log?action=edit');
    assert.equal(edits.total, 1);
    assert.equal(edits.entries[0].action, 'edit');
    assert.equal((await request('/cleared-overrides-log?action=all')).total, 2);
  });
  it('actor filter matches case-insensitively and treats metacharacters literally', async () => {
    await request('', 'POST', mapping());
    assert.equal((await request('/cleared-overrides-log?actorEmail=' + encodeURIComponent('+LITERAL_100%'))).total, 1);
    assert.equal((await request('/cleared-overrides-log?actorEmail=' + encodeURIComponent('.*'))).total, 0);
  });
  it('country filter searches both deletion snapshots and edit changes', async () => {
    await request('', 'POST', mapping());
    await request('/overrides', 'DELETE');
    assert.equal((await request('/cleared-overrides-log?country=united')).total, 2);
    assert.equal((await request('/cleared-overrides-log?country=' + encodeURIComponent('.*'))).total, 0);
  });
  it('date-only upper bound includes the full UTC day and retains pagination totals', async () => {
    await pool.query(`INSERT INTO country_language_mapping_audit(id,action,created_at) VALUES
      ('day-a','edit','2026-09-01T01:00:00Z'),('day-b','edit','2026-09-01T23:59:59.999Z'),('next','edit','2026-09-02T00:00:00Z')`);
    const result = await request('/cleared-overrides-log?from=2026-09-01&to=2026-09-01&limit=1&offset=1');
    assert.equal(result.total, 2);
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].id, 'day-a');
  });
});
