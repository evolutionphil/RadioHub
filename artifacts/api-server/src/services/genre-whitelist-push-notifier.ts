import { logger } from '../utils/logger';
import { User, UserNotification } from '@workspace/db-shared/mongo-schemas';
import type {
  GenreWhitelistPushStatus,
  PushStepResult,
} from '../seo/genre-whitelist-push-status';

/**
 * Notifier for the "push the genre whitelist to search engines" pipeline
 * triggered by admin add/remove on the genre whitelist (Task #256).
 *
 * The push runs fire-and-forget after every whitelist mutation
 * (`triggerSearchEnginePush` in admin-genre-whitelist-routes.ts). It hits
 * three outbound steps that can fail independently of the mutation
 * itself: a sitemap manifest rebuild, an IndexNow sitemap ping, and a
 * per-language IndexNow ping for each affected `/genres/<slug>`. Task
 * #186 added a "last push" panel to the admin UI, but those failures
 * were only visible if an admin happened to open that page. This module
 * closes the loop: any failed step produces an out-of-band alert
 * (logs + admin in-app notification + optional webhook).
 *
 * Same shape as `coverage-drop-notifier` and `backfill-notifier` so
 * on-call recognises the channel:
 *  - Always logs an `🚨` error line summarising the failed steps.
 *  - One `UserNotification` row per admin user (`type: 'system'`,
 *    `data.kind: 'genre_whitelist_push_failure'`).
 *  - Optional JSON POST to `BACKFILL_ALERT_WEBHOOK_URL`
 *    (Slack/Discord-compatible `{ text }` body) — we deliberately reuse
 *    the existing webhook channel rather than introducing yet another
 *    secret.
 *  - `setGenreWhitelistPushNotifier(fn)` lets tests / future channels
 *    swap in a different sink.
 *
 * De-duplication
 * --------------
 * Whitelist edits frequently re-push the same slugs (e.g. an admin
 * removes and re-adds a slug while debugging, or a genuinely flaky
 * IndexNow endpoint trips on every mutation). Without de-dup the team
 * would get the same alert repeatedly. We fingerprint each failure on:
 *
 *   sorted(affected slugs) + sorted("step:error" pairs)
 *
 * and suppress repeats inside a TTL window (default 6h, override via
 * `GENRE_WHITELIST_PUSH_ALERT_DEDUPE_MS`). A different failure mode
 * (new step, new slugs, new error text) always fires through.
 * `trigger` is deliberately NOT part of the fingerprint — the same
 * underlying failure should dedupe whether it was reached via
 * `add-slug`, `remove-slug`, or `manual-repush`, otherwise an admin
 * re-pushing the same slug to debug would still spam the channel.
 *
 * Env knobs:
 *  - `ENABLE_GENRE_WHITELIST_PUSH_ALERTS` — set to `false` to silence.
 *  - `GENRE_WHITELIST_PUSH_ALERT_DEDUPE_MS` — dedupe window in ms.
 *    Default 6h. Set to `0` to disable dedupe and alert on every failure.
 *  - `BACKFILL_ALERT_WEBHOOK_URL` — reused outbound webhook.
 */

const DEFAULT_DEDUPE_WINDOW_MS = 6 * 60 * 60 * 1000;
const WEBHOOK_TIMEOUT_MS = 5_000;

export type WhitelistPushStepName =
  | 'sitemapRebuild'
  | 'indexnowSitemap'
  | 'indexnowGenreUrls';

const STEP_NAMES: WhitelistPushStepName[] = [
  'sitemapRebuild',
  'indexnowSitemap',
  'indexnowGenreUrls',
];

export interface FailedPushStep {
  step: WhitelistPushStepName;
  error: string;
}

function isEnabled(): boolean {
  return process.env.ENABLE_GENRE_WHITELIST_PUSH_ALERTS !== 'false';
}

function getDedupeWindowMs(): number {
  const raw = process.env.GENRE_WHITELIST_PUSH_ALERT_DEDUPE_MS;
  if (raw === undefined || raw === '') return DEFAULT_DEDUPE_WINDOW_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DEDUPE_WINDOW_MS;
}

export function getFailedSteps(status: GenreWhitelistPushStatus): FailedPushStep[] {
  const out: FailedPushStep[] = [];
  for (const step of STEP_NAMES) {
    const r = status[step] as PushStepResult;
    if (r?.status === 'failed') {
      out.push({ step, error: r.error ?? 'unknown error' });
    }
  }
  return out;
}

function fingerprint(
  status: GenreWhitelistPushStatus,
  failed: FailedPushStep[],
): string {
  const stepKey = failed
    .map((f) => `${f.step}:${(f.error ?? '').trim()}`)
    .sort()
    .join('|');
  const slugKey = [...status.affectedSlugs].sort().join(',');
  return `${slugKey}::${stepKey}`;
}

interface DedupeEntry {
  at: number;
}

const dedupeCache = new Map<string, DedupeEntry>();

/** Test-only: clear the in-memory dedupe state. */
export function _resetGenreWhitelistPushDedupe(): void {
  dedupeCache.clear();
}

function shouldSuppress(key: string, now: number): boolean {
  const window = getDedupeWindowMs();
  if (window === 0) return false;
  const prev = dedupeCache.get(key);
  if (!prev) return false;
  return now - prev.at < window;
}

function recordFingerprint(key: string, now: number): void {
  dedupeCache.set(key, { at: now });
  // Garbage-collect entries that are well past the window so the map
  // doesn't grow unbounded if someone churns through unique slugs.
  const window = getDedupeWindowMs();
  if (window === 0) return;
  const cutoff = now - window;
  for (const [k, v] of dedupeCache) {
    if (v.at < cutoff) dedupeCache.delete(k);
  }
}

