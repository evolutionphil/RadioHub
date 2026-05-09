/**
 * Regression tests for the coverage-tags resume-hint flow (Task #252,
 * locked in by Task #338).
 *
 * The cancel + Undo dance for the per-country tags backfill stores
 * an in-memory hint (keyed by uppercase countryCode, with a ~5 minute
 * TTL) so that a follow-up enqueue carries the cancelled run's
 * `processed` / `hydrated` / `emptyUpstream` / `failed` / `total`
 * counters forward — both as the new job's baseline and as the
 * `resumedFrom` block on the enqueue response. Without that, every
 * Undo would visibly reset the progress bar to 0/total even though
 * the candidate filter inside `hydrateMissingTagsInBackground` would
 * have skipped the stations the cancelled run already hydrated.
 *
 * Two contracts must hold:
 *   1. Cancel → re-enqueue within the TTL window seeds the new job's
 *      tags counters (and `resumedFrom`) from the cancelled run.
 *   2. Cancel → re-enqueue AFTER the TTL has elapsed gets a fresh
 *      0/0 baseline with `resumedFrom: null`.
 *
 * The test boots the production admin routes against an in-memory
 * MongoDB and stubs `syncService.hydrateMissingTagsInBackground` so
 * we can drive `onProgress` / cancellation deterministically.
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

import { registerAdminStationRoutes } from '../src/routes/admin-station-routes';
import { syncService } from '../src/services/sync';

type HydrateResult = {
  processed: number;
  hydrated: number;
  emptyUpstream: number;
  failed: number;
  cancelled: boolean;
};

type Capture = {
  isCancelled: () => boolean;
  onProgress: (p: {
    total: number;
    processed: number;
    hydrated: number;
    emptyUpstream: number;
    failed: number;
  }) => void;
  resolve: (result: HydrateResult) => void;
  promise: Promise<HydrateResult>;
};

function makeCapture(): Capture {
  let resolve!: (r: HydrateResult) => void;
  const promise = new Promise<HydrateResult>((r) => {
    resolve = r;
  });
  return {
    isCancelled: () => false,
    onProgress: () => {},
    resolve,
    promise,
  };
}

let mongod: MongoMemoryServer;
let server: HttpServer;
let baseUrl: string;
let originalHydrate: typeof syncService.hydrateMissingTagsInBackground;
let nextCapture: Capture | null = null;

before(async () => {
  process.env.NODE_ENV = 'test';

  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'tags-resume-hint-test' });

  // Swap out the real Radio-Browser-touching hydrator for a deterministic
  // stub. The route only ever uses the `isCancelled` / `onProgress`
  // callbacks and the resolved counters, which is exactly what the
  // capture exposes to the test body.
  originalHydrate = syncService.hydrateMissingTagsInBackground.bind(
    syncService,
  );
  (syncService as any).hydrateMissingTagsInBackground = async (opts: {
    isCancelled?: () => boolean;
    onProgress?: Capture['onProgress'];
  }) => {
    if (!nextCapture) {
      throw new Error(
        'hydrateMissingTagsInBackground was called but the test has not staged a capture',
      );
    }
    const cap = nextCapture;
    nextCapture = null;
    if (opts.isCancelled) cap.isCancelled = opts.isCancelled;
    if (opts.onProgress) cap.onProgress = opts.onProgress;
    return cap.promise;
  };

  const app = express();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { adminAuth: { username: 'tester-admin' } };
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
  if (originalHydrate) {
    (syncService as any).hydrateMissingTagsInBackground = originalHydrate;
  }
});

beforeEach(() => {
  nextCapture = null;
});

async function enqueueTags(country: string) {
  return fetch(`${baseUrl}/api/admin/coverage/enqueue/${country}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scope: 'tags' }),
  });
}

async function cancelJob(jobId: string) {
  return fetch(`${baseUrl}/api/admin/coverage/enqueue-job-cancel/${jobId}`, {
    method: 'POST',
  });
}

async function jobStatus(jobId: string) {
  const res = await fetch(
    `${baseUrl}/api/admin/coverage/enqueue-job-status/${jobId}`,
  );
  assert.equal(res.status, 200, 'status endpoint must return 200');
  return (await res.json()) as {
    success: boolean;
    job: {
      status: string;
      tags?: {
        total: number;
        processed: number;
        hydrated: number;
        emptyUpstream: number;
        failed: number;
        done: boolean;
        resumedFrom?: {
          processed: number;
          hydrated: number;
          emptyUpstream: number;
          failed: number;
          total: number;
        };
      };
    };
  };
}

// Spin the microtask queue a few times so the route's `.then` /
// `.catch` chained on the stubbed hydrator gets a chance to update
// the in-memory job + stash the resume hint before we re-enqueue.
async function flushMicrotasks() {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setImmediate(r));
  }
}

// ---------------------------------------------------------------------------
// 1. Cancel + re-enqueue within the TTL carries the counters forward.
// ---------------------------------------------------------------------------

test('cancel + re-enqueue within the TTL window seeds the new tags subjob from the cancelled run', async () => {
  const COUNTRY = 'AT';

  // ---- First enqueue: starts the tags subjob with no resume hint.
  const cap1 = makeCapture();
  nextCapture = cap1;
  const r1 = await enqueueTags(COUNTRY);
  assert.equal(r1.status, 200);
  const body1 = (await r1.json()) as {
    success: boolean;
    jobId: string;
    tags: { started: boolean; resumedFrom: unknown };
  };
  assert.equal(body1.success, true);
  assert.equal(body1.tags.started, true);
  assert.equal(
    body1.tags.resumedFrom,
    null,
    'first run for this country must not have a resume hint',
  );

  // Drive some progress so cancel has non-zero counters to stash.
  cap1.onProgress({
    total: 10,
    processed: 4,
    hydrated: 3,
    emptyUpstream: 1,
    failed: 0,
  });

  const sMid = await jobStatus(body1.jobId);
  assert.equal(sMid.job.tags?.processed, 4);
  assert.equal(sMid.job.tags?.hydrated, 3);
  assert.equal(sMid.job.tags?.total, 10);
  assert.equal(
    sMid.job.tags?.resumedFrom,
    undefined,
    'first run must not surface resumedFrom on its status',
  );

  // ---- Cancel the first run. The cancel handler stashes a hint
  // immediately (so an Undo that races the .then still has data),
  // and the .then below stashes again with the post-final numbers.
  const c1 = await cancelJob(body1.jobId);
  assert.equal(c1.status, 200);
  assert.equal(
    cap1.isCancelled(),
    true,
    'cancelRequested must propagate to the hydrator callback',
  );

  // Resolve the stubbed hydrator as if it observed the cancel and
  // exited cleanly with the same counters it last reported.
  cap1.resolve({
    processed: 4,
    hydrated: 3,
    emptyUpstream: 1,
    failed: 0,
    cancelled: true,
  });
  await flushMicrotasks();

  const sFinal = await jobStatus(body1.jobId);
  assert.equal(
    sFinal.job.status,
    'cancelled',
    'first job must transition to cancelled once the hydrator returns',
  );

  // ---- Re-enqueue within the TTL: the new job must carry the
  // cancelled counters forward.
  const cap2 = makeCapture();
  nextCapture = cap2;
  const r2 = await enqueueTags(COUNTRY);
  assert.equal(r2.status, 200);
  const body2 = (await r2.json()) as {
    success: boolean;
    jobId: string;
    tags: {
      started: boolean;
      resumedFrom: {
        processed: number;
        hydrated: number;
        emptyUpstream: number;
        failed: number;
        total: number;
      } | null;
    };
  };
  assert.equal(body2.tags.started, true);
  assert.deepEqual(
    body2.tags.resumedFrom,
    { processed: 4, hydrated: 3, emptyUpstream: 1, failed: 0, total: 10 },
    'enqueue response must echo the resumed counters from the cancelled run',
  );

  const sResumed = await jobStatus(body2.jobId);
  assert.equal(
    sResumed.job.tags?.processed,
    4,
    'resumed job must inherit processed counter from cancelled run',
  );
  assert.equal(
    sResumed.job.tags?.hydrated,
    3,
    'resumed job must inherit hydrated counter from cancelled run',
  );
  assert.equal(
    sResumed.job.tags?.emptyUpstream,
    1,
    'resumed job must inherit emptyUpstream counter from cancelled run',
  );
  assert.equal(
    sResumed.job.tags?.failed,
    0,
    'resumed job must inherit failed counter from cancelled run',
  );
  assert.equal(
    sResumed.job.tags?.total,
    10,
    'resumed job must inherit total denominator from cancelled run',
  );
  assert.deepEqual(
    sResumed.job.tags?.resumedFrom,
    { processed: 4, hydrated: 3, emptyUpstream: 1, failed: 0, total: 10 },
    'status payload must surface the resumedFrom block so the UI can label progress as carried-forward',
  );

  // Tear the resumed run down so it doesn't dangle into the next test.
  cap2.resolve({
    processed: 0,
    hydrated: 0,
    emptyUpstream: 0,
    failed: 0,
    cancelled: false,
  });
  await flushMicrotasks();
});

// ---------------------------------------------------------------------------
// 2. Once the TTL has elapsed, the hint is dropped on the next enqueue.
// ---------------------------------------------------------------------------

test('re-enqueue after the resume-hint TTL elapses gets a fresh 0/0 baseline with resumedFrom: null', async () => {
  const COUNTRY = 'BE';

  const cap1 = makeCapture();
  nextCapture = cap1;
  const r1 = await enqueueTags(COUNTRY);
  assert.equal(r1.status, 200);
  const body1 = (await r1.json()) as {
    success: boolean;
    jobId: string;
    tags: { resumedFrom: unknown };
  };
  assert.equal(body1.tags.resumedFrom, null);

  cap1.onProgress({
    total: 8,
    processed: 5,
    hydrated: 4,
    emptyUpstream: 1,
    failed: 0,
  });

  const c1 = await cancelJob(body1.jobId);
  assert.equal(c1.status, 200);
  cap1.resolve({
    processed: 5,
    hydrated: 4,
    emptyUpstream: 1,
    failed: 0,
    cancelled: true,
  });
  await flushMicrotasks();

  // Advance the clock past the 5-minute TTL by stubbing Date.now.
  // `consumeCoverageTagsResumeHint` checks `Date.now() - hint.cancelledAt`
  // against the TTL, so a stale clock makes the hint return null even
  // though it's still in the in-memory map.
  const realNow = Date.now;
  const advanced = realNow() + 6 * 60 * 1000;
  Date.now = () => advanced;
  try {
    const cap2 = makeCapture();
    nextCapture = cap2;
    const r2 = await enqueueTags(COUNTRY);
    assert.equal(r2.status, 200);
    const body2 = (await r2.json()) as {
      jobId: string;
      tags: { resumedFrom: unknown };
    };
    assert.equal(
      body2.tags.resumedFrom,
      null,
      'after the TTL elapses the hint must be dropped and the new job starts fresh',
    );

    const sFresh = await jobStatus(body2.jobId);
    assert.equal(
      sFresh.job.tags?.processed,
      0,
      'expired hint must NOT seed processed counter',
    );
    assert.equal(
      sFresh.job.tags?.hydrated,
      0,
      'expired hint must NOT seed hydrated counter',
    );
    assert.equal(
      sFresh.job.tags?.total,
      0,
      'expired hint must NOT seed total denominator',
    );
    assert.equal(
      sFresh.job.tags?.resumedFrom,
      undefined,
      'expired hint must leave resumedFrom undefined on the status payload',
    );

    cap2.resolve({
      processed: 0,
      hydrated: 0,
      emptyUpstream: 0,
      failed: 0,
      cancelled: false,
    });
    await flushMicrotasks();
  } finally {
    Date.now = realNow;
  }
});
