import assert from 'node:assert/strict';
import { after, before, beforeEach, mock, test } from 'node:test';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import pg from 'pg';

const connectionString = process.env.PG_TEST_DATABASE_URL;
const schema = `profile_privacy_${randomBytes(8).toString('hex')}`;
let admin: pg.Pool; let pool: pg.Pool; let server: Server; let base: string;
let users: typeof import('../src/data/postgres-user-store');
let engagement: typeof import('../src/data/postgres-engagement-store');
const cache = new Map<string, unknown>();
let profileReads = 0;
before(async () => {
  if (!connectionString) return;
  const url = new URL(connectionString);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
  assert.equal(url.pathname, '/radiohub_test');
  admin = new pg.Pool({ connectionString, ssl: false, max: 1 });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  pool = new pg.Pool({ connectionString, ssl: false, max: 3, options: `-c search_path=${schema}` });
  await pool.query(`CREATE TABLE users (
    id text PRIMARY KEY,username text,email text,password_hash text,full_name text,slug text,bio text,
    avatar text,role text,status text,email_verified boolean,is_public_profile boolean,
    google_id text,facebook_id text,apple_id text,preferences jsonb DEFAULT '{}',permissions jsonb DEFAULT '{}',
    stats jsonb DEFAULT '{}',last_login_at timestamptz,source jsonb DEFAULT '{}',
    created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
    CREATE TABLE subscriptions(user_id text PRIMARY KEY);
    CREATE TABLE auth_tokens(id text PRIMARY KEY,user_id text,is_revoked boolean DEFAULT false);
    CREATE TABLE user_sessions(sid text PRIMARY KEY,sess jsonb);
    CREATE TABLE stations(id text PRIMARY KEY,last_check_ok boolean NOT NULL,is_list_visible boolean NOT NULL DEFAULT true,visibility_expires_at timestamptz);
    INSERT INTO stations(id,last_check_ok) VALUES('private-history',true);`);
  mock.module('../src/postgres-runtime', { namedExports: { getPostgresPool: () => pool } });
  users = await import('../src/data/postgres-user-store');
  engagement = await import('../src/data/postgres-engagement-store');
  mock.module('../src/cache', { defaultExport: { get: async (key: string) => cache.get(key), set: async (key: string, value: unknown) => cache.set(key, value) } });
  mock.module('../src/services/user-engagement-service', { namedExports: { engagementStore: 'postgres', UserEngagementService: class {
    async getUserProfileBySlug() { profileReads++; return { _id: 'owner', displayName: `Revision ${profileReads}`, isPublic: true }; }
    async getUserFavoritesBySlug() { return { favorites: [{ _id: 'favorite' }] }; }
    async getRecentlyPlayed(value: string, limit: number) { return engagement.pgRecentlyPlayed(value, limit); }
  } } });
  mock.module('../src/data/auth-token-store', { namedExports: { findActiveAuthToken: async () => null } });
  mock.module('../src/services/pushNotificationService', { namedExports: { PushNotificationService: {} } });
  mock.module('../src/utils/quota-guard', { namedExports: { isQuotaExceeded: () => false, handleQuotaError() {}, isQuotaError: () => false, safeWrite() {} } });
  mock.module('../src/data/postgres-notification-store', { namedExports: { notificationStore: 'postgres', pgCreateNotification: async () => {} } });
  const { userEngagementRouter } = await import('../src/routes/user-engagement');
  const app = express(); app.use('/engagement', userEngagementRouter);
  server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/engagement`;
});
beforeEach(async () => {
  if (!pool) return;
  cache.clear(); profileReads = 0;
  await pool.query('TRUNCATE users,auth_tokens,user_sessions');
  await pool.query("UPDATE stations SET last_check_ok=true WHERE id='private-history'");
  const source = { resetPasswordToken: 'fixture-token-hash', resetPasswordExpires: new Date(Date.now() + 60000).toISOString(),
    recentlyPlayedStations: [{ stationId: 'private-history' }], notificationSettings: { favorites: true, nowPlaying: true, newStations: false, recommendations: false } };
  await pool.query(`INSERT INTO users(id,username,email,slug,password_hash,is_public_profile,source)
    VALUES ('owner','listener','owner@example.test','listener-slug','old-hash',true,$1),
    ('other','other','other@example.test','other-slug','unrelated',false,'{}')`, [JSON.stringify(source)]);
  await pool.query(`INSERT INTO auth_tokens VALUES('owner-token','owner',false),('other-token','other',false);
    INSERT INTO user_sessions VALUES ('direct','{"userId":"owner"}'),('nested','{"user":{"userId":"owner"}}'),
    ('passport','{"passport":{"user":"owner"}}'),('other','{"userId":"other"}')`);
});
after(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await pool?.end();
  if (admin) { assert.match(schema, /^profile_privacy_[a-f0-9]{16}$/); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end(); }
  mock.restoreAll();
});

test('concurrent password resets consume the native token exactly once and revoke only the owner sessions', { skip: !connectionString }, async () => {
  const results = await Promise.all([users.pgResetUserPassword('fixture-token-hash', 'new-one'), users.pgResetUserPassword('fixture-token-hash', 'new-two')]);
  assert.equal(results.filter(Boolean).length, 1);
  const row = (await pool.query("SELECT password_hash,source FROM users WHERE id='owner'")).rows[0];
  assert.equal(row.password_hash, results[0] ? 'new-one' : 'new-two');
  assert.equal(row.source.passwordHash, row.password_hash);
  assert.equal('resetPasswordToken' in row.source, false); assert.equal('resetPasswordExpires' in row.source, false);
  assert.ok(row.source.recentlyPlayedStations);
  assert.equal(await users.pgResetUserPassword('fixture-token-hash', 'replay'), false);
  assert.deepEqual((await pool.query('SELECT id,is_revoked FROM auth_tokens ORDER BY id')).rows,
    [{ id: 'other-token', is_revoked: false }, { id: 'owner-token', is_revoked: true }]);
  assert.deepEqual((await pool.query('SELECT sid FROM user_sessions')).rows, [{ sid: 'other' }]);
});
test('expired tokens cannot update a password or revoke existing sessions', { skip: !connectionString }, async () => {
  await pool.query(`UPDATE users SET source=jsonb_set(source,'{resetPasswordExpires}',to_jsonb('2000-01-01T00:00:00Z'::text)) WHERE id='owner'`);
  assert.equal(await users.pgResetUserPassword('fixture-token-hash', 'new'), false);
  assert.equal((await pool.query("SELECT password_hash FROM users WHERE id='owner'")).rows[0].password_hash, 'old-hash');
  assert.equal((await pool.query('SELECT count(*)::int n FROM user_sessions')).rows[0].n, 4);
});
test('session revocation failure rolls back password and reset-token consumption', { skip: !connectionString }, async () => {
  await pool.query('ALTER TABLE auth_tokens RENAME TO unavailable_tokens');
  try { await assert.rejects(users.pgResetUserPassword('fixture-token-hash', 'new'), /auth_tokens/); }
  finally { await pool.query('ALTER TABLE unavailable_tokens RENAME TO auth_tokens'); }
  const row = (await pool.query("SELECT password_hash,source FROM users WHERE id='owner'")).rows[0];
  assert.equal(row.password_hash, 'old-hash'); assert.equal(row.source.resetPasswordToken, 'fixture-token-hash');
});
test('concurrent partial notification changes preserve other preferences and source fields', { skip: !connectionString }, async () => {
  await Promise.all([users.pgUpdateUser('owner', { notificationSettings: { favorites: false } }), users.pgUpdateUser('owner', { notificationSettings: { recommendations: true } })]);
  const user = await users.pgFindUserById('owner');
  assert.deepEqual(user.notificationSettings, { favorites: false, nowPlaying: true, newStations: false, recommendations: true });
  assert.equal(user.resetPasswordToken, 'fixture-token-hash');
});
test('native public history and cache identity reject private profiles by ID, slug and username', { skip: !connectionString }, async () => {
  for (const value of ['owner', 'listener-slug', 'listener']) {
    assert.ok(await engagement.pgPublicProfileCacheIdentity(value));
    assert.equal((await engagement.pgRecentlyPlayed(value, 20)).length, 1);
  }
  await pool.query("UPDATE users SET is_public_profile=false WHERE id='owner'");
  for (const value of ['owner', 'listener-slug', 'listener']) {
    assert.equal(await engagement.pgPublicProfileCacheIdentity(value), null);
    assert.deepEqual(await engagement.pgRecentlyPlayed(value, 20), []);
  }
});
test('all four public HTTP routes recheck privacy before serving warm caches', { skip: !connectionString }, async () => {
  const paths = ['', '/favorites', '/full', '/recently-played'];
  for (const path of paths) assert.equal((await fetch(`${base}/profile/listener-slug${path}`)).status, 200);
  assert.equal(cache.size, 4);
  await users.pgUpdateUser('owner', { isPublicProfile: false });
  for (const path of paths) assert.equal((await fetch(`${base}/profile/listener-slug${path}`)).status, 404);
});
test('profile revisions bypass obsolete cached public content without evicting unrelated entries', { skip: !connectionString }, async () => {
  const first = await (await fetch(`${base}/profile/listener-slug`)).json();
  const warm = await (await fetch(`${base}/profile/listener-slug`)).json(); assert.deepEqual(warm, first);
  await users.pgUpdateUser('owner', { fullName: 'Updated' });
  const updated = await (await fetch(`${base}/profile/listener-slug`)).json();
  assert.notEqual(updated.displayName, first.displayName); assert.equal(profileReads, 2);
});
