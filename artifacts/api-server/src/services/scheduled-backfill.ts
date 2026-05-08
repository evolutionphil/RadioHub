import cron from 'node-cron';
import {
  Station,
  BackfillRun,
  AdminSetting,
  type IBackfillRun,
  type IBackfillRunSampleStation,
} from '@workspace/db-shared/mongo-schemas';
import { SyncService } from './sync';
import { logger } from '../utils/logger';
import {
  notifyBackfillResult,
  notifyBackfillPhaseSlowdowns,
  getBackfillPhaseSlowdownLookback,
  getBackfillPhaseSlowdownMinSamples,
  getBackfillPhaseSlowdownMultiplier,
  getBackfillPhaseSlowdownMinBaselineMs,
  type BackfillPhaseSlowdown,
  type BackfillPhase,
} from './backfill-notifier';

/**
 * Weekly cross-country backfill that mirrors the per-country
 * `backfill-tr-logos.ts` / `backfill-tr-tags.ts` scripts (Task #50) but
 * picks the top-N worst countries automatically and persists a summary
 * row per run, so admins don't have to re-run the scripts by hand every
 * time Search Console flags a market.
 *
 * - Logo enqueue: same `$or` filter as `scheduled-logo-processor.runOnce`
 *   and `backfill-tr-logos.ts` (`http_error` / `invalid_format` are
 *   excluded — those are dead source URLs and re-enqueueing them just
 *   churns).
 * - Tag hydration: delegates to
 *   `SyncService.hydrateMissingTagsInBackground({ countryCode })` so the
 *   call pattern, retry posture, and 30-day `tagsCheckedAt` cooldown
 *   stay byte-identical to the manual script.
 *
 * The manual scripts continue to work as one-shot escape hatches and now
 * delegate to the same helpers exposed here.
 */
export const STALE_PROCESSING_MS = 60 * 60 * 1000; // 1h: matches cron
export const TAGS_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000; // 30d: matches sync

