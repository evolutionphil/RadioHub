/**
 * Regression tests for the genre-slug cleanup alerting pipeline (Task #199).
 *
 * The cleanup notifier is the only signal we get when something upstream
 * starts reintroducing malformed genre slugs. If it silently stops firing
 * — wrong threshold parsing, wrong field names on the run doc, swallowed
 * error — we won't notice until weeks later in Search Console. These
 * tests lock in:
 *
 *   - failed runs always alert (regardless of threshold)
 *   - successful runs at/above the threshold alert with reason
 *     `threshold-exceeded`
 *   - successful runs below the threshold stay silent
 *   - the `GENRE_SLUG_CLEANUP_ALERT_THRESHOLD` env knob is honoured
 *   - a notifier that throws does NOT bubble out of
 *     `notifyGenreSlugCleanupResult`
 *   - `scheduledGenreSlugCleanup.runOnce()` invokes the injected
 *     notifier with the correct reason for both happy and failure paths
 *
 * Runner: requires `--experimental-test-module-mocks` (wired up in
 * artifacts/api-server/package.json#scripts.test).
 */
import { test, mock, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import type { IGenreSlugCleanupRun } from '../src/shared/mongo-schemas.ts';

// ---------------------------------------------------------------------------
// Module mocks for the integration-style runOnce() test. Must be installed
// before the modules under test get imported.
// ---------------------------------------------------------------------------

interface FakeRunDoc {
  _id: string;
  trigger: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: Date;
  finishedAt?: Date;
  durationMs?: number;
  scanned: number;
  alreadyValid: number;
  normalized: number;
  markedUndiscoverable: number;
  emptySlugMarked: number;
  collisionMarked: number;
  errorCount: number;
  rewarmed: boolean;
  errorMessage?: string;
  save: () => Promise<void>;
}

const createdRuns: FakeRunDoc[] = [];

const FakeGenreSlugCleanupRun = {
  create: async (input: Partial<FakeRunDoc>): Promise<FakeRunDoc> => {
    const doc: FakeRunDoc = {
      _id: `run-${createdRuns.length + 1}`,
      trigger: input.trigger ?? 'manual',
      status: (input.status ?? 'running') as FakeRunDoc['status'],
      startedAt: input.startedAt ?? new Date(),
      scanned: input.scanned ?? 0,
      alreadyValid: input.alreadyValid ?? 0,
      normalized: input.normalized ?? 0,
      markedUndiscoverable: input.markedUndiscoverable ?? 0,
      emptySlugMarked: input.emptySlugMarked ?? 0,
      collisionMarked: input.collisionMarked ?? 0,
      errorCount: input.errorCount ?? 0,
      rewarmed: input.rewarmed ?? false,
      save: async () => {},
    };
    createdRuns.push(doc);
    return doc;
  },
};

mock.module(new URL('../src/shared/mongo-schemas.ts', import.meta.url).href, {
  namedExports: {
    GenreSlugCleanupRun: FakeGenreSlugCleanupRun,
  },
});

// runGenreSlugCleanup is hot-swapped per test via this mutable reference.
let cleanupImpl: () => Promise<{
  scanned: number;
  alreadyValid: number;
  normalized: number;
  markedUndiscoverable: number;
  emptySlugMarked: number;
  collisionMarked: number;
  errors: number;
}> = async () => ({
  scanned: 0,
  alreadyValid: 0,
  normalized: 0,
  markedUndiscoverable: 0,
  emptySlugMarked: 0,
  collisionMarked: 0,
  errors: 0,
});

mock.module(
  new URL('../src/scripts/cleanup-malformed-genre-slugs.ts', import.meta.url).href,
  {
    namedExports: {
      runGenreSlugCleanup: (..._args: unknown[]) => cleanupImpl(),
    },
  },
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRun(overrides: Partial<IGenreSlugCleanupRun> = {}): IGenreSlugCleanupRun {
  const base = {
    _id: 'run-test' as unknown,
    trigger: 'cron:weekly',
    status: 'completed' as 'running' | 'completed' | 'failed',
    startedAt: new Date('2026-01-01T00:00:00Z'),
    finishedAt: new Date('2026-01-01T00:00:01Z'),
    durationMs: 1000,
    scanned: 100,
    alreadyValid: 100,
    normalized: 0,
    markedUndiscoverable: 0,
    emptySlugMarked: 0,
    collisionMarked: 0,
    errorCount: 0,
    rewarmed: false,
  };
  return { ...base, ...overrides } as unknown as IGenreSlugCleanupRun;
}

const ORIGINAL_THRESHOLD_ENV = process.env.GENRE_SLUG_CLEANUP_ALERT_THRESHOLD;
const ORIGINAL_WEBHOOK_ENV = process.env.BACKFILL_ALERT_WEBHOOK_URL;

before(() => {
  // Make sure the webhook side effect never fires during these tests —
  // we only care about the in-process notifier hook.
  delete process.env.BACKFILL_ALERT_WEBHOOK_URL;
});

after(() => {
  if (ORIGINAL_THRESHOLD_ENV === undefined) {
    delete process.env.GENRE_SLUG_CLEANUP_ALERT_THRESHOLD;
  } else {
    process.env.GENRE_SLUG_CLEANUP_ALERT_THRESHOLD = ORIGINAL_THRESHOLD_ENV;
  }
  if (ORIGINAL_WEBHOOK_ENV === undefined) {
    delete process.env.BACKFILL_ALERT_WEBHOOK_URL;
  } else {
    process.env.BACKFILL_ALERT_WEBHOOK_URL = ORIGINAL_WEBHOOK_ENV;
  }
});

afterEach(async () => {
  delete process.env.GENRE_SLUG_CLEANUP_ALERT_THRESHOLD;
  const { setGenreSlugCleanupNotifier } = await import(
    '../src/services/genre-slug-cleanup-notifier.ts'
  );
  setGenreSlugCleanupNotifier(null);
  createdRuns.length = 0;
});

// ---------------------------------------------------------------------------
// notifyGenreSlugCleanupResult — unit tests
// ---------------------------------------------------------------------------

test('failed runs always alert with reason="failed", even with zero changed rows', async () => {
  const { notifyGenreSlugCleanupResult, setGenreSlugCleanupNotifier } = await import(
    '../src/services/genre-slug-cleanup-notifier.ts'
  );

  const calls: Array<{ reason: string; runId: string }> = [];
  setGenreSlugCleanupNotifier((run, reason) => {
    calls.push({ reason, runId: String(run._id) });
  });

  await notifyGenreSlugCleanupResult(
    makeRun({
      _id: 'r-failed' as unknown,
      status: 'failed',
      normalized: 0,
      markedUndiscoverable: 0,
      errorMessage: 'boom',
    } as Partial<IGenreSlugCleanupRun>),
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].reason, 'failed');
  assert.equal(calls[0].runId, 'r-failed');
});

test('successful run at the default threshold (5 changed rows) alerts with reason="threshold-exceeded"', async () => {
  const { notifyGenreSlugCleanupResult, setGenreSlugCleanupNotifier } = await import(
    '../src/services/genre-slug-cleanup-notifier.ts'
  );

  const reasons: string[] = [];
  setGenreSlugCleanupNotifier((_run, reason) => {
    reasons.push(reason);
  });

  await notifyGenreSlugCleanupResult(
    makeRun({ normalized: 3, markedUndiscoverable: 2 }),
  );

  assert.deepEqual(reasons, ['threshold-exceeded']);
});

test('successful run above the default threshold alerts', async () => {
  const { notifyGenreSlugCleanupResult, setGenreSlugCleanupNotifier } = await import(
    '../src/services/genre-slug-cleanup-notifier.ts'
  );

  const reasons: string[] = [];
  setGenreSlugCleanupNotifier((_run, reason) => {
    reasons.push(reason);
  });

  await notifyGenreSlugCleanupResult(
    makeRun({ normalized: 100, markedUndiscoverable: 0 }),
  );

  assert.deepEqual(reasons, ['threshold-exceeded']);
});

test('successful run below the default threshold stays silent', async () => {
  const { notifyGenreSlugCleanupResult, setGenreSlugCleanupNotifier } = await import(
    '../src/services/genre-slug-cleanup-notifier.ts'
  );

  let called = 0;
  setGenreSlugCleanupNotifier(() => {
    called += 1;
  });

  await notifyGenreSlugCleanupResult(
    makeRun({ normalized: 2, markedUndiscoverable: 2 }), // 4 < 5
  );

  assert.equal(called, 0);
});

test('GENRE_SLUG_CLEANUP_ALERT_THRESHOLD is respected (custom higher threshold suppresses default-noisy run)', async () => {
  const { notifyGenreSlugCleanupResult, setGenreSlugCleanupNotifier } = await import(
    '../src/services/genre-slug-cleanup-notifier.ts'
  );

  process.env.GENRE_SLUG_CLEANUP_ALERT_THRESHOLD = '50';

  let called = 0;
  setGenreSlugCleanupNotifier(() => {
    called += 1;
  });

  await notifyGenreSlugCleanupResult(
    makeRun({ normalized: 10, markedUndiscoverable: 10 }), // 20 < 50
  );
  assert.equal(called, 0, 'should be silent when changed rows below custom threshold');

  await notifyGenreSlugCleanupResult(
    makeRun({ normalized: 30, markedUndiscoverable: 25 }), // 55 >= 50
  );
  assert.equal(called, 1, 'should alert when changed rows meet custom threshold');
});

test('GENRE_SLUG_CLEANUP_ALERT_THRESHOLD=0 alerts on any single change', async () => {
  const { notifyGenreSlugCleanupResult, setGenreSlugCleanupNotifier } = await import(
    '../src/services/genre-slug-cleanup-notifier.ts'
  );

  process.env.GENRE_SLUG_CLEANUP_ALERT_THRESHOLD = '0';

  let called = 0;
  setGenreSlugCleanupNotifier(() => {
    called += 1;
  });

  await notifyGenreSlugCleanupResult(
    makeRun({ normalized: 0, markedUndiscoverable: 0 }),
  );
  assert.equal(called, 1, 'threshold of 0 should alert even on no-op runs');
});

test('invalid GENRE_SLUG_CLEANUP_ALERT_THRESHOLD falls back to the default of 5', async () => {
  const { getGenreSlugCleanupAlertThreshold } = await import(
    '../src/services/genre-slug-cleanup-notifier.ts'
  );

  process.env.GENRE_SLUG_CLEANUP_ALERT_THRESHOLD = 'not-a-number';
  assert.equal(getGenreSlugCleanupAlertThreshold(), 5);

  process.env.GENRE_SLUG_CLEANUP_ALERT_THRESHOLD = '-3';
  assert.equal(getGenreSlugCleanupAlertThreshold(), 5);

  delete process.env.GENRE_SLUG_CLEANUP_ALERT_THRESHOLD;
  assert.equal(getGenreSlugCleanupAlertThreshold(), 5);
});

test('a notifier that throws is caught — notifyGenreSlugCleanupResult never rejects', async () => {
  const { notifyGenreSlugCleanupResult, setGenreSlugCleanupNotifier } = await import(
    '../src/services/genre-slug-cleanup-notifier.ts'
  );

  setGenreSlugCleanupNotifier(() => {
    throw new Error('alert channel exploded');
  });

  await assert.doesNotReject(
    notifyGenreSlugCleanupResult(makeRun({ status: 'failed', errorMessage: 'x' })),
  );
});

test('null run is a no-op (no notifier invocation, no throw)', async () => {
  const { notifyGenreSlugCleanupResult, setGenreSlugCleanupNotifier } = await import(
    '../src/services/genre-slug-cleanup-notifier.ts'
  );

  let called = 0;
  setGenreSlugCleanupNotifier(() => {
    called += 1;
  });

  await notifyGenreSlugCleanupResult(null);
  assert.equal(called, 0);
});

// ---------------------------------------------------------------------------
// Integration-style: scheduledGenreSlugCleanup.runOnce() invokes the notifier
// ---------------------------------------------------------------------------

test('runOnce() calls the notifier with reason="threshold-exceeded" when the cleanup changes enough rows', async () => {
  const { setGenreSlugCleanupNotifier } = await import(
    '../src/services/genre-slug-cleanup-notifier.ts'
  );
  const { scheduledGenreSlugCleanup } = await import(
    '../src/services/scheduled-genre-slug-cleanup.ts'
  );

  cleanupImpl = async () => ({
    scanned: 200,
    alreadyValid: 190,
    normalized: 7,
    markedUndiscoverable: 3,
    emptySlugMarked: 1,
    collisionMarked: 0,
    errors: 0,
  });

  const calls: Array<{ reason: string; status: string; normalized: number }> = [];
  setGenreSlugCleanupNotifier((run, reason) => {
    calls.push({ reason, status: run.status, normalized: run.normalized });
  });

  const run = await scheduledGenreSlugCleanup.runOnce('test:happy');
  assert.ok(run, 'runOnce should return the persisted run doc');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].reason, 'threshold-exceeded');
  assert.equal(calls[0].status, 'completed');
  assert.equal(calls[0].normalized, 7);
});

