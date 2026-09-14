import assert from 'node:assert/strict';
import { after, before, beforeEach, mock, test } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';

let imported: Array<Record<string, unknown>> = [];
let replaceCalls = 0;
mock.module('../src/data/postgres-admin-auxiliary-store', { namedExports: {
  pgAdminAux: () => ({ replaceIssues: async (docs: Array<Record<string, unknown>>) => {
    replaceCalls++;
    imported = docs;
    return docs.length;
  } }),
} });
mock.module('../src/utils/logger', { namedExports: { logger: { log() {}, error() {} } } });
const { registerSemrushAdminRoutes } = await import('../src/routes/semrush-admin-routes');
let server: Server;
let base: string;

before(async () => {
  const app = express();
  app.use(express.text({ type: ['text/csv', 'text/plain'], limit: '20mb' }));
  app.use(express.json());
  registerSemrushAdminRoutes(app, {
    requireAdmin: (req: express.Request, res: express.Response, next: express.NextFunction) => req.get('x-test-admin') === 'yes' ? next() : void res.sendStatus(403),
  });
  server = await new Promise<Server>(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin/semrush/import`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  mock.restoreAll();
});
beforeEach(() => { imported = []; replaceCalls = 0; });

function upload(csv: string, json = false) {
  return fetch(base, { method: 'POST', headers: { 'x-test-admin': 'yes', 'Content-Type': json ? 'application/json' : 'text/csv' }, body: json ? JSON.stringify({ csv }) : csv });
}

test('imports BOM-prefixed CSV with quoted commas, escaped quotes, and multiline descriptions intact', async () => {
  const response = await upload('\uFEFFURL,Status Code,Issue name,Description,Severity\r\nhttps://themegaradio.com/en,404,"Broken, internal link","First line\r\nThe ""station"" is missing",Errors\r\n');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).count, 1);
  assert.equal(replaceCalls, 1);
  assert.equal(imported[0].url, 'https://themegaradio.com/en');
  assert.equal(imported[0].statusCode, 404);
  assert.equal(imported[0].issueType, 'Broken, internal link');
  assert.equal(imported[0].issueDescription, 'First line\nThe "station" is missing');
  assert.equal(imported[0].priority, 'High');
});

test('supports regional delimiters and existing JSON/column aliases', async () => {
  for (const delimiter of [';', '\t']) {
    const csv = '\n' + ['Page', 'Status', 'Check name', 'Details', 'Category'].join(delimiter) + '\n' + ['https://themegaradio.com/tr', '200', 'Missing title', 'Description, with a comma', 'Warnings'].join(delimiter);
    const response = await upload(csv, true);
    assert.equal(response.status, 200);
    assert.equal(imported[0].issueDescription, 'Description, with a comma');
    assert.equal(imported[0].priority, 'Medium');
    assert.equal(imported[0].statusCode, 200);
  }
});

test('rejects malformed CSV without replacing the previous import', async () => {
  for (const csv of [
    'URL,Description\nhttps://themegaradio.com,"Unclosed',
    'URL,Description\nhttps://themegaradio.com,"Closed"junk',
    'URL,Description\nhttps://themegaradio.com,not"quoted',
    'URL,Description\nhttps://themegaradio.com,first,extra',
    'URL,Description\nhttps://themegaradio.com',
    'URL,URL\nhttps://themegaradio.com,duplicate',
  ]) {
    const response = await upload(csv);
    assert.equal(response.status, 400, csv);
    assert.match((await response.json()).error, /CSV/);
  }
  assert.equal(replaceCalls, 0);
});

test('rejects oversized row counts instead of silently replacing issues with a partial import', async () => {
  const response = await upload('URL,Issue\n' + 'https://themegaradio.com/en,Missing title\n'.repeat(50_001));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /50,000-row/);
  assert.equal(replaceCalls, 0);
});

test('requires admin authorization and rejects empty exports without writes', async () => {
  assert.equal((await fetch(base, { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: 'URL,Issue\nhttps://themegaradio.com,Title' })).status, 403);
  assert.equal((await upload('URL,Description\n')).status, 400);
  assert.equal(replaceCalls, 0);
});
