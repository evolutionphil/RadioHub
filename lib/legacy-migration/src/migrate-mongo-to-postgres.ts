import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { MongoClient, type Db } from "mongodb";
import pg from "pg";
import { assertNoPostgresWriteAuthority, validateMigrationWriteSafety } from "../../../artifacts/api-server/src/data/postgres-migration-safety";
import { bsonSafe, checksum, jsonSafe } from "./legacy-document-codec";
import { iapAuditEventId, iapAuditProvider } from "../../../artifacts/api-server/src/data/iap-audit-identity";
import { createMigrationLifecycle, lockedMigrationDatabase, MigrationLifecycleError, type MigrationDatabase, type MigrationLifecycle } from "./migration-lifecycle";
import { migrationBatchLimits, shouldFlushMigrationBatch, type MigrationBatchLimits } from "./migration-batching";
import { inspectInitialCaptureResume, validateCapturedSource } from "./initial-capture-resume";
export { bsonSafe, checksum, jsonSafe } from "./legacy-document-codec";

const { Pool } = pg;
let mongoClient: MongoClient | null = null;
let sourceDatabase: Db | null = null;

type JsonDocument = Record<string, any>;
type MigrationStats = Record<string, { source: number; target: number }>;

let batchSize = 250;
const phaseArgument = process.argv.find((value) => value.startsWith("--phase="))?.split("=", 2)[1];
const allowedPhases = new Set(["mirror", "normalize", "verify", "all"]);

function migrationPostgresSsl(): false | { rejectUnauthorized: boolean; ca?: string } {
  if (process.env.POSTGRES_SSL === "disable") return false;
  const ca = process.env.POSTGRES_SSL_CA?.replace(/\\n/g, "\n");
  return {
    rejectUnauthorized: process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED !== "false",
    ...(ca ? { ca } : {}),
  };
}

export function requiredUrl(name: "MONGODB_URI" | "DATABASE_URL", protocol: RegExp): string {
  const value = process.env[name] || "";
  if (!protocol.test(value)) {
    throw new Error(`${name} is missing or has the wrong protocol`);
  }
  return value;
}

export function id(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

export function date(value: unknown): Date | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function bool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function number(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && !Number.isSafeInteger(parsed)) {
    throw new Error("Migration refused an integer outside JavaScript's exact numeric range; review its target column mapping");
  }
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function tags(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string") return [];
  return value.split(",");
}

export function genreSlug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);
}

export function placeholders(rows: number, columns: number): string {
  let parameter = 1;
  return Array.from({ length: rows }, () => {
    const row = Array.from({ length: columns }, () => `$${parameter++}`).join(",");
    return `(${row})`;
  }).join(",");
}

async function mirrorCollection(
  postgres: MigrationDatabase,
  collectionName: string,
  runId: string,
  lifecycle: MigrationLifecycle,
  limits: MigrationBatchLimits,
  resume = false,
): Promise<{ source: number; target: number }> {
  const mongo = sourceDatabase!;
  const collection = mongo.collection(collectionName);
  const source = await collection.countDocuments({}, { signal: lifecycle.signal });
  let processed = 0;
  // Store serialized data once; both document count AND bytes bound each write.
  type Captured = { documentId: string; payload: string; checksum: string; bson: string; bsonChecksum: string; updatedAt: Date | null };
  let batch: Captured[] = [];
  let batchBytes = 0;
  let lastProgress = Date.now();

  const writeBatch = async () => {
    if (!batch.length) return;
    lifecycle.assertHealthy();
    const values: unknown[] = [];
    for (const row of batch) {
      values.push(
        collectionName, row.documentId, row.payload, row.checksum, runId,
        row.updatedAt, row.bson, row.bsonChecksum,
      );
    }
    // A checkpoint must never describe a batch that was rolled back (or vice versa).
    await postgres.query("BEGIN");
    try {
      await postgres.query(
        `INSERT INTO legacy_documents
          (collection_name, document_id, payload, checksum, last_seen_run_id, mongo_updated_at, bson_payload, bson_checksum)
         VALUES ${placeholders(batch.length, 8)}
         ON CONFLICT (collection_name, document_id) ${resume ? "DO NOTHING" : `DO UPDATE SET
           payload = EXCLUDED.payload,
           checksum = EXCLUDED.checksum,
           bson_payload = EXCLUDED.bson_payload,
           bson_checksum = EXCLUDED.bson_checksum,
           last_seen_run_id = EXCLUDED.last_seen_run_id,
           mongo_updated_at = EXCLUDED.mongo_updated_at,
           migrated_at = now()`}`,
        values,
      );
      if (resume) {
        const existing = await postgres.query(
          `SELECT document_id,payload,checksum,bson_payload,bson_checksum,last_seen_run_id
           FROM legacy_documents WHERE collection_name=$1 AND document_id=ANY($2::text[])`,
          [collectionName, batch.map((row) => row.documentId)],
        );
        const byId = new Map(existing.rows.map((row) => [row.document_id, row]));
        for (const expected of batch) {
          const row = byId.get(expected.documentId);
          if (!row || row.last_seen_run_id !== runId || row.checksum !== expected.checksum ||
              row.bson_checksum !== expected.bsonChecksum || checksum(row.payload) !== expected.checksum ||
              checksum(row.bson_payload) !== expected.bsonChecksum) {
            throw new Error("Initial capture resume refused changed content or conflicting BSON identity; existing data was not overwritten.");
          }
        }
      }
      await postgres.query(
        `INSERT INTO migration_checkpoints
          (collection_name, last_document_id, documents_processed, source_count, status)
         VALUES ($1, $2, $3, $4, 'running')
         ON CONFLICT (collection_name) DO UPDATE SET
           last_document_id=EXCLUDED.last_document_id,
           documents_processed=EXCLUDED.documents_processed,
           source_count=EXCLUDED.source_count,
           status='running', updated_at=now()`,
        [collectionName, batch[batch.length - 1].documentId, processed + batch.length, source],
      );
      await postgres.query("COMMIT");
    } catch (error) {
      await postgres.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
    processed += batch.length;
    batch = [];
    batchBytes = 0;
    if (Date.now() - lastProgress >= 15_000) {
      console.log(`[mirror:progress] ${collectionName}: ${processed}/${source} checked and committed`);
      lastProgress = Date.now();
    }
  };

  const cursor = collection.find({}, { promoteValues: false, signal: lifecycle.signal }).sort({ _id: 1 }).batchSize(batchSize);
  try {
    for await (const document of cursor) {
      lifecycle.assertHealthy();
      const payload = jsonSafe(document);
      const bson = bsonSafe(document);
      const row = { documentId: id(document._id), payload: JSON.stringify(payload), checksum: checksum(payload),
        bson: JSON.stringify(bson), bsonChecksum: checksum(bson), updatedAt: date(document.updatedAt) };
      const bytes = Buffer.byteLength(row.payload) + Buffer.byteLength(row.bson) + Buffer.byteLength(row.documentId) + 256;
      if (shouldFlushMigrationBatch(batch.length, batchBytes, bytes, limits)) await writeBatch();
      batch.push(row);
      batchBytes += bytes;
      if (shouldFlushMigrationBatch(batch.length, batchBytes, 0, limits)) await writeBatch();
    }
    await writeBatch();
  } finally {
    await cursor.close().catch(() => undefined);
  }

  if (process.env.MIGRATION_PRUNE === "true") {
    if (process.env.DATABASE_MAINTENANCE_READ_ONLY !== "true") {
      throw new Error(
        "MIGRATION_PRUNE=true requires DATABASE_MAINTENANCE_READ_ONLY=true",
      );
    }
    const deleted = await postgres.query(
      `DELETE FROM legacy_documents
       WHERE collection_name=$1 AND last_seen_run_id<>$2`,
      [collectionName, runId],
    );
    console.log(`[mirror] ${collectionName}: pruned ${deleted.rowCount || 0} stale documents`);
  }

  const targetResult = await postgres.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM legacy_documents WHERE collection_name=$1",
    [collectionName],
  );
  const target = Number(targetResult.rows[0]?.count || 0);
  await postgres.query(
    `UPDATE migration_checkpoints SET target_count=$2, status=$3, updated_at=now()
     WHERE collection_name=$1`,
    [collectionName, target, source === target ? "complete" : "mismatch"],
  );
  console.log(`[mirror] ${collectionName}: ${source} -> ${target}`);
  return { source, target };
}

async function forEachLegacyBatch(
  postgres: MigrationDatabase,
  collectionName: string,
  callback: (rows: JsonDocument[], client: pg.PoolClient) => Promise<void>,
): Promise<void> {
  let offset = 0;
  while (true) {
    const result = await postgres.query<{ payload: JsonDocument }>(
      `SELECT payload FROM legacy_documents
       WHERE collection_name=$1 ORDER BY document_id LIMIT $2 OFFSET $3`,
      [collectionName, batchSize, offset],
    );
    if (!result.rowCount) break;
    const client = await postgres.connect();
    try {
      await client.query("BEGIN");
      await callback(result.rows.map((row) => row.payload), client);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    offset += result.rowCount;
  }
}

async function existingLegacyCollections(
  postgres: MigrationDatabase,
  candidates: string[],
): Promise<string[]> {
  const result = await postgres.query<{ collection_name: string }>(
    `SELECT DISTINCT collection_name FROM legacy_documents
     WHERE collection_name = ANY($1::text[])`,
    [candidates],
  );
  return result.rows.map((row) => row.collection_name);
}

async function normalizeTaxonomy(postgres: MigrationDatabase): Promise<void> {
  for (const collection of await existingLegacyCollections(postgres, ["countries"])) {
    await forEachLegacyBatch(postgres, collection, async (documents, client) => {
      for (const item of documents) {
        const itemId = id(item._id);
        const code = String(item.code || item.countryCode || itemId).toUpperCase();
        await client.query(
          `INSERT INTO countries(id, code, name, continent, station_count, source, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (id) DO UPDATE SET code=EXCLUDED.code, name=EXCLUDED.name,
             continent=EXCLUDED.continent, station_count=EXCLUDED.station_count,
             source=EXCLUDED.source, updated_at=EXCLUDED.updated_at`,
          [itemId, code, String(item.name || code), item.continent || null,
            number(item.stationCount ?? item.stationcount), JSON.stringify(item),
            date(item.createdAt) || new Date(), date(item.updatedAt) || new Date()],
        );
      }
    });
  }
  for (const collection of await existingLegacyCollections(postgres, ["languages"])) {
    await forEachLegacyBatch(postgres, collection, async (documents, client) => {
      for (const item of documents) {
        const itemId = id(item._id);
        await client.query(
          `INSERT INTO languages(id, code, name, station_count, source, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (id) DO UPDATE SET code=EXCLUDED.code, name=EXCLUDED.name,
             station_count=EXCLUDED.station_count, source=EXCLUDED.source,
             updated_at=EXCLUDED.updated_at`,
          [itemId, item.code || item.iso || null, String(item.name || item.code || itemId),
            number(item.stationCount ?? item.stationcount), JSON.stringify(item),
            date(item.createdAt) || new Date(), date(item.updatedAt) || new Date()],
        );
      }
    });
  }
  await normalizeGenres(postgres);
}

// Stage only one bounded batch in JS. PostgreSQL ranks all duplicate candidates
// without discarding documents or relying on import order.
async function withGenreCandidates(postgres: MigrationDatabase, work: (client: pg.PoolClient) => Promise<void>): Promise<void> {
  const client = await postgres.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    await client.query(`CREATE TEMP TABLE migration_genre_candidates(
      id text PRIMARY KEY,name text,candidate text,discoverable boolean,station_count integer,
      source jsonb,created_at timestamptz,updated_at timestamptz) ON COMMIT DROP`);
    let cursor = '';
    while (true) {
      const batch = (await client.query("SELECT document_id,payload FROM legacy_documents WHERE collection_name='genres' AND document_id>$1 ORDER BY document_id LIMIT $2", [cursor,batchSize])).rows;
      if (!batch.length) break;
      for (const { document_id, payload: item } of batch) {
        const candidate = item.slug === null && item.isDiscoverable === false ? null : (item.slug ? String(item.slug) : genreSlug(String(item.name || ''))) || null;
        await client.query('INSERT INTO migration_genre_candidates VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [document_id,String(item.name || candidate || document_id),candidate,bool(item.isDiscoverable,true),exactInteger(item.stationCount,0,32),
            JSON.stringify(item),date(item.createdAt),date(item.updatedAt)]);
      }
      cursor = batch[batch.length-1].document_id;
    }
    await client.query(`CREATE TEMP VIEW migration_genre_ranked AS SELECT *,
      row_number() OVER rank AS position,first_value(id) OVER rank AS winner_id,first_value(name) OVER rank AS winner_name
      FROM migration_genre_candidates WINDOW rank AS (PARTITION BY candidate ORDER BY station_count DESC,discoverable DESC,created_at ASC NULLS LAST,id ASC)`);
    await work(client);
    await client.query('DROP VIEW migration_genre_ranked');
    await client.query('COMMIT');
  } catch(error) { await client.query('ROLLBACK').catch(()=>{}); throw error; } finally { client.release(); }
}
async function normalizeGenres(postgres: MigrationDatabase): Promise<void> {
  await withGenreCandidates(postgres,async client=>{
    // Release only captured source IDs before assigning winners, so a replay
    // cannot depend on which loser happened to be imported first.
    await client.query("UPDATE genres SET slug=NULL,is_discoverable=false WHERE id IN(SELECT id FROM migration_genre_candidates)");
    await client.query(`INSERT INTO genres(id,name,slug,is_discoverable,station_count,source,created_at,updated_at)
      SELECT r.id,r.name,CASE WHEN r.position=1 THEN r.candidate END,
        r.discoverable AND r.candidate IS NOT NULL AND r.position=1,r.station_count,
        CASE WHEN r.candidate IS NOT NULL AND r.position>1 THEN r.source||jsonb_build_object('cleanupDemotion',
          coalesce(r.source->'cleanupDemotion','{}')||jsonb_build_object('reason','collision','originalSlug',r.source->'slug',
            'normalizedSlug',r.candidate,'collisionWinnerId',r.winner_id,'collisionWinnerSlug',r.candidate,'collisionWinnerName',r.winner_name,
            'demotedAt',coalesce(g.source#>'{cleanupDemotion,demotedAt}',to_jsonb(now()))))
          ELSE r.source END,coalesce(r.created_at,g.created_at,now()),coalesce(r.updated_at,g.updated_at,now())
      FROM migration_genre_ranked r LEFT JOIN genres g ON g.id=r.id
      ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,slug=EXCLUDED.slug,is_discoverable=EXCLUDED.is_discoverable,
        station_count=EXCLUDED.station_count,source=EXCLUDED.source,updated_at=EXCLUDED.updated_at`);
  });
}
export async function verifyGenreParity(postgres: MigrationDatabase): Promise<void> {
  await withGenreCandidates(postgres,async client=>{
    const bad=await client.query(`SELECT r.id FROM migration_genre_ranked r LEFT JOIN genres g ON g.id=r.id
      WHERE g.id IS NULL OR g.name IS DISTINCT FROM r.name OR g.station_count IS DISTINCT FROM r.station_count
      OR g.slug IS DISTINCT FROM CASE WHEN r.position=1 THEN r.candidate END
      OR g.is_discoverable IS DISTINCT FROM (r.discoverable AND r.candidate IS NOT NULL AND r.position=1)
      OR CASE WHEN r.candidate IS NOT NULL AND r.position>1 THEN
        (g.source-'cleanupDemotion') IS DISTINCT FROM (r.source-'cleanupDemotion')
        OR g.source#>>'{cleanupDemotion,reason}' IS DISTINCT FROM 'collision'
        OR g.source#>>'{cleanupDemotion,collisionWinnerId}' IS DISTINCT FROM r.winner_id
        OR g.source#>>'{cleanupDemotion,normalizedSlug}' IS DISTINCT FROM r.candidate
      ELSE g.source IS DISTINCT FROM r.source END LIMIT 1`);
    if(bad.rowCount)throw new Error('Normalized genre content mismatch: '+bad.rows[0].id);
  });
}

