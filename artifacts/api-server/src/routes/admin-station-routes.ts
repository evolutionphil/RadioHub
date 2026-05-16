import type { Express } from "express";
import express from "express";
import mongoose from "mongoose";
import multer from "multer";
import { Station, User, UserFollow, BlacklistedStation, UserFavorite, UserNotification, AnalyticsEvent, SyncLog, StationDebugLog, BulkDescriptionJob, CoverageSnapshot, AdminSetting, CoverageBackfillStatus, CoverageBackfillRun, SharedComparisonPreset } from '@workspace/db-shared/mongo-schemas';
import { logger } from "../utils/logger";
import { normalizeCountryFilter, resolveToDbName, dbNameToIso } from "../utils/normalize-country";
import { syncService } from "../services/sync";
import { PrecomputedStationsService } from "../services/precomputed-stations";
import { logoProcessor } from "../services/logo-processor";
import { isS3Url, isS3Configured } from "../services/s3-storage";
import { IndexNowService } from "../services/indexnow";
import CacheManager from "../cache";
import { getQuotaStatus } from "../utils/quota-guard";
import { performanceCache } from "../performance-cache";
import { stripPlaceholders } from "./shared-utils";
import { triggerGenreStationCountsRecompute } from "../services/genre-station-counts";
import {
  runCoverageBackfill,
  type RunCoverageBackfillProgress,
} from "../services/coverage-snapshot-backfill";
import { runCoverageBackfillNow } from "../services/coverage-backfill-on-boot";
import {
  clearAdminSettingWithHistory,
  listAdminSettingHistory,
  parseHistoryLimit,
  upsertAdminSettingWithHistory,
} from "../services/admin-setting-audit";

// AdminSetting key used to record the most recent coverage drop alert
// acknowledgement (Task #238). The stored value is keyed by snapshotDate
// so a newer alert automatically un-suppresses the banner.
const COVERAGE_DROP_ACK_KEY = 'coverage-drop-alert-ack';

const faviconUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

// In-memory progress tracker for bulk tag re-check jobs. Keyed by a
// generated jobId, with periodic cleanup of finished jobs so the map
// can't grow unbounded.
type RecheckTagsJob = {
  jobId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  total: number;
  processed: number;
  hydrated: number;
  emptyUpstream: number;
  failed: number;
  cleared: number;
  matched: number;
  scope?: string;
  startedAt: number;
  finishedAt?: number;
  error?: string;
  cancelRequested?: boolean;
  cancellable?: boolean;
};
const recheckTagsJobs = new Map<string, RecheckTagsJob>();
const RECHECK_TAGS_JOB_TTL_MS = 60 * 60 * 1000; // 1h after completion

// Task #490: in-memory tracker for the bulk auto-merge-all job. Kept
// process-local on purpose — these jobs only run for a few minutes and
// the admin UI polls every 1s, so persistence is unnecessary. If the
// API server restarts mid-job, the frontend's polling loop will see a
// 404 from /api/admin/merge-jobs/:jobId and surface the failure.
type MergeAllJobMergedStation = {
  groupName: string;
  primaryStation: { name: string; country: string };
  mergedStations: Array<{ name: string; votes: number; url: string }>;
  fallbackUrlsAdded: number;
  totalVotes: number;
};
type MergeAllJob = {
  jobId: string;
  status: 'running' | 'completed' | 'failed';
  dryRun: boolean;
  threshold: number;
  startedAt: number;
  finishedAt?: number;
  errorMessage?: string;
  progress: {
    currentStep: string;
    percentage: number;
    groupsProcessed: number;
    totalGroups: number;
  };
  results?: {
    message: string;
    mergedStations: MergeAllJobMergedStation[];
    errors: string[];
    // Convenience totals also used by the sync-fallback code path in
    // the frontend (autoMergeAll in duplicates.tsx ~line 658).
    totalGroups: number;
    mergedGroups: number;
    totalStationsToDelete: number;
    totalStationsDeleted: number;
  };
};
const mergeAllJobs = new Map<string, MergeAllJob>();
const MERGE_ALL_JOB_TTL_MS = 60 * 60 * 1000; // 1h after completion
function cleanupMergeAllJobs() {
  const now = Date.now();
  for (const [id, j] of mergeAllJobs) {
    if (j.finishedAt && now - j.finishedAt > MERGE_ALL_JOB_TTL_MS) {
      mergeAllJobs.delete(id);
    }
  }
}

