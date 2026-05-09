/**
 * Boot-time auto-runner for the duplicate-genre-slug cleanup (Task #368).
 *
 * Background:
 *   The companion script `scripts/cleanup-duplicate-genre-slugs.ts` was
 *   shipped as a one-shot CLI to unblock the partial unique index on
 *   `Genre.slug` (Task #210). If a future code path or a manual DB edit
 *   reintroduces a duplicate, the partial unique index will silently
 *   fail to build on the next deploy ("E11000 duplicate key on index:
 *   slug_1") and the safeguard will not be active — but nothing alerts
 *   us until someone notices.
 *
 *   The malformed-slug cleanup already runs on a weekly cron *and* has
 *   admin-triggered manual runs, but it does not look at pairs/groups
 *   of docs that already share the same valid slug. This module fills
 *   that gap by running the duplicate cleanup on every server boot,
 *   right after Mongo is connected and before downstream services that
 *   depend on a healthy index assume one exists.
 *
 * Behavior:
 *   1. Aggregates `Genre` to find slug groups with count > 1. When
 *      there are no duplicate groups, `runDuplicateGenreSlugCleanup`
 *      does no writes and the helper returns immediately — the
 *      operationally expensive work is skipped.
 *   2. Every boot run — including no-op boots — persists a single
 *      `GenreSlugCleanupRun` audit row with `trigger='boot:deploy'`
 *      so admins always have a complete inspectable history of boots
 *      under the existing maintenance dashboard, mirroring the row
 *      shape already used by the weekly cron and admin-manual runs.
 *      The row is one cheap insert, so the no-op path stays light.
 *   3. After a non-zero demotion, call `Genre.syncIndexes()` so Mongo
 *      can finally build the partial unique index that was blocked by
 *      the duplicates. Without this the safeguard would stay dormant
 *      until the next boot.
 *
 * Safety knobs:
 *   - `SKIP_DUPLICATE_GENRE_SLUG_CLEANUP_ON_BOOT=true` short-circuits
 *     this entirely. Useful for split deployments where only one
 *     replica should run the cleanup, or for emergency operational
 *     control.
 *   - In-process `hasRunOnce` guard prevents accidental re-entry from
 *     the same node (the boot path is awaited, but defense-in-depth
 *     keeps the contract simple).
 *
 * Errors are logged and swallowed — a regression here must never crash
 * the API boot.
 */

import {
  Genre,
  GenreSlugCleanupRun,
  type IGenreSlugCleanupRun,
} from '@workspace/db-shared/mongo-schemas';
import { logger } from '../utils/logger';
import { runDuplicateGenreSlugCleanup } from '../scripts/cleanup-duplicate-genre-slugs';
import { pruneOldGenreSlugCleanupRuns } from './scheduled-genre-slug-cleanup';

let hasRunOnce = false;

export async function maybeRunDuplicateGenreSlugCleanupOnBoot(): Promise<void> {
  if (hasRunOnce) {
    return;
  }
  hasRunOnce = true;

  if (process.env.SKIP_DUPLICATE_GENRE_SLUG_CLEANUP_ON_BOOT === 'true') {
    logger.log(
      '🧹 Duplicate genre-slug boot cleanup: SKIPPED (SKIP_DUPLICATE_GENRE_SLUG_CLEANUP_ON_BOOT=true)',
    );
    return;
  }

  const startedAt = new Date();
  logger.log('🧹 Duplicate genre-slug boot cleanup: START');

  let stats;
  try {
    stats = await runDuplicateGenreSlugCleanup({
      manageConnection: false,
      // Explicitly opt out of `DRY_RUN` env honoring — boot cleanup
      // must always perform its writes regardless of any operator env
      // intended for ad-hoc CLI invocations.
      dryRun: false,
      log: (m) => logger.log(m),
    });
  } catch (err) {
    logger.error(
      '❌ Duplicate genre-slug boot cleanup: FAILED during scan',
      err,
    );
    // Persist a failure row so the admin dashboard always sees the
    // broken boot run alongside the completed ones.
    const finishedAt = new Date();
    try {
      await GenreSlugCleanupRun.create({
        trigger: 'boot:deploy',
        status: 'failed',
        startedAt,
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        scanned: 0,
        alreadyValid: 0,
        normalized: 0,
        markedUndiscoverable: 0,
        emptySlugMarked: 0,
        collisionMarked: 0,
        errorCount: 1,
        rewarmed: false,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    } catch (auditErr) {
      logger.error(
        '⚠️  Duplicate genre-slug boot cleanup: failed to persist failure audit row',
        auditErr,
      );
    }
    // Apply retention even on failure so a flapping boot loop can't
    // grow the audit collection unbounded.
    await pruneOldGenreSlugCleanupRuns();
    return;
  }

  const finishedAt = new Date();
  let run: IGenreSlugCleanupRun | null = null;
  try {
    // Persist a single audit row for every boot — including the no-op
    // case (duplicateGroups=0) — so admins always have a complete
    // inspectable history of boot runs under the existing maintenance
    // dashboard. Map duplicate-cleanup stats into the existing
    // GenreSlugCleanupRun shape:
    //   - `scanned` mirrors the helper's "docs visited across all
    //     duplicate groups" counter (0 on no-op).
    //   - `collisionMarked` records the losers we demoted (the existing
    //     field used by the malformed cleanup for the same "another
    //     doc already owns this slug" outcome).
    //   - `errorCount` carries any per-doc demotion failures.
    // Volume on the no-op path is bounded by the existing
    // `pruneOldGenreSlugCleanupRuns` retention policy
    // (default: 90 days / 200 rows), so frequent restarts can't
    // grow the collection unbounded.
    run = await GenreSlugCleanupRun.create({
      trigger: 'boot:deploy',
      status: 'completed',
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      scanned: stats.scanned,
      alreadyValid: 0,
      normalized: 0,
      markedUndiscoverable: 0,
      emptySlugMarked: 0,
      collisionMarked: stats.losersDemoted,
      errorCount: stats.errors,
      rewarmed: false,
    });
  } catch (err) {
    logger.error(
      '⚠️  Duplicate genre-slug boot cleanup: failed to persist completion audit row',
      err,
    );
  }

  logger.log(
    `🧹 Duplicate genre-slug boot cleanup: DONE — ` +
      `duplicateGroups=${stats.duplicateGroups} ` +
      `winnersKept=${stats.winnersKept} losersDemoted=${stats.losersDemoted} ` +
      `errors=${stats.errors}` +
      (run ? ` runId=${String(run._id)}` : ''),
  );

  // After resolving duplicates, re-sync indexes so Mongo can finally
  // build the partial unique index on `Genre.slug` that the duplicates
  // had been blocking. Without this the safeguard stays dormant until
  // the next process restart. Best-effort — a sync failure here does
  // not invalidate the cleanup that just succeeded. Skipped on no-op
  // boots because the existing index is already buildable.
  if (stats.losersDemoted > 0) {
    try {
      await Genre.syncIndexes();
      logger.log(
        '🧹 Duplicate genre-slug boot cleanup: re-synced Genre indexes (partial unique slug index should now be active)',
      );
    } catch (err) {
      logger.error(
        '⚠️  Duplicate genre-slug boot cleanup: Genre.syncIndexes() failed after cleanup (non-fatal):',
        err,
      );
    }
  }

  // Apply retention so frequent restarts can't grow the audit
  // collection unbounded between weekly cron / admin-manual runs.
  // Best-effort and bounded by the same policy used by the scheduled
  // cleanup (default 90 days / 200 rows).
  await pruneOldGenreSlugCleanupRuns();
}
