import { logger } from '../utils/logger';
import type { IBackfillRun } from '@workspace/db-shared/mongo-schemas';

/**
 * Notifier for failed weekly backfill runs (Task #118).
 *
 * The project doesn't yet have a dedicated alerting channel, so this
 * module is intentionally hookable:
 *
 * - Always logs a prominent error line with the country list and
 *   `errorMessage`, so failures are visible in the existing log stream
 *   even with no extra config.
 * - Optionally POSTs a JSON payload to `BACKFILL_ALERT_WEBHOOK_URL` if
 *   set. The body is shaped as `{ text }` which works out of the box
 *   for Slack/Discord incoming webhooks and for any generic JSON sink.
 * - `setBackfillNotifier(fn)` lets callers swap in a different channel
 *   (email, in-app banner, etc.) without touching the cron service.
 *
 * Successful runs are silent — `notifyBackfillResult` is a no-op for
 * non-failed runs so we don't add cron noise.
 */
export type BackfillNotifier = (run: IBackfillRun) => Promise<void> | void;

function summarizeRun(run: IBackfillRun): string {
  const logoCountries = run.logos.map((l) => l.countryCode).join(', ') || 'none';
  const tagCountries = run.tags.map((t) => t.countryCode).join(', ') || 'none';
  const err = run.errorMessage || 'unknown error';
  return [
    `Weekly backfill FAILED (trigger=${run.trigger})`,
    `Logo countries attempted: ${logoCountries}`,
    `Tag countries attempted:  ${tagCountries}`,
    `Error: ${err}`,
  ].join('\n');
}

// Bound webhook latency so a slow/hung alert endpoint can't stall the
// cron's failure-handling path indefinitely.
const WEBHOOK_TIMEOUT_MS = 5_000;

async function postWebhook(url: string, message: string, run: IBackfillRun): Promise<void> {
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
          logoCountries: run.logos.map((l) => l.countryCode),
          tagCountries: run.tags.map((t) => t.countryCode),
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

const defaultNotifier: BackfillNotifier = async (run) => {
  const summary = summarizeRun(run);
  // Always surface in logs so even with no webhook configured the
  // failure stops being silent.
  logger.error(`🚨 ${summary}`);

  const url = process.env.BACKFILL_ALERT_WEBHOOK_URL;
  if (url) {
    await postWebhook(url, summary, run);
  }
};

let activeNotifier: BackfillNotifier = defaultNotifier;

export function setBackfillNotifier(fn: BackfillNotifier | null): void {
  activeNotifier = fn ?? defaultNotifier;
}

/**
 * Notify the team about a backfill run. No-op for non-failed runs so
 * successful weekly sweeps stay silent.
 */
export async function notifyBackfillResult(run: IBackfillRun | null): Promise<void> {
  if (!run || run.status !== 'failed') return;
  try {
    await activeNotifier(run);
  } catch (err) {
    logger.error('❌ Backfill notifier itself threw:', err);
  }
}
