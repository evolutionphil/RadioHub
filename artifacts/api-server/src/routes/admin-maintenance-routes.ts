import type { Express, Request, Response } from "express";
import mongoose from "mongoose";
import {
  Station,
  BackfillRun,
  GenreSlugCleanupRun,
  type IBackfillRun,
} from "../shared/mongo-schemas";
import {
  BACKFILL_RETENTION_DAYS,
  BACKFILL_RETENTION_MAX_ROWS,
} from "../services/scheduled-backfill";
import { radioBrowserService } from "../services/radio-browser";
import { scheduledBackfill } from "../services/scheduled-backfill";
import { scheduledGenreSlugCleanup } from "../services/scheduled-genre-slug-cleanup";
import { getGenreSlugCleanupAlertThreshold } from "../services/genre-slug-cleanup-notifier";
import { logger } from "../utils/logger";

// SEO maintenance dashboard endpoints. Surface the health metrics the
// Türkiye audit relies on (broken streams, missing tags, missing logos,
// missing description) and let the admin trigger one-shot tags backfill
// from Radio-Browser. Logo backfill is exposed via the existing
// /api/admin/logos/process-all endpoint — this module deliberately
// does NOT duplicate it.
//
// All endpoints require admin auth via the `requireAdmin` middleware
// injected from the deps bag.

interface BackfillState {
  jobId: string;
  runId: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  countryCode: string | null;
  scanned: number;
  updated: number;
  failed: number;
  skipped: number;
  isRunning: boolean;
  lastError: string | null;
}

let activeTagsJob: BackfillState | null = null;

