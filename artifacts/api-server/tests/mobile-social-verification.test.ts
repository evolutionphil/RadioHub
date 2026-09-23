import { before, after, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { OAuth2Client } from 'google-auth-library';
import { generateKeyPair, exportJWK, exportSPKI, SignJWT } from 'jose';
import { verifyMobileGoogleToken, verifyMobileAppleToken } from '../src/auth/mobile-social-verification';

let key: Awaited<ReturnType<typeof generateKeyPair>>;
let otherKey: Awaited<ReturnType<typeof generateKeyPair>>;
const previous = { google: process.env.GOOGLE_CLIENT_ID, apple: process.env.APPLE_CLIENT_ID, service: process.env.APPLE_SERVICE_ID };
before(async () => {
  key = await generateKeyPair('RS256', { extractable: true });
  otherKey = await generateKeyPair('RS256');
  const pem = await exportSPKI(key.publicKey);
  // Replace only provider key retrieval. Production signature, audience,
  // issuer and expiry validation all run through the real libraries.
  mock.method(OAuth2Client.prototype, 'getFederatedSignonCertsAsync', async () => ({ certs: { fixture: pem }, format: 'PEM' }));
  const jwk = { ...await exportJWK(key.publicKey), kid: 'fixture', alg: 'RS256', use: 'sig' };
  mock.method(globalThis, 'fetch', async (url: unknown) => {
    assert.equal(String(url), 'https://appleid.apple.com/auth/keys');
    return new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  process.env.GOOGLE_CLIENT_ID = '957628580421-1gj9mmbq20o9jva6olb28t2un6vb6jqh.apps.googleusercontent.com';
  process.env.APPLE_CLIENT_ID = 'com.visiongo.megaradio.web';
  process.env.APPLE_SERVICE_ID = 'com.visiongo.megaradio.service';
});
after(() => {
  mock.restoreAll();
  for (const [name, value] of Object.entries({ GOOGLE_CLIENT_ID: previous.google, APPLE_CLIENT_ID: previous.apple, APPLE_SERVICE_ID: previous.service })) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});

async function token(audience: string, issuer: string, options: { expired?: boolean; wrongKey?: boolean } = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ email: 'fixture@example.invalid', email_verified: true })
    .setProtectedHeader({ alg: 'RS256', kid: 'fixture' }).setSubject('fixture-user')
    .setAudience(audience).setIssuer(issuer)
    .setIssuedAt(now - (options.expired ? 7200 : 60))
    .setExpirationTime(now + (options.expired ? -3600 : 3600))
    .sign(options.wrongKey ? otherKey.privateKey : key.privateKey);
}

test('shipped iOS/Firebase and existing web Google tokens are accepted', async () => {
  for (const audience of [
    '957628580421-ob14qeft7j83apkdjqfn48o3961qk7ti.apps.googleusercontent.com',
    '957628580421-664s6dft9n8kp91futrnpsugd4fcsonn.apps.googleusercontent.com',
    process.env.GOOGLE_CLIENT_ID!,
  ]) {
    assert.equal((await verifyMobileGoogleToken(await token(audience, 'https://accounts.google.com')))?.sub, 'fixture-user');
  }
});

test('Google rejects another app, wrong issuer, expired token and forged signature', async () => {
  const aud = '957628580421-ob14qeft7j83apkdjqfn48o3961qk7ti.apps.googleusercontent.com';
  for (const jwt of [
    await token('unrelated-app.apps.googleusercontent.com', 'https://accounts.google.com'),
    await token(aud, 'https://untrusted.example.invalid'),
    await token(aud, 'https://accounts.google.com', { expired: true }),
    await token(aud, 'https://accounts.google.com', { wrongKey: true }),
  ]) await assert.rejects(verifyMobileGoogleToken(jwt));
});

test('native Apple bundle remains valid when web Services IDs are configured', async () => {
  for (const aud of ['com.visiongo.megaradio', process.env.APPLE_CLIENT_ID!, process.env.APPLE_SERVICE_ID!]) {
    assert.equal((await verifyMobileAppleToken(await token(aud, 'https://appleid.apple.com'))).sub, 'fixture-user');
  }
});

test('Apple rejects another app, wrong issuer, expired token and forged signature', async () => {
  for (const jwt of [
    await token('com.unrelated.app', 'https://appleid.apple.com'),
    await token('com.visiongo.megaradio', 'https://untrusted.example.invalid'),
    await token('com.visiongo.megaradio', 'https://appleid.apple.com', { expired: true }),
    await token('com.visiongo.megaradio', 'https://appleid.apple.com', { wrongKey: true }),
  ]) await assert.rejects(verifyMobileAppleToken(jwt));
});
