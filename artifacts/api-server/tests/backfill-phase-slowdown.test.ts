/**
 * Regression tests for the per-phase slowdown alert (Task #311).
 *
 * Even on a successful weekly backfill, the cron should compare each
 * per-country phase `durationMs` against the median of recent runs
 * for the same country/phase. When a phase exceeds a configurable
 * multiplier (default 3x), it fires the existing backfill notifier
 * with reason `phase-slowdown`. Repeated minor wobble (under the
 * multiplier, or below the baseline floor) stays silent.
 *
 * These tests lock in:
 *   - phases above the multiplier produce a slowdown row
 *   - phases below the multiplier stay silent
 *   - too few historical samples → no alert (don't page on a fresh market)
 *   - baseline below the floor → no alert (sub-second phases ignored)
 *   - multiplier / lookback / min-samples / min-baseline env knobs honoured
 *   - notifyBackfillPhaseSlowdowns surfaces the per-phase payload
 *   - empty slowdowns list is a no-op
 *
 * Runner: `--experimental-test-module-mocks` (wired up in
 * artifacts/api-server/package.json#scripts.test).
 */
import { test, mock, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import type {
  IBackfillRun,
  IBackfillRunCountryLogos,
  IBackfillRunCountryTags,
} from '@workspace/db-shared/mongo-schemas';

// ---------------------------------------------------------------------------
// Recording fake for BackfillRun.find().sort().limit().select().lean().
// ---------------------------------------------------------------------------

type HistoryRow = {
  _id: unknown;
  logos?: Array<{ countryCode?: string; durationMs?: number }>;
  tags?: Array<{ countryCode?: string; durationMs?: number }>;
};

let historyRows: HistoryRow[] = [];
let lastFindFilter: unknown = null;
let lastLimit = 0;

function chainable(rows: HistoryRow[]) {
  const q = {
    sort: () => q,
    limit: (n: number) => {
      lastLimit = n;
      return q;
    },
    select: () => q,
    lean: async () => rows,
  };
  return q;
}

const FakeBackfillRun = {
  find: (filter: unknown) => {
    lastFindFilter = filter;
    return chainable(historyRows);
  },
};

mock.module('@workspace/db-shared/mongo-schemas', {
  namedExports: {
    BackfillRun: FakeBackfillRun,
    Station: {},
    AdminSetting: {},
  },
});

// SyncService is imported by scheduled-backfill.ts but the slowdown
// detector never touches it. Stub to a no-op class so the module
// graph resolves under the mock.
mock.module(new URL('../src/services/sync.ts', import.meta.url).href, {
  namedExports: {
    SyncService: class {},
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRun(
  logos: Partial<IBackfillRunCountryLogos>[] = [],
  tags: Partial<IBackfillRunCountryTags>[] = [],
  overrides: Partial<IBackfillRun> = {},
): IBackfillRun {
  const base = {
    _id: 'current-run' as unknown,
    trigger: 'cron:weekly',
    status: 'completed' as 'running' | 'completed' | 'failed',
    topN: 5,
    startedAt: new Date('2026-01-08T04:00:00Z'),
    finishedAt: new Date('2026-01-08T04:10:00Z'),
    durationMs: 600_000,
    logos: logos.map((l) => ({
      candidates: 0,
      enqueued: 0,
      ...l,
      countryCode: l.countryCode!,
    })) as IBackfillRunCountryLogos[],
    tags: tags.map((t) => ({
      processed: 0,
      hydrated: 0,
      emptyUpstream: 0,
      failed: 0,
      ...t,
      countryCode: t.countryCode!,
    })) as IBackfillRunCountryTags[],
    attempts: [],
  };
  return { ...base, ...overrides } as unknown as IBackfillRun;
}

function historyOf(samples: Array<{ logos?: Array<[string, number]>; tags?: Array<[string, number]> }>): HistoryRow[] {
  return samples.map((s, i) => ({
    _id: `hist-${i}`,
    logos: (s.logos ?? []).map(([countryCode, durationMs]) => ({ countryCode, durationMs })),
    tags: (s.tags ?? []).map(([countryCode, durationMs]) => ({ countryCode, durationMs })),
  }));
}

const ENV_KEYS = [
  'BACKFILL_PHASE_SLOWDOWN_MULTIPLIER',
  'BACKFILL_PHASE_SLOWDOWN_LOOKBACK',
  'BACKFILL_PHASE_SLOWDOWN_MIN_SAMPLES',
  'BACKFILL_PHASE_SLOWDOWN_MIN_BASELINE_MS',
  'BACKFILL_ALERT_WEBHOOK_URL',
] as const;
const originalEnv: Record<string, string | undefined> = {};

before(() => {
  for (const k of ENV_KEYS) originalEnv[k] = process.env[k];
  delete process.env.BACKFILL_ALERT_WEBHOOK_URL;
});

after(() => {
  for (const k of ENV_KEYS) {
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
});

afterEach(async () => {
  for (const k of ENV_KEYS) delete process.env[k];
  historyRows = [];
  lastFindFilter = null;
  lastLimit = 0;
  const { setBackfillNotifier } = await import('../src/services/backfill-notifier.ts');
  setBackfillNotifier(null);
});

// ---------------------------------------------------------------------------
// detectBackfillPhaseSlowdowns — happy path
// ---------------------------------------------------------------------------

test('flags a phase that ran 3x slower than the recent median', async () => {
  const { detectBackfillPhaseSlowdowns } = await import(
    '../src/services/scheduled-backfill.ts'
  );

  // Baseline: DE tag-hydration ~30s. Today's run: 5 minutes.
  historyRows = historyOf([
    { tags: [['DE', 30_000]] },
    { tags: [['DE', 28_000]] },
    { tags: [['DE', 32_000]] },
    { tags: [['DE', 31_000]] },
  ]);

  const run = makeRun(
    [],
    [{ countryCode: 'DE', durationMs: 300_000 }],
  );
  const slowdowns = await detectBackfillPhaseSlowdowns(run);

  assert.equal(slowdowns.length, 1);
  assert.equal(slowdowns[0].countryCode, 'DE');
  assert.equal(slowdowns[0].phase, 'tags');
  assert.equal(slowdowns[0].durationMs, 300_000);
  assert.ok(slowdowns[0].baselineMs >= 28_000 && slowdowns[0].baselineMs <= 32_000);
  assert.ok(slowdowns[0].multiplier >= 3);
  assert.equal(slowdowns[0].sampleSize, 4);
});

test('does not flag a phase that is only mildly slower than the baseline', async () => {
  const { detectBackfillPhaseSlowdowns } = await import(
    '../src/services/scheduled-backfill.ts'
  );

  historyRows = historyOf([
    { tags: [['DE', 30_000]] },
    { tags: [['DE', 30_000]] },
    { tags: [['DE', 30_000]] },
  ]);

  const run = makeRun([], [{ countryCode: 'DE', durationMs: 60_000 }]); // 2x, below default 3x
  const slowdowns = await detectBackfillPhaseSlowdowns(run);
  assert.equal(slowdowns.length, 0);
});

test('skips countries with too few historical samples', async () => {
  const { detectBackfillPhaseSlowdowns } = await import(
    '../src/services/scheduled-backfill.ts'
  );

  // Only 2 samples — below default min of 3. A brand-new country
  // shouldn't be allowed to page on the second-ever run just because
  // the first one happened to be quick.
  historyRows = historyOf([
    { logos: [['XX', 1_000]] },
    { logos: [['XX', 1_500]] },
  ]);

  const run = makeRun([{ countryCode: 'XX', durationMs: 100_000 }], []);
  const slowdowns = await detectBackfillPhaseSlowdowns(run);
  assert.equal(slowdowns.length, 0);
});

test('skips phases whose baseline is below the noise floor', async () => {
  const { detectBackfillPhaseSlowdowns } = await import(
    '../src/services/scheduled-backfill.ts'
  );

  // Baseline of ~50ms. Even a 10x jump (500ms) is operationally
  // boring and shouldn't page anyone.
  historyRows = historyOf([
    { logos: [['NL', 50]] },
    { logos: [['NL', 60]] },
    { logos: [['NL', 40]] },
  ]);

  const run = makeRun([{ countryCode: 'NL', durationMs: 500 }], []);
  const slowdowns = await detectBackfillPhaseSlowdowns(run);
  assert.equal(slowdowns.length, 0);
});

test('only counts samples for the same country AND phase', async () => {
  const { detectBackfillPhaseSlowdowns } = await import(
    '../src/services/scheduled-backfill.ts'
  );

  // Plenty of LOGO samples for DE, but no historical TAG samples for DE.
  // A slow current DE tag-hydration must not borrow the logo baseline.
  historyRows = historyOf([
    { logos: [['DE', 30_000]] },
    { logos: [['DE', 30_000]] },
    { logos: [['DE', 30_000]] },
    { logos: [['DE', 30_000]] },
  ]);

  const run = makeRun([], [{ countryCode: 'DE', durationMs: 300_000 }]);
  const slowdowns = await detectBackfillPhaseSlowdowns(run);
  assert.equal(slowdowns.length, 0);
});

test('excludes the current run from the historical query', async () => {
  const { detectBackfillPhaseSlowdowns } = await import(
    '../src/services/scheduled-backfill.ts'
  );

  historyRows = historyOf([
    { tags: [['DE', 30_000]] },
    { tags: [['DE', 30_000]] },
    { tags: [['DE', 30_000]] },
  ]);

  await detectBackfillPhaseSlowdowns(
    makeRun([], [{ countryCode: 'DE', durationMs: 1 }], { _id: 'today' as unknown }),
  );

  const filter = lastFindFilter as { _id?: { $ne?: unknown }; status?: string } | null;
  assert.ok(filter, 'find should have been called');
  assert.equal(filter.status, 'completed');
  assert.equal(filter._id?.$ne, 'today');
});

// ---------------------------------------------------------------------------
// Env knobs
// ---------------------------------------------------------------------------

test('BACKFILL_PHASE_SLOWDOWN_MULTIPLIER tightens / loosens the trigger', async () => {
  const { detectBackfillPhaseSlowdowns } = await import(
    '../src/services/scheduled-backfill.ts'
  );

  historyRows = historyOf([
    { tags: [['DE', 30_000]] },
    { tags: [['DE', 30_000]] },
    { tags: [['DE', 30_000]] },
  ]);
  const run = makeRun([], [{ countryCode: 'DE', durationMs: 60_000 }]); // exactly 2x

  process.env.BACKFILL_PHASE_SLOWDOWN_MULTIPLIER = '5';
  assert.equal((await detectBackfillPhaseSlowdowns(run)).length, 0);

  process.env.BACKFILL_PHASE_SLOWDOWN_MULTIPLIER = '2';
  const slow = await detectBackfillPhaseSlowdowns(run);
  assert.equal(slow.length, 1);
  assert.equal(slow[0].countryCode, 'DE');
});

test('BACKFILL_PHASE_SLOWDOWN_LOOKBACK is forwarded to the Mongo query', async () => {
  const { detectBackfillPhaseSlowdowns } = await import(
    '../src/services/scheduled-backfill.ts'
  );

  process.env.BACKFILL_PHASE_SLOWDOWN_LOOKBACK = '25';
  historyRows = []; // empty result is fine; we only care about the limit arg
  await detectBackfillPhaseSlowdowns(
    makeRun([], [{ countryCode: 'DE', durationMs: 99 }]),
  );
  assert.equal(lastLimit, 25);
});

test('BACKFILL_PHASE_SLOWDOWN_MIN_SAMPLES raises the floor for new markets', async () => {
  const { detectBackfillPhaseSlowdowns } = await import(
    '../src/services/scheduled-backfill.ts'
  );

  historyRows = historyOf([
    { tags: [['DE', 30_000]] },
    { tags: [['DE', 30_000]] },
    { tags: [['DE', 30_000]] },
  ]);
  const run = makeRun([], [{ countryCode: 'DE', durationMs: 300_000 }]);

  process.env.BACKFILL_PHASE_SLOWDOWN_MIN_SAMPLES = '5';
  assert.equal((await detectBackfillPhaseSlowdowns(run)).length, 0);

  process.env.BACKFILL_PHASE_SLOWDOWN_MIN_SAMPLES = '1';
  assert.equal((await detectBackfillPhaseSlowdowns(run)).length, 1);
});

test('BACKFILL_PHASE_SLOWDOWN_MIN_BASELINE_MS gates the noise floor', async () => {
  const { detectBackfillPhaseSlowdowns } = await import(
    '../src/services/scheduled-backfill.ts'
  );

  historyRows = historyOf([
    { logos: [['NL', 100]] },
    { logos: [['NL', 100]] },
    { logos: [['NL', 100]] },
  ]);
  const run = makeRun([{ countryCode: 'NL', durationMs: 1_000 }], []);

  process.env.BACKFILL_PHASE_SLOWDOWN_MIN_BASELINE_MS = '5000';
  assert.equal((await detectBackfillPhaseSlowdowns(run)).length, 0);

  process.env.BACKFILL_PHASE_SLOWDOWN_MIN_BASELINE_MS = '0';
  assert.equal((await detectBackfillPhaseSlowdowns(run)).length, 1);
});

// ---------------------------------------------------------------------------
// Notifier integration
// ---------------------------------------------------------------------------

test('notifyBackfillPhaseSlowdowns forwards the slowdowns payload to the notifier', async () => {
  const { notifyBackfillPhaseSlowdowns, setBackfillNotifier } = await import(
    '../src/services/backfill-notifier.ts'
  );

  let captured: { reason: string; slowdowns: unknown } | null = null;
  setBackfillNotifier((_run, reason, ctx) => {
    captured = { reason, slowdowns: ctx?.slowdowns };
  });

  await notifyBackfillPhaseSlowdowns(makeRun(), [
    {
      countryCode: 'DE',
      phase: 'tags',
      durationMs: 300_000,
      baselineMs: 30_000,
      multiplier: 10,
      sampleSize: 4,
    },
  ]);

  assert.ok(captured, 'notifier should have been called');
  assert.equal(captured!.reason, 'phase-slowdown');
  assert.deepEqual(captured!.slowdowns, [
    {
      countryCode: 'DE',
      phase: 'tags',
      durationMs: 300_000,
      baselineMs: 30_000,
      multiplier: 10,
      sampleSize: 4,
    },
  ]);
});

test('notifyBackfillPhaseSlowdowns is a no-op for an empty slowdowns list', async () => {
  const { notifyBackfillPhaseSlowdowns, setBackfillNotifier } = await import(
    '../src/services/backfill-notifier.ts'
  );

  let called = 0;
  setBackfillNotifier(() => {
    called += 1;
  });

  await notifyBackfillPhaseSlowdowns(makeRun(), []);
  await notifyBackfillPhaseSlowdowns(null, [
    {
      countryCode: 'DE',
      phase: 'tags',
      durationMs: 1,
      baselineMs: 1,
      multiplier: 1,
      sampleSize: 1,
    },
  ]);
  assert.equal(called, 0);
});

test('a notifier that throws on phase-slowdown does not bubble out', async () => {
  const { notifyBackfillPhaseSlowdowns, setBackfillNotifier } = await import(
    '../src/services/backfill-notifier.ts'
  );

  setBackfillNotifier(() => {
    throw new Error('alert channel exploded');
  });

  await assert.doesNotReject(
    notifyBackfillPhaseSlowdowns(makeRun(), [
      {
        countryCode: 'DE',
        phase: 'tags',
        durationMs: 300_000,
        baselineMs: 30_000,
        multiplier: 10,
        sampleSize: 4,
      },
    ]),
  );
});

test('env getters fall back to defaults on garbage input', async () => {
  const {
    getBackfillPhaseSlowdownMultiplier,
    getBackfillPhaseSlowdownLookback,
    getBackfillPhaseSlowdownMinSamples,
    getBackfillPhaseSlowdownMinBaselineMs,
  } = await import('../src/services/backfill-notifier.ts');

  process.env.BACKFILL_PHASE_SLOWDOWN_MULTIPLIER = 'nope';
  process.env.BACKFILL_PHASE_SLOWDOWN_LOOKBACK = '-3';
  process.env.BACKFILL_PHASE_SLOWDOWN_MIN_SAMPLES = '0';
  process.env.BACKFILL_PHASE_SLOWDOWN_MIN_BASELINE_MS = 'nope';

  assert.equal(getBackfillPhaseSlowdownMultiplier(), 3);
  assert.equal(getBackfillPhaseSlowdownLookback(), 10);
  assert.equal(getBackfillPhaseSlowdownMinSamples(), 3);
  assert.equal(getBackfillPhaseSlowdownMinBaselineMs(), 5000);

  // A multiplier of exactly 1 is meaningless (every run trivially
  // hits 1x its own median), so it must also fall back.
  process.env.BACKFILL_PHASE_SLOWDOWN_MULTIPLIER = '1';
  assert.equal(getBackfillPhaseSlowdownMultiplier(), 3);

  // But fractional multipliers > 1 are accepted.
  process.env.BACKFILL_PHASE_SLOWDOWN_MULTIPLIER = '1.5';
  assert.equal(getBackfillPhaseSlowdownMultiplier(), 1.5);
});
