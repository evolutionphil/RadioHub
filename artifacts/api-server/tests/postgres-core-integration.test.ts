import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { assertNoPostgresWriteAuthority, recordPostgresWriteAuthority } from "../src/data/postgres-migration-safety";

const connectionString = process.env.PG_TEST_DATABASE_URL;
describe("PostgreSQL user, engagement and migration safety integration", { skip: !connectionString }, () => {
  const schema = `core_test_${process.pid}_${randomBytes(6).toString("hex")}`;
  const ssl = process.env.PG_TEST_SSL === "require" ? { rejectUnauthorized: true } : false;
  const admin = new pg.Pool({ connectionString, ssl, max: 1 });
  let pool: pg.Pool;
  let closePostgres: () => Promise<void>;
  let users: typeof import("../src/data/postgres-user-store");
  let engagement: typeof import("../src/data/postgres-engagement-store");
  let schemaCreated = false;
  before(async () => {
    assert.match(schema, /^core_test_\d+_[a-f0-9]{12}$/);
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    const url = new URL(connectionString!);
    url.searchParams.set("options", `-c search_path=${schema},public`);
    process.env.DATABASE_URL = url.toString();
    process.env.POSTGRES_SSL = ssl ? "require" : "disable";
    const runtime = await import("../src/postgres-runtime");
    pool = runtime.getPostgresPool();
    closePostgres = runtime.closePostgres;
    const migrations = path.resolve(import.meta.dirname, "../../../lib/db/migrations");
    for (const file of (await readdir(migrations)).filter((file) => /^\d+.*\.sql$/.test(file)).sort()) {
      await pool.query(await readFile(path.join(migrations, file), "utf8"));
    }
    users = await import("../src/data/postgres-user-store");
    engagement = await import("../src/data/postgres-engagement-store");
  });
  after(async () => {
    if (closePostgres) await closePostgres();
    try {
      if (schemaCreated) {
        assert.match(schema, /^core_test_\d+_[a-f0-9]{12}$/);
        await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      }
    } finally { await admin.end(); }
  });

  it("retains independent simultaneous profile and preference patches", async () => {
    const created = await users.pgCreateUser({ id: "concurrent-user", username: "concurrent", email: "concurrent@example.invalid", fullName: "Original",
      bio: "Bio", location: "Berlin", permissions: { create: true }, authProvider: "email" });
    assert.equal(created.bio, "Bio");
    assert.equal(created.location, "Berlin");
    assert.equal(created.permissions.create, true);
    assert.equal(created.authProvider, "email");
    await Promise.all(Array.from({ length: 24 }, (_, index) => users.pgUpdateUser("concurrent-user", {
      [`extra${index}`]: index, preferences: { [`setting${index}`]: index },
    })));
    const found = await users.pgFindUserById("concurrent-user");
    for (let index = 0; index < 24; index++) {
      assert.equal(found[`extra${index}`], index);
      assert.equal(found.preferences[`setting${index}`], index);
    }
    assert.equal((await users.pgUpdateUser("concurrent-user", { fullName: "", email: undefined }))?.fullName, "");
    assert.equal(await users.pgUpdateUser("missing-user", { fullName: "Missing" }), null);
  });

  it("rolls back failed profile updates and keeps normalized subscription data", async () => {
    await pool.query("INSERT INTO subscriptions(user_id,plan,is_active) VALUES ('concurrent-user','premium_monthly',true)");
    await assert.rejects(users.pgUpdateUser("concurrent-user", { email: null, fullName: "Not saved" }));
    assert.equal((await users.pgFindUserById("concurrent-user"))?.fullName, "");
    const updated = await users.pgUpdateUser("concurrent-user", { fullName: "Saved" });
    assert.equal(updated.subscription.plan, "premium_monthly");
  });

  it("keeps aggregate ratings correct across different concurrent identities", async () => {
    await pool.query("INSERT INTO stations(id,station_uuid,name,url) VALUES ('concurrent-station','concurrent-uuid','Station','https://example.invalid')");
    await Promise.all(Array.from({ length: 30 }, (_, index) => engagement.pgRateStationIdentity(
      { sessionId: `session-${index}` }, "concurrent-station", index % 5 + 1, "",
    )));
    const first = (await pool.query("SELECT average_rating,total_ratings,votes FROM stations WHERE id='concurrent-station'")).rows[0];
    assert.equal(Number(first.average_rating), 3);
    assert.equal(first.total_ratings, 30);
    assert.equal(Number(first.votes), 30);
    await Promise.all(Array.from({ length: 30 }, (_, index) => engagement.pgRateStationIdentity(
      { sessionId: `session-${index}` }, "concurrent-station", 5, "updated",
    )));
    const second = (await pool.query("SELECT average_rating,total_ratings,votes FROM stations WHERE id='concurrent-station'")).rows[0];
    assert.equal(Number(second.average_rating), 5);
    assert.equal(second.total_ratings, 30);
    assert.equal(Number(second.votes), 30);
    await assert.rejects(engagement.pgRateStationIdentity({ sessionId: "x" }, "missing-station", 5, ""), /Station not found/);
  });

  it("does not let legacy station JSON overwrite canonical PostgreSQL values", async () => {
    await pool.query("UPDATE stations SET source=$1 WHERE id='concurrent-station'", [{ name: "Stale", votes: 0, averageRating: 0, totalRatings: 0, homepage: "https://example.invalid/home" }]);
    await engagement.pgSetFavorite("concurrent-user", "concurrent-station", true);
    const result = await engagement.pgFavoriteStationsForUser("concurrent-user", "newest", 1, 20);
    assert.equal(result.stations[0].name, "Station");
    assert.equal(Number(result.stations[0].votes), 30);
    assert.equal(result.stations[0].totalRatings, 30);
    assert.equal(result.stations[0].homepage, "https://example.invalid/home");
  });

  it("persists cutover authority, blocks snapshot replay and rejects implicit rollback", async () => {
    const client = await pool.connect();
    try { await assertNoPostgresWriteAuthority(client); } finally { client.release(); }
    await recordPostgresWriteAuthority(pool, { USER_STORE: "postgres" });
    await recordPostgresWriteAuthority(pool, { USER_STORE: "postgres" });
    const check = await pool.connect();
    try { await assert.rejects(assertNoPostgresWriteAuthority(check), /durable PostgreSQL write authority/); }
    finally { check.release(); }
    await assert.rejects(recordPostgresWriteAuthority(pool, { USER_STORE: "mongo" }), /PostgreSQL-only/);
    assert.deepEqual((await pool.query("SELECT domain FROM database_write_authority ORDER BY domain")).rows.map(row => row.domain),
      ["ADMIN_SETTINGS", "API_ACCESS", "AUTH_STORE", "BILLING_STORE", "CATALOG_SYNC", "ENGAGEMENT_STORE", "LOCALIZATION_STORE", "MESSAGE_STORE", "NOTIFICATION_STORE", "SESSION_STORE", "STATION_WRITE_MODE", "TV_CAST", "USER_STORE"]);
    const runtime = await import("../src/postgres-runtime");
    await runtime.initializePostgres();
  });

  it("issues, resolves and revokes tokens only against native PostgreSQL users", async () => {
    const auth = await import("../src/data/auth-token-store");
    await assert.rejects(auth.createAuthToken("absent"), /user absent is missing/);
    const token = await auth.createAuthToken("concurrent-user", "tv", "Screen 100%_tv");
    const untouched = await auth.findActiveAuthToken(token, false);
    assert.equal(untouched?.userId, "concurrent-user");
    assert.equal(untouched?.deviceType, "tv");
    // Suffix wildcards must be literal, not SQL LIKE patterns.
    assert.equal(await auth.revokeUserAuthTokens("concurrent-user", { deviceNameSuffix: "0%_tv" }), 1);
    assert.equal(await auth.findActiveAuthToken(token), null);
    const a = await auth.createAuthToken("concurrent-user"), b = await auth.createAuthToken("concurrent-user");
    await auth.revokeAuthToken(a);
    assert.equal(await auth.findActiveAuthToken(a), null);
    assert.ok(await auth.findActiveAuthToken(b));
    await auth.deleteUserAuthTokens("concurrent-user");
    assert.equal(await auth.findActiveAuthToken(b), null);
  });

  it("erases an account's listening history and all session shapes transactionally", async () => {
    await users.pgCreateUser({ id: "erase-user", username: "erase", email: "erase@example.invalid" });
    await pool.query(`INSERT INTO listening_history(id,user_id,session_id,station_id,station_name,interaction_type,listened_at)
      VALUES ('erase-history','erase-user','browser','s','Station','play',now()),('erase-session-history',null,'erase-user','s','Station','play',now())`);
    for (const [sid,sess] of Object.entries({ erase1: { userId: "erase-user" }, erase2: { user: { userId: "erase-user" } }, erase3: { passport: { user: "erase-user" } }, keep: { userId: "concurrent-user" } })) {
      await pool.query("INSERT INTO user_sessions(sid,sess,expire) VALUES ($1,$2,now()+interval '1 day')", [sid,sess]);
    }
    assert.equal(await users.pgDeleteUser("erase-user"), true);
    assert.equal(Number((await pool.query("SELECT count(*) FROM listening_history WHERE user_id='erase-user' OR session_id='erase-user'")).rows[0].count), 0);
    assert.deepEqual((await pool.query("SELECT sid FROM user_sessions")).rows.map(row=>row.sid), ["keep"]);
    assert.ok(await users.pgFindUserById("concurrent-user"));
  });
});
