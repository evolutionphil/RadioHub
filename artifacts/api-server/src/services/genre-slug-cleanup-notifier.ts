import { logger } from '../utils/logger';
import type { IGenreSlugCleanupRun } from '@workspace/db-shared/mongo-schemas';

/**
 * Notifier for the weekly genre-slug cleanup cron (Task #160).
 *
 * In steady state the weekly run added in Task #132 should be a
 * no-op — the schema validator on `Genre.slug` blocks new bad writes
 * through the Mongoose layer, so a cleanup that suddenly normalizes or
 * demotes a chunk of rows means something upstream (a bulk path, an
 * old code path, a Radio-Browser drift) is reintroducing bad data.
 * We want to know about that immediately rather than discovering it
 * weeks later in Search Console.
 *
 * Mirrors `backfill-notifier.ts` so on-call already recognises the
 * shape: same `{ text, run }` webhook body, same env-driven channel,
 * same hookable `setGenreSlugCleanupNotifier` for tests / future
 * channels. Per the task spec we do NOT introduce a new webhook
 * secret — alerts ride the existing `BACKFILL_ALERT_WEBHOOK_URL`
 * channel that on-call already watches.
 *
 * Env knobs:
 *  - `GENRE_SLUG_CLEANUP_ALERT_THRESHOLD` — number of rows changed
 *    (`normalized + markedUndiscoverable`) at or above which a
 *    successful run still triggers an alert. Default 5. A failed
 *    run alerts unconditionally regardless of this value.
 *  - `BACKFILL_ALERT_WEBHOOK_URL` — reused outbound webhook
 *    (Slack/Discord-compatible `{ text }` body).
 */

const DEFAULT_THRESHOLD = 5;
const WEBHOOK_TIMEOUT_MS = 5_000;

function parseThreshold(value: string | undefined): number {
  if (!value) return DEFAULT_THRESHOLD;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_THRESHOLD;
}

export function getGenreSlugCleanupAlertThreshold(): number {
  return parseThreshold(process.env.GENRE_SLUG_CLEANUP_ALERT_THRESHOLD);
}

export type GenreSlugCleanupNotifier = (
  run: IGenreSlugCleanupRun,
  reason: 'failed' | 'threshold-exceeded',
) => Promise<void> | void;

function summarizeRun(
  run: IGenreSlugCleanupRun,
  reason: 'failed' | 'threshold-exceeded',
  threshold: number,
): string {
  const changed = run.normalized + run.markedUndiscoverable;
  if (reason === 'failed') {
    const err = run.errorMessage || 'unknown error';
    return [
      `Weekly genre-slug cleanup FAILED (trigger=${run.trigger})`,
      `Scanned: ${run.scanned}, normalized: ${run.normalized}, demoted: ${run.markedUndiscoverable}`,
      `Error: ${err}`,
    ].join('\n');
  }
  return [
    `Weekly genre-slug cleanup changed ${changed} row(s) — threshold is ${threshold} (trigger=${run.trigger})`,
    `Scanned: ${run.scanned}, normalized: ${run.normalized}, demoted: ${run.markedUndiscoverable}`,
    `Empty slugs marked: ${run.emptySlugMarked}, collisions: ${run.collisionMarked}, errors: ${run.errorCount}`,
    `Something upstream is likely reintroducing malformed slugs — investigate before it hits Search Console.`,
  ].join('\n');
}

async function postWebhook(
  url: string,
  message: string,
  run: IGenreSlugCleanupRun,
  reason: 'failed' | 'threshold-exceeded',
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
          scanned: run.scanned,
          normalized: run.normalized,
          markedUndiscoverable: run.markedUndiscoverable,
          emptySlugMarked: run.emptySlugMarked,
          collisionMarked: run.collisionMarked,
          errorCount: run.errorCount,
          errorMessage: run.errorMessage,
          reason,
        },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.warn(
        `⚠️  Genre-slug cleanup alert webhook returned ${res.status} ${res.statusText}`,
      );
    }
  } catch (err) {
    logger.warn('⚠️  Genre-slug cleanup alert webhook POST failed:', err);
  } finally {
    clearTimeout(timeout);
  }
}

const defaultNotifier: GenreSlugCleanupNotifier = async (run, reason) => {
  const threshold = getGenreSlugCleanupAlertThreshold();
  const summary = summarizeRun(run, reason, threshold);
  // Always surface in logs so even with no webhook configured the
  // alert stops being silent.
  logger.error(`🚨 ${summary}`);

  const url = process.env.BACKFILL_ALERT_WEBHOOK_URL;
  if (url) {
    await postWebhook(url, summary, run, reason);
  }
};

let activeNotifier: GenreSlugCleanupNotifier = defaultNotifier;

export function setGenreSlugCleanupNotifier(
  fn: GenreSlugCleanupNotifier | null,
): void {
  activeNotifier = fn ?? defaultNotifier;
}

/**
 * Notify the team about a genre-slug cleanup run when it either
 * failed outright, or successfully changed enough rows
 * (`normalized + markedUndiscoverable`) to exceed the configured
 * threshold. Quiet runs stay silent so weekly no-ops don't add cron
 * noise.
 */
export async function notifyGenreSlugCleanupResult(
  run: IGenreSlugCleanupRun | null,
): Promise<void> {
  if (!run) return;
  const reason: 'failed' | 'threshold-exceeded' | null =
    run.status === 'failed'
      ? 'failed'
      : run.normalized + run.markedUndiscoverable >=
          getGenreSlugCleanupAlertThreshold()
        ? 'threshold-exceeded'
        : null;
  if (!reason) return;
  try {
    await activeNotifier(run, reason);
  } catch (err) {
    logger.error('❌ Genre-slug cleanup notifier itself threw:', err);
  }
}