function summarize(
  status: GenreWhitelistPushStatus,
  failed: FailedPushStep[],
): string {
  const slugList =
    status.affectedSlugs.length === 0
      ? '(none)'
      : status.affectedSlugs.join(', ');
  const triggeredBy = status.triggeredBy ?? 'system';
  const lines = [
    `Genre whitelist search-engine push FAILED (trigger=${status.trigger}, by=${triggeredBy})`,
    `Affected slug(s): ${slugList}`,
    `Failed step(s): ${failed.length}`,
    ...failed.map((f) => `  • ${f.step}: ${f.error}`),
  ];
  return lines.join('\n');
}

async function postWebhook(
  url: string,
  message: string,
  status: GenreWhitelistPushStatus,
  failed: FailedPushStep[],
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: message,
        push: {
          trigger: status.trigger,
          triggeredBy: status.triggeredBy,
          triggeredAt: status.triggeredAt,
          completedAt: status.completedAt,
          affectedSlugs: status.affectedSlugs,
          failedSteps: failed,
        },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.warn(
        `⚠️  Genre whitelist push alert webhook returned ${res.status} ${res.statusText}`,
      );
    }
  } catch (err) {
    logger.warn('⚠️  Genre whitelist push alert webhook POST failed:', err);
  } finally {
    clearTimeout(timeout);
  }
}

async function notifyAdminsInApp(
  status: GenreWhitelistPushStatus,
  failed: FailedPushStep[],
): Promise<number> {
  const admins = await User.find({ role: 'admin' }, { _id: 1 }).lean();
  if (admins.length === 0) return 0;

  const slugSummary =
    status.affectedSlugs.length === 0
      ? '(none)'
      : status.affectedSlugs.length <= 3
        ? status.affectedSlugs.join(', ')
        : `${status.affectedSlugs.slice(0, 3).join(', ')} +${status.affectedSlugs.length - 3} more`;
  const stepNames = failed.map((f) => f.step).join(', ');
  const message = `Genre whitelist push (${status.trigger}) failed at: ${stepNames}. Slugs: ${slugSummary}.`;

  const docs = admins.map((a) => ({
    userId: a._id,
    type: 'system' as const,
    title: '⚠️ Genre whitelist push failed',
    message,
    data: {
      kind: 'genre_whitelist_push_failure',
      trigger: status.trigger,
      triggeredBy: status.triggeredBy,
      triggeredAt: status.triggeredAt,
      completedAt: status.completedAt,
      affectedSlugs: status.affectedSlugs,
      failedSteps: failed,
    },
  }));

  await UserNotification.insertMany(docs, { ordered: false });
  return admins.length;
}

export type GenreWhitelistPushNotifier = (
  status: GenreWhitelistPushStatus,
  failed: FailedPushStep[],
) => Promise<void> | void;

const defaultNotifier: GenreWhitelistPushNotifier = async (status, failed) => {
  const summary = summarize(status, failed);
  // Always surface in logs so the alert is visible even with no webhook
  // configured and no admin users in the DB.
  logger.error(`🚨 ${summary}`);

  try {
    const recipients = await notifyAdminsInApp(status, failed);
    if (recipients > 0) {
      logger.log(
        `📨 Genre whitelist push failure in-app notifications: ${recipients} admin(s)`,
      );
    }
  } catch (err) {
    logger.warn(
      '⚠️  Failed to write genre whitelist push failure in-app notifications:',
      err,
    );
  }

  const url = process.env.BACKFILL_ALERT_WEBHOOK_URL;
  if (url) {
    await postWebhook(url, summary, status, failed);
  }
};

let activeNotifier: GenreWhitelistPushNotifier = defaultNotifier;

export function setGenreWhitelistPushNotifier(
  fn: GenreWhitelistPushNotifier | null,
): void {
  activeNotifier = fn ?? defaultNotifier;
}

export interface NotifyWhitelistPushResult {
  /** Push had at least one failed step. */
  failed: boolean;
  /** Notifier was actually invoked (i.e. failure not suppressed). */
  notified: boolean;
  /** Reason notifier was skipped, if any. */
  suppressedReason?: 'disabled' | 'no-failures' | 'deduped';
  failedSteps: FailedPushStep[];
}

/**
 * Inspect a completed push status and notify the team if any step
 * failed. Identical successive failures inside the dedupe window are
 * suppressed so a flaky IndexNow endpoint doesn't spam the channel on
 * every whitelist edit. Never throws — caller is fire-and-forget.
 */
export async function notifyWhitelistPushResult(
  status: GenreWhitelistPushStatus | null | undefined,
): Promise<NotifyWhitelistPushResult> {
  const empty: FailedPushStep[] = [];
  if (!status) return { failed: false, notified: false, failedSteps: empty };
  if (!isEnabled()) {
    return {
      failed: false,
      notified: false,
      suppressedReason: 'disabled',
      failedSteps: empty,
    };
  }
  const failed = getFailedSteps(status);
  if (failed.length === 0) {
    return {
      failed: false,
      notified: false,
      suppressedReason: 'no-failures',
      failedSteps: empty,
    };
  }
  const now = Date.now();
  const key = fingerprint(status, failed);
  if (shouldSuppress(key, now)) {
    return {
      failed: true,
      notified: false,
      suppressedReason: 'deduped',
      failedSteps: failed,
    };
  }
  recordFingerprint(key, now);
  try {
    await activeNotifier(status, failed);
  } catch (err) {
    logger.error('❌ Genre whitelist push notifier itself threw:', err);
  }
  return { failed: true, notified: true, failedSteps: failed };
}
