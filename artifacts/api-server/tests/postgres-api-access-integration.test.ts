import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import pg from 'pg';

const connectionString = process.env.PG_TEST_DATABASE_URL;
describe('Native PostgreSQL developer API access', { skip: !connectionString }, () => {
  const schema = `api_access_test_${process.pid}_${randomBytes(6).toString('hex')}`;
  const ssl = process.env.PG_TEST_SSL === 'require' ? { rejectUnauthorized: true } : false;
  const admin = new pg.Pool({ connectionString, ssl, max: 1 });
  const oldEnv = { DATABASE_URL: process.env.DATABASE_URL, POSTGRES_SSL: process.env.POSTGRES_SSL };
  let pool: pg.Pool;
  let closePostgres: () => Promise<void>;
  let store: typeof import('../src/data/postgres-api-access-store');
  let server: Server;
  let baseUrl: string;
  let schemaCreated = false;
  before(async () => {
    assert.match(schema, /^api_access_test_\d+_[a-f0-9]{12}$/);
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    const url = new URL(connectionString!);
    url.searchParams.set('options', `-c search_path=${schema},public`);
    process.env.DATABASE_URL = url.toString();
    process.env.POSTGRES_SSL = ssl ? 'require' : 'disable';
    const runtime = await import('../src/postgres-runtime');
    pool = runtime.getPostgresPool();
    closePostgres = runtime.closePostgres;
    await pool.query(await readFile(path.resolve(import.meta.dirname, '../../../lib/db/migrations/0012_api_access.sql'), 'utf8'));
    store = await import('../src/data/postgres-api-access-store');
    const routes = await import('../src/routes/api-keys');
    const adminRoutes = await import('../src/routes/admin-api-keys-routes');
    const app = express();
    app.use(express.json());
    app.use('/keys', routes.default);
    app.get('/public', routes.apiKeyMiddleware, (_req, res) => res.json({ ok: true }));
    // Mirrors production's explicit requireAdmin mount, without an unrelated auth graph.
    app.use('/admin', (req, res, next) => {
      if (req.headers['x-test-admin'] !== 'yes') { res.sendStatus(403); return; }
      next();
    }, adminRoutes.default);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  after(async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
    if (closePostgres) await closePostgres();
    try {
      if (schemaCreated) {
        assert.match(schema, /^api_access_test_\d+_[a-f0-9]{12}$/);
        await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      }
    } finally {
      await admin.end();
      for (const [key, value] of Object.entries(oldEnv)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });
  const accepted = (results: PromiseSettledResult<any>[]) => results.filter((result): result is PromiseFulfilledResult<any> => result.status === 'fulfilled');
  async function json(route: string, body?: unknown, headers: Record<string, string> = {}) {
    const response = await fetch(baseUrl + route, { method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const result = response.headers.get('content-type')?.includes('json') ? await response.json() as any : await response.text();
    return { response, body: result };
  }

  it('serializes case-insensitive concurrent issuance and never exposes stored key hashes', async () => {
    const results = await Promise.allSettled(Array.from({ length: 24 }, (_, index) => store.pgIssueApiKey({
      name: 'Concurrent', email: index % 2 ? 'Key-Cap@example.invalid' : 'key-cap@example.invalid',
    })));
    assert.equal(accepted(results).length, 3);
    for (const failure of results.filter(result => result.status === 'rejected')) {
      assert.equal((failure as PromiseRejectedResult).reason.status, 429);
    }
    const rows = await store.pgApiKeysForEmail('KEY-CAP@example.invalid');
    assert.equal(rows.length, 3);
    assert.equal(new Set(rows.map(row => row._id)).size, 3);
    assert.equal(JSON.stringify(rows).includes('keyHash'), false);
    const stored = (await pool.query("SELECT key_hash FROM api_keys WHERE email='key-cap@example.invalid'")).rows;
    assert.equal(new Set(stored.map(row => row.key_hash)).size, 3);
    for (const result of accepted(results)) {
      assert.match(result.value.apiKey, /^mr_[A-Za-z0-9_-]{32}$/);
      assert.ok(stored.some(row => row.key_hash === store.hashApiSecret(result.value.apiKey)));
    }
  });

  it('registers owner, initial key and durable session in one transaction', async () => {
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => store.pgRegisterApiDeveloper({
      email: 'register@example.invalid', name: 'Registered', passwordHash: 'fixture-not-real-password',
    })));
    assert.equal(accepted(results).length, 1);
    const registered = accepted(results)[0].value;
    assert.deepEqual(await store.pgAuthenticateApiDeveloper(registered.token), { userId: registered.user._id, email: 'register@example.invalid' });
    const stored = (await pool.query('SELECT token_hash FROM api_developer_sessions WHERE user_id=$1', [registered.user._id])).rows;
    assert.equal(stored.length, 1);
    assert.equal(stored[0].token_hash, store.hashApiSecret(registered.token));
    assert.notEqual(stored[0].token_hash, registered.token);
    await store.pgRevokeApiDeveloperSession(registered.token);
    assert.equal(await store.pgAuthenticateApiDeveloper(registered.token), null);
    const token = await store.pgCreateApiDeveloperSession(registered.user._id);
    await pool.query("UPDATE api_developer_users SET status='suspended' WHERE id=$1", [registered.user._id]);
    assert.equal(await store.pgAuthenticateApiDeveloper(token), null);
    assert.equal((await store.pgFindApiKeyByHash(store.hashApiSecret(registered.apiKey))).status, 'suspended');
    await assert.rejects(store.pgConsumeApiKey(store.hashApiSecret(registered.apiKey)), (error: any) => error.status === 403);
    await assert.rejects(store.pgCreateApiDeveloperSession(registered.user._id), (error: any) => error.status === 403);
  });

  it('rolls back a new developer when issuing their first key fails', async () => {
    await assert.rejects(store.pgRegisterApiDeveloper({
      email: 'key-cap@example.invalid', name: 'Must not exist', passwordHash: 'unused',
    }), (error: any) => error.status === 429);
    assert.equal(await store.pgFindApiDeveloperByEmail('key-cap@example.invalid'), null);
    assert.equal((await pool.query("SELECT count(*)::int count FROM api_developer_users WHERE email='key-cap@example.invalid'")).rows[0].count, 0);
  });

  it('issues one demo key per cooldown under concurrent replicas and renews atomically', async () => {
    const ip = store.hashApiSecret('test-ip');
    const results = await Promise.allSettled(Array.from({ length: 16 }, () => store.pgIssueDemoApiKey(ip)));
    assert.equal(accepted(results).length, 1);
    assert.equal((await store.pgApiDemoStatus(ip)).available, false);
    assert.equal((await pool.query('SELECT usage_count FROM api_demo_usage WHERE ip_hash=$1', [ip])).rows[0].usage_count, '1');
    assert.equal((await pool.query("SELECT count(*)::int count FROM api_keys WHERE plan='demo'")).rows[0].count, 1);
    await pool.query("UPDATE api_demo_usage SET expires_at=now()-interval '1 second' WHERE ip_hash=$1", [ip]);
    assert.equal(await store.pgApiDemoStatus(ip), null);
    const renewed = await store.pgIssueDemoApiKey(ip);
    assert.notEqual(renewed.apiKey, accepted(results)[0].value.apiKey);
    assert.equal((await pool.query('SELECT usage_count FROM api_demo_usage WHERE ip_hash=$1', [ip])).rows[0].usage_count, '2');
    // Failed durable cooldown write must roll back the just-created key.
    await pool.query("ALTER TABLE api_demo_usage ADD CONSTRAINT fixture_reject_demo CHECK(ip_hash <> 'reject-demo')");
    const before = (await pool.query('SELECT count(*)::int count FROM api_keys')).rows[0].count;
    await assert.rejects(store.pgIssueDemoApiKey('reject-demo'), (error: any) => error.code === '23514');
    assert.equal((await pool.query('SELECT count(*)::int count FROM api_keys')).rows[0].count, before);
  });

  it('enforces minute/day/month quotas across concurrent connections with atomic rollovers', async () => {
    const issued = await store.pgIssueApiKey({ name: 'Quota', email: 'quota@example.invalid' });
    const hash = store.hashApiSecret(issued.apiKey);
    await pool.query('UPDATE api_keys SET rate_limit_per_min=5,daily_quota=7,monthly_quota=9 WHERE id=$1', [issued.key._id]);
    const burst = await Promise.allSettled(Array.from({ length: 30 }, () => store.pgConsumeApiKey(hash)));
    assert.equal(accepted(burst).length, 5);
    let key = await store.pgFindApiKeyByHash(hash);
    assert.equal(key.usage.totalCount, 5);
    assert.equal(key.usage.todayCount, 5);
    await pool.query("UPDATE api_keys SET minute_reset_at=now()-interval '1 second' WHERE id=$1", [issued.key._id]);
    assert.equal(accepted(await Promise.allSettled(Array.from({ length: 20 }, () => store.pgConsumeApiKey(hash)))).length, 2);
    key = await store.pgFindApiKeyByHash(hash);
    assert.equal(key.usage.todayCount, 7);
    assert.equal(key.usage.totalCount, 7);
    // A new UTC day resets daily usage only, leaving monthly usage at seven.
    await pool.query("UPDATE api_keys SET last_reset_day='2000-01-01',minute_reset_at=now()-interval '1 second' WHERE id=$1", [issued.key._id]);
    assert.equal(accepted(await Promise.allSettled(Array.from({ length: 20 }, () => store.pgConsumeApiKey(hash)))).length, 2);
    key = await store.pgFindApiKeyByHash(hash);
    assert.equal(key.usage.todayCount, 2);
    assert.equal(key.usage.monthCount, 9);
    assert.equal(key.usage.totalCount, 9);
    await pool.query("UPDATE api_keys SET last_reset_day='2000-01-01',last_reset_month='2000-01',minute_reset_at=now()-interval '1 second' WHERE id=$1", [issued.key._id]);
    assert.equal(accepted(await Promise.allSettled(Array.from({ length: 20 }, () => store.pgConsumeApiKey(hash)))).length, 5);
    key = await store.pgFindApiKeyByHash(hash);
    assert.equal(key.usage.todayCount, 5);
    assert.equal(key.usage.monthCount, 5);
    assert.equal(key.usage.totalCount, 14);
    const upgraded = await store.pgUpdateApiKeyPlan(issued.key._id, 'pro');
    assert.equal(upgraded.rateLimitPerMin, 300);
    await store.pgConsumeApiKey(hash);
    await store.pgUpdateApiKeyStatus(issued.key._id, 'revoked');
    await assert.rejects(store.pgConsumeApiKey(hash), (error: any) => error.status === 403);
    await assert.rejects(store.pgConsumeApiKey('missing'), (error: any) => error.status === 401);
  });

  it('retains total usage for internal keys while enforcing expiration and owner checks', async () => {
    const internal = await store.pgIssueApiKey({ name: 'Internal', email: 'internal@example.invalid', plan: 'internal' });
    await pool.query('UPDATE api_keys SET daily_quota=0,monthly_quota=0,rate_limit_per_min=1 WHERE id=$1', [internal.key._id]);
    await Promise.all(Array.from({ length: 12 }, () => store.pgConsumeApiKey(store.hashApiSecret(internal.apiKey))));
    const key = await store.pgFindApiKeyByHash(store.hashApiSecret(internal.apiKey));
    assert.equal(key.usage.totalCount, 12);
    assert.equal(key.usage.todayCount, 0);
    await pool.query("UPDATE api_keys SET expires_at=now()-interval '1 second' WHERE id=$1", [internal.key._id]);
    await assert.rejects(store.pgConsumeApiKey(store.hashApiSecret(internal.apiKey)), (error: any) => error.status === 403);
    await assert.rejects(store.pgRevokeOwnedApiKey(internal.key._id, 'other@example.invalid'), (error: any) => error.status === 404);
  });

  it('exposes stable admin shapes without password/key hashes or source and literal-safe search', async () => {
    const keys = await store.pgAdminApiKeys({ search: 'key-cap', plan: 'free', status: 'active', page: 1, limit: 2 });
    assert.equal(keys.totalCount, 3);
    assert.equal(keys.keys.length, 2);
    assert.equal(keys.pages, 2);
    assert.equal(JSON.stringify(keys).includes('key_hash'), false);
    assert.equal(JSON.stringify(keys).includes('keyHash'), false);
    assert.equal(JSON.stringify(keys).includes('"source"'), false);
    assert.equal((await store.pgAdminApiKeys({ search: "%' OR 1=1 --", plan: '', status: '', page: 1, limit: 10 })).totalCount, 0);
    const users = await store.pgAdminApiDevelopers({ search: 'register', page: 1, limit: 10 });
    assert.equal(users.totalCount, 1);
    assert.equal(users.users[0].keyCount, 1);
    assert.equal(JSON.stringify(users).includes('password'), false);
    const stats = await store.pgApiAccessStats();
    assert.ok(stats.totalKeys > 0);
    assert.ok(stats.requests.total >= 27);
    assert.equal((await json('/admin/stats')).response.status, 403);
    assert.equal((await json('/admin/keys', undefined, { 'x-test-admin': 'yes' })).response.status, 200);
  });

  it('preserves HTTP register/login/me/key ownership/logout contracts without Mongo', async () => {
    const registered = await json('/keys/user/register', { email: 'http@example.invalid', name: 'HTTP', password: 'test-password-123' });
    assert.equal(registered.response.status, 201);
    assert.equal(registered.body.user.email, 'http@example.invalid');
    assert.ok(registered.body.apiKey);
    assert.ok(registered.body.token);
    assert.equal(JSON.stringify(registered.body).includes('passwordHash'), false);
    const headers = { 'x-api-user-token': registered.body.token };
    const me = await json('/keys/user/me', undefined, headers);
    assert.equal(me.response.status, 200);
    assert.equal(me.body.keys.length, 1);
    assert.equal(me.body.keys[0].limits.dailyQuota, 1000);
    assert.equal((await json('/keys/user/login', { email: 'http@example.invalid', password: 'wrong-password' })).response.status, 401);
    const login = await json('/keys/user/login', { email: 'HTTP@example.invalid', password: 'test-password-123' });
    assert.equal(login.response.status, 200);
    assert.notEqual(login.body.token, registered.body.token);
    assert.equal((await json('/keys/user/create-key', { appName: 'App' }, headers)).response.status, 201);
    assert.equal((await json('/keys/user/revoke-key', { keyId: me.body.keys[0].id }, headers)).response.status, 200);
    assert.equal((await json('/keys/validate', undefined, { 'x-api-key': registered.body.apiKey })).response.status, 403);
    assert.equal((await json('/keys/user/logout', {}, headers)).response.status, 200);
    assert.equal((await json('/keys/user/me', undefined, headers)).response.status, 401);
    assert.equal((await json('/keys/user/me', undefined, { 'x-api-user-token': login.body.token })).response.status, 200);
  });

  it('fails closed for explicit API credentials but does not intercept user/admin Bearer tokens', async () => {
    assert.equal((await json('/public')).response.status, 200);
    assert.equal((await json('/public', undefined, { authorization: 'Bearer user-session-token' })).response.status, 200);
    assert.equal((await json('/public', undefined, { 'x-api-key': 'invalid' })).response.status, 401);
    assert.equal((await json('/public', undefined, { authorization: 'Bearer mr_invalid' })).response.status, 401);
    const issued = await store.pgIssueApiKey({ name: 'HTTP quota', email: 'http-quota@example.invalid' });
    await pool.query('UPDATE api_keys SET daily_quota=1 WHERE id=$1', [issued.key._id]);
    const headers = { authorization: 'Bearer ' + issued.apiKey };
    const result = await json('/public', undefined, headers);
    assert.equal(result.response.status, 200);
    assert.equal(result.response.headers.get('X-Daily-Remaining'), '0');
    assert.equal((await json('/public', undefined, headers)).response.status, 429);
    await pool.query('ALTER TABLE api_keys RENAME TO fixture_unavailable_keys');
    try {
      const unavailable = await json('/public', undefined, headers);
      assert.equal(unavailable.response.status, 503);
      assert.equal(JSON.stringify(unavailable.body).includes('relation'), false);
    } finally { await pool.query('ALTER TABLE fixture_unavailable_keys RENAME TO api_keys'); }
  });

  it('persists redacted auth events, filters failures and expires old audit/session/demo rows', async () => {
    const auth = await import('../src/auth/auth-event-logger');
    await auth.logAuthEvent(undefined, { method: 'email', event: 'fixture-redacted', ok: false,
      email: 'AUDIT@example.invalid', detail: { password: 'must-never-persist', nested: { accessToken: 'secret', status: 401 } } });
    let rows: any[] = [];
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 10));
      rows = await store.pgListAuthEvents({ event: 'fixture-redacted' });
      if (rows.length) break;
    }
    assert.equal(rows.length, 1);
    assert.equal(rows[0].email, 'audit@example.invalid');
    assert.deepEqual(rows[0].detail, { password: '[redacted]', nested: { accessToken: '[redacted]', status: 401 } });
    assert.equal((await store.pgListAuthEvents({ event: 'fixture-redacted', ok: true })).length, 0);
    await store.pgInsertAuthEvent({ ts: new Date(Date.now() - 31 * 86400000), method: 'email', event: 'expired', ok: true });
    assert.equal((await store.pgListAuthEvents({ event: 'expired' })).length, 0);
    await pool.query("UPDATE api_developer_sessions SET expires_at=now()-interval '1 day'; UPDATE api_demo_usage SET expires_at=now()-interval '1 day'; UPDATE api_keys SET expires_at=now()-interval '1 day' WHERE plan='demo'");
    await store.pgPruneApiAccess();
    assert.equal((await pool.query("SELECT count(*)::int count FROM auth_event_logs WHERE event='expired'")).rows[0].count, 0);
    assert.equal((await pool.query('SELECT count(*)::int count FROM api_developer_sessions')).rows[0].count, 0);
    assert.equal((await pool.query('SELECT count(*)::int count FROM api_demo_usage')).rows[0].count, 0);
    assert.equal((await pool.query("SELECT count(*)::int count FROM api_keys WHERE plan='demo'")).rows[0].count, 0);
  });
});
