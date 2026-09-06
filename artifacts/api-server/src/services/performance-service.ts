import os from "node:os";
import { getPostgresPool } from "../postgres-runtime";
import { pgCatalog } from "../data/postgres-catalog-store";
import { pgDatabaseSizeReport } from "../data/postgres-admin-catalog-store";
import {
  pgMaintenanceJobs,
  pgStartMaintenanceJob,
  pgSaveMaintenanceJob,
} from "../data/postgres-maintenance-store";

class PerformanceService {
  private lastCpuSample: { usage: NodeJS.CpuUsage; time: number } | null = null;
  private sampleCpu(): number | null {
    const now = Date.now(),
      usage = process.cpuUsage(),
      previous = this.lastCpuSample;
    this.lastCpuSample = { usage, time: now };
    if (!previous || now <= previous.time) return null;
    return Math.max(
      0,
      Math.min(
        100,
        Math.round(
          ((usage.user -
            previous.usage.user +
            usage.system -
            previous.usage.system) /
            1000 /
            (now - previous.time) /
            (os.cpus().length || 1)) *
            1000,
        ) / 10,
      ),
    );
  }
  async getPerformanceMetrics(): Promise<any> {
    const pool = getPostgresPool();
    const [counts, sizes] = await Promise.all([
      pool.query(`SELECT (SELECT count(*)::int FROM stations) stations,(SELECT count(DISTINCT country)::int FROM stations) countries,
        (SELECT count(*)::int FROM genres) genres,(SELECT count(*)::int FROM pg_index WHERE indrelid='stations'::regclass) indexes`),
      pgDatabaseSizeReport(),
    ]);
    const row = counts.rows[0],
      memory = process.memoryUsage();
    const systemHealth = {
      memoryUsage: Math.round((memory.heapUsed / memory.heapTotal) * 100),
      systemMemoryUsage: Math.round(
        ((os.totalmem() - os.freemem()) / os.totalmem()) * 100,
      ),
      heapUsedMB: Math.round(memory.heapUsed / 1048576),
      heapTotalMB: Math.round(memory.heapTotal / 1048576),
      cpuUsage: this.sampleCpu(),
      connectionPool: pool.totalCount,
    };
    const optimizationSuggestions = [];
    if (row.stations > 50000)
      optimizationSuggestions.push({
        type: "cleanup",
        priority: "medium",
        title: "Review Invalid Station Data",
        description:
          "Review records with missing station names, URLs or countries before requesting cleanup.",
        impact: "Depends on invalid records present",
        action: "remove_orphaned_data",
      });
    if (systemHealth.memoryUsage > 80)
      optimizationSuggestions.push({
        type: "cache",
        priority: "high",
        title: "Optimize Memory Usage",
        description:
          "High heap usage detected. Clear unneeded application caches.",
        impact: "Depends on current cache size",
        action: "optimize_memory",
      });
    return {
      databaseStats: {
        totalStations: row.stations,
        totalCountries: row.countries,
        totalGenres: row.genres,
        indexesCount: row.indexes,
        dbSize: Math.round(sizes.totalSizeMB) + " MB",
      },
      systemHealth,
      optimizationSuggestions,
    };
  }
  async runOptimization(type: string, action: string): Promise<any> {
    const supported = [
      "create_missing_indexes",
      "rebuild_indexes",
      "remove_orphaned_data",
      "optimize_memory",
      "clear_cache",
      "warm_cache",
      "analyze_performance",
    ];
    if (!supported.includes(action))
      throw new Error("Unknown optimization action: " + action);
    const { job, token } = await pgStartMaintenanceJob("optimization", {
      type,
      action,
      progress: 0,
      message: "Starting " + type + " optimization...",
    });
    void this.executeOptimization(job, token, action);
    return {
      success: true,
      jobId: job.id,
      message: "Started " + type + " optimization",
    };
  }
  private async executeOptimization(
    job: any,
    token: string,
    action: string,
  ): Promise<void> {
    const beat = setInterval(() => {
      void pgSaveMaintenanceJob(job.id, token, {
        progress: job.progress,
        message: job.message,
      }).catch(() => {});
    }, 10000);
    beat.unref();
    const progress = async (value: number, message: string) => {
      job.progress = value;
      job.message = message;
      if (
        !(await pgSaveMaintenanceJob(job.id, token, {
          progress: value,
          message,
        }))
      )
        throw new Error("Optimization lease expired");
    };
    try {
      await progress(10, "Starting PostgreSQL maintenance");
      let results: any;
      if (action === "create_missing_indexes")
        results = await this.createMissingIndexes(progress);
      else if (action === "rebuild_indexes")
        results = await this.rebuildIndexes(progress);
      else if (action === "remove_orphaned_data") {
        await progress(
          30,
          "Removing stations with missing required display or connection data",
        );
        const removed = await pgCatalog().remove({
          $or: [
            { name: { $in: ["", null] } },
            { url: { $in: ["", null] } },
            { country: { $in: ["", null] } },
          ],
        });
        results = {
          recordsRemoved: removed.deletedCount,
          message: "Invalid station cleanup completed",
        };
      } else if (action === "optimize_memory") {
        if (global.gc) global.gc();
        results = {
          message: global.gc
            ? "Garbage collection completed"
            : "Explicit garbage collection is not exposed; automatic runtime collection remains active",
          garbageCollectionAvailable: Boolean(global.gc),
        };
      } else if (action === "clear_cache") {
        const { performanceCache } = await import("../performance-cache");
        results = {
          message: "Cache cleared successfully",
          cleared: performanceCache.clearSeoCaches(),
        };
      } else if (action === "warm_cache") {
        const stations = await pgCatalog().find(
          { votes: { $gte: 10 } },
          { limit: 100, fields: ["_id", "name", "slug", "country", "votes"] },
        );
        const taxonomies = await getPostgresPool().query(
          "SELECT (SELECT count(*)::int FROM countries) countries,(SELECT count(*)::int FROM genres) genres",
        );
        results = {
          message: "PostgreSQL catalog buffers warmed",
          recordsPreloaded: stations.length,
          ...taxonomies.rows[0],
        };
      } else {
        await progress(70, "Generating PostgreSQL storage report");
        const report = await pgDatabaseSizeReport();
        results = {
          databaseSize: report.totalSizeMB,
          indexSize: report.indexSizeMB,
          collections: report.collections.length,
          message: "Performance analysis completed",
          engine: "postgresql",
        };
      }
      await pgSaveMaintenanceJob(
        job.id,
        token,
        {
          progress: 100,
          message: job.type + " optimization completed successfully",
          results,
        },
        "completed",
      );
    } catch (error) {
      await pgSaveMaintenanceJob(
        job.id,
        token,
        {
          message: "Optimization failed: " + (error as Error).message,
          error: (error as Error).message,
        },
        "failed",
      ).catch(() => {});
    } finally {
      clearInterval(beat);
    }
  }
  private async createMissingIndexes(
    progress: (value: number, message: string) => Promise<void>,
  ): Promise<any> {
    const indexes = [
      ["stations_country_name_maintenance_idx", "country,name"],
      ["stations_votes_maintenance_idx", "votes DESC"],
      ["stations_status_maintenance_idx", "last_check_ok"],
      ["stations_geo_maintenance_idx", "latitude,longitude"],
      ["stations_clicks_maintenance_idx", "click_count DESC"],
      ["stations_quality_maintenance_idx", "codec,bitrate"],
    ];
    const client = await getPostgresPool().connect();
    let created = 0,
      skipped = 0;
    try {
      await client.query("SET statement_timeout='10min'");
      await client.query("SET lock_timeout='5s'");
      for (let i = 0; i < indexes.length; i++) {
        const [name, columns] = indexes[i];
        await progress(20 + i * 10, "Checking index " + name);
        const existing = await client.query(
          "SELECT indisvalid FROM pg_index WHERE indexrelid=to_regclass($1)",
          [name],
        );
        if (existing.rowCount) {
          if (!existing.rows[0].indisvalid)
            throw new Error(
              "Existing index is invalid; use the explicit rebuild action: " +
                name,
            );
          skipped++;
        } else {
          // Fixed allowlist only; no user-provided SQL identifiers or definitions.
          await client.query(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS " +
              name +
              " ON stations(" +
              columns +
              ")",
          );
          created++;
        }
      }
      return {
        indexesCreated: created,
        indexesSkipped: skipped,
        totalIndexes: indexes.length,
        message: "PostgreSQL index verification completed",
      };
    } finally {
      await client
        .query("RESET statement_timeout; RESET lock_timeout")
        .catch(() => {});
      client.release();
    }
  }
  private async rebuildIndexes(
    progress: (value: number, message: string) => Promise<void>,
  ): Promise<any> {
    const client = await getPostgresPool().connect(),
      tables = ["stations", "countries", "genres", "languages"];
    try {
      const schema = String(
        (await client.query("SELECT current_schema() name")).rows[0].name,
      ).replace(/"/g, '""');
      await client.query("SET statement_timeout='10min'");
      await client.query("SET lock_timeout='5s'");
      for (let i = 0; i < tables.length; i++) {
        await progress(
          10 + i * 20,
          "Concurrently rebuilding " + tables[i] + " indexes",
        );
        // Outside transactions, preserving primary/unique constraints and reads.
        await client.query(
          'REINDEX TABLE CONCURRENTLY "' + schema + '"."' + tables[i] + '"',
        );
      }
      return {
        collectionsProcessed: tables.length,
        message:
          "Concurrently rebuilt PostgreSQL indexes; constraints preserved",
      };
    } finally {
      await client
        .query("RESET statement_timeout; RESET lock_timeout")
        .catch(() => {});
      client.release();
    }
  }
  async getOptimizationJob(jobId: string): Promise<any> {
    return (await pgMaintenanceJobs("optimization", jobId))[0] || null;
  }
  getAllOptimizationJobs(): Promise<any[]> {
    return pgMaintenanceJobs("optimization");
  }
}
export const performanceService = new PerformanceService();
