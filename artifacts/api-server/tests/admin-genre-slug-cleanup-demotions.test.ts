/**
 * Regression tests for the GenreSlugCleanupRun demotions drill-down
 * (Task #264, covered by Task #354).
 *
 * `GET /api/admin/maintenance/genre-slug-cleanup/runs/:id/demotions`
 * is the only path admins use to answer "which genres did this run
 * actually demote?" once the cleanup notifier alerts. The handler
 * joins the run's [startedAt, finishedAt] window against
 * `Genre.cleanupDemotion.demotedAt`. If a future change renames the
 * field, drops the index, or breaks the window math, the endpoint
 * would silently return an empty list and the alert would feel like
 * a false positive.
 *
 * These tests boot a real Express app with the production routes
 * registered against an in-memory MongoDB so the actual Mongoose
 * models + handler logic run end-to-end.
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
  Genre,
  GenreSlugCleanupRun,
} from '@workspace/db-shared/mongo-schemas';
import { registerAdminMaintenanceRoutes } from '../src/routes/admin-maintenance-routes';

const BASE_PATH = '/api/admin/maintenance/genre-slug-cleanup/runs';

let mongod: MongoMemoryServer;
let server: HttpServer;
let baseUrl: string;

before(async () => {
  process.env.NODE_ENV = 'test';

  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), {
    dbName: 'genre-slug-cleanup-demotions-test',
  });

  const app = express();
  const passthrough = (
    _req: Request,
    _res: Response,
    next: NextFunction,
  ) => next();
  registerAdminMaintenanceRoutes(app, { requireAdmin: passthrough });

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
  await Genre.deleteMany({});
  await GenreSlugCleanupRun.deleteMany({});
});

interface DemotionsResponse {
  runId: string;
  window: {
    startedAt: string;
    endedAt: string;
    runStatus: string;
    isOpenEnded: boolean;
  };
  demotions: Array<{
    _id: string;
    name: string;
    currentSlug: string | null;
    reason: string | null;
    originalSlug: string | null;
    normalizedSlug: string | null;
    collisionWinnerId: string | null;
    collisionWinnerSlug: string | null;
    collisionWinnerName: string | null;
    demotedAt: string | null;
  }>;
  total: number;
  limit: number;
}

async function getDemotions(
  runId: string,
  query?: string,
): Promise<{ status: number; body: DemotionsResponse | { error?: string } }> {
  const url = `${baseUrl}${BASE_PATH}/${runId}/demotions${query ?? ''}`;
  const res = await fetch(url);
  return { status: res.status, body: (await res.json()) as never };
}

// ---------------------------------------------------------------------------
// Happy-path drill-down: only in-window demotions come back, with all
// forensic fields populated.
// ---------------------------------------------------------------------------

test('returns only demotions whose demotedAt falls inside the run window, with full forensic fields', async () => {
  const startedAt = new Date('2026-05-01T00:00:00Z');
  const finishedAt = new Date('2026-05-01T00:10:00Z');

  const run = await GenreSlugCleanupRun.create({
    trigger: 'manual',
    status: 'completed',
    startedAt,
    finishedAt,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    scanned: 4,
    alreadyValid: 1,
    normalized: 0,
    markedUndiscoverable: 3,
    emptySlugMarked: 1,
    collisionMarked: 2,
    errorCount: 0,
    rewarmed: false,
  });

  const winnerId = new mongoose.Types.ObjectId();

  // (1) Empty-slug demotion at the very start of the window — must be
  // included (>= startedAt).
  await Genre.create({
    name: 'Pop (empty)',
    slug: 'pop-empty-undiscoverable',
    isDiscoverable: false,
    cleanupDemotion: {
      reason: 'empty-slug',
      originalSlug: '',
      normalizedSlug: '',
      demotedAt: startedAt,
    },
  });

  // (2) Collision demotion in the middle of the window — must be
  // included with the collision winner metadata intact.
  await Genre.create({
    name: 'Rock (loser)',
    slug: 'rock-loser-undiscoverable',
    isDiscoverable: false,
    cleanupDemotion: {
      reason: 'collision',
      originalSlug: 'rock!',
      normalizedSlug: 'rock',
      collisionWinnerId: winnerId,
      collisionWinnerSlug: 'rock',
      collisionWinnerName: 'Rock',
      demotedAt: new Date('2026-05-01T00:05:00Z'),
    },
  });

  // (3) Demotion at the closing edge of the window — must be included
  // (<= finishedAt).
  await Genre.create({
    name: 'Jazz (edge)',
    slug: 'jazz-edge-undiscoverable',
    isDiscoverable: false,
    cleanupDemotion: {
      reason: 'collision',
      originalSlug: 'jazz ',
      normalizedSlug: 'jazz',
      collisionWinnerId: winnerId,
      collisionWinnerSlug: 'jazz',
      collisionWinnerName: 'Jazz',
      demotedAt: finishedAt,
    },
  });

  // (4) Demotion BEFORE the run started — must be excluded.
  await Genre.create({
    name: 'Older demotion',
    slug: 'older-undiscoverable',
    isDiscoverable: false,
    cleanupDemotion: {
      reason: 'empty-slug',
      originalSlug: '',
      normalizedSlug: '',
      demotedAt: new Date('2026-04-30T23:59:59Z'),
    },
  });

  // (5) Demotion AFTER the run finished — must be excluded.
  await Genre.create({
    name: 'Later demotion',
    slug: 'later-undiscoverable',
    isDiscoverable: false,
    cleanupDemotion: {
      reason: 'empty-slug',
      originalSlug: '',
      normalizedSlug: '',
      demotedAt: new Date('2026-05-01T00:10:01Z'),
    },
  });

  // (6) Healthy genre with no cleanupDemotion — must be excluded.
  await Genre.create({
    name: 'Healthy',
    slug: 'healthy',
    isDiscoverable: true,
  });

  const { status, body } = await getDemotions(String(run._id));
  assert.equal(status, 200);
  const payload = body as DemotionsResponse;

  assert.equal(payload.runId, String(run._id));
  assert.equal(payload.window.runStatus, 'completed');
  assert.equal(payload.window.isOpenEnded, false);
  assert.equal(
    new Date(payload.window.startedAt).toISOString(),
    startedAt.toISOString(),
  );
  assert.equal(
    new Date(payload.window.endedAt).toISOString(),
    finishedAt.toISOString(),
  );

  assert.equal(payload.total, 3, 'only the 3 in-window demotions must be returned');
  assert.equal(payload.demotions.length, 3);

  // Sorted ascending by demotedAt — empty-slug first, then collision,
  // then the edge demotion.
  const [first, second, third] = payload.demotions;

  assert.equal(first.name, 'Pop (empty)');
  assert.equal(first.reason, 'empty-slug');
  assert.equal(first.originalSlug, '');
  assert.equal(first.normalizedSlug, '');
  assert.equal(first.collisionWinnerId, null);
  assert.equal(first.collisionWinnerSlug, null);
  assert.equal(first.collisionWinnerName, null);
  assert.equal(first.currentSlug, 'pop-empty-undiscoverable');
  assert.equal(
    new Date(first.demotedAt!).toISOString(),
    startedAt.toISOString(),
  );

  assert.equal(second.name, 'Rock (loser)');
  assert.equal(second.reason, 'collision');
  assert.equal(second.originalSlug, 'rock!');
  assert.equal(second.normalizedSlug, 'rock');
  assert.equal(second.collisionWinnerId, String(winnerId));
  assert.equal(second.collisionWinnerSlug, 'rock');
  assert.equal(second.collisionWinnerName, 'Rock');

  assert.equal(third.name, 'Jazz (edge)');
  assert.equal(third.reason, 'collision');
  assert.equal(
    new Date(third.demotedAt!).toISOString(),
    finishedAt.toISOString(),
  );

  // Excluded names must not appear.
  const names = payload.demotions.map((d) => d.name);
  assert.ok(!names.includes('Older demotion'));
  assert.ok(!names.includes('Later demotion'));
  assert.ok(!names.includes('Healthy'));
});

// ---------------------------------------------------------------------------
// Open-ended (still-running) runs: window is capped at "now" so partial
// demotions show up live. A demotion in the future must NOT appear.
// ---------------------------------------------------------------------------

test('still-running runs cap the window at now and flag isOpenEnded=true', async () => {
  const startedAt = new Date(Date.now() - 60_000); // 1 minute ago
  const run = await GenreSlugCleanupRun.create({
    trigger: 'manual',
    status: 'running',
    startedAt,
    scanned: 0,
    alreadyValid: 0,
    normalized: 0,
    markedUndiscoverable: 0,
    emptySlugMarked: 0,
    collisionMarked: 0,
    errorCount: 0,
    rewarmed: false,
  });

  // In-window: 30s ago.
  await Genre.create({
    name: 'Live demotion',
    slug: 'live-demotion-undiscoverable',
    isDiscoverable: false,
    cleanupDemotion: {
      reason: 'empty-slug',
      originalSlug: '',
      normalizedSlug: '',
      demotedAt: new Date(Date.now() - 30_000),
    },
  });

  // Out-of-window: 1 hour in the future. Must be excluded — windowEnd
  // is capped at "now" for running runs even though finishedAt is
  // unset.
  await Genre.create({
    name: 'Future demotion',
    slug: 'future-demotion-undiscoverable',
    isDiscoverable: false,
    cleanupDemotion: {
      reason: 'empty-slug',
      originalSlug: '',
      normalizedSlug: '',
      demotedAt: new Date(Date.now() + 60 * 60_000),
    },
  });

  const { status, body } = await getDemotions(String(run._id));
  assert.equal(status, 200);
  const payload = body as DemotionsResponse;

  assert.equal(payload.window.runStatus, 'running');
  assert.equal(payload.window.isOpenEnded, true);
  assert.equal(payload.total, 1);
  assert.equal(payload.demotions[0].name, 'Live demotion');
});

// ---------------------------------------------------------------------------
// Error cases: bad run id and unknown run id.
// ---------------------------------------------------------------------------

test('returns 400 for an invalid ObjectId', async () => {
  const { status, body } = await getDemotions('not-an-objectid');
  assert.equal(status, 400);
  assert.match((body as { error?: string }).error ?? '', /invalid_run_id/);
});

test('returns 404 for an unknown run id', async () => {
  const missingId = new mongoose.Types.ObjectId().toString();
  const { status, body } = await getDemotions(missingId);
  assert.equal(status, 404);
  assert.match((body as { error?: string }).error ?? '', /run_not_found/);
});
