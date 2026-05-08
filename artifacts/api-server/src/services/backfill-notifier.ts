import { logger } from '../utils/logger';
import type { IBackfillRun } from '@workspace/db-shared/mongo-schemas';

/**
 * Notifier for weekly backfill runs.
 *
 * Three reasons fire an alert:
 *   - `failed`          — the run exhausted every retry and ended in
 *                         `status='failed'` (Task #118).
 *   - `recovered`       — the run eventually completed but only after
 *                         `>= BACKFILL_RECOVERY_ALERT_MIN_ATTEMPTS` failed
 *                         attempts (Task #224). A run that "recovered after
 *                         2 failed attempts" is a precursor to one that
 *                         pages on-call, so we want to know about the trend
 *                         before it becomes an outage instead of waiting
 *                         for someone to check the dashboard.
 *   - `phase-slowdown`  — one or more per-country phase durations were
 *                         dramatically slower than the median of recent
 *                         runs for the same country/phase (Task #311). The
 *                         run itself succeeded, so it would otherwise stay
 *                         silent — but a phase that jumps from 30s to 8m
 *                         is a regression we want to flag automatically.
 *
 * Anything else (clean first-try success, or a single-attempt blip
 * below the threshold) stays silent so the weekly cron doesn't spam.
 *
 * The project doesn't yet have a dedicated alerting channel, so this
 * module is intentionally hookable:
 *
 * - Always logs a prominent line with the country list, attempt
 *   count, and last error message, so alerts are visible in the
 *   existing log stream even with no extra config.
 * - Optionally POSTs a JSON payload to `BACKFILL_ALERT_WEBHOOK_URL`
 *   if set. The body is shaped as `{ text, run }` which works out
 *   of the box for Slack/Discord incoming webhooks and for any
 *   generic JSON sink.
 * - `setBackfillNotifier(fn)` lets callers swap in a different
 *   channel (email, in-app banner, etc.) without touching the cron
 *   service.
 *
 * Env knobs:
 *  - `BACKFILL_RECOVERY_ALERT_MIN_ATTEMPTS` — minimum number of
 *    failed attempts on a successful run that still triggers a
 *    `recovered` alert. Default 2. Set to 0 to alert on every
 *    completed run that had any retry, or to a very high number
 *    to disable recovery alerts entirely.
 *  - `BACKFILL_PHASE_SLOWDOWN_MULTIPLIER` — how many times the
 *    recent median a phase duration must hit before it counts as a
 *    slowdown. Default 3 (i.e. 3x the median). Set to a very high
 *    number to effectively disable phase-slowdown alerts.
 *  - `BACKFILL_PHASE_SLOWDOWN_LOOKBACK` — how many recent completed
 *    runs to consider when computing the per-country/phase baseline.
 *    Default 10.
 *  - `BACKFILL_PHASE_SLOWDOWN_MIN_SAMPLES` — minimum number of
 *    historical samples required before we'll flag a slowdown for a
 *    given country/phase. Default 3 — without this a brand-new
 *    market with one fast run would page on every subsequent run
 *    that's even slightly slower.
 *  - `BACKFILL_PHASE_SLOWDOWN_MIN_BASELINE_MS` — ignore phases
 *    whose baseline median is below this floor. Default 5000 (5s)
 *    so a phase that goes from 50ms→200ms doesn't page on-call —
 *    only material regressions on already-non-trivial phases.
 *  - `BACKFILL_ALERT_WEBHOOK_URL` — outbound webhook
 *    (Slack/Discord-compatible `{ text }` body).
 */
export type BackfillAlertReason = 'failed' | 'recovered' | 'phase-slowdown';

export type BackfillPhase = 'logos' | 'tags';

/**
 * One per-country phase that exceeded the configured slowdown
 * multiplier vs. the recent baseline. Surfaced to the notifier so
 * the alert payload can name exactly which markets/steps regressed
 * instead of just saying "the run was slow".
 */
export interface BackfillPhaseSlowdown {
  countryCode: string;
  phase: BackfillPhase;
  durationMs: number;
  baselineMs: number; // median of recent runs for this country/phase
  multiplier: number; // observed / baseline, rounded to 0.01
  sampleSize: number; // number of historical runs the baseline was computed from
}

export interface BackfillNotifierContext {
  slowdowns?: BackfillPhaseSlowdown[];
}

