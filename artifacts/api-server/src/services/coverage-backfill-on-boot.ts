/**
 * First-deploy auto-seeder for `coveragesnapshots` (Task #176).
 *
 * The nightly cron in `scheduled-coverage-snapshot.ts` only writes today's
 * row, and the historical seeder in `scripts/backfill-coverage-snapshots.ts`
 * has to be invoked manually after deploy. If a team member forgets, the
 * admin coverage page shows an empty 30-day sparkline for the first month.
 *
 * This module wires the seeder into the boot path so the first-deploy
 * experience is self-healing:
 *
 *   - On every API boot we count how many distinct historical UTC days
 *     already have at least one snapshot row (excluding today, which the
 *     cron handles).
 *   - If the count is below `MIN_HISTORICAL_DAYS`, we kick the seeder off
 *     in the background — fire-and-forget so it never blocks the boot
 *     handshake or the rest of the background-task chain.
 *   - If the count is at or above the threshold, we skip with a clear log
 *     line so admins can tell the difference between "ran" and "wasn't
 *     needed".
 *
 * Idempotence: the underlying seeder uses `$setOnInsert` keyed on
 * (countryCode, snapshotDate) so re-running it never overwrites real
 * cron-written rows. Even so, the day-count gate prevents the seeder
 * from being re-run on every restart once the collection has been seeded.
 *
 * Status visibility (Task #232): every decision and outcome is also
 * persisted into the singleton `coveragebackfillstatuses` doc so the
 * admin coverage page can show the last boot-backfill outcome without
 * forcing admins to grep stdout.
 *
 * Safety knobs:
 *   - `SKIP_COVERAGE_BACKFILL_ON_BOOT=true` short-circuits this entirely.
 *     Useful for split deployments where only one replica should run it,
 *     or for manual operational control after a partial seed.
 *   - `COVERAGE_BACKFILL_BOOT_MIN_DAYS` overrides the threshold (default 7).
 *   - `COVERAGE_BACKFILL_BOOT_DAYS` overrides how many days back to seed
 *     (default 30, matching the admin sparkline window).
 */

import mongoose from 'mongoose';
import {
  CoverageSnapshot,
  CoverageBackfillStatus,
  CoverageBackfillRun,
  type CoverageBackfillBootOutcome,
} from '@workspace/db-shared/mongo-schemas';
import { logger } from '../utils/logger';
import { runCoverageBackfill } from '../scripts/backfill-coverage-snapshots';

const DEFAULT_MIN_HISTORICAL_DAYS = 7;
const DEFAULT_BACKFILL_DAYS = 30;
// Cap on how many past boot evaluations we keep in
// `coveragebackfillruns` (Task #316). The history is meant for spotting
// silent regressions across the last few deploys, not as a long-term
// audit log — keeping it small keeps reads/UI rendering trivial and
// prevents the collection from growing unbounded on long-lived nodes.
const HISTORY_MAX = 20;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return fallback;
  return n;
}

