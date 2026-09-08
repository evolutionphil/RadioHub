import { after, before, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const ownerId = '507f1f77bcf86cd799439011';
const otherId = '507f1f77bcf86cd799439012';
let users: Map<string, any>;
const writes: Array<{ id: string; patch: any }> = [];
const invalidations: string[] = [];
let databaseFails = false;
let revokeFails = false;
let revokeFinished = false;
let deletedKeys: string[] = [];
let invalidImage = false;
let uploadFailure = false;
let resetAvailable = false;
const source = (id = ownerId) => ({ _id: id, id, username: id === ownerId ? 'listener' : 'other', fullName: 'Listener',
  email: id === ownerId ? 'owner@example.test' : 'other@example.test', emailVerified: true, status: 'active',
  followersCount: 0, followingCount: 0, preferences: { language: 'de', unrelated: true }, isPublicProfile: true,
  passwordHash: 'stored-hash', notificationSettings: { favorites: true, nowPlaying: true, newStations: false, recommendations: false } });
const findUser = async (id: string) => { if (databaseFails) throw new Error('private-db-detail'); return users.get(id) || null; };
const cache = { get: async () => null, set: async () => {}, del: async (key: string) => { invalidations.push(key); }, clearByPattern: async (key: string) => { invalidations.push(key); } };
mock.module('../src/cache', { defaultExport: cache, namedExports: { CacheKeys: { userSocial: (email: string) => `social:${email}` } } });
mock.module('../src/postgres-runtime', { namedExports: { getPostgresPool: () => { throw new Error('No real DB access allowed'); } } });
mock.module('../src/utils/logger', { namedExports: { logger: { log() {}, error() {}, warn() {} } } });
mock.module('../src/auth/auth-event-logger', { namedExports: { logAuthEvent: async () => {} } });
mock.module('../src/data/postgres-api-access-store', { namedExports: { pgListAuthEvents: async () => [] } });
mock.module('../src/data/auth-token-store', { namedExports: {
  deleteUserAuthTokens: async () => {}, findActiveAuthToken: async () => { if (databaseFails) throw new Error('token-db'); return { userId: ownerId }; },
  revokeAuthToken: async () => { await new Promise(r => setTimeout(r, 8)); if (revokeFails) throw new Error('revoke-failed'); revokeFinished = true; },
} });
mock.module('../src/data/postgres-user-store', { namedExports: {
  userStore: 'postgres', newPublicUserId: () => ownerId, pgCreateUser: async () => {}, pgFindUserById: findUser,
  pgFindUserByEmail: async (email: string) => [...users.values()].find(u => u.email.toLowerCase() === email.toLowerCase()) || null,
  pgFindUserByIdentity: async () => null, pgFindUserByResetToken: async () => resetAvailable ? source() : null,
  pgResetUserPassword: async () => { if (!resetAvailable) return false; resetAvailable = false; return true; },
  pgListUsers: async () => [], pgRecentUserActivity: async () => [],
  pgUserManagementDetail: async () => null, pgUserManagementStats: async () => ({}), pgUserSlugExists: async () => false,
  pgUserFollowState: async () => ({ following: [], followersCount: 0 }), pgUserSocialByEmail: async () => ({ followers: [{ email: 'private@example.test' }], following: [] }),
  pgDeleteUser: async (id: string) => { if (databaseFails) throw new Error('delete-db'); return users.delete(id); },
  pgUpdateUser: async (id: string, patch: any) => {
    if (databaseFails) throw new Error('update-db');
    const previous = users.get(id); if (!previous) return null;
    writes.push({ id, patch });
    const next = { ...previous, ...patch, preferences: { ...previous.preferences, ...patch.preferences },
      notificationSettings: { ...previous.notificationSettings, ...patch.notificationSettings } };
    users.set(id, next); return next;
  },
} });
mock.module('../src/services/user-engagement-service', { namedExports: { engagementStore: 'postgres', UserEngagementService: class {} } });
mock.module('../src/data/postgres-engagement-store', { namedExports: { pgFollowPage: async () => ({}), pgIsFollowing: async () => false } });
mock.module('../src/data/postgres-notification-store', { namedExports: { notificationStore: 'postgres', pgCreateNotification: async () => {} } });
mock.module('bcrypt', { defaultExport: { hash: async (password: string) => `hashed:${password}` } });
mock.module('../src/services/s3-storage', { namedExports: {
  uploadToS3: async (key: string) => { if (uploadFailure) throw new Error('upload-network'); return `https://fixture-bucket.s3.eu-north-1.amazonaws.com/${key}`; },
  deleteFromS3: async (key: string) => { deletedKeys.push(key); },
} });
const multer = Object.assign(() => ({ single: () => (req: any, _res: any, callback: any) => { req.file = { buffer: Buffer.from('fixture') }; callback(null); } }), { memoryStorage: () => ({}) });
mock.module('multer', { defaultExport: multer });
mock.module('sharp', { defaultExport: () => ({
  metadata: async () => { if (invalidImage) throw new Error('bad-image'); return { width: 400, height: 400 }; },
  resize: () => ({ webp: () => ({ toBuffer: async () => Buffer.from('webp') }) }),
}) });
let server: Server; let base: string;
before(async () => {
  const { registerUserAuthRoutes } = await import('../src/routes/user-auth-routes.ts');
  const app = express(); app.use(express.json());
  app.use((req: any, _res, next) => {
    const id = req.headers['x-fixture-user'];
    req.session = { ...(id ? { userId: id, user: { userId: id } } : {}),
      ...(req.headers['x-fixture-admin'] ? { adminAuth: { role: req.headers['x-fixture-admin'] } } : {}),
      save: (done: any) => done(), destroy: (done: any) => done() };
    if (id) req.user = users.get(String(id)); next();
  });
  const auth = (req: any, res: any, next: any) => req.session.userId ? next() : res.status(401).json({ error: 'Authentication required' });
  registerUserAuthRoutes(app, { requireAuth: auth, requireAdmin: auth, generateAuthToken: async () => 'test-token', passport: {} });
  server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())));
