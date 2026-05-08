/**
 * Regression tests for the weekly-backfill alerting pipeline.
 *
 * Covers two reasons the notifier fires:
 *   - `failed`     — every retry was exhausted (Task #118).
 *   - `recovered`  — the run eventually completed but only after
 *                    `>= BACKFILL_RECOVERY_ALERT_MIN_ATTEMPTS` failed
 *                    attempts (Task #224). Repeated near-misses are a
 *                    precursor to a paging failure, so we want them
 *                    surfaced proactively instead of waiting for the
 *                    dashboard to be checked.
 *
 * These tests lock in:
 *   - failed runs always alert with reason `failed`
 *   - completed runs at/above the configured retry threshold alert
 *     with reason `recovered`
 *   - completed runs below the threshold (including clean first-try
 *     runs) stay silent
 *   - the `BACKFILL_RECOVERY_ALERT_MIN_ATTEMPTS` env knob is honoured
 *   - the alert payload includes trigger, attempt count, and last
 *     attempt error
 *   - a notifier that throws does NOT bubble out of
 *     `notifyBackfillResult`
 *   - `null` runs are a no-op
 *
 * Runner: `--experimental-test-module-mocks` (wired up in
 * artifacts/api-server/package.json#scripts.test).
 */
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import type {
  IBackfillRun,
  IBackfillRunAttempt,
} from '@workspace/db-shared/mongo-schemas';

function makeRun(overrides: Partial<IBackfillRun> = {}): IBackfillRun {
  const base = {
    _id: 'run-test' as unknown,
    trigger: 'cron:weekly',
    status: 'completed' as 'running' | 'completed' | 'failed',
    topN: 5,
    startedAt: new Date('2026-01-01T00:00:00Z'),
    finishedAt: new Date('2026-01-01T00:05:00Z'),
    durationMs: 5 * 60 * 1000,
    logos: [{ countryCode: 'TR', candidates: 100, enqueued: 100 }],
    tags: [{ countryCode: 'TR', processed: 50, hydrated: 40, emptyUpstream: 5, failed: 5 }],
    attempts: [] as IBackfillRunAttempt[],
  };
  return { ...base, ...overrides } as unknown as IBackfillRun;
}

function attempts(n: number, lastError = 'mongo timeout'): IBackfillRunAttempt[] {
  const out: IBackfillRunAttempt[] = [];
  for (let i = 1; i <= n; i++) {
    out.push({
      attempt: i,
      error: i === n ? lastError : `transient blip #${i}`,
      failedAt: new Date('2026-01-01T00:00:00Z'),
    });
  }
  return out;
}

const ORIGINAL_THRESHOLD_ENV = process.env.BACKFILL_RECOVERY_ALERT_MIN_ATTEMPTS;
const ORIGINAL_WEBHOOK_ENV = process.env.BACKFILL_ALERT_WEBHOOK_URL;

before(() => {
  // The default notifier POSTs to BACKFILL_ALERT_WEBHOOK_URL when set.
  // We only care about the in-process notifier hook here, so make sure
  // no real webhook fires during tests.
  delete process.env.BACKFILL_ALERT_WEBHOOK_URL;
});

after(() => {
  if (ORIGINAL_THRESHOLD_ENV === undefined) {
    delete process.env.BACKFILL_RECOVERY_ALERT_MIN_ATTEMPTS;
  } else {
    process.env.BACKFILL_RECOVERY_ALERT_MIN_ATTEMPTS = ORIGINAL_THRESHOLD_ENV;
  }
  if (ORIGINAL_WEBHOOK_ENV === undefined) {
    delete process.env.BACKFILL_ALERT_WEBHOOK_URL;
  } else {
    process.env.BACKFILL_ALERT_WEBHOOK_URL = ORIGINAL_WEBHOOK_ENV;
  }
});

afterEach(async () => {
  delete process.env.BACKFILL_RECOVERY_ALERT_MIN_ATTEMPTS;
  const { setBackfillNotifier } = await import('../src/services/backfill-notifier.ts');
  setBackfillNotifier(null);
});

// ---------------------------------------------------------------------------
// notifyBackfillResult — failure path
// ---------------------------------------------------------------------------

test('failed runs always alert with reason="failed", regardless of attempt count', async () => {
  const { notifyBackfillResult, setBackfillNotifier } = await import(
    '../src/services/backfill-notifier.ts'
  );

  const calls: Array<{ reason: string; runId: string }> = [];
  setBackfillNotifier((run, reason) => {
    calls.push({ reason, runId: String(run._id) });
  });

  await notifyBackfillResult(
    makeRun({
      _id: 'r-failed' as unknown,
      status: 'failed',
      attempts: attempts(3, 'final boom'),
      errorMessage: 'final boom',
    } as Partial<IBackfillRun>),
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].reason, 'failed');
  assert.equal(calls[0].runId, 'r-failed');
});

// ---------------------------------------------------------------------------
// notifyBackfillResult — recovery path (the new Task #224 behavior)
// ---------------------------------------------------------------------------

test('completed run with >=2 failed attempts (default threshold) alerts with reason="recovered"', async () => {
  const { notifyBackfillResult, setBackfillNotifier } = await import(
    '../src/services/backfill-notifier.ts'
  );

  const reasons: string[] = [];
  setBackfillNotifier((_run, reason) => {
    reasons.push(reason);
  });

  await notifyBackfillResult(
    makeRun({ status: 'completed', attempts: attempts(2) }),
  );

  assert.deepEqual(reasons, ['recovered']);
});

