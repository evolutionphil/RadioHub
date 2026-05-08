// Tracks the outcome of the most recent "push the genre whitelist to
// search engines" operation triggered by an admin add/remove. The push
// runs as fire-and-forget after each whitelist mutation
// (see admin-genre-whitelist-routes.ts → triggerSearchEnginePush) and
// hits two outbound dependencies (sitemap rebuild + IndexNow pings) that
// can fail independently of the mutation itself. Surfacing this in the
// admin UI makes the success/failure of the push self-service instead of
// requiring a server-log dive (task #186).
//
// Module-level singleton: matches the in-memory pattern used by
// `genre-whitelist-store.getLastRefreshAt()`. State is reset on
// process restart, which is acceptable — admins can simply re-push.

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

let lastPushStatus: GenreWhitelistPushStatus | null = null;

export function getLastPushStatus(): GenreWhitelistPushStatus | null {
  return lastPushStatus;
}

export function startPushStatus(init: {
  triggeredBy: string | null;
  trigger: string;
  affectedSlugs: string[];
}): void {
  lastPushStatus = {
    triggeredAt: new Date().toISOString(),
    completedAt: null,
    triggeredBy: init.triggeredBy,
    trigger: init.trigger,
    affectedSlugs: init.affectedSlugs,
    sitemapRebuild: { status: 'pending' },
    indexnowSitemap: { status: 'pending' },
    indexnowGenreUrls: { status: 'pending' },
  };
}

export function updatePushStep(
  step: 'sitemapRebuild' | 'indexnowSitemap' | 'indexnowGenreUrls',
  result: PushStepResult,
): void {
  if (!lastPushStatus) return;
  lastPushStatus = { ...lastPushStatus, [step]: result };
}

export function completePushStatus(): void {
  if (!lastPushStatus) return;
  lastPushStatus = { ...lastPushStatus, completedAt: new Date().toISOString() };
}