function todayUtcMidnight(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

let hasRunOnce = false;

// In-process guard so an admin who rapid-fires the "Run backfill now"
// button doesn't kick off two seeders at once on the same node. The
// underlying `$setOnInsert` upserts are idempotent, but the seeder
// walks every day × every country once per run and we'd rather not
// double the load (and double-write the boot status doc) for nothing.
let manualRunInFlight = false;

/**
 * Persist the latest boot-backfill outcome into the singleton status doc
 * so the admin coverage page can read it. Best-effort — a write failure
 * here must never crash boot or hide the real seeder result.
 */
// All optional fields on the status doc. Listed centrally so each
// `recordStatus` call clears the ones it doesn't supply via `$unset` —
// otherwise a previous outcome's fields (e.g. `error` from a `failed`
// run, or `inserted`/`preserved` counters from a previous `done` run)
// would linger on the singleton doc and the admin UI would show stale
// counters/error text under the new outcome.
const OPTIONAL_STATUS_FIELDS = [
  'startedAt',
  'finishedAt',
  'durationMs',
  'thresholdDays',
  'historicalDayCount',
  'seedDays',
  'daysSeeded',
  'inserted',
  'preserved',
  'error',
] as const;

type OptionalStatusFields = Partial<{
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  thresholdDays: number;
  historicalDayCount: number;
  seedDays: number;
  daysSeeded: number;
  inserted: number;
  preserved: number;
  error: string;
}>;

async function recordStatus(
  outcome: CoverageBackfillBootOutcome,
  message: string,
  fields: OptionalStatusFields = {},
): Promise<void> {
  try {
    const now = new Date();
    const setOps: Record<string, unknown> = {
      key: 'latest',
      outcome,
      message,
      observedAt: now,
      updatedAt: now,
    };
    const unsetOps: Record<string, ''> = {};
    for (const name of OPTIONAL_STATUS_FIELDS) {
      const value = (fields as Record<string, unknown>)[name];
      if (value !== undefined) {
        setOps[name] = value;
      } else {
        unsetOps[name] = '';
      }
    }
    const update: Record<string, unknown> = { $set: setOps };
    if (Object.keys(unsetOps).length > 0) {
      update.$unset = unsetOps;
    }
    await CoverageBackfillStatus.updateOne(
      { key: 'latest' },
      update,
      { upsert: true },
    );
  } catch (err: any) {
    logger.warn(
      `⚠️  Coverage boot backfill: status write failed (${outcome}): ${err?.message || err}`,
    );
  }

  // Task #316: also append to the bounded history collection so admins
  // can see past boot evaluations under the latest status. We skip the
  // transient `running` state — it would create two rows per boot
  // (running + terminal) and the singleton already shows it in real
  // time. After insert we prune oldest rows beyond `HISTORY_MAX` so
  // the collection can't grow unbounded on a long-lived node.
  if (outcome === 'running') {
    return;
  }
  try {
    const now = new Date();
    const historyDoc: Record<string, unknown> = {
      outcome,
      message,
      observedAt: now,
    };
    for (const name of OPTIONAL_STATUS_FIELDS) {
      const value = (fields as Record<string, unknown>)[name];
      if (value !== undefined) {
        historyDoc[name] = value;
      }
    }
    await CoverageBackfillRun.create(historyDoc);
    // Prune anything older than the most recent HISTORY_MAX rows.
    // findOne on the boundary index is cheap; deleteMany of a tail is
    // bounded so this never grows in cost over time.
    // Strict top-N prune: pick the boundary row at position HISTORY_MAX
    // (0-indexed) and delete everything strictly older. The _id
    // tie-break in the delete clause ensures rows with identical
    // `observedAt` ticks (possible when several recordStatus calls land
    // in the same millisecond) are pruned deterministically rather than
    // all kept, so the collection stays at exactly HISTORY_MAX rows.
    const boundary = await CoverageBackfillRun.findOne({})
      .sort({ observedAt: -1, _id: -1 })
      .skip(HISTORY_MAX)
      .select({ observedAt: 1, _id: 1 })
      .lean<{ observedAt: Date; _id: mongoose.Types.ObjectId } | null>();
    if (boundary) {
      await CoverageBackfillRun.deleteMany({
        $or: [
          { observedAt: { $lt: boundary.observedAt } },
          {
            observedAt: boundary.observedAt,
            _id: { $lte: boundary._id },
          },
        ],
      });
    }
  } catch (err: any) {
    logger.warn(
      `⚠️  Coverage boot backfill: history write failed (${outcome}): ${err?.message || err}`,
    );
  }
}

/**
 * Decide whether to run the historical coverage backfill, and if so kick
 * it off in the background. Safe to call multiple times — the in-process
 * `hasRunOnce` guard combined with the row-count check prevents re-runs
 * on the same node, and `$setOnInsert` prevents cross-replica clobbering.
 *
 * Never throws — boot must continue regardless of seeder outcome.
 */
export async function maybeRunCoverageBackfillOnBoot(): Promise<void> {
  if (hasRunOnce) {
    return;
  }
  hasRunOnce = true;

  if (process.env.SKIP_COVERAGE_BACKFILL_ON_BOOT === 'true') {
    const msg = 'Skipped on this boot: SKIP_COVERAGE_BACKFILL_ON_BOOT=true';
    logger.log(`📈 Coverage boot backfill: SKIPPED (${msg})`);
    await recordStatus('skipped-env', msg);
    return;
  }

  const minDays = parsePositiveInt(
    process.env.COVERAGE_BACKFILL_BOOT_MIN_DAYS,
    DEFAULT_MIN_HISTORICAL_DAYS,
  );
  const seedDays = parsePositiveInt(
    process.env.COVERAGE_BACKFILL_BOOT_DAYS,
    DEFAULT_BACKFILL_DAYS,
  );

  let historicalDayCount: number;
  try {
    const distinctDays = await CoverageSnapshot.distinct('snapshotDate', {
      snapshotDate: { $lt: todayUtcMidnight() },
    });
    historicalDayCount = Array.isArray(distinctDays) ? distinctDays.length : 0;
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    logger.warn(
      `⚠️  Coverage boot backfill: SKIPPED — could not count historical days: ${errMsg}`,
    );
    await recordStatus(
      'skipped-count-error',
      `Could not count existing historical snapshots: ${errMsg}`,
      { thresholdDays: minDays, seedDays, error: errMsg },
    );
    return;
  }

  if (historicalDayCount >= minDays) {
    const msg = `${historicalDayCount} historical day(s) already present (threshold ${minDays}); seeder not needed`;
    logger.log(
      `📈 Coverage boot backfill: SKIPPED (${historicalDayCount} historical day(s) already present, threshold=${minDays})`,
    );
    await recordStatus('skipped-already-seeded', msg, {
      thresholdDays: minDays,
      historicalDayCount,
      seedDays,
    });
    return;
  }

  const startedAt = new Date();
  logger.log(
    `📈 Coverage boot backfill: STARTING (only ${historicalDayCount} historical day(s) found, threshold=${minDays}) — seeding ${seedDays} days in background`,
  );
  await recordStatus(
    'running',
    `Seeding ${seedDays} day(s) of historical coverage in the background (only ${historicalDayCount} day(s) already present, threshold ${minDays}).`,
    {
      startedAt,
      thresholdDays: minDays,
      historicalDayCount,
      seedDays,
    },
  );

  // Fire-and-forget. The seeder iterates day-by-day and aggregates the
  // entire stations collection per day, so for a seed run with millions
  // of stations this can take a minute or two — we don't want it to
  // block boot. Errors are swallowed (logged) so a regression here
  // can't crash the API.
  runCoverageBackfill({ days: seedDays, dryRun: false })
    .then(async (res) => {
      const finishedAt = new Date();
      const durationMs = finishedAt.getTime() - startedAt.getTime();
      if (res.skippedReason === 'no-stations') {
        logger.log(
          '📈 Coverage boot backfill: DONE — stations collection empty, nothing seeded',
        );
        await recordStatus(
          'done-no-stations',
          'Stations collection was empty — nothing to reconstruct.',
          {
            startedAt,
            finishedAt,
            durationMs,
            thresholdDays: minDays,
            historicalDayCount,
            seedDays,
            daysSeeded: 0,
            inserted: 0,
            preserved: 0,
          },
        );
        return;
      }
      logger.log(
        `📈 Coverage boot backfill: DONE — daysSeeded=${res.daysSeeded} inserted=${res.inserted} preserved=${res.preserved}`,
      );
      await recordStatus(
        'done',
        `Seeded ${res.daysSeeded} day(s); inserted ${res.inserted} row(s), preserved ${res.preserved} pre-existing row(s).`,
        {
          startedAt,
          finishedAt,
          durationMs,
          thresholdDays: minDays,
          historicalDayCount,
          seedDays,
          daysSeeded: res.daysSeeded,
          inserted: res.inserted,
          preserved: res.preserved,
        },
      );
    })
    .catch(async (err: any) => {
      const finishedAt = new Date();
      const durationMs = finishedAt.getTime() - startedAt.getTime();
      const errMsg = err?.message || String(err);
      logger.error(`❌ Coverage boot backfill: FAILED — ${errMsg}`);
      await recordStatus('failed', `Backfill failed: ${errMsg}`, {
        startedAt,
        finishedAt,
        durationMs,
        thresholdDays: minDays,
        historicalDayCount,
        seedDays,
        error: errMsg,
      });
    });
}

export type RunCoverageBackfillNowResult =
  | { kind: 'started'; seedDays: number; startedAt: string }
  | { kind: 'busy' }
  | {
      kind: 'dry-run';
      seedDays: number;
      daysSeeded: number;
      wouldWrite: number;
      skippedReason?: 'no-stations';
    };

/**
 * Admin-triggered re-run of the historical coverage seeder (Task #315).
 *
 * Mirrors the boot path: writes the singleton status doc through the same
 * 'running' → 'done' / 'done-no-stations' / 'failed' lifecycle so the
 * existing "Sparkline data — first-deploy backfill" card on the admin
 * coverage page reflects progress without needing a separate UI surface.
 *
 * Differences from `maybeRunCoverageBackfillOnBoot`:
 *   - Bypasses the `SKIP_COVERAGE_BACKFILL_ON_BOOT` env gate and the
 *     historical-day-count threshold; the admin pressing the button has
 *     already opted in.
 *   - Bypasses the in-process `hasRunOnce` boot guard (a separate
 *     `manualRunInFlight` lock prevents concurrent manual runs only).
 *   - Honours `dryRun`, in which case it runs synchronously, returns the
 *     would-write counters inline, and never touches the persisted
 *     status doc — we don't want to overwrite real boot history with a
 *     "done — 0 inserted" line that's actually a dry run.
 */
export async function runCoverageBackfillNow(opts: {
  days?: number;
  dryRun?: boolean;
}): Promise<RunCoverageBackfillNowResult> {
  const seedDays = parsePositiveInt(
    opts.days != null ? String(opts.days) : undefined,
    DEFAULT_BACKFILL_DAYS,
  );
  const dryRun = !!opts.dryRun;

  if (dryRun) {
    // Run synchronously — dry runs don't write to Mongo and finish
    // quickly enough that the admin can wait for the response. Keeps
    // the boot-status doc untouched so the card still shows the real
    // last run.
    logger.log(
      `📈 Coverage manual backfill (dry-run): days=${seedDays}`,
    );
    const res = await runCoverageBackfill({ days: seedDays, dryRun: true });
    return {
      kind: 'dry-run',
      seedDays,
      daysSeeded: res.daysSeeded,
      wouldWrite: res.wouldWrite,
      skippedReason: res.skippedReason,
    };
  }

  if (manualRunInFlight) {
    return { kind: 'busy' };
  }
  manualRunInFlight = true;

  let historicalDayCount: number;
  try {
    const distinctDays = await CoverageSnapshot.distinct('snapshotDate', {
      snapshotDate: { $lt: todayUtcMidnight() },
    });
    historicalDayCount = Array.isArray(distinctDays) ? distinctDays.length : 0;
  } catch {
    historicalDayCount = 0;
  }

  const startedAt = new Date();
  logger.log(
    `📈 Coverage manual backfill: STARTING (admin-triggered) — seeding ${seedDays} day(s) in background`,
  );
  await recordStatus(
    'running',
    `Admin-triggered: seeding ${seedDays} day(s) of historical coverage in the background.`,
    {
      startedAt,
      seedDays,
      historicalDayCount,
    },
  );

  // Fire-and-forget like the boot path. The admin UI polls the
  // backfill-status endpoint every 5s while `outcome === 'running'`
  // and flips to the terminal state automatically.
  runCoverageBackfill({ days: seedDays, dryRun: false })
    .then(async (res) => {
      const finishedAt = new Date();
      const durationMs = finishedAt.getTime() - startedAt.getTime();
      if (res.skippedReason === 'no-stations') {
        logger.log(
          '📈 Coverage manual backfill: DONE — stations collection empty, nothing seeded',
        );
        await recordStatus(
          'done-no-stations',
          'Stations collection was empty — nothing to reconstruct.',
          {
            startedAt,
            finishedAt,
            durationMs,
            seedDays,
            historicalDayCount,
            daysSeeded: 0,
            inserted: 0,
            preserved: 0,
          },
        );
        return;
      }
      logger.log(
        `📈 Coverage manual backfill: DONE — daysSeeded=${res.daysSeeded} inserted=${res.inserted} preserved=${res.preserved}`,
      );
      await recordStatus(
        'done',
        `Admin-triggered: seeded ${res.daysSeeded} day(s); inserted ${res.inserted} row(s), preserved ${res.preserved} pre-existing row(s).`,
        {
          startedAt,
          finishedAt,
          durationMs,
          seedDays,
          historicalDayCount,
          daysSeeded: res.daysSeeded,
          inserted: res.inserted,
          preserved: res.preserved,
        },
      );
    })
    .catch(async (err: any) => {
      const finishedAt = new Date();
      const durationMs = finishedAt.getTime() - startedAt.getTime();
      const errMsg = err?.message || String(err);
      logger.error(`❌ Coverage manual backfill: FAILED — ${errMsg}`);
      await recordStatus('failed', `Admin-triggered backfill failed: ${errMsg}`, {
        startedAt,
        finishedAt,
        durationMs,
        seedDays,
        historicalDayCount,
        error: errMsg,
      });
    })
    .finally(() => {
      manualRunInFlight = false;
    });

  return {
    kind: 'started',
    seedDays,
    startedAt: startedAt.toISOString(),
  };
}
