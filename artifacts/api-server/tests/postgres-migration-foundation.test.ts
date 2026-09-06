import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  bool,
  checksum,
  date,
  genreSlug,
  id,
  jsonSafe,
  number,
  placeholders,
  requiredUrl,
  tags,
  validateMigrationSourcePreflight,
} from "@workspace/legacy-migration/migrate-mongo-to-postgres";
import { databaseMaintenanceMiddleware } from "../src/middleware/database-maintenance.ts";
import { PostgresSessionStore } from "../src/data/postgres-session-store.ts";
import { validatePostgresStoreConfiguration } from "../src/data/postgres-store-config.ts";
import { validateMigrationWriteSafety } from "../src/data/postgres-migration-safety.ts";

describe("PostgreSQL migration value conversion", () => {
  it("preserves public Mongo IDs", () => {
    assert.equal(id("507f1f77bcf86cd799439011"), "507f1f77bcf86cd799439011");
    assert.equal(id(null), "");
  });

  it("normalizes comma-delimited station genres", () => {
    assert.deepEqual(tags("Jazz, Türkçe Pop, News"), ["Jazz", " Türkçe Pop", " News"]);
    assert.equal(genreSlug(" Türkçe Pop "), "turkce-pop");
    assert.equal(genreSlug("R&B / Soul"), "r-b-soul");
  });

  it("uses safe scalar fallbacks", () => {
    assert.equal(bool(undefined, true), true);
    assert.equal(bool(false, true), false);
    assert.equal(number("42"), 42);
    assert.equal(number("bad", 7), 7);
    assert.throws(() => number("9007199254740993"), /exact numeric range/);
    assert.equal(date("2026-09-03T12:00:00Z")?.toISOString(), "2026-09-03T12:00:00.000Z");
    assert.equal(date("not-a-date"), null);
  });

  it("creates deterministic checksums and SQL placeholders", () => {
    const original = { _id: "1", nested: { ok: true } };
    const safe = jsonSafe(original);
    assert.deepEqual(safe, original);
    assert.equal(checksum(safe), checksum(jsonSafe(original)));
    assert.equal(placeholders(2, 3), "($1,$2,$3),($4,$5,$6)");
  });

  it("rejects a Mongo URL in DATABASE_URL", () => {
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "mongodb://wrong-database";
    assert.throws(
      () => requiredUrl("DATABASE_URL", /^postgres(?:ql)?:\/\//i),
      /wrong protocol/,
    );
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  });
});

describe("database migration maintenance middleware", () => {
  it("allows reads and rejects writes with a retryable 503", () => {
    const previous = process.env.DATABASE_MAINTENANCE_READ_ONLY;
    process.env.DATABASE_MAINTENANCE_READ_ONLY = "true";
    let nextCalls = 0;
    const next = () => { nextCalls += 1; };
    databaseMaintenanceMiddleware(
      { method: "GET", path: "/api/stations" } as any,
      {} as any,
      next,
    );
    assert.equal(nextCalls, 1);

    const headers: Record<string, string> = {};
    let status = 0;
    let body: any;
    const response = {
      setHeader: (name: string, value: string) => { headers[name] = value; },
      status: (value: number) => { status = value; return response; },
      json: (value: unknown) => { body = value; },
    };
    databaseMaintenanceMiddleware(
      { method: "POST", path: "/api/user/favorite" } as any,
      response as any,
      next,
    );
    assert.equal(status, 503);
    assert.equal(headers["Retry-After"], "300");
    assert.equal(body.error, "database_maintenance");
    if (previous === undefined) delete process.env.DATABASE_MAINTENANCE_READ_ONLY;
    else process.env.DATABASE_MAINTENANCE_READ_ONLY = previous;
  });
});

describe("PostgreSQL session store", () => {
  it("persists, reads, touches and deletes sessions with parameterized SQL", async () => {
    const calls: Array<{ sql: string; values?: unknown[] }> = [];
    const fakePool = {
      query: async (sql: string, values?: unknown[]) => {
        calls.push({ sql, values });
        if (sql.startsWith("SELECT sess")) return { rows: [{ sess: { cookie: {}, user: { userId: "u1" } } }] };
        return { rows: [], rowCount: 1 };
      },
    };
    const store = new PostgresSessionStore(fakePool as any, 60_000);
    await new Promise<void>((resolve, reject) =>
      store.set("sid-1", { cookie: {} } as any, (error) => error ? reject(error) : resolve()),
    );
    const restored = await new Promise<any>((resolve, reject) =>
      store.get("sid-1", (error, value) => error ? reject(error) : resolve(value)),
    );
    await new Promise<void>((resolve, reject) =>
      store.touch("sid-1", { cookie: {} } as any, (error) => error ? reject(error) : resolve()),
    );
    await new Promise<void>((resolve, reject) =>
      store.destroy("sid-1", (error) => error ? reject(error) : resolve()),
    );
    assert.equal(restored.user.userId, "u1");
    assert.match(calls[0].sql, /INSERT INTO user_sessions/);
    assert.deepEqual(calls[0].values?.slice(0, 2), ["sid-1", JSON.stringify({ cookie: {} })]);
    assert.ok(calls.every((call) => !call.sql.includes("sid-1")));
  });
});

describe("PostgreSQL production migration contract", () => {
  it("rejects unsafe store cutover ordering", () => {
    assert.doesNotThrow(() => validatePostgresStoreConfiguration({}));
    for (const name of ["USER_STORE","AUTH_STORE","ENGAGEMENT_STORE","NOTIFICATION_STORE","MESSAGE_STORE","BILLING_STORE","LOCALIZATION_STORE","SESSION_STORE","STATION_WRITE_MODE","STATION_READ_MODE"]) {
      assert.throws(() => validatePostgresStoreConfiguration({ [name]:"mongo" }),/PostgreSQL-only/);
      assert.throws(() => validatePostgresStoreConfiguration({ [name]:"dual" }),/PostgreSQL-only/);
      assert.doesNotThrow(() => validatePostgresStoreConfiguration({ [name]:"postgres" }));
    }
    assert.throws(() => validatePostgresStoreConfiguration({ STATION_CDC_ENABLED:"true" }),/forbidden/);
    assert.throws(() => validatePostgresStoreConfiguration({ DATABASE_MIGRATION_MODE:"shadow" }),/no longer/);
  });

  it("refuses writes against an active or PostgreSQL-owned migration target", () => {
    assert.throws(() => validateMigrationWriteSafety("all", {}), /WRITERS_STOPPED/);
    assert.throws(() => validateMigrationWriteSafety("normalize", {
      MIGRATION_TARGET_WRITERS_STOPPED: "true", USER_STORE: "postgres",
    }), /forbidden after PostgreSQL write cutover/);
    assert.doesNotThrow(() => validateMigrationWriteSafety("mirror", { MIGRATION_TARGET_WRITERS_STOPPED: "true" }));
    assert.doesNotThrow(() => validateMigrationWriteSafety("verify", { USER_STORE: "postgres" }));
  });
  it("rejects empty or wrong source databases before destructive reconciliation", () => {
    assert.throws(() => validateMigrationSourcePreflight("empty", {}, { MIGRATION_PRUNE: "true" }), /empty MongoDB source before writing/);
    assert.throws(() => validateMigrationSourcePreflight("wrong", { users: 3 }, {
      MIGRATION_PRUNE: "true", MIGRATION_EXPECT_SOURCE_DATABASE: "expected",
    }), /exactly match/);
    assert.doesNotThrow(() => validateMigrationSourcePreflight("expected", { users: 3 }, {
      MIGRATION_PRUNE: "true", MIGRATION_EXPECT_SOURCE_DATABASE: "expected",
    }));
  });

  it("keeps migrations ordered and includes durable station CDC state", () => {
    const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
    const migrationDirectory = path.join(repositoryRoot, "lib/db/migrations");
    const files = fs.readdirSync(migrationDirectory)
      .filter((file) => /^\d+.*\.sql$/.test(file))
      .sort();
    const journal = JSON.parse(fs.readFileSync(path.join(migrationDirectory,"meta/_journal.json"),"utf8"));
    assert.deepEqual(files,journal.entries.map((entry: any)=>entry.tag+".sql"));
    assert.ok(files.length >= 13);
    assert.deepEqual(journal.entries.map((entry: any)=>entry.idx),journal.entries.map((_: any,index: number)=>index));
    const cdcSql = fs.readFileSync(path.join(migrationDirectory, files[3]), "utf8");
    assert.match(cdcSql, /mongo_change_stream_checkpoints/);
    assert.match(cdcSql, /resume_token jsonb/);
    assert.match(cdcSql, /events_processed bigint/);
    const paymentOriginSql = fs.readFileSync(path.join(migrationDirectory, files[4]), "utf8");
    assert.match(paymentOriginSql, /origin text NOT NULL DEFAULT 'runtime'/);
    const cdcSource = fs.readFileSync(
      path.join(repositoryRoot, "lib/legacy-migration/src/station-change-stream-cdc.ts"),
      "utf8",
    );
    assert.match(cdcSource, /Station\.db\.watch/);
    assert.match(cdcSource, /upsertPostgresGenre/);
    assert.match(cdcSource, /catalog-v1/);
  });

  it("uses PostgreSQL's atomic delivery receipt for Apple webhook completion", () => {
    const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
    const source = fs.readFileSync(
      path.join(repositoryRoot, "artifacts/api-server/src/routes/iap-apple-webhook.ts"),
      "utf8",
    );
    assert.match(source, /await pgApplySubscriptionEvent\(/);
    assert.match(source, /provider: "apple", providerEventId: notificationUUID/);
    assert.doesNotMatch(source, /AppleWebhookEvent|mongo-schemas|mongoose/);
    const store = fs.readFileSync(path.join(repositoryRoot, "artifacts/api-server/src/data/postgres-billing-store.ts"), "utf8");
    assert.match(store, /withLockedSubscription\(userId, async \(client, current\) =>/);
    assert.match(store, /insertBillingEvent\(client, \{ \.\.\.event, userId \}\)/);
    assert.match(store, /if \(recorded === "duplicate"\) return "duplicate"/);
    // Functional rollback/retry/race guarantees are exercised against a real
    // PostgreSQL server by postgres-billing.integration.test.ts.
  });
});