async function normalizeTranslations(postgres: MigrationDatabase): Promise<void> {
  for (const collection of await existingLegacyCollections(postgres, ["clearedoverridesauditlogs"])) {
    await forEachLegacyBatch(postgres, collection, async (documents, client) => {
      for (const item of documents) {
        await client.query(
          `INSERT INTO country_language_mapping_audit(id,action,actor_email,deleted_count,created_at,snapshot,changes,note)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8) ON CONFLICT (id) DO UPDATE SET
             action=EXCLUDED.action,actor_email=EXCLUDED.actor_email,deleted_count=EXCLUDED.deleted_count,
             created_at=EXCLUDED.created_at,snapshot=EXCLUDED.snapshot,changes=EXCLUDED.changes,note=EXCLUDED.note`,
          [id(item._id), String(item.action || "clear-overrides"), item.actorEmail || null,
            Math.trunc(number(item.deletedCount)), date(item.createdAt) || new Date(),
            JSON.stringify(item.snapshot || []), JSON.stringify(item.changes || []), item.note || null],
        );
      }
    });
  }
  for (const collection of await existingLegacyCollections(postgres, ["translationmetadatas"])) {
    await forEachLegacyBatch(postgres, collection, async (documents, client) => {
      for (const item of documents) {
        await client.query(
          `INSERT INTO translation_metadata(scope,languages_version,last_bumped_at,notes,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (scope) DO UPDATE SET
             languages_version=EXCLUDED.languages_version,last_bumped_at=EXCLUDED.last_bumped_at,
             notes=EXCLUDED.notes,updated_at=EXCLUDED.updated_at`,
          [String(item.scope || "global"), Math.max(1, Math.trunc(number(item.languagesVersion, 1))),
            date(item.lastBumpedAt) || new Date(), item.notes || null,
            date(item.createdAt) || new Date(), date(item.updatedAt) || new Date()],
        );
      }
    });
  }
  for (const collection of await existingLegacyCollections(postgres, ["translationlanguages"])) {
    await forEachLegacyBatch(postgres, collection, async (documents, client) => {
      for (const item of documents) {
        await client.query(
          `INSERT INTO translation_languages(id,code,name,is_enabled,is_default,created_at)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO UPDATE SET code=EXCLUDED.code,
             name=EXCLUDED.name,is_enabled=EXCLUDED.is_enabled,is_default=EXCLUDED.is_default`,
          [id(item._id), String(item.code), String(item.name), bool(item.isEnabled, true),
            bool(item.isDefault), date(item.createdAt) || new Date()],
        );
      }
    });
  }
  for (const collection of await existingLegacyCollections(postgres, ["countrylanguagemappings"])) {
    await forEachLegacyBatch(postgres, collection, async (documents, client) => {
      for (const item of documents) {
        await client.query(
          `INSERT INTO country_language_mappings(id,country_code,country_name,language_code,
             is_active,priority,notes,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO UPDATE SET
             country_code=EXCLUDED.country_code,country_name=EXCLUDED.country_name,
             language_code=EXCLUDED.language_code,is_active=EXCLUDED.is_active,
             priority=EXCLUDED.priority,notes=EXCLUDED.notes,updated_at=EXCLUDED.updated_at`,
          [id(item._id), String(item.countryCode), String(item.countryName), String(item.languageCode),
            bool(item.isActive, true), Math.trunc(number(item.priority)), item.notes || null,
            date(item.createdAt) || new Date(), date(item.updatedAt) || new Date()],
        );
      }
    });
  }
  for (const collection of await existingLegacyCollections(postgres, ["translationkeys", "translation_keys"])) {
    await forEachLegacyBatch(postgres, collection, async (documents, client) => {
      for (const item of documents) {
        await client.query(
          `INSERT INTO translation_keys(id, key, default_value, category, description,
             context, is_plural, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (id) DO UPDATE SET key=EXCLUDED.key,
             default_value=EXCLUDED.default_value, category=EXCLUDED.category,
             description=EXCLUDED.description, context=EXCLUDED.context,
             is_plural=EXCLUDED.is_plural, updated_at=EXCLUDED.updated_at`,
          [id(item._id), String(item.key), String(item.defaultValue || ""),
            String(item.category || "general"), item.description || null,
            item.context || null, bool(item.isPlural), date(item.createdAt) || new Date(),
            date(item.updatedAt) || new Date()],
        );
      }
    });
  }
  for (const collection of await existingLegacyCollections(postgres, ["translations"])) {
    await forEachLegacyBatch(postgres, collection, async (documents, client) => {
      for (const item of documents) {
        const keyId = id(item.keyId);
        const exists = await client.query("SELECT 1 FROM translation_keys WHERE id=$1", [keyId]);
        if (!exists.rowCount) continue;
        await client.query(
          `INSERT INTO translations(id, key_id, language, value, is_completed,
             last_modified, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (id) DO UPDATE SET key_id=EXCLUDED.key_id,
             language=EXCLUDED.language, value=EXCLUDED.value,
             is_completed=EXCLUDED.is_completed, last_modified=EXCLUDED.last_modified`,
          [id(item._id), keyId, String(item.language), String(item.value || ""),
            bool(item.isCompleted), date(item.lastModified) || date(item.updatedAt) || new Date(),
            date(item.createdAt) || new Date()],
        );
      }
    });
  }
  for (const collection of await existingLegacyCollections(postgres, ["urltranslations", "url_translations"])) {
    await forEachLegacyBatch(postgres, collection, async (documents, client) => {
      for (const item of documents) {
        await client.query(
          `INSERT INTO url_translations(id, language_code, english_path,
             translated_path, is_active, notes, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (id) DO UPDATE SET language_code=EXCLUDED.language_code,
             english_path=EXCLUDED.english_path, translated_path=EXCLUDED.translated_path,
             is_active=EXCLUDED.is_active, notes=EXCLUDED.notes,
             updated_at=EXCLUDED.updated_at`,
          [id(item._id), String(item.languageCode), String(item.englishPath),
            String(item.translatedPath), bool(item.isActive, true), item.notes || null,
            date(item.createdAt) || new Date(), date(item.updatedAt) || new Date()],
        );
      }
    });
  }
}

async function normalizeListeningHistory(postgres: MigrationDatabase): Promise<void> {
  const names = await existingLegacyCollections(postgres, [
    "userlisteninghistories", "user_listening_histories", "userlisteninghistory",
  ]);
  for (const collection of names) {
    await forEachLegacyBatch(postgres, collection, async (documents, client) => {
      for (const item of documents) {
        const rawUserId = id(item.userId);
        const userResult = rawUserId
          ? await client.query("SELECT id FROM users WHERE id=$1", [rawUserId])
          : null;
        await client.query(
          `INSERT INTO listening_history(id, user_id, session_id, station_id,
             station_name, country, genre, listen_duration, interaction_type,
             listened_at, device_type, context, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           ON CONFLICT (id) DO UPDATE SET listen_duration=EXCLUDED.listen_duration,
             interaction_type=EXCLUDED.interaction_type,
             listened_at=EXCLUDED.listened_at, context=EXCLUDED.context`,
          [id(item._id), userResult?.rowCount ? rawUserId : null,
            String(item.sessionId || `legacy-${id(item._id)}`), String(item.stationId),
            String(item.stationName || "Unknown station"), item.country || null,
            item.genre || item.tags || null, number(item.listenDuration),
            String(item.interactionType || "play"),
            date(item.listenedAt) || date(item.createdAt) || new Date(),
            item.deviceType || null, JSON.stringify(item), date(item.createdAt) || new Date()],
        );
      }
    });
  }
}

const legacyPaymentEventKeys = `
  SELECT DISTINCT
    CASE WHEN collection_name LIKE '%stripe%' THEN 'stripe'
         WHEN collection_name LIKE '%apple%' THEN 'apple'
         WHEN payload->>'platform'='android' THEN 'google'
         ELSE 'apple' END AS provider,
    CASE WHEN collection_name IN ('iapevents','iap_events') THEN 'audit:' || document_id
         ELSE COALESCE(NULLIF(payload->>'notificationUUID',''),
                       NULLIF(payload->>'stripeSessionId',''),document_id) END AS provider_event_id
  FROM legacy_documents
  WHERE collection_name IN ('iapevents','iap_events','stripe_sale_events','stripesaleevents','applewebhookevents','apple_webhook_events')
`;

export async function normalizePaymentEvents(postgres: MigrationDatabase): Promise<void> {
  const collections = await existingLegacyCollections(postgres, [
    "iapevents", "iap_events", "stripe_sale_events", "stripesaleevents",
    "applewebhookevents", "apple_webhook_events",
  ]);
  for (const collection of collections) {
    await forEachLegacyBatch(postgres, collection, async (documents, client) => {
      for (const item of documents) {
        const eventId = id(item._id);
        const provider = collection.includes("stripe")
          ? "stripe"
          : collection.includes("apple")
            ? "apple"
            : iapAuditProvider(String(item.platform || "unknown"));
        const rawUserId = id(item.userId);
        const userResult = rawUserId
          ? await client.query("SELECT id FROM users WHERE id=$1", [rawUserId])
          : null;
        const providerEventId = collection.includes("iap")
          ? iapAuditEventId(eventId)
          : String(item.notificationUUID || item.stripeSessionId || eventId);
        if (collection.includes("iap")) {
          // Older ETL versions used platform + bare Mongo ID. Replace that
          // precise migrated alias in this transaction, without creating an
          // additional historical audit or touching a runtime-owned receipt.
          await client.query(
            `DELETE FROM payment_events WHERE id=$1 AND origin='mongo_migration'
             AND (provider<>$2 OR provider_event_id<>$3)`,
            [eventId, provider, providerEventId],
          );
        }
        await client.query(
          `INSERT INTO payment_events(id, provider, provider_event_id, user_id,
             event_type, status, plan, amount_minor, currency, occurred_at,
             payload, created_at, origin)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'mongo_migration')
           ON CONFLICT (provider,provider_event_id) DO UPDATE SET
             user_id=COALESCE(EXCLUDED.user_id,payment_events.user_id),
             event_type=EXCLUDED.event_type,status=EXCLUDED.status,
             plan=EXCLUDED.plan,amount_minor=EXCLUDED.amount_minor,
             currency=EXCLUDED.currency,occurred_at=EXCLUDED.occurred_at,
             payload=EXCLUDED.payload
           WHERE payment_events.origin='mongo_migration'`,
          [eventId, provider, providerEventId, userResult?.rowCount ? rawUserId : null,
            String(item.notificationType || item.result || item.plan || "event"),
            String(item.status || item.result || "recorded"), item.plan || null,
            item.amount == null ? null : number(item.amount), item.currency || null,
            date(item.receivedAt) || date(item.createdAt) || date(item.signedDate) || new Date(),
            JSON.stringify(item), date(item.createdAt) || new Date()],
        );
      }
    });
  }
}

export async function pruneMigratedPaymentEvents(client: Pick<pg.PoolClient, "query">): Promise<void> {
  // The persisted ID may be a PostgreSQL UUID even when the Mongo receipt uses
  // an ObjectId. Delivery identity is provider + provider_event_id, never id.
  await client.query(`
    DELETE FROM payment_events e WHERE e.origin='mongo_migration' AND NOT EXISTS (
      SELECT 1 FROM (${legacyPaymentEventKeys}) d
      WHERE d.provider=e.provider AND d.provider_event_id=e.provider_event_id
    )
  `);
}

export async function paymentEventParity(client: Pick<pg.PoolClient, "query">): Promise<{
  expected: number; matched: number; unexpectedMigrated: number;
}> {
  const result = await client.query<{ expected: string; matched: string; unexpected_migrated: string }>(`
    WITH expected_events AS (${legacyPaymentEventKeys})
    SELECT
      (SELECT count(*)::text FROM expected_events) expected,
      (SELECT count(*)::text FROM expected_events d JOIN payment_events e
         ON e.provider=d.provider AND e.provider_event_id=d.provider_event_id) matched,
      (SELECT count(*)::text FROM payment_events e WHERE e.origin='mongo_migration' AND NOT EXISTS (
         SELECT 1 FROM expected_events d WHERE d.provider=e.provider AND d.provider_event_id=e.provider_event_id
       )) unexpected_migrated
  `);
  const row = result.rows[0];
  return { expected: Number(row.expected), matched: Number(row.matched), unexpectedMigrated: Number(row.unexpected_migrated) };
}

