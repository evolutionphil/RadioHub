import { logger } from '../utils/logger';
import type { IBackfillRun } from '@workspace/db-shared/mongo-schemas';

/**
 * Notifier for weekly backfill runs.
 *
 * Two reasons fire an alert:
 *   - `failed`     — the run exhausted every retry and ended in
 *                    `status='failed'` (Task #118).
 *   - `recovered`  — the run eventually completed but only after
 *                    `>= BACKFILL_RECOVERY_ALERT_MIN_ATTEMPTS` failed
 *                    attempts (Task #224). A run that "recovered after
 *                    2 failed attempts" is a precursor to one that
 *                    pages on-call, so we want to know about the trend
 *                    before it becomes an outage instead of waiting
 *                    for someone to check the dashboard.
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
 *  - `BACKFILL_ALERT_WEBHOOK_URL` — outbound webhook
 *    (Slack/Discord-compatible `{ text }` body).
 */
export type BackfillAlertReason = 'failed' | 'recovered';

export type BackfillNotifier = (
  run: IBackfillRun,
  reason: BackfillAlertReason,
) => Promise<void> | void;

const DEFAULT_RECOVERY_MIN_ATTEMPTS = 2;
const WEBHOOK_TIMEOUT_MS = 5_000;

function parseMinAttempts(value: string | undefined): number {
  if (value === undefined || value === '') return DEFAULT_RECOVERY_MIN_ATTEMPTS;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_RECOVERY_MIN_ATTEMPTS;
}

export function getBackfillRecoveryAlertMinAttempts(): number {
  return parseMinAttempts(process.env.BACKFILL_RECOVERY_ALERT_MIN_ATTEMPTS);
}

function lastAttemptError(run: IBackfillRun): string {
  const attempts = run.attempts ?? [];
  if (attempts.length === 0) return run.errorMessage || 'unknown error';
  return attempts[attempts.length - 1]?.error || run.errorMessage || 'unknown error';
}

function summarizeRun(run: IBackfillRun, reason: BackfillAlertReason): string {
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

const defaultNotifier: BackfillNotifier = async (run, reason) => {
  const summary = summarizeRun(run, reason);
  // Always surface in logs so even with no webhook configured the
  // alert stops being silent.
  logger.error(`🚨 ${summary}`);

  const url = process.env.BACKFILL_ALERT_WEBHOOK_URL;
  if (url) {
    await postWebhook(url, summary, run, reason);
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