export type BackfillNotifier = (
  run: IBackfillRun,
  reason: BackfillAlertReason,
  context?: BackfillNotifierContext,
) => Promise<void> | void;

const DEFAULT_RECOVERY_MIN_ATTEMPTS = 2;
const DEFAULT_PHASE_SLOWDOWN_MULTIPLIER = 3;
const DEFAULT_PHASE_SLOWDOWN_LOOKBACK = 10;
const DEFAULT_PHASE_SLOWDOWN_MIN_SAMPLES = 3;
const DEFAULT_PHASE_SLOWDOWN_MIN_BASELINE_MS = 5_000;
const WEBHOOK_TIMEOUT_MS = 5_000;

function parseMinAttempts(value: string | undefined): number {
  if (value === undefined || value === '') return DEFAULT_RECOVERY_MIN_ATTEMPTS;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_RECOVERY_MIN_ATTEMPTS;
}

export function getBackfillRecoveryAlertMinAttempts(): number {
  return parseMinAttempts(process.env.BACKFILL_RECOVERY_ALERT_MIN_ATTEMPTS);
}

function parsePositiveNumber(
  value: string | undefined,
  fallback: number,
  { minInclusive }: { minInclusive: number },
): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= minInclusive ? n : fallback;
}

function parsePositiveInt(
  value: string | undefined,
  fallback: number,
  { minInclusive }: { minInclusive: number },
): number {
  if (value === undefined || value === '') return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= minInclusive ? n : fallback;
}

export function getBackfillPhaseSlowdownMultiplier(): number {
  // Multiplier must be > 1 to be meaningful — a value of "the phase is
  // 1x its own median" is just "every successful run". We accept any
  // value > 1 (including fractional, e.g. 1.5) and fall back otherwise.
  const raw = process.env.BACKFILL_PHASE_SLOWDOWN_MULTIPLIER;
  if (raw === undefined || raw === '') return DEFAULT_PHASE_SLOWDOWN_MULTIPLIER;
  const n = Number(raw);
  return Number.isFinite(n) && n > 1 ? n : DEFAULT_PHASE_SLOWDOWN_MULTIPLIER;
}

export function getBackfillPhaseSlowdownLookback(): number {
  return parsePositiveInt(
    process.env.BACKFILL_PHASE_SLOWDOWN_LOOKBACK,
    DEFAULT_PHASE_SLOWDOWN_LOOKBACK,
    { minInclusive: 1 },
  );
}

export function getBackfillPhaseSlowdownMinSamples(): number {
  return parsePositiveInt(
    process.env.BACKFILL_PHASE_SLOWDOWN_MIN_SAMPLES,
    DEFAULT_PHASE_SLOWDOWN_MIN_SAMPLES,
    { minInclusive: 1 },
  );
}

export function getBackfillPhaseSlowdownMinBaselineMs(): number {
  return parsePositiveNumber(
    process.env.BACKFILL_PHASE_SLOWDOWN_MIN_BASELINE_MS,
    DEFAULT_PHASE_SLOWDOWN_MIN_BASELINE_MS,
    { minInclusive: 0 },
  );
}