// Bounded auto-retry for transient failures (Mongo hiccup, upstream
// radio-browser timeout, etc). Most weekly failures clear on a second
// attempt a few minutes later, so we retry before paging the team.
// Overridable via env so ops can tune without a redeploy and tests can
// drop the backoff to ~zero.
export const BACKFILL_MAX_ATTEMPTS: number = Math.max(
  1,
  Number.parseInt(process.env.BACKFILL_MAX_ATTEMPTS ?? '', 10) || 3,
);
export const BACKFILL_RETRY_BASE_MS: number = Math.max(
  0,
  Number.parseInt(process.env.BACKFILL_RETRY_BASE_MS ?? '', 10) || 60_000,
);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Retention policy for the BackfillRun collection (Task #180). Without
// this the collection grows unbounded — one row per weekly cron + every
// admin-triggered manual run — which would balloon the dashboard query
// over time. We keep the most recent rows up to either bound and drop
// the rest after every sweep finishes:
//   - rows older than the resolved days threshold (default 90 days), AND
//   - anything beyond the newest N rows (default 200) regardless of age.
// "Older than 90d" is the soft floor — operationally we only need ~3
// months of history to spot a regression — and the 200-row cap is the
// hard ceiling so a burst of manual triggers can't blow the budget.
//
// Resolution order (Task #233): admin-tunable AdminSetting doc → env
// var → built-in default. The DB layer is added so admins can adjust
// retention from the SEO maintenance UI without asking ops to set
// BACKFILL_RETENTION_* and redeploy. Env vars remain a fallback for
// existing deployments.
export const BACKFILL_RETENTION_DAYS_DEFAULT = 90;
export const BACKFILL_RETENTION_MAX_ROWS_DEFAULT = 200;
export const BACKFILL_RETENTION_DAYS_MIN = 1;
export const BACKFILL_RETENTION_DAYS_MAX = 3650;
export const BACKFILL_RETENTION_MAX_ROWS_MIN = 10;
export const BACKFILL_RETENTION_MAX_ROWS_MAX = 100_000;
export const BACKFILL_RETENTION_SETTINGS_KEY = 'backfill-retention';
const RETENTION_CACHE_TTL_MS = 30_000;

export interface BackfillRetentionSettings {
  days: number | null;
  maxRows: number | null;
}

export interface ResolvedBackfillRetention {
  days: number;
  maxRows: number;
  source: {
    days: 'db' | 'env' | 'default';
    maxRows: 'db' | 'env' | 'default';
  };
}

function envBackfillRetentionDays(): { value: number; source: 'env' | 'default' } {
  const raw = Number.parseInt(process.env.BACKFILL_RETENTION_DAYS ?? '', 10);
  if (Number.isFinite(raw) && raw >= BACKFILL_RETENTION_DAYS_MIN) {
    return { value: Math.min(raw, BACKFILL_RETENTION_DAYS_MAX), source: 'env' };
  }
  return { value: BACKFILL_RETENTION_DAYS_DEFAULT, source: 'default' };
}

function envBackfillRetentionMaxRows(): { value: number; source: 'env' | 'default' } {
  const raw = Number.parseInt(process.env.BACKFILL_RETENTION_MAX_ROWS ?? '', 10);
  if (Number.isFinite(raw) && raw >= BACKFILL_RETENTION_MAX_ROWS_MIN) {
    return { value: Math.min(raw, BACKFILL_RETENTION_MAX_ROWS_MAX), source: 'env' };
  }
  return { value: BACKFILL_RETENTION_MAX_ROWS_DEFAULT, source: 'default' };
}

// Back-compat exports — preserve the original env-resolved constants so
// existing imports keep working. New callers should prefer
// `resolveBackfillRetentionSettings()` which honours the DB override.
export const BACKFILL_RETENTION_DAYS: number = envBackfillRetentionDays().value;
export const BACKFILL_RETENTION_MAX_ROWS: number = envBackfillRetentionMaxRows().value;

function sanitizeStoredRetention(value: unknown): BackfillRetentionSettings {
  const out: BackfillRetentionSettings = { days: null, maxRows: null };
  if (!value || typeof value !== 'object') return out;
  const v = value as Record<string, unknown>;
  if (
    typeof v.days === 'number' &&
    Number.isFinite(v.days) &&
    v.days >= BACKFILL_RETENTION_DAYS_MIN
  ) {
    out.days = Math.min(Math.floor(v.days), BACKFILL_RETENTION_DAYS_MAX);
  }
  if (
    typeof v.maxRows === 'number' &&
    Number.isFinite(v.maxRows) &&
    v.maxRows >= BACKFILL_RETENTION_MAX_ROWS_MIN
  ) {
    out.maxRows = Math.min(Math.floor(v.maxRows), BACKFILL_RETENTION_MAX_ROWS_MAX);
  }
  return out;
}

let retentionCache: { at: number; value: BackfillRetentionSettings } | null = null;

export function invalidateBackfillRetentionCache(): void {
  retentionCache = null;
}

export async function loadStoredBackfillRetentionSettings(
  opts: { bypassCache?: boolean } = {},
): Promise<BackfillRetentionSettings> {
  if (
    !opts.bypassCache &&
    retentionCache &&
    Date.now() - retentionCache.at < RETENTION_CACHE_TTL_MS
  ) {
    return retentionCache.value;
  }
  try {
    const doc = await AdminSetting.findOne({ key: BACKFILL_RETENTION_SETTINGS_KEY }).lean();
    const value = sanitizeStoredRetention(doc?.value);
    retentionCache = { at: Date.now(), value };
    return value;
  } catch (err) {
    logger.warn(
      '⚠️  Failed to load backfill-retention settings from DB, using env/defaults:',
      err,
    );
    const value: BackfillRetentionSettings = { days: null, maxRows: null };
    retentionCache = { at: Date.now(), value };
    return value;
  }
}

export async function resolveBackfillRetentionSettings(): Promise<ResolvedBackfillRetention> {
  const stored = await loadStoredBackfillRetentionSettings();
  const envD = envBackfillRetentionDays();
  const envM = envBackfillRetentionMaxRows();
  return {
    days: stored.days ?? envD.value,
    maxRows: stored.maxRows ?? envM.value,
    source: {
      days: stored.days != null ? 'db' : envD.source,
      maxRows: stored.maxRows != null ? 'db' : envM.source,
    },
  };
}

export function getDefaultBackfillRetention(): { days: number; maxRows: number } {
  return {
    days: BACKFILL_RETENTION_DAYS_DEFAULT,
    maxRows: BACKFILL_RETENTION_MAX_ROWS_DEFAULT,
  };
}

export function getEnvBackfillRetention(): {
  days: { value: number; source: 'env' | 'default' };
  maxRows: { value: number; source: 'env' | 'default' };
} {
  return {
    days: envBackfillRetentionDays(),
    maxRows: envBackfillRetentionMaxRows(),
  };
}

// How many sample station ids/slugs to persist per country per phase
// (Task #234). Capped so a single BackfillRun row stays well under
// Mongo's 16MB limit even for the worst markets.
export const BACKFILL_SAMPLE_STATIONS_PER_COUNTRY: number = Math.max(
  0,
  Number.parseInt(process.env.BACKFILL_SAMPLE_STATIONS_PER_COUNTRY ?? '', 10) || 50,
);

async function sampleStationsForFilter(
  filter: Record<string, unknown>,
): Promise<IBackfillRunSampleStation[]> {
  if (BACKFILL_SAMPLE_STATIONS_PER_COUNTRY <= 0) return [];
  try {
    type Row = { _id: unknown; slug?: string; name?: string };
    const rows = (await Station.find(filter)
      .select('_id slug name')
      .limit(BACKFILL_SAMPLE_STATIONS_PER_COUNTRY)
      .lean()) as unknown as Row[];
    return rows.map((r) => ({
      _id: String(r._id),
      slug: typeof r.slug === 'string' && r.slug ? r.slug : undefined,
      name: typeof r.name === 'string' && r.name ? r.name : undefined,
    }));
  } catch (err) {
    logger.warn('⚠️  sampleStationsForFilter failed (non-fatal):', err);
    return [];
  }
}

/**
 * Drop BackfillRun rows that fall outside the retention window. Best-
 * effort: any error is logged and swallowed so a transient Mongo blip
 * never poisons the sweep that just finished.
 *
 * Two passes:
 *   1. Delete rows older than `BACKFILL_RETENTION_DAYS`.
 *   2. Find the `startedAt` of the Nth-newest row (where N =
 *      `BACKFILL_RETENTION_MAX_ROWS`) and delete anything strictly
 *      older than that. This caps total row count even if the time
 *      bound alone would let more through (e.g. heavy manual usage in
 *      a short window).
 */
export async function pruneOldBackfillRuns(): Promise<{ removed: number }> {
  let removed = 0;
  try {
    // Resolve at sweep time so admin-tunable overrides (Task #233) take
    // effect on the next prune without a redeploy.
    const { days, maxRows } = await resolveBackfillRetentionSettings();
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const byAge = await BackfillRun.deleteMany({ startedAt: { $lt: cutoff } });
    removed += byAge.deletedCount ?? 0;

    const pivotDoc = await BackfillRun.find()
      .sort({ startedAt: -1 })
      .skip(maxRows - 1)
      .limit(1)
      .select({ startedAt: 1 })
      .lean<{ startedAt: Date } | null>();
    if (pivotDoc?.startedAt) {
      const byCount = await BackfillRun.deleteMany({
        startedAt: { $lt: pivotDoc.startedAt },
      });
      removed += byCount.deletedCount ?? 0;
    }
    if (removed > 0) {
      logger.log(`🧹 Pruned ${removed} old BackfillRun row(s) (retention: ${days}d / ${maxRows} rows)`);
    }
  } catch (err) {
    logger.warn('⚠️  pruneOldBackfillRuns failed (non-fatal):', err);
  }
  return { removed };
}

export function buildLogoBackfillFilter(
  countryCode?: string,
): Record<string, unknown> {
  const stalePivot = new Date(Date.now() - STALE_PROCESSING_MS);
  const filter: Record<string, unknown> = {
    favicon: { $exists: true, $nin: ['', null, 'null'] },
    slug: { $exists: true, $ne: null },
    $or: [
      { logoAssets: { $exists: false } },
      { 'logoAssets.status': { $exists: false } },
      { 'logoAssets.status': 'pending' },
      {
        'logoAssets.status': 'failed',
        'logoAssets.failureType': { $nin: ['http_error', 'invalid_format'] },
      },
      {
        'logoAssets.status': 'failed',
        'logoAssets.failureType': { $exists: false },
      },
      {
        'logoAssets.status': 'processing',
        $or: [
          { 'logoAssets.lastAttempt': { $lt: stalePivot } },
          { 'logoAssets.lastAttempt': { $exists: false }, 'logoAssets.processedAt': { $lt: stalePivot } },
          { 'logoAssets.lastAttempt': { $exists: false }, 'logoAssets.processedAt': { $exists: false } },
        ],
      },
    ],
  };
  if (countryCode) {
    filter.countryCode = countryCode.toUpperCase();
  }
  return filter;
}

export function buildTagsBackfillFilter(
  countryCode?: string,
): Record<string, unknown> {
  const cooldownCutoff = new Date(Date.now() - TAGS_COOLDOWN_MS);
  const filter: Record<string, unknown> = {
    stationuuid: { $exists: true, $nin: [null, ''] },
    $or: [
      { tags: { $exists: false } },
      { tags: null },
      { tags: '' },
    ],
    $and: [
      {
        $or: [
          { tagsCheckedAt: { $exists: false } },
          { tagsCheckedAt: null },
          { tagsCheckedAt: { $lt: cooldownCutoff } },
        ],
      },
    ],
  };
  if (countryCode) {
    filter.countryCode = countryCode.toUpperCase();
  }
  return filter;
}

/**
 * Enqueue every station in `countryCode` (or globally, if undefined) that
 * matches the logo-backfill filter back into the
 * scheduled-logo-processor pipeline by `$unset`-ing `logoAssets`.
 *
 * Idempotent: completed/permanent-failed rows are excluded by the filter
 * so re-running is a no-op.
 */
export async function enqueueLogosForCountry(
  countryCode: string,
): Promise<{ candidates: number; enqueued: number; sampleStations: IBackfillRunSampleStation[] }> {
  const filter = buildLogoBackfillFilter(countryCode);
  const candidates = await Station.countDocuments(filter);
  if (candidates === 0) return { candidates: 0, enqueued: 0, sampleStations: [] };
  // Snapshot the head of the candidate set BEFORE the $unset so admins
  // can click into specific touched stations from the run detail page.
  // Captured pre-update because the $unset removes the very fields the
  // filter matches on, so re-querying afterwards would return nothing.
  const sampleStations = await sampleStationsForFilter(filter);
  const result = await Station.updateMany(filter, { $unset: { logoAssets: '' } });
  return { candidates, enqueued: result.modifiedCount ?? 0, sampleStations };
}

interface CountryCount {
  countryCode: string;
  count: number;
}

async function topCountriesByFilter(
  filter: Record<string, unknown>,
  topN: number,
): Promise<CountryCount[]> {
  const rows = await Station.aggregate<{ _id: string | null; count: number }>([
    { $match: filter },
    { $group: { _id: '$countryCode', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: topN * 2 + 5 }, // over-fetch so we can drop blanks
  ]);
  return rows
    .filter((r) => r._id && typeof r._id === 'string' && r._id.trim().length === 2)
    .slice(0, topN)
    .map((r) => ({ countryCode: r._id as string, count: r.count }));
}

/**
 * Compute the median of a list of numbers. Caller is responsible for
 * filtering out non-finite values; we just sort + pick the middle.
 */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

/**
 * Inspect the just-finished run for per-country phases that ran
 * dramatically slower than the median of recent completed runs for
 * the same country/phase (Task #311). The weekly cron already
 * persists per-country `durationMs` for both the logo-enqueue and
 * tag-hydration phases (Task #235); this just compares the latest
 * row against the historical baseline so a phase that jumps from
 * 30s→8m surfaces automatically instead of waiting for an admin to
 * eyeball the run detail page.
 *
 * Tunables are env-overridable via the same module that owns the
 * other alert thresholds (`backfill-notifier.ts`):
 *   - lookback window (how many recent completed runs to consider)
 *   - minimum sample size (don't alert on a brand-new market)
 *   - minimum baseline duration (ignore sub-second phases)
 *   - multiplier (e.g. 3x median)
 *
 * Returns an empty array on any error — slowdown detection is a
 * nice-to-have signal, never something that should fail the run
 * that just completed successfully.
 */
export async function detectBackfillPhaseSlowdowns(
  currentRun: IBackfillRun,
): Promise<BackfillPhaseSlowdown[]> {
  const multiplier = getBackfillPhaseSlowdownMultiplier();
  const lookback = getBackfillPhaseSlowdownLookback();
  const minSamples = getBackfillPhaseSlowdownMinSamples();
  const minBaseline = getBackfillPhaseSlowdownMinBaselineMs();

  // Collect (country, phase) pairs the current run actually measured.
  // Skip entries with no durationMs — older rows might not have it.
  const targets: Array<{ countryCode: string; phase: BackfillPhase; durationMs: number }> = [];
  for (const l of currentRun.logos) {
    if (typeof l.durationMs === 'number' && l.durationMs > 0 && l.countryCode) {
      targets.push({ countryCode: l.countryCode, phase: 'logos', durationMs: l.durationMs });
    }
  }
  for (const t of currentRun.tags) {
    if (typeof t.durationMs === 'number' && t.durationMs > 0 && t.countryCode) {
      targets.push({ countryCode: t.countryCode, phase: 'tags', durationMs: t.durationMs });
    }
  }
  if (targets.length === 0) return [];

  try {
    // One Mongo query: pull the recent completed runs once, then
    // bucket their per-country phase timings client-side. Cheaper
    // than an aggregation per (country, phase) target on top of a
    // collection capped at a few hundred rows by the retention sweep.
    type HistoryRow = {
      _id: unknown;
      logos?: Array<{ countryCode?: string; durationMs?: number }>;
      tags?: Array<{ countryCode?: string; durationMs?: number }>;
    };
    const history = (await BackfillRun.find({
      status: 'completed',
      _id: { $ne: currentRun._id },
    })
      .sort({ startedAt: -1 })
      .limit(lookback)
      .select({ logos: 1, tags: 1 })
      .lean()) as unknown as HistoryRow[];

    if (history.length === 0) return [];

    // Build baseline samples per (country, phase).
    const baselines = new Map<string, number[]>();
    const key = (cc: string, phase: BackfillPhase) => `${phase}:${cc}`;
    for (const row of history) {
      for (const l of row.logos ?? []) {
        if (typeof l.durationMs === 'number' && l.durationMs > 0 && l.countryCode) {
          const k = key(l.countryCode, 'logos');
          const arr = baselines.get(k) ?? [];
          arr.push(l.durationMs);
          baselines.set(k, arr);
        }
      }
      for (const t of row.tags ?? []) {
        if (typeof t.durationMs === 'number' && t.durationMs > 0 && t.countryCode) {
          const k = key(t.countryCode, 'tags');
          const arr = baselines.get(k) ?? [];
          arr.push(t.durationMs);
          baselines.set(k, arr);
        }
      }
    }

    const slowdowns: BackfillPhaseSlowdown[] = [];
    for (const target of targets) {
      const samples = baselines.get(key(target.countryCode, target.phase)) ?? [];
      if (samples.length < minSamples) continue;
      const baseline = median(samples);
      if (baseline < minBaseline) continue;
      const observedMultiplier = target.durationMs / baseline;
      if (observedMultiplier >= multiplier) {
        slowdowns.push({
          countryCode: target.countryCode,
          phase: target.phase,
          durationMs: target.durationMs,
          baselineMs: Math.round(baseline),
          multiplier: Math.round(observedMultiplier * 100) / 100,
          sampleSize: samples.length,
        });
      }
    }
    return slowdowns;
  } catch (err) {
    logger.warn('⚠️  detectBackfillPhaseSlowdowns failed (non-fatal):', err);
    return [];
  }
}

class ScheduledBackfillService {
  private static instance: ScheduledBackfillService;
  private isInitialized = false;
  private isRunning = false;
  private lastRunAt: Date | null = null;
  private lastRunId: string | null = null;

  // Tunables — kept conservative so the weekly job can run alongside live
  // traffic and the nightly logo cron without trampling either.
  private readonly TOP_N = 5;
  private readonly TAGS_LIMIT_PER_COUNTRY = 2000;

  static getInstance(): ScheduledBackfillService {
    if (!ScheduledBackfillService.instance) {
      ScheduledBackfillService.instance = new ScheduledBackfillService();
    }
    return ScheduledBackfillService.instance;
  }

  initialize(): void {
    if (this.isInitialized) {
      logger.log('🗓️  Scheduled backfill already initialized');
      return;
    }

    // Same single-process gate as the logo cron (see
    // scheduled-logo-processor.ts) — set ENABLE_BACKFILL_CRON=false on
    // replicas that shouldn't run it.
    if (process.env.ENABLE_BACKFILL_CRON === 'false') {
      this.isInitialized = true;
      logger.log('🗓️  Scheduled backfill DISABLED (ENABLE_BACKFILL_CRON=false)');
      return;
    }

    this.isInitialized = true;

    // Sundays 04:00 Europe/Berlin — after the nightly logo processor
    // (02:00) and junk cleanup (03:30) have settled, so the candidate
    // counts reflect what actually drained that week.
    cron.schedule(
      '0 4 * * 0',
      () => {
        this.runOnce('cron:weekly').catch((err) => {
          logger.error('❌ Weekly backfill cron crashed:', err);
        });
      },
      { timezone: 'Europe/Berlin' },
    );

    logger.log('🗓️  Scheduled backfill initialized (Sun 04:00 Europe/Berlin, top-5 countries)');
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      lastRunAt: this.lastRunAt,
      lastRunId: this.lastRunId,
    };
  }

  /**
   * Runs one full sweep: pick the top-N worst countries by logo-missing
   * and tags-missing counts, enqueue logos for each and hydrate tags for
   * each, then persist a summary row. Single-instance lock — concurrent
   * calls return silently.
   *
   * Awaits the entire sweep before returning. Used by the weekly cron.
   * For interactive triggers (admin button) prefer `start()` which
   * persists the BackfillRun row immediately and runs the work in the
   * background so the HTTP response doesn't block on a multi-minute job.
   */
  async runOnce(
    trigger: string = 'manual',
    options: { countryCode?: string } = {},
  ): Promise<IBackfillRun | null> {
    const run = await this.start(trigger, options);
    if (!run) return null;
    // Wait for the in-flight sweep to drain so callers (like the cron)
    // can log a single completion line. `start()` already kicked off the
    // background work, so we just poll the lock.
    while (this.isRunning) {
      await new Promise((r) => setTimeout(r, 250));
    }
    // Re-read so we get the final status / counts the worker persisted.
    return BackfillRun.findById(run._id);
  }

  /**
   * Persist a `running` BackfillRun row, kick off the sweep in the
   * background, and return the row immediately. Honours the same
   * single-instance lock as `runOnce` — returns null if a sweep is
   * already in progress.
   */
  async start(
    trigger: string = 'manual',
    options: { countryCode?: string } = {},
  ): Promise<IBackfillRun | null> {
    if (this.isRunning) {
      logger.log(`⏭️  Scheduled backfill: skip (${trigger}) — previous run still in progress`);
      return null;
    }
    this.isRunning = true;
    const startedAt = new Date();

    const overrideCountry = options.countryCode
      ? options.countryCode.trim().toUpperCase()
      : undefined;
    // Single-country override still records `topN` for schema parity, but
    // the sweep itself only touches one market — see `executeSweep`.
    const effectiveTopN = overrideCountry ? 1 : this.TOP_N;

    const run = await BackfillRun.create({
      trigger,
      status: 'running',
      topN: effectiveTopN,
      overrideCountry,
      startedAt,
      logos: [],
      tags: [],
    });
    this.lastRunId = String(run._id);

    logger.log(
      overrideCountry
        ? `🗓️  Scheduled backfill START (${trigger}, country=${overrideCountry})`
        : `🗓️  Scheduled backfill START (${trigger}, top-${this.TOP_N})`,
    );

    // Fire-and-forget the actual sweep so callers get the row back
    // immediately. The lock is released inside the worker's finally.
    this.executeSweep(run, startedAt, overrideCountry).catch((err) => {
      logger.error('❌ Scheduled backfill worker crashed:', err);
    });
    return run;
  }

  /**
   * Convenience wrapper for triggering a single-country sweep.
   * Reuses `enqueueLogosForCountry` + `SyncService.hydrateMissingTagsInBackground`
   * via the same `start()` path the cron uses, so behaviour stays consistent.
   */
  async runForCountry(
    countryCode: string,
    trigger: string = 'manual',
  ): Promise<IBackfillRun | null> {
    return this.start(trigger, { countryCode });
  }

  private async executeSweep(
    run: IBackfillRun,
    startedAt: Date,
    overrideCountry?: string,
  ): Promise<void> {
    try {
      let lastError: unknown;
      for (let attempt = 1; attempt <= BACKFILL_MAX_ATTEMPTS; attempt++) {
        // Reset per-attempt accumulators so a partial run from the
        // previous attempt doesn't leak into the next try's totals.
        run.logos.splice(0, run.logos.length);
        run.tags.splice(0, run.tags.length);
        try {
          await this.performSweep(run, overrideCountry);
          lastError = undefined;
          break;
        } catch (err) {
          lastError = err;
          const message = err instanceof Error ? err.message : String(err);
          run.attempts = run.attempts ?? [];
          run.attempts.push({ attempt, error: message, failedAt: new Date() });
          if (attempt < BACKFILL_MAX_ATTEMPTS) {
            const backoff = BACKFILL_RETRY_BASE_MS * attempt;
            logger.warn(
              `⏳ Scheduled backfill attempt ${attempt}/${BACKFILL_MAX_ATTEMPTS} failed (${message}); retrying in ${Math.round(backoff / 1000)}s`,
            );
            // Persist the in-progress attempts so dashboards can show
            // "retrying…" while we sleep through backoff.
            try { await run.save(); } catch { /* best-effort */ }
            await sleep(backoff);
          } else {
            logger.error(
              `❌ Scheduled backfill exhausted ${BACKFILL_MAX_ATTEMPTS} attempts (last error: ${message})`,
            );
          }
        }
      }

      const finishedAt = new Date();
      if (lastError === undefined) {
        run.status = 'completed';
        run.finishedAt = finishedAt;
        run.durationMs = finishedAt.getTime() - startedAt.getTime();
        await run.save();
        this.lastRunAt = finishedAt;
        const retryNote = (run.attempts && run.attempts.length > 0)
          ? ` (recovered after ${run.attempts.length} failed attempt${run.attempts.length === 1 ? '' : 's'})`
          : '';
        logger.log(
          `🗓️  Scheduled backfill DONE in ${Math.round(run.durationMs / 1000)}s — ${run.logos.length} logo countries, ${run.tags.length} tag countries${retryNote}`,
        );
        // Recovery alert (Task #224): if the run only completed after
        // multiple retries, surface it proactively so the team can get
        // ahead of upstream flakiness before it turns into a paging
        // failure. The notifier itself decides whether the attempt
        // count clears the configured threshold and stays silent for
        // clean first-try runs.
        await notifyBackfillResult(run);
        // Phase-slowdown alert (Task #311): even on a successful run,
        // flag any per-country phase that ran much slower than the
        // recent baseline so admins can catch regressions before they
        // turn into a stuck/failing sweep next week. Detection is
        // best-effort; it never throws or affects the run outcome.
        try {
          const slowdowns = await detectBackfillPhaseSlowdowns(run);
          if (slowdowns.length > 0) {
            await notifyBackfillPhaseSlowdowns(run, slowdowns);
          }
        } catch (err) {
          logger.warn('⚠️  Phase-slowdown detection failed (non-fatal):', err);
        }
      } else {
        run.status = 'failed';
        run.finishedAt = finishedAt;
        run.durationMs = finishedAt.getTime() - startedAt.getTime();
        run.errorMessage = lastError instanceof Error ? lastError.message : String(lastError);
        await run.save();
        this.lastRunAt = finishedAt;
        logger.error('❌ Scheduled backfill failed:', lastError);
        // Notifier swallows its own errors (and bounds webhook latency
        // internally) so a flaky alert channel can never poison the
        // background worker. Only fires after all retries are exhausted.
        await notifyBackfillResult(run);
      }
    } finally {
      this.isRunning = false;
      // Apply retention after every sweep so the BackfillRun collection
      // never grows unbounded. Best-effort — see `pruneOldBackfillRuns`.
      await pruneOldBackfillRuns();
    }
  }

  /**
   * Single attempt at the cross-country sweep. Throws on infrastructure
   * failure (Mongo aggregate / save) so the caller can decide whether to
   * retry. Per-country errors are still swallowed inside the loops — a
   * single bad country shouldn't fail the whole sweep — only the
   * top-offender aggregations and overall control flow surface as
   * retry-worthy errors here.
   */
  private async performSweep(
    run: IBackfillRun,
    overrideCountry?: string,
  ): Promise<void> {
    // When admins target a specific country we skip the top-N
    // aggregation entirely and just run logos + tags for that one
    // market. Otherwise pick the worst offenders as usual.
    const [topLogos, topTags] = overrideCountry
      ? [
          [{ countryCode: overrideCountry, count: 0 }],
          [{ countryCode: overrideCountry, count: 0 }],
        ]
      : await Promise.all([
          topCountriesByFilter(buildLogoBackfillFilter(), this.TOP_N),
          topCountriesByFilter(buildTagsBackfillFilter(), this.TOP_N),
        ]);

    logger.log(
      `🗓️  Top logo offenders: ${topLogos.map((c) => `${c.countryCode}(${c.count})`).join(', ') || 'none'}`,
    );
    logger.log(
      `🗓️  Top tag offenders:  ${topTags.map((c) => `${c.countryCode}(${c.count})`).join(', ') || 'none'}`,
    );

    const sync = new SyncService();

    for (const c of topLogos) {
      // Per-phase timing (Task #235): wrap each per-country logo enqueue
      // so the detail page can flag which market dominated the sweep,
      // not just the total `durationMs`. Errors still record duration so
      // a country that times out shows up as "slow + failed" rather than
      // disappearing from the breakdown.
      const phaseStart = Date.now();
      try {
        const r = await enqueueLogosForCountry(c.countryCode);
        run.logos.push({
          countryCode: c.countryCode,
          candidates: r.candidates,
          enqueued: r.enqueued,
          durationMs: Date.now() - phaseStart,
          sampleStations: r.sampleStations.length > 0 ? r.sampleStations : undefined,
        });
        logger.log(`📥 ${c.countryCode}: enqueued ${r.enqueued}/${r.candidates} logos`);
      } catch (err) {
        logger.error(`❌ Logo enqueue failed for ${c.countryCode}:`, err);
        run.logos.push({
          countryCode: c.countryCode,
          candidates: c.count,
          enqueued: 0,
          durationMs: Date.now() - phaseStart,
        });
      }
    }

    for (const c of topTags) {
      const phaseStart = Date.now();
      // Capture the head of the tags candidate set BEFORE invoking the
      // hydrator. The hydrator itself doesn't report which stationuuids
      // it touched, so this gives admins at least the intent-list to
      // click into from the run detail page (Task #234).
      const tagsSample = await sampleStationsForFilter(
        buildTagsBackfillFilter(c.countryCode),
      );
      try {
        const r = await sync.hydrateMissingTagsInBackground({
          countryCode: c.countryCode,
          limit: this.TAGS_LIMIT_PER_COUNTRY,
        });
        run.tags.push({
          countryCode: c.countryCode,
          processed: r.processed,
          hydrated: r.hydrated,
          emptyUpstream: r.emptyUpstream,
          failed: r.failed,
          durationMs: Date.now() - phaseStart,
          sampleStations: tagsSample.length > 0 ? tagsSample : undefined,
        });
        logger.log(
          `🏷️  ${c.countryCode}: tags processed=${r.processed} hydrated=${r.hydrated} empty=${r.emptyUpstream} failed=${r.failed}`,
        );
      } catch (err) {
        logger.error(`❌ Tag hydration failed for ${c.countryCode}:`, err);
        run.tags.push({
          countryCode: c.countryCode,
          processed: 0,
          hydrated: 0,
          emptyUpstream: 0,
          failed: 0,
          durationMs: Date.now() - phaseStart,
        });
      }
    }
  }
}

export const scheduledBackfill = ScheduledBackfillService.getInstance();
