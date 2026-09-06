import type { Express } from "express";
import {
  pgSlugStatistics,
  pgStartSlugGeneration,
  runPgSlugGeneration,
  pgClearAllSlugs,
} from "../data/postgres-slug-store";
import {
  pgMaintenanceJobs,
  pgStopMaintenanceJobs,
} from "../data/postgres-maintenance-store";
import CacheManager from "../cache";
import { logger } from "../utils/logger";
export function registerSlugRoutes(app: Express, deps: any) {
  const { requireAdmin } = deps;
  if (!requireAdmin) throw new Error("slug-routes requires requireAdmin");
  app.get(
    "/api/admin/station-slugs/status",
    requireAdmin,
    async (_req, res) => {
      try {
        res.json(await pgSlugStatistics());
      } catch {
        res.status(500).json({ error: "Failed to fetch slug statistics" });
      }
    },
  );
  app.get(
    "/api/admin/station-slugs/job-status",
    requireAdmin,
    async (_req, res) => {
      try {
        res.json((await pgMaintenanceJobs("slug"))[0] || null);
      } catch {
        res.status(500).json({ error: "Failed to fetch job status" });
      }
    },
  );
  app.post("/api/admin/station-slugs/stop", requireAdmin, async (_req, res) => {
    try {
      await pgStopMaintenanceJobs("slug");
      res.json({ success: true, message: "Generation stopped" });
    } catch {
      res.status(500).json({ error: "Failed to stop generation" });
    }
  });
  app.post("/api/clear-all-slugs", requireAdmin, async (_req, res) => {
    try {
      res.json(await pgClearAllSlugs());
    } catch (error) {
      res.status(409).json({ error: (error as Error).message });
    }
  });
  const background = (
    id: string,
    token: string,
    all: boolean,
    stationsOnly: boolean,
  ) =>
    setImmediate(() => {
      void runPgSlugGeneration(id, token, all, stationsOnly)
        .then(async () => {
          for (const key of ["stations", "genres", "seo", "similar"])
            await CacheManager.clearByPattern(key);
        })
        .catch((error) =>
          logger.error("Slug generation worker failed:", error),
        );
    });
  app.post("/api/generate-all-slugs", requireAdmin, async (req, res) => {
    try {
      const all = req.body?.regenerateAll === true;
      const { job, token } = await pgStartSlugGeneration(all);
      res.json(job);
      background(job.jobId, token, all, false);
    } catch (error: any) {
      res
        .status(error.code === "23505" ? 409 : 500)
        .json({
          error:
            error.code === "23505"
              ? "Slug generation already running"
              : "Failed to start slug generation",
        });
    }
  });
  app.post(
    "/api/admin/stations/generate-slugs",
    requireAdmin,
    async (_req, res) => {
      try {
        const { job, token } = await pgStartSlugGeneration(true, true);
        res.json({
          success: true,
          message:
            "Slug generation started in background for " +
            job.progress.total +
            " stations",
          status: "started",
          totalStations: job.progress.total,
          jobId: job.jobId,
        });
        background(job.jobId, token, true, true);
      } catch (error: any) {
        res
          .status(error.code === "23505" ? 409 : 500)
          .json({
            error:
              error.code === "23505"
                ? "Slug generation already running"
                : "Failed to start slug generation",
          });
      }
    },
  );
}
