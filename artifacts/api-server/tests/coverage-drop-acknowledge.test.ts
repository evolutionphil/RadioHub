/**
 * Regression tests for the coverage drop acknowledge flow (Task #238,
 * covered by Task #323).
 *
 * The acknowledge state machine has two halves that quietly regress
 * if either side drifts:
 *   - POST /api/admin/coverage/drop-alerts/acknowledge persists the
 *     latest alert's `snapshotDate` into the shared `AdminSetting`
 *     row keyed by `coverage-drop-alert-ack`. It returns 400 without
 *     a snapshotDate, and 409 if a newer alert has shown up since the
 *     client loaded the page (so we don't accidentally silence it).
 *   - GET /api/admin/coverage/drop-alerts annotates the alert whose
 *     `snapshotDate` matches the stored ack with `acknowledged: true`.
 *     A *newer* alert (different snapshotDate) automatically flips
 *     the latest entry back to `acknowledged: false` — that's the
 *     cross-admin "banner re-appears" behaviour we care about.
 *
 * The test boots a real Express app with the production routes
 * registered against an in-memory MongoDB so we exercise the actual
 * Mongoose models + handler logic end-to-end.
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express, {
  type Express,
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
  UserNotification,
} from '@workspace/db-shared/mongo-schemas';
import { registerAdminStationRoutes } from '../src/routes/admin-station-routes';

const ACK_KEY = 'coverage-drop-alert-ack';
const ACK_URL_PATH = '/api/admin/coverage/drop-alerts/acknowledge';
const LIST_URL_PATH = '/api/admin/coverage/drop-alerts';

let mongod: MongoMemoryServer;
let server: HttpServer;
let baseUrl: string;
let currentAdminUser: string | null = 'tester-admin';

before(async () => {
  process.env.NODE_ENV = 'test';

  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'coverage-ack-test' });

  const app = express();
  // Inject a fake session so the handler can record `acknowledgedBy`,
  // and a passthrough requireAdmin so the route is reachable without
  // wiring up real auth.
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
  registerAdminStationRoutes(app, {
    requireAuth: passthrough,
    requireAdmin: passthrough,
  });

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
  await AdminSetting.deleteMany({});
  await UserNotification.deleteMany({});
});

// Helper: insert a coverage_drop alert notification with a given
// snapshotDate. The handler ignores `userId` for the alert lookup
// (filter is just type + data.kind) so any ObjectId works.
async function insertAlert(snapshotDate: string, opts?: { createdAt?: Date }) {
  return UserNotification.create({
    userId: new mongoose.Types.ObjectId(),
    type: 'system',
    title: 'Coverage drop',
    message: `Drop on ${snapshotDate}`,
    data: {
      kind: 'coverage_drop',
      snapshotDate,
      thresholdPp: 5,
      drops: [],
    },
    createdAt: opts?.createdAt ?? new Date(snapshotDate),
  });
}

async function postAck(body: unknown) {
  return fetch(`${baseUrl}${ACK_URL_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function getLatest(): Promise<{
  alert: {
    snapshotDate: string | null;
    acknowledged: boolean;
    acknowledgedAt: string | null;
    acknowledgedBy: string | null;
  } | null;
}> {
  const res = await fetch(`${baseUrl}${LIST_URL_PATH}`);
  assert.equal(res.status, 200);
  return (await res.json()) as never;
}

// ---------------------------------------------------------------------------
// POST /acknowledge
// ---------------------------------------------------------------------------

test('POST /acknowledge returns 400 when snapshotDate is missing', async () => {
  await insertAlert('2026-05-07');

  const res = await postAck({});
  assert.equal(res.status, 400, 'missing snapshotDate must be rejected');
  const body = (await res.json()) as { error?: string };
  assert.match(body.error ?? '', /snapshotDate/i);

  // Nothing was persisted.
  const stored = await AdminSetting.findOne({ key: ACK_KEY }).lean();
  assert.equal(stored, null, 'no AdminSetting row should be created on 400');
});

test('POST /acknowledge returns 400 when snapshotDate is the wrong type', async () => {
  await insertAlert('2026-05-07');

  const res = await postAck({ snapshotDate: 12345 });
  assert.equal(res.status, 400);

  const stored = await AdminSetting.findOne({ key: ACK_KEY }).lean();
  assert.equal(stored, null);
});

test("POST /acknowledge returns 409 when snapshotDate doesn't match the latest alert", async () => {
  // Latest alert is for the 7th; client tries to ack the older 6th.
  await insertAlert('2026-05-06', { createdAt: new Date('2026-05-06T00:00:00Z') });
  await insertAlert('2026-05-07', { createdAt: new Date('2026-05-07T00:00:00Z') });

  const res = await postAck({ snapshotDate: '2026-05-06' });
  assert.equal(
    res.status,
    409,
    'stale snapshotDate must be rejected so a newer alert is not silenced',
  );
  const body = (await res.json()) as { error?: string; latestSnapshotDate?: string };
  assert.match(body.error ?? '', /newer/i);
  assert.equal(
    body.latestSnapshotDate,
    '2026-05-07',
    'response must echo the actual latest snapshotDate so the client can refresh',
  );

  const stored = await AdminSetting.findOne({ key: ACK_KEY }).lean();
  assert.equal(stored, null, 'a 409 must NOT persist the stale ack');
});

test('POST /acknowledge persists the AdminSetting row with snapshotDate, acknowledgedAt, and acknowledgedBy', async () => {
  await insertAlert('2026-05-07');
  currentAdminUser = 'alice';

  const before = Date.now();
  const res = await postAck({ snapshotDate: '2026-05-07' });
  const after = Date.now();

  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    acknowledged?: boolean;
    snapshotDate?: string;
    acknowledgedAt?: string;
    acknowledgedBy?: string;
  };
  assert.equal(body.acknowledged, true);
  assert.equal(body.snapshotDate, '2026-05-07');
  assert.equal(body.acknowledgedBy, 'alice');
  assert.equal(typeof body.acknowledgedAt, 'string');

  const stored = await AdminSetting.findOne({ key: ACK_KEY }).lean<{
    key: string;
    value: {
      snapshotDate?: string;
      acknowledgedAt?: string;
      acknowledgedBy?: string;
    };
    updatedBy?: string | null;
  }>();
  assert.ok(stored, 'AdminSetting row must be upserted on a successful ack');
  assert.equal(stored!.key, ACK_KEY);
  assert.equal(stored!.value?.snapshotDate, '2026-05-07');
  assert.equal(stored!.value?.acknowledgedBy, 'alice');
  assert.equal(stored!.updatedBy, 'alice');
  const ackAtMs = Date.parse(stored!.value?.acknowledgedAt ?? '');
  assert.ok(
    ackAtMs >= before && ackAtMs <= after,
    `acknowledgedAt must be set to the request time (got ${stored!.value?.acknowledgedAt})`,
  );
});

// ---------------------------------------------------------------------------
// GET — acknowledged status reflects shared AdminSetting state and
// flips back when a newer alert arrives.
// ---------------------------------------------------------------------------

test('GET returns acknowledged: true only when the stored snapshotDate matches the latest alert', async () => {
  await insertAlert('2026-05-07');

  // Before any ack: latest alert is unacknowledged.
  let body = await getLatest();
  assert.ok(body.alert, 'latest alert must be present');
  assert.equal(body.alert!.snapshotDate, '2026-05-07');
  assert.equal(body.alert!.acknowledged, false);
  assert.equal(body.alert!.acknowledgedAt, null);
  assert.equal(body.alert!.acknowledgedBy, null);

  // Ack the current alert.
  currentAdminUser = 'alice';
  const ack = await postAck({ snapshotDate: '2026-05-07' });
  assert.equal(ack.status, 200);

  // Now the same alert reads as acknowledged with the persisted
  // metadata (cross-admin shared state, even though the GET request
  // arrives with no user context attached).
  body = await getLatest();
  assert.equal(body.alert!.snapshotDate, '2026-05-07');
  assert.equal(body.alert!.acknowledged, true);
  assert.equal(body.alert!.acknowledgedBy, 'alice');
  assert.equal(typeof body.alert!.acknowledgedAt, 'string');
});

test('GET returns acknowledged: false again once a newer alert (newer snapshotDate) is inserted', async () => {
  // Day 1: an alert lands and Alice acknowledges it.
  await insertAlert('2026-05-07', {
    createdAt: new Date('2026-05-07T00:00:00Z'),
  });
  currentAdminUser = 'alice';
  assert.equal((await postAck({ snapshotDate: '2026-05-07' })).status, 200);

  // Sanity: it currently reads as acknowledged.
  let body = await getLatest();
  assert.equal(body.alert!.acknowledged, true);

  // Day 2: nightly cron writes a newer alert with a different
  // snapshotDate. The ack row from yesterday must NOT silence it —
  // that's the whole "banner re-appears for everyone" guarantee.
  await insertAlert('2026-05-08', {
    createdAt: new Date('2026-05-08T00:00:00Z'),
  });

  body = await getLatest();
  assert.equal(body.alert!.snapshotDate, '2026-05-08');
  assert.equal(
    body.alert!.acknowledged,
    false,
    'a newer alert (different snapshotDate) must auto-flip acknowledged back to false',
  );
  assert.equal(body.alert!.acknowledgedAt, null);
  assert.equal(body.alert!.acknowledgedBy, null);

  // The stale ack row is still on disk (the handler doesn't clean it
  // up) but it must not bleed into the new alert. Confirm the row
  // still references the old snapshotDate so we know the test isn't
  // accidentally passing because the row was deleted.
  const stored = await AdminSetting.findOne({ key: ACK_KEY }).lean<{
    value: { snapshotDate?: string };
  }>();
  assert.ok(stored);
  assert.equal(stored!.value?.snapshotDate, '2026-05-07');
});