function makeJobId() {
  return `tagsfill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function runTagsBackfill(countryCode: string | null, limitMax: number) {
  if (activeTagsJob && activeTagsJob.isRunning) {
    return activeTagsJob;
  }
  // Persist a BackfillRun-style audit row so the tags-only sweep shows up
  // in the same history table as the weekly logo+tag sweep. We use
  // `topN: 0` to flag that this isn't a top-N pick — it's either a
  // global tags-only fill (no overrideCountry) or a single-country one.
  const trigger = countryCode
    ? `admin:manual:tags:${countryCode}`
    : "admin:manual:tags";
  let run: IBackfillRun | null = null;
  try {
    run = await BackfillRun.create({
      trigger,
      status: "running",
      topN: 0,
      overrideCountry: countryCode || undefined,
      startedAt: new Date(),
      logos: [],
      tags: [],
    });
  } catch (err: any) {
    // Non-fatal — we still run the in-memory job so admins aren't blocked
    // if the audit row fails to persist (e.g. transient Mongo blip). The
    // existing in-memory state surfaces progress in the meantime.
    logger.error(
      "[tags-backfill] failed to persist BackfillRun audit row:",
      err?.message || err,
    );
  }
  const job: BackfillState = {
    jobId: makeJobId(),
    runId: run ? String(run._id) : null,
    startedAt: new Date(),
    finishedAt: null,
    countryCode,
    scanned: 0,
    updated: 0,
    failed: 0,
    skipped: 0,
    isRunning: true,
    lastError: null,
  };
  activeTagsJob = job;

  // Run async — caller already got the jobId back.
  (async () => {
    try {
      // Pick up stations missing EITHER tags or languageCodes — both are
      // independently used by the SEO outro template / hreflang gate, and a
      // station may have one but not the other.
      const filter: any = {
        $or: [
          { tags: { $exists: false } },
          { tags: null },
          { tags: "" },
          { languageCodes: { $exists: false } },
          { languageCodes: null },
          { languageCodes: "" },
        ],
        stationuuid: { $exists: true, $nin: [null, ""] },
      };
      if (countryCode) filter.countryCode = countryCode.toUpperCase();

      const cursor = Station.find(filter)
        .select("_id stationuuid slug name countryCode tags languageCodes")
        .limit(limitMax)
        .cursor();

      const BATCH = 25;
      let batch: any[] = [];

      const flush = async () => {
        if (batch.length === 0) return;
        const items = batch;
        batch = [];
        await Promise.allSettled(
          items.map(async (s: any) => {
            job.scanned++;
            try {
              const fetched = await radioBrowserService.getStationByUuid(s.stationuuid);
              const fresh = Array.isArray(fetched) ? fetched[0] : null;
              if (!fresh) {
                job.skipped++;
                return;
              }
              const update: any = {};
              const hasTags = typeof s.tags === "string" && s.tags.trim() !== "";
              const hasLangs =
                typeof s.languageCodes === "string" && s.languageCodes.trim() !== "";
              // Only fill MISSING fields — never overwrite curated values that
              // may already be on the DB record (the filter is OR, so one of
              // tags/languageCodes can be populated while the other is empty).
              if (!hasTags && fresh.tags && fresh.tags.trim() !== "") {
                update.tags = fresh.tags;
              }
              if (
                !hasLangs &&
                fresh.languagecodes &&
                fresh.languagecodes.trim() !== ""
              ) {
                update.languageCodes = fresh.languagecodes;
              }
              if (Object.keys(update).length === 0) {
                job.skipped++;
                return;
              }
              await Station.updateOne({ _id: s._id }, { $set: update });
              job.updated++;
            } catch (err: any) {
              job.failed++;
              job.lastError = err?.message || String(err);
            }
          }),
        );
        // Be polite to the upstream API.
        await new Promise((r) => setTimeout(r, 250));
      };

      for await (const doc of cursor) {
        batch.push(doc);
        if (batch.length >= BATCH) await flush();
      }
      await flush();
    } catch (err: any) {
      logger.error("[tags-backfill] crashed:", err?.message || err);
      job.lastError = err?.message || String(err);
    } finally {
      const finishedAt = new Date();
      job.finishedAt = finishedAt;
      job.isRunning = false;
      logger.log(
        `[tags-backfill] done: scanned=${job.scanned} updated=${job.updated} ` +
          `failed=${job.failed} skipped=${job.skipped}`,
      );
      // Mirror the in-memory totals into the persisted audit row so
      // admins can see the same numbers in the BackfillRun history table
      // long after the in-memory `activeTagsJob` has been overwritten by
      // a subsequent run. Per-country breakdown uses the single
      // overrideCountry (or "*" for global) since this sweep doesn't
      // group by country itself.
      if (run) {
        try {
          run.status = job.lastError ? "failed" : "completed";
          run.finishedAt = finishedAt;
          run.durationMs = finishedAt.getTime() - job.startedAt.getTime();
          if (job.lastError) run.errorMessage = job.lastError;
          run.tags.splice(0, run.tags.length);
          run.tags.push({
            countryCode: countryCode || "*",
            processed: job.scanned,
            hydrated: job.updated,
            emptyUpstream: job.skipped,
            failed: job.failed,
          });
          await run.save();
        } catch (saveErr: any) {
          logger.error(
            "[tags-backfill] failed to persist final BackfillRun row:",
            saveErr?.message || saveErr,
          );
        }
      }
    }
  })();

  return job;
}

export function registerAdminMaintenanceRoutes(app: Express, deps: any) {
  const { requireAdmin } = deps;

  // Aggregated SEO health stats. Optional `?country=TR` narrows everything
  // to a single market. With no filter it returns the global picture.
  app.get(
    "/api/admin/seo-health-stats",
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const country = (req.query.country as string | undefined)?.toUpperCase();
        const base: any = country ? { countryCode: country } : {};

        const [
          total,
          noIndex,
          noTagsCount,
          noLanguageCodes,
          noLogoAssets,
          missingTrFull,
          missingEnFull,
          brokenStreamIndexable,
          brokenStreamOver30d,
        ] = await Promise.all([
          Station.countDocuments(base),
          Station.countDocuments({ ...base, noIndex: true }),
          Station.countDocuments({ ...base, $or: [{ tags: { $exists: false } }, { tags: null }, { tags: "" }] }),
          Station.countDocuments({ ...base, $or: [{ languageCodes: { $exists: false } }, { languageCodes: null }, { languageCodes: "" }] }),
          Station.countDocuments({ ...base, $or: [{ logoAssets: { $exists: false } }, { logoAssets: null }] }),
          Station.countDocuments({
            ...base,
            $or: [
              { "descriptions.tr.full": { $exists: false } },
              { "descriptions.tr.full": "" },
            ],
          }),
          Station.countDocuments({
            ...base,
            $or: [
              { "descriptions.en.full": { $exists: false } },
              { "descriptions.en.full": "" },
            ],
          }),
          Station.countDocuments({
            ...base,
            lastCheckOk: false,
            $or: [{ noIndex: { $exists: false } }, { noIndex: false }],
          }),
          Station.countDocuments({
            ...base,
            lastCheckOk: false,
            $or: [{ noIndex: { $exists: false } }, { noIndex: false }],
            $expr: {
              $or: [
                { $eq: [{ $type: "$lastCheckOkTime" }, "missing"] },
                { $lt: ["$lastCheckOkTime", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)] },
              ],
            },
          }),
        ]);

        res.json({
          country: country || null,
          total,
          noIndex,
          missing: {
            tags: noTagsCount,
            languageCodes: noLanguageCodes,
            logoAssets: noLogoAssets,
            descriptionTr: missingTrFull,
            descriptionEn: missingEnFull,
          },
          brokenStream: {
            indexableTotal: brokenStreamIndexable,
            deadOver30Days: brokenStreamOver30d,
          },
        });
      } catch (err: any) {
        logger.error("[seo-health-stats] error:", err?.message || err);
        res.status(500).json({ error: err?.message || "internal_error" });
      }
    },
  );

  // Trigger a tags + languageCodes backfill from Radio-Browser. Returns
  // immediately with the jobId; poll /api/admin/seo-health-stats and
  // /api/admin/maintenance/tags-backfill/status for progress.
  app.post(
    "/api/admin/maintenance/tags-backfill",
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        // Match the validation surface the weekly /scheduled-backfill/run
        // endpoint already enforces: empty/missing → global sweep, otherwise
        // a 2-letter ISO code that gets uppercased before hitting the
        // filter / audit row. Anything else is rejected so we don't end up
        // persisting garbage in the BackfillRun history.
        const raw = (req.body?.country as string | undefined) ?? null;
        let country: string | null = null;
        if (raw !== null && raw !== "") {
          const normalized = String(raw).trim().toUpperCase();
          if (normalized !== "") {
            if (!/^[A-Z]{2}$/.test(normalized)) {
              return void res.status(400).json({
                error: "invalid_country_code",
                message:
                  "country must be a 2-letter ISO code (e.g. 'TR') or omitted.",
              });
            }
            country = normalized;
          }
        }
        const limit = Math.max(1, Math.min(5000, Number(req.body?.limit) || 500));
        if (activeTagsJob && activeTagsJob.isRunning) {
          return void res.status(409).json({ error: "already_running", job: activeTagsJob });
        }
        const job = await runTagsBackfill(country, limit);
        res.json({ ok: true, job });
      } catch (err: any) {
        logger.error("[tags-backfill trigger] error:", err?.message || err);
        res.status(500).json({ error: err?.message || "internal_error" });
      }
    },
  );

  app.get(
    "/api/admin/maintenance/tags-backfill/status",
    requireAdmin,
    (_req: Request, res: Response) => {
      res.json({ job: activeTagsJob });
    },
  );

  // Manually kick off the weekly cross-country logo + tag backfill that
  // normally runs Sundays 04:00 Europe/Berlin. Honours the same single-
  // instance lock as the cron, so a double-click while one is already
  // running returns 409 with the in-flight run instead of starting a
  // second sweep. Returns immediately with the BackfillRun row that the
  // service just persisted; the actual work continues in the background
  // and progress can be observed via the status endpoint below.
  app.post(
    "/api/admin/maintenance/scheduled-backfill/run",
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        // Optional { countryCode } body lets admins target a long-tail
        // market that isn't currently in the cron's top-5. Empty/missing
        // body keeps the legacy behaviour. Reject anything that isn't a
        // 2-letter ISO code so we don't end up persisting garbage in the
        // BackfillRun history rows.
        const raw = (req.body?.countryCode as string | undefined) ?? null;
        let countryCode: string | undefined;
        if (raw !== null && raw !== "") {
          const normalized = String(raw).trim().toUpperCase();
          if (!/^[A-Z]{2}$/.test(normalized)) {
            return void res.status(400).json({
              error: "invalid_country_code",
              message: "countryCode must be a 2-letter ISO code (e.g. 'TR') or omitted.",
            });
          }
          countryCode = normalized;
        }

        const trigger = countryCode
          ? `admin:manual:${countryCode}`
          : "admin:manual";

        // `start()` persists the BackfillRun row immediately, kicks the
        // sweep off in the background, and returns the row so we can
        // hand it back without holding the HTTP connection open for the
        // (potentially multi-minute) job. Returns null if the single-
        // instance lock is already held.
        const run = await scheduledBackfill.start(trigger, { countryCode });
        if (!run) {
          return void res.status(409).json({
            error: "already_running",
            status: scheduledBackfill.getStatus(),
          });
        }
        res.json({
          ok: true,
          status: scheduledBackfill.getStatus(),
          run,
        });
      } catch (err: any) {
        logger.error(
          "[scheduled-backfill manual] failed to start:",
          err?.message || err,
        );
        res.status(500).json({ error: err?.message || "internal_error" });
      }
    },
  );

  // Paginated list of historical BackfillRun rows so the dashboard can
  // render a "last N runs" table beside the latest-run summary card.
  // Optional `?trigger=cron:weekly` (or `admin:manual`) narrows by source;
  // `?limit=` defaults to 10 and is capped at 50 to keep the payload
  // small. Rows are returned newest-first by `startedAt`.
  app.get(
    "/api/admin/maintenance/scheduled-backfill/runs",
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const limit = Math.max(
          1,
          Math.min(50, Number(req.query.limit) || 10),
        );
        const trigger = (req.query.trigger as string | undefined)?.trim();
        const filter: any = {};
        if (trigger) filter.trigger = trigger;
        // Paged rows + collection-wide totals so the dashboard can show
        // "showing X of Y · oldest from <date>" and admins know how
        // deep the retained history actually goes (Task #180).
        const [runs, total, oldest] = await Promise.all([
          BackfillRun.find(filter)
            .sort({ startedAt: -1 })
            .limit(limit)
            .lean(),
          BackfillRun.countDocuments(filter),
          BackfillRun.findOne(filter)
            .sort({ startedAt: 1 })
            .select({ startedAt: 1 })
            .lean<{ startedAt: Date } | null>(),
        ]);
        res.json({
          runs,
          total,
          oldestStartedAt: oldest?.startedAt ?? null,
          // Echo the effective retention thresholds so the dashboard can
          // render an accurate "kept for X days / Y rows" hint even when
          // ops has overridden the defaults via env vars.
          retention: {
            days: BACKFILL_RETENTION_DAYS,
            maxRows: BACKFILL_RETENTION_MAX_ROWS,
          },
        });
      } catch (err: any) {
        logger.error(
          "[scheduled-backfill runs] error:",
          err?.message || err,
        );
        res.status(500).json({ error: err?.message || "internal_error" });
      }
    },
  );

  // Single BackfillRun document by id. Powers the deep-linkable
  // /admin/seo-maintenance/runs/:id detail page so an admin can paste
  // a link to a specific run without making the recipient scroll the
  // history table. Returns 400 for malformed ObjectIds and 404 when
  // the row doesn't exist (or has been pruned by retention).
  app.get(
    "/api/admin/maintenance/scheduled-backfill/runs/:id",
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        if (!mongoose.isValidObjectId(id)) {
          return void res.status(400).json({ error: "invalid_id" });
        }
        const run = await BackfillRun.findById(id).lean();
        if (!run) {
          return void res.status(404).json({ error: "not_found" });
        }
        res.json({ run });
      } catch (err: any) {
        logger.error(
          "[scheduled-backfill run detail] error:",
          err?.message || err,
        );
        res.status(500).json({ error: err?.message || "internal_error" });
      }
    },
  );

  // Live status of the scheduled backfill plus the most recent
  // BackfillRun row so the dashboard can render "running…" vs the last
  // completed summary without the client having to know about Mongo
  // shapes.
  app.get(
    "/api/admin/maintenance/scheduled-backfill/status",
    requireAdmin,
    async (_req: Request, res: Response) => {
      try {
        const status = scheduledBackfill.getStatus();
        const lastRun = await BackfillRun.findOne()
          .sort({ startedAt: -1 })
          .lean();
        res.json({ status, lastRun });
      } catch (err: any) {
        logger.error(
          "[scheduled-backfill status] error:",
          err?.message || err,
        );
        res.status(500).json({ error: err?.message || "internal_error" });
      }
    },
  );

  // Task #198: paginated history of GenreSlugCleanupRun rows so the
  // admin dashboard can render the same scanned/normalized/demoted
  // counts the alert webhook uses. Mirrors the scheduled-backfill/runs
  // shape (newest-first, optional `?trigger=` filter, capped `?limit=`,
  // collection totals + oldest row) so the frontend table component
  // can be implemented the same way. Also echoes the live status and
  // the configured alert threshold so the UI can highlight rows that
  // would have alerted.
  app.get(
    "/api/admin/maintenance/genre-slug-cleanup/runs",
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const limit = Math.max(
          1,
          Math.min(50, Number(req.query.limit) || 10),
        );
        const trigger = (req.query.trigger as string | undefined)?.trim();
        const filter: any = {};
        if (trigger) filter.trigger = trigger;
        const [runs, total, oldest] = await Promise.all([
          GenreSlugCleanupRun.find(filter)
            .sort({ startedAt: -1 })
            .limit(limit)
            .lean(),
          GenreSlugCleanupRun.countDocuments(filter),
          GenreSlugCleanupRun.findOne(filter)
            .sort({ startedAt: 1 })
            .select({ startedAt: 1 })
            .lean<{ startedAt: Date } | null>(),
        ]);
        res.json({
          runs,
          total,
          oldestStartedAt: oldest?.startedAt ?? null,
          alertThreshold: getGenreSlugCleanupAlertThreshold(),
          status: scheduledGenreSlugCleanup.getStatus(),
        });
      } catch (err: any) {
        logger.error(
          "[genre-slug-cleanup runs] error:",
          err?.message || err,
        );
        res.status(500).json({ error: err?.message || "internal_error" });
      }
    },
  );
}