async function normalizeAuthTokens(postgres: MigrationDatabase): Promise<void> {
  for (const collection of await existingLegacyCollections(postgres, ["authtokens", "auth_tokens"])) {
    await forEachLegacyBatch(postgres, collection, async (documents, client) => {
      for (const item of documents) {
        const userId = id(item.userId);
        const user = await client.query("SELECT 1 FROM users WHERE id=$1", [userId]);
        if (!user.rowCount || !item.token || !date(item.expiresAt)) continue;
        const values = [id(item._id), String(item.token), userId, item.deviceType || "mobile",
          item.deviceName || null, date(item.expiresAt),
          date(item.lastUsedAt) || date(item.createdAt) || new Date(),
          bool(item.isRevoked), JSON.stringify(item), date(item.createdAt) || new Date()];
        const existing = await client.query<{ id: string }>(
          "SELECT id FROM auth_tokens WHERE id=$1 OR token=$2 LIMIT 1",
          values.slice(0, 2),
        );
        if (existing.rowCount) {
          await client.query(
            `UPDATE auth_tokens SET token=$2,user_id=$3,device_type=$4,device_name=$5,
               expires_at=$6,last_used_at=$7,is_revoked=$8,source=$9
             WHERE id=$1`,
            [existing.rows[0].id, ...values.slice(1, 9)],
          );
        } else {
          await client.query(
            `INSERT INTO auth_tokens(id,token,user_id,device_type,device_name,expires_at,
               last_used_at,is_revoked,source,created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            values,
          );
        }
      }
    });
  }
}

async function normalizeStations(postgres: MigrationDatabase): Promise<void> {
  await forEachLegacyBatch(postgres, "stations", async (documents, client) => {
    for (const station of documents) {
      const stationId = id(station._id);
      await client.query(
        `INSERT INTO stations (
          id, station_uuid, change_uuid, name, slug, slug_aliases, redirect_to_slug,
          url, url_resolved, homepage, favicon, country, country_code, state,
          language, language_codes, tags_raw, codec, bitrate, hls, votes,
          click_count, click_trend, average_rating, total_ratings, last_check_ok,
          last_check_time, latitude, longitude, has_logo, logo_assets, descriptions,
          manual_edit_fields, media_group_id, is_featured, show_in_global_popular,
          no_index, source, created_at, updated_at
        ) VALUES (${Array.from({ length: 40 }, (_, index) => `$${index + 1}`).join(",")})
        ON CONFLICT (id) DO UPDATE SET
          station_uuid=EXCLUDED.station_uuid, name=EXCLUDED.name, slug=EXCLUDED.slug,
          slug_aliases=EXCLUDED.slug_aliases, redirect_to_slug=EXCLUDED.redirect_to_slug,
          url=EXCLUDED.url, url_resolved=EXCLUDED.url_resolved, homepage=EXCLUDED.homepage,
          favicon=EXCLUDED.favicon, country=EXCLUDED.country, country_code=EXCLUDED.country_code,
          state=EXCLUDED.state, language=EXCLUDED.language, language_codes=EXCLUDED.language_codes,
          tags_raw=EXCLUDED.tags_raw, codec=EXCLUDED.codec, bitrate=EXCLUDED.bitrate,
          hls=EXCLUDED.hls, votes=EXCLUDED.votes, click_count=EXCLUDED.click_count,
          click_trend=EXCLUDED.click_trend, average_rating=EXCLUDED.average_rating,
          total_ratings=EXCLUDED.total_ratings, last_check_ok=EXCLUDED.last_check_ok,
          last_check_time=EXCLUDED.last_check_time, latitude=EXCLUDED.latitude,
          longitude=EXCLUDED.longitude, has_logo=EXCLUDED.has_logo,
          logo_assets=EXCLUDED.logo_assets, descriptions=EXCLUDED.descriptions,
          manual_edit_fields=EXCLUDED.manual_edit_fields, media_group_id=EXCLUDED.media_group_id,
          is_featured=EXCLUDED.is_featured,
          show_in_global_popular=EXCLUDED.show_in_global_popular,
          no_index=EXCLUDED.no_index, source=EXCLUDED.source, updated_at=EXCLUDED.updated_at`,
        [
          stationId,
          id(station.stationuuid || station.stationUuid || stationId),
          station.changeUuid || station.changeuuid || null,
          String(station.name || "Unnamed station"),
          station.slug || null,
          Array.isArray(station.slugAliases) ? station.slugAliases.map(String) : [],
          station.redirectToSlug || null,
          String(station.url || station.urlResolved || "about:blank"),
          station.urlResolved || null,
          station.homepage || null,
          station.favicon || null,
          station.country || null,
          station.countryCode || station.countrycode || null,
          station.state || null,
          station.language || null,
          station.languageCodes || null,
          station.tags || null,
          station.codec || null,
          station.bitrate == null ? null : number(station.bitrate),
          bool(station.hls),
          number(station.votes),
          number(station.clickCount ?? station.clickcount),
          number(station.clickTrend),
          number(station.averageRating),
          number(station.totalRatings),
          bool(station.lastCheckOk, true),
          date(station.lastCheckTime),
          station.geoLat == null ? null : number(station.geoLat),
          station.geoLong == null ? null : number(station.geoLong),
          bool(station.hasLogo, Boolean(station.logoAssets?.webp256 || station.logoAssets?.webp96 || station.favicon || station.logo)),
          station.logoAssets ? JSON.stringify(station.logoAssets) : null,
          JSON.stringify(station.descriptions || {}),
          JSON.stringify(station.manualEditFields || {}),
          station.mediaGroupId ? id(station.mediaGroupId) : null,
          bool(station.isFeatured),
          bool(station.showInGlobalPopular),
          bool(station.noIndex),
          JSON.stringify(station),
          date(station.createdAt) || new Date(),
          date(station.updatedAt) || date(station.createdAt) || new Date(),
        ],
      );
      const normalizedGenres = [...new Set(tags(station.tags).map((tag) => genreSlug(tag)).filter(Boolean))];
      await client.query("DELETE FROM station_genres WHERE station_id=$1", [stationId]);
      for (const [position, slug] of normalizedGenres.entries()) {
        await client.query(
          `INSERT INTO station_genres(station_id, genre_slug, position)
           VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [stationId, slug, position],
        );
      }
    }
  });
}

async function normalizeUsers(postgres: MigrationDatabase): Promise<void> {
  await forEachLegacyBatch(postgres, "users", async (documents, client) => {
    for (const user of documents) {
      const userId = id(user._id);
      await client.query(
        `INSERT INTO users (
          id, username, email, password_hash, full_name, slug, bio, avatar, role,
          status, email_verified, is_public_profile, google_id, facebook_id, apple_id,
          preferences, permissions, stats, last_login_at, source, created_at, updated_at
        ) VALUES (${Array.from({ length: 22 }, (_, index) => `$${index + 1}`).join(",")})
        ON CONFLICT (id) DO UPDATE SET
          username=EXCLUDED.username, email=EXCLUDED.email,
          password_hash=EXCLUDED.password_hash, full_name=EXCLUDED.full_name,
          slug=EXCLUDED.slug, bio=EXCLUDED.bio, avatar=EXCLUDED.avatar,
          role=EXCLUDED.role, status=EXCLUDED.status,
          email_verified=EXCLUDED.email_verified,
          is_public_profile=EXCLUDED.is_public_profile, google_id=EXCLUDED.google_id,
          facebook_id=EXCLUDED.facebook_id, apple_id=EXCLUDED.apple_id,
          preferences=EXCLUDED.preferences, permissions=EXCLUDED.permissions,
          stats=EXCLUDED.stats, last_login_at=EXCLUDED.last_login_at,
          source=EXCLUDED.source, updated_at=EXCLUDED.updated_at`,
        [
          userId,
          String(user.username || `legacy-${userId}`),
          String(user.email || `legacy-${userId}@invalid.local`).toLowerCase(),
          user.passwordHash || null,
          String(user.fullName || user.username || "Legacy user"),
          user.slug || null,
          user.bio || null,
          user.avatar || null,
          user.role || "user",
          user.status || "active",
          bool(user.emailVerified),
          bool(user.isPublicProfile),
          user.googleId || null,
          user.facebookId || null,
          user.appleId || null,
          JSON.stringify(user.preferences || {}),
          JSON.stringify(user.permissions || {}),
          JSON.stringify(user.stats || {}),
          date(user.lastLoginAt),
          JSON.stringify(user),
          date(user.createdAt) || new Date(),
          date(user.updatedAt) || date(user.createdAt) || new Date(),
        ],
      );
      if (user.subscription && typeof user.subscription === "object") {
        const subscription = user.subscription;
        await client.query(
          `INSERT INTO subscriptions (
            user_id, plan, platform, status, product_id, transaction_id,
            original_transaction_id, purchase_token, stripe_customer_id,
            stripe_subscription_id, paddle_customer_id, paddle_subscription_id,
            is_active, is_trial, expires_at, renews_at, started_at, cancelled_at,
            last_verified_at, provider_data
          ) VALUES (${Array.from({ length: 20 }, (_, index) => `$${index + 1}`).join(",")})
          ON CONFLICT (user_id) DO UPDATE SET
            plan=EXCLUDED.plan, platform=EXCLUDED.platform, status=EXCLUDED.status,
            product_id=EXCLUDED.product_id, transaction_id=EXCLUDED.transaction_id,
            original_transaction_id=EXCLUDED.original_transaction_id,
            purchase_token=EXCLUDED.purchase_token,
            stripe_customer_id=EXCLUDED.stripe_customer_id,
            stripe_subscription_id=EXCLUDED.stripe_subscription_id,
            paddle_customer_id=EXCLUDED.paddle_customer_id,
            paddle_subscription_id=EXCLUDED.paddle_subscription_id,
            is_active=EXCLUDED.is_active, is_trial=EXCLUDED.is_trial,
            expires_at=EXCLUDED.expires_at, renews_at=EXCLUDED.renews_at,
            started_at=EXCLUDED.started_at, cancelled_at=EXCLUDED.cancelled_at,
            last_verified_at=EXCLUDED.last_verified_at,
            provider_data=EXCLUDED.provider_data`,
          [
            userId,
            subscription.plan || "none",
            subscription.platform || null,
            subscription.subscriptionStatus || (subscription.isActive ? "active" : "inactive"),
            subscription.productId || null,
            subscription.transactionId || null,
            subscription.originalTransactionId || null,
            subscription.purchaseToken || null,
            subscription.stripeCustomerId || null,
            subscription.stripeSubscriptionId || null,
            subscription.paddleCustomerId || null,
            subscription.paddleSubscriptionId || null,
            bool(subscription.isActive),
            bool(subscription.isTrial),
            date(subscription.expiresAt),
            date(subscription.renewsAt),
            date(subscription.startedAt),
            date(subscription.cancelledAt),
            date(subscription.lastVerifiedAt),
            JSON.stringify(subscription),
          ],
        );
      }
    }
  });
}

async function normalizeRelations(postgres: MigrationDatabase): Promise<void> {
  await postgres.query(`
    INSERT INTO user_favorites(user_id, station_id, created_at)
    SELECT f.payload->>'userId', f.payload->>'stationId',
           COALESCE((f.payload->>'createdAt')::timestamptz, now())
    FROM legacy_documents f
    JOIN users u ON u.id=f.payload->>'userId'
    JOIN stations s ON s.id=f.payload->>'stationId'
    WHERE f.collection_name IN ('userfavorites','user_favorites')
    ON CONFLICT (user_id, station_id) DO NOTHING
  `);
  await postgres.query(`
    INSERT INTO user_follows(follower_id, following_id, created_at)
    SELECT f.payload->>'userId', f.payload->>'followingUserId',
           COALESCE((f.payload->>'createdAt')::timestamptz, now())
    FROM legacy_documents f
    JOIN users a ON a.id=f.payload->>'userId'
    JOIN users b ON b.id=f.payload->>'followingUserId'
    WHERE f.collection_name IN ('userfollows','user_follows')
      AND f.payload->>'userId' <> f.payload->>'followingUserId'
    ON CONFLICT (follower_id, following_id) DO NOTHING
  `);
  await postgres.query(`
    INSERT INTO station_ratings(id, station_id, user_id, session_id, ip_address,
      rating, comment, created_at, updated_at)
    SELECT r.document_id, r.payload->>'stationId', NULLIF(r.payload->>'userId',''),
      NULLIF(r.payload->>'sessionId',''), NULLIF(r.payload->>'ipAddress',''),
      (r.payload->>'rating')::integer, r.payload->>'comment',
      COALESCE((r.payload->>'createdAt')::timestamptz, now()),
      COALESCE((r.payload->>'updatedAt')::timestamptz, now())
    FROM legacy_documents r
    JOIN stations s ON s.id=r.payload->>'stationId'
    LEFT JOIN users u ON u.id=r.payload->>'userId'
    WHERE r.collection_name IN ('stationratings','station_ratings')
      AND (r.payload->>'rating') ~ '^[1-5]$'
      AND ((r.payload->>'userId') IS NULL OR u.id IS NOT NULL)
    ON CONFLICT (id) DO UPDATE SET rating=EXCLUDED.rating,
      comment=EXCLUDED.comment, updated_at=EXCLUDED.updated_at
  `);
}

async function normalizeNotifications(postgres: MigrationDatabase): Promise<void> {
  for (const collection of await existingLegacyCollections(postgres, ["usernotifications", "user_notifications"])) {
    await forEachLegacyBatch(postgres, collection, async (documents, client) => {
      for (const item of documents) {
        const userId = id(item.userId);
        if (!userId || !(await client.query("SELECT 1 FROM users WHERE id=$1", [userId])).rowCount) continue;
        const fromUserId = id(item.fromUserId);
        const validFromUserId = fromUserId && (await client.query("SELECT 1 FROM users WHERE id=$1", [fromUserId])).rowCount
          ? fromUserId : null;
        await client.query(
          `INSERT INTO user_notifications(id,user_id,from_user_id,type,title,message,data,is_read,read_at,expires_at,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (id) DO UPDATE SET user_id=EXCLUDED.user_id,from_user_id=EXCLUDED.from_user_id,
             type=EXCLUDED.type,title=EXCLUDED.title,message=EXCLUDED.message,data=EXCLUDED.data,
             is_read=EXCLUDED.is_read,read_at=EXCLUDED.read_at,expires_at=EXCLUDED.expires_at,
             updated_at=EXCLUDED.updated_at`,
          [id(item._id), userId, validFromUserId, String(item.type || "system"),
            String(item.title || "Notification"), String(item.message || ""),
            JSON.stringify(item.data || {}), bool(item.read), date(item.readAt), date(item.expiresAt),
            date(item.createdAt) || new Date(), date(item.updatedAt) || date(item.createdAt) || new Date()],
        );
      }
    });
  }
}

async function normalizeDirectMessages(postgres: MigrationDatabase): Promise<void> {
  for (const collection of await existingLegacyCollections(postgres, ["directmessages", "direct_messages"])) {
    await forEachLegacyBatch(postgres, collection, async (documents, client) => {
      for (const item of documents) {
        const fromUserId = id(item.fromUserId);
        const toUserId = id(item.toUserId);
        if (!fromUserId || !toUserId || fromUserId === toUserId) continue;
        const users = await client.query("SELECT count(*)::int count FROM users WHERE id=ANY($1::text[])", [[fromUserId, toUserId]]);
        if (Number(users.rows[0]?.count || 0) !== 2) continue;
        await client.query(
          `INSERT INTO direct_messages(id,from_user_id,to_user_id,content,message_type,image_url,is_read,read_at,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (id) DO UPDATE SET content=EXCLUDED.content,message_type=EXCLUDED.message_type,
             image_url=EXCLUDED.image_url,is_read=EXCLUDED.is_read,read_at=EXCLUDED.read_at,
             updated_at=EXCLUDED.updated_at`,
          [id(item._id), fromUserId, toUserId, String(item.content || "").slice(0, 2000),
            String(item.messageType || "text"), item.imageUrl || null, bool(item.read),
            date(item.readAt), date(item.createdAt) || new Date(), date(item.updatedAt) || date(item.createdAt) || new Date()],
        );
      }
    });
  }
}

// New native domains deliberately use an explicit allowlist, never a generic
// document-table fallback. The raw BSON mirror remains the fidelity archive.
type NativeMapping = {
  collection: string; table: string; conflict?: string[];
  identity?: { columns: string[]; legacy: string[] };
  ignoreVerify?: string[];
  map: (item: JsonDocument, client: pg.PoolClient) => Promise<JsonDocument> | JsonDocument;
};
const requiredText = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !value) throw new Error("Missing or invalid required field " + field);
  return value;
};
const nullableText = (value: unknown): string | null => value == null ? null : String(value);
const jsonValue = (value: unknown): string | null => value == null ? null : JSON.stringify(value);
const optionalTimestamp = (value: unknown, field: string): Date | null => {
  if (value == null) return null;
  const result = date(value);
  if (!result) throw new Error("Invalid timestamp " + field);
  return result;
};
const requiredTimestamp = (value: unknown, field: string): Date => {
  const result = optionalTimestamp(value, field);
  if (!result) throw new Error("Missing required timestamp " + field);
  return result;
};
// pg accepts Int64 as decimal text. Do not round source Long values through JS
// Number, nor truncate fractions merely to satisfy an integer target column.
export function exactInteger(value: unknown, fallback = 0, bits: 32 | 64 = 64): string {
  const raw = value == null ? String(fallback) : String(value);
  if ((typeof value === "number" && !Number.isSafeInteger(value)) || !/^-?\d+$/.test(raw))
    throw new Error("Migration refused an inexact integer");
  const parsed = BigInt(raw), boundary = 1n << BigInt(bits - 1);
  if (parsed < -boundary || parsed >= boundary) throw new Error("Migration integer exceeds PostgreSQL int" + bits);
  return parsed.toString();
}
const created = (item: JsonDocument) => item.createdAt == null ? {} : { created_at: requiredTimestamp(item.createdAt, "createdAt") };
const updated = (item: JsonDocument) => item.updatedAt == null ? {} : { updated_at: requiredTimestamp(item.updatedAt, "updatedAt") };
const coverageBackfillFields = (item: JsonDocument): JsonDocument => ({
  id: id(item._id), outcome: item.outcome === "running" ? "failed" : requiredText(item.outcome, "outcome"),
  message: requiredText(item.message, "message"), observed_at: requiredTimestamp(item.observedAt, "observedAt"),
  started_at: optionalTimestamp(item.startedAt, "startedAt"), finished_at: optionalTimestamp(item.finishedAt, "finishedAt"),
  duration_ms: item.durationMs == null ? null : number(item.durationMs),
  ...Object.fromEntries([["thresholdDays","threshold_days"],["historicalDayCount","historical_day_count"],["seedDays","seed_days"],
    ["daysSeeded","days_seeded"],["inserted","inserted"],["preserved","preserved"]].map(([source, target]) =>
    [target, item[source] == null ? null : exactInteger(item[source], 0, 32)])),
  error: item.outcome === "running" ? item.error || "Source coverage worker stopped for PostgreSQL migration" : nullableText(item.error),
});
async function nativeOwner(client: pg.PoolClient, value: unknown, table = "users", required = false): Promise<string | null> {
  const owner = id(value);
  if (!owner && !required) return null;
  if (!owner || !(await client.query(`SELECT 1 FROM ${table} WHERE id=$1`, [owner])).rowCount)
    throw new Error("Missing referenced owner in " + table + "; resolve orphan before cutover");
  return owner;
}
const nativeMappings: NativeMapping[] = [
  { collection: "genreslugcleanupruns", table: "genre_slug_cleanup_runs",
    map: item => ({ id: id(item._id), trigger: requiredText(item.trigger,"trigger"),
      status: item.status === "running" ? "failed" : requiredText(item.status,"status"), started_at: requiredTimestamp(item.startedAt,"startedAt"),
      finished_at: optionalTimestamp(item.finishedAt,"finishedAt"), duration_ms: item.durationMs == null ? null : number(item.durationMs),
      scanned: exactInteger(item.scanned,0,32), already_valid: exactInteger(item.alreadyValid,0,32), normalized: exactInteger(item.normalized,0,32),
      marked_undiscoverable: exactInteger(item.markedUndiscoverable,0,32), empty_slug_marked: exactInteger(item.emptySlugMarked,0,32),
      collision_marked: exactInteger(item.collisionMarked,0,32), error_count: exactInteger(item.errorCount,0,32), rewarmed: item.rewarmed === true,
      error_message: item.status === "running" ? item.errorMessage || "Source cleanup worker stopped for PostgreSQL migration" : nullableText(item.errorMessage) }) },
  { collection: "adminpreferences", table: "admin_preferences",
    map: item => ({ id: id(item._id), admin_username: requiredText(item.adminUsername, "adminUsername"), key: requiredText(item.key, "key"),
      value: jsonValue(item.value), ...created(item), ...updated(item) }) },
  { collection: "sharedcomparisonpresets", table: "shared_comparison_presets",
    map: item => ({ id: id(item._id), name: requiredText(item.name, "name"), countries: tags(item.countries),
      owner_username: requiredText(item.ownerUsername, "ownerUsername"), ...created(item), ...updated(item) }) },
  { collection: "semrush_issues", table: "semrush_issues",
    map: item => ({ id: id(item._id), url: requiredText(item.url, "url"), status_code: exactInteger(item.statusCode, 0, 32),
      issue_type: requiredText(item.issueType, "issueType"), issue_description: item.issueDescription || "", priority: requiredText(item.priority, "priority"),
      ...(item.importedAt == null ? {} : { imported_at: requiredTimestamp(item.importedAt, "importedAt") }),
      expires_at: requiredTimestamp(item.expiresAt, "expiresAt") }) },
  { collection: "analyticsevents", table: "analytics_events",
    map: item => ({ id: id(item._id), event: requiredText(item.event, "event"), station_id: nullableText(item.stationId),
      user_id: nullableText(item.userId), session_id: nullableText(item.sessionId), timestamp: requiredTimestamp(item.timestamp, "timestamp"),
      source: JSON.stringify(item), created_at: requiredTimestamp(item.createdAt || item.timestamp, "createdAt") }) },
  { collection: "genremergeauditlogs", table: "genre_merge_audit_logs",
    map: item => ({ id: id(item._id), demoted_genre_id: requiredText(item.demotedGenreId, "demotedGenreId"),
      demoted_genre_name: requiredText(item.demotedGenreName, "demotedGenreName"), demoted_genre_slug: item.demotedGenreSlug || "",
      winner_genre_id: requiredText(item.winnerGenreId, "winnerGenreId"), winner_genre_name: requiredText(item.winnerGenreName, "winnerGenreName"),
      winner_genre_slug: item.winnerGenreSlug || "", target_source: requiredText(item.targetSource, "targetSource"),
      stations_matched: exactInteger(item.stationsMatched, 0, 32), stations_retagged: exactInteger(item.stationsRetagged, 0, 32),
      actor_user_id: nullableText(item.actorUserId), actor_email: nullableText(item.actorEmail), ...created(item) }) },
  { collection: "coveragesnapshots", table: "coverage_snapshots",
    map: item => ({ id: id(item._id), country_code: requiredText(item.countryCode, "countryCode"),
      snapshot_date: requiredTimestamp(item.snapshotDate, "snapshotDate"), total: exactInteger(item.total, 0, 32),
      with_logo: exactInteger(item.withLogo, 0, 32), with_tags: exactInteger(item.withTags, 0, 32),
      logo_coverage_pct: number(item.logoCoveragePct), tag_coverage_pct: number(item.tagCoveragePct), source: nullableText(item.source), ...created(item) }) },
  { collection: "coveragebackfillstatuses", table: "coverage_backfill_status",
    map: item => ({ ...coverageBackfillFields(item), key: item.key || "latest", ...updated(item) }) },
  { collection: "coveragebackfillruns", table: "coverage_backfill_runs",
    map: item => ({ ...coverageBackfillFields(item), ...created(item) }) },
  { collection: "backfillruns", table: "backfill_runs",
    map: item => ({ id: id(item._id), trigger: requiredText(item.trigger, "trigger"),
      status: item.status === "running" ? "failed" : requiredText(item.status, "status"), top_n: exactInteger(item.topN, 5, 32),
      override_country: nullableText(item.overrideCountry), started_at: requiredTimestamp(item.startedAt, "startedAt"),
      finished_at: optionalTimestamp(item.finishedAt, "finishedAt"), duration_ms: item.durationMs == null ? null : number(item.durationMs),
      logos: JSON.stringify(item.logos || []), tags: JSON.stringify(item.tags || []), attempts: JSON.stringify(item.attempts || []),
      error_message: item.status === "running" ? item.errorMessage || "Source backfill worker stopped for PostgreSQL migration" : nullableText(item.errorMessage) }) },
  { collection: "stationdebuglogs", table: "station_debug_logs",
    map: item => ({ id: id(item._id), station_id: requiredText(item.stationId, "stationId"), station_name: requiredText(item.stationName, "stationName"),
      station_url: requiredText(item.stationUrl, "stationUrl"), error_type: requiredText(item.errorType, "errorType"),
      error_message: requiredText(item.errorMessage, "errorMessage"), error_details: JSON.stringify(item.errorDetails || {}),
      station_meta: JSON.stringify(item.stationMeta || {}), user_agent: nullableText(item.userAgent), client_ip: nullableText(item.clientIP),
      ...(item.timestamp == null ? {} : { timestamp: requiredTimestamp(item.timestamp, "timestamp") }), is_resolved: item.isResolved === true,
      resolved_at: optionalTimestamp(item.resolvedAt, "resolvedAt"), resolved_by: nullableText(item.resolvedBy), notes: nullableText(item.notes),
      reporting_users: JSON.stringify(item.reportingUsers || []), unique_user_count: exactInteger(item.uniqueUserCount, 1, 32),
      total_occurrences: exactInteger(item.totalOccurrences, 1, 32), server_logs: tags(item.serverLogs) }) },
  { collection: "advertisements", table: "advertisements",
    map: item => ({ id: id(item._id), title: requiredText(item.title, "title"), image_url: requiredText(item.imageUrl, "imageUrl"),
      alt_text: item.altText ?? "", seo_description: item.seoDescription ?? "", url: requiredText(item.url, "url"),
      position: requiredText(item.position, "position"), is_active: item.isActive !== false, ...created(item), ...updated(item) }) },
  { collection: "footersocialmedias", table: "footer_social_media",
    map: item => ({ id: id(item._id), platform: requiredText(item.platform, "platform"), url: requiredText(item.url, "url"),
      is_active: item.isActive !== false, position: exactInteger(item.position, 0, 32), ...created(item), ...updated(item) }) },
  { collection: "seometadatas", table: "seo_metadata",
    map: item => ({ id: id(item._id), page_type: requiredText(item.pageType, "pageType"), route_key: requiredText(item.routeKey, "routeKey"),
      language: requiredText(item.language, "language"), title: requiredText(item.title, "title"), description: requiredText(item.description, "description"),
      og_title: nullableText(item.ogTitle), og_description: nullableText(item.ogDescription), og_image_url: nullableText(item.ogImageUrl),
      twitter_title: nullableText(item.twitterTitle), twitter_description: nullableText(item.twitterDescription), twitter_image_url: nullableText(item.twitterImageUrl),
      canonical_url: nullableText(item.canonicalUrl), meta_keywords: nullableText(item.metaKeywords), no_index: item.noIndex === true,
      no_follow: item.noFollow === true, source: item.source || "manual", status: item.status || "draft", updated_by: nullableText(item.updatedBy),
      ...created(item), ...updated(item) }) },
  { collection: "applogs", table: "app_logs",
    map: item => ({ id: id(item._id), device_id: requiredText(item.deviceId, "deviceId"), app_version: requiredText(item.appVersion, "appVersion"),
      build_number: item.buildNumber || "", platform: requiredText(item.platform, "platform"), logs: JSON.stringify(item.logs || []),
      api_key_hash: item.apiKeyHash || "", is_car_play_log: item.isCarPlayLog === true, ...created(item) }) },
  { collection: "feedbacks", table: "feedback",
    map: item => ({ id: id(item._id), type: requiredText(item.type, "type"), subject: requiredText(item.subject, "subject"),
      message: requiredText(item.message, "message"), email: nullableText(item.email), user_id: nullableText(item.userId),
      status: item.status || "open", response: nullableText(item.response), ...created(item), ...updated(item) }) },
  { collection: "genre_counts", table: "genre_counts",
    map: item => ({ id: id(item._id), country: requiredText(item.country, "country"), slug: requiredText(item.slug, "slug"),
      count: exactInteger(item.count, 0, 32), ...updated(item) }) },
  { collection: "genrewhitelistoverrides", table: "genre_whitelist_overrides",
    map: item => ({ id: id(item._id), kind: requiredText(item.kind, "kind"), slug: requiredText(item.slug, "slug"),
      canonical: nullableText(item.canonical), notes: item.notes || "", created_by: requiredText(item.createdBy, "createdBy"),
      ...created(item), ...updated({ updatedAt: item.updatedAt || item.createdAt }) }) },
  { collection: "genrestationcountsruns", table: "genre_station_counts_runs",
    map: item => ({ id: id(item._id), trigger: requiredText(item.trigger, "trigger"),
      status: item.status === "running" ? "failed" : requiredText(item.status, "status"),
      started_at: requiredTimestamp(item.startedAt, "startedAt"), finished_at: optionalTimestamp(item.finishedAt, "finishedAt"),
      duration_ms: item.durationMs == null ? null : exactInteger(item.durationMs, 0, 32), total_genres: exactInteger(item.totalGenres, 0, 32),
      updated_slugs: exactInteger(item.updatedSlugs, 0, 32),
      error_message: item.status === "running" ? item.errorMessage || "Source genre-count worker stopped for PostgreSQL migration" : nullableText(item.errorMessage) }) },
  { collection: "genrewhitelistpushlogs", table: "genre_whitelist_push_logs",
    map: item => ({ id: id(item._id), triggered_at: requiredTimestamp(item.triggeredAt, "triggeredAt"),
      completed_at: requiredTimestamp(item.completedAt, "completedAt"), triggered_by: nullableText(item.triggeredBy),
      trigger: requiredText(item.trigger, "trigger"), affected_slugs: tags(item.affectedSlugs),
      sitemap_rebuild: JSON.stringify(item.sitemapRebuild ?? null), indexnow_sitemap: JSON.stringify(item.indexnowSitemap ?? null),
      indexnow_genre_urls: JSON.stringify(item.indexnowGenreUrls ?? null), ...created(item) }) },
  { collection: "indexnowlogs", table: "indexnow_logs",
    map: item => ({ id: id(item._id), timestamp: requiredTimestamp(item.timestamp, "timestamp"), host: requiredText(item.host, "host"),
      url_count: exactInteger(item.urlCount, 0, 32), status: requiredText(item.status, "status"),
      status_code: item.statusCode == null ? null : exactInteger(item.statusCode, 0, 32), trigger: requiredText(item.trigger, "trigger"),
      error_message: nullableText(item.errorMessage), sample_urls: tags(item.sampleUrls), retry_attempt: exactInteger(item.retryAttempt, 0, 32),
      response_time: item.responseTime == null ? null : exactInteger(item.responseTime, 0, 32), run_date: nullableText(item.runDate), ...created(item) }) },
  { collection: "indexnowsubmissionurls", table: "indexnow_submission_urls",
    map: async (item, client) => ({ id: id(item._id), log_id: await nativeOwner(client, item.logId, "indexnow_logs", true),
      timestamp: requiredTimestamp(item.timestamp, "timestamp"), host: requiredText(item.host, "host"), trigger: requiredText(item.trigger, "trigger"),
      urls: tags(item.urls), url_count: exactInteger(item.urlCount, 0, 32), expires_at: requiredTimestamp(item.expiresAt, "expiresAt") }) },
  { collection: "sitemapurlsnapshots", table: "sitemap_url_snapshots",
    map: item => ({ id: id(item._id), type: requiredText(item.type, "type"), language: requiredText(item.language, "language"),
      chunk: exactInteger(item.chunk, 0, 32), urls: tags(item.urls), url_count: exactInteger(item.urlCount, 0, 32),
      ...(item.generatedAt == null ? {} : { generated_at: requiredTimestamp(item.generatedAt, "generatedAt") }), ...updated(item) }) },
  { collection: "sitemapmanifests", table: "sitemap_manifests",
    map: async (item, client) => {
      let status = requiredText(item.status, "status");
      if (status === "building") status = "failed";
      if (status === "active") {
        const latest = await client.query(`SELECT document_id FROM legacy_documents d WHERE collection_name='sitemapmanifests'
          AND payload->>'type'=$1 AND payload->>'language'=$2 AND payload->>'status'='active'
          ORDER BY (payload->>'generatedAt')::timestamptz DESC NULLS LAST,document_id DESC LIMIT 1`, [item.type, item.language]);
        if (latest.rows[0]?.document_id !== id(item._id)) status = "superseded";
      }
      return { id: id(item._id), type: requiredText(item.type, "type"), language: requiredText(item.language, "language"),
        version: requiredText(item.version, "version"), status, qualified_languages_hash: requiredText(item.qualifiedLanguagesHash, "qualifiedLanguagesHash"),
        qualified_languages: tags(item.qualifiedLanguages), chunks: JSON.stringify((item.chunks || []).map((chunk: JsonDocument) => ({
          ...chunk, ...(chunk.stationIds ? { stationIds: chunk.stationIds.map(id) } : {}),
        }))), total_urls: exactInteger(item.totalUrls, 0, 32), chunk_count: exactInteger(item.chunkCount, 0, 32),
        ...(item.generatedAt == null ? {} : { generated_at: requiredTimestamp(item.generatedAt, "generatedAt") }),
        expires_at: requiredTimestamp(item.expiresAt, "expiresAt"),
        error_message: item.status === "building" ? item.errorMessage || "Source manifest builder stopped for PostgreSQL migration" : nullableText(item.errorMessage) };
    } },
  { collection: "gscurlinspections", table: "gsc_url_inspections",
    map: item => ({ id: id(item._id), url: requiredText(item.url, "url"), language: requiredText(item.language, "language"),
      url_group: requiredText(item.group, "group"), state: item.state || "pending", coverage_state: nullableText(item.coverageState),
      verdict: nullableText(item.verdict), robots_txt_state: nullableText(item.robotsTxtState), indexing_state: nullableText(item.indexingState),
      page_fetch_state: nullableText(item.pageFetchState), last_crawl_time: optionalTimestamp(item.lastCrawlTime, "lastCrawlTime"),
      google_canonical: nullableText(item.googleCanonical), user_canonical: nullableText(item.userCanonical),
      inspection_result_link: nullableText(item.inspectionResultLink), last_inspected_at: optionalTimestamp(item.lastInspectedAt, "lastInspectedAt"),
      last_error: nullableText(item.lastError), error_count: exactInteger(item.errorCount, 0, 32),
      ...(item.discoveredAt == null ? {} : { discovered_at: requiredTimestamp(item.discoveredAt, "discoveredAt") }), ...updated(item),
      not_indexed_since: optionalTimestamp(item.notIndexedSince, "notIndexedSince"), last_resubmit_at: optionalTimestamp(item.lastResubmitAt, "lastResubmitAt"),
      last_resubmit_status: nullableText(item.lastResubmitStatus), last_resubmit_error: nullableText(item.lastResubmitError),
      resubmit_count: exactInteger(item.resubmitCount, 0, 32) }) },
  { collection: "gscindexingsnapshots", table: "gsc_indexing_snapshots",
    map: item => ({ id: id(item._id), date: requiredTimestamp(item.date, "date"), language: requiredText(item.language, "language"),
      url_group: requiredText(item.group, "group"), total: exactInteger(item.total, 0, 32), indexed: exactInteger(item.indexed, 0, 32),
      crawled_not_indexed: exactInteger(item.crawledNotIndexed, 0, 32), discovered_not_indexed: exactInteger(item.discoveredNotIndexed, 0, 32),
      excluded: exactInteger(item.excluded, 0, 32), error: exactInteger(item.error, 0, 32), pending: exactInteger(item.pending, 0, 32),
      unknown: exactInteger(item.unknown, 0, 32), ...created(item) }) },
  { collection: "gsc_oauth_tokens", table: "gsc_oauth_tokens",
    map: item => ({ id: id(item._id), refresh_token: requiredText(item.refreshToken, "refreshToken"), access_token: nullableText(item.accessToken),
      expiry_date: item.expiryDate == null ? null : exactInteger(item.expiryDate),
      scope: item.scope || "https://www.googleapis.com/auth/webmasters.readonly", connected_email: nullableText(item.connectedEmail), ...created(item), ...updated(item) }) },
  { collection: "visitor_sessions", table: "visitor_sessions",
    map: item => ({ id: id(item._id), ip_address: requiredText(item.ipAddress, "ipAddress"),
      ...(item.lastActiveDate == null ? {} : { last_active_date: requiredTimestamp(item.lastActiveDate, "lastActiveDate") }),
      ...created(item), user_agent: nullableText(item.userAgent), visit_count: exactInteger(item.visitCount, 1) }) },
  { collection: "app_state", table: "runtime_app_state", conflict: ["key"], identity: { columns: ["key"], legacy: ["d.document_id"] },
    map: item => ({ key: id(item._id), value: JSON.stringify(item), ...updated(item) }) },
  { collection: "bulkdescriptionjobs", table: "bulk_description_jobs",
    map: item => ({ id: id(item._id), job_id: requiredText(item.jobId, "jobId"), filter_by_country: nullableText(item.filterByCountry),
      status: item.status === "running" ? "paused" : item.status || "paused", total_stations: exactInteger(item.totalStations, 0, 32),
      processed_stations: exactInteger(item.processedStations, 0, 32), success_count: exactInteger(item.successCount, 0, 32),
      failed_count: exactInteger(item.failedCount, 0, 32), skipped_count: exactInteger(item.skippedCount, 0, 32),
      last_processed_station_id: nullableText(item.lastProcessedStationId), last_processed_skip: exactInteger(item.lastProcessedSkip, 0, 32),
      error_message: nullableText(item.errorMessage), ...created(item), ...updated(item) }) },
  { collection: "userprofiles", table: "recommendation_profiles",
    map: item => ({ id: id(item._id), session_id: requiredText(item.sessionId, "sessionId"), user_id: nullableText(item.userId),
      preferred_genres: JSON.stringify(item.preferredGenres || []), preferred_countries: JSON.stringify(item.preferredCountries || []),
      preferred_languages: JSON.stringify(item.preferredLanguages || []), average_listen_duration: number(item.averageListenDuration),
      peak_listening_hours: (item.peakListeningHours || []).map((hour: unknown) => exactInteger(hour, 0, 32)),
      skip_rate: number(item.skipRate), total_stations_listened: exactInteger(item.totalStationsListened, 0, 32),
      unique_stations_count: exactInteger(item.uniqueStationsCount, 0, 32), favorite_stations_count: exactInteger(item.favoriteStationsCount, 0, 32),
      last_listened_at: optionalTimestamp(item.lastListenedAt, "lastListenedAt"), profile_strength: number(item.profileStrength),
      source: JSON.stringify(item), ...created(item), ...updated(item) }) },
  { collection: "usermusicprofiles", table: "user_music_profiles",
    map: item => ({ id: id(item._id), user_id: requiredText(item.userId, "userId"), genres: JSON.stringify(item.genres || []),
      countries: JSON.stringify(item.countries || []), languages: JSON.stringify(item.languages || []),
      listening_habits: JSON.stringify(item.listeningHabits || {}), mood: JSON.stringify(item.mood || {}),
      discovery: JSON.stringify(item.discovery || {}), source: JSON.stringify(item), ...created(item), ...updated(item) }) },
  { collection: "stationsimilarities", table: "station_similarities",
    map: item => ({ id: id(item._id), station_id_1: requiredText(item.stationId1, "stationId1"), station_id_2: requiredText(item.stationId2, "stationId2"),
      similarity_score: number(item.similarityScore), confidence: number(item.confidence), calculation_type: requiredText(item.calculationType, "calculationType"),
      features: JSON.stringify(item.features || {}), last_calculated: requiredTimestamp(item.lastCalculated, "lastCalculated"),
      sample_size: exactInteger(item.sampleSize, 0, 32), source: JSON.stringify(item), ...created(item), ...updated(item) }) },
  { collection: "recommendations", table: "recommendation_events",
    map: item => ({ id: id(item._id), user_id: nullableText(item.userId), station_id: requiredText(item.stationId, "stationId"),
      station_name: requiredText(item.stationName, "stationName"), recommendation_type: requiredText(item.recommendationType, "recommendationType"),
      confidence: number(item.confidence), reason: requiredText(item.reason, "reason"), metadata: JSON.stringify(item.metadata || {}),
      ...(item.generated == null ? {} : { generated: requiredTimestamp(item.generated, "generated") }),
      presented: optionalTimestamp(item.presented, "presented"), clicked: optionalTimestamp(item.clicked, "clicked"),
      liked: optionalTimestamp(item.liked, "liked"), dismissed: optionalTimestamp(item.dismissed, "dismissed"),
      feedback: nullableText(item.feedback), source: JSON.stringify(item) }) },
  { collection: "listeningsessions", table: "listening_sessions",
    map: item => ({ id: id(item._id), user_id: nullableText(item.userId), session_id: requiredText(item.sessionId, "sessionId"),
      station_id: requiredText(item.stationId, "stationId"), station_name: requiredText(item.stationName, "stationName"),
      genre: item.genre || "", country: item.country || "", language: item.language || "",
      ...(item.startTime == null ? {} : { start_time: requiredTimestamp(item.startTime, "startTime") }),
      end_time: optionalTimestamp(item.endTime, "endTime"), duration: number(item.duration), skip_reason: nullableText(item.skipReason),
      liked: bool(item.liked), mood: nullableText(item.mood), context: nullableText(item.context),
      device_type: nullableText(item.deviceType), location: jsonValue(item.location), source: JSON.stringify(item) }) },
  { collection: "seoqualifiedlanguageslkgs", table: "seo_qualified_languages_lkg", ignoreVerify: ["updated_at"],
    map: item => ({ id: id(item._id), key: requiredText(item.key, "key"), languages: tags(item.languages),
      hash: requiredText(item.hash, "hash"), source: requiredText(item.source, "source"),
      computed_at: requiredTimestamp(item.computedAt, "computedAt"), expires_at: requiredTimestamp(item.expiresAt, "expiresAt"),
      ...created(item), ...updated(item) }) },
  { collection: "adminsettings", table: "admin_settings", ignoreVerify: ["updated_at"],
    map: item => ({ id: id(item._id), key: requiredText(item.key, "key"), value: jsonValue(item.value),
      updated_by: nullableText(item.updatedBy), ...created(item), ...updated(item) }) },
  { collection: "adminsettinghistories", table: "admin_setting_history",
    map: item => ({ id: id(item._id), key: requiredText(item.key, "key"), action: requiredText(item.action, "action"),
      previous_value: jsonValue(item.previousValue), new_value: jsonValue(item.newValue), changed_by: nullableText(item.changedBy),
      ...(item.changedAt == null ? {} : { changed_at: requiredTimestamp(item.changedAt, "changedAt") }) }) },
  ...(["login", "subscription"] as const).map(kind => ({
    collection: kind === "login" ? "tvlogincodes" : "tvsubscriptioncodes", table: "tv_device_codes",
    map: async (item: JsonDocument, client: pg.PoolClient) => {
      const expiresAt = requiredTimestamp(item.expiresAt, "expiresAt");
      return { id: id(item._id), kind, code: requiredText(item.code, "code"), device_id: requiredText(item.deviceId, "deviceId"),
        platform: item.platform || "other", status: expiresAt.getTime() <= Date.now() ? "expired" : item.status || "pending",
        user_id: await nativeOwner(client, item.userId), token: kind === "login" ? nullableText(item.token) : null,
        plan: nullableText(item.plan), stripe_session_id: nullableText(item.stripeSessionId), expires_at: expiresAt,
        completed_at: optionalTimestamp(kind === "login" ? item.activatedAt : item.completedAt, "completedAt"), ...created(item) };
    },
  })),
  { collection: "userdevices", table: "user_devices",
    map: async (item, client) => ({ id: id(item._id), user_id: await nativeOwner(client, item.userId, "users", true),
      device_id: requiredText(item.deviceId, "deviceId"), device_name: requiredText(item.deviceName, "deviceName"),
      platform: item.platform || "other", is_active: bool(item.isActive, true),
      ...(item.pairedAt == null ? {} : { paired_at: requiredTimestamp(item.pairedAt, "pairedAt") }),
      ...(item.lastSeenAt == null ? {} : { last_seen_at: requiredTimestamp(item.lastSeenAt, "lastSeenAt") }) }) },
  { collection: "castsessions", table: "cast_sessions",
    map: async (item, client) => {
      const expiresAt = requiredTimestamp(item.expiresAt, "expiresAt");
      return { id: id(item._id), session_id: requiredText(item.sessionId, "sessionId"), pairing_code: nullableText(item.pairingCode),
        user_id: await nativeOwner(client, item.userId, "users", true), mobile_device_id: nullableText(item.mobileDeviceId),
        tv_device_id: nullableText(item.tvDeviceId), status: expiresAt.getTime() <= Date.now() ? "expired" : item.status || "waiting_for_pair",
        current_station: jsonValue(item.currentStation), is_playing: bool(item.isPlaying), ...created(item),
        paired_at: optionalTimestamp(item.pairedAt, "pairedAt"), expires_at: expiresAt,
        ...(item.lastActivityAt == null ? {} : { last_activity_at: requiredTimestamp(item.lastActivityAt, "lastActivityAt") }) };
    } },
  { collection: "castcommands", table: "cast_commands",
    map: async (item, client) => {
      if (!item.deviceId && !bool(item.consumed) && (!date(item.createdAt) || date(item.createdAt)!.getTime() > Date.now() - 86400000))
        throw new Error("Live unconsumed cast command has no target device; resolve before cutover");
      return { id: id(item._id), user_id: await nativeOwner(client, item.userId, "users", true),
        // Consumed/expired broadcasts are historical only; never invent a recipient.
        device_id: item.deviceId == null ? "" : String(item.deviceId), type: requiredText(item.type, "type"),
        station: jsonValue(item.station), timestamp: exactInteger(item.timestamp), consumed: bool(item.consumed), ...created(item) };
    } },
  { collection: "castnowplayings", table: "cast_now_playing",
    map: async (item, client) => ({ id: id(item._id), user_id: await nativeOwner(client, item.userId, "users", true),
      device_id: requiredText(item.deviceId, "deviceId"), platform: item.platform || "browser", station_name: nullableText(item.stationName),
      title: nullableText(item.title), artist: nullableText(item.artist), is_playing: bool(item.isPlaying), ...updated(item) }) },
  { collection: "pushtokens", table: "push_tokens",
    map: async (item, client) => ({ id: id(item._id), token: requiredText(item.token, "token"),
      user_id: await nativeOwner(client, item.userId), platform: requiredText(item.platform, "platform"), token_type: item.tokenType || "expo",
      device_name: item.deviceName || "", country: item.country || "", language: item.language || "",
      is_active: bool(item.isActive, true), ...created(item), ...updated(item) }) },
  { collection: "tv_version_config", table: "tv_version_config", conflict: ["singleton"],
    map: item => ({ singleton: true, id: id(item._id), latest: jsonValue(item.latest || {}), minimum: jsonValue(item.minimum || {}),
      release_notes: jsonValue(item.releaseNotes || {}), store_url: jsonValue(item.storeUrl || {}), ...updated(item) }) },
  { collection: "tv_telemetry", table: "tv_telemetry",
    map: item => ({ id: id(item._id), ...(item.ts == null ? {} : { ts: requiredTimestamp(item.ts, "ts") }),
      src: item.src || "remote", v: nullableText(item.v), plat: item.plat || "other", app: nullableText(item.app),
      did: nullableText(item.did), country: nullableText(item.country) }) },
  { collection: "tv_telemetry_daily", table: "tv_telemetry_daily", conflict: ["day", "plat", "src", "v"], ignoreVerify: ["id"],
    identity: { columns: ["day", "plat", "src", "v"], legacy: ["d.payload->>'day'", "COALESCE(NULLIF(d.payload->>'plat',''),'other')",
      "COALESCE(NULLIF(d.payload->>'src',''),'remote')", "COALESCE(d.payload->>'v','')"] },
    map: item => ({ id: id(item._id), day: requiredText(item.day, "day"), plat: item.plat || "other",
      src: item.src || "remote", v: item.v || "", count: exactInteger(item.count), unique_dids: tags(item.uniqueDids), ...updated(item) }) },
  { collection: "stripe_subscription_plans", table: "stripe_subscription_plans",
    map: item => ({ id: id(item._id), plan_id: requiredText(item.planId, "planId"), stripe_price_id: item.stripePriceId || "",
      paddle_price_id: nullableText(item.paddlePriceId), label: item.label || "", description: item.description || "",
      currency: item.currency || "usd", amount: exactInteger(item.amount, 0, 32), is_active: bool(item.isActive, true), ...updated(item) }) },
  { collection: "apiusers", table: "api_developer_users",
    map: item => ({ id: id(item._id), email: requiredText(item.email, "email").trim().toLowerCase(),
      password_hash: requiredText(item.passwordHash, "passwordHash"), name: requiredText(item.name, "name"),
      company: nullableText(item.company), website: nullableText(item.website), plan: item.plan || "free",
      status: item.status || "active", source: JSON.stringify(item), ...created(item), last_login_at: optionalTimestamp(item.lastLoginAt, "lastLoginAt") }) },
  { collection: "apikeys", table: "api_keys",
    map: async (item, client) => ({ id: id(item._id), key_hash: requiredText(item.keyHash, "keyHash"),
      key_prefix: requiredText(item.keyPrefix, "keyPrefix"), name: requiredText(item.name, "name"),
      email: requiredText(item.email, "email").trim().toLowerCase(), app_name: nullableText(item.appName), app_url: nullableText(item.appUrl),
      usage_reason: nullableText(item.usageReason), user_id: await nativeOwner(client, item.userId, "api_developer_users"),
      plan: item.plan || "free", status: item.status || "active", rate_limit_per_min: exactInteger(item.rateLimitPerMin, 60, 32),
      daily_quota: exactInteger(item.dailyQuota, 1000), monthly_quota: exactInteger(item.monthlyQuota, 10000),
      today_count: exactInteger(item.usage?.todayCount), month_count: exactInteger(item.usage?.monthCount),
      total_count: exactInteger(item.usage?.totalCount), last_reset_day: nullableText(item.usage?.lastResetDay),
      last_reset_month: nullableText(item.usage?.lastResetMonth), last_used_at: optionalTimestamp(item.usage?.lastUsedAt, "lastUsedAt"),
      source: JSON.stringify(item), ...created(item), expires_at: optionalTimestamp(item.expiresAt, "expiresAt") }) },
  { collection: "demousages", table: "api_demo_usage",
    map: item => ({ id: id(item._id), ip_hash: requiredText(item.ipHash, "ipHash"), demo_key_hash: requiredText(item.demoKeyHash, "demoKeyHash"),
      ...(item.lastIssuedAt == null ? {} : { last_issued_at: requiredTimestamp(item.lastIssuedAt, "lastIssuedAt") }),
      expires_at: requiredTimestamp(item.expiresAt, "expiresAt"), usage_count: exactInteger(item.usageCount), source: JSON.stringify(item) }) },
  { collection: "auth_event_logs", table: "auth_event_logs",
    map: item => ({ id: id(item._id), ...(item.ts == null ? {} : { ts: requiredTimestamp(item.ts, "ts") }),
      method: requiredText(item.method, "method"), event: requiredText(item.event, "event"), ok: bool(item.ok),
      email: nullableText(item.email), user_id: nullableText(item.userId), ip: nullableText(item.ip),
      user_agent: nullableText(item.userAgent), message: nullableText(item.message), detail: jsonValue(item.detail), source: JSON.stringify(item) }) },
  { collection: "synclogs", table: "catalog_sync_runs",
    map: item => {
      const interrupted = item.status === "running";
      const counters = Object.fromEntries(Object.entries(item).filter(([key]) => /^stations[A-Z]/.test(key)).map(([key, value]) => [key, number(value)]));
      return { id: id(item._id), sync_type: requiredText(item.syncType, "syncType"), status: interrupted ? "failed" : requiredText(item.status, "status"),
        counters: JSON.stringify(counters), error: interrupted ? (item.errorMessage || "Source sync worker stopped for PostgreSQL migration") : nullableText(item.errorMessage),
        started_at: requiredTimestamp(item.startedAt, "startedAt"), completed_at: optionalTimestamp(item.completedAt, "completedAt"), cancel_requested: false };
    } },
  { collection: "blacklistedstations", table: "station_blacklist",
    map: item => ({ id: id(item._id), station_uuid: nullableText(item.stationUuid), url: requiredText(item.url, "url"),
      name: requiredText(item.name, "name"), reason: nullableText(item.reason), deleted_by: nullableText(item.deletedBy),
      ...(item.deletedAt == null ? {} : { deleted_at: requiredTimestamp(item.deletedAt, "deletedAt") }), source: JSON.stringify(item), ...created(item) }) },
];

