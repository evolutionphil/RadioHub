import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import pg from "pg";
import { createIapAuditIdentity } from "../src/data/iap-audit-identity";
import {
  checksum,
  normalizePaymentEvents,
  paymentEventParity,
  pruneMigratedPaymentEvents,
} from "@workspace/legacy-migration/migrate-mongo-to-postgres";

const connectionString = process.env.PG_TEST_DATABASE_URL;
describe("Payment migration receipt identity", { skip: !connectionString }, () => {
  const schema = `payment_migration_test_${process.pid}_${randomBytes(6).toString("hex")}`;
  const ssl = process.env.PG_TEST_SSL === "require" ? { rejectUnauthorized: true } : false;
  const admin = new pg.Pool({ connectionString, ssl, max: 1 });
  const pool = new pg.Pool({ connectionString, ssl, max: 5, options: `-c search_path=${schema},public` });
  let schemaCreated = false;
  before(async () => {
    assert.match(schema, /^payment_migration_test_\d+_[a-f0-9]{12}$/);
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    const migrations = path.resolve(import.meta.dirname, "../../../lib/db/migrations");
    for (const file of (await readdir(migrations)).filter((name) => /^\d+.*\.sql$/.test(name)).sort()) {
      await pool.query(await readFile(path.join(migrations, file), "utf8"));
    }
  });
  beforeEach(async () => {
    await pool.query("DELETE FROM payment_events");
    await pool.query("DELETE FROM legacy_documents");
  });
  after(async () => {
    await pool.end();
    try {
      if (schemaCreated) {
        assert.match(schema, /^payment_migration_test_\d+_[a-f0-9]{12}$/);
        await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      }
    } finally { await admin.end(); }
  });

  async function mirror(documentId: string, eventId: string, collection = "applewebhookevents") {
    const payload = {
      _id: documentId, notificationUUID: eventId, notificationType: "DID_RENEW",
      status: "recorded", plan: "premium_monthly", signedDate: "2026-09-06T10:00:00.000Z",
    };
    await pool.query(
      `INSERT INTO legacy_documents(collection_name,document_id,payload,checksum,last_seen_run_id,bson_payload,bson_checksum)
       VALUES($1,$2,$3,$4,'test',$3,$4)`,
      [collection, documentId, JSON.stringify(payload), checksum(payload)],
    );
  }

  async function receipt(id: string, eventId: string, origin: "runtime" | "mongo_migration" = "runtime") {
    await pool.query(
      `INSERT INTO payment_events(id,provider,provider_event_id,event_type,status,plan,occurred_at,payload,origin)
       VALUES($1,'apple',$2,'REFUND','success','none','2026-09-06T11:00:00Z',$3,$4)`,
      [id, eventId, { durable: true }, origin],
    );
  }

  async function mirrorAudit(mongoId: string, platform: string) {
    const payload = { _id: mongoId, platform, result: "success", receiptHash: "same-purchase", createdAt: "2026-09-06T10:00:00Z" };
    await pool.query(
      `INSERT INTO legacy_documents(collection_name,document_id,payload,checksum,last_seen_run_id,bson_payload,bson_checksum)
       VALUES('iapevents',$1,$2,$3,'test',$2,$3)`,
      [mongoId, JSON.stringify(payload), checksum(payload)],
    );
  }

  it("preserves an existing runtime UUID receipt through normalization and pruning", async () => {
    const runtimeId = randomUUID();
    await mirror("mongo-object-id", "notification-1");
    await receipt(runtimeId, "notification-1");
    const before = (await pool.query("SELECT * FROM payment_events WHERE id=$1", [runtimeId])).rows[0];
    await normalizePaymentEvents(pool);
    await pruneMigratedPaymentEvents(pool);
    const after = (await pool.query("SELECT * FROM payment_events WHERE id=$1", [runtimeId])).rows[0];
    assert.deepEqual(after, before, "a Mongo snapshot must not downgrade or relabel a committed runtime receipt");
    assert.deepEqual(await paymentEventParity(pool), { expected: 1, matched: 1, unexpectedMigrated: 0 });
  });

  it("keeps migrated receipts whose physical ID differs from the matching Mongo delivery", async () => {
    const previousId = randomUUID();
    await mirror("new-mongo-id", "notification-2");
    await receipt(previousId, "notification-2", "mongo_migration");
    await normalizePaymentEvents(pool);
    await pruneMigratedPaymentEvents(pool);
    const rows = (await pool.query("SELECT id,provider_event_id,origin FROM payment_events")).rows;
    assert.deepEqual(rows, [{ id: previousId, provider_event_id: "notification-2", origin: "mongo_migration" }]);
    assert.deepEqual(await paymentEventParity(pool), { expected: 1, matched: 1, unexpectedMigrated: 0 });
  });

  it("prunes only unmatched migrated keys while retaining additional runtime events", async () => {
    await mirror("mongo-3", "notification-3");
    await normalizePaymentEvents(pool);
    await receipt("extra-runtime", "runtime-only");
    await receipt("stale-migrated", "removed-source-event", "mongo_migration");
    assert.deepEqual(await paymentEventParity(pool), { expected: 1, matched: 1, unexpectedMigrated: 1 });
    await pruneMigratedPaymentEvents(pool);
    assert.deepEqual((await pool.query("SELECT id FROM payment_events ORDER BY id")).rows, [{ id: "extra-runtime" }, { id: "mongo-3" }]);
    assert.deepEqual(await paymentEventParity(pool), { expected: 1, matched: 1, unexpectedMigrated: 0 });
  });

  it("does not let equal row counts hide a missing delivery and an unrelated migrated delivery", async () => {
    await mirror("mongo-4", "expected-key");
    await receipt("wrong-key-id", "wrong-key", "mongo_migration");
    assert.deepEqual(await paymentEventParity(pool), { expected: 1, matched: 0, unexpectedMigrated: 1 });
  });

  it("treats aliases of one legacy notification as one delivery", async () => {
    await mirror("mongo-5-a", "same-delivery", "applewebhookevents");
    await mirror("mongo-5-b", "same-delivery", "apple_webhook_events");
    await normalizePaymentEvents(pool);
    await pruneMigratedPaymentEvents(pool);
    assert.deepEqual(await paymentEventParity(pool), { expected: 1, matched: 1, unexpectedMigrated: 0 });
    assert.equal((await pool.query("SELECT count(*)::int count FROM payment_events")).rows[0].count, 1);
  });

  it("does not duplicate new dual-write IAP audits on final source normalization", async () => {
    for (const platform of ["ios", "android"]) {
      const identity = createIapAuditIdentity(platform);
      assert.match(identity.mongoId, /^[a-f0-9]{24}$/);
      assert.equal(identity.providerEventId, `audit:${identity.mongoId}`);
      await mirrorAudit(identity.mongoId, platform);
      await pool.query(
        `INSERT INTO payment_events(id,provider,provider_event_id,event_type,status,occurred_at,payload,origin)
         VALUES($1,$2,$3,'iap_audit','success',now(),$4,'runtime')`,
        [randomUUID(), identity.provider, identity.providerEventId, { platform, result: "success" }],
      );
    }
    await normalizePaymentEvents(pool);
    await pruneMigratedPaymentEvents(pool);
    const rows = (await pool.query("SELECT provider,origin,event_type,payload->>'platform' platform FROM payment_events ORDER BY provider")).rows;
    assert.deepEqual(rows, [
      { provider: "apple", origin: "runtime", event_type: "iap_audit", platform: "ios" },
      { provider: "google", origin: "runtime", event_type: "iap_audit", platform: "android" },
    ]);
    assert.deepEqual(await paymentEventParity(pool), { expected: 2, matched: 2, unexpectedMigrated: 0 });
  });

  it("canonicalizes only the existing migrated audit alias without creating an extra historical row", async () => {
    const identity = createIapAuditIdentity("ios");
    await mirrorAudit(identity.mongoId, "ios");
    await pool.query(
      `INSERT INTO payment_events(id,provider,provider_event_id,event_type,status,occurred_at,payload,origin)
       VALUES($1,'ios',$1,'success','success',now(),$2,'mongo_migration')`,
      [identity.mongoId, { platform: "ios", result: "success" }],
    );
    await normalizePaymentEvents(pool);
    await normalizePaymentEvents(pool);
    await pruneMigratedPaymentEvents(pool);
    assert.deepEqual((await pool.query("SELECT id,provider,provider_event_id FROM payment_events")).rows, [
      { id: identity.mongoId, provider: "apple", provider_event_id: identity.providerEventId },
    ]);
    assert.deepEqual(await paymentEventParity(pool), { expected: 1, matched: 1, unexpectedMigrated: 0 });
  });

  it("does not guess that distinct historical audit attempts are the same event", async () => {
    await mirrorAudit(createIapAuditIdentity("ios").mongoId, "ios");
    await mirrorAudit(createIapAuditIdentity("ios").mongoId, "ios");
    await normalizePaymentEvents(pool);
    assert.deepEqual(await paymentEventParity(pool), { expected: 2, matched: 2, unexpectedMigrated: 0 });
  });
});