test('runOnce() calls the notifier with reason="failed" when the cleanup throws', async () => {
  const { setGenreSlugCleanupNotifier } = await import(
    '../src/services/genre-slug-cleanup-notifier.ts'
  );
  const { scheduledGenreSlugCleanup } = await import(
    '../src/services/scheduled-genre-slug-cleanup.ts'
  );

  cleanupImpl = async () => {
    throw new Error('mongo down');
  };

  const calls: Array<{ reason: string; status: string; errorMessage?: string }> = [];
  setGenreSlugCleanupNotifier((run, reason) => {
    calls.push({ reason, status: run.status, errorMessage: run.errorMessage });
  });

  const run = await scheduledGenreSlugCleanup.runOnce('test:fail');
  assert.ok(run, 'runOnce should return the failed run doc, not null');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].reason, 'failed');
  assert.equal(calls[0].status, 'failed');
  assert.equal(calls[0].errorMessage, 'mongo down');
});

test('runOnce() stays silent when the cleanup changes fewer rows than the threshold', async () => {
  const { setGenreSlugCleanupNotifier } = await import(
    '../src/services/genre-slug-cleanup-notifier.ts'
  );
  const { scheduledGenreSlugCleanup } = await import(
    '../src/services/scheduled-genre-slug-cleanup.ts'
  );

  cleanupImpl = async () => ({
    scanned: 200,
    alreadyValid: 198,
    normalized: 1,
    markedUndiscoverable: 1, // total=2, default threshold=5
    emptySlugMarked: 0,
    collisionMarked: 0,
    errors: 0,
  });

  let called = 0;
  setGenreSlugCleanupNotifier(() => {
    called += 1;
  });

  const run = await scheduledGenreSlugCleanup.runOnce('test:quiet');
  assert.ok(run);
  assert.equal(run.status, 'completed');
  assert.equal(called, 0, 'quiet weekly tick should not page on-call');
});