export const nativeMigrationCollections = nativeMappings.map(({ collection, table }) => ({ collection, table }));
const identifier = (value: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error("Invalid internal migration identifier");
  return '"' + value + '"';
};
async function mappedNativeDocument(mapping: NativeMapping, item: JsonDocument, client: pg.PoolClient): Promise<JsonDocument> {
  try {
    if (!id(item._id)) throw new Error("Missing document ID");
    return await mapping.map(item, client);
  } catch (error) {
    // Do not echo source documents, passwords, receipts or tokens on failure.
    throw new Error(`Normalization failed for ${mapping.collection}/${id(item._id)}: ${error instanceof Error ? error.message : "invalid document"}`);
  }
}

export async function normalizeNativeDomains(postgres: MigrationDatabase): Promise<void> {
  for (const mapping of nativeMappings) {
    if (mapping.table === "sitemap_manifests") {
      // Demote only source-backed rows first; source-active overlap was legal
      // in Mongo. A fresh target then installs the same newest winner as readers.
      await postgres.query(`UPDATE sitemap_manifests SET status=CASE WHEN status='building' THEN 'failed' ELSE 'superseded' END
        WHERE status IN ('building','active') AND id IN (SELECT document_id FROM legacy_documents WHERE collection_name='sitemapmanifests')`);
    }
    if (mapping.table === "tv_version_config") {
      const count = await postgres.query("SELECT count(*)::int count FROM legacy_documents WHERE collection_name=$1", [mapping.collection]);
      if (count.rows[0].count > 1) throw new Error("Multiple TV version-config documents; select the authoritative configuration before cutover");
    }
    await forEachLegacyBatch(postgres, mapping.collection, async (documents, client) => {
      for (const item of documents) {
        const row = await mappedNativeDocument(mapping, item, client);
        const columns = Object.keys(row), conflict = mapping.conflict || ["id"];
        await client.query(
          `INSERT INTO ${identifier(mapping.table)} (${columns.map(identifier).join(",")})
           VALUES (${columns.map((_, index) => "$" + (index + 1)).join(",")})
           ON CONFLICT (${conflict.map(identifier).join(",")}) DO UPDATE SET ${columns.filter(column => !conflict.includes(column) && !(mapping.identity && column === "id"))
            .map(column => identifier(column) + "=EXCLUDED." + identifier(column)).join(",")}`,
          columns.map(column => row[column]),
        );
      }
    });
  }
}