function lastAttemptError(run: IBackfillRun): string {
  const attempts = run.attempts ?? [];
  if (attempts.length === 0) return run.errorMessage || 'unknown error';
  return attempts[attempts.length - 1]?.error || run.errorMessage || 'unknown error';
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function summarizeSlowdowns(
  run: IBackfillRun,
  slowdowns: BackfillPhaseSlowdown[],
): string {
  const lines = slowdowns.map(
    (s) =>
      `  • ${s.countryCode} ${s.phase}: ${formatMs(s.durationMs)} vs. ${formatMs(s.baselineMs)} median (${s.multiplier.toFixed(2)}x, n=${s.sampleSize})`,
  );
  return [
    `Weekly backfill PHASE SLOWDOWN (trigger=${run.trigger}) — ${slowdowns.length} phase${slowdowns.length === 1 ? '' : 's'} much slower than recent baseline:`,
    ...lines,
    `Investigate before this becomes a stuck/failing run — upstream throttling, Mongo pressure, or a country with a sudden flood of un-hydrated stations are the usual culprits.`,
  ].join('\n');
}

function summarizeRun(
  run: IBackfillRun,
  reason: BackfillAlertReason,
  context?: BackfillNotifierContext,
): string {
  if (reason === 'phase-slowdown') {
    return summarizeSlowdowns(run, context?.slowdowns ?? []);
  }
  const logoCountries = run.logos.map((l) => l.countryCode).join(', ') || 'none';
  const tagCountries = run.tags.map((t) => t.countryCode).join(', ') || 'none';
  const attemptCount = run.attempts?.length ?? 0;
  if (reason === 'failed') {
    return [
      `Weekly backfill FAILED (trigger=${run.trigger}) after ${attemptCount} failed attempt${attemptCount === 1 ? '' : 's'}`,
      `Logo countries attempted: ${logoCountries}`,
      `Tag countries attempted:  ${tagCountries}`,
      `Last error: ${lastAttemptError(run)}`,
    ].join('\n');
  }
  return [
    `Weekly backfill RECOVERED (trigger=${run.trigger}) after ${attemptCount} failed attempt${attemptCount === 1 ? '' : 's'}`,
    `Logo countries attempted: ${logoCountries}`,
    `Tag countries attempted:  ${tagCountries}`,
    `Last error before recovery: ${lastAttemptError(run)}`,
    `Repeated near-misses tend to precede a full failure — investigate upstream flakiness before it pages on-call.`,
  ].join('\n');
}

async function postWebhook(
  url: string,
  message: string,
  run: IBackfillRun,
  reason: BackfillAlertReason,
  context?: BackfillNotifierContext,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: message,
        run: {
          id: String(run._id),
          trigger: run.trigger,
          status: run.status,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          durationMs: run.durationMs,
          errorMessage: run.errorMessage,
          attemptCount: run.attempts?.length ?? 0,
          lastAttemptError: lastAttemptError(run),
          logoCountries: run.logos.map((l) => l.countryCode),
          tagCountries: run.tags.map((t) => t.countryCode),
          reason,
          slowdowns: context?.slowdowns,
        },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.warn(`⚠️  Backfill alert webhook returned ${res.status} ${res.statusText}`);
    }
  } catch (err) {
    logger.warn('⚠️  Backfill alert webhook POST failed:', err);
  } finally {
    clearTimeout(timeout);
  }
}

const defaultNotifier: BackfillNotifier = async (run, reason, context) => {
  const summary = summarizeRun(run, reason, context);
  // Always surface in logs so even with no webhook configured the
  // alert stops being silent.
  logger.error(`🚨 ${summary}`);

  const url = process.env.BACKFILL_ALERT_WEBHOOK_URL;
  if (url) {
    await postWebhook(url, summary, run, reason, context);
  }
};

let activeNotifier: BackfillNotifier = defaultNotifier;

export function setBackfillNotifier(fn: BackfillNotifier | null): void {
  activeNotifier = fn ?? defaultNotifier;
}

/**
 * Notify the team about a backfill run. Fires for failed runs and
 * for completed runs that recovered after >= the configured number
 * of failed attempts. Quiet first-try successes (and single-retry
 * recoveries below the threshold) stay silent.
 */
export async function notifyBackfillResult(run: IBackfillRun | null): Promise<void> {
  if (!run) return;
  const attemptCount = run.attempts?.length ?? 0;
  const reason: BackfillAlertReason | null =
    run.status === 'failed'
      ? 'failed'
      : run.status === 'completed' &&
          attemptCount >= getBackfillRecoveryAlertMinAttempts() &&
          attemptCount > 0
        ? 'recovered'
        : null;
  if (!reason) return;
  try {
    await activeNotifier(run, reason);
  } catch (err) {
    logger.error('❌ Backfill notifier itself threw:', err);
  }
}

/**
 * Notify the team that one or more per-country phase durations were
 * dramatically slower than the recent baseline (Task #311). Detection
 * lives in `scheduled-backfill.ts` (it needs DB access to historical
 * runs); this just fans the result out through the same notifier
 * channel as the failure / recovery alerts.
 *
 * No-op when `slowdowns` is empty so the caller can blindly forward
 * the detector's output without an extra guard.
 */
export async function notifyBackfillPhaseSlowdowns(
  run: IBackfillRun | null,
  slowdowns: BackfillPhaseSlowdown[],
): Promise<void> {
  if (!run) return;
  if (!slowdowns || slowdowns.length === 0) return;
  try {
    await activeNotifier(run, 'phase-slowdown', { slowdowns });
  } catch (err) {
    logger.error('❌ Backfill notifier itself threw:', err);
  }
}
