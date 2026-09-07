import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { beforeEach, mock, test } from 'node:test';
import express from 'express';

const saved: Array<{ id: unknown; input: Record<string, any> }> = [];
const logs: unknown[][] = [];
let fail = false;
mock.module('../src/data/postgres-content-store', { namedExports: {
  pgSaveFeedback: async (id: unknown, input: Record<string, any>) => {
    if (fail) throw new Error('private driver details must not escape');
    saved.push({ id, input });
    return { _id: 'private-record-id', ...input };
  },
} });
mock.module('../src/utils/logger', { namedExports: { logger: { error: (...args: unknown[]) => logs.push(args) } } });
const { registerPublicFeedbackRoutes, feedbackRateLimitKey } = await import('../src/routes/public-feedback-routes');
beforeEach(() => { saved.length = 0; logs.length = 0; fail = false; });

async function withServer(run: (url: string) => Promise<void>) {
  const app = express();
  app.use(express.json({ limit: '2mb', verify: (req, _res, bytes) => { (req as any).rawBody = bytes.toString('utf8'); } }));
  app.use(express.urlencoded({ extended: false }));
  registerPublicFeedbackRoutes(app);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try { await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/feedback`); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
const valid = { type: 'CONTACT', email: 'fixture@example.invalid', message: 'A public contact message.' };
const post = (url: string, body: unknown, extra: Record<string, string> = {}) => fetch(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body),
});

for (const type of ['CONTACT', 'FEEDBACK']) {
  test(`${type} matches the existing frontend payload and persists only safe native fields`, async () => {
    await withServer(async url => {
      const response = await post(url, { ...valid, type, email: ` ${valid.email} `, message: '  Çok dilli mesaj: 日本語 & <text>  ' });
      assert.equal(response.status, 201);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await response.json(), { success: true });
      assert.deepEqual(saved, [{ id: null, input: { type: 'general',
        subject: type === 'CONTACT' ? 'Contact request' : 'Website feedback',
        email: valid.email, message: 'Çok dilli mesaj: 日本語 & <text>', status: 'open' } }]);
      assert.equal(logs.length, 0);
    });
  });
}

test('rejects missing, malformed, empty, oversized and control-character fields before persistence', async () => {
  for (const body of [null, [], {}, { ...valid, type: 'admin' }, { ...valid, email: 'invalid' },
    { ...valid, email: 'a'.repeat(255) + '@example.invalid' }, { ...valid, message: '' },
    { ...valid, message: '  \n ' }, { ...valid, message: 'x'.repeat(10001) },
    { ...valid, message: 'invalid\0message' }, { ...valid, message: { text: 'not a string' } }]) {
    await withServer(async url => {
      const response = await post(url, body);
      assert.equal(response.status, 400);
    });
  }
  assert.equal(saved.length, 0);
});

test('public callers cannot assign identity, ownership, status, admin response or subject', async () => {
  for (const extra of [{ _id: 'existing' }, { userId: 'another-user' }, { status: 'resolved' },
    { response: 'fake admin response' }, { subject: 'fake subject' }, { source: {} }]) {
    await withServer(async url => { assert.equal((await post(url, { ...valid, ...extra })).status, 400); });
  }
  assert.equal(saved.length, 0);
});

test('oversized raw body, including harmless JSON whitespace, is rejected', async () => {
  await withServer(async url => {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: ' '.repeat(65 * 1024) + JSON.stringify(valid) });
    assert.equal(response.status, 413);
    assert.equal(saved.length, 0);
  });
});

test('HTML form bodies and public read/write methods cannot expose or change feedback records', async () => {
  await withServer(async url => {
    const form = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(valid).toString() });
    assert.equal(form.status, 415);
    for (const method of ['GET', 'HEAD', 'PATCH', 'DELETE']) {
      const response = await fetch(url, { method });
      assert.equal(response.status, 404);
      assert.ok(!(await response.text()).includes(valid.email));
    }
    assert.equal(saved.length, 0);
  });
});

test('five anonymous submissions are allowed, then rate limited with no bot-UA bypass', async () => {
  await withServer(async url => {
    for (let index = 0; index < 5; index++) assert.equal((await post(url, valid)).status, 201);
    const limited = await post(url, valid, { 'User-Agent': 'Googlebot', 'X-Forwarded-For': '198.51.100.80' });
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
    assert.equal(limited.headers.get('cache-control'), 'no-store');
    assert.ok(limited.headers.has('ratelimit-limit'));
    assert.equal(saved.length, 5);
  });
});

test('normalized IPv4 and IPv6 subnet rate keys cannot be changed by request body or user-agent', () => {
  assert.equal(feedbackRateLimitKey({ ip: '::ffff:192.0.2.5' }), feedbackRateLimitKey({ ip: '192.0.2.5' }));
  assert.equal(feedbackRateLimitKey({ ip: '2001:db8:abcd:1200::1' }), feedbackRateLimitKey({ ip: '2001:db8:abcd:1200::2' }));
});

test('database outage returns retryable503 without claiming success or exposing private errors', async () => {
  fail = true;
  await withServer(async url => {
    const response = await post(url, valid);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('retry-after'), '60');
    const body = await response.json() as any;
    assert.equal(body.success, false);
    assert.ok(!JSON.stringify(body).includes('private driver'));
    assert.ok(!JSON.stringify(logs).includes(valid.email));
    assert.ok(!JSON.stringify(logs).includes(valid.message));
    assert.equal(saved.length, 0);
  });
});

test('production registration is unconditional and native enum/schema remain compatible', async () => {
  const routes = await readFile(new URL('../src/routes.ts', import.meta.url), 'utf8');
  assert.match(routes, /import \{ registerPublicFeedbackRoutes \} from '.\/routes\/public-feedback-routes'/);
  assert.match(routes, /registerPublicFeedbackRoutes\(app\);/);
  const source = await readFile(new URL('../src/routes/public-feedback-routes.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /pgListFeedback|requireAuth|req\.body\.(?:userId|status|_id)/);
  const schema = await readFile(new URL('../../../lib/db/src/schema/application-content.ts', import.meta.url), 'utf8');
  assert.match(schema, /IN \('bug','feature','general'\)/);
  assert.match(schema, /IN \('open','in-progress','resolved','closed'\)/);
});