export async function verifyNativeDomains(postgres: MigrationDatabase): Promise<void> {
  const tables = [...new Set(nativeMappings.map(mapping => mapping.table))];
  for (const table of tables) {
    const mappings = nativeMappings.filter(mapping => mapping.table === table);
    const collections = mappings.map(mapping => mapping.collection);
    const identity = mappings[0].identity || { columns: ["id"], legacy: ["d.document_id"] };
    const expectedIdentity = identity.legacy.join(","), actualIdentity = identity.columns.map(identifier).join(",");
    const difference = await postgres.query(`
      SELECT count(*)::int count FROM (
        (SELECT ${expectedIdentity} FROM legacy_documents d WHERE collection_name=ANY($1::text[]) EXCEPT SELECT ${actualIdentity} FROM ${identifier(table)})
        UNION ALL
        (SELECT ${actualIdentity} FROM ${identifier(table)} EXCEPT SELECT ${expectedIdentity} FROM legacy_documents d WHERE collection_name=ANY($1::text[]))
      ) difference`, [collections]);
    if (difference.rows[0].count) throw new Error("Native normalized identity mismatch: " + table);
  }
  for (const mapping of nativeMappings) {
    await forEachLegacyBatch(postgres, mapping.collection, async (documents, client) => {
      for (const item of documents) {
        const row = await mappedNativeDocument(mapping, item, client);
        const columns = Object.keys(row).filter(column => !mapping.ignoreVerify?.includes(column));
        const result = await client.query(`SELECT 1 FROM ${identifier(mapping.table)} WHERE ${columns
          .map((column, index) => identifier(column) + " IS NOT DISTINCT FROM $" + (index + 1)).join(" AND ")}`, columns.map(column => row[column]));
        if (!result.rowCount) throw new Error(`Native normalized content mismatch: ${mapping.table}/${id(item._id)}`);
      }
    });
  }
}

