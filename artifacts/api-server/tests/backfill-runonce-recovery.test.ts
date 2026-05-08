/**
 * Integration-style regression test for the recovery-alert wiring on
 * `scheduledBackfill.runOnce()` (Task #302).
 *
 * The notifier itself already has unit coverage in
 * `backfill-notifier.test.ts`, but nothing currently asserts that the
 * call site inside `executeSweep()` actually invokes the notifier on
 * the success path after a retry. If a future refactor of
 * `scheduled-backfill.ts` accidentally drops the `notifyBackfillResult`
 * call on completion, all the unit tests still pass — the recovery
 * alert just silently disappears in production.
 *
 * This test mirrors the integration-style runOnce() coverage already
 * in `genre-slug-cleanup-notifier.test.ts`. We:
 *
 *   - mock `@workspace/db-shared/mongo-schemas` so `Station`,
 *     `BackfillRun`, and `AdminSetting` don't touch a real Mongo,
 *   - mock `./sync` so the first attempt's tag-hydration call throws
 *     and the second succeeds,
 *   - drop `BACKFILL_RETRY_BASE_MS` to 0 so the retry backoff doesn't
 *     stretch the test runtime,
 *   - drive a real `runOnce()` and assert the run ends in
 *     `status='completed'` with a populated `attempts[]`,
 *   - assert the injected backfill notifier was invoked exactly once
 *     with reason `'recovered'`.
 */
