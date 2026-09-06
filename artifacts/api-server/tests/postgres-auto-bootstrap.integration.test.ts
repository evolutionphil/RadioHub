import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { BSON, bsonSafe, checksum } from "@workspace/legacy-migration/legacy-document-codec";
import { recordPostgresWriteAuthority } from "../src/data/postgres-migration-safety";
import { sanitizedBootstrapError } from "../../../lib/legacy-migration/src/auto-bootstrap-postgres";

const postgresTestUrl = process.env.PG_TEST_DATABASE_URL;
const mongoTestUrl = process.env.MONGO_TEST_URI;
const packagedDirectory = process.env.PG_BOOTSTRAP_TEST_PACKAGE;
const repository = path.resolve(import.meta.dirname, "../../..");
const legacyRequire = createRequire(path.join(repository, "lib/legacy-migration/package.json"));

function localTestUrl(value: string, kind: "postgres" | "mongo"): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`Invalid disposable ${kind} test URL`); }
  assert.ok(["127.0.0.1", "[::1]"].includes(url.hostname), `${kind} integration tests require a literal loopback host`);
  assert.ok(kind === "mongo" ? url.protocol === "mongodb:" : ["postgres:", "postgresql:"].includes(url.protocol), "Unexpected test URL protocol");
  if (kind === "postgres") {
    assert.match(decodeURIComponent(url.pathname.slice(1)), /(?:^|[_-])(?:test|tests|validation)(?:$|[_-])/i,
      "PostgreSQL database must be explicitly named as a disposable test/validation database");
    for (const key of url.searchParams.keys()) {
      assert.ok(["sslmode", "sslrootcert"].includes(key), "PostgreSQL test URL must not override its host, database or search path through query options");
    }
  }
  return url;
}

function operatorEnvironment(databaseUrl: string): NodeJS.ProcessEnv {
  // No production database credentials, NODE_OPTIONS, store cutover flags or
  // inherited migration switches may leak into this disposable operator child.
  const environment: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (/^(?:PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|LANG|LC_ALL)$/i.test(name)) environment[name] = value;
  }
  return {
    ...environment,
    DATABASE_URL: databaseUrl,
    NODE_ENV: packagedDirectory ? "production" : "development",
    POSTGRES_SSL: process.env.PG_TEST_SSL === "require" ? "require" : "disable",
    // Packaged mode must discover its own deployed db-migrations directory;
    // falling back to repository SQL would hide incomplete operator packaging.
    ...(!packagedDirectory ? { POSTGRES_MIGRATIONS_DIR: path.join(repository, "lib/db/migrations") } : {}),
  };
}

async function invokeInitializer(environment: NodeJS.ProcessEnv): Promise<{ code: number | null; output: string }> {
  let cwd = repository;
  let args: string[];
  if (packagedDirectory) {
    assert.ok(path.isAbsolute(packagedDirectory), "PG_BOOTSTRAP_TEST_PACKAGE must be an absolute operator package path");
    const entry = path.join(packagedDirectory, "dist/bootstrap.mjs");
    assert.ok(existsSync(entry) && statSync(entry).isFile(), "Packaged bootstrap entry point must exist");
    cwd = packagedDirectory;
    args = [entry];
  } else {
    const loader = pathToFileURL(legacyRequire.resolve("tsx/esm")).href;
    args = ["--import", loader, path.join(repository, "lib/legacy-migration/src/auto-bootstrap-postgres.ts")];
  }
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd, env: environment, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let expired = false;
    const timer = setTimeout(() => { expired = true; child.kill(); }, 45_000);
    child.stdout.on("data", (chunk) => { output = (output + String(chunk)).slice(-128_000); });
    child.stderr.on("data", (chunk) => { output = (output + String(chunk)).slice(-128_000); });
    child.once("error", () => { clearTimeout(timer); reject(new Error("Could not start the disposable initializer subprocess")); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (expired) return reject(new Error("Disposable initializer timed out and was terminated"));
      return resolve({ code, output: sanitizedBootstrapError(new Error(output), environment) });
    });
  });
}