export async function pruneNativeDomains(client: Pick<pg.PoolClient, "query">): Promise<void> {
  // Never delete portal sessions, cast outbox/presence, or payment receipts.
  // Deleting an unmatched owner would CASCADE through runtime-only rows, too.
  const sessionOwners = await client.query(`SELECT 1 FROM api_developer_sessions s WHERE NOT EXISTS (
    SELECT 1 FROM legacy_documents d WHERE d.collection_name='apiusers' AND d.document_id=s.user_id
  ) LIMIT 1`);
  if (sessionOwners.rowCount) throw new Error("Pruning refused: deleting an API developer would cascade into runtime-only sessions");
  const tables = [...new Set(nativeMappings.map(mapping => mapping.table))].reverse();
  // Reversal deletes keys before developer users and avoids FK surprises.
  for (const table of tables) {
    const mappings = nativeMappings.filter(mapping => mapping.table === table);
    const collections = mappings.map(mapping => mapping.collection);
    const identity = mappings[0].identity || { columns: ["id"], legacy: ["d.document_id"] };
    await client.query(`DELETE FROM ${identifier(table)} t WHERE NOT EXISTS (
      SELECT 1 FROM legacy_documents d WHERE d.collection_name=ANY($1::text[]) AND ${identity.columns
        .map((column, index) => identity.legacy[index] + "=t." + identifier(column)).join(" AND ")}
    )`, [collections]);
  }
}

export async function normalize(postgres: MigrationDatabase): Promise<void> {
  console.log("[normalize] countries, languages and genres");
  await normalizeTaxonomy(postgres);
  console.log("[normalize] stations");
  await normalizeStations(postgres);
  console.log("[normalize] users and subscriptions");
  await normalizeUsers(postgres);
  console.log("[normalize] favorites, follows and ratings");
  await normalizeRelations(postgres);
  console.log("[normalize] user notifications");
  await normalizeNotifications(postgres);
  console.log("[normalize] direct messages");
  await normalizeDirectMessages(postgres);
  console.log("[normalize] translations and localized URLs");
  await normalizeTranslations(postgres);
  console.log("[normalize] listening history");
  await normalizeListeningHistory(postgres);
  console.log("[normalize] payment and webhook events");
  await normalizePaymentEvents(postgres);
  console.log("[normalize] authentication tokens");
  await normalizeAuthTokens(postgres);
  console.log("[normalize] native localization, devices/cast, API access and catalog state");
  await normalizeNativeDomains(postgres);
  if (process.env.MIGRATION_PRUNE === "true") await pruneNormalizedData(postgres);
}