import { test, mock, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Env knobs — must be in place BEFORE importing scheduled-backfill, since
// BACKFILL_RETRY_BASE_MS / BACKFILL_MAX_ATTEMPTS are read at module load.
// ---------------------------------------------------------------------------
const ORIGINAL_RETRY_BASE = process.env.BACKFILL_RETRY_BASE_MS;
const ORIGINAL_MAX_ATTEMPTS = process.env.BACKFILL_MAX_ATTEMPTS;
const ORIGINAL_WEBHOOK = process.env.BACKFILL_ALERT_WEBHOOK_URL;
// `BACKFILL_RETRY_BASE_MS` uses `parseInt(...) || 60_000`, so `'0'` would
// fall through to the 60s default — use `'1'` to keep the backoff
// effectively zero without tripping that fallback.
process.env.BACKFILL_RETRY_BASE_MS = '1';
process.env.BACKFILL_MAX_ATTEMPTS = '5';
delete process.env.BACKFILL_ALERT_WEBHOOK_URL;

// ---------------------------------------------------------------------------
// Mock @workspace/db-shared/mongo-schemas — only the bits scheduled-backfill
// touches. Everything else can stay undefined.
// ---------------------------------------------------------------------------
interface FakeBackfillAttempt {
  attempt: number;
  error: string;
  failedAt: Date;
}

interface FakeBackfillRunDoc {
  _id: string;
  trigger: string;
  status: 'running' | 'completed' | 'failed';
  topN: number;
  overrideCountry?: string;
  startedAt: Date;
  finishedAt?: Date;
  durationMs?: number;
  errorMessage?: string;
  logos: Array<Record<string, unknown>>;
  tags: Array<Record<string, unknown>>;
  attempts?: FakeBackfillAttempt[];
  save: () => Promise<void>;
}

const createdRuns: FakeBackfillRunDoc[] = [];

const FakeBackfillRun = {
  create: async (input: Partial<FakeBackfillRunDoc>): Promise<FakeBackfillRunDoc> => {
    const doc: FakeBackfillRunDoc = {
      _id: `run-${createdRuns.length + 1}`,
      trigger: input.trigger ?? 'manual',
      status: (input.status ?? 'running') as FakeBackfillRunDoc['status'],
      topN: input.topN ?? 5,
      overrideCountry: input.overrideCountry,
      startedAt: input.startedAt ?? new Date(),
      logos: input.logos ?? [],
      tags: input.tags ?? [],
      save: async () => {},
    };
    createdRuns.push(doc);
    return doc;
  },
  findById: async (id: string): Promise<FakeBackfillRunDoc | null> => {
    return createdRuns.find((r) => r._id === id) ?? null;
  },
  // Used by pruneOldBackfillRuns(); make it a no-op so retention doesn't
  // explode in this test.
  deleteMany: async () => ({ deletedCount: 0 }),
  find: () => ({
    sort: () => ({
      skip: () => ({
        limit: () => ({
          select: () => ({
            lean: async () => null,
          }),
        }),
      }),
    }),
  }),
};

// Station: only the aggregate / countDocuments / find / updateMany shapes
// scheduled-backfill calls. Returning empty/zero everywhere is fine — we're
// not asserting on candidate totals here, only on retry + notifier wiring.
//
// `aggregateImpl` is hot-swappable so the test can fail the first attempt's
// top-offender lookup (which `performSweep` lets bubble up as an
// infrastructure-level retryable error) and let the second attempt
// succeed. Per-country errors inside the logo/tag loops get swallowed by
// design, so we can't drive the retry path from `SyncService` failures.
let aggregateImpl: () => Promise<Array<{ _id: string; count: number }>> = async () => [
  { _id: 'TR', count: 10 },
];
const FakeStation = {
  aggregate: async () => aggregateImpl(),
  countDocuments: async () => 5,
  find: () => ({
    select: () => ({
      limit: () => ({
        lean: async () => [] as unknown[],
      }),
    }),
  }),
  updateMany: async () => ({ modifiedCount: 5 }),
};

const FakeAdminSetting = {
  findOne: () => ({ lean: async () => null }),
};

mock.module('@workspace/db-shared/mongo-schemas', {
  namedExports: {
    Station: FakeStation,
    BackfillRun: FakeBackfillRun,
    AdminSetting: FakeAdminSetting,
  },
});

// ---------------------------------------------------------------------------
// Mock ./sync — keep the hydrator successful and silent. Retry behaviour
// in this test is driven from the Mongo aggregation layer (see
// `aggregateImpl` above) because per-country hydrate errors are swallowed
// inside `performSweep`.
// ---------------------------------------------------------------------------
class FakeSyncService {
  async hydrateMissingTagsInBackground(_args: { countryCode: string; limit?: number }) {
    return { processed: 10, hydrated: 8, emptyUpstream: 1, failed: 1 };
  }
}

mock.module(new URL('../src/services/sync.ts', import.meta.url).href, {
  namedExports: {
    SyncService: FakeSyncService,
  },
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
before(() => {
  // Reaffirm — the module-mock setup above already cleared this, but be
  // defensive in case another test file ran before us in-process.
  delete process.env.BACKFILL_ALERT_WEBHOOK_URL;
});

after(() => {
  if (ORIGINAL_RETRY_BASE === undefined) delete process.env.BACKFILL_RETRY_BASE_MS;
  else process.env.BACKFILL_RETRY_BASE_MS = ORIGINAL_RETRY_BASE;
  if (ORIGINAL_MAX_ATTEMPTS === undefined) delete process.env.BACKFILL_MAX_ATTEMPTS;
  else process.env.BACKFILL_MAX_ATTEMPTS = ORIGINAL_MAX_ATTEMPTS;
  if (ORIGINAL_WEBHOOK === undefined) delete process.env.BACKFILL_ALERT_WEBHOOK_URL;
  else process.env.BACKFILL_ALERT_WEBHOOK_URL = ORIGINAL_WEBHOOK;
});

afterEach(async () => {
  const { setBackfillNotifier } = await import('../src/services/backfill-notifier.ts');
  setBackfillNotifier(null);
  createdRuns.length = 0;
  aggregateImpl = async () => [{ _id: 'TR', count: 10 }];
});

// ---------------------------------------------------------------------------
// The actual integration test.
// ---------------------------------------------------------------------------
test('runOnce() retries a failed sweep and fires the recovery alert when it eventually completes', async () => {
  const { setBackfillNotifier } = await import('../src/services/backfill-notifier.ts');
  const { scheduledBackfill } = await import('../src/services/scheduled-backfill.ts');

  // Fail the first two attempts' top-offender aggregations (an
  // infrastructure-level error that `performSweep` re-throws), then
  // succeed on the third. This is the "transient Mongo / upstream
  // blip clears on retry" scenario the recovery alert was built for.
  // We need >= `BACKFILL_RECOVERY_ALERT_MIN_ATTEMPTS` (default 2)
  // failed attempts on a completed run to fire the recovery alert,
  // so a single retry would stay silent and not exercise the wiring.
  // `performSweep` calls `topCountriesByFilter` twice per attempt
  // (logos + tags in parallel), so each attempt consumes 2 aggregate
  // calls — fail the first 4 calls, succeed afterwards.
  let aggregateCalls = 0;
  aggregateImpl = async () => {
    aggregateCalls += 1;
    if (aggregateCalls <= 4) {
      throw new Error('radio-browser 504');
    }
    return [{ _id: 'TR', count: 10 }];
  };

  const calls: Array<{ reason: string; status: string; attempts: number; lastError?: string }> = [];
  setBackfillNotifier((run, reason) => {
    const attempts = run.attempts ?? [];
    calls.push({
      reason,
      status: run.status,
      attempts: attempts.length,
      lastError: attempts[attempts.length - 1]?.error,
    });
  });

  const run = await scheduledBackfill.runOnce('test:recovery');

  assert.ok(run, 'runOnce should return the persisted run doc');
  assert.equal(run.status, 'completed', 'sweep should complete after the retry');
  assert.ok(Array.isArray(run.attempts), 'attempts[] must be populated');
  assert.equal(run.attempts!.length, 2, 'two failed attempts should be recorded before recovery');
  assert.equal(run.attempts![0].attempt, 1);
  assert.equal(run.attempts![0].error, 'radio-browser 504');
  assert.equal(run.attempts![1].attempt, 2);
  assert.equal(run.attempts![1].error, 'radio-browser 504');

  assert.equal(calls.length, 1, 'notifier should fire exactly once on completion');
  assert.equal(calls[0].reason, 'recovered', 'reason must be "recovered" for a retried-but-completed run');
  assert.equal(calls[0].status, 'completed');
  assert.equal(calls[0].attempts, 2);
  assert.equal(
    calls[0].lastError,
    'radio-browser 504',
    'notifier payload must surface the last attempt error',
  );
});