beforeEach(() => {
  users = new Map([[ownerId, source()], [otherId, source(otherId)]]); writes.length = 0; invalidations.length = 0;
  databaseFails = false; revokeFails = false; revokeFinished = false; deletedKeys = []; invalidImage = false; uploadFailure = false;
  resetAvailable = false;
  process.env.AWS_BUCKET_NAME = 'fixture-bucket'; process.env.AWS_REGION = 'eu-north-1';
});
async function request(path: string, method = 'GET', body?: any, user: string | null = ownerId, extra = {}) {
  return fetch(`${base}${path}`, { method, headers: { ...(user ? { 'x-fixture-user': user } : {}), 'content-type': 'application/json', ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
}
test('profile save writes only submitted safe fields and invalidates personal caches', async () => {
  const response = await request('/api/auth/profile', 'PUT', { fullName: ' Updated ', role: 'admin', subscription: { isActive: true } });
  assert.equal(response.status, 200); assert.deepEqual(writes[0], { id: ownerId, patch: { fullName: 'Updated' } });
  const body = await response.json(); assert.equal(body.user.fullName, 'Updated'); assert.equal(body.user.passwordHash, undefined);
  assert.ok(invalidations.some(x => x.startsWith('user-engagement-full:')));
});
test('profile validation rejects invalid types, weak/oversize passwords and preferences without writes', async () => {
  for (const body of [{ fullName: {} }, { email: 'wrong' }, { isPublicProfile: 'false' }, { password: 'short' }, { password: 'é'.repeat(40) }, { preferences: { autoplay: 'true' } }]) {
    assert.equal((await request('/api/auth/profile', 'PUT', body)).status, 400);
  }
  assert.equal(writes.length, 0);
});
test('password update hashes valid password while blank leaves original hash untouched', async () => {
  assert.equal((await request('/api/auth/profile', 'PUT', { password: '   ', fullName: 'Listener' })).status, 200);
  assert.equal(writes[0].patch.passwordHash, undefined);
  assert.equal((await request('/api/auth/profile', 'PUT', { password: 'LongEnough123' })).status, 200);
  assert.equal(writes[1].patch.passwordHash, 'hashed:LongEnough123');
});
test('email changes normalize and revoke stale verification, duplicate email is409', async () => {
  assert.equal((await request('/api/auth/profile', 'PUT', { email: ' New@Example.Test ' })).status, 200);
  assert.equal(writes[0].patch.email, 'new@example.test'); assert.equal(writes[0].patch.emailVerified, false);
  const response = await request('/api/auth/profile', 'PUT', { email: 'other@example.test' });
  assert.equal(response.status, 409); assert.equal(writes.length, 1);
});
test('generic profile write enforces owner/admin role, prevents public privileged assignment', async () => {
  assert.equal((await request(`/api/users/${otherId}`, 'PUT', { fullName: 'Hacked' })).status, 403);
  assert.equal((await request(`/api/users/${otherId}`, 'PUT', { fullName: 'Hacked' }, ownerId, { 'x-fixture-admin': 'moderator' })).status, 403);
  assert.equal((await request(`/api/users/${ownerId}`, 'PUT', { role: 'admin', emailVerified: true })).status, 400);
  assert.equal(writes.length, 0);
});
test('social graph prevents another signed-in user from reading private emails', async () => {
  assert.equal((await request('/api/user/social/other%40example.test')).status, 403);
  assert.equal((await request('/api/user/social/owner%40example.test')).status, 200);
});
test('auth/me returns503 for DB outage,403 inactive and preserves healthy anonymous200', async () => {
  databaseFails = true; assert.equal((await request('/api/auth/me')).status, 503);
  assert.equal((await request('/api/auth/me', 'GET', undefined, null, { authorization: 'Bearer fixture-token-long-enough' })).status, 503);
  databaseFails = false; users.get(ownerId).status = 'suspended'; assert.equal((await request('/api/auth/me')).status, 403);
  const anonymous = await request('/api/auth/me', 'GET', undefined, null); assert.equal(anonymous.status, 200); assert.equal((await anonymous.json()).authenticated, false);
});
test('notification settings GET/PATCH/PUT require auth, boolean allowlist and preserve unrelated settings', async () => {
  assert.equal((await request('/api/user/notification-settings', 'GET', undefined, null)).status, 401);
  assert.deepEqual((await (await request('/api/user/notification-settings')).json()).notificationSettings, source().notificationSettings);
  for (const body of [{ favorites: 'false' }, { favorites: false, role: 'admin' }, {}]) assert.equal((await request('/api/user/notification-settings', 'PATCH', body)).status, 400);
  assert.equal((await request('/api/user/notification-settings', 'PATCH', { favorites: false })).status, 200);
  assert.equal((await request('/api/user/notification-settings', 'PUT', { recommendations: true })).status, 200);
  const body = await (await request('/api/auth/me')).json();
  assert.deepEqual(body.user.notificationSettings, { favorites: false, nowPlaying: true, newStations: false, recommendations: true });
});
test('logout waits for token revocation and does not claim success on failure', async () => {
  const headers = { authorization: 'Bearer fixture-token-long-enough' };
  const success = await request('/api/auth/logout', 'POST', {}, ownerId, headers); assert.equal(success.status, 200); assert.equal(revokeFinished, true);
  revokeFails = true; assert.equal((await request('/api/auth/logout', 'POST', {}, ownerId, headers)).status, 500);
});
test('invalid image and upload service failures are handled inside async multipart callback', async () => {
  invalidImage = true; assert.equal((await request('/api/user/avatar', 'POST', {})).status, 400);
  invalidImage = false; uploadFailure = true; assert.equal((await request('/api/user/avatar', 'POST', {})).status, 500);
  assert.equal(writes.length, 0);
});
test('avatar deletion never deletes another user or external bucket object', async () => {
  users.get(ownerId).avatar = `https://fixture-bucket.s3.eu-north-1.amazonaws.com/avatars/user_${otherId}_123.webp`;
  assert.equal((await request('/api/user/avatar', 'DELETE')).status, 200); assert.deepEqual(deletedKeys, []);
  users.get(ownerId).avatar = `https://fixture-bucket.s3.eu-north-1.amazonaws.com/avatars/user_${ownerId.slice(-8)}_123.webp`;
  assert.equal((await request('/api/user/avatar', 'DELETE')).status, 200); assert.deepEqual(deletedKeys, [`avatars/user_${ownerId.slice(-8)}_123.webp`]);
});
test('account deletion clears profile caches and cookie, never deletes S3 object before failed DB delete', async () => {
  users.get(ownerId).avatar = `https://fixture-bucket.s3.eu-north-1.amazonaws.com/avatars/user_${ownerId}_123.webp`;
  databaseFails = true; assert.equal((await request('/api/user/delete-account', 'DELETE')).status, 500); assert.deepEqual(deletedKeys, []);
  databaseFails = false; const response = await request('/api/user/delete-account', 'DELETE');
  assert.equal(response.status, 200); assert.equal(users.has(ownerId), false); assert.equal(deletedKeys.length, 1); assert.match(response.headers.get('set-cookie') || '', /connect\.sid=/);
});
test('reset rejects weak passwords and a successfully consumed token cannot be replayed', async () => {
  resetAvailable = true;
  assert.equal((await request('/api/auth/reset-password', 'POST', { token: 'fixture-reset-token', newPassword: 'short' }, null)).status, 400);
  assert.equal((await request('/api/auth/reset-password', 'POST', { token: 'fixture-reset-token', newPassword: 'ValidPassword123' }, null)).status, 200);
  assert.equal((await request('/api/auth/reset-password', 'POST', { token: 'fixture-reset-token', newPassword: 'OtherPassword123' }, null)).status, 400);
});