export async function pruneNormalizedData(postgres: MigrationDatabase): Promise<void> {
  if (process.env.DATABASE_MAINTENANCE_READ_ONLY !== "true") {
    throw new Error("Normalized pruning requires DATABASE_MAINTENANCE_READ_ONLY=true");
  }
  if ((process.env.MIGRATION_COLLECTIONS || "").trim()) {
    throw new Error("MIGRATION_PRUNE cannot be combined with MIGRATION_COLLECTIONS");
  }
  const client = await postgres.connect();
  try {
    await client.query("BEGIN");
    await assertNoPostgresWriteAuthority(client);
    const runtimeOwners = await client.query(`SELECT 1 FROM cast_connections s
      WHERE NOT EXISTS (SELECT 1 FROM legacy_documents d WHERE d.collection_name='users' AND d.document_id=s.user_id) LIMIT 1`);
    if (runtimeOwners.rowCount) throw new Error("Pruning refused: deleting a user would cascade into runtime-only sessions/presence");
    await pruneNativeDomains(client);
    await client.query(`
      DELETE FROM user_favorites f WHERE NOT EXISTS (
        SELECT 1 FROM legacy_documents d
        WHERE d.collection_name IN ('userfavorites','user_favorites')
          AND d.payload->>'userId'=f.user_id AND d.payload->>'stationId'=f.station_id
      );
      DELETE FROM user_follows f WHERE NOT EXISTS (
        SELECT 1 FROM legacy_documents d
        WHERE d.collection_name IN ('userfollows','user_follows')
          AND d.payload->>'userId'=f.follower_id AND d.payload->>'followingUserId'=f.following_id
      );
      DELETE FROM station_ratings r WHERE NOT EXISTS (
        SELECT 1 FROM legacy_documents d
        WHERE d.collection_name IN ('stationratings','station_ratings') AND d.document_id=r.id
      );
      DELETE FROM listening_history h WHERE NOT EXISTS (
        SELECT 1 FROM legacy_documents d
        WHERE d.collection_name IN ('userlisteninghistories','user_listening_histories','userlisteninghistory')
          AND d.document_id=h.id
      );
      DELETE FROM user_notifications n WHERE NOT EXISTS (
        SELECT 1 FROM legacy_documents d
        WHERE d.collection_name IN ('usernotifications','user_notifications') AND d.document_id=n.id
      );
      DELETE FROM direct_messages m WHERE NOT EXISTS (
        SELECT 1 FROM legacy_documents d
        WHERE d.collection_name IN ('directmessages','direct_messages') AND d.document_id=m.id
      );
      DELETE FROM auth_tokens t WHERE NOT EXISTS (
        SELECT 1 FROM legacy_documents d
        WHERE d.collection_name IN ('authtokens','auth_tokens') AND d.payload->>'token'=t.token
      );
      DELETE FROM translations t WHERE NOT EXISTS (
        SELECT 1 FROM legacy_documents d WHERE d.collection_name='translations' AND d.document_id=t.id
      );
      DELETE FROM url_translations t WHERE NOT EXISTS (
        SELECT 1 FROM legacy_documents d
        WHERE d.collection_name IN ('urltranslations','url_translations') AND d.document_id=t.id
      );
      DELETE FROM translation_keys t WHERE NOT EXISTS (
        SELECT 1 FROM legacy_documents d
        WHERE d.collection_name IN ('translationkeys','translation_keys') AND d.document_id=t.id
      );
      DELETE FROM translation_metadata t WHERE NOT EXISTS (
        SELECT 1 FROM legacy_documents d WHERE d.collection_name='translationmetadatas'
          AND COALESCE(NULLIF(d.payload->>'scope',''),'global')=t.scope
      );
      DELETE FROM translation_languages t WHERE NOT EXISTS (
        SELECT 1 FROM legacy_documents d WHERE d.collection_name='translationlanguages' AND d.document_id=t.id
      );
      DELETE FROM country_language_mappings t WHERE NOT EXISTS (
        SELECT 1 FROM legacy_documents d WHERE d.collection_name='countrylanguagemappings' AND d.document_id=t.id
      );
      DELETE FROM country_language_mapping_audit t WHERE NOT EXISTS (
        SELECT 1 FROM legacy_documents d WHERE d.collection_name='clearedoverridesauditlogs' AND d.document_id=t.id
      );
      DELETE FROM subscriptions s WHERE NOT EXISTS (
        SELECT 1 FROM legacy_documents d WHERE d.collection_name='users'
          AND d.document_id=s.user_id AND jsonb_typeof(d.payload->'subscription')='object'
      );
      DELETE FROM stations s WHERE NOT EXISTS (
        SELECT 1 FROM legacy_documents d WHERE d.collection_name='stations' AND d.document_id=s.id
      );
      DELETE FROM users u WHERE NOT EXISTS (
        SELECT 1 FROM legacy_documents d WHERE d.collection_name='users' AND d.document_id=u.id
      );
      DELETE FROM countries x WHERE NOT EXISTS (
        SELECT 1 FROM legacy_documents d WHERE d.collection_name='countries' AND d.document_id=x.id
      );
      DELETE FROM languages x WHERE NOT EXISTS (
        SELECT 1 FROM legacy_documents d WHERE d.collection_name='languages' AND d.document_id=x.id
      );
      DELETE FROM genres x WHERE NOT EXISTS (
        SELECT 1 FROM legacy_documents d WHERE d.collection_name='genres' AND d.document_id=x.id
      );
    `);
    await pruneMigratedPaymentEvents(client);
    await client.query("COMMIT");
    console.log("[normalize] stale normalized rows pruned");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function verifyLegacyChecksums(postgres: MigrationDatabase): Promise<void> {
  let collection = "";
  let documentId = "";
  while (true) {
    const batch = await postgres.query<{
      collection_name: string; document_id: string; payload: JsonDocument; checksum: string;
      bson_payload: JsonDocument | null; bson_checksum: string | null;
    }>(`SELECT collection_name,document_id,payload,checksum,bson_payload,bson_checksum FROM legacy_documents
        WHERE (collection_name,document_id)>($1,$2) ORDER BY collection_name,document_id LIMIT $3`,
      [collection, documentId, batchSize]);
    if (!batch.rowCount) return;
    for (const row of batch.rows) {
      if (checksum(row.payload) !== row.checksum || !row.bson_payload ||
          checksum(row.bson_payload) !== row.bson_checksum) {
        throw new Error(`Mirror content verification failed for ${row.collection_name}/${row.document_id}; missing BSON capture or checksum mismatch. Re-capture from the source before cutover.`);
      }
    }
    const last = batch.rows[batch.rows.length - 1];
    collection = last.collection_name;
    documentId = last.document_id;
  }
}

export async function verify(postgres: MigrationDatabase): Promise<void> {
  await verifyLegacyChecksums(postgres);
  await verifyRelationParity(postgres);
  await verifyGenreParity(postgres);
  await verifyNativeDomains(postgres);
  const mirroredTotal = await postgres.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM legacy_documents",
  );
  if (
    Number(mirroredTotal.rows[0]?.count || 0) === 0 &&
    process.env.MIGRATION_ALLOW_EMPTY_SOURCE !== "true"
  ) {
    throw new Error(
      "Migration verification refused an empty mirror; set MIGRATION_ALLOW_EMPTY_SOURCE=true only for an intentionally empty source",
    );
  }
  const mismatches = await postgres.query<{
    collection_name: string;
    source_count: number;
    target_count: number;
  }>(
    `SELECT collection_name, source_count, target_count
     FROM migration_checkpoints WHERE source_count <> target_count`,
  );
  const orphans = await postgres.query<{ name: string; count: string }>(`
    SELECT 'station_genres' AS name, count(*)::text AS count
      FROM station_genres sg LEFT JOIN stations s ON s.id=sg.station_id WHERE s.id IS NULL
    UNION ALL
    SELECT 'user_favorites', count(*)::text
      FROM user_favorites f LEFT JOIN users u ON u.id=f.user_id
      LEFT JOIN stations s ON s.id=f.station_id WHERE u.id IS NULL OR s.id IS NULL
    UNION ALL
    SELECT 'subscriptions', count(*)::text
      FROM subscriptions x LEFT JOIN users u ON u.id=x.user_id WHERE u.id IS NULL
    UNION ALL
    SELECT 'user_notifications', count(*)::text
      FROM user_notifications n LEFT JOIN users u ON u.id=n.user_id WHERE u.id IS NULL
    UNION ALL
    SELECT 'direct_messages', count(*)::text
      FROM direct_messages m LEFT JOIN users a ON a.id=m.from_user_id LEFT JOIN users b ON b.id=m.to_user_id
      WHERE a.id IS NULL OR b.id IS NULL
  `);
  const nonZeroOrphans = orphans.rows.filter((row) => Number(row.count) !== 0);
  const parity = await postgres.query<{ name: string; expected: string; actual: string }>(`
    SELECT 'stations' AS name,
      (SELECT count(*)::text FROM legacy_documents WHERE collection_name='stations') expected,
      (SELECT count(*)::text FROM stations) actual
    UNION ALL SELECT 'users',
      (SELECT count(*)::text FROM legacy_documents WHERE collection_name='users'),
      (SELECT count(*)::text FROM users)
    UNION ALL SELECT 'countries',
      (SELECT count(*)::text FROM legacy_documents WHERE collection_name='countries'),
      (SELECT count(*)::text FROM countries)
    UNION ALL SELECT 'languages',
      (SELECT count(*)::text FROM legacy_documents WHERE collection_name='languages'),
      (SELECT count(*)::text FROM languages)
    UNION ALL SELECT 'genres',
      (SELECT count(*)::text FROM legacy_documents WHERE collection_name='genres'),
      (SELECT count(*)::text FROM genres)
    UNION ALL SELECT 'subscriptions',
      (SELECT count(*)::text FROM legacy_documents
       WHERE collection_name='users' AND jsonb_typeof(payload->'subscription')='object'),
      (SELECT count(*)::text FROM subscriptions)
    UNION ALL SELECT 'station_ratings',
      (SELECT count(*)::text FROM legacy_documents d
       JOIN stations s ON s.id=d.payload->>'stationId'
       LEFT JOIN users u ON u.id=d.payload->>'userId'
       WHERE d.collection_name IN ('stationratings','station_ratings')
         AND (d.payload->>'rating') ~ '^[1-5]$'
         AND ((d.payload->>'userId') IS NULL OR u.id IS NOT NULL)),
      (SELECT count(*)::text FROM station_ratings)
    UNION ALL SELECT 'listening_history',
      (SELECT count(*)::text FROM legacy_documents
       WHERE collection_name IN ('userlisteninghistories','user_listening_histories','userlisteninghistory')),
      (SELECT count(*)::text FROM listening_history)
    UNION ALL SELECT 'auth_tokens',
      (SELECT count(*)::text FROM legacy_documents d JOIN users u ON u.id=d.payload->>'userId'
       WHERE d.collection_name IN ('authtokens','auth_tokens')
         AND NULLIF(d.payload->>'token','') IS NOT NULL
         AND NULLIF(d.payload->>'expiresAt','') IS NOT NULL),
      (SELECT count(*)::text FROM auth_tokens)
    UNION ALL SELECT 'user_notifications',
      (SELECT count(*)::text FROM legacy_documents d JOIN users u ON u.id=d.payload->>'userId'
       WHERE d.collection_name IN ('usernotifications','user_notifications')),
      (SELECT count(*)::text FROM user_notifications)
    UNION ALL SELECT 'direct_messages',
      (SELECT count(*)::text FROM legacy_documents d
       JOIN users a ON a.id=d.payload->>'fromUserId' JOIN users b ON b.id=d.payload->>'toUserId'
       WHERE d.collection_name IN ('directmessages','direct_messages')
         AND d.payload->>'fromUserId'<>d.payload->>'toUserId'),
      (SELECT count(*)::text FROM direct_messages)
    UNION ALL SELECT 'translation_keys',
      (SELECT count(*)::text FROM legacy_documents WHERE collection_name IN ('translationkeys','translation_keys')),
      (SELECT count(*)::text FROM translation_keys)
    UNION ALL SELECT 'translations',
      (SELECT count(*)::text FROM legacy_documents d JOIN translation_keys k ON k.id=d.payload->>'keyId'
       WHERE d.collection_name='translations'),
      (SELECT count(*)::text FROM translations)
    UNION ALL SELECT 'url_translations',
      (SELECT count(*)::text FROM legacy_documents WHERE collection_name IN ('urltranslations','url_translations')),
      (SELECT count(*)::text FROM url_translations)
    UNION ALL SELECT 'translation_metadata',
      (SELECT count(*)::text FROM legacy_documents WHERE collection_name='translationmetadatas'),
      (SELECT count(*)::text FROM translation_metadata)
    UNION ALL SELECT 'translation_languages',
      (SELECT count(*)::text FROM legacy_documents WHERE collection_name='translationlanguages'),
      (SELECT count(*)::text FROM translation_languages)
    UNION ALL SELECT 'country_language_mappings',
      (SELECT count(*)::text FROM legacy_documents WHERE collection_name='countrylanguagemappings'),
      (SELECT count(*)::text FROM country_language_mappings)
    UNION ALL SELECT 'country_language_mapping_audit',
      (SELECT count(*)::text FROM legacy_documents WHERE collection_name='clearedoverridesauditlogs'),
      (SELECT count(*)::text FROM country_language_mapping_audit)
  `);
  const paymentParity = await paymentEventParity(postgres);
  parity.rows.push(
    { name: "payment_events", expected: String(paymentParity.expected), actual: String(paymentParity.matched) },
    { name: "payment_events_unmatched_migrated", expected: "0", actual: String(paymentParity.unexpectedMigrated) },
  );
  const parityFailures = parity.rows.filter(
    (row) => Number(row.expected) !== Number(row.actual),
  );
  const invalidChecksums = await postgres.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM legacy_documents WHERE length(checksum)<>64",
  );
  if (
    mismatches.rowCount ||
    nonZeroOrphans.length ||
    parityFailures.length ||
    Number(invalidChecksums.rows[0]?.count || 0)
  ) {
    throw new Error(
      `Migration verification failed: countMismatches=${mismatches.rowCount}, ` +
        `orphans=${JSON.stringify(nonZeroOrphans)}, ` +
        `parity=${JSON.stringify(parityFailures)}, ` +
        `invalidChecksums=${invalidChecksums.rows[0]?.count || "0"}`,
    );
  }
  console.log("[verify] mirror, normalized parity, checksums and foreign keys are valid");
}

