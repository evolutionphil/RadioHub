import { type Express } from "express";
import { pgCatalog, pgSyncLogs } from "../data/postgres-catalog-store";
import { pgDashboardTotals } from "../data/postgres-discovery-operations";
import { pgCountStationDebugLogs } from "../data/postgres-station-debug-store";
import { pgContentCounts } from "../data/postgres-content-store";
import { pgLocalization } from "../data/postgres-localization-store";
import CacheManager from "../cache";
import { logger } from "../utils/logger";

type HealthStatus = "online" | "stale" | "offline" | "active" | "empty";

interface DashboardHealth {
  database: "online" | "offline";
  radioBrowser: "online" | "stale" | "offline";
  translations: "active" | "empty" | "unavailable";
  lastSyncHoursAgo: number | null;
}

export function registerCacheDashboardRoutes(app: Express, deps: any) {
  const { requireAdmin } = deps;
  if (!requireAdmin) {
    throw new Error("cache-dashboard-routes requires deps.requireAdmin");
  }

  // CACHE MANAGEMENT API — admin-only (cache clear was a public DoS lever)
  app.get("/api/cache/stats", requireAdmin, async (req, res) => {
    try {
      const stats = CacheManager.getStats();
      res.json({
        ...stats,
        message: "Cache statistics retrieved successfully",
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch cache stats" });
    }
  });

  // Allowlist of cache patterns admins are permitted to clear. Free-form
  // patterns enable destructive global wipes; lock to known prefixes.
  const ALLOWED_CLEAR_PATTERNS = new Set([
    "genres",
    "stations",
    "translations",
    "sitemap",
    "seo",
    "social",
    "tv",
    "dashboard",
    "countries",
    "cities",
    "similar",
    "search",
  ]);

  // EXPRESS 5 OPTIONAL-PARAM FIX (2026-07-04): same class as the regions
  // route — `/{:pattern}` keeps the slash required, so the pattern-less
  // /api/cache/clear only matched WITH a trailing slash. `{/:pattern}`
  // makes both forms work (the handler already 400s on a missing pattern).
  app.delete("/api/cache/clear{/:pattern}", requireAdmin, async (req, res) => {
    try {
      const { pattern } = req.params;
      if (!pattern) {
        return void res
          .status(400)
          .json({
            error:
              "Pattern is required (use one of: " +
              Array.from(ALLOWED_CLEAR_PATTERNS).join(", ") +
              ")",
          });
      }
      if (!ALLOWED_CLEAR_PATTERNS.has(pattern)) {
        return void res
          .status(400)
          .json({
            error: `Invalid pattern. Allowed: ${Array.from(ALLOWED_CLEAR_PATTERNS).join(", ")}`,
          });
      }
      await CacheManager.clearByPattern(pattern);
      logger.log(
        `🧹 Admin cleared cache pattern "${pattern}" (actor=${(req as any).session?.user?.email || "unknown"})`,
      );
      res.json({
        message: `Cleared cache entries matching pattern: ${pattern}`,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to clear cache" });
    }
  });

  // DASHBOARD STATS API
  app.get("/api/dashboard/stats", async (req, res) => {
    try {
      const CACHE_KEY = "dashboard:stats:v1";
      const cached = await CacheManager.get(CACHE_KEY);
      if (cached) return void res.json(cached);

      const [
        totals,
        syncLogs,
        errorCount,
        contentCounts,
        topCountries,
        topGenres,
        codecDistribution,
      ] = await Promise.all([
        pgDashboardTotals(),
        pgSyncLogs(1),
        pgCountStationDebugLogs({ isResolved: false }),
        pgContentCounts(),
        pgCatalog().groupCount("country", {
          country: { $exists: true, $ne: null },
        }),
        pgCatalog().groupCount("tags", { tags: { $exists: true, $ne: null } }),
        pgCatalog().groupCount("codec", {
          codec: { $exists: true, $ne: null },
        }),
      ]);
      const {
        totalStations,
        totalCountries,
        totalLanguages,
        totalGenres,
        totalCodecs,
        workingStations,
        recentlyUpdated,
        userCount,
        stationsWithFavicon,
        stationsWithDesc,
        activeVisitors,
        todayVisitors,
        weekVisitors,
        activeRegisteredUsers,
      } = totals;
      const feedbackCount = contentCounts.openFeedback;
      const lastSyncLog = syncLogs[0];
      const lastSyncTime = lastSyncLog?.completedAt || lastSyncLog?.startedAt;
      const isRecentSync =
        lastSyncTime &&
        new Date(lastSyncTime).getTime() > Date.now() - 24 * 60 * 60 * 1000;

      // Real system health: DB connection state, freshness of the last sync
      // run, and whether the translation table has been seeded. Counted as a
      // dashboard sub-stat so the existing 5-min cache covers it too.
      const health: DashboardHealth = await (async () => {
        const dbState: "online" | "offline" = "online"; // The PostgreSQL metrics query above succeeded.

        let radioBrowser: "online" | "stale" | "offline" = "offline";
        let lastSyncHoursAgo: number | null = null;
        if (lastSyncTime) {
          const ageHours =
            (Date.now() - new Date(lastSyncTime).getTime()) / 3_600_000;
          lastSyncHoursAgo = Math.round(ageHours * 10) / 10;
          radioBrowser = ageHours < 25 ? "online" : "stale";
        }

        let translations: "active" | "empty" | "unavailable" = "unavailable";
        try {
          const count = await pgLocalization().countKeys();
          translations = count > 0 ? "active" : "empty";
        } catch {}

        return {
          database: dbState,
          radioBrowser,
          translations,
          lastSyncHoursAgo,
        };
      })();

      const stats = {
        totalStations,
        totalCountries,
        totalLanguages,
        totalGenres,
        totalCodecs,
        workingStations,
        workingPercentage:
          totalStations > 0
            ? Math.round((workingStations / totalStations) * 100)
            : 0,
        offlineStations: totalStations - workingStations,
        recentlyUpdated,
        unresolvedErrors: errorCount,
        totalUsers: userCount,
        activeRegisteredUsers,
        openFeedback: feedbackCount,
        stationsWithFavicon,
        faviconPercentage:
          totalStations > 0
            ? Math.round((stationsWithFavicon / totalStations) * 100)
            : 0,
        stationsWithDesc,
        descriptionPercentage:
          totalStations > 0
            ? Math.round((stationsWithDesc / totalStations) * 100)
            : 0,
        activeVisitors,
        todayVisitors,
        weekVisitors,
        topCountries: topCountries
          .slice(0, 5)
          .map((c) => ({ name: c._id, count: c.count })),
        topGenres: topGenres
          .slice(0, 5)
          .map((g) => ({ name: g._id, count: g.count })),
        codecDistribution: codecDistribution
          .slice(0, 10)
          .map((c) => ({ name: c._id, count: c.count })),
        syncStatus: {
          isRunning: lastSyncLog?.status === "running",
          lastSync: lastSyncLog ? new Date(lastSyncTime) : null,
          lastSyncStatus: lastSyncLog?.status || "unknown",
          isHealthy: isRecentSync && lastSyncLog?.status === "completed",
        },
        health,
      };

      await CacheManager.set(CACHE_KEY, stats, { ttl: 300 });
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch dashboard statistics" });
    }
  });
}
