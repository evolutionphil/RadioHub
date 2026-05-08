// Tracks the outcome of "push the genre whitelist to search engines"
// operations triggered by an admin add/remove. The push runs as
// fire-and-forget after each whitelist mutation
// (see admin-genre-whitelist-routes.ts → triggerSearchEnginePush) and
// hits two outbound dependencies (sitemap rebuild + IndexNow pings) that
// can fail independently of the mutation itself. Surfacing this in the
// admin UI makes the success/failure of the push self-service instead of
// requiring a server-log dive (task #186).
//
// Two layers:
//   1. An in-memory map of in-flight pushes keyed by `pushId`. Each
//      `triggerSearchEnginePush()` gets its own isolated record so
//      overlapping/near-concurrent pushes can't overwrite each other's
//      step state. `lastPushStatus` is just a derived pointer to the
//      most recently *started* push for the "Last push" admin card.
//   2. On completion, the specific completed record is persisted to the
//      `GenreWhitelistPushLog` Mongo collection so the previous N
//      attempts survive an api-server restart and admins can spot a
//      flapping IndexNow endpoint or a slug that keeps failing across
//      multiple pushes (task #255).

import { GenreWhitelistPushLog } from '@workspace/db-shared/mongo-schemas';
import { logger } from '../utils/logger';

export type StepStatus = 'pending' | 'success' | 'failed' | 'skipped';

export interface PushStepResult {
  status: StepStatus;
  error?: string;
  /** Optional: number of URLs submitted (only meaningful for IndexNow steps). */
  urlCount?: number;
}

export interface GenreWhitelistPushStatus {
  /** ISO timestamp the push was queued. */
  triggeredAt: string;
  /** ISO timestamp the push finished (all steps settled), or null while running. */
  completedAt: string | null;
  /** Admin username who triggered the push, or null for system-initiated pushes. */
  triggeredBy: string | null;
  /** What kicked it off — e.g. 'add-slug', 'remove-slug', 'add-alias', 'remove-alias', 'manual-repush'. */
  trigger: string;
  /** Slugs whose pages will appear/disappear because of this change. */
  affectedSlugs: string[];
  sitemapRebuild: PushStepResult;
  indexnowSitemap: PushStepResult;
  indexnowGenreUrls: PushStepResult;
}

/** Opaque per-push handle. */
export type PushId = string;

// In-flight + most-recent-completed pushes, keyed by pushId. Bounded by
// `MAX_TRACKED_PUSHES` so a long uptime can't grow this unbounded — we
// only need recent entries because the persisted history is the source
// of truth for anything older.
const MAX_TRACKED_PUSHES = 50;
const pushes = new Map<PushId, GenreWhitelistPushStatus>();
let lastPushId: PushId | null = null;
let pushSeq = 0;

function newPushId(): PushId {
  pushSeq += 1;
  return `${Date.now().toString(36)}-${pushSeq.toString(36)}`;
}

function evictOldest(): void {
  while (pushes.size > MAX_TRACKED_PUSHES) {
    const oldestKey = pushes.keys().next().value;
    if (oldestKey === undefined) break;
    if (oldestKey === lastPushId) break; // never evict the visible "last push"
    pushes.delete(oldestKey);
  }
}

export function getLastPushStatus(): GenreWhitelistPushStatus | null {
  if (!lastPushId) return null;
  return pushes.get(lastPushId) ?? null;
}

/** Test/maintenance helper. Not used in production code. */
export function _resetPushStatusForTests(): void {
  pushes.clear();
  lastPushId = null;
  pushSeq = 0;
}

export function startPushStatus(init: {
  triggeredBy: string | null;
  trigger: string;
  affectedSlugs: string[];
}): PushId {
  const id = newPushId();
  pushes.set(id, {
    triggeredAt: new Date().toISOString(),
    completedAt: null,
    triggeredBy: init.triggeredBy,
    trigger: init.trigger,
    affectedSlugs: init.affectedSlugs,
    sitemapRebuild: { status: 'pending' },
    indexnowSitemap: { status: 'pending' },
    indexnowGenreUrls: { status: 'pending' },
  });
  lastPushId = id;
  evictOldest();
  return id;
}