export async function verifyRelationParity(postgres: MigrationDatabase): Promise<void> {
  const difference = await postgres.query<{ name: string; count: string }>(`
    WITH expected_favorites AS (
      SELECT DISTINCT d.payload->>'userId' user_id,d.payload->>'stationId' station_id FROM legacy_documents d
      JOIN users u ON u.id=d.payload->>'userId' JOIN stations s ON s.id=d.payload->>'stationId'
      WHERE d.collection_name IN ('userfavorites','user_favorites')
    ), expected_follows AS (
      SELECT DISTINCT d.payload->>'userId' follower_id,d.payload->>'followingUserId' following_id FROM legacy_documents d
      JOIN users u ON u.id=d.payload->>'userId' JOIN users p ON p.id=d.payload->>'followingUserId'
      WHERE d.collection_name IN ('userfollows','user_follows') AND u.id<>p.id
    )
    SELECT 'user_favorites' name,count(*)::text count FROM (
      (SELECT * FROM expected_favorites EXCEPT SELECT user_id,station_id FROM user_favorites)
      UNION ALL (SELECT user_id,station_id FROM user_favorites EXCEPT SELECT * FROM expected_favorites)
    ) missing_favorites
    UNION ALL SELECT 'user_follows',count(*)::text FROM (
      (SELECT * FROM expected_follows EXCEPT SELECT follower_id,following_id FROM user_follows)
      UNION ALL (SELECT follower_id,following_id FROM user_follows EXCEPT SELECT * FROM expected_follows)
    ) missing_follows
    UNION ALL SELECT 'entity_ids',count(*)::text FROM (
      (SELECT collection_name,document_id FROM legacy_documents
       WHERE collection_name IN ('stations','users','countries','languages','genres')
       EXCEPT SELECT 'stations',id FROM stations EXCEPT SELECT 'users',id FROM users
       EXCEPT SELECT 'countries',id FROM countries EXCEPT SELECT 'languages',id FROM languages
       EXCEPT SELECT 'genres',id FROM genres)
      UNION ALL
      (SELECT kind,id FROM (
        SELECT 'stations' kind,id FROM stations UNION ALL SELECT 'users',id FROM users
        UNION ALL SELECT 'countries',id FROM countries UNION ALL SELECT 'languages',id FROM languages
        UNION ALL SELECT 'genres',id FROM genres
      ) targets EXCEPT SELECT collection_name,document_id FROM legacy_documents)
    ) missing_entities
  `);
  const failures = difference.rows.filter((row) => Number(row.count) > 0);
  if (failures.length) throw new Error(`Normalized relation set mismatch: ${JSON.stringify(failures)}`);
  await forEachLegacyBatch(postgres, "stations", async (documents, client) => {
    const actual = await client.query<{ station_id: string; genre_slug: string; position: number }>(
      "SELECT station_id,genre_slug,position FROM station_genres WHERE station_id=ANY($1::text[]) ORDER BY station_id,position",
      [documents.map((station) => id(station._id))],
    );
    const byStation = new Map<string, Array<{ slug: string; position: number }>>();
    for (const row of actual.rows) {
      const rows = byStation.get(row.station_id) || [];
      rows.push({ slug: row.genre_slug, position: row.position });
      byStation.set(row.station_id, rows);
    }
    for (const station of documents) {
      const expected = [...new Set(tags(station.tags).map(genreSlug).filter(Boolean))]
        .map((slug, position) => ({ slug, position }));
      if (JSON.stringify(expected) !== JSON.stringify(byStation.get(id(station._id)) || [])) {
        throw new Error(`Normalized relation set mismatch: station_genres/${id(station._id)}`);
      }
    }
  });
}

export function validateMigrationSourcePreflight(
  sourceDatabase: string, counts: Record<string, number>, environment: NodeJS.ProcessEnv = process.env,
): void {
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  if (total === 0 && environment.MIGRATION_ALLOW_EMPTY_SOURCE !== "true") {
    throw new Error("Migration refused an empty MongoDB source before writing; MIGRATION_ALLOW_EMPTY_SOURCE=true is reserved for an intentionally empty source");
  }
  if (environment.MIGRATION_PRUNE === "true" &&
      (!environment.MIGRATION_EXPECT_SOURCE_DATABASE || environment.MIGRATION_EXPECT_SOURCE_DATABASE !== sourceDatabase)) {
    throw new Error("Pruning requires MIGRATION_EXPECT_SOURCE_DATABASE to exactly match the connected MongoDB database name");
  }
}

export async function runMigration(options: {
  phase?: string;
  forcePrimary?: boolean;
  beforeWrite?: (client: pg.PoolClient) => Promise<boolean>;
  signal?: AbortSignal;
  resumeInitialCapture?: boolean;
} = {}): Promise<void> {
  // Invalid values must fail before opening any connection, not disable flushing.
  const limits = migrationBatchLimits(process.env);
  batchSize = limits.batchSize;
  const mode = (options.phase || phaseArgument || process.env.MIGRATION_PHASE || "all").toLowerCase();
  if (!allowedPhases.has(mode)) {
    throw new Error(`MIGRATION_PHASE must be one of ${[...allowedPhases].join(", ")}`);
  }
  validateMigrationWriteSafety(mode);
  if (process.env.MIGRATION_PRUNE === "true" && mode !== "all") {
    throw new Error("MIGRATION_PRUNE=true requires MIGRATION_PHASE=all");
  }
  if (
    process.env.DATABASE_MAINTENANCE_READ_ONLY === "true" &&
    (mode === "mirror" || mode === "all") &&
    process.env.MIGRATION_PRUNE !== "true"
  ) {
    throw new Error("A maintenance-window mirror requires MIGRATION_PRUNE=true");
  }
  const needsMongo = mode === "mirror" || mode === "all";
  const mongoUrl = needsMongo
    ? requiredUrl("MONGODB_URI", /^mongodb(?:\+srv)?:\/\//i)
    : null;
  const postgresUrl = requiredUrl("DATABASE_URL", /^postgres(?:ql)?:\/\//i);
  const pool = new Pool({
    connectionString: postgresUrl,
    max: Math.max(2, Number.parseInt(process.env.MIGRATION_POSTGRES_POOL_MAX || "5", 10) || 5),
    ssl: migrationPostgresSsl(),
    application_name: "megaradio-migration",
    connectionTimeoutMillis: 15_000,
    statement_timeout: 300_000,
    keepAlive: true,
  });
  const lifecycle = createMigrationLifecycle({ pool, parentSignal: options.signal, log: console.log });
  let migrationLockClient: pg.PoolClient | null = null;
  let lockClientReleased = false;
  let drainDeadline: ReturnType<typeof setTimeout> | undefined;
  const boundInterruptedDrain = () => {
    // Allow a short cooperative rollback/marker write, then close this physical
    // session so a long SQL statement cannot keep writing after interruption.
    drainDeadline = setTimeout(() => {
      if (migrationLockClient && !lockClientReleased) {
        lockClientReleased = true;
        migrationLockClient.release(true);
      }
    }, 5_000);
    drainDeadline.unref();
  };
  lifecycle.signal.addEventListener("abort", boundInterruptedDrain, { once: true });
  let runId: string = crypto.randomUUID();
  let runStarted = false;
  let capturing = false;
  const stats: MigrationStats = {};
  try {
    lifecycle.assertHealthy();
    migrationLockClient = await pool.connect();
    lifecycle.watchClient(migrationLockClient);
    const postgres = lockedMigrationDatabase(migrationLockClient, lifecycle);
    await postgres.query("SELECT pg_advisory_lock(hashtext('radiohub-data-migration'))");
    // Automatic bootstrap must re-check durable completion under the SAME lock
    // as imports/runtime authority, not only under its outer coordinator lock.
    if (mode !== "verify" && options.beforeWrite && !await options.beforeWrite(migrationLockClient)) return;
    lifecycle.assertHealthy();
    if (mode !== "verify") await assertNoPostgresWriteAuthority(migrationLockClient);
    if (options.resumeInitialCapture && (mode !== "all" || process.env.MIGRATION_PRUNE === "true" ||
        process.env.MIGRATION_COLLECTIONS?.trim() || process.env.MIGRATION_ALLOW_EMPTY_SOURCE === "true" ||
        process.env.DATABASE_MAINTENANCE_READ_ONLY === "true" ||
        ["MIGRATION_SOURCE_WRITERS_STOPPED", "MIGRATION_TARGET_WRITERS_STOPPED", "MIGRATION_SOURCE_BACKUP_CONFIRMED"]
          .some((name) => process.env[name] !== "true"))) {
      throw new Error("Initial capture resume requires a full frozen-source import with backup confirmation, no pruning, and no collection filters.");
    }
    if (mongoUrl) {
      const finalReconciliation =
        options.forcePrimary === true || options.resumeInitialCapture === true ||
        process.env.MIGRATION_PRUNE === "true" ||
        process.env.DATABASE_MAINTENANCE_READ_ONLY === "true";
      mongoClient = new MongoClient(mongoUrl, {
        maxPoolSize: Number.parseInt(process.env.MIGRATION_MONGO_POOL_MAX || "5", 10),
        // The final delta must read the primary. A lagging secondary can make
        // the source appear older and would turn pruning into data loss.
        readPreference: finalReconciliation ? "primary" : "secondaryPreferred",
        serverSelectionTimeoutMS: 30_000,
        connectTimeoutMS: 15_000,
      });
      await mongoClient.connect();
      sourceDatabase = mongoClient.db();
    }
    lifecycle.assertHealthy();
    if (options.resumeInitialCapture) {
      const candidate = await inspectInitialCaptureResume(postgres, sourceDatabase!.databaseName);
      if (!candidate) throw new Error("Initial capture resume is no longer safe; destination was not changed.");
      console.log("[resume] Checking every captured document against the stopped source before any write; existing data will not be overwritten.");
      await validateCapturedSource(postgres, sourceDatabase!, candidate.runId, {
        batchSize, signal: lifecycle.signal, assertHealthy: lifecycle.assertHealthy, log: console.log,
      });
      runId = candidate.runId;
      console.log("[resume] Existing capture validated. Resuming the same run with insert-only batches.");
    }
    const startRun = async () => {
      if (options.resumeInitialCapture) {
        await postgres.query("UPDATE migration_runs SET status='running',error=NULL,finished_at=NULL WHERE id=$1", [runId]);
      } else {
        await postgres.query(`INSERT INTO migration_runs(id, mode, status, started_at, source_database)
          VALUES ($1,$2,'running',now(),$3)`, [runId, mode, sourceDatabase?.databaseName || null]);
      }
      runStarted = true;
    };
    if (mode === "mirror" || mode === "all") {
      const only = new Set(
        (process.env.MIGRATION_COLLECTIONS || "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      );
      if (process.env.MIGRATION_PRUNE === "true" && only.size) {
        throw new Error("MIGRATION_PRUNE cannot be combined with MIGRATION_COLLECTIONS");
      }
      const collections = (await sourceDatabase!.listCollections({}, { nameOnly: true, signal: lifecycle.signal }).toArray())
        .map((item) => item.name)
        .filter((name) => !name.startsWith("system."))
        .filter((name) => !only.size || only.has(name))
        .sort();
      // Refuse an empty/wrong source BEFORE any destructive pruning, not after
      // the old mirror and normalized rows have already been deleted.
      const sourceCounts: Record<string, number> = {};
      for (const collection of collections) {
        lifecycle.assertHealthy();
        sourceCounts[collection] = await sourceDatabase!.collection(collection).countDocuments({}, { signal: lifecycle.signal });
      }
      validateMigrationSourcePreflight(sourceDatabase!.databaseName, sourceCounts);
      await startRun();
      capturing = true;
      for (const collection of collections) {
        stats[collection] = await mirrorCollection(postgres, collection, runId, lifecycle, limits, options.resumeInitialCapture);
      }
      if (process.env.MIGRATION_PRUNE === "true") {
        await postgres.query(
          `DELETE FROM legacy_documents
           WHERE NOT (collection_name = ANY($1::text[]))`,
          [collections],
        );
        await postgres.query(
          `DELETE FROM migration_checkpoints
           WHERE NOT (collection_name = ANY($1::text[]))`,
          [collections],
        );
      }
    } else {
      await startRun();
    }
    capturing = false;
    if (mode === "normalize" || mode === "all") {
      console.log("[migration] Capture complete; normalizing native PostgreSQL tables.");
      await normalize(postgres);
    }
    if (mode === "verify" || mode === "all") {
      console.log("[migration] Verifying captured data and native PostgreSQL parity.");
      await verify(postgres);
    }
    await postgres.query(
      `UPDATE migration_runs SET status='complete', finished_at=now(), stats=$2 WHERE id=$1`,
      [runId, JSON.stringify(stats)],
    );
  } catch (error) {
    let failure = error;
    try { lifecycle.assertHealthy(); } catch (interruption) { failure = interruption; }
    if (runStarted && migrationLockClient) {
      // Never acquire a fresh bookkeeping connection after losing the data lock:
      // a replacement importer may already own it. Only this locked session can
      // record a controlled stop. Transport loss leaves the old run resumable.
      await migrationLockClient.query("ROLLBACK").catch(() => undefined);
      const retryCapture = capturing && failure instanceof MigrationLifecycleError;
      await migrationLockClient.query(
        `UPDATE migration_runs SET status=$2,finished_at=CASE WHEN $2='interrupted' THEN NULL ELSE now() END,
          stats=$3,error=$4 WHERE id=$1`,
        [runId, retryCapture ? "interrupted" : "failed",
          JSON.stringify(retryCapture ? { ...stats, initialCaptureRetry: true } : stats),
          retryCapture && failure instanceof MigrationLifecycleError ? `MIGRATION_CAPTURE_INTERRUPTED:${failure.kind}` : failure instanceof Error ? failure.stack : String(failure)],
      ).catch(() => undefined);
    }
    throw failure;
  } finally {
    await mongoClient?.close().catch(() => undefined);
    mongoClient = null;
    sourceDatabase = null;
    if (migrationLockClient && !lockClientReleased) {
      await migrationLockClient.query("SELECT pg_advisory_unlock(hashtext('radiohub-data-migration'))").catch(() => undefined);
      if (!lockClientReleased) {
        lockClientReleased = true;
        migrationLockClient.release(true);
      }
    }
    await pool.end().catch(() => undefined);
    clearTimeout(drainDeadline);
    lifecycle.signal.removeEventListener("abort", boundInterruptedDrain);
    lifecycle.cleanupAfterConnectionsClosed();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  runMigration().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
