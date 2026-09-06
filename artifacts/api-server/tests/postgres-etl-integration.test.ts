import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { BSON } from "@workspace/legacy-migration/legacy-document-codec";
import { bsonSafe, checksum, jsonSafe, normalize, verify, verifyLegacyChecksums } from "@workspace/legacy-migration/migrate-mongo-to-postgres";

describe("Legacy mirror codec", () => {
  it("hashes JSONB independently of object key order without losing array order", () => {
    assert.equal(checksum({ z: 1, a: { y: 2, x: 3 } }), checksum({ a: { x: 3, y: 2 }, z: 1 }));
    assert.notEqual(checksum([1, 2]), checksum([2, 1]));
  });
  it("retains BSON date, ID, Int64, Decimal128 and binary types in strict Extended JSON", () => {
    const input = {
      _id: new BSON.ObjectId("507f1f77bcf86cd799439011"),
      date: new Date("2026-09-06T10:00:00Z"),
      long: BSON.Long.fromString("9223372036854775807"),
      decimal: BSON.Decimal128.fromString("123456789.0123456789"),
      binary: new BSON.Binary(Buffer.from([0, 1, 255])),
      count: new BSON.Int32(5), enabled: true,
    };
    const restored = BSON.EJSON.deserialize(bsonSafe(input), { relaxed: false });
    assert.equal(restored._id.toHexString(), input._id.toHexString());
    assert.equal(restored.date.getTime(), input.date.getTime());
    assert.equal(restored.long.toString(), input.long.toString());
    assert.equal(restored.decimal.toString(), input.decimal.toString());
    assert.deepEqual(restored.binary.buffer, input.binary.buffer);
    assert.equal(jsonSafe(input).count, 5);
    assert.equal(jsonSafe(input).long, "9223372036854775807");
    assert.equal(jsonSafe({ _id: BSON.Long.fromNumber(42) })._id, "42");
    assert.equal(jsonSafe(input).enabled, true);
  });
});

const connectionString = process.env.PG_TEST_DATABASE_URL;
describe("Mongo snapshot normalization on PostgreSQL", { skip: !connectionString }, () => {
  const schema = `etl_test_${process.pid}_${randomBytes(6).toString("hex")}`;
  const ssl = process.env.PG_TEST_SSL === "require" ? { rejectUnauthorized: true } : false;
  const admin = new pg.Pool({ connectionString, ssl, max: 1 });
  const pool = new pg.Pool({ connectionString, ssl, max: 5, options: `-c search_path=${schema},public` });
  let schemaCreated = false;
  const fixtures: Record<string, Record<string, any>[]> = {
    stations: [{ _id: "station-a", stationuuid: "uuid-a", name: "Snapshot Radio", url: "https://example.invalid", tags: "Jazz, Türkçe Pop" }],
    users: [
      { _id: "user-a", username: "a", email: "a@example.invalid", fullName: "A", subscription: { plan: "premium_monthly", isActive: true } },
      { _id: "user-b", username: "b", email: "b@example.invalid", fullName: "B" },
    ],
    userfavorites: [{ _id: "favorite-a", userId: "user-a", stationId: "station-a" }],
    userfollows: [{ _id: "follow-a", userId: "user-a", followingUserId: "user-b" }],
    translationkeys: [{ _id: "key-a", key: "test.greeting", defaultValue: "Hello", category: "test" }],
    translations: [{ _id: "translation-a", keyId: "key-a", language: "tr", value: "Merhaba", isCompleted: true }],
    urltranslations: [{ _id: "url-a", languageCode: "tr", englishPath: "about", translatedPath: "hakkinda" }],
    translationmetadatas: [{ _id: "metadata-a", scope: "global", languagesVersion: 7 }],
    translationlanguages: [{ _id: "language-a", code: "tr", name: "Turkish", isEnabled: true }],
    countrylanguagemappings: [{ _id: "mapping-a", countryCode: "TR", countryName: "Turkey", languageCode: "tr" }],
    clearedoverridesauditlogs: [{ _id: "audit-a", action: "clear-overrides", actorEmail: "admin@example.invalid", deletedCount: 2, snapshot: [{ countryCode: "TR" }] }],
  };

  before(async () => {
    assert.match(schema, /^etl_test_\d+_[a-f0-9]{12}$/);
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    const migrations = path.resolve(import.meta.dirname, "../../../lib/db/migrations");
    for (const file of (await readdir(migrations)).filter((file) => /^\d+.*\.sql$/.test(file)).sort()) {
      await pool.query(await readFile(path.join(migrations, file), "utf8"));
    }
    for (const [collection, documents] of Object.entries(fixtures)) {
      for (const document of documents) {
        const payload = jsonSafe(document);
        const bson = bsonSafe(document);
        await pool.query(`INSERT INTO legacy_documents(collection_name,document_id,payload,checksum,bson_payload,bson_checksum,last_seen_run_id)
          VALUES ($1,$2,$3,$4,$5,$6,'test')`, [collection, document._id, payload, checksum(payload), bson, checksum(bson)]);
      }
    }
  });
  after(async () => {
    await pool.end();
    try {
      if (schemaCreated) {
        assert.match(schema, /^etl_test_\d+_[a-f0-9]{12}$/);
        await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      }
    } finally { await admin.end(); }
  });

  it("normalizes all localization tables and validates repeatable snapshot parity", async () => {
    await normalize(pool);
    await verify(pool);
    await normalize(pool);
    await verify(pool);
    assert.equal((await pool.query("SELECT value FROM translations WHERE id='translation-a'")).rows[0].value, "Merhaba");
    assert.equal(Number((await pool.query("SELECT languages_version FROM translation_metadata")).rows[0].languages_version), 7);
    assert.equal((await pool.query("SELECT actor_email,deleted_count FROM country_language_mapping_audit")).rows[0].deleted_count, 2);
  });
  it("detects missing favorites/follows and wrong station genres even when counts match", async () => {
    await pool.query("UPDATE user_favorites SET user_id='user-b' WHERE user_id='user-a'");
    await assert.rejects(verify(pool), /user_favorites/);
    await pool.query("UPDATE user_favorites SET user_id='user-a'");
    await pool.query("DELETE FROM user_follows");
    await assert.rejects(verify(pool), /user_follows/);
    await normalize(pool);
    await pool.query("UPDATE station_genres SET genre_slug='wrong' WHERE genre_slug='jazz'");
    await assert.rejects(verify(pool), /station_genres/);
    await normalize(pool);
    await verify(pool);
  });
  it("detects altered mirror content and missing BSON capture, not only checksum length", async () => {
    await pool.query("UPDATE legacy_documents SET payload=jsonb_set(payload,'{name}','\"Tampered\"') WHERE document_id='station-a'");
    await assert.rejects(verifyLegacyChecksums(pool), /checksum mismatch/);
    const original = jsonSafe(fixtures.stations[0]);
    await pool.query("UPDATE legacy_documents SET payload=$1 WHERE document_id='station-a'", [original]);
    await pool.query("UPDATE legacy_documents SET bson_checksum=NULL WHERE document_id='station-a'");
    await assert.rejects(verifyLegacyChecksums(pool), /missing BSON capture/);
    await pool.query("UPDATE legacy_documents SET bson_checksum=$1 WHERE document_id='station-a'", [checksum(bsonSafe(fixtures.stations[0]))]);
    await verifyLegacyChecksums(pool);
  });
});