export function updatePushStep(
  pushId: PushId,
  step: 'sitemapRebuild' | 'indexnowSitemap' | 'indexnowGenreUrls',
  result: PushStepResult,
): void {
  const current = pushes.get(pushId);
  if (!current) return;
  pushes.set(pushId, { ...current, [step]: result });
}

export function completePushStatus(pushId: PushId): void {
  const current = pushes.get(pushId);
  if (!current) return;
  const completedAtIso = new Date().toISOString();
  const completed: GenreWhitelistPushStatus = { ...current, completedAt: completedAtIso };
  pushes.set(pushId, completed);
  // Best-effort persist; never let a logging failure crash the push
  // pipeline. The in-memory record remains authoritative for the
  // currently-displayed "Last push" card either way. We persist from
  // the specific completed snapshot (not any global mutable state) so
  // overlapping pushes can't cross-pollute the persisted row.
  void GenreWhitelistPushLog.create({
    triggeredAt: new Date(completed.triggeredAt),
    completedAt: new Date(completedAtIso),
    triggeredBy: completed.triggeredBy,
    trigger: completed.trigger,
    affectedSlugs: completed.affectedSlugs,
    sitemapRebuild: stepToDoc(completed.sitemapRebuild),
    indexnowSitemap: stepToDoc(completed.indexnowSitemap),
    indexnowGenreUrls: stepToDoc(completed.indexnowGenreUrls),
  }).catch((err: any) => {
    logger.error(
      'genre-whitelist-push-status: failed to persist push log:',
      err?.message ?? err,
    );
  });
}

function stepToDoc(step: PushStepResult) {
  return {
    status: step.status,
    error: step.error ?? null,
    urlCount: step.urlCount ?? null,
  };
}

/**
 * Return the most recent N completed pushes (newest first), read from
 * the persisted `GenreWhitelistPushLog` collection. Used by the admin
 * page to render a timeline under the "Last push" card so admins can
 * spot flapping endpoints or slugs that keep failing (task #255).
 */
export async function getRecentPushHistory(
  limit = 20,
): Promise<GenreWhitelistPushStatus[]> {
  const cap = Math.min(Math.max(Math.floor(limit), 1), 100);
  try {
    const rows = await GenreWhitelistPushLog.find({})
      .sort({ triggeredAt: -1 })
      .limit(cap)
      .lean();
    return rows.map((r: any) => ({
      triggeredAt: new Date(r.triggeredAt).toISOString(),
      completedAt: r.completedAt ? new Date(r.completedAt).toISOString() : null,
      triggeredBy: r.triggeredBy ?? null,
      trigger: String(r.trigger ?? ''),
      affectedSlugs: Array.isArray(r.affectedSlugs) ? r.affectedSlugs : [],
      sitemapRebuild: docToStep(r.sitemapRebuild),
      indexnowSitemap: docToStep(r.indexnowSitemap),
      indexnowGenreUrls: docToStep(r.indexnowGenreUrls),
    }));
  } catch (err: any) {
    logger.error(
      'genre-whitelist-push-status: failed to read push history:',
      err?.message ?? err,
    );
    return [];
  }
}

function docToStep(raw: any): PushStepResult {
  const status: StepStatus =
    raw?.status === 'success' ||
    raw?.status === 'failed' ||
    raw?.status === 'skipped' ||
    raw?.status === 'pending'
      ? raw.status
      : 'pending';
  const out: PushStepResult = { status };
  if (raw?.error) out.error = String(raw.error);
  if (typeof raw?.urlCount === 'number') out.urlCount = raw.urlCount;
  return out;
}