test('completed run with 1 failed attempt stays silent at the default threshold', async () => {
  const { notifyBackfillResult, setBackfillNotifier } = await import(
    '../src/services/backfill-notifier.ts'
  );

  let called = 0;
  setBackfillNotifier(() => {
    called += 1;
  });

  await notifyBackfillResult(
    makeRun({ status: 'completed', attempts: attempts(1) }),
  );

  assert.equal(called, 0, 'a single transient blip should not page on-call');
});

test('clean first-try completed run stays silent', async () => {
  const { notifyBackfillResult, setBackfillNotifier } = await import(
    '../src/services/backfill-notifier.ts'
  );

  let called = 0;
  setBackfillNotifier(() => {
    called += 1;
  });

  await notifyBackfillResult(makeRun({ status: 'completed', attempts: [] }));

  assert.equal(called, 0);
});

test('BACKFILL_RECOVERY_ALERT_MIN_ATTEMPTS is honoured (higher threshold suppresses default-noisy run)', async () => {
  const { notifyBackfillResult, setBackfillNotifier } = await import(
    '../src/services/backfill-notifier.ts'
  );

  process.env.BACKFILL_RECOVERY_ALERT_MIN_ATTEMPTS = '4';

  let called = 0;
  setBackfillNotifier(() => {
    called += 1;
  });

  await notifyBackfillResult(
    makeRun({ status: 'completed', attempts: attempts(3) }),
  );
  assert.equal(called, 0, 'should be silent when attempts below custom threshold');

  await notifyBackfillResult(
    makeRun({ status: 'completed', attempts: attempts(4) }),
  );
  assert.equal(called, 1, 'should alert when attempts meet custom threshold');
});

test('BACKFILL_RECOVERY_ALERT_MIN_ATTEMPTS=0 still requires at least one attempt to alert (clean runs stay silent)', async () => {
  const { notifyBackfillResult, setBackfillNotifier } = await import(
    '../src/services/backfill-notifier.ts'
  );

  process.env.BACKFILL_RECOVERY_ALERT_MIN_ATTEMPTS = '0';

  let called = 0;
  setBackfillNotifier(() => {
    called += 1;
  });

  await notifyBackfillResult(makeRun({ status: 'completed', attempts: [] }));
  assert.equal(called, 0, 'a fully clean run should never trigger a recovery alert');

  await notifyBackfillResult(
    makeRun({ status: 'completed', attempts: attempts(1) }),
  );
  assert.equal(called, 1, 'threshold of 0 should alert on any retry');
});

test('invalid BACKFILL_RECOVERY_ALERT_MIN_ATTEMPTS falls back to the default of 2', async () => {
  const { getBackfillRecoveryAlertMinAttempts } = await import(
    '../src/services/backfill-notifier.ts'
  );

  process.env.BACKFILL_RECOVERY_ALERT_MIN_ATTEMPTS = 'not-a-number';
  assert.equal(getBackfillRecoveryAlertMinAttempts(), 2);

  process.env.BACKFILL_RECOVERY_ALERT_MIN_ATTEMPTS = '-3';
  assert.equal(getBackfillRecoveryAlertMinAttempts(), 2);

  delete process.env.BACKFILL_RECOVERY_ALERT_MIN_ATTEMPTS;
  assert.equal(getBackfillRecoveryAlertMinAttempts(), 2);
});

// ---------------------------------------------------------------------------
// Payload shape — the alert must include trigger, attempt count, last error
// ---------------------------------------------------------------------------

test('recovery alerts surface trigger, attempt count, and the last attempt error to the notifier', async () => {
  const { notifyBackfillResult, setBackfillNotifier } = await import(
    '../src/services/backfill-notifier.ts'
  );

  let captured: IBackfillRun | null = null;
  let capturedReason: string | null = null;
  setBackfillNotifier((run, reason) => {
    captured = run;
    capturedReason = reason;
  });

  await notifyBackfillResult(
    makeRun({
      trigger: 'cron:weekly',
      status: 'completed',
      attempts: attempts(2, 'radio-browser 504'),
    }),
  );

  assert.ok(captured, 'notifier should have been called');
  assert.equal(capturedReason, 'recovered');
  const run = captured as unknown as IBackfillRun;
  assert.equal(run.trigger, 'cron:weekly');
  assert.equal(run.attempts?.length, 2);
  assert.equal(
    run.attempts?.[run.attempts.length - 1]?.error,
    'radio-browser 504',
    'notifier must have access to the last failure message',
  );
});

// ---------------------------------------------------------------------------
// Robustness
// ---------------------------------------------------------------------------

test('a notifier that throws is caught — notifyBackfillResult never rejects', async () => {
  const { notifyBackfillResult, setBackfillNotifier } = await import(
    '../src/services/backfill-notifier.ts'
  );

  setBackfillNotifier(() => {
    throw new Error('alert channel exploded');
  });

  await assert.doesNotReject(
    notifyBackfillResult(
      makeRun({ status: 'failed', attempts: attempts(3), errorMessage: 'x' }),
    ),
  );
  await assert.doesNotReject(
    notifyBackfillResult(makeRun({ status: 'completed', attempts: attempts(2) })),
  );
});

test('null run is a no-op (no notifier invocation, no throw)', async () => {
  const { notifyBackfillResult, setBackfillNotifier } = await import(
    '../src/services/backfill-notifier.ts'
  );

  let called = 0;
  setBackfillNotifier(() => {
    called += 1;
  });

  await notifyBackfillResult(null);
  assert.equal(called, 0);
});
