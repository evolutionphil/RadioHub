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
  "Native PostgreSQL application content and miscellaneous routes",
  { skip: !connectionString },
  () => {
    const schema = `content_test_${process.pid}_${randomBytes(6).toString("hex")}`;
    const ssl =
      process.env.PG_TEST_SSL === "require"
        ? { rejectUnauthorized: true }
        : false;
    const admin = new pg.Pool({ connectionString, ssl, max: 1 });
    const oldEnv = {
      DATABASE_URL: process.env.DATABASE_URL,
      POSTGRES_SSL: process.env.POSTGRES_SSL,
    };
    let pool: pg.Pool,
      closePostgres: () => Promise<void>,
      server: Server,
      baseUrl: string,
      schemaCreated = false;
    let store: typeof import("../src/data/postgres-content-store");
    let keys: typeof import("../src/data/postgres-api-access-store");
    const adminHeaders = { "x-test-admin": "yes" };
    before(async () => {
      assert.match(schema, /^content_test_\d+_[a-f0-9]{12}$/);
      await admin.query(`CREATE SCHEMA "${schema}"`);
      schemaCreated = true;
      const url = new URL(connectionString!);
      url.searchParams.set("options", `-c search_path=${schema},public`);
      process.env.DATABASE_URL = url.toString();
      process.env.POSTGRES_SSL = ssl ? "require" : "disable";
      const runtime = await import("../src/postgres-runtime");
      pool = runtime.getPostgresPool();
      closePostgres = runtime.closePostgres;
      const directory = path.resolve(
        import.meta.dirname,
        "../../../lib/db/migrations",
      );
      for (const file of (await readdir(directory))
        .filter((file) => /^\d+.*\.sql$/.test(file))
        .sort()) {
        await pool.query(await readFile(path.join(directory, file), "utf8"));
      }
      store = await import("../src/data/postgres-content-store");
      keys = await import("../src/data/postgres-api-access-store");
      const app = express();
      app.use(express.json());
      (await import("../src/routes/misc-routes")).registerMiscRoutes(
        app,
        {
          requireAdmin: (req: any, res: any, next: any) =>
            req.headers["x-test-admin"] === "yes"
              ? next()
              : res.sendStatus(403),
          requireAuth: (_req: any, res: any) => res.sendStatus(401),
        },
        { apiOnly: true },
      );
      server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve) => server.once("listening", resolve));
      baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
    });
    after(async () => {
      if (server) {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
      if (closePostgres) await closePostgres();
      try {
        if (schemaCreated) {
          assert.match(schema, /^content_test_\d+_[a-f0-9]{12}$/);
          await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
        }
      } finally {
        await admin.end();
        for (const [key, value] of Object.entries(oldEnv)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
    });
    async function request(
      route: string,
      method = "GET",
      body?: unknown,
      headers: Record<string, string> = {},
    ) {
      const response = await fetch(baseUrl + route, {
        method,
        headers: {
          ...headers,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const result = response.headers.get("content-type")?.includes("json")
        ? ((await response.json()) as any)
        : await response.text();
      return {
        status: response.status,
        body: result,
        headers: response.headers,
      };
    }
    it("keeps admin writes protected and public advertisement projections minimal", async () => {
      const input = {
        title: "Ad",
        imageUrl: "/uploads/ad.webp",
        altText: "Alt",
        seoDescription: "Description",
        url: "https://example.invalid",
        position: "mobile_bottom",
      };
      assert.equal(
        (await request("/api/admin/advertisements", "POST", input)).status,
        403,
      );
      const created = await request(
        "/api/admin/advertisements",
        "POST",
        input,
        adminHeaders,
      );
      assert.equal(created.status, 201);
      assert.equal(created.body.isActive, true);
      const id = created.body._id;
      const changed = await request(
        "/api/admin/advertisements/" + id,
        "PATCH",
        { _id: "attacker-id", title: "Updated", createdAt: "2000-01-01" },
        adminHeaders,
      );
      assert.equal(changed.body._id, id);
      assert.equal(changed.body.imageUrl, input.imageUrl);
      assert.notEqual(changed.body.createdAt, "2000-01-01T00:00:00.000Z");
      await store.pgSaveAdvertisement(null, {
        ...input,
        title: "Hidden",
        isActive: false,
      });
      const visible = await request("/api/advertisements");
      assert.equal(visible.body.length, 1);
      assert.equal(visible.body[0].title, "Updated");
      assert.deepEqual(
        Object.keys(visible.body[0]).sort(),
        [
          "_id",
          "title",
          "imageUrl",
          "altText",
          "seoDescription",
          "url",
          "position",
        ].sort(),
      );
      assert.match(visible.headers.get("cache-control")!, /s-maxage=300/);
      await assert.rejects(
        store.pgSaveAdvertisement(null, { ...input, position: "invalid" }),
        (error: any) => error.code === "23514",
      );
      assert.equal(
        (
          await request(
            "/api/admin/advertisements/" + id,
            "DELETE",
            undefined,
            adminHeaders,
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await request(
            "/api/admin/advertisements/" + id,
            "DELETE",
            undefined,
            adminHeaders,
          )
        ).status,
        404,
      );
    });
    it("preserves social sorting and active-only public selection", async () => {
      const first = await store.pgSaveFooterSocialMedia(null, {
        platform: "instagram",
        url: "https://example.invalid/one",
        position: 2,
      });
      const second = await store.pgSaveFooterSocialMedia(null, {
        platform: "youtube",
        url: "https://example.invalid/two",
        position: 1,
      });
      await store.pgSaveFooterSocialMedia(null, {
        platform: "facebook",
        url: "https://example.invalid/hidden",
        position: 0,
        isActive: false,
      });
      assert.deepEqual(
        (await request("/api/footer-social-media")).body.map(
          (row: any) => row._id,
        ),
        [second._id, first._id],
      );
      assert.equal(
        (
          await request(
            "/api/admin/footer-social-media",
            "GET",
            undefined,
            adminHeaders,
          )
        ).body.length,
        3,
      );
      assert.equal(
        (await store.pgSaveFooterSocialMedia(first._id, { position: 3 }))
          .platform,
        "instagram",
      );
      await assert.rejects(
        store.pgSaveFooterSocialMedia(null, {
          platform: "unknown",
          url: "https://example.invalid",
        }),
        (error: any) => error.code === "23514",
      );
    });
    it("enforces one SEO entry per route/language and keeps stats/page-types reachable", async () => {
      const input = {
        pageType: "static",
        routeKey: "/about",
        language: "tr",
        title: "About",
        description: "Description",
        ogTitle: "OG",
        twitterDescription: "Twitter description",
        canonicalUrl: "https://example.invalid/tr/about",
        noIndex: true,
      };
      const created = await request(
        "/api/admin/seo-metadata",
        "POST",
        input,
        adminHeaders,
      );
      assert.equal(created.status, 201);
      assert.equal(created.body.status, "draft");
      await assert.rejects(
        store.pgSaveSeoMetadata(null, input),
        (error: any) => error.code === "23505",
      );
      assert.equal(
        await store.pgSeoMetadata({
          pageType: "static",
          routeKey: "/about",
          language: "tr",
          status: "published",
        }),
        null,
      );
      assert.equal(
        (
          await request(
            "/api/admin/seo-metadata/bulk-status",
            "POST",
            { ids: [created.body._id], status: "published" },
            adminHeaders,
          )
        ).body.modifiedCount,
        1,
      );
      const publicEntry = await store.pgSeoMetadata({
        pageType: "static",
        routeKey: "/about",
        language: "tr",
        status: "published",
      });
      assert.equal(publicEntry.ogTitle, "OG");
      assert.equal(publicEntry.noIndex, true);
      assert.equal(publicEntry.twitterDescription, input.twitterDescription);
      const stats = await request(
        "/api/admin/seo-metadata/stats",
        "GET",
        undefined,
        adminHeaders,
      );
      assert.equal(stats.status, 200);
      assert.deepEqual(stats.body, {
        total: 1,
        byPageType: { static: 1 },
        byStatus: { published: 1 },
      });
      const types = await request(
        "/api/admin/seo-metadata/page-types",
        "GET",
        undefined,
        adminHeaders,
      );
      assert.equal(types.status, 200);
      assert.equal(types.body.pageTypes.length, 9);
      assert.equal(
        (
          await request(
            "/api/admin/seo-metadata?language=tr",
            "GET",
            undefined,
            adminHeaders,
          )
        ).body.pagination.total,
        1,
      );
    });
    it("isolates remote application logs by API-key owner while preserving internal/admin access", async () => {
      const owner = await keys.pgIssueApiKey({
        email: "logs-a@example.invalid",
        name: "A",
        plan: "pro",
      });
      const other = await keys.pgIssueApiKey({
        email: "logs-b@example.invalid",
        name: "B",
        plan: "free",
      });
      const internal = await keys.pgIssueApiKey({
        email: "logs-internal@example.invalid",
        name: "Internal",
        plan: "internal",
      });
      const ownerHeaders = { "x-api-key": owner.apiKey },
        otherHeaders = { "x-api-key": other.apiKey };
      const log = {
        deviceId: "ios.[a]",
        platform: "ios",
        appVersion: "1.2.3",
        logs: [
          {
            level: "info",
            message: "CarPlay CONNECTED",
            timestamp: new Date().toISOString(),
          },
          {
            level: "error",
            message: "APP_CRASH Template created literal .*",
            timestamp: new Date().toISOString(),
            data: { nested: "preserved" },
          },
        ],
      };
      assert.equal(
        (await request("/api/logs/remote", "POST", log)).status,
        401,
      );
      assert.equal(
        (
          await request(
            "/api/logs/remote",
            "POST",
            { ...log, logs: [null] },
            ownerHeaders,
          )
        ).status,
        400,
      );
      assert.equal(
        (await request("/api/logs/remote", "POST", log, ownerHeaders)).status,
        200,
      );
      assert.equal(
        (
          await request(
            "/api/logs/remote",
            "POST",
            {
              ...log,
              deviceId: "android-b",
              platform: "android",
              logs: [
                {
                  level: "warn",
                  message: "private other",
                  timestamp: new Date().toISOString(),
                },
              ],
            },
            otherHeaders,
          )
        ).status,
        200,
      );
      const mine = await request(
        "/api/logs/remote",
        "GET",
        undefined,
        ownerHeaders,
      );
      assert.equal(mine.body.count, 1);
      assert.equal(mine.body.logs[0].deviceId, log.deviceId);
      assert.equal(mine.body.logs[0].logs[1].data.nested, "preserved");
      assert.equal(JSON.stringify(mine.body).includes("apiKeyHash"), false);
      assert.equal(
        JSON.stringify(mine.body).includes(keys.hashApiSecret(owner.apiKey)),
        false,
      );
      assert.equal(
        (
          await request(
            "/api/logs/remote?search=" + encodeURIComponent(".*"),
            "GET",
            undefined,
            ownerHeaders,
          )
        ).body.count,
        1,
      );
      assert.equal(
        (
          await request(
            "/api/logs/remote?deviceId=" + encodeURIComponent(".*"),
            "GET",
            undefined,
            ownerHeaders,
          )
        ).body.count,
        0,
      );
      const stats = (
        await request("/api/logs/remote/stats", "GET", undefined, ownerHeaders)
      ).body.stats;
      assert.equal(stats.total, 1);
      assert.deepEqual(stats.byPlatform, { ios: 1 });
      assert.deepEqual(stats.carplayEvents, {
        connected: 1,
        disconnected: 0,
        templateCreated: 1,
        errors: 1,
      });
      assert.equal(
        (
          await request("/api/logs/remote", "GET", undefined, {
            "x-api-key": internal.apiKey,
          })
        ).body.count,
        2,
      );
      assert.equal(
        (await request("/api/admin/app-logs", "GET", undefined, adminHeaders))
          .body.total,
        2,
      );
      assert.equal(
        (
          await request(
            "/api/admin/app-logs/crashes",
            "GET",
            undefined,
            adminHeaders,
          )
        ).body.count,
        1,
      );
      await pool.query(
        "UPDATE app_logs SET created_at=now()-interval '2 days'",
      );
      assert.equal(
        (
          await request(
            "/api/logs/remote?olderThan=1",
            "DELETE",
            undefined,
            otherHeaders,
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await request(
            "/api/logs/remote?olderThan=1",
            "DELETE",
            undefined,
            ownerHeaders,
          )
        ).body.deletedCount,
        1,
      );
      assert.equal(
        (await request("/api/logs/remote", "GET", undefined, otherHeaders)).body
          .count,
        1,
      );
      await pool.query(
        "UPDATE app_logs SET created_at=now()-interval '31 days'",
      );
      assert.equal(
        (await request("/api/logs/remote", "GET", undefined, otherHeaders)).body
          .count,
        0,
      );
      assert.equal(
        (await store.pgDeleteOldAppLogs(new Date(Date.now() - 30 * 86400000)))
          .deletedCount,
        1,
      );
      await pool.query(
        "UPDATE api_keys SET expires_at=now()-interval '1 day' WHERE id=$1",
        [owner.key._id],
      );
      assert.equal(
        (await request("/api/logs/remote", "GET", undefined, ownerHeaders))
          .status,
        401,
      );
    });
    it("triages feedback with stable queue statistics and no unintended ownership edits", async () => {
      const feedback = await store.pgSaveFeedback(null, {
        type: "bug",
        subject: "Playback",
        message: "Cannot play",
        userId: "owner",
        email: "owner@example.invalid",
      });
      await store.pgSaveFeedback(null, {
        type: "feature",
        subject: "Feature",
        message: "Suggestion",
        status: "resolved",
      });
      let result = await request(
        "/api/admin/feedback?status=open",
        "GET",
        undefined,
        adminHeaders,
      );
      assert.equal(result.body.feedback.length, 1);
      assert.equal(result.body.stats.total, 2);
      assert.equal(result.body.stats.open, 1);
      assert.equal(
        (
          await request(
            "/api/admin/feedback/" + feedback._id,
            "PATCH",
            { status: "bad" },
            adminHeaders,
          )
        ).status,
        400,
      );
      result = await request(
        "/api/admin/feedback/" + feedback._id,
        "PATCH",
        { status: "in-progress", response: " Working ", userId: "attacker" },
        adminHeaders,
      );
      assert.equal(result.body.status, "in-progress");
      assert.equal(result.body.response, "Working");
      assert.equal(result.body.userId, "owner");
      assert.ok(result.body.updatedAt);
      assert.equal((await store.pgContentCounts()).feedback, 2);
      assert.equal(
        (
          await request(
            "/api/admin/feedback/" + feedback._id,
            "DELETE",
            undefined,
            adminHeaders,
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await request(
            "/api/admin/feedback/" + feedback._id,
            "DELETE",
            undefined,
            adminHeaders,
          )
        ).status,
        404,
      );
    });
    it("returns only minimal populated listening users and streams bounded PostgreSQL CSV pages", async () => {
      await pool.query(`INSERT INTO users(id,username,email,full_name,password_hash,source) VALUES
      ('listener','listener','listener@example.invalid','=Formula','must-not-leak','{"password":"also-private"}')`);
      await pool.query(
        `INSERT INTO stations(id,name,slug,url,station_uuid) VALUES ('station','Radio','radio','https://example.invalid/live','uuid')`,
      );
      await pool.query(`INSERT INTO listening_history(id,user_id,session_id,station_id,station_name,interaction_type,listened_at)
      VALUES ('history','listener','session','station','Radio','play',now())`);
      const history = await request(
        "/api/admin/listening-history",
        "GET",
        undefined,
        adminHeaders,
      );
      assert.equal(history.body.length, 1);
      assert.deepEqual(history.body[0].userId, {
        _id: "listener",
        email: "listener@example.invalid",
        fullName: "=Formula",
      });
      assert.deepEqual(history.body[0].stationId, {
        _id: "station",
        name: "Radio",
        slug: "radio",
      });
      assert.equal(JSON.stringify(history.body).includes("private"), false);
      const csv = await request(
        "/api/admin/users/export.csv",
        "GET",
        undefined,
        adminHeaders,
      );
      assert.equal(csv.status, 200);
      assert.match(csv.body, /listener@example\.invalid/);
      assert.ok(csv.body.includes("'=Formula"));
      assert.equal(csv.body.includes("must-not-leak"), false);
    });
  },
);
