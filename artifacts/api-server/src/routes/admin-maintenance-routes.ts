import type { Express, Request, Response } from "express";
import { Station, BackfillRun } from "../shared/mongo-schemas";
import { radioBrowserService } from "../services/radio-browser";
import { scheduledBackfill } from "../services/scheduled-backfill";
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
  const job: BackfillState = {
    jobId: makeJobId(),
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
      job.finishedAt = new Date();
      job.isRunning = false;
      logger.log(
        `[tags-backfill] done: scanned=${job.scanned} updated=${job.updated} ` +
          `failed=${job.failed} skipped=${job.skipped}`,
      );
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
        const country = (req.body?.country as string | undefined) || null;
        const limit = Math.max(1, Math.min(5000, Number(req.body?.limit) || 500));
        if (activeTagsJob && activeTagsJob.isRunning) {
          return res.status(409).json({ error: "already_running", job: activeTagsJob });
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
            return res.status(400).json({
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
          return res.status(409).json({
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
}