async function runAutoMergeAllJob(jobId: string): Promise<void> {
  const job = mergeAllJobs.get(jobId);
  if (!job) return;

  // Step 1: detect duplicate groups using the same aggregation as
  // GET /api/admin/stations/duplicates so admins see exactly what the
  // Duplicates page just listed.
  const minLen = job.threshold >= 0.95 ? 1 : job.threshold >= 0.85 ? 3 : 4;
  type GroupStation = {
    _id: mongoose.Types.ObjectId;
    name: string;
    url: string;
    votes: number;
    country: string;
  };
  type DuplicateGroup = {
    _id: { name: string; country: string };
    count: number;
    stations: GroupStation[];
  };
  const groups = (await Station.aggregate([
    {
      $project: {
        _id: 1,
        name: 1,
        country: 1,
        url: 1,
        votes: 1,
        normalizedName: {
          $trim: { input: { $toLower: { $ifNull: ['$name', ''] } } },
        },
      },
    },
    { $match: { $expr: { $gte: [{ $strLenCP: '$normalizedName' }, minLen] } } },
    {
      $group: {
        _id: { name: '$normalizedName', country: { $ifNull: ['$country', ''] } },
        count: { $sum: 1 },
        stations: {
          $push: {
            _id: '$_id',
            name: '$name',
            url: '$url',
            votes: { $ifNull: ['$votes', 0] },
            country: '$country',
          },
        },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 500 },
  ]).option({ maxTimeMS: 20000, allowDiskUse: true })) as DuplicateGroup[];

  job.progress.totalGroups = groups.length;
  job.progress.currentStep = job.dryRun
    ? `Previewing ${groups.length} groups…`
    : `Merging ${groups.length} groups…`;
  job.progress.percentage = groups.length === 0 ? 100 : 1;

  const mergedStations: MergeAllJobMergedStation[] = [];
  const errors: string[] = [];
  let totalStationsToDelete = 0;
  let totalStationsDeleted = 0;
  let mergedGroups = 0;

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const groupLabel = group._id?.name || '(unnamed)';
    try {
      // Highest-voted wins. Stable on _id when tied for determinism.
      const sorted = [...group.stations].sort((a, b) => {
        const va = a.votes || 0;
        const vb = b.votes || 0;
        if (vb !== va) return vb - va;
        return String(a._id).localeCompare(String(b._id));
      });
      const primary = sorted[0];
      const duplicates = sorted.slice(1);
      if (!primary || duplicates.length === 0) continue;

      totalStationsToDelete += duplicates.length;
      const totalVotes = duplicates.reduce(
        (sum, s) => sum + (s.votes || 0),
        primary.votes || 0,
      );

      if (!job.dryRun) {
        type SlugOnly = { slug?: string | null };
        await Station.findByIdAndUpdate(primary._id, { votes: totalVotes });
        const primaryDoc = (await Station.findById(primary._id)
          .select('slug')
          .lean()) as SlugOnly | null;
        if (primaryDoc?.slug) {
          performanceCache.invalidateStationCache(primaryDoc.slug);
        }
        const dupDocs = (await Station.find({
          _id: { $in: duplicates.map((d) => d._id) },
        })
          .select('slug')
          .lean()) as SlugOnly[];
        for (const d of dupDocs) {
          if (d?.slug) performanceCache.invalidateStationCache(d.slug);
        }
        const delRes = await Station.deleteMany({
          _id: { $in: duplicates.map((d) => d._id) },
        });
        totalStationsDeleted += delRes?.deletedCount ?? duplicates.length;
      }

      mergedGroups += 1;
      mergedStations.push({
        groupName: groupLabel,
        primaryStation: {
          name: primary.name || groupLabel,
          country: primary.country || group._id?.country || '',
        },
        mergedStations: duplicates.map((d) => ({
          name: d.name || '',
          votes: d.votes || 0,
          url: d.url || '',
        })),
        // No fallback-URL persistence layer exists yet — surface 0 so
        // the UI line ("Added N fallback URL(s)") renders correctly
        // without lying about a feature that isn't wired up.
        fallbackUrlsAdded: 0,
        totalVotes,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${groupLabel}: ${msg}`);
      logger.error(
        `❌ auto-merge-all job ${jobId} failed on group "${groupLabel}": ${msg}`,
      );
    }

    job.progress.groupsProcessed = i + 1;
    job.progress.percentage = Math.round(((i + 1) / Math.max(groups.length, 1)) * 100);
    job.progress.currentStep = job.dryRun
      ? `Previewed ${i + 1}/${groups.length} groups`
      : `Merged ${i + 1}/${groups.length} groups`;
  }

  job.status = 'completed';
  job.finishedAt = Date.now();
  job.progress.percentage = 100;
  job.progress.currentStep = job.dryRun ? 'Dry run complete' : 'Merge complete';
  job.results = {
    message: job.dryRun
      ? `Dry run: would merge ${mergedGroups} group${mergedGroups === 1 ? '' : 's'}, removing ${totalStationsToDelete} duplicate station${totalStationsToDelete === 1 ? '' : 's'}.`
      : `Merged ${mergedGroups} group${mergedGroups === 1 ? '' : 's'}, deleted ${totalStationsDeleted} duplicate station${totalStationsDeleted === 1 ? '' : 's'}.`,
    mergedStations,
    errors,
    totalGroups: groups.length,
    mergedGroups,
    totalStationsToDelete,
    totalStationsDeleted,
  };
}
function cleanupRecheckTagsJobs() {
  const now = Date.now();
  for (const [jobId, job] of recheckTagsJobs) {
    if (job.finishedAt && now - job.finishedAt > RECHECK_TAGS_JOB_TTL_MS) {
      recheckTagsJobs.delete(jobId);
      recheckTagsJobSubscribers.delete(jobId);
    }
  }
}

// SSE subscribers for live recheck-job progress. Each entry holds the
// callbacks attached by an open `/recheck-tags-job-stream/:jobId`
// connection; they are invoked whenever the job's snapshot changes
// (per-batch progress or terminal status transition) so clients see
// updates instantly.
type RecheckTagsJobSubscriber = (job: RecheckTagsJob) => void;
const recheckTagsJobSubscribers = new Map<string, Set<RecheckTagsJobSubscriber>>();
function notifyRecheckTagsJobSubscribers(jobId: string) {
  const subs = recheckTagsJobSubscribers.get(jobId);
  if (!subs || subs.size === 0) return;
  const job = recheckTagsJobs.get(jobId);
  if (!job) return;
  for (const sub of Array.from(subs)) {
    try {
      sub(job);
    } catch (err) {
      logger.warn(`recheck-tags SSE subscriber threw: ${(err as Error)?.message}`);
    }
  }
}

// In-memory progress tracker for per-country coverage backfill jobs (the
// "Re-enqueue" buttons on the coverage page). Each job tracks the logo
// pipeline (driven by the scheduled-logo-processor sweeping the stations
// we just $unset) and the tags pipeline (the in-process Radio-Browser
// hydration). Logo progress is computed lazily on each status poll by
// counting how many of the originally-enqueued station IDs still lack a
// completed `logoAssets`. Tags progress is streamed from the helper's
// `onProgress` callback.
type CoverageBackfillJob = {
  jobId: string;
  countryCode: string;
  scope: 'logos' | 'tags' | 'both';
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: number;
  finishedAt?: number;
  error?: string;
  cancelRequested?: boolean;
  cancellable?: boolean;
  // Task #342: when this job was kicked off as a Resume of a previous
  // cancelled run for the same country, this is that cancelled run's
  // jobId. Lets the UI history panel draw a "resumed from …" link
  // between the two rows.
  resumedFromJobId?: string;
  logos?: {
    matched: number;
    enqueuedIds: string[];
    completed: number;
    remaining: number;
    done: boolean;
  };
  tags?: {
    total: number;
    processed: number;
    hydrated: number;
    emptyUpstream: number;
    failed: number;
    done: boolean;
    // Counters carried over from a recently-cancelled run for this same
    // country (Task #252). Present only on a resumed run so the UI / API
    // consumer can tell that `processed`/`hydrated` already include work
    // done by the cancelled predecessor instead of being a fresh 0/total.
    resumedFrom?: {
      processed: number;
      hydrated: number;
      emptyUpstream: number;
      failed: number;
      total: number;
    };
  };
};
const coverageBackfillJobs = new Map<string, CoverageBackfillJob>();
const COVERAGE_BACKFILL_JOB_TTL_MS = 60 * 60 * 1000; // 1h after completion

// Task #342: capped per-country ring buffer of finished backfill runs so
// admins can see which countries repeatedly stall (cancel → resume → cancel
// loops) instead of only the last toast. Kept in-process — same lifetime
// as `coverageBackfillJobs`. A fresh server boot starts with an empty
// history, which is fine: the page only needs short-term context to
// surface "this country keeps cancelling".
type CoverageBackfillRunRecord = {
  jobId: string;
  countryCode: string;
  scope: 'logos' | 'tags' | 'both';
  status: 'completed' | 'failed' | 'cancelled';
  startedAt: number;
  finishedAt: number;
  error?: string;
  // Same shape as the public job-status payload (no internal id arrays).
  logos?: {
    matched: number;
    enqueued: number;
    completed: number;
    remaining: number;
  };
  tags?: {
    total: number;
    processed: number;
    hydrated: number;
    emptyUpstream: number;
    failed: number;
  };
  // jobId of the cancelled run this one continued from (when applicable).
  resumedFromJobId?: string;
};
const COVERAGE_BACKFILL_HISTORY_MAX = 10;
const coverageBackfillHistory = new Map<string, CoverageBackfillRunRecord[]>();

function recordCoverageBackfillHistory(job: CoverageBackfillJob): void {
  if (
    job.status !== 'completed' &&
    job.status !== 'cancelled' &&
    job.status !== 'failed'
  ) {
    return;
  }
  const key = job.countryCode.toUpperCase();
  const existing = coverageBackfillHistory.get(key) ?? [];
  // Idempotent on repeated terminal recordings (e.g. logo poll +
  // maybeFinishCoverageJob both calling in).
  if (existing.some((r) => r.jobId === job.jobId)) return;
  const entry: CoverageBackfillRunRecord = {
    jobId: job.jobId,
    countryCode: key,
    scope: job.scope,
    status: job.status,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt ?? Date.now(),
    error: job.error,
    logos: job.logos
      ? {
          matched: job.logos.matched,
          enqueued: job.logos.enqueuedIds.length,
          completed: job.logos.completed,
          remaining: job.logos.remaining,
        }
      : undefined,
    tags: job.tags
      ? {
          total: job.tags.total,
          processed: job.tags.processed,
          hydrated: job.tags.hydrated,
          emptyUpstream: job.tags.emptyUpstream,
          failed: job.tags.failed,
        }
      : undefined,
    resumedFromJobId: job.resumedFromJobId,
  };
  const next = [entry, ...existing].slice(0, COVERAGE_BACKFILL_HISTORY_MAX);
  coverageBackfillHistory.set(key, next);
}

// Task #318: in-process tracker for the "Reconstruct sparkline history"
// runs. The seeder used to execute synchronously inside the HTTP request
// which timed out the UI on multi-month windows; it now runs in the
// background and the UI polls this map for per-day progress.
type CoverageReconstructionJob = {
  jobId: string;
  days: number;
  dryRun: boolean;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: number;
  finishedAt?: number;
  // Latest streamed progress (kept up to date inside the seeder's
  // onProgress callback).
  daysProcessed: number;
  daysTotal: number;
  daysSeeded: number;
  inserted: number;
  preserved: number;
  wouldWrite: number;
  currentDay: string | null;
  skippedReason?: 'no-stations';
  cancelRequested?: boolean;
  error?: string;
};
const coverageReconstructionJobs = new Map<string, CoverageReconstructionJob>();
const COVERAGE_RECONSTRUCTION_JOB_TTL_MS = 60 * 60 * 1000;
function cleanupCoverageReconstructionJobs() {
  const now = Date.now();
  for (const [id, job] of coverageReconstructionJobs) {
    if (
      job.finishedAt &&
      now - job.finishedAt > COVERAGE_RECONSTRUCTION_JOB_TTL_MS
    ) {
      coverageReconstructionJobs.delete(id);
    }
  }
}

// Task #252: when a coverage tags subjob is cancelled we stash its final
// counters (and the country it ran against) so a follow-up enqueue for the
// same country — typically fired by the Undo toast — can resume display
// from where the cancelled run left off instead of restarting at 0/total.
// The actual already-hydrated stations are skipped naturally by
// `hydrateMissingTagsInBackground`'s candidate filter (rows with non-empty
// `tags` or a recent `tagsCheckedAt` are excluded), so the hint is purely
// about carrying the visible progress / final totals across the gap.
type CoverageTagsResumeHint = {
  cancelledAt: number;
  total: number;
  processed: number;
  hydrated: number;
  emptyUpstream: number;
  failed: number;
  // Task #342: jobId of the cancelled run this hint was stashed from, so
  // a resumed run can record `resumedFromJobId` and the history panel
  // can chain rows together.
  cancelledJobId?: string;
};
const COVERAGE_TAGS_RESUME_TTL_MS = 5 * 60 * 1000;
const coverageTagsResumeHints = new Map<string, CoverageTagsResumeHint>();

function stashCoverageTagsResumeHint(
  countryCode: string,
  tags: {
    total: number;
    processed: number;
    hydrated: number;
    emptyUpstream: number;
    failed: number;
  },
  cancelledJobId?: string,
) {
  // Nothing to resume from if the cancelled run hadn't actually moved
  // the needle yet.
  if ((tags.processed ?? 0) <= 0 && (tags.hydrated ?? 0) <= 0) return;
  coverageTagsResumeHints.set(countryCode.toUpperCase(), {
    cancelledAt: Date.now(),
    total: tags.total ?? 0,
    processed: tags.processed ?? 0,
    hydrated: tags.hydrated ?? 0,
    emptyUpstream: tags.emptyUpstream ?? 0,
    failed: tags.failed ?? 0,
    cancelledJobId,
  });
}

function consumeCoverageTagsResumeHint(
  countryCode: string,
): CoverageTagsResumeHint | null {
  const key = countryCode.toUpperCase();
  const hint = coverageTagsResumeHints.get(key);
  if (!hint) return null;
  coverageTagsResumeHints.delete(key);
  if (Date.now() - hint.cancelledAt > COVERAGE_TAGS_RESUME_TTL_MS) return null;
  return hint;
}
function cleanupCoverageBackfillJobs() {
  const now = Date.now();
  for (const [jobId, job] of coverageBackfillJobs) {
    if (job.finishedAt && now - job.finishedAt > COVERAGE_BACKFILL_JOB_TTL_MS) {
      coverageBackfillJobs.delete(jobId);
    }
  }
}
function maybeFinishCoverageJob(job: CoverageBackfillJob) {
  const logosDone = !job.logos || job.logos.done;
  const tagsDone = !job.tags || job.tags.done;
  const wasRunning = job.status === 'running';
  if (logosDone && tagsDone && wasRunning) {
    // Task #185: a country backfill that touched tags can shift which
    // genres have stations under them — refresh Genre.stationCount so
    // the admin Genre Whitelist page doesn't show stale "thin" badges.
    if (job.tags) {
      triggerGenreStationCountsRecompute(`coverage-backfill:${job.countryCode ?? 'unknown'}`);
    }
    job.status = job.cancelRequested
      ? 'cancelled'
      : job.error
        ? 'failed'
        : 'completed';
    job.finishedAt = Date.now();
    // Task #342: snapshot the terminal run into the per-country history
    // ring buffer so the coverage page can show a short audit trail of
    // recent backfills (cancel → resume → cancel patterns, etc.).
    recordCoverageBackfillHistory(job);
  }
}

const STATION_UPDATE_ALLOWED_FIELDS = [
  'name', 'url', 'homepage', 'favicon', 'country', 'countryCode',
  'language', 'tags', 'bitrate', 'codec', 'hls', 'noIndex'
] as const;

function pickAllowedStationFields(body: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const key of STATION_UPDATE_ALLOWED_FIELDS) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  if (out.bitrate !== undefined && out.bitrate !== null && out.bitrate !== '') {
    const n = Number(out.bitrate);
    out.bitrate = Number.isFinite(n) ? n : undefined;
    if (out.bitrate === undefined) delete out.bitrate;
  } else if (out.bitrate === '') {
    delete out.bitrate;
  }
  if (typeof out.favicon === 'string') out.favicon = out.favicon.trim();
  if (typeof out.url === 'string') out.url = out.url.trim();
  if (typeof out.homepage === 'string') out.homepage = out.homepage.trim();
  if (typeof out.name === 'string') out.name = out.name.trim();
  return out;
}

interface RouteDeps {
  requireAuth: any;
  requireAdmin: any;
  stripPlaceholders?: (obj: any) => any;
}

export function registerAdminStationRoutes(app: Express, deps: RouteDeps) {
  const { requireAdmin } = deps;

  // 2026-05-15: manual on-demand trigger for the nightly Radio-Browser sync.
  // Same code path as the 03:00 Berlin cron (`scheduledStationSync.runOnce`)
  // — pulls the full station dump, updates whitelisted fields including
  // `votes` and `clickCount`, then rebuilds sitemap manifests and pings
  // IndexNow. Use this when votes look stale (e.g. Power Pop showing 9.6k
  // locally vs 10450 on Radio-Browser) without waiting until 03:00.
  app.post("/api/admin/sync/run-now", requireAdmin, async (_req, res) => {
    try {
      const { scheduledStationSync } = await import('../services/scheduled-station-sync');
      const status = scheduledStationSync.getStatus();
      if (status.isRunning) {
        return res.status(409).json({
          ok: false,
          message: 'Station sync already in progress',
          status,
        });
      }
      // Fire-and-forget: full sync takes minutes. Return 202 immediately so
      // the admin UI doesn't hang on the request.
      scheduledStationSync.runOnce('admin-trigger').catch((err) => {
        logger.error('Manual station sync (admin-trigger) crashed:', err);
      });
      return res.status(202).json({
        ok: true,
        message: 'Station sync triggered. Poll GET /api/admin/sync/status for completion.',
      });
    } catch (err: any) {
      logger.error('admin/sync/run-now failed:', err);
      return res.status(500).json({ ok: false, message: err?.message ?? 'unknown_error' });
    }
  });

  // Status of the most recent (or in-progress) Radio-Browser sync.
  app.get("/api/admin/sync/status", requireAdmin, async (_req, res) => {
    try {
      const { scheduledStationSync } = await import('../services/scheduled-station-sync');
      return res.json({ ok: true, status: scheduledStationSync.getStatus() });
    } catch (err: any) {
      return res.status(500).json({ ok: false, message: err?.message ?? 'unknown_error' });
    }
  });

  // DATA SYNC UTILITY - Fix follower counts for all users
  app.post("/api/admin/sync-follower-counts", requireAdmin, async (req, res) => {
    try {
      // Compute follower and following counts via aggregation (single query each)
      const [followersAgg, followingAgg] = await Promise.all([
        UserFollow.aggregate([
          { $group: { _id: '$followingUserId', count: { $sum: 1 } } }
        ]),
        UserFollow.aggregate([
          { $group: { _id: '$userId', count: { $sum: 1 } } }
        ])
      ]);

      const followersMap = new Map(followersAgg.map((r: any) => [String(r._id), r.count]));
      const followingMap = new Map(followingAgg.map((r: any) => [String(r._id), r.count]));

      // Build bulk update using aggregated data — no per-user queries
      const BATCH = 1000;
      let skip = 0;
      let syncedUsers = 0;

      while (true) {
        const users = await User.find({})
          .select('_id followersCount followingCount')
          .skip(skip)
          .limit(BATCH)
          .lean();
        if (users.length === 0) break;

        const bulkOps = users
          .map((user: any) => {
            const actualFollowers = followersMap.get(String(user._id)) ?? 0;
            const actualFollowing = followingMap.get(String(user._id)) ?? 0;
            if (user.followersCount === actualFollowers && user.followingCount === actualFollowing) return null;
            syncedUsers++;
            return {
              updateOne: {
                filter: { _id: user._id },
                update: { $set: { followersCount: actualFollowers, followingCount: actualFollowing } }
              }
            };
          })
          .filter(Boolean);

        if (bulkOps.length > 0) await User.bulkWrite(bulkOps as any[]);
        skip += BATCH;
        if (users.length < BATCH) break;
      }

      const totalUsers = skip; // approximate
      res.json({ success: true, message: `Synchronized ${syncedUsers} users`, totalUsers, syncedUsers, errors: 0 });
    } catch (error) {
      res.status(500).json({ error: 'Failed to sync follower counts' });
    }
  });

  // ADMIN STATIONS API - Paginated stations for admin interface
  app.get('/api/admin/stations', requireAdmin, async (req, res) => {
    try {
      logger.log(`📋 Admin stations request - Session ID: ${req.sessionID}, Query: ${JSON.stringify(req.query)}`);
      const { 
        page = 1, 
        limit = 50, 
        search = '', 
        country = '', 
        language = '', 
        genre = '',
        hasDescriptions = 'all',
        tagsStatus = 'all',
        sortBy = 'name',
        sortOrder = 'asc'
      } = req.query;
      
      const cacheKey = `admin_stations:${JSON.stringify({
        page: String(page),
        limit: String(limit),
        search: String(search),
        country: String(country),
        language: String(language),
        genre: String(genre),
        hasDescriptions: String(hasDescriptions),
        tagsStatus: String(tagsStatus),
        sortBy: String(sortBy),
        sortOrder: String(sortOrder)
      })}`;
      
      const cachedResult = await CacheManager.get(cacheKey);
      if (cachedResult) {
        return void res.json(cachedResult);
      }
      
      const filter: any = {};
      
      if (search && search !== '') {
        filter.$or = [
          { name: { $regex: new RegExp(search as string, 'i') } },
          { country: { $regex: new RegExp(search as string, 'i') } },
          { tags: { $regex: new RegExp(search as string, 'i') } }
        ];
      }
      
      if (country && country !== '' && country !== 'all') {
        Object.assign(filter, normalizeCountryFilter(country as string));
      }
      
      if (language && language !== '' && language !== 'all') {
        filter.language = { $regex: new RegExp(language as string, 'i') };
      }
      
      if (genre && genre !== '' && genre !== 'all') {
        filter.tags = { $regex: new RegExp(genre as string, 'i') };
      }
      
      if (tagsStatus && tagsStatus !== '' && tagsStatus !== 'all') {
        // Empty-tags predicate: tags missing, null, or empty/whitespace-only string
        const emptyTagsPredicate = {
          $or: [
            { tags: { $exists: false } },
            { tags: null },
            { tags: '' },
            { tags: { $regex: /^\s*$/ } },
          ],
        };
        const tagsAndConds: any[] = filter.$and || [];
        if (tagsStatus === 'empty-cooldown') {
          // Stations whose Radio-Browser re-check returned empty AND are still
          // inside the 30-day cooldown window — i.e. stuck waiting for the
          // upstream to publish tags before the background hydration job will
          // re-query them.
          const cooldownCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
          tagsAndConds.push(emptyTagsPredicate);
          tagsAndConds.push({ tagsCheckedAt: { $gte: cooldownCutoff } });
          filter.$and = tagsAndConds;
        } else if (tagsStatus === 'never-checked') {
          // Tagless stations the background job has never re-checked yet.
          tagsAndConds.push(emptyTagsPredicate);
          tagsAndConds.push({
            $or: [
              { tagsCheckedAt: { $exists: false } },
              { tagsCheckedAt: null },
            ],
          });
          filter.$and = tagsAndConds;
        }
      }

      if (hasDescriptions && hasDescriptions !== 'all') {
        if (hasDescriptions === 'yes') {
          filter.$and = [
            ...(filter.$and || []),
            { descriptions: { $exists: true, $type: 'object' } },
            { $expr: { $gt: [{ $size: { $objectToArray: { $ifNull: ['$descriptions', {}] } } }, 0] } }
          ];
        } else if (hasDescriptions === 'no') {
          filter.$or = [
            ...(filter.$or || []),
            { descriptions: { $exists: false } },
            { descriptions: null },
            { descriptions: {} },
            { $expr: { $eq: [{ $size: { $objectToArray: { $ifNull: ['$descriptions', {}] } } }, 0] } }
          ];
        } else if (hasDescriptions === 'partial') {
          filter.$and = [
            ...(filter.$and || []),
            { descriptions: { $exists: true, $type: 'object' } },
            { $expr: { 
              $and: [
                { $gt: [{ $size: { $objectToArray: { $ifNull: ['$descriptions', {}] } } }, 0] },
                { $lt: [{ $size: { $objectToArray: { $ifNull: ['$descriptions', {}] } } }, 14] }
              ]
            }}
          ];
        }
      }
      
      const total = await Station.countDocuments(filter);
      
      let stations: any = [];
      
      if (sortBy === 'favicon') {
        const skip = (Number(page) - 1) * Number(limit);
        const lim = Number(limit);
        const pipeline: any[] = [];
        if (Object.keys(filter).length > 0) {
          pipeline.push({ $match: filter });
        }
        pipeline.push({
          $addFields: {
            hasFavicon: {
              $cond: {
                if: {
                  $and: [
                    { $ne: ['$favicon', null] },
                    { $ne: ['$favicon', ''] },
                    { $gt: [{ $strLenCP: { $ifNull: ['$favicon', ''] } }, 5] }
                  ]
                },
                then: 1,
                else: 0
              }
            }
          }
        });
        const faviconSortDir = sortOrder === 'asc' ? -1 : 1;
        pipeline.push({ $sort: { hasFavicon: faviconSortDir, name: 1 } });
        pipeline.push({ $skip: skip });
        pipeline.push({ $limit: lim });
        pipeline.push({ $project: { hasFavicon: 0 } });
        stations = await Station.aggregate(pipeline).allowDiskUse(true);
      } else {
        const sort: any = {};
        sort[sortBy as string] = sortOrder === 'asc' ? 1 : -1;
        
        stations = await Station.find(filter)
          .sort(sort)
          .skip((Number(page) - 1) * Number(limit))
          .limit(Number(limit))
          .lean();
      }
      
      const result = {
        stations: stripPlaceholders(stations),
        total,
        page: Number(page),
        totalPages: Math.ceil(total / Number(limit))
      };
      
      await CacheManager.set(cacheKey, result, { ttl: 86400 });
      res.json(result);
    } catch (error: any) {
      logger.error(`Error in /api/admin/stations: ${error?.message || error}`);
      if (error?.stack) logger.error(error.stack.split('\n').slice(0, 5).join('\n'));
      res.status(500).json({ error: 'Failed to fetch stations', details: error?.message || 'Unknown error' });
    }
  });

  // TAGS-STATUS SUMMARY - Count stations stuck in the 30-day Radio-Browser
  // empty-tag cooldown (and the never-checked tagless bucket) so the admin UI
  // can surface a live KPI without applying the filter manually.
  app.get('/api/admin/stations/tags-status-summary', requireAdmin, async (req, res) => {
    try {
      const cacheKey = 'admin:stations:tags-status-summary';
      const cached = await CacheManager.get(cacheKey);
      if (cached) {
        return void res.json(cached);
      }

      const emptyTagsPredicate = {
        $or: [
          { tags: { $exists: false } },
          { tags: null },
          { tags: '' },
          { tags: { $regex: /^\s*$/ } },
        ],
      };
      const cooldownCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const [emptyCooldown, neverChecked] = await Promise.all([
        Station.countDocuments({
          $and: [emptyTagsPredicate, { tagsCheckedAt: { $gte: cooldownCutoff } }],
        }),
        Station.countDocuments({
          $and: [
            emptyTagsPredicate,
            {
              $or: [
                { tagsCheckedAt: { $exists: false } },
                { tagsCheckedAt: null },
              ],
            },
          ],
        }),
      ]);

      const result = { emptyCooldown, neverChecked };
      await CacheManager.set(cacheKey, result, { ttl: 300 });
      res.json(result);
    } catch (error: any) {
      logger.error(`Error in /api/admin/stations/tags-status-summary: ${error?.message || error}`);
      res.status(500).json({ error: 'Failed to fetch tags status summary' });
    }
  });

  // PRECOMPUTED ADMIN API - Status and triggers
  app.get('/api/admin/precomputed/status', requireAdmin, async (req, res) => {
    try {
      const status = PrecomputedStationsService.getCacheStats();
      res.json(status);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch precomputed status' });
    }
  });

  app.post('/api/admin/precomputed/refresh', requireAdmin, async (req, res) => {
    try {
      const { countryCode } = req.body;
      if (!countryCode) return void res.status(400).json({ error: 'countryCode is required' });
      
      res.json({ success: true, message: `Refresh started for ${countryCode}` });
      
      setImmediate(async () => {
        try {
          await PrecomputedStationsService.computeCountryStations(countryCode);
        } catch (err) {
          logger.error(`Error refreshing precomputed for ${countryCode}:`, err);
        }
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to start refresh' });
    }
  });

  // WORKING STATIONS API - Admin only diagnostic
  app.get("/api/admin/working-stations", requireAdmin, async (req, res) => {
    try {
      const { limit = 100 } = req.query;
      const stations = await Station.find({ lastCheckOk: true })
        .limit(Number(limit))
        .select('name url lastCheckOk')
        .lean();
      res.json(stations);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch working stations' });
    }
  });

  // SEED TEST NOTIFICATIONS - Creates new_station notifications for top stations (for testing)
  app.post("/api/admin/seed-notifications", requireAdmin, async (req, res) => {
    try {
      const topStations = await Station.find({})
        .select('_id name favicon slug country')
        .sort({ votes: -1 })
        .limit(10)
        .lean();
      
      const activeUsers = await User.find({}).select('_id').lean();
      
      let created = 0;
      for (const station of topStations) {
        for (const user of activeUsers) {
          const existing = await UserNotification.findOne({
            userId: user._id,
            type: 'new_station',
            'data.stationId': station._id
          });
          
          if (!existing) {
            const daysAgo = Math.floor(Math.random() * 9) + 1;
            const notificationDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
            
            await UserNotification.create({
              userId: user._id,
              type: 'new_station',
              title: `${station.name} Added`,
              message: 'New radio station added. Click to listen!',
              data: {
                stationId: station._id,
                stationSlug: station.slug,
                stationFavicon: station.favicon,
                stationCountry: station.country
              },
              read: false,
              createdAt: notificationDate
            });
            created++;
          }
        }
      }
      
      res.json({ success: true, created, stations: topStations.length, users: activeUsers.length });
    } catch (error: any) {
      console.error('Error seeding notifications:', error);
      res.status(500).json({ error: 'Failed to seed notifications' });
    }
  });

  // STATION FAVICON UPLOAD - Direct multipart upload → AWS S3 via logoProcessor
  // POST /api/admin/stations/:id/upload-favicon (multipart/form-data, field: 'favicon')
  app.post(
    "/api/admin/stations/:id/upload-favicon",
    requireAdmin,
    (req, res, next) => {
      faviconUpload.single('favicon')(req, res, (err: any) => {
        if (err) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return void res.status(413).json({ error: 'File too large. Max 5MB.' });
          }
          return void res.status(400).json({ error: err.message || 'Invalid upload' });
        }
        next();
      });
    },
    async (req: any, res) => {
      try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
          return void res.status(400).json({ error: 'Invalid station id' });
        }
        if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
          return void res.status(400).json({ error: 'No favicon file uploaded (field name: favicon)' });
        }

        const station = await Station.findById(id).select('_id slug name').lean();
        if (!station) return void res.status(404).json({ error: 'Station not found' });

        const slug = (station as any).slug || (station as any).name?.toLowerCase().replace(/\s+/g, '-') || String(station._id);

        const result = await logoProcessor.processFromBuffer(
          String(station._id),
          slug,
          req.file.buffer,
          req.file.originalname || 'upload.png'
        );

        if (!result.success) {
          return void res.status(422).json({ error: result.error || 'Logo processing failed' });
        }

        const updated = await Station.findById(id).select('_id slug favicon logoAssets').lean();
        const newFaviconUrl = (updated as any)?.logoAssets?.webp256
          || (updated as any)?.logoAssets?.original
          || (updated as any)?.favicon
          || '';

        // Mirror processed S3 URL into the favicon field so the visible URL is also S3
        if (newFaviconUrl && isS3Url(newFaviconUrl)) {
          await Station.updateOne({ _id: id }, { $set: { favicon: newFaviconUrl } });
        }

        if ((station as any).slug) {
          performanceCache.invalidateStationCache((station as any).slug);
        }

        // Surface S3 configuration status so admin UI can warn when logo
        // landed only on Railway's ephemeral disk (lost on next redeploy).
        const s3Ok = isS3Configured();
        const warning = s3Ok ? undefined : 'S3 not configured — logo stored on ephemeral Railway disk and will be lost on next redeploy. Configure AWS_BUCKET_NAME / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY.';
        if (!s3Ok) {
          logger.warn(`⚠️ Favicon upload for station ${id} (${slug}) used local-disk fallback (S3 not configured)`);
        }

        return void res.json({
          success: true,
          favicon: newFaviconUrl,
          logoAssets: (updated as any)?.logoAssets || null,
          folder: result.folder,
          backedUpToS3: s3Ok && !!newFaviconUrl && isS3Url(newFaviconUrl),
          warning,
        });
      } catch (error: any) {
        logger.error(`Favicon upload failed: ${error.message}`);
        return void res.status(500).json({ error: error.message || 'Upload failed' });
      }
    }
  );

  // STATION UPDATE - Edit station metadata (Admin only)
  // PUT /api/stations/:stationId   (frontend updateMutation hits this exact path)
  app.put("/api/stations/:stationId", requireAdmin, express.json({ limit: '1mb' }), async (req, res) => {
    try {
      const { stationId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(stationId)) {
        return void res.status(400).json({ error: 'Invalid station id' });
      }

      const update = pickAllowedStationFields(req.body || {});
      if (Object.keys(update).length === 0) {
        return void res.status(400).json({ error: 'No editable fields provided' });
      }

      const before = await Station.findById(stationId).select('_id slug favicon logoAssets').lean();
      if (!before) return void res.status(404).json({ error: 'Station not found' });

      const updated = await Station.findByIdAndUpdate(
        stationId,
        { $set: update },
        { returnDocument: 'after', runValidators: false }
      ).lean();

      // If favicon URL changed AND it's not already an S3 URL → mirror it to S3 in background.
      // ALSO retry the mirror when the URL is unchanged but the previous mirror
      // attempt failed (logoAssets.status === 'failed') — otherwise admins have
      // no way to retry a failed logo without first changing the URL.
      // The mirror also atomically swaps station.favicon → S3 URL on success
      // (see logo-processor.ts processFromUrl), so the dış URL only ever lives
      // in the DB for the few seconds it takes to download + resize + upload.
      const newFavicon = (updated as any)?.favicon;
      const oldFavicon = (before as any)?.favicon;
      const previousLogoStatus = (before as any)?.logoAssets?.status;
      const shouldRetryFailedMirror =
        newFavicon === oldFavicon && previousLogoStatus === 'failed';
      if (
        newFavicon &&
        typeof newFavicon === 'string' &&
        newFavicon.startsWith('http') &&
        (newFavicon !== oldFavicon || shouldRetryFailedMirror) &&
        !isS3Url(newFavicon)
      ) {
        const slug = (updated as any).slug || String((updated as any)._id);
        const stationIdStr = String((updated as any)._id);
        // Fire-and-forget mirror to S3 — log failures so admin can re-trigger
        // by saving again. logoAssets.status='failed' is also persisted by the
        // processor itself for UI visibility.
        logoProcessor.processFromUrl(stationIdStr, slug, newFavicon)
          .then((r) => {
            if (!r.success) {
              logger.warn(`⚠️ S3 mirror failed for station ${stationIdStr} (${slug}): ${r.error || 'unknown'} (failureType=${r.failureType || 'unknown'}); favicon kept as external URL`);
            }
          })
          .catch((err: any) => {
            logger.error(`❌ S3 mirror exception for station ${stationIdStr} (${slug}): ${err?.message || err}`);
          });
      }

      if ((updated as any)?.slug) {
        performanceCache.invalidateStationCache((updated as any).slug);
      }

      return void res.json({ success: true, station: updated });
    } catch (error: any) {
      logger.error(`Station update failed: ${error.message}`);
      return void res.status(500).json({ error: error.message || 'Update failed' });
    }
  });

  // BATCH STATION LOADING ENDPOINT - Performance Optimization
  app.post("/api/stations/batch", async (req, res) => {
    try {
      const { stationIds } = req.body;
      if (!Array.isArray(stationIds) || stationIds.length === 0) {
        return void res.status(400).json({ error: 'stationIds array is required' });
      }
      if (stationIds.length > 50) {
        return void res.status(400).json({ error: 'Maximum 50 stations per batch request' });
      }

      const sortedIds = [...stationIds].sort();
      const cacheKey = `stations:batch:${sortedIds.join(',')}`;
      const cached = await CacheManager.get(cacheKey);
      if (cached) return void res.json(cached);

      const stations = await Station.find({ _id: { $in: stationIds } }).lean();
      const stationMap = stations.reduce((acc: any, station: any) => {
        acc[station._id.toString()] = station;
        return acc;
      }, {});

      await CacheManager.set(cacheKey, stationMap, { ttl: 300 });
      res.json(stationMap);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch stations' });
    }
  });

  // BULK IMPORT ENDPOINT - Import stations from Radio Browser API (Admin Only)
  app.post("/api/admin/bulk-import-stations", express.json({ limit: '50mb' }), requireAdmin, async (req, res) => {
    try {
      logger.log('🔄 Starting bulk station import...');
      const { stations, append = false, skipIndexes = false } = req.body;
      if (!stations || !Array.isArray(stations)) {
        return void res.status(400).json({ error: 'Invalid stations array' });
      }
      
      if (req.body.clearOnly) {
        try {
          await Station.collection.drop();
          logger.log('✅ Database cleared');
        } catch (dropError) {}
        return void res.json({ success: true, message: 'Database cleared' });
      }
      
      if (!append) {
        try {
          await Station.collection.drop();
        } catch (dropError) {}
      }
      
      const BATCH_SIZE = 1000;
      let insertedCount = 0;
      for (let i = 0; i < stations.length; i += BATCH_SIZE) {
        const batch = stations.slice(i, i + BATCH_SIZE);
        const cleanBatch = batch.map((station: any) => {
          const { language, ...cleanStation } = station;
          return cleanStation;
        });
        try {
          await Station.insertMany(cleanBatch, { ordered: false });
          insertedCount += batch.length;
        } catch (batchError) {}
      }
      
      if (!append && !skipIndexes) {
        try {
          await Station.collection.createIndex({ country: 1 }, { background: true });
          await Station.collection.createIndex({ votes: -1 }, { background: true });
          await Station.collection.createIndex({ hls: 1 }, { background: true });
        } catch (indexError) {}
      }
      
      // Task #185: a bulk import flips most genres' station counts at once.
      // Refresh Genre.stationCount in the background so the admin Genre
      // Whitelist page reflects the new totals on its next poll instead of
      // showing pre-import "thin" / "no matching stations" badges.
      triggerGenreStationCountsRecompute('bulk-import-stations');

      const finalCount = await Station.countDocuments();
      const hlsCount = await Station.countDocuments({ hls: true });
      const mp3Count = await Station.countDocuments({ format: 'MP3' });
      const aacCount = await Station.countDocuments({ format: 'AAC' });
      const oggCount = await Station.countDocuments({ format: 'OGG' });
      const otherCount = await Station.countDocuments({ format: 'Other' });
      
      res.json({
        success: true,
        totalImported: finalCount,
        formatBreakdown: { HLS: hlsCount, MP3: mp3Count, AAC: aacCount, OGG: oggCount, Other: otherCount },
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      res.status(500).json({ error: 'Bulk import failed', details: error.message });
    }
  });

  // DELETE STATION ENDPOINT (Admin Only)
  app.delete("/api/stations/:stationId", requireAdmin, async (req, res) => {
    try {
      const { stationId } = req.params;
      const station = await Station.findById(stationId);
      if (!station) return void res.status(404).json({ error: 'Station not found' });
      
      let blacklisted = false;
      try {
        await BlacklistedStation.create({
          stationUuid: station.stationuuid,
          url: station.url,
          name: station.name,
          reason: 'Admin deletion',
          deletedBy: 'admin',
          radioBrowserId: station.changeUuid,
        });
        blacklisted = true;
      } catch (blacklistError) {}
      
      if (station.slug) performanceCache.invalidateStationCache(station.slug);
      await Station.findByIdAndDelete(stationId);
      await UserFavorite.deleteMany({ stationId: stationId });
      
      await CacheManager.clearByPattern('popular_stations');
      await CacheManager.clearByPattern('stations');
      await CacheManager.clearByPattern('genres');
      await CacheManager.clearByPattern('community_favorites');

      if (blacklisted) {
        const actorEmail =
          (req.user as { email?: string } | undefined)?.email ?? undefined;
        void import('../services/admin-audit-email')
          .then(({ emailBlacklistChangesCsv }) =>
            emailBlacklistChangesCsv({
              action: 'add',
              source: 'single deletion',
              rows: [
                {
                  name: station.name ?? '',
                  url: station.url ?? '',
                  stationUuid: station.stationuuid,
                  country: (station as any).country ?? '',
                  countryCode: (station as any).countrycode ?? '',
                  reason: 'Admin deletion',
                },
              ],
              actorEmail,
            }),
          )
          .catch((err) => {
            logger.error({ err }, 'Failed to send blacklist audit email');
          });
      }

      res.json({ success: true, message: 'Station deleted successfully and added to blacklist' });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to delete station' });
    }
  });

  // DUPLICATES DETECTION ENDPOINT (Admin Only)
  // Task #485: the admin "Detect Duplicates" page calls this endpoint to
  // group stations that share the same normalized name + country (or the
  // same stream URL) so they can be merged or bulk-deleted. The previous
  // build had no handler, so the SPA catch-all returned the index.html
  // shell — which the page tried to JSON.parse and then walked through
  // `new URL(station.favicon)`, surfacing the Safari "The string did not
  // match the expected pattern" error to the user.
  //
  // Response shape (matches duplicates.tsx expectations):
  //   { duplicates: [{ _id: {name, country} | string, count, stations: [...] }],
  //     total: number, totalStations: number }
  //
  // Public read soft-fail rule does NOT apply here (admin-only, behind
  // requireAdmin) — surface real errors so the admin can act on them.
  app.get("/api/admin/stations/duplicates", requireAdmin, async (req, res) => {
    try {
      const thresholdRaw = parseFloat(String(req.query.threshold ?? '0.85'));
      const threshold = Number.isFinite(thresholdRaw)
        ? Math.min(1, Math.max(0, thresholdRaw))
        : 0.85;
      const minLen = threshold >= 0.95 ? 1 : threshold >= 0.85 ? 3 : 4;

      const totalStations = await Station.estimatedDocumentCount();

      // Group by normalized name + country. We deliberately stay on the
      // simple, deterministic name-equality strategy (case + whitespace
      // insensitive) instead of full fuzzy matching: it's fast, predictable,
      // and matches what the merge UI already does. The threshold knob still
      // gates the minimum normalized-name length so very short names ("FM",
      // "Mix") don't dominate the result.
      const groups = await Station.aggregate([
        {
          $project: {
            _id: 1,
            name: 1,
            country: 1,
            url: 1,
            urlResolved: 1,
            votes: 1,
            playbackSuccessCount: 1,
            lastCheckOk: 1,
            favicon: 1,
            localImagePath: 1,
            normalizedName: {
              $trim: {
                input: { $toLower: { $ifNull: ['$name', ''] } },
              },
            },
          },
        },
        {
          $match: {
            $expr: { $gte: [{ $strLenCP: '$normalizedName' }, minLen] },
          },
        },
        {
          $group: {
            _id: { name: '$normalizedName', country: { $ifNull: ['$country', ''] } },
            count: { $sum: 1 },
            stations: {
              $push: {
                _id: '$_id',
                name: '$name',
                url: '$url',
                urlResolved: '$urlResolved',
                votes: { $ifNull: ['$votes', 0] },
                playbackSuccessCount: { $ifNull: ['$playbackSuccessCount', 0] },
                lastCheckOk: { $ifNull: ['$lastCheckOk', false] },
                favicon: '$favicon',
                localImagePath: '$localImagePath',
                country: '$country',
              },
            },
          },
        },
        { $match: { count: { $gt: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 500 },
      ]).option({ maxTimeMS: 20000, allowDiskUse: true });

      // Strip null/empty favicons so the frontend never tries to
      // `new URL("")` (the actual source of the Safari pattern-mismatch
      // error). The frontend already tolerates a missing favicon.
      const sanitized = groups.map((g: any) => ({
        _id: { name: g._id?.name ?? '', country: g._id?.country ?? '' },
        count: g.count,
        stations: (g.stations || []).map((s: any) => ({
          ...s,
          favicon:
            typeof s.favicon === 'string' && /^https?:\/\//i.test(s.favicon.trim())
              ? s.favicon.trim()
              : undefined,
        })),
      }));

      res.set('Cache-Control', 'no-store');
      res.json({
        duplicates: sanitized,
        total: sanitized.length,
        totalStations,
        threshold,
      });
    } catch (error: any) {
      logger.error(
        `❌ /api/admin/stations/duplicates failed: code=${error?.code || 'unknown'} msg=${error?.message || error}`,
      );
      res.status(500).json({
        error: 'Failed to detect duplicates',
        details: error?.message || String(error),
      });
    }
  });

  // BULK AUTO-MERGE EVERY DUPLICATE GROUP (Task #490)
  //
  // Companion to GET /api/admin/stations/duplicates. Enqueues an in-process
  // async job that walks every duplicate group (same name+country grouping
  // as the detection endpoint) and either previews (dryRun) or actually
  // merges each one — keeping the highest-voted station as primary,
  // summing votes, and deleting the rest. Progress is exposed via
  // GET /api/admin/merge-jobs/:jobId so the frontend can poll for a
  // running percentage and a final results summary.
  //
  // Frontend contract (artifacts/megaradio/src/pages/admin/duplicates.tsx
  // `pollJobStatus` ~line 530): the polled job document must expose
  //   { status: 'running'|'completed'|'failed',
  //     progress: { currentStep, percentage, groupsProcessed, totalGroups },
  //     results?: { message, mergedStations: [{ groupName,
  //       primaryStation: { name, country },
  //       mergedStations: [{ name, votes, url }],
  //       fallbackUrlsAdded, totalVotes }], errors: string[] },
  //     errorMessage?: string }
  app.post("/api/admin/auto-merge-all", requireAdmin, async (req, res) => {
    try {
      const thresholdRaw = parseFloat(String(req.body?.threshold ?? '0.85'));
      const threshold = Number.isFinite(thresholdRaw)
        ? Math.min(1, Math.max(0, thresholdRaw))
        : 0.85;
      const dryRun = req.body?.dryRun !== false; // default to safe preview

      const jobId = new mongoose.Types.ObjectId().toString();
      const job: MergeAllJob = {
        jobId,
        status: 'running',
        dryRun,
        threshold,
        startedAt: Date.now(),
        progress: {
          currentStep: 'Detecting duplicate groups…',
          percentage: 0,
          groupsProcessed: 0,
          totalGroups: 0,
        },
      };
      mergeAllJobs.set(jobId, job);
      cleanupMergeAllJobs();

      // Fire-and-forget — errors are captured into the job record.
      void runAutoMergeAllJob(jobId).catch((err) => {
        const j = mergeAllJobs.get(jobId);
        if (!j) return;
        j.status = 'failed';
        j.errorMessage = err?.message || String(err);
        j.finishedAt = Date.now();
        logger.error(
          `❌ /api/admin/auto-merge-all job ${jobId} crashed: ${j.errorMessage}`,
        );
      });

      return void res.json({ success: true, async: true, jobId });
    } catch (error: any) {
      logger.error(
        `❌ /api/admin/auto-merge-all failed to enqueue: ${error?.message || error}`,
      );
      return void res
        .status(500)
        .json({ success: false, error: error?.message || 'Failed to start auto-merge' });
    }
  });

  // Polling endpoint for bulk merge job progress (Task #490).
  app.get("/api/admin/merge-jobs/:jobId", requireAdmin, (req, res) => {
    const { jobId } = req.params as { jobId: string };
    const job = mergeAllJobs.get(jobId);
    if (!job) {
      return void res.status(404).json({ error: 'Job not found' });
    }
    res.set('Cache-Control', 'no-store');
    return void res.json(job);
  });

  // BULK DELETE STATIONS ENDPOINT (Admin Only) - For duplicates management
  app.post("/api/admin/delete-stations", requireAdmin, async (req, res) => {
    try {
      const { stationIds } = req.body;
      if (!Array.isArray(stationIds) || stationIds.length === 0) {
        return void res.status(400).json({ success: false, error: 'stationIds must be a non-empty array' });
      }

      const mongoose = await import('mongoose');
      const invalidIds = stationIds.filter(id => !mongoose.Types.ObjectId.isValid(id));
      if (invalidIds.length > 0) {
        return void res.status(400).json({ success: false, error: `Invalid station IDs: ${invalidIds.join(', ')}` });
      }

      let deletedCount = 0;
      let blacklistedCount = 0;
      const errors: string[] = [];
      const SAMPLE_CAP = 500;
      const blacklistSamples: Array<{
        name: string;
        url: string;
        stationUuid?: string;
        country?: string;
        countryCode?: string;
        reason?: string;
      }> = [];

      for (const stationId of stationIds) {
        try {
          const station = await Station.findById(stationId);
          if (!station) {
            errors.push(`Station ${stationId} not found`);
            continue;
          }

          try {
            await BlacklistedStation.create({
              stationUuid: station.stationuuid,
              url: station.url,
              name: station.name,
              reason: 'Admin bulk deletion from duplicates management',
              deletedBy: 'admin',
              radioBrowserId: station.changeUuid,
            });
            blacklistedCount++;
            if (blacklistSamples.length < SAMPLE_CAP) {
              blacklistSamples.push({
                name: station.name ?? '',
                url: station.url ?? '',
                stationUuid: station.stationuuid,
                country: (station as any).country ?? '',
                countryCode: (station as any).countrycode ?? '',
                reason: 'Admin bulk deletion from duplicates management',
              });
            }
          } catch (blacklistError: any) {
            if (!blacklistError.message.includes('duplicate')) {
              logger.warn(`Failed to blacklist station ${station.name}:`, blacklistError.message);
            }
          }

          if (station.slug) performanceCache.invalidateStationCache(station.slug);
          await Station.findByIdAndDelete(stationId);
          deletedCount++;
          await UserFavorite.deleteMany({ stationId: stationId });

        } catch (stationError: any) {
          errors.push(`Error deleting station ${stationId}: ${stationError.message}`);
        }
      }

      await CacheManager.clearByPattern('popular_stations');
      await CacheManager.clearByPattern('stations');
      await CacheManager.clearByPattern('community_favorites');

      // Task #185: bulk deletes can drop a slug below the indexable
      // threshold or to zero — refresh Genre.stationCount so the admin
      // page doesn't keep showing the pre-delete "live" badge.
      if (deletedCount > 0) {
        triggerGenreStationCountsRecompute('bulk-delete-stations');
      }

      if (blacklistSamples.length > 0) {
        const actorEmail =
          (req.user as { email?: string } | undefined)?.email ?? undefined;
        void import('../services/admin-audit-email')
          .then(({ emailBlacklistChangesCsv }) =>
            emailBlacklistChangesCsv({
              action: 'add',
              source: `bulk deletion (${blacklistedCount} station${blacklistedCount === 1 ? '' : 's'})`,
              rows: blacklistSamples,
              actorEmail,
            }),
          )
          .catch((err) => {
            logger.error({ err }, 'Failed to send blacklist audit email');
          });
      }

      res.json({
        success: true,
        deletedCount,
        blacklistedCount,
        message: `Successfully deleted ${deletedCount} station(s) and blacklisted ${blacklistedCount}`,
        errors: errors.length > 0 ? errors : undefined
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: 'Failed to delete stations', details: error.message });
    }
  });

  // Cleanup stations with URLs as names (Admin Only)
  app.post("/api/admin/cleanup-url-names", requireAdmin, async (req, res) => {
    try {
      // DB-side filter using case-insensitive regex for URL prefixes (avoids loading 40k+ docs into memory)
      const urlPrefixRegex = /^(https?:\/\/|www\.|ftps?:\/\/|rtmps?:\/\/|rtsps?:\/\/)/i;
      const filter = { name: { $regex: urlPrefixRegex } };

      let deletedCount = 0;
      let blacklistedCount = 0;
      const errors: string[] = [];
      const SAMPLE_CAP = 500;
      const blacklistSamples: Array<{
        name: string;
        url: string;
        stationUuid?: string;
        country?: string;
        countryCode?: string;
        reason?: string;
      }> = [];

      // Stream matching stations via cursor — bounded memory regardless of match count
      const cursor = Station.find(filter)
        .select('_id name url stationuuid slug country countrycode')
        .lean()
        .cursor({ batchSize: 500 });

      for await (const station of cursor as any) {
        try {
          try {
            await BlacklistedStation.create({
              stationUuid: station.stationuuid,
              url: station.url,
              name: station.name,
              reason: 'Station name is a URL - auto-cleanup',
              deletedBy: 'admin',
            });
            blacklistedCount++;
            if (blacklistSamples.length < SAMPLE_CAP) {
              blacklistSamples.push({
                name: station.name ?? '',
                url: station.url ?? '',
                stationUuid: station.stationuuid,
                country: station.country ?? '',
                countryCode: station.countrycode ?? '',
                reason: 'Station name is a URL - auto-cleanup',
              });
            }
          } catch (blacklistError: any) {}

          if (station.slug) performanceCache.invalidateStationCache(station.slug);
          await Station.findByIdAndDelete(station._id);
          deletedCount++;
          await UserFavorite.deleteMany({ stationId: station._id });
        } catch (stationError: any) {
          errors.push(`Error deleting station ${station._id}: ${stationError.message}`);
        }
      }

      if (deletedCount === 0) {
        return void res.json({ success: true, deletedCount: 0, blacklistedCount: 0, message: 'No stations with URL names found' });
      }
      
      await CacheManager.clearByPattern('popular_stations');
      await CacheManager.clearByPattern('stations');

      if (blacklistSamples.length > 0) {
        const actorEmail =
          (req.user as { email?: string } | undefined)?.email ?? undefined;
        void import('../services/admin-audit-email')
          .then(({ emailBlacklistChangesCsv }) =>
            emailBlacklistChangesCsv({
              action: 'add',
              source: `URL-name cleanup (${blacklistedCount} station${blacklistedCount === 1 ? '' : 's'})`,
              rows: blacklistSamples,
              actorEmail,
            }),
          )
          .catch((err) => {
            logger.error({ err }, 'Failed to send blacklist audit email');
          });
      }

      res.json({
        success: true,
        deletedCount,
        blacklistedCount,
        message: `Successfully deleted ${deletedCount} station(s) with URL names and blacklisted ${blacklistedCount}`,
        errors: errors.length > 0 ? errors : undefined
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: 'Failed to cleanup URL-named stations', details: error.message });
    }
  });

  // BLACKLISTED STATIONS ENDPOINTS (Admin Only)
  // Pre-emptively add a station URL/UUID to the blacklist without first
  // having to import then delete it. Reuses the same audit-email pipeline
  // as the deletion-side blacklist additions so admins still get a CSV
  // record of every manual block. (Task #260)
  app.post("/api/admin/blacklisted-stations", requireAdmin, async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        stationUuid?: unknown;
        url?: unknown;
        name?: unknown;
        reason?: unknown;
      };
      const url = typeof body.url === 'string' ? body.url.trim() : '';
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const stationUuid = typeof body.stationUuid === 'string' ? body.stationUuid.trim() : '';
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      if (!url) return void res.status(400).json({ error: 'url is required' });
      if (!name) return void res.status(400).json({ error: 'name is required' });

      const dupFilter: any = stationUuid
        ? { $or: [{ url }, { stationUuid }] }
        : { url };
      const existing = await BlacklistedStation.findOne(dupFilter).lean();
      if (existing) {
        return void res.status(409).json({
          error: 'Station is already blacklisted',
          blacklistedStation: existing,
        });
      }

      const actorEmail = (req.user as { email?: string } | undefined)?.email ?? undefined;
      const created = await BlacklistedStation.create({
        stationUuid: stationUuid || undefined,
        url,
        name,
        reason: reason || 'Manual blacklist',
        deletedBy: actorEmail || 'admin',
      });

      void import('../services/admin-audit-email')
        .then(({ emailBlacklistChangesCsv }) =>
          emailBlacklistChangesCsv({
            action: 'add',
            source: 'manual blacklist',
            rows: [
              {
                name,
                url,
                stationUuid: stationUuid || undefined,
                reason: reason || 'Manual blacklist',
              },
            ],
            actorEmail,
          }),
        )
        .catch((err) => {
          logger.error({ err }, 'Failed to send blacklist audit email');
        });

      res.status(201).json({ success: true, blacklistedStation: created });
    } catch (error: any) {
      logger.error(`Error in POST /api/admin/blacklisted-stations: ${error?.message || error}`);
      res.status(500).json({ error: 'Failed to add station to blacklist' });
    }
  });

  app.get("/api/admin/blacklisted-stations", requireAdmin, async (req, res) => {
    try {
      const { page = 1, limit = 50, search = '' } = req.query;
      const skip = (Number(page) - 1) * Number(limit);
      const searchFilter = search ? {
        $or: [
          { name: { $regex: String(search), $options: 'i' } },
          { url: { $regex: String(search), $options: 'i' } },
          { reason: { $regex: String(search), $options: 'i' } }
        ]
      } : {};
      
      const total = await BlacklistedStation.countDocuments(searchFilter);
      const blacklistedStations = await BlacklistedStation.find(searchFilter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit));
      
      res.json({
        stations: blacklistedStations,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit))
        }
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch blacklisted stations' });
    }
  });

  app.post("/api/admin/blacklisted-stations/:blacklistId/restore", requireAdmin, async (req, res) => {
    const sendUnblacklistEmail = (
      bl: { name?: string; url?: string; stationUuid?: string; reason?: string },
    ) => {
      const actorEmail =
        (req.user as { email?: string } | undefined)?.email ?? undefined;
      void import('../services/admin-audit-email')
        .then(({ emailBlacklistChangesCsv }) =>
          emailBlacklistChangesCsv({
            action: 'remove',
            source: 'restore from blacklist',
            rows: [
              {
                name: bl.name ?? '',
                url: bl.url ?? '',
                stationUuid: bl.stationUuid,
                reason: bl.reason ?? '',
              },
            ],
            actorEmail,
          }),
        )
        .catch((err) => {
          logger.error({ err }, 'Failed to send blacklist audit email');
        });
    };
    try {
      const { blacklistId } = req.params;
      const blacklistedStation = await BlacklistedStation.findById(blacklistId);
      if (!blacklistedStation) return void res.status(404).json({ error: 'Blacklisted station not found' });
      
      // Station schema uses lowercase `stationuuid` — matching BlacklistedStation's `stationUuid` field
      const existingStation = await Station.findOne({
        $or: [ { stationuuid: blacklistedStation.stationUuid }, { url: blacklistedStation.url } ]
      });
      if (existingStation) return void res.status(400).json({ error: 'Station already exists in database' });
      
      try {
        if (blacklistedStation.stationUuid) {
          const radioBrowserResponse = await fetch(`https://de1.api.radio-browser.info/json/stations/byuuid/${blacklistedStation.stationUuid}`);
          if (radioBrowserResponse.ok) {
            const radioBrowserData = (await radioBrowserResponse.json()) as any[];
            if (radioBrowserData && radioBrowserData.length > 0) {
              const stationData = radioBrowserData[0];
              const restoredStation = new Station({
                stationuuid: stationData.stationuuid,
                name: stationData.name || blacklistedStation.name,
                url: stationData.url || blacklistedStation.url,
                homepage: stationData.homepage,
                favicon: stationData.favicon,
                tags: stationData.tags ? stationData.tags.split(',').map((tag: any) => tag.trim()).filter(Boolean) : [],
                country: stationData.country,
                state: stationData.state,
                language: stationData.language,
                languageCodes: stationData.languagecodes ? stationData.languagecodes.split(',') : [],
                votes: stationData.votes || 0,
                lastChangeTime: stationData.lastchangetime,
                codec: stationData.codec,
                bitrate: stationData.bitrate,
                hls: stationData.hls === 1,
                lastCheckOk: stationData.lastcheckok === 1,
                lastCheckTime: stationData.lastchecktime,
                lastCheckOkTime: stationData.lastcheckoktime,
                lastLocalCheckTime: stationData.lastlocalchecktime,
                clickTimestamp: stationData.clicktimestamp,
                clickCount: stationData.clickcount || 0,
                clickTrend: stationData.clicktrend || 0,
                sslError: stationData.ssl_error === 1,
                geoLat: stationData.geo_lat ? parseFloat(stationData.geo_lat) : null,
                geoLong: stationData.geo_long ? parseFloat(stationData.geo_long) : null,
                hasExtendedInfo: stationData.has_extended_info === 1
              });
              await restoredStation.save();
              await BlacklistedStation.findByIdAndDelete(blacklistId);
              await CacheManager.clearByPattern('stations');
              await CacheManager.clearByPattern('popular_stations');
              sendUnblacklistEmail({
                name: blacklistedStation.name,
                url: blacklistedStation.url,
                stationUuid: blacklistedStation.stationUuid,
                reason: blacklistedStation.reason,
              });
              return void res.json({ success: true, message: 'Station restored successfully with fresh data', station: restoredStation });
            }
          }
        }
      } catch (radioBrowserError: any) {}
      
      const restoredStation = new Station({
        stationuuid: blacklistedStation.stationUuid,
        name: blacklistedStation.name,
        url: blacklistedStation.url,
        tags: [], country: 'Unknown', language: 'Unknown', votes: 0, lastCheckOk: false, clickCount: 0, clickTrend: 0, sslError: false
      });
      await restoredStation.save();
      await BlacklistedStation.findByIdAndDelete(blacklistId);
      await CacheManager.clearByPattern('stations');
      await CacheManager.clearByPattern('popular_stations');
      sendUnblacklistEmail({
        name: blacklistedStation.name,
        url: blacklistedStation.url,
        stationUuid: blacklistedStation.stationUuid,
        reason: blacklistedStation.reason,
      });
      res.json({ success: true, message: 'Station restored successfully with cached data', station: restoredStation });
    } catch (error) {
      res.status(500).json({ error: 'Failed to restore station' });
    }
  });

  app.get("/api/admin/db-status", requireAdmin, async (req, res) => {
    try {
      const db = mongoose.connection.db;
      if (!db) {
        return void res.status(500).json({ error: 'Database not connected' });
      }
      const stats = await db.stats();
      const collections = await db.listCollections().toArray();
      const collectionStats: any[] = [];
      for (const col of collections) {
        try {
          const cStats: any = await db.command({ collStats: col.name });
          collectionStats.push({
            name: col.name,
            count: cStats.count,
            sizeMB: Math.round((cStats.size / 1024 / 1024) * 100) / 100,
            storageSizeMB: Math.round((cStats.storageSize / 1024 / 1024) * 100) / 100,
            indexSizeMB: Math.round((cStats.totalIndexSize / 1024 / 1024) * 100) / 100,
          });
        } catch {}
      }
      collectionStats.sort((a, b) => b.storageSizeMB - a.storageSizeMB);
      res.json({
        totalSizeMB: Math.round((stats.dataSize / 1024 / 1024) * 100) / 100,
        storageSizeMB: Math.round((stats.storageSize / 1024 / 1024) * 100) / 100,
        indexSizeMB: Math.round((stats.indexSize / 1024 / 1024) * 100) / 100,
        collections: collectionStats,
        quotaStatus: getQuotaStatus()
      });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to get DB status', details: error.message });
    }
  });

  app.post("/api/admin/db-cleanup", requireAdmin, async (req, res) => {
    try {
      const { collections: targetCollections } = req.body;
      const cleanableCollections: Record<string, { model: any; keepDays?: number }> = {
        'analyticsevent': { model: AnalyticsEvent, keepDays: 0 },
        'analyticsevents': { model: AnalyticsEvent, keepDays: 0 },
        'synclogs': { model: SyncLog, keepDays: 7 },
        'stationdebuglogs': { model: StationDebugLog, keepDays: 3 },
        'bulkdescriptionjobs': { model: BulkDescriptionJob, keepDays: 1 },
      };

      const results: any[] = [];
      const targets = targetCollections || [...Object.keys(cleanableCollections), 'applogs', 'visitorsessions', 'userlisteninghistories'];

      for (const name of targets) {
        const key = name.toLowerCase().replace(/[_-]/g, '');
        const config = cleanableCollections[key];
        if (!config) {
          continue;
        }
        try {
          let deleteResult;
          if (config.keepDays === 0) {
            deleteResult = await config.model.deleteMany({});
          } else {
            const cutoff = new Date(Date.now() - config.keepDays! * 24 * 60 * 60 * 1000);
            deleteResult = await config.model.deleteMany({
              $or: [
                { createdAt: { $lt: cutoff } },
                { timestamp: { $lt: cutoff } }
              ]
            });
          }
          results.push({ collection: name, status: 'cleaned', deletedCount: deleteResult.deletedCount });
        } catch (err: any) {
          results.push({ collection: name, status: 'error', error: err.message });
        }
      }

      const db = mongoose.connection.db;

      const rawCollections: Record<string, { field: string; keepDays: number }> = {
        'applogs': { field: 'createdAt', keepDays: 7 },
        'visitorsessions': { field: 'createdAt', keepDays: 7 },
        'userlisteninghistories': { field: 'listenedAt', keepDays: 30 },
      };

      for (const name of targets) {
        const key = name.toLowerCase().replace(/[_-]/g, '');
        const rawConfig = rawCollections[key];
        if (!rawConfig || !db) continue;
        try {
          const col = db.collection(key);
          const cutoff = new Date(Date.now() - rawConfig.keepDays * 24 * 60 * 60 * 1000);
          const r = await col.deleteMany({ [rawConfig.field]: { $lt: cutoff } });
          results.push({ collection: key, status: 'cleaned', deletedCount: r.deletedCount });
        } catch (err: any) {
          results.push({ collection: key, status: 'error', error: err.message });
        }
      }

      res.json({ success: true, results });
    } catch (error: any) {
      res.status(500).json({ error: 'Cleanup failed', details: error.message });
    }
  });

  app.post("/api/admin/db-drop-collection", requireAdmin, async (req, res) => {
    try {
      const { collection } = req.body;
      if (!collection) return void res.status(400).json({ error: 'Collection name required' });

      const droppable = ['applogs', 'analyticsevents', 'stationdebuglogs', 'bulkdescriptionjobs'];
      if (!droppable.includes(collection.toLowerCase())) {
        return void res.status(400).json({ error: `Collection "${collection}" cannot be dropped. Allowed: ${droppable.join(', ')}` });
      }

      const db = mongoose.connection.db;
      if (!db) return void res.status(500).json({ error: 'Database not connected' });

      const collections = await db.listCollections({ name: collection }).toArray();
      if (collections.length === 0) {
        return void res.json({ success: true, message: `Collection "${collection}" does not exist` });
      }

      await db.dropCollection(collection);
      res.json({ success: true, message: `Collection "${collection}" dropped successfully` });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to drop collection', details: error.message });
    }
  });

  // Re-check tags from Radio-Browser for a single station (admin override).
  // Bypasses the `tagsCheckedAt` cooldown that the background hydration job
  // honours, so admins can force a refresh on stations stamped as
  // upstream-empty.
  app.post(
    "/api/admin/stations/:stationId/recheck-tags",
    requireAdmin,
    async (req, res) => {
      try {
        const { stationId } = req.params;
        const result = await syncService.recheckStationTags(stationId);
        if (!result.success) {
          return void res.status(400).json(result);
        }
        return void res.json(result);
      } catch (error: any) {
        logger.error('recheck-tags single failed', error);
        return void res
          .status(500)
          .json({ success: false, error: error?.message || 'Failed to re-check tags' });
      }
    },
  );

  // Bulk re-check tags. Clears `tagsCheckedAt` for the targeted stations
  // (so the next hydration sweep re-queries them) and immediately kicks off
  // the hydration job in the background. Targeting is via either
  // `stationIds` (specific stations) or `countryCode` (all empty-tag
  // stations in that country). At least one must be provided.
  app.post(
    "/api/admin/stations/recheck-tags-bulk",
    express.json({ limit: '1mb' }),
    requireAdmin,
    async (req, res) => {
      try {
        const {
          stationIds,
          countryCode,
          tagsStatus,
          search,
          language,
          genre,
        } = (req.body || {}) as {
          stationIds?: unknown;
          countryCode?: unknown;
          tagsStatus?: unknown;
          search?: unknown;
          language?: unknown;
          genre?: unknown;
        };

        const ids = Array.isArray(stationIds)
          ? (stationIds.filter(
              (id) => typeof id === 'string' && mongoose.Types.ObjectId.isValid(id),
            ) as string[])
          : [];
        const rawCountry =
          typeof countryCode === 'string' && countryCode.trim()
            ? countryCode.trim()
            : undefined;
        const rawTagsStatus =
          typeof tagsStatus === 'string' && tagsStatus.trim()
            ? tagsStatus.trim()
            : undefined;
        const rawSearch =
          typeof search === 'string' && search.trim() ? search.trim() : undefined;
        const rawLanguage =
          typeof language === 'string' && language.trim() && language !== 'all'
            ? language.trim()
            : undefined;
        const rawGenre =
          typeof genre === 'string' && genre.trim() && genre !== 'all'
            ? genre.trim()
            : undefined;

        const isFilterMode =
          rawTagsStatus === 'empty-cooldown' || rawTagsStatus === 'never-checked';

        if (ids.length === 0 && !rawCountry && !isFilterMode) {
          return void res.status(400).json({
            success: false,
            error: 'Provide stationIds, countryCode, or tagsStatus',
          });
        }

        // Country input may arrive as either an ISO code (e.g. "DE")
        // or a full DB country name (e.g. "Germany") — the admin
        // filters dropdown sends the latter via `/api/filters/countries`.
        // Resolve both forms so the bulk path matches reliably.
        let resolvedIso: string | undefined;
        let countryFilter: Record<string, unknown> = {};
        if (rawCountry) {
          const dbName = resolveToDbName(rawCountry);
          if (dbName) {
            const iso = dbNameToIso(dbName);
            if (iso) {
              resolvedIso = iso.toUpperCase();
              countryFilter = {
                $or: [
                  { countryCode: resolvedIso },
                  { country: { $regex: new RegExp(`^${dbName}$`, 'i') } },
                ],
              };
            } else {
              countryFilter = {
                country: { $regex: new RegExp(`^${dbName}$`, 'i') },
              };
            }
          } else {
            // Fall back to a regex match on the raw input.
            countryFilter = normalizeCountryFilter(rawCountry);
          }
        }

        const filter: Record<string, unknown> = {};
        if (ids.length > 0) {
          filter._id = { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) };
        } else if (isFilterMode) {
          // Filter-driven bulk: target every station matching the
          // current admin "tagsStatus" filter (and any additional
          // search/country/language/genre filters), not just the
          // visible page. Mirrors the predicate used by the GET
          // /api/admin/stations endpoint. We compose every constraint
          // inside `$and` so independent `$or` clauses (country
          // alternatives, search alternatives, empty-tags alternatives)
          // never clobber each other.
          const emptyTagsPredicate: Record<string, unknown> = {
            $or: [
              { tags: { $exists: false } },
              { tags: null },
              { tags: '' },
              { tags: { $regex: /^\s*$/ } },
            ],
          };
          const andConds: Record<string, unknown>[] = [emptyTagsPredicate];
          if (rawTagsStatus === 'empty-cooldown') {
            const cooldownCutoff = new Date(
              Date.now() - 30 * 24 * 60 * 60 * 1000,
            );
            andConds.push({ tagsCheckedAt: { $gte: cooldownCutoff } });
          } else {
            andConds.push({
              $or: [
                { tagsCheckedAt: { $exists: false } },
                { tagsCheckedAt: null },
              ],
            });
          }
          if (Object.keys(countryFilter).length > 0) {
            andConds.push(countryFilter);
          }
          if (rawSearch) {
            andConds.push({
              $or: [
                { name: { $regex: new RegExp(rawSearch, 'i') } },
                { country: { $regex: new RegExp(rawSearch, 'i') } },
                { tags: { $regex: new RegExp(rawSearch, 'i') } },
              ],
            });
          }
          if (rawLanguage) {
            andConds.push({
              language: { $regex: new RegExp(rawLanguage, 'i') },
            });
          }
          if (rawGenre) {
            andConds.push({ tags: { $regex: new RegExp(rawGenre, 'i') } });
          }
          filter.$and = andConds;
        } else {
          Object.assign(filter, countryFilter);
          filter.$and = [
            {
              $or: [
                { tags: { $exists: false } },
                { tags: null },
                { tags: '' },
              ],
            },
          ];
        }

        // Resolve every matching station for filter-mode so the
        // background re-check targets exactly the cleared rows. We
        // page through the cursor (no fixed cap) so requests with
        // tens of thousands of stuck stations are still fully covered.
        let filterModeIds: string[] = [];
        if (isFilterMode) {
          const cursor = Station.find(filter).select('_id').lean().cursor();
          for await (const doc of cursor) {
            const id = (doc as { _id: mongoose.Types.ObjectId })._id;
            if (id) filterModeIds.push(id.toString());
          }
        }

        let cleared = 0;
        let matched = 0;
        if (isFilterMode) {
          matched = filterModeIds.length;
          // Chunk the $unset to keep each Mongo command well below the
          // 16MB BSON limit on huge result sets.
          const updateChunkSize = 5000;
          for (let i = 0; i < filterModeIds.length; i += updateChunkSize) {
            const chunk = filterModeIds.slice(i, i + updateChunkSize);
            const chunkResult: import('mongodb').UpdateResult =
              await Station.updateMany(
                {
                  _id: {
                    $in: chunk.map((id) => new mongoose.Types.ObjectId(id)),
                  },
                },
                { $unset: { tagsCheckedAt: '' } },
              );
            cleared += chunkResult.modifiedCount ?? 0;
          }
        } else {
          const updateResult: import('mongodb').UpdateResult =
            await Station.updateMany(filter, { $unset: { tagsCheckedAt: '' } });
          cleared = updateResult.modifiedCount ?? 0;
          matched = updateResult.matchedCount ?? cleared;
        }

        // Create an in-memory job so the admin UI can stream progress
        // (over SSE) while the background hydration runs. Only
        // ID-scoped paths produce per-station progress; the country
        // hydration sweep runs as a fire-and-forget background scan
        // that doesn't expose progress, so we leave the job in
        // `running` until we detect it has nothing to track and mark
        // it completed.
        cleanupRecheckTagsJobs();
        const jobId = new mongoose.Types.ObjectId().toString();
        const scopeBits: string[] = [];
        if (ids.length > 0) scopeBits.push(`${ids.length} selected`);
        if (rawTagsStatus) scopeBits.push(rawTagsStatus);
        if (resolvedIso ?? rawCountry) scopeBits.push(`country ${resolvedIso ?? rawCountry}`);
        if (rawLanguage) scopeBits.push(`language ${rawLanguage}`);
        if (rawGenre) scopeBits.push(`genre ${rawGenre}`);
        if (rawSearch) scopeBits.push(`search "${rawSearch}"`);
        const job: RecheckTagsJob = {
          jobId,
          status: 'running',
          total: 0,
          processed: 0,
          hydrated: 0,
          emptyUpstream: 0,
          failed: 0,
          cleared,
          matched,
          scope: scopeBits.join(', ') || undefined,
          startedAt: Date.now(),
          cancelRequested: false,
          cancellable: false,
        };
        recheckTagsJobs.set(jobId, job);

        const isCancelled = () => recheckTagsJobs.get(jobId)?.cancelRequested === true;

        const onProgress = (p: {
          processed: number;
          hydrated: number;
          emptyUpstream: number;
          failed: number;
          total: number;
        }) => {
          const current = recheckTagsJobs.get(jobId);
          if (!current) return;
          current.total = p.total;
          current.processed = p.processed;
          current.hydrated = p.hydrated;
          current.emptyUpstream = p.emptyUpstream;
          current.failed = p.failed;
          recheckTagsJobs.set(jobId, current);
          notifyRecheckTagsJobSubscribers(jobId);
        };
        const finish = (err?: unknown) => {
          const current = recheckTagsJobs.get(jobId);
          if (!current) return;
          // Task #185: a tag re-check can move stations into/out of slugs.
          // Refresh Genre.stationCount so the admin Genre Whitelist page
          // doesn't keep showing pre-recheck totals.
          if ((current.hydrated ?? 0) > 0 || (current.processed ?? 0) > 0) {
            triggerGenreStationCountsRecompute(`recheck-tags-bulk:${jobId}`);
          }
          // If cancellation was requested but the loop had already finished
          // every station before observing the flag, prefer the truthful
          // 'completed' status so admins don't see a misleading "cancelled"
          // label on a run that actually processed everything.
          const fullyProcessed =
            current.total > 0 && current.processed >= current.total;
          if (current.cancelRequested && !fullyProcessed) {
            current.status = 'cancelled';
          } else {
            current.status = err ? 'failed' : 'completed';
          }
          current.finishedAt = Date.now();
          if (err && current.status === 'failed') {
            current.error = err instanceof Error ? err.message : String(err);
          }
          recheckTagsJobs.set(jobId, current);
          notifyRecheckTagsJobSubscribers(jobId);
        };

        // Kick off the actual re-query in the background so the admin
        // gets immediate feedback. Targeted ID requests use the
        // ID-scoped helper so we re-query exactly those stations;
        // country requests use the country-scoped hydration sweep
        // (which itself filters on `countryCode` ISO).
        if (ids.length > 0) {
          job.total = ids.length;
          job.cancellable = true;
          void syncService
            .recheckStationsTagsByIds(ids, onProgress, isCancelled)
            .then(() => finish())
            .catch((err) => {
              logger.error('bulk tags recheck (ids) failed', err);
              finish(err);
            });
        } else if (isFilterMode) {
          if (filterModeIds.length > 0) {
            job.total = filterModeIds.length;
            job.cancellable = true;
            void syncService
              .recheckStationsTagsByIds(filterModeIds, onProgress, isCancelled)
              .then(() => finish())
              .catch((err) => {
                logger.error('bulk tags recheck (filter) failed', err);
                finish(err);
              });
          } else {
            finish();
          }
        } else if (resolvedIso) {
          job.total = matched;
          job.cancellable = true;
          void syncService
            .hydrateMissingTagsInBackground({
              countryCode: resolvedIso,
              limit: Math.max(matched, 1000),
              isCancelled,
              onProgress,
            })
            .then((result) => {
              // Fold the final tallies back into the job tracker before
              // finish() decides between completed / cancelled. The
              // per-batch onProgress stream already keeps the UI live,
              // but this guarantees the final numbers (and the
              // `fullyProcessed` safeguard in finish()) line up even if
              // the last progress tick was missed.
              const current = recheckTagsJobs.get(jobId);
              if (current) {
                current.processed = result.processed;
                current.hydrated = result.hydrated;
                current.emptyUpstream = result.emptyUpstream;
                current.failed = result.failed;
                recheckTagsJobs.set(jobId, current);
                notifyRecheckTagsJobSubscribers(jobId);
              }
              finish();
            })
            .catch((err) => {
              logger.error('bulk tags recheck (country) failed', err);
              finish(err);
            });
        } else if (rawCountry) {
          // No ISO code resolvable — fall back to ID-scoped sweep
          // over the matched stations so we still re-query them.
          const matchedDocs = (await Station.find(filter)
            .select('_id')
            .limit(5000)
            .lean()) as unknown as Array<{ _id: mongoose.Types.ObjectId }>;
          const matchedIds = matchedDocs.map((d) => d._id.toString());
          if (matchedIds.length > 0) {
            job.total = matchedIds.length;
            job.cancellable = true;
            void syncService
              .recheckStationsTagsByIds(matchedIds, onProgress, isCancelled)
              .then(() => finish())
              .catch((err) => {
                logger.error('bulk tags recheck (country fallback) failed', err);
                finish(err);
              });
          } else {
            finish();
          }
        } else {
          finish();
        }

        return void res.json({
          success: true,
          jobId,
          cleared,
          matched,
          countryCode: resolvedIso ?? rawCountry,
          stationIdsCount: ids.length,
          tagsStatus: rawTagsStatus,
          message: `Cleared tagsCheckedAt for ${cleared} station(s) (${matched} matched); re-check job started`,
        });
      } catch (error: any) {
        logger.error('recheck-tags bulk failed', error);
        return void res
          .status(500)
          .json({ success: false, error: error?.message || 'Failed to bulk re-check tags' });
      }
    },
  );

  // Cancel a running bulk tag re-check job. The background loops in
  // `recheckStationsTagsByIds` and `hydrateMissingTagsInBackground` both
  // poll the job's `cancelRequested` flag between batches and exit
  // cleanly, after which `finish()` will mark the job as `cancelled`.
  app.post(
    '/api/admin/stations/recheck-tags-job-cancel/:jobId',
    requireAdmin,
    async (req, res) => {
      const { jobId } = req.params as { jobId: string };
      const job = recheckTagsJobs.get(jobId);
      if (!job) {
        return void res
          .status(404)
          .json({ success: false, error: 'Job not found' });
      }
      if (job.status !== 'running') {
        return void res.json({ success: true, job, alreadyFinished: true });
      }
      if (!job.cancellable) {
        return void res
          .status(409)
          .json({ success: false, error: 'Job is not cancellable' });
      }
      job.cancelRequested = true;
      recheckTagsJobs.set(jobId, job);
      notifyRecheckTagsJobSubscribers(jobId);
      logger.log(`🛑 Bulk tag re-check job ${jobId} cancellation requested`);
      return void res.json({ success: true, job });
    },
  );

  // Live progress stream for a bulk tag re-check job. Admins see
  // processed/hydrated/failed counts the moment each batch finishes,
  // and the header tagless badge updates as soon as the server reports
  // progress. The stream emits an initial `snapshot`, one `progress`
  // event per change while the job is running, and a final `done`
  // event on terminal status before closing. Unknown jobs (e.g.
  // evicted after the 1-hour TTL) get a `not-found` event so the
  // client can stop reconnecting and clear the persisted job id.
  app.get(
    '/api/admin/stations/recheck-tags-job-stream/:jobId',
    requireAdmin,
    async (req, res) => {
      const { jobId } = req.params as { jobId: string };
      cleanupRecheckTagsJobs();

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        // Disable proxy buffering so each event flushes immediately.
        'X-Accel-Buffering': 'no',
      });
      // Express 5 doesn't always flush headers eagerly for SSE.
      res.flushHeaders?.();

      const send = (event: string, payload: unknown) => {
        try {
          res.write(`event: ${event}\n`);
          res.write(`data: ${JSON.stringify(payload)}\n\n`);
        } catch {
          // socket likely already closed; cleanup happens via 'close'
        }
      };

      const job = recheckTagsJobs.get(jobId);
      if (!job) {
        send('not-found', { jobId });
        return void res.end();
      }

      send('snapshot', job);
      if (job.status !== 'running') {
        send('done', job);
        return void res.end();
      }

      let closed = false;
      const keepalive = setInterval(() => {
        if (closed) return;
        try {
          res.write(': ping\n\n');
        } catch {
          // ignore; 'close' will clean up
        }
      }, 15000);

      const sub: RecheckTagsJobSubscriber = (j) => {
        if (closed) return;
        if (j.status === 'running') {
          send('progress', j);
        } else {
          send('done', j);
          cleanup();
          try {
            res.end();
          } catch {
            // ignore
          }
        }
      };

      let subs = recheckTagsJobSubscribers.get(jobId);
      if (!subs) {
        subs = new Set();
        recheckTagsJobSubscribers.set(jobId, subs);
      }
      subs.add(sub);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepalive);
        const s = recheckTagsJobSubscribers.get(jobId);
        if (s) {
          s.delete(sub);
          if (s.size === 0) recheckTagsJobSubscribers.delete(jobId);
        }
      };

      req.on('close', cleanup);
      return;
    },
  );

  // COVERAGE BY COUNTRY — admin diagnostic that surfaces which markets are
  // dragging down indexing quality. Returns one row per countryCode with
  // total stations + how many have a completed `logoAssets` record + how
  // many have a non-empty `tags` field. Designed to replace the ad-hoc
  // Mongo aggregations admins were running by hand to find regressions.
  app.get(
    '/api/admin/coverage/by-country',
    requireAdmin,
    async (_req, res) => {
      try {
        const rows = await Station.aggregate([
          {
            $match: {
              countryCode: { $exists: true, $nin: [null, '', 'null'] },
            },
          },
          {
            $group: {
              _id: { $toUpper: '$countryCode' },
              total: { $sum: 1 },
              withLogo: {
                $sum: {
                  $cond: [
                    { $eq: ['$logoAssets.status', 'completed'] },
                    1,
                    0,
                  ],
                },
              },
              withTags: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $ne: ['$tags', null] },
                        { $ne: [{ $ifNull: ['$tags', ''] }, ''] },
                        {
                          $not: [
                            {
                              $regexMatch: {
                                input: { $ifNull: ['$tags', ''] },
                                regex: /^\s*$/,
                              },
                            },
                          ],
                        },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
            },
          },
        ]);

        const decorated = rows
          .map((row) => {
            const code = String(row._id || '').toUpperCase();
            const total = Number(row.total) || 0;
            const withLogo = Number(row.withLogo) || 0;
            const withTags = Number(row.withTags) || 0;
            const dbName = resolveToDbName(code) || code;
            return {
              countryCode: code,
              countryName: dbName,
              total,
              withLogo,
              withTags,
              missingLogo: Math.max(total - withLogo, 0),
              missingTags: Math.max(total - withTags, 0),
              logoCoveragePct:
                total > 0 ? Math.round((withLogo / total) * 1000) / 10 : 0,
              tagCoveragePct:
                total > 0 ? Math.round((withTags / total) * 1000) / 10 : 0,
            };
          })
          .sort((a, b) => b.total - a.total);

        return void res.json({ countries: decorated });
      } catch (error: any) {
        logger.error('coverage by-country failed', error);
        return void res.status(500).json({
          error: error?.message || 'Failed to compute country coverage',
        });
      }
    },
  );

  // COVERAGE BACKFILL BOOT STATUS (Task #232) — surface the outcome of
  // the first-deploy historical backfill (`services/coverage-backfill-on-boot.ts`)
  // so admins can tell from the UI whether the seeder ran on the current
  // deploy, when, how many rows it inserted, and whether it failed —
  // without having to dig through stdout. The status doc is a singleton
  // updated by the boot service; we just read it back. Returns
  // `{ status: null }` when the seeder has never run on any boot
  // observed by this Mongo (e.g. fresh DB), so the UI can show "no
  // boot run recorded yet" instead of an error.
  app.get(
    '/api/admin/coverage/backfill-status',
    requireAdmin,
    async (_req, res) => {
      try {
        type BackfillStatusDoc = {
          outcome: string;
          message: string;
          observedAt: Date;
          startedAt?: Date;
          finishedAt?: Date;
          durationMs?: number;
          thresholdDays?: number;
          historicalDayCount?: number;
          seedDays?: number;
          daysSeeded?: number;
          inserted?: number;
          preserved?: number;
          error?: string;
          updatedAt?: Date;
        };
        const [doc, historyDocs] = await Promise.all([
          CoverageBackfillStatus.findOne({ key: 'latest' }).lean<BackfillStatusDoc | null>(),
          // Task #316: small bounded list of past boot evaluations so
          // the UI can render a "Previous boot runs" panel under the
          // latest status. Sorted newest-first; capped writes-side to
          // ~20 rows so this is always a tiny query.
          CoverageBackfillRun.find({})
            .sort({ observedAt: -1, _id: -1 })
            .limit(20)
            .lean<BackfillStatusDoc[]>(),
        ]);
        const serializeRun = (d: BackfillStatusDoc) => ({
          outcome: d.outcome,
          message: d.message,
          observedAt:
            d.observedAt instanceof Date
              ? d.observedAt.toISOString()
              : d.observedAt,
          startedAt:
            d.startedAt instanceof Date
              ? d.startedAt.toISOString()
              : (d.startedAt ?? null),
          finishedAt:
            d.finishedAt instanceof Date
              ? d.finishedAt.toISOString()
              : (d.finishedAt ?? null),
          durationMs: d.durationMs ?? null,
          thresholdDays: d.thresholdDays ?? null,
          historicalDayCount: d.historicalDayCount ?? null,
          seedDays: d.seedDays ?? null,
          daysSeeded: d.daysSeeded ?? null,
          inserted: d.inserted ?? null,
          preserved: d.preserved ?? null,
          error: d.error ?? null,
        });
        const history = historyDocs.map(serializeRun);
        if (!doc) {
          return void res.json({ status: null, history });
        }
        return void res.json({
          status: serializeRun(doc),
          history,
        });
      } catch (error: any) {
        logger.error('coverage backfill-status failed', error);
        return void res.status(500).json({
          error: error?.message || 'Failed to load coverage backfill status',
        });
      }
    },
  );

  // COVERAGE TRENDS — return per-country daily coverage snapshots from the
  // last N days (default 30) so the admin coverage page can render a small
  // sparkline and a 30-day delta beside today's numbers. Snapshots are
  // populated nightly by `services/scheduled-coverage-snapshot.ts`.
  app.get(
    '/api/admin/coverage/trends',
    requireAdmin,
    async (req, res) => {
      try {
        const rawDays = Number(req.query.days);
        const days = Number.isFinite(rawDays)
          ? Math.min(Math.max(Math.floor(rawDays), 1), 180)
          : 30;
        const since = new Date();
        since.setUTCHours(0, 0, 0, 0);
        since.setUTCDate(since.getUTCDate() - (days - 1));

        // Optional countryCode filter — when the per-country trend page asks
        // for a single market we don't need to ship every other country's
        // snapshots over the wire. The compare view passes a comma-separated
        // list (e.g. `TR,DE,US`) to overlay several markets on one chart, so
        // accept either a single ISO-2 code or a CSV of them. Anything that
        // isn't a valid ISO-2 code is silently dropped, and an empty result
        // means "no filter" (return everything).
        const rawCountry =
          typeof req.query.countryCode === 'string'
            ? req.query.countryCode.trim().toUpperCase()
            : '';
        const countryList = rawCountry
          ? Array.from(
              new Set(
                rawCountry
                  .split(',')
                  .map((c) => c.trim())
                  .filter((c) => /^[A-Z]{2}$/.test(c)),
              ),
            )
          : [];
        const countryFilter =
          countryList.length === 1
            ? countryList[0]
            : countryList.length > 1
              ? { $in: countryList }
              : null;

        type SnapshotRow = {
          countryCode: string;
          snapshotDate: Date;
          logoCoveragePct: number;
          tagCoveragePct: number;
          total: number;
          withLogo: number;
          withTags: number;
          source?: 'cron' | 'backfill';
        };
        type TrendPoint = Omit<SnapshotRow, 'countryCode' | 'snapshotDate'> & {
          date: string;
          // Always present in the response (legacy rows missing the DB
          // field default to 'cron'), so the UI can render reconstructed
          // backfill points distinctly from real cron snapshots.
          source: 'cron' | 'backfill';
        };

        const rows = await CoverageSnapshot.find(
          {
            snapshotDate: { $gte: since },
            ...(countryFilter !== null ? { countryCode: countryFilter } : {}),
          },
          {
            countryCode: 1,
            snapshotDate: 1,
            logoCoveragePct: 1,
            tagCoveragePct: 1,
            total: 1,
            withLogo: 1,
            withTags: 1,
            source: 1,
            _id: 0,
          },
        )
          .sort({ countryCode: 1, snapshotDate: 1 })
          .lean<SnapshotRow[]>();

        const byCountry = new Map<string, TrendPoint[]>();
        for (const r of rows) {
          const code = String(r.countryCode || '').toUpperCase();
          if (!code) continue;
          const date =
            r.snapshotDate instanceof Date
              ? r.snapshotDate.toISOString().slice(0, 10)
              : String(r.snapshotDate).slice(0, 10);
          const list = byCountry.get(code) || [];
          list.push({
            date,
            logoCoveragePct: Number(r.logoCoveragePct) || 0,
            tagCoveragePct: Number(r.tagCoveragePct) || 0,
            total: Number(r.total) || 0,
            withLogo: Number(r.withLogo) || 0,
            withTags: Number(r.withTags) || 0,
            source: r.source === 'backfill' ? 'backfill' : 'cron',
          });
          byCountry.set(code, list);
        }

        const trends: Record<string, TrendPoint[]> = {};
        for (const [code, list] of byCountry) {
          trends[code] = list;
        }

        return void res.json({
          days,
          since: since.toISOString(),
          trends,
        });
      } catch (error: any) {
        logger.error('coverage trends failed', error);
        return void res.status(500).json({
          error: error?.message || 'Failed to fetch coverage trends',
        });
      }
    },
  );

  // COVERAGE DROP ALERTS — surface nightly coverage drop alerts (written
  // by `services/coverage-drop-notifier.ts` as admin `UserNotification`
  // rows with `data.kind === 'coverage_drop'`) so the admin coverage
  // page can highlight which countries triggered the alert without
  // forcing admins to dig through the generic notifications UI.
  //
  // Default response (no query params) preserves the original shape:
  //   { alert: <latestAlert | null> }
  //
  // When `history=1` is passed, the response also includes a paginated
  // tail of older alerts (Task #239) so admins can spot chronically
  // flaky countries straight from the coverage page:
  //   { alert, history: <Alert[]>, hasMore: boolean, nextBefore: string|null }
  // Use `before=<isoTimestamp>` to fetch the next page (cursor on the
  // alert's snapshotDate, fallback createdAt). `limit` defaults to 10
  // and is clamped to [1, 50].
  //
  // Acknowledgement (Task #238): admins can dismiss the banner for the
  // current alert via POST /api/admin/coverage/drop-alerts/acknowledge.
  // The acknowledgement is keyed by snapshotDate and stored in
  // `AdminSetting` under `coverage-drop-alert-ack`, so it is shared
  // across admins and survives reloads. Once a newer alert (different
  // snapshotDate) arrives the banner shows again automatically. Only
  // the alert whose `snapshotDate` matches the stored ack carries
  // `acknowledged: true` — historical alerts in the `history` array
  // always render with `acknowledged: false`.
  app.get(
    '/api/admin/coverage/drop-alerts',
    requireAdmin,
    async (req, res) => {
      try {
        type RawDrop = {
          countryCode: string;
          metric: 'logo' | 'tag';
          todayPct: number;
          weekAgoPct: number;
          deltaPp: number;
          total: number;
        };
        type RawAlertData = {
          kind?: string;
          snapshotDate?: string;
          thresholdPp?: number;
          drops?: RawDrop[];
        };
        // Look up any acknowledgement (Task #238) once per request and
        // annotate the alert whose snapshotDate matches it. We always
        // resolve `acknowledged` so the client can decide whether to
        // render the banner. In history mode only the matching alert
        // (typically the latest) carries `acknowledged: true`; older
        // alerts in the list always come back as `acknowledged: false`.
        const ackDoc = await AdminSetting.findOne({
          key: COVERAGE_DROP_ACK_KEY,
        }).lean();
        const ackValue = (ackDoc?.value ?? null) as {
          snapshotDate?: string | null;
          acknowledgedAt?: string | null;
          acknowledgedBy?: string | null;
        } | null;
        const ackSnapshotDate =
          ackValue && typeof ackValue.snapshotDate === 'string'
            ? ackValue.snapshotDate
            : null;

        const shapeAlert = (doc: {
          createdAt?: Date | string | null;
          message?: string | null;
          data?: unknown;
        }) => {
          const data = (doc.data ?? {}) as RawAlertData;
          const drops = Array.isArray(data.drops) ? data.drops : [];
          const snapshotDate = data.snapshotDate ?? null;
          const ackMatches =
            !!ackSnapshotDate && ackSnapshotDate === snapshotDate;
          return {
            createdAt:
              doc.createdAt instanceof Date
                ? doc.createdAt.toISOString()
                : typeof doc.createdAt === 'string'
                  ? doc.createdAt
                  : new Date().toISOString(),
            snapshotDate,
            thresholdPp:
              typeof data.thresholdPp === 'number' ? data.thresholdPp : null,
            message: doc.message ?? '',
            drops: drops.map((d) => ({
              countryCode: String(d.countryCode || '').toUpperCase(),
              metric: d.metric,
              todayPct: Number(d.todayPct) || 0,
              weekAgoPct: Number(d.weekAgoPct) || 0,
              deltaPp: Number(d.deltaPp) || 0,
              total: Number(d.total) || 0,
            })),
            acknowledged: ackMatches,
            acknowledgedAt: ackMatches
              ? ackValue?.acknowledgedAt ?? null
              : null,
            acknowledgedBy: ackMatches
              ? ackValue?.acknowledgedBy ?? null
              : null,
          };
        };

        const wantHistory =
          req.query.history === '1' ||
          req.query.history === 'true' ||
          req.query.history === 'yes';

        // Sort by `data.snapshotDate` first (the date the alert is *about*)
        // and fall back to `createdAt` so historical replays / backfills
        // don't misorder. In normal nightly operation the two correlate.
        if (!wantHistory) {
          const latest = await UserNotification.findOne(
            { type: 'system', 'data.kind': 'coverage_drop' },
            { createdAt: 1, message: 1, data: 1 },
          )
            .sort({ 'data.snapshotDate': -1, createdAt: -1 })
            .lean();

          if (!latest) {
            return void res.json({ alert: null });
          }
          return void res.json({ alert: shapeAlert(latest) });
        }

        const rawLimit = Number(req.query.limit);
        const limit =
          Number.isFinite(rawLimit) && rawLimit > 0
            ? Math.min(50, Math.max(1, Math.floor(rawLimit)))
            : 10;

        const filter: Record<string, unknown> = {
          type: 'system',
          'data.kind': 'coverage_drop',
        };
        const beforeParam =
          typeof req.query.before === 'string' ? req.query.before.trim() : '';
        if (beforeParam) {
          // Cursor: only return alerts strictly older than the supplied
          // snapshot date. We use the same date string the client got
          // back in the previous page's `nextBefore` (a YYYY-MM-DD or an
          // ISO timestamp).
          filter['data.snapshotDate'] = { $lt: beforeParam };
        }

        // Fetch one extra row to determine `hasMore` without a count.
        const rows = await UserNotification.find(filter, {
          createdAt: 1,
          message: 1,
          data: 1,
        })
          .sort({ 'data.snapshotDate': -1, createdAt: -1 })
          .limit(limit + 1)
          .lean();

        const hasMore = rows.length > limit;
        const pageRows = hasMore ? rows.slice(0, limit) : rows;
        const history = pageRows.map((r) => shapeAlert(r));
        const last = history[history.length - 1];
        const nextBefore =
          hasMore && last && last.snapshotDate ? last.snapshotDate : null;

        return void res.json({
          alert: history[0] ?? null,
          history,
          hasMore,
          nextBefore,
        });
      } catch (error: any) {
        logger.error('coverage drop-alerts failed', error);
        return void res.status(500).json({
          error: error?.message || 'Failed to fetch coverage drop alerts',
        });
      }
    },
  );

  // Acknowledge the most recent coverage drop alert (Task #238). The
  // client passes the `snapshotDate` of the alert it currently sees so
  // we don't accidentally suppress a newer alert that arrived between
  // page load and the click. Acknowledgement is shared across admins
  // and persists until a newer alert (different snapshotDate) shows up.
  app.post(
    '/api/admin/coverage/drop-alerts/acknowledge',
    express.json(),
    requireAdmin,
    async (req, res) => {
      try {
        const body = (req.body ?? {}) as { snapshotDate?: unknown };
        const snapshotDate =
          typeof body.snapshotDate === 'string' && body.snapshotDate.trim().length > 0
            ? body.snapshotDate.trim()
            : null;
        if (!snapshotDate) {
          return void res
            .status(400)
            .json({ error: 'snapshotDate is required' });
        }

        // Confirm the latest alert actually has the snapshotDate the
        // client is acknowledging — otherwise an out-of-date client
        // could silence a freshly-arrived alert.
        const latest = await UserNotification.findOne(
          { type: 'system', 'data.kind': 'coverage_drop' },
          { data: 1 },
        )
          .sort({ 'data.snapshotDate': -1, createdAt: -1 })
          .lean();
        const latestSnapshotDate =
          (latest?.data as { snapshotDate?: string } | undefined)?.snapshotDate ?? null;
        if (!latest || latestSnapshotDate !== snapshotDate) {
          return void res.status(409).json({
            error:
              'A newer coverage drop alert is available; refresh before acknowledging.',
            latestSnapshotDate,
          });
        }

        const adminUsername =
          ((req.session as any)?.adminAuth?.username as string | undefined) ?? null;
        const acknowledgedAt = new Date().toISOString();
        // Task #327: route the upsert through the shared audit helper so
        // the ack also leaves a row in `AdminSettingHistory`. Lets the
        // coverage page show "who silenced this alert, when" the same
        // way it already does for the alert thresholds themselves.
        await upsertAdminSettingWithHistory({
          key: COVERAGE_DROP_ACK_KEY,
          value: {
            snapshotDate,
            acknowledgedAt,
            acknowledgedBy: adminUsername,
          },
          changedBy: adminUsername,
          logTag: 'coverage-drop-ack',
        });

        return void res.json({
          acknowledged: true,
          snapshotDate,
          acknowledgedAt,
          acknowledgedBy: adminUsername,
        });
      } catch (error: any) {
        logger.error('coverage drop-alerts acknowledge failed', error);
        return void res.status(500).json({
          error: error?.message || 'Failed to acknowledge coverage drop alert',
        });
      }
    },
  );

  // Un-acknowledge the most recent coverage drop alert (Task #321). Clears
  // the stored `coverage-drop-alert-ack` AdminSetting row so the banner
  // and per-row badges reappear for everyone. Used by the toast "Undo"
  // affordance and the "Reopen alert" button on the coverage page when an
  // admin dismissed the banner by accident.
  app.delete(
    '/api/admin/coverage/drop-alerts/acknowledge',
    requireAdmin,
    async (req, res) => {
      try {
        // Task #327: route the delete through the shared audit helper so
        // the un-acknowledge also leaves a `clear` row in
        // `AdminSettingHistory`. Skip the history write when no ack was
        // present so the audit log doesn't fill with no-op DELETEs.
        const adminUsername =
          ((req.session as any)?.adminAuth?.username as string | undefined) ?? null;
        const { existed } = await clearAdminSettingWithHistory({
          key: COVERAGE_DROP_ACK_KEY,
          changedBy: adminUsername,
          logTag: 'coverage-drop-ack',
          skipHistoryWhenAbsent: true,
        });
        return void res.json({
          acknowledged: false,
          cleared: existed,
        });
      } catch (error: any) {
        logger.error('coverage drop-alerts un-acknowledge failed', error);
        return void res.status(500).json({
          error:
            error?.message || 'Failed to un-acknowledge coverage drop alert',
        });
      }
    },
  );

  // Task #327: append-only audit trail of every acknowledge / reopen of
  // the coverage drop banner. Mirrors the response shape of the other
  // `AdminSettingHistory`-backed endpoints so the frontend can render
  // the entries with the same row layout (collapsible "Recent
  // acknowledgements" panel on the Coverage page).
  app.get(
    '/api/admin/coverage/drop-alerts/acknowledge/history',
    requireAdmin,
    async (req, res) => {
      try {
        const entries = await listAdminSettingHistory(
          COVERAGE_DROP_ACK_KEY,
          parseHistoryLimit(req.query.limit),
        );
        return void res.json({ entries });
      } catch (error: any) {
        logger.error('coverage drop-alerts ack history failed', error);
        return void res.status(500).json({
          error: error?.message || 'Failed to read acknowledgement history',
        });
      }
    },
  );

  // Re-enqueue the same logo / tag backfill that
  // `scripts/backfill-tr-logos.ts` and `scripts/backfill-tr-tags.ts` run from
  // the CLI, but for any country and from the admin UI. `scope` selects which
  // pipeline(s) to kick off; defaults to running both.
  app.post(
    '/api/admin/coverage/enqueue/:countryCode',
    express.json(),
    requireAdmin,
    async (req, res) => {
      try {
        const rawCode = String(req.params.countryCode || '').trim().toUpperCase();
        if (!rawCode) {
          return void res
            .status(400)
            .json({ success: false, error: 'countryCode is required' });
        }

        const scopeInput =
          typeof req.body?.scope === 'string' ? req.body.scope : 'both';
        const wantLogos = scopeInput === 'logos' || scopeInput === 'both';
        const wantTags = scopeInput === 'tags' || scopeInput === 'both';
        if (!wantLogos && !wantTags) {
          return void res.status(400).json({
            success: false,
            error: "scope must be one of 'logos', 'tags', 'both'",
          });
        }

        cleanupCoverageBackfillJobs();
        const jobId = new mongoose.Types.ObjectId().toString();
        const job: CoverageBackfillJob = {
          jobId,
          countryCode: rawCode,
          scope: scopeInput as 'logos' | 'tags' | 'both',
          status: 'running',
          startedAt: Date.now(),
          cancellable: true,
          cancelRequested: false,
        };
        coverageBackfillJobs.set(jobId, job);

        // Logo enqueue — mirror `backfill-tr-logos.ts` exactly (same filter,
        // same `$unset` so the next scheduled-logo-processor sweep picks the
        // station up). Idempotent: completed assets are excluded. We resolve
        // the matching `_id`s up front so the status endpoint can later
        // count how many of *those specific* stations now have a completed
        // logoAssets record (instead of conflating with unrelated traffic).
        let logoMatched = 0;
        let logoEnqueued = 0;
        let logoEnqueuedIds: string[] = [];
        if (wantLogos) {
          const STALE_PROCESSING_MS = 60 * 60 * 1000;
          const stalePivot = new Date(Date.now() - STALE_PROCESSING_MS);
          const logoFilter: Record<string, unknown> = {
            countryCode: rawCode,
            favicon: { $exists: true, $nin: ['', null, 'null'] },
            slug: { $exists: true, $ne: null },
            $or: [
              { logoAssets: { $exists: false } },
              { 'logoAssets.status': { $exists: false } },
              { 'logoAssets.status': 'pending' },
              {
                'logoAssets.status': 'failed',
                'logoAssets.failureType': {
                  $nin: ['http_error', 'invalid_format'],
                },
              },
              {
                'logoAssets.status': 'failed',
                'logoAssets.failureType': { $exists: false },
              },
              {
                'logoAssets.status': 'processing',
                $or: [
                  { 'logoAssets.lastAttempt': { $lt: stalePivot } },
                  {
                    'logoAssets.lastAttempt': { $exists: false },
                    'logoAssets.processedAt': { $lt: stalePivot },
                  },
                  {
                    'logoAssets.lastAttempt': { $exists: false },
                    'logoAssets.processedAt': { $exists: false },
                  },
                ],
              },
            ],
          };
          const matchedDocs = (await Station.find(logoFilter)
            .select('_id')
            .lean()) as unknown as Array<{ _id: mongoose.Types.ObjectId }>;
          logoMatched = matchedDocs.length;
          logoEnqueuedIds = matchedDocs.map((d) => d._id.toString());
          if (logoEnqueuedIds.length > 0) {
            const result = await Station.updateMany(
              {
                _id: {
                  $in: logoEnqueuedIds.map(
                    (id) => new mongoose.Types.ObjectId(id),
                  ),
                },
              },
              { $unset: { logoAssets: '' } },
            );
            logoEnqueued = result.modifiedCount ?? 0;
          }
          job.logos = {
            matched: logoMatched,
            enqueuedIds: logoEnqueuedIds,
            completed: 0,
            remaining: logoEnqueuedIds.length,
            // Nothing to track → already done so the job can complete
            // immediately rather than sit "running" forever.
            done: logoEnqueuedIds.length === 0,
          };
        }

        // Tags enqueue — fire-and-forget call into the same hydration helper
        // used by `backfill-tr-tags.ts`. The job runs in the background; we
        // return immediately so the admin UI stays responsive.
        let tagsStarted = false;
        // Task #252: if a tags subjob for this same country was cancelled
        // within the last few minutes, carry its final counters forward so
        // the resumed run shows continuous progress (and its final totals
        // include the work the cancelled predecessor already did) instead
        // of restarting the displayed bar at 0/total. The actual
        // already-hydrated stations are skipped naturally by the candidate
        // filter inside `hydrateMissingTagsInBackground`.
        let resumeHint: CoverageTagsResumeHint | null = null;
        if (wantTags) {
          tagsStarted = true;
          resumeHint = consumeCoverageTagsResumeHint(rawCode);
          const baseProcessed = resumeHint?.processed ?? 0;
          const baseHydrated = resumeHint?.hydrated ?? 0;
          const baseEmptyUpstream = resumeHint?.emptyUpstream ?? 0;
          const baseFailed = resumeHint?.failed ?? 0;
          const baseTotal = resumeHint?.total ?? 0;
          job.tags = {
            total: baseTotal,
            processed: baseProcessed,
            hydrated: baseHydrated,
            emptyUpstream: baseEmptyUpstream,
            failed: baseFailed,
            done: false,
            resumedFrom: resumeHint
              ? {
                  processed: baseProcessed,
                  hydrated: baseHydrated,
                  emptyUpstream: baseEmptyUpstream,
                  failed: baseFailed,
                  total: baseTotal,
                }
              : undefined,
          };
          // Task #342: thread the cancelled jobId we just resumed from
          // onto the job itself so the history snapshot can chain rows.
          if (resumeHint?.cancelledJobId) {
            job.resumedFromJobId = resumeHint.cancelledJobId;
          }
          void syncService
            .hydrateMissingTagsInBackground({
              countryCode: rawCode,
              // Mirror the default in scripts/backfill-tr-tags.ts so an
              // admin-triggered run produces the same Radio-Browser load
              // shape as the CLI backfill.
              limit: 2000,
              isCancelled: () =>
                coverageBackfillJobs.get(jobId)?.cancelRequested === true,
              onProgress: (p) => {
                const current = coverageBackfillJobs.get(jobId);
                if (!current?.tags) return;
                // The new run's `p.total` is just the remaining-candidate
                // count (the candidate filter excludes stations the
                // cancelled run already hydrated / cooled down). Stations
                // counted in `baseProcessed` are NOT in `p.total`, so the
                // continuous denominator is the larger of the original
                // baseline total and the live carried-forward processed
                // count + the remaining work — never the sum of both
                // totals (that would double-count the denominator).
                current.tags.total = Math.max(
                  baseTotal,
                  baseProcessed + p.total,
                );
                current.tags.processed = baseProcessed + p.processed;
                current.tags.hydrated = baseHydrated + p.hydrated;
                current.tags.emptyUpstream = baseEmptyUpstream + p.emptyUpstream;
                current.tags.failed = baseFailed + p.failed;
                coverageBackfillJobs.set(jobId, current);
              },
            })
            .then((result) => {
              const current = coverageBackfillJobs.get(jobId);
              if (!current?.tags) return;
              // Same continuity rule as onProgress above — never inflate
              // the displayed denominator by adding the baseline total
              // to the new run's total. The new run only saw the
              // remaining (non-hydrated, non-cooled-down) candidates.
              current.tags.total = Math.max(
                current.tags.total,
                baseTotal,
                baseProcessed + result.processed,
              );
              current.tags.processed = baseProcessed + result.processed;
              current.tags.hydrated = baseHydrated + result.hydrated;
              current.tags.emptyUpstream =
                baseEmptyUpstream + result.emptyUpstream;
              current.tags.failed = baseFailed + result.failed;
              current.tags.done = true;
              // Task #252: if this run itself got cancelled, stash a fresh
              // resume hint so a follow-up Undo can keep chaining instead
              // of losing the carried-forward progress on every cancel.
              if (result.cancelled || current.cancelRequested) {
                stashCoverageTagsResumeHint(
                  current.countryCode,
                  current.tags,
                  current.jobId,
                );
              }
              maybeFinishCoverageJob(current);
              coverageBackfillJobs.set(jobId, current);
            })
            .catch((err) => {
              logger.error(
                `coverage tags enqueue (${rawCode}) failed`,
                err,
              );
              const current = coverageBackfillJobs.get(jobId);
              if (current?.tags) {
                current.tags.done = true;
                current.error =
                  err instanceof Error ? err.message : String(err);
                maybeFinishCoverageJob(current);
                coverageBackfillJobs.set(jobId, current);
              }
            });
        }

        // If both subjobs ended up no-ops (e.g. nothing matched and
        // nothing was started), close the job out immediately.
        maybeFinishCoverageJob(job);
        coverageBackfillJobs.set(jobId, job);

        return void res.json({
          success: true,
          jobId,
          countryCode: rawCode,
          scope: scopeInput,
          logos: wantLogos
            ? { matched: logoMatched, enqueued: logoEnqueued }
            : null,
          tags: wantTags
            ? {
                started: tagsStarted,
                resumedFrom: resumeHint
                  ? {
                      processed: resumeHint.processed,
                      hydrated: resumeHint.hydrated,
                      emptyUpstream: resumeHint.emptyUpstream,
                      failed: resumeHint.failed,
                      total: resumeHint.total,
                    }
                  : null,
              }
            : null,
        });
      } catch (error: any) {
        logger.error('coverage enqueue failed', error);
        return void res.status(500).json({
          success: false,
          error: error?.message || 'Failed to enqueue country backfill',
        });
      }
    },
  );

  // Poll status for a coverage backfill job. The logo subjob has no
  // in-process callback we can hook (the actual processing is done by the
  // scheduled-logo-processor sweeping `logoAssets`-less rows), so we
  // recompute "remaining" lazily here by counting how many of the
  // originally-enqueued station IDs still don't have a completed
  // `logoAssets` record.
  app.get(
    '/api/admin/coverage/enqueue-job-status/:jobId',
    requireAdmin,
    async (req, res) => {
      const { jobId } = req.params as { jobId: string };
      cleanupCoverageBackfillJobs();
      const job = coverageBackfillJobs.get(jobId);
      if (!job) {
        return void res
          .status(404)
          .json({ success: false, error: 'Job not found' });
      }
      if (job.logos && !job.logos.done && job.logos.enqueuedIds.length > 0) {
        try {
          const completed = await Station.countDocuments({
            _id: {
              $in: job.logos.enqueuedIds.map(
                (id) => new mongoose.Types.ObjectId(id),
              ),
            },
            'logoAssets.status': 'completed',
          });
          job.logos.completed = completed;
          job.logos.remaining = Math.max(
            job.logos.enqueuedIds.length - completed,
            0,
          );
          if (job.logos.remaining === 0) {
            job.logos.done = true;
            maybeFinishCoverageJob(job);
          }
          coverageBackfillJobs.set(jobId, job);
        } catch (err) {
          logger.error('coverage logo progress recompute failed', err);
        }
      }
      // Sanity ceiling: if a job has been "running" for >2h it almost
      // certainly missed a finish signal (e.g. logo processor lagged or a
      // station was deleted). Mark it complete so the UI doesn't spin
      // forever and the row goes back to its normal coverage display.
      const MAX_RUN_MS = 2 * 60 * 60 * 1000;
      if (job.status === 'running' && Date.now() - job.startedAt > MAX_RUN_MS) {
        if (job.logos) job.logos.done = true;
        if (job.tags) job.tags.done = true;
        maybeFinishCoverageJob(job);
        coverageBackfillJobs.set(jobId, job);
      }
      // Don't ship the full enqueuedIds array on every poll — it can be
      // a few thousand strings per country.
      const { logos, ...rest } = job;
      return void res.json({
        success: true,
        job: {
          ...rest,
          logos: logos
            ? {
                matched: logos.matched,
                enqueued: logos.enqueuedIds.length,
                completed: logos.completed,
                remaining: logos.remaining,
                done: logos.done,
              }
            : undefined,
        },
      });
    },
  );

  // Cancel a running country backfill. The tags subjob's
  // `hydrateMissingTagsInBackground` polls `cancelRequested` between
  // batches and exits cleanly; the logo subjob's actual processing is
  // handled out-of-process by the scheduled-logo-processor, so we can't
  // truly abort an in-flight favicon download — but we mark the logo
  // bucket done so the job can transition to `cancelled` and the UI
  // indicator clears, matching the recheck-tags cancel flow.
  app.post(
    '/api/admin/coverage/enqueue-job-cancel/:jobId',
    requireAdmin,
    async (req, res) => {
      const { jobId } = req.params as { jobId: string };
      const job = coverageBackfillJobs.get(jobId);
      if (!job) {
        return void res
          .status(404)
          .json({ success: false, error: 'Job not found' });
      }
      if (job.status !== 'running') {
        return void res.json({ success: true, alreadyFinished: true });
      }
      if (!job.cancellable) {
        return void res
          .status(409)
          .json({ success: false, error: 'Job is not cancellable' });
      }
      job.cancelRequested = true;
      // Task #252: stash the current tags counters now so an Undo that
      // arrives before the loop's `.then` has a chance to run still has
      // resume data to pick up. The `.then` will overwrite this hint with
      // the post-final-batch numbers if it gets there first; either way
      // the next enqueue for this country picks up the freshest values.
      if (job.tags && (job.tags.processed > 0 || job.tags.hydrated > 0)) {
        stashCoverageTagsResumeHint(job.countryCode, job.tags, job.jobId);
      }
      // Logo processing happens in the out-of-process scheduled sweeper —
      // we can't pull stations back off its queue, so the most we can do
      // is stop tracking remaining work and let the job transition.
      if (job.logos && !job.logos.done) {
        job.logos.done = true;
      }
      // If tags weren't started or already finished, the cancel flag has
      // nothing to poll; transition immediately.
      if (!job.tags || job.tags.done) {
        maybeFinishCoverageJob(job);
      }
      coverageBackfillJobs.set(jobId, job);
      logger.log(
        `🛑 Coverage backfill ${jobId} (${job.countryCode}) cancellation requested`,
      );
      return void res.json({ success: true });
    },
  );

  // Task #342: short audit trail of recent backfill runs for one country
  // so admins can spot countries that repeatedly cancel / resume / stall.
  // Newest-first, capped at COVERAGE_BACKFILL_HISTORY_MAX entries. Lives
  // alongside the in-process job map; a server restart starts the buffer
  // empty (acceptable for short-term operational triage).
  app.get(
    '/api/admin/coverage/backfill-history/:countryCode',
    requireAdmin,
    async (req, res) => {
      const rawCode = String(req.params.countryCode || '')
        .trim()
        .toUpperCase();
      if (!rawCode) {
        return void res
          .status(400)
          .json({ success: false, error: 'countryCode is required' });
      }
      const runs = coverageBackfillHistory.get(rawCode) ?? [];
      const resumedCount = runs.filter((r) => !!r.resumedFromJobId).length;
      const cancelledCount = runs.filter((r) => r.status === 'cancelled').length;
      return void res.json({
        success: true,
        countryCode: rawCode,
        runs,
        summary: {
          total: runs.length,
          cancelled: cancelledCount,
          resumed: resumedCount,
        },
      });
    },
  );

  // Re-run the historical sparkline reconstruction (Task #237). Mirrors
  // `scripts/backfill-coverage-snapshots.ts` but invokable from the
  // admin coverage page so admins can re-seed history after a bulk
  // import without shell access. Idempotent: real cron-written rows are
  // preserved by `$setOnInsert`. Reconstructed rows are tagged with
  // `source: 'backfill'` and the nightly cron promotes them to `'cron'`
  // as days roll over.
  app.post(
    '/api/admin/coverage/reconstruct-history',
    express.json(),
    requireAdmin,
    async (req, res) => {
      try {
        const rawDays = req.body?.days;
        const daysNum = rawDays === undefined ? 30 : Number(rawDays);
        if (!Number.isFinite(daysNum) || !Number.isInteger(daysNum) || daysNum < 1 || daysNum > 365) {
          return void res.status(400).json({
            success: false,
            error: 'days must be an integer between 1 and 365',
          });
        }
        const dryRun = req.body?.dryRun === true;

        // Task #318: kick the seeder off in the background and return a
        // jobId immediately so the request doesn't sit open for the
        // (potentially long) duration of a 365-day reconstruction. Per-day
        // progress is reported via the seeder's onProgress callback into a
        // shared in-process map; the UI polls
        // /reconstruct-history-status/:jobId for updates.
        cleanupCoverageReconstructionJobs();
        const jobId = new mongoose.Types.ObjectId().toString();
        const job: CoverageReconstructionJob = {
          jobId,
          days: daysNum,
          dryRun,
          status: 'running',
          startedAt: Date.now(),
          daysProcessed: 0,
          daysTotal: daysNum,
          daysSeeded: 0,
          inserted: 0,
          preserved: 0,
          wouldWrite: 0,
          currentDay: null,
          cancelRequested: false,
        };
        coverageReconstructionJobs.set(jobId, job);

        const onProgress = (p: RunCoverageBackfillProgress) => {
          const current = coverageReconstructionJobs.get(jobId);
          if (!current) return;
          current.daysProcessed = p.daysProcessed;
          current.daysTotal = p.daysTotal;
          current.daysSeeded = p.daysSeeded;
          current.inserted = p.inserted;
          current.preserved = p.preserved;
          current.wouldWrite = p.wouldWrite;
          current.currentDay = p.day || current.currentDay;
          coverageReconstructionJobs.set(jobId, current);
        };

        void runCoverageBackfill({
          days: daysNum,
          dryRun,
          onProgress,
          isCancelled: () =>
            coverageReconstructionJobs.get(jobId)?.cancelRequested === true,
        })
          .then((result) => {
            const current = coverageReconstructionJobs.get(jobId);
            if (!current) return;
            current.daysSeeded = result.daysSeeded;
            current.inserted = result.inserted;
            current.preserved = result.preserved;
            current.wouldWrite = result.wouldWrite;
            current.skippedReason = result.skippedReason;
            current.daysProcessed = current.daysTotal;
            current.status = result.cancelled
              ? 'cancelled'
              : 'completed';
            current.finishedAt = Date.now();
            coverageReconstructionJobs.set(jobId, current);
          })
          .catch((err) => {
            logger.error('coverage reconstruct-history job failed', err);
            const current = coverageReconstructionJobs.get(jobId);
            if (!current) return;
            current.status = 'failed';
            current.error = err instanceof Error ? err.message : String(err);
            current.finishedAt = Date.now();
            coverageReconstructionJobs.set(jobId, current);
          });

        return void res.json({
          success: true,
          jobId,
          days: daysNum,
          dryRun,
        });
      } catch (error: any) {
        logger.error('coverage reconstruct-history failed', error);
        return void res.status(500).json({
          success: false,
          error: error?.message || 'Failed to reconstruct sparkline history',
        });
      }
    },
  );

  // Poll status for a reconstruction job (Task #318). Returns the latest
  // streamed per-day progress so the UI can render a progress bar similar
  // to the per-country backfills.
  app.get(
    '/api/admin/coverage/reconstruct-history-status/:jobId',
    requireAdmin,
    async (req, res) => {
      const { jobId } = req.params as { jobId: string };
      cleanupCoverageReconstructionJobs();
      const job = coverageReconstructionJobs.get(jobId);
      if (!job) {
        return void res
          .status(404)
          .json({ success: false, error: 'Job not found' });
      }
      return void res.json({ success: true, job });
    },
  );

  // Cancel a running reconstruction job (Task #318). The seeder polls
  // `cancelRequested` between days and exits cleanly; partial progress is
  // preserved (idempotent $setOnInsert means re-running just resumes from
  // the days that weren't reached).
  app.post(
    '/api/admin/coverage/reconstruct-history-cancel/:jobId',
    requireAdmin,
    async (req, res) => {
      const { jobId } = req.params as { jobId: string };
      const job = coverageReconstructionJobs.get(jobId);
      if (!job) {
        return void res
          .status(404)
          .json({ success: false, error: 'Job not found' });
      }
      if (job.status !== 'running') {
        return void res.json({ success: true, alreadyFinished: true });
      }
      job.cancelRequested = true;
      coverageReconstructionJobs.set(jobId, job);
      logger.log(
        `🛑 Coverage reconstruction ${jobId} cancellation requested`,
      );
      return void res.json({ success: true });
    },
  );

  // ====================================================================
    // Shared coverage-compare presets (Task #306)
    //
    // Lets one admin pin a saved comparison so every other admin sees the
    // same quick-pick chip on /admin/coverage/compare. Personal presets
    // continue to live in AdminPreference; this collection only holds the
    // ones explicitly shared with the team.
    //
    // Edit/delete is restricted to the original owner. An optional
    // `SUPER_ADMIN_USERNAMES` env var (comma-separated usernames) lets a
    // designated admin override that restriction without changing schema.
    // ====================================================================
    const SHARED_PRESET_NAME_MAX = 60;
    const SHARED_PRESET_COUNTRIES_MAX = 8;
    const SHARED_PRESET_TOTAL_MAX = 100;

    function getCallerAdminUsername(req: any): string | null {
      const adminAuth = req.session?.adminAuth;
      const username = adminAuth?.username;
      return typeof username === 'string' && username.length > 0 ? username : null;
    }

    function isSuperAdminUsername(username: string): boolean {
      const raw = process.env.SUPER_ADMIN_USERNAMES || '';
      if (!raw.trim()) return false;
      const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
      return list.includes(username);
    }

    function normalizeSharedPresetCountries(raw: unknown): string[] | null {
      if (!Array.isArray(raw)) return null;
      const seen = new Set<string>();
      const out: string[] = [];
      for (const item of raw) {
        if (typeof item !== 'string') continue;
        const code = item.trim().toUpperCase();
        if (!/^[A-Z]{2}$/.test(code)) continue;
        if (seen.has(code)) continue;
        seen.add(code);
        out.push(code);
        if (out.length >= SHARED_PRESET_COUNTRIES_MAX) break;
      }
      return out.length > 0 ? out : null;
    }

    function serializeSharedPreset(doc: any) {
      return {
        id: String(doc._id),
        name: doc.name,
        countries: doc.countries ?? [],
        ownerUsername: doc.ownerUsername,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      };
    }

    app.get('/api/admin/shared-presets', requireAdmin, async (req, res) => {
      try {
        const callerUsername = getCallerAdminUsername(req);
        const docs = await SharedComparisonPreset.find({})
          .sort({ updatedAt: -1 })
          .lean();
        const callerCanManageAll =
          callerUsername !== null && isSuperAdminUsername(callerUsername);
        return void res.json({
          callerUsername,
          callerIsSuperAdmin: callerCanManageAll,
          presets: docs.map(serializeSharedPreset),
        });
      } catch (error: any) {
        logger.error('Error listing shared comparison presets:', error);
        return void res
          .status(500)
          .json({ error: 'Failed to list shared comparison presets' });
      }
    });

    app.post(
      '/api/admin/shared-presets',
      express.json(),
      requireAdmin,
      async (req, res) => {
        try {
          const ownerUsername = getCallerAdminUsername(req);
          if (!ownerUsername) {
            return void res
              .status(401)
              .json({ error: 'Admin identity unavailable' });
          }
          const body = (req.body ?? {}) as { name?: unknown; countries?: unknown };
          const name =
            typeof body.name === 'string'
              ? body.name.trim().slice(0, SHARED_PRESET_NAME_MAX)
              : '';
          if (!name) {
            return void res.status(400).json({ error: 'Preset name is required' });
          }
          const countries = normalizeSharedPresetCountries(body.countries);
          if (!countries) {
            return void res
              .status(400)
              .json({ error: 'At least one valid country code is required' });
          }
          const existingTotal = await SharedComparisonPreset.estimatedDocumentCount();
          if (existingTotal >= SHARED_PRESET_TOTAL_MAX) {
            return void res.status(409).json({
              error: `The team already has ${SHARED_PRESET_TOTAL_MAX} shared presets. Delete one before adding more.`,
            });
          }
          const now = new Date();
          try {
            const doc = await SharedComparisonPreset.create({
              name,
              countries,
              ownerUsername,
              createdAt: now,
              updatedAt: now,
            });
            return void res.status(201).json(serializeSharedPreset(doc.toObject()));
          } catch (err: any) {
            if (err?.code === 11000) {
              return void res
                .status(409)
                .json({ error: 'A shared preset with that name already exists' });
            }
            throw err;
          }
        } catch (error: any) {
          logger.error('Error creating shared comparison preset:', error);
          return void res
            .status(500)
            .json({ error: 'Failed to create shared comparison preset' });
        }
      },
    );

    app.put(
      '/api/admin/shared-presets/:id',
      express.json(),
      requireAdmin,
      async (req, res) => {
        try {
          const callerUsername = getCallerAdminUsername(req);
          if (!callerUsername) {
            return void res
              .status(401)
              .json({ error: 'Admin identity unavailable' });
          }
          const { id } = req.params;
          if (!mongoose.isValidObjectId(id)) {
            return void res.status(400).json({ error: 'Invalid preset id' });
          }
          const existing = await SharedComparisonPreset.findById(id);
          if (!existing) {
            return void res.status(404).json({ error: 'Preset not found' });
          }
          if (
            existing.ownerUsername !== callerUsername &&
            !isSuperAdminUsername(callerUsername)
          ) {
            return void res.status(403).json({
              error: 'Only the owner can edit this shared preset',
            });
          }
          const body = (req.body ?? {}) as { name?: unknown; countries?: unknown };
          if (body.name !== undefined) {
            const name =
              typeof body.name === 'string'
                ? body.name.trim().slice(0, SHARED_PRESET_NAME_MAX)
                : '';
            if (!name) {
              return void res
                .status(400)
                .json({ error: 'Preset name is required' });
            }
            existing.name = name;
          }
          if (body.countries !== undefined) {
            const countries = normalizeSharedPresetCountries(body.countries);
            if (!countries) {
              return void res
                .status(400)
                .json({ error: 'At least one valid country code is required' });
            }
            existing.countries = countries;
          }
          existing.updatedAt = new Date();
          try {
            await existing.save();
          } catch (err: any) {
            if (err?.code === 11000) {
              return void res
                .status(409)
                .json({ error: 'A shared preset with that name already exists' });
            }
            throw err;
          }
          return void res.json(serializeSharedPreset(existing.toObject()));
        } catch (error: any) {
          logger.error('Error updating shared comparison preset:', error);
          return void res
            .status(500)
            .json({ error: 'Failed to update shared comparison preset' });
        }
      },
    );

    app.delete(
      '/api/admin/shared-presets/:id',
      requireAdmin,
      async (req, res) => {
        try {
          const callerUsername = getCallerAdminUsername(req);
          if (!callerUsername) {
            return void res
              .status(401)
              .json({ error: 'Admin identity unavailable' });
          }
          const { id } = req.params;
          if (!mongoose.isValidObjectId(id)) {
            return void res.status(400).json({ error: 'Invalid preset id' });
          }
          const existing = await SharedComparisonPreset.findById(id);
          if (!existing) {
            return void res.json({ id, deleted: 0 });
          }
          if (
            existing.ownerUsername !== callerUsername &&
            !isSuperAdminUsername(callerUsername)
          ) {
            return void res.status(403).json({
              error: 'Only the owner can delete this shared preset',
            });
          }
          await existing.deleteOne();
          return void res.json({ id, deleted: 1 });
        } catch (error: any) {
          logger.error('Error deleting shared comparison preset:', error);
          return void res
            .status(500)
            .json({ error: 'Failed to delete shared comparison preset' });
        }
      },
    );

    // RUN-BACKFILL-NOW (Task #315) — admin-triggered re-run of the same
    // first-deploy historical seeder that `services/coverage-backfill-on-boot.ts`
    // kicks off automatically on boot. The boot path skips when
    // `SKIP_COVERAGE_BACKFILL_ON_BOOT=true` or when historical rows already
    // exist above the threshold; if either condition leaves the sparkline
    // empty, an admin can press "Run backfill now" on the boot-status card
    // instead of restarting the API or running the CLI script.
    //
    // Reuses the singleton `coveragebackfillstatuses` doc so the same card
    // flips through 'running' → 'done'/'done-no-stations'/'failed' without
    // any extra UI surface. Dry runs return inline and do not touch the
    // status doc (we don't want to overwrite real boot history with a
    // synthetic "done — 0 inserted" line).
    app.post(
      '/api/admin/coverage/run-backfill-now',
      express.json(),
      requireAdmin,
      async (req, res) => {
        try {
          const rawDays = req.body?.days;
          let days: number | undefined;
          if (rawDays !== undefined && rawDays !== null && rawDays !== '') {
            const n = Number(rawDays);
            if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 365) {
              return void res.status(400).json({
                success: false,
                error: 'days must be an integer between 1 and 365',
              });
            }
            days = n;
          }
          const dryRun = req.body?.dryRun === true;
          const result = await runCoverageBackfillNow({ days, dryRun });
          if (result.kind === 'busy') {
            return void res.status(409).json({
              success: false,
              error:
                'A manual coverage backfill is already running on this server. Wait for it to finish before starting another.',
            });
          }
          return void res.json({ success: true, ...result });
        } catch (error: any) {
          logger.error('coverage run-backfill-now failed', error);
          return void res.status(500).json({
            success: false,
            error: error?.message || 'Failed to start coverage backfill',
          });
        }
      },
    );
  }
  