test("real one-time MongoDB import installs PostgreSQL, preserves BSON/content and never replays after success", {
  skip: !postgresTestUrl || !mongoTestUrl,
  timeout: 90_000,
}, async () => {
  const pgUrl = localTestUrl(postgresTestUrl!, "postgres");
  const sourceUrl = localTestUrl(mongoTestUrl!, "mongo");
  const suffix = `${process.pid}_${randomBytes(6).toString("hex")}`;
  const schema = `bootstrap_test_${suffix}`;
  const mongoDatabase = `radiohub_bootstrap_test_${suffix}`;
  const schemaPattern = /^bootstrap_test_\d+_[a-f0-9]{12}$/;
  const mongoPattern = /^radiohub_bootstrap_test_\d+_[a-f0-9]{12}$/;
  assert.match(schema, schemaPattern);
  assert.match(mongoDatabase, mongoPattern);
  sourceUrl.pathname = "/" + mongoDatabase;
  // Do not let a replica-set discovery redirect this test outside loopback.
  sourceUrl.searchParams.set("directConnection", "true");
  const scopedPgUrl = new URL(pgUrl);
  scopedPgUrl.searchParams.set("options", `-c search_path=${schema},public`);
  const ssl = process.env.PG_TEST_SSL === "require" ? { rejectUnauthorized: true } : false;
  const admin = new pg.Pool({ connectionString: pgUrl.toString(), ssl, max: 1 });
  const destination = new pg.Pool({ connectionString: scopedPgUrl.toString(), ssl, max: 2 });
  const { MongoClient } = legacyRequire("mongodb");
  const source = new MongoClient(sourceUrl.toString(), { directConnection: true, serverSelectionTimeoutMS: 5_000 });
  let schemaCreated = false;
  let sourceCreated = false;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    const baseEnvironment = operatorEnvironment(scopedPgUrl.toString());

    // Merely connecting DATABASE_URL installs schema, but never grants native
    // write authority before the source import/verification has completed.
    const unconfigured = await invokeInitializer(baseEnvironment);
    assert.equal(unconfigured.code, 1, unconfigured.output);
    assert.match(unconfigured.output, /MONGODB_URI/);
    assert.ok(Number((await destination.query("SELECT count(*) FROM radiohub_schema_migrations")).rows[0].count) >= 24);
    assert.equal((await destination.query("SELECT count(*)::int count FROM database_write_authority")).rows[0].count, 0);
    await assert.rejects(recordPostgresWriteAuthority(destination, {}), /initialization|import|bootstrap/i);
    assert.equal((await destination.query("SELECT count(*)::int count FROM database_write_authority")).rows[0].count, 0);

    await source.connect();
    const database = source.db(mongoDatabase);
    assert.equal(database.databaseName, mongoDatabase);
    const unknown = {
      _id: new BSON.ObjectId("507f1f77bcf86cd799439099"),
      exactCounter: BSON.Long.fromString("9223372036854775807"),
      amount: BSON.Decimal128.fromString("123456789.0123456789"),
      bytes: new BSON.Binary(Buffer.from([0, 1, 127, 255])),
      observedAt: new Date("2026-09-07T00:00:00.000Z"),
      nested: { enabled: true, values: ["original", "Türkçe"] },
    };
    // These in-memory synthetic fixtures are the independent reconstructible
    // source backup for this test; no real customer source is ever accessed.
    const fixtures: Record<string, object[]> = {
      users: [{ _id: "bootstrap-user", username: "bootstrap", email: "bootstrap@example.invalid", fullName: "Original user", passwordHash: "synthetic-existing-hash" }],
      stations: [{ _id: "bootstrap-station", stationuuid: "bootstrap-uuid", name: "Son güncel radyo", url: "https://example.invalid/stream", tags: "Jazz,Türkçe Pop" }],
      userfavorites: [{ _id: "bootstrap-favorite", userId: "bootstrap-user", stationId: "bootstrap-station" }],
      translationkeys: [{ _id: "bootstrap-key", key: "bootstrap.greeting", defaultValue: "Hello", category: "test" }],
      translations: [{ _id: "bootstrap-translation", keyId: "bootstrap-key", language: "tr", value: "En son çeviri", isCompleted: true }],
      unknown_future_collection: [unknown],
    };
    sourceCreated = true;
    for (const [name, documents] of Object.entries(fixtures)) await database.collection(name).insertMany(documents);
    const importEnvironment = {
      ...baseEnvironment,
      MONGODB_URI: sourceUrl.toString(),
      MIGRATION_SOURCE_WRITERS_STOPPED: "true",
      MIGRATION_TARGET_WRITERS_STOPPED: "true",
      MIGRATION_SOURCE_BACKUP_CONFIRMED: "true",
    };
    // Real separate processes, not mocked locks: one imports, the other waits
    // and skips without creating a second migration run.
    const concurrent = await Promise.all([
      invokeInitializer(importEnvironment), invokeInitializer(importEnvironment),
    ]);
    for (const result of concurrent) assert.equal(result.code, 0, result.output);
    assert.equal(concurrent.filter((result) => /import and verification completed successfully/.test(result.output)).length, 1);
    assert.equal(concurrent.filter((result) => /Verified import already completed/.test(result.output)).length, 1);
    assert.equal((await destination.query("SELECT name FROM stations WHERE id='bootstrap-station'")).rows[0].name, "Son güncel radyo");
    assert.equal((await destination.query("SELECT password_hash FROM users WHERE id='bootstrap-user'")).rows[0].password_hash, "synthetic-existing-hash");
    assert.equal((await destination.query("SELECT value FROM translations WHERE id='bootstrap-translation'")).rows[0].value, "En son çeviri");
    assert.deepEqual((await destination.query("SELECT genre_slug FROM station_genres ORDER BY position")).rows.map((row) => row.genre_slug), ["jazz", "turkce-pop"]);
    assert.deepEqual((await destination.query("SELECT user_id,station_id FROM user_favorites")).rows, [{ user_id: "bootstrap-user", station_id: "bootstrap-station" }]);
    const captured = (await destination.query("SELECT payload,bson_payload,bson_checksum FROM legacy_documents WHERE collection_name='unknown_future_collection'")).rows[0];
    assert.equal(captured.payload.exactCounter, "9223372036854775807");
    assert.deepEqual(captured.bson_payload, bsonSafe(unknown));
    assert.equal(captured.bson_checksum, checksum(bsonSafe(unknown)));
    assert.equal((await destination.query("SELECT count(*)::int count FROM migration_runs WHERE mode='all' AND status='complete' AND finished_at IS NOT NULL")).rows[0].count, 1);
    assert.equal((await destination.query("SELECT count(*)::int count FROM migration_checkpoints WHERE status='complete' AND source_count=target_count AND documents_processed=source_count")).rows[0].count, Object.keys(fixtures).length);
    assert.equal((await destination.query("SELECT count(*)::int count FROM database_write_authority")).rows[0].count, 0);

    // Later source edits and native SQL changes must not be replayed. No source
    // URI or safety confirmations exist in this second initializer process.
    await database.collection("stations").updateOne({ _id: "bootstrap-station" }, { $set: { name: "Later Mongo edit must not overwrite SQL" } });
    await destination.query("UPDATE stations SET name='New PostgreSQL-only name' WHERE id='bootstrap-station'");
    const repeated = await invokeInitializer(baseEnvironment);
    assert.equal(repeated.code, 0, repeated.output);
    assert.match(repeated.output, /Verified import already completed/);
    assert.equal((await destination.query("SELECT name FROM stations WHERE id='bootstrap-station'")).rows[0].name, "New PostgreSQL-only name");
    assert.equal((await destination.query("SELECT count(*)::int count FROM migration_runs")).rows[0].count, 1);

    await recordPostgresWriteAuthority(destination, {});
    assert.ok((await destination.query("SELECT count(*)::int count FROM database_write_authority")).rows[0].count > 0);
    const authoritative = await invokeInitializer({ ...baseEnvironment, MONGODB_URI: "invalid-must-not-be-used" });
    assert.equal(authoritative.code, 0, authoritative.output);
    assert.match(authoritative.output, /PostgreSQL already owns application writes/);
    assert.equal((await destination.query("SELECT count(*)::int count FROM migration_runs")).rows[0].count, 1);
    assert.equal((await destination.query("SELECT name FROM stations WHERE id='bootstrap-station'")).rows[0].name, "New PostgreSQL-only name");
  } finally {
    try {
      if (sourceCreated) {
        assert.match(mongoDatabase, mongoPattern);
        assert.equal(sourceUrl.pathname, "/" + mongoDatabase);
        localTestUrl(sourceUrl.toString(), "mongo");
        await source.db(mongoDatabase).dropDatabase();
      }
    } finally {
      await source.close();
      await destination.end();
      try {
        if (schemaCreated) {
          assert.match(schema, schemaPattern);
          localTestUrl(pgUrl.toString(), "postgres");
          await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
        }
      } finally { await admin.end(); }
    }
  }
});
