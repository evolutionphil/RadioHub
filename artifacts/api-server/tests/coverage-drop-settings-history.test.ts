/**
 * Regression tests for the coverage drop alert audit log + revert flow
 * (Task #243, covered by Task #328).
 *
 * Task #243 introduced an append-only `AdminSettingHistory` collection
 * and a one-click revert flow against the
 * `/api/admin/settings/coverage-drop-alert` route. Without automated
 * tests, a future refactor of the route or the AdminSetting upsert
 * could silently stop writing history rows or break the revert path.
 *
 * The tests boot a real Express app with the production routes
 * registered against an in-memory MongoDB so we exercise the actual
 * Mongoose models + handler logic end-to-end.
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import type { AddressInfo } from 'node:net';
import type { Server as HttpServer } from 'node:http';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

import {
  AdminSetting,
  AdminSettingHistory,
} from '@workspace/db-shared/mongo-schemas';
import { registerAdminCoverageDropSettingsRoutes } from '../src/routes/admin-coverage-drop-settings-routes';
import {
  COVERAGE_DROP_SETTINGS_KEY,
  invalidateCoverageDropSettingsCache,
} from '../src/services/coverage-drop-notifier';

const SETTINGS_URL = '/api/admin/settings/coverage-drop-alert';
const HISTORY_URL = '/api/admin/settings/coverage-drop-alert/history';

let mongod: MongoMemoryServer;
let server: HttpServer;
let baseUrl: string;
let currentAdminUser: string | null = 'tester-admin';

before(async () => {
  process.env.NODE_ENV = 'test';
  // Ensure env vars don't influence the resolved settings shape used in
  // the revert assertions.
  delete process.env.COVERAGE_DROP_ALERT_THRESHOLD_PP;
  delete process.env.COVERAGE_DROP_ALERT_MIN_STATIONS;
  delete process.env.COVERAGE_DROP_ALERT_WEBHOOK_URL;

  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), {
    dbName: 'coverage-drop-history-test',
  });

  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = currentAdminUser
      ? { adminAuth: { username: currentAdminUser } }
      : {};
    next();
  });
  const passthrough = (
    _req: Request,
    _res: Response,
    next: NextFunction,
  ) => next();
  registerAdminCoverageDropSettingsRoutes(app, { requireAdmin: passthrough });

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

beforeEach(async () => {
  currentAdminUser = 'tester-admin';
  invalidateCoverageDropSettingsCache();
  await AdminSetting.deleteMany({});
  await AdminSettingHistory.deleteMany({});
});

async function putSettings(body: unknown) {
  return fetch(`${baseUrl}${SETTINGS_URL}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function deleteSettings() {
  return fetch(`${baseUrl}${SETTINGS_URL}`, { method: 'DELETE' });
}

async function getHistory(query: string = ''): Promise<{
  entries: Array<{
    id: string;
    action: 'update' | 'clear';
    previousValue: any;
    newValue: any;
    changedBy: string | null;
    changedAt: string;
  }>;
}> {
  const res = await fetch(`${baseUrl}${HISTORY_URL}${query}`);
  assert.equal(res.status, 200);
  return (await res.json()) as never;
}

// ---------------------------------------------------------------------------
// PUT writes an `update` history row with previous/new values + changedBy.
// ---------------------------------------------------------------------------

test('PUT writes an AdminSettingHistory update row with previousValue=null on first save', async () => {
  currentAdminUser = 'alice';

  const res = await putSettings({
    thresholdPp: 7.5,
    minStations: 25,
    webhookUrl: 'https://hooks.example.com/abc',
  });
  assert.equal(res.status, 200);

  const rows = await AdminSettingHistory.find({
    key: COVERAGE_DROP_SETTINGS_KEY,
  })
    .sort({ changedAt: -1 })
    .lean();
  assert.equal(rows.length, 1, 'exactly one history row must be written');
  const row = rows[0]!;
  assert.equal(row.action, 'update');
  assert.equal(row.previousValue, null, 'first save has no prior value');
  assert.deepEqual(row.newValue, {
    thresholdPp: 7.5,
    minStations: 25,
    webhookUrl: 'https://hooks.example.com/abc',
  });
  assert.equal(row.changedBy, 'alice');
  assert.ok(row.changedAt instanceof Date);
});

test('PUT writes an AdminSettingHistory update row capturing the previousValue when overwriting', async () => {
  currentAdminUser = 'alice';
  assert.equal(
    (await putSettings({ thresholdPp: 5, minStations: 10, webhookUrl: null }))
      .status,
    200,
  );

  currentAdminUser = 'bob';
  assert.equal(
    (
      await putSettings({
        thresholdPp: 12,
        minStations: 50,
        webhookUrl: 'https://hooks.example.com/new',
      })
    ).status,
    200,
  );

  const rows = await AdminSettingHistory.find({
    key: COVERAGE_DROP_SETTINGS_KEY,
  })
    .sort({ changedAt: 1 })
    .lean();
  assert.equal(rows.length, 2);

  // Second row's previousValue must reflect what the first PUT wrote.
  const second = rows[1]!;
  assert.equal(second.action, 'update');
  assert.equal(second.changedBy, 'bob');
  assert.deepEqual(second.previousValue, {
    thresholdPp: 5,
    minStations: 10,
    webhookUrl: null,
  });
  assert.deepEqual(second.newValue, {
    thresholdPp: 12,
    minStations: 50,
    webhookUrl: 'https://hooks.example.com/new',
  });
});

test('DELETE writes an AdminSettingHistory clear row with the prior value preserved', async () => {
  currentAdminUser = 'alice';
  assert.equal(
    (
      await putSettings({
        thresholdPp: 8,
        minStations: 15,
        webhookUrl: 'https://hooks.example.com/x',
      })
    ).status,
    200,
  );

  currentAdminUser = 'carol';
  const res = await deleteSettings();
  assert.equal(res.status, 200);

  // The AdminSetting row was actually removed.
  const remaining = await AdminSetting.findOne({
    key: COVERAGE_DROP_SETTINGS_KEY,
  }).lean();
  assert.equal(remaining, null);

  const rows = await AdminSettingHistory.find({
    key: COVERAGE_DROP_SETTINGS_KEY,
  })
    .sort({ changedAt: 1 })
    .lean();
  assert.equal(rows.length, 2);
  const clearRow = rows[1]!;
  assert.equal(clearRow.action, 'clear');
  assert.equal(clearRow.changedBy, 'carol');
  assert.equal(clearRow.newValue, null);
  assert.deepEqual(clearRow.previousValue, {
    thresholdPp: 8,
    minStations: 15,
    webhookUrl: 'https://hooks.example.com/x',
  });
});

// ---------------------------------------------------------------------------
// GET /history — ordering + limit param bounds.
// ---------------------------------------------------------------------------

test('GET /history returns rows newest-first', async () => {
  currentAdminUser = 'alice';
  await putSettings({ thresholdPp: 1, minStations: 1, webhookUrl: null });
  await putSettings({ thresholdPp: 2, minStations: 2, webhookUrl: null });
  await putSettings({ thresholdPp: 3, minStations: 3, webhookUrl: null });

  const body = await getHistory();
  assert.equal(body.entries.length, 3);
  // Most recent (thresholdPp: 3) first.
  assert.equal(body.entries[0]!.newValue.thresholdPp, 3);
  assert.equal(body.entries[1]!.newValue.thresholdPp, 2);
  assert.equal(body.entries[2]!.newValue.thresholdPp, 1);

  // Confirm changedAt is monotonically non-increasing.
  const times = body.entries.map((e) => Date.parse(e.changedAt));
  for (let i = 1; i < times.length; i++) {
    assert.ok(
      times[i - 1]! >= times[i]!,
      `entries must be sorted newest-first (got ${times.join(',')})`,
    );
  }
});

test('GET /history defaults to a 20 row cap when no limit is supplied', async () => {
  currentAdminUser = 'alice';
  // Insert 25 rows directly so the test is fast.
  const now = Date.now();
  await AdminSettingHistory.insertMany(
    Array.from({ length: 25 }, (_, i) => ({
      key: COVERAGE_DROP_SETTINGS_KEY,
      action: 'update' as const,
      previousValue: null,
      newValue: { thresholdPp: i, minStations: 10, webhookUrl: null },
      changedBy: 'alice',
      changedAt: new Date(now + i * 1000),
    })),
  );

  const body = await getHistory();
  assert.equal(body.entries.length, 20, 'default limit must cap at 20');
  // Newest is i=24.
  assert.equal(body.entries[0]!.newValue.thresholdPp, 24);
});

test('GET /history honours an in-range explicit limit', async () => {
  currentAdminUser = 'alice';
  const now = Date.now();
  await AdminSettingHistory.insertMany(
    Array.from({ length: 10 }, (_, i) => ({
      key: COVERAGE_DROP_SETTINGS_KEY,
      action: 'update' as const,
      previousValue: null,
      newValue: { thresholdPp: i, minStations: 10, webhookUrl: null },
      changedBy: 'alice',
      changedAt: new Date(now + i * 1000),
    })),
  );

  const body = await getHistory('?limit=5');
  assert.equal(body.entries.length, 5);
  assert.equal(body.entries[0]!.newValue.thresholdPp, 9);
});

test('GET /history clamps invalid / out-of-range limit values back to the 20 default', async () => {
  currentAdminUser = 'alice';
  const now = Date.now();
  await AdminSettingHistory.insertMany(
    Array.from({ length: 25 }, (_, i) => ({
      key: COVERAGE_DROP_SETTINGS_KEY,
      action: 'update' as const,
      previousValue: null,
      newValue: { thresholdPp: i, minStations: 10, webhookUrl: null },
      changedBy: 'alice',
      changedAt: new Date(now + i * 1000),
    })),
  );

  // limit > 100 → fall back to default (20).
  let body = await getHistory('?limit=500');
  assert.equal(body.entries.length, 20);

  // Non-numeric → fall back to default (20).
  body = await getHistory('?limit=banana');
  assert.equal(body.entries.length, 20);

  // Zero / negative → fall back to default (20).
  body = await getHistory('?limit=0');
  assert.equal(body.entries.length, 20);
  body = await getHistory('?limit=-3');
  assert.equal(body.entries.length, 20);

  // Upper bound 100 is allowed (we only have 25 rows so we get 25).
  body = await getHistory('?limit=100');
  assert.equal(body.entries.length, 25);
});

// ---------------------------------------------------------------------------
// Revert flow — PUT-ing the previousValue from a history row restores the
// prior settings; reverting an entry whose previousValue is null clears
// the override (i.e. removes the AdminSetting row).
// ---------------------------------------------------------------------------

test('Reverting an entry restores the previousValue from that history row', async () => {
  // Save v1 -> v2 -> v3, then revert v3 by re-PUTing v3.previousValue (=v2).
  currentAdminUser = 'alice';
  await putSettings({ thresholdPp: 5, minStations: 10, webhookUrl: null });
  await putSettings({
    thresholdPp: 8,
    minStations: 20,
    webhookUrl: 'https://hooks.example.com/a',
  });
  await putSettings({
    thresholdPp: 12,
    minStations: 50,
    webhookUrl: 'https://hooks.example.com/b',
  });

  const history = await getHistory();
  // Newest first, so [0] is v3, whose previousValue is v2.
  const v3 = history.entries[0]!;
  assert.equal(v3.newValue.thresholdPp, 12);
  assert.equal(v3.previousValue.thresholdPp, 8);

  currentAdminUser = 'bob';
  const revert = await putSettings(v3.previousValue);
  assert.equal(revert.status, 200);
  const revertBody = (await revert.json()) as {
    stored: { thresholdPp: number | null; minStations: number | null; webhookUrl: string | null };
    effective: { thresholdPp: number; minStations: number; webhookUrl: string | null };
  };

  // The active AdminSetting now mirrors v2.
  assert.deepEqual(revertBody.stored, {
    thresholdPp: 8,
    minStations: 20,
    webhookUrl: 'https://hooks.example.com/a',
  });
  assert.equal(revertBody.effective.thresholdPp, 8);
  assert.equal(revertBody.effective.minStations, 20);
  assert.equal(revertBody.effective.webhookUrl, 'https://hooks.example.com/a');

  // And the revert itself is appended to the audit log as a regular
  // update, with `bob` as the actor and the now-stale v3 captured as
  // its previousValue.
  const after = await getHistory();
  assert.equal(after.entries.length, 4);
  const revertRow = after.entries[0]!;
  assert.equal(revertRow.action, 'update');
  assert.equal(revertRow.changedBy, 'bob');
  assert.deepEqual(revertRow.newValue, {
    thresholdPp: 8,
    minStations: 20,
    webhookUrl: 'https://hooks.example.com/a',
  });
  assert.deepEqual(revertRow.previousValue, {
    thresholdPp: 12,
    minStations: 50,
    webhookUrl: 'https://hooks.example.com/b',
  });
});

test('Reverting an entry whose previousValue is null clears the override', async () => {
  // First-ever save → previousValue=null in the resulting history row.
  // Reverting it should leave us with no AdminSetting row at all (i.e.
  // the env/defaults take over again).
  currentAdminUser = 'alice';
  await putSettings({
    thresholdPp: 9,
    minStations: 30,
    webhookUrl: 'https://hooks.example.com/initial',
  });

  const history = await getHistory();
  assert.equal(history.entries.length, 1);
  const v1 = history.entries[0]!;
  assert.equal(v1.previousValue, null);

  // Client-side revert: when previousValue is null, fall back to a
  // DELETE so the override is fully cleared (matching the
  // "no override" state the row encodes).
  currentAdminUser = 'bob';
  const res = await deleteSettings();
  assert.equal(res.status, 200);

  const stored = await AdminSetting.findOne({
    key: COVERAGE_DROP_SETTINGS_KEY,
  }).lean();
  assert.equal(stored, null, 'AdminSetting row must be removed');

  const body = (await (await fetch(`${baseUrl}${SETTINGS_URL}`)).json()) as {
    stored: { thresholdPp: number | null; minStations: number | null; webhookUrl: string | null };
    effective: { source: { thresholdPp: string; minStations: string; webhookUrl: string } };
  };
  assert.deepEqual(body.stored, {
    thresholdPp: null,
    minStations: null,
    webhookUrl: null,
  });
  // No env vars set (cleared in `before`), so we resolve to defaults.
  assert.equal(body.effective.source.thresholdPp, 'default');
  assert.equal(body.effective.source.minStations, 'default');
  assert.equal(body.effective.source.webhookUrl, 'none');

  // Audit log captured the revert as a `clear` action.
  const after = await getHistory();
  assert.equal(after.entries.length, 2);
  assert.equal(after.entries[0]!.action, 'clear');
  assert.equal(after.entries[0]!.changedBy, 'bob');
  assert.deepEqual(after.entries[0]!.previousValue, {
    thresholdPp: 9,
    minStations: 30,
    webhookUrl: 'https://hooks.example.com/initial',
  });
  assert.equal(after.entries[0]!.newValue, null);
});
