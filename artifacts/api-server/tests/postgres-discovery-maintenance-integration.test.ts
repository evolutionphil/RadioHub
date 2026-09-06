import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import type { Server } from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import express from "express";
import pg from "pg";
const connectionString = process.env.PG_TEST_DATABASE_URL;
describe(
  "PostgreSQL discovery, dashboard and durable admin maintenance",
  { skip: !connectionString },
  () => {
    const schema = `discovery_test_${process.pid}_${randomBytes(6).toString("hex")}`;
    const ssl =
      process.env.PG_TEST_SSL === "require"
        ? { rejectUnauthorized: true }
        : false;
    const admin = new pg.Pool({ connectionString, ssl, max: 1 });
    let pool: pg.Pool,
      close: () => Promise<void>,
      server: Server,
      base: string,
      created = false;
    let jobs: typeof import("../src/data/postgres-maintenance-store");
    let slugs: typeof import("../src/data/postgres-slug-store");
    let discovery: typeof import("../src/data/postgres-discovery-operations");
    let cache: typeof import("../src/cache").default;
    const headers = { "x-test-admin": "yes" };
    before(async () => {
      assert.match(schema, /^discovery_test_\d+_[a-f0-9]{12}$/);
      await admin.query(`CREATE SCHEMA "${schema}"`);
      created = true;
      const url = new URL(connectionString!);
      url.searchParams.set("options", `-c search_path=${schema},public`);
      process.env.DATABASE_URL = url.toString();
      process.env.POSTGRES_SSL = ssl ? "require" : "disable";
      const runtime = await import("../src/postgres-runtime");
      pool = runtime.getPostgresPool();
      close = runtime.closePostgres;
      const directory = path.resolve(
        import.meta.dirname,
        "../../../lib/db/migrations",
      );
      for (const file of (await readdir(directory))
        .filter((file) => /^\d+.*\.sql$/.test(file))
        .sort())
        await pool.query(await readFile(path.join(directory, file), "utf8"));
      jobs = await import("../src/data/postgres-maintenance-store");
      slugs = await import("../src/data/postgres-slug-store");
      discovery = await import("../src/data/postgres-discovery-operations");
      cache = (await import("../src/cache")).default;
      const app = express();
      app.use(express.json());
      const deps = {
        requireAdmin: (req: any, res: any, next: any) =>
          req.headers["x-test-admin"] === "yes" ? next() : res.sendStatus(403),
      };
      (
        await import("../src/routes/regions-recommendations-routes")
      ).registerRegionsRecommendationsRoutes(app, deps);
      (await import("../src/routes/slug-routes")).registerSlugRoutes(app, deps);
      (
        await import("../src/routes/cache-dashboard-routes")
      ).registerCacheDashboardRoutes(app, deps);
      server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve) => server.once("listening", resolve));
      base = `http://127.0.0.1:${(server.address() as any).port}`;
    });
    after(async () => {
      if (server) {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
      if (close) await close();
      try {
        if (created) {
          assert.match(schema, /^discovery_test_\d+_[a-f0-9]{12}$/);
          await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
        }
      } finally {
        await admin.end();
      }
    });
    async function request(
      route: string,
      method = "GET",
      body?: unknown,
      auth = true,
    ) {
      const response = await fetch(base + route, {
        method,
        headers: {
          ...(auth ? headers : {}),
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return {
        status: response.status,
        body: response.headers.get("content-type")?.includes("json")
          ? ((await response.json()) as any)
          : await response.text(),
      };
    }
    async function waitJob(
      kind: "slug" | "optimization" | "health_check",
      id: string,
    ) {
      for (let attempt = 0; attempt < 500; attempt++) {
        const job = (await jobs.pgMaintenanceJobs(kind, id))[0];
        if (job?.status !== "running") return job;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.fail("Job did not finish");
    }
    it("persists empty-catalog health checks without making any outbound requests", async () => {
      assert.equal(
        (await request("/api/admin/start-health-check", "POST", {}, false))
          .status,
        403,
      );
      const result = await request("/api/admin/start-health-check", "POST", {});
      assert.equal(result.status, 200);
      assert.equal(result.body.totalStations, 0);
      const job = await waitJob("health_check", result.body.jobId);
      assert.equal(job.status, "completed");
      const progress = await request("/api/admin/health-check-progress");
      assert.equal(progress.body.progress.running, false);
      assert.equal(progress.body.results.summary.total, 0);
      assert.equal(JSON.stringify(progress.body).includes("ownerToken"), false);
    });
    it("counts real region/city membership without hardcoded totals or overlap subtraction", async () => {
      await pool.query(`INSERT INTO stations(id,station_uuid,name,slug,url,country,state,tags_raw,votes,codec,language,last_check_ok,favicon,source) VALUES
      ('a','uuid-a','Berlin Vibes','old-a','https://example.invalid/a','Germany','Berlin','rock',100,'MP3','German',true,'https://example.invalid/logo','{"internalOnly":"private"}'),
      ('b','uuid-b','Berlin and Munich',NULL,'https://example.invalid/b','Germany','Munich','pop,rock',80,'AAC','German',true,NULL,'{}'),
      ('c','uuid-c','Rural Radio',NULL,'https://example.invalid/c','Germany','Rural','rock',50,'MP3','German',false,NULL,'{}')`);
      await pool.query(
        `INSERT INTO genres(id,name,slug,station_count) VALUES ('rock','rock','rock',10),('pop','pop','pop',6)`,
      );
      const counts = await discovery.pgCityCounts(
        ["Germany"],
        [
          { name: "Berlin", terms: ["Berlin"] },
          { name: "Munich", terms: ["Munich"] },
        ],
      );
      assert.equal(counts.total, 3);
      assert.equal(counts.unassigned, 1);
      assert.deepEqual(
        counts.cities.sort((a, b) => a.name.localeCompare(b.name)),
        [
          { name: "Berlin", stationCount: 2 },
          { name: "Munich", stationCount: 1 },
        ],
      );
      const region = await request("/api/regions/europe");
      assert.equal(
        region.body.data.countries.find((row: any) => row.name === "Germany")
          .stationCount,
        3,
      );
      const cities = await request("/api/regions/europe/germany");
      assert.equal(
        cities.body.data.cities.find((row: any) => row.slug === "all")
          .stationCount,
        1,
      );
      const rural = await request("/api/regions/europe/germany/all/stations");
      assert.equal(rural.body.data.total, 1);
      assert.equal(rural.body.data.stations[0]._id, "c");
      const all = await request(
        "/api/regions/europe/germany/stations?limit=-2&offset=-10&sortBy=__proto__",
      );
      assert.equal(all.body.data.limit, 1);
      assert.equal(all.body.data.offset, 0);
      assert.equal(all.body.data.total, 3);
      const global = await request("/api/cities/global");
      assert.equal(
        global.body.data.cities.find((row: any) => row.name === "Berlin")
          .stationCount,
        1,
      );
    });
    it("samples diverse results and refreshes favorite/popular caches using native joins and projections", async () => {
      const diverse = await discovery.pgDiverseStations("Germany", 10);
      assert.equal(new Set(diverse.map((row) => row._id)).size, diverse.length);
      assert.ok(diverse.length > 0);
      assert.ok(diverse.every((row) => row.country === "Germany"));
      assert.equal(JSON.stringify(diverse).includes("internalOnly"), false);
      assert.deepEqual(await discovery.pgDiverseStations("Germany.*", 10), []);
      await pool.query(`INSERT INTO users(id,username,email,full_name,source) VALUES
      ('user-a','user-a','a@example.invalid','A',jsonb_build_object('lastActiveDate',now())),
      ('user-b','user-b','b@example.invalid','B','{}');
      INSERT INTO user_favorites(user_id,station_id) VALUES ('user-a','a'),('user-b','a'),('user-a','b')`);
      const refresh = await import("../src/routes/cache-refresh-utils");
      await refresh.refreshCommunityFavoritesCache("Germany");
      const favorites = await cache.get<any[]>(
        "community_favorites:Germany:all:20",
      );
      assert.equal(favorites![0]._id, "a");
      assert.equal(favorites![0].favoriteCount, 2);
      assert.equal(JSON.stringify(favorites).includes("internalOnly"), false);
      await refresh.refreshPopularStationsCache("Germany");
      const popular = await cache.get<any[]>("popular_stations:Germany:all:20");
      assert.equal(popular!.length, 3);
      assert.equal(JSON.stringify(popular).includes("internalOnly"), false);
    });
    it("reports actual PostgreSQL health, traffic, content and synchronization status", async () => {
      await pool.query(`INSERT INTO visitor_sessions(id,ip_address,last_active_date) VALUES ('visitor','127.0.0.1',now());
      INSERT INTO feedback(id,type,subject,message) VALUES ('feedback','bug','Subject','Message');
      INSERT INTO catalog_sync_runs(id,sync_type,status,completed_at) VALUES ('sync','incremental','completed',now())`);
      const response = await request("/api/dashboard/stats");
      assert.equal(response.status, 200);
      assert.equal(response.body.totalStations, 3);
      assert.equal(response.body.workingStations, 2);
      assert.equal(response.body.totalCountries, 1);
      assert.equal(response.body.totalUsers, 2);
      assert.equal(response.body.openFeedback, 1);
      assert.equal(response.body.activeVisitors, 1);
      assert.equal(response.body.activeRegisteredUsers, 1);
      assert.equal(response.body.health.database, "online");
      assert.equal(response.body.syncStatus.isHealthy, true);
      assert.equal(response.body.health.radioBrowser, "online");
      const { performanceService } =
        await import("../src/services/performance-service");
      const metrics = await performanceService.getPerformanceMetrics();
      assert.equal(metrics.databaseStats.totalStations, 3);
      assert.ok(metrics.databaseStats.indexesCount > 0);
      assert.ok(metrics.systemHealth.connectionPool > 0);
    });
    it("generates every missing slug across keyset batches and keeps previous station URLs as aliases", async () => {
      await pool.query(`INSERT INTO stations(id,station_uuid,name,url,country)
      SELECT 'bulk-'||lpad(n::text,4,'0'),'bulk-uuid-'||n,'Bulk Radio '||n,'https://example.invalid/'||n,'Germany' FROM generate_series(1,225) n`);
      const started = await slugs.pgStartSlugGeneration(false);
      await slugs.runPgSlugGeneration(started.job.id, started.token, false);
      const done = await jobs.pgMaintenanceJobs("slug", started.job.id);
      assert.equal(done[0].status, "completed");
      assert.equal(done[0].progress.current, 229);
      assert.equal(done[0].progress.total, 229);
      const stats = await slugs.pgSlugStatistics();
      assert.equal(stats.stationsWithoutSlugs, 0);
      assert.equal(stats.totalStations, 228);
      const all = await slugs.pgStartSlugGeneration(true, true);
      await slugs.runPgSlugGeneration(all.job.id, all.token, true, true);
      const station = (
        await pool.query("SELECT slug,slug_aliases FROM stations WHERE id='a'")
      ).rows[0];
      assert.equal(station.slug, "berlin-vibes");
      assert.ok(station.slug_aliases.includes("old-a"));
      const duplicate = (
        await pool.query(
          "SELECT slug FROM stations GROUP BY slug HAVING count(*)>1",
        )
      ).rows;
      assert.deepEqual(duplicate, []);
    });
    it("allows one worker per domain, fences stopped/expired workers and never exposes lease tokens", async () => {
      const starts = await Promise.allSettled(
        Array.from({ length: 12 }, () => slugs.pgStartSlugGeneration()),
      );
      const successes = starts.filter(
        (row): row is PromiseFulfilledResult<any> => row.status === "fulfilled",
      );
      assert.equal(successes.length, 1);
      const running = successes[0].value;
      await jobs.pgStopMaintenanceJobs("slug");
      assert.equal(
        await jobs.pgSaveMaintenanceJob(running.job.id, running.token, {
          message: "stale update",
        }),
        false,
      );
      await slugs.runPgSlugGeneration(running.job.id, running.token, true);
      assert.equal(
        (await jobs.pgMaintenanceJobs("slug", running.job.id))[0].status,
        "stopped",
      );
      const expired = await slugs.pgStartSlugGeneration();
      await pool.query(
        "UPDATE admin_maintenance_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",
        [expired.job.id],
      );
      assert.equal(
        (await jobs.pgMaintenanceJobs("slug", expired.job.id))[0].status,
        "failed",
      );
      const serialized = JSON.stringify(
        (await request("/api/admin/station-slugs/job-status")).body,
      );
      assert.equal(serialized.includes(expired.token), false);
      assert.equal(serialized.includes("owner_token"), false);
      const clear = await slugs.pgClearAllSlugs();
      assert.equal(clear.stations, 228);
      assert.equal(clear.users, 2);
      assert.equal(clear.genres, 2);
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int count FROM genres WHERE slug IS NULL OR slug=''",
          )
        ).rows[0].count,
        0,
      );
      assert.ok(
        (
          await pool.query("SELECT slug_aliases FROM stations WHERE id='a'")
        ).rows[0].slug_aliases.includes("berlin-vibes"),
      );
    });
    it("executes explicit PostgreSQL index maintenance without dropping primary or unique constraints", async () => {
      const { performanceService } =
        await import("../src/services/performance-service");
      const before = (
        await pool.query(
          "SELECT count(*)::int count FROM pg_constraint WHERE conrelid='stations'::regclass AND contype IN('p','u')",
        )
      ).rows[0].count;
      const indexJob = await performanceService.runOptimization(
        "index",
        "create_missing_indexes",
      );
      const createdJob = await waitJob("optimization", indexJob.jobId);
      assert.equal(createdJob.status, "completed", createdJob.error);
      assert.equal(createdJob.results.totalIndexes, 6);
      const rebuild = await performanceService.runOptimization(
        "index",
        "rebuild_indexes",
      );
      const rebuilt = await waitJob("optimization", rebuild.jobId);
      assert.equal(rebuilt.status, "completed", rebuilt.error);
      assert.equal(rebuilt.results.collectionsProcessed, 4);
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int count FROM pg_constraint WHERE conrelid='stations'::regclass AND contype IN('p','u')",
          )
        ).rows[0].count,
        before,
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int count FROM pg_index WHERE indrelid='stations'::regclass AND NOT indisvalid",
          )
        ).rows[0].count,
        0,
      );
      assert.equal(
        (await performanceService.getOptimizationJob(rebuild.jobId)).status,
        "completed",
      );
    });
  },
);
