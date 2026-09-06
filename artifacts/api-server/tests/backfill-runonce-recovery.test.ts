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
 *   - use an isolated PostgreSQL schema for the real audit and lock stores,
 *   - inject transient catalog lookup failures and keep external hydration mocked,
 *   - drop `BACKFILL_RETRY_BASE_MS` to 0 so the retry backoff doesn't
 *     stretch the test runtime,
 *   - drive a real `runOnce()` and assert the run ends in
 *     `status='completed'` with a populated `attempts[]`,
 *   - assert the injected backfill notifier was invoked exactly once
 *     with reason `'recovered'`.
 */
import { test, mock, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  createNativePostgresFixture,
  type NativePostgresFixture,
} from "./helpers/native-postgres-fixture";
import { pgCatalog } from "../src/data/postgres-catalog-store";
import { PostgresCoverageStore } from "../src/data/postgres-coverage-store";
let fixture: NativePostgresFixture;

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
process.env.BACKFILL_RETRY_BASE_MS = "1";
process.env.BACKFILL_MAX_ATTEMPTS = "5";
delete process.env.BACKFILL_ALERT_WEBHOOK_URL;

// Inject only the transient catalog lookup fault. Audit persistence, retry state,
// advisory locking and retention execute the real PostgreSQL implementation.
let aggregateImpl: () => Promise<
  Array<{ _id: string; count: number }>
> = async () => [{ _id: "TR", count: 10 }];

// ---------------------------------------------------------------------------
// Mock ./sync — keep the hydrator successful and silent. Retry behaviour
// in this test is driven from the catalog SQL boundary (see
// `aggregateImpl` above) because per-country hydrate errors are swallowed
// inside `performSweep`.
// ---------------------------------------------------------------------------
class FakeSyncService {
  async hydrateMissingTagsInBackground(_args: {
    countryCode: string;
    limit?: number;
  }) {
    return { processed: 10, hydrated: 8, emptyUpstream: 1, failed: 1 };
  }
}

mock.module(new URL("../src/services/sync.ts", import.meta.url).href, {
  namedExports: {
    SyncService: FakeSyncService,
  },
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
before(async () => {
  fixture = await createNativePostgresFixture("backfill-recovery");
  const acquireJob = PostgresCoverageStore.prototype.acquireJob;
  // Advisory locks are database-wide, while parallel fixtures use schemas.
  mock.method(
    PostgresCoverageStore.prototype,
    "acquireJob",
    function (name: string) {
      return acquireJob.call(this, `${fixture.schema}:${name}`);
    },
  );
  mock.method(pgCatalog(), "groupCount", async () => aggregateImpl());
  // Reaffirm — the module-mock setup above already cleared this, but be
  // defensive in case another test file ran before us in-process.
  delete process.env.BACKFILL_ALERT_WEBHOOK_URL;
});

after(async () => {
  mock.restoreAll();
  await fixture?.close();
  if (ORIGINAL_RETRY_BASE === undefined)
    delete process.env.BACKFILL_RETRY_BASE_MS;
  else process.env.BACKFILL_RETRY_BASE_MS = ORIGINAL_RETRY_BASE;
  if (ORIGINAL_MAX_ATTEMPTS === undefined)
    delete process.env.BACKFILL_MAX_ATTEMPTS;
  else process.env.BACKFILL_MAX_ATTEMPTS = ORIGINAL_MAX_ATTEMPTS;
  if (ORIGINAL_WEBHOOK === undefined)
    delete process.env.BACKFILL_ALERT_WEBHOOK_URL;
  else process.env.BACKFILL_ALERT_WEBHOOK_URL = ORIGINAL_WEBHOOK;
});

afterEach(async () => {
  const { setBackfillNotifier } =
    await import("../src/services/backfill-notifier.ts");
  setBackfillNotifier(null);
  aggregateImpl = async () => [{ _id: "TR", count: 10 }];
});

// ---------------------------------------------------------------------------
// The actual integration test.
// ---------------------------------------------------------------------------
test("runOnce() retries a failed sweep and fires the recovery alert when it eventually completes", async () => {
  const { setBackfillNotifier } =
    await import("../src/services/backfill-notifier.ts");
  const { scheduledBackfill } =
    await import("../src/services/scheduled-backfill.ts");

  // Fail the first two attempts' top-offender aggregations (an
  // infrastructure-level error that `performSweep` re-throws), then
  // succeed on the third. This is the "transient database / upstream
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
      throw new Error("radio-browser 504");
    }
    return [{ _id: "TR", count: 10 }];
  };

  const calls: Array<{
    reason: string;
    status: string;
    attempts: number;
    lastError?: string;
  }> = [];
  setBackfillNotifier((run, reason) => {
    const attempts = run.attempts ?? [];
    calls.push({
      reason,
      status: run.status,
      attempts: attempts.length,
      lastError: attempts[attempts.length - 1]?.error,
    });
  });

  const run = await scheduledBackfill.runOnce("test:recovery");

  assert.ok(run, "runOnce should return the persisted run doc");
  const stored = (
    await fixture.pool.query(
      "SELECT status,attempts FROM backfill_runs WHERE id=$1",
      [run._id],
    )
  ).rows[0];
  assert.equal(stored.status, "completed");
  assert.equal(
    stored.attempts.length,
    2,
    "retry history must survive in PostgreSQL",
  );
  assert.equal(
    run.status,
    "completed",
    "sweep should complete after the retry",
  );
  assert.ok(Array.isArray(run.attempts), "attempts[] must be populated");
  assert.equal(
    run.attempts!.length,
    2,
    "two failed attempts should be recorded before recovery",
  );
  assert.equal(run.attempts![0].attempt, 1);
  assert.equal(run.attempts![0].error, "radio-browser 504");
  assert.equal(run.attempts![1].attempt, 2);
  assert.equal(run.attempts![1].error, "radio-browser 504");

  assert.equal(
    calls.length,
    1,
    "notifier should fire exactly once on completion",
  );
  assert.equal(
    calls[0].reason,
    "recovered",
    'reason must be "recovered" for a retried-but-completed run',
  );
  assert.equal(calls[0].status, "completed");
  assert.equal(calls[0].attempts, 2);
  assert.equal(
    calls[0].lastError,
    "radio-browser 504",
    "notifier payload must surface the last attempt error",
  );
});
