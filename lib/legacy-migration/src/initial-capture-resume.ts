import type pg from "pg";
import type { Db } from "mongodb";
import { BSON, bsonSafe, checksum, jsonSafe } from "./legacy-document-codec";

type Client = Pick<pg.PoolClient, "query">;
export interface CapturedDocument {
  collection_name: string;
  document_id: string;
  payload: Record<string, any>;
  checksum: string;
  bson_payload: Record<string, any>;
  bson_checksum: string;
  last_seen_run_id: string;
}

const CONTROL_TABLES = ["radiohub_schema_migrations", "legacy_documents", "migration_runs", "migration_checkpoints"];
export const INITIAL_CAPTURE_INTERRUPTION_MARKERS = [
  "MIGRATION_CAPTURE_INTERRUPTED:SIGTERM",
  "MIGRATION_CAPTURE_INTERRUPTED:SIGINT",
  "MIGRATION_CAPTURE_INTERRUPTED:postgres-pool",
  "MIGRATION_CAPTURE_INTERRUPTED:postgres-client",
  "MIGRATION_CAPTURE_INTERRUPTED:coordinator",
] as const;
const PAGE_BYTES = 4 * 1024 * 1024;
export const CAPTURE_RESUME_MAX_DOCUMENT_BYTES = 16 * 1024 * 1024;
const quoteIdentifier = (value: string) => '"' + value.replace(/"/g, '""') + '"';

/** Read-only eligibility check. Caller must hold the data-import session lock. */
export async function inspectInitialCaptureResume(client: Client, expectedSourceDb: string): Promise<{ runId: string } | null> {
  if (!expectedSourceDb) return null;
  const authority = await client.query("SELECT 1 FROM database_write_authority LIMIT 1");
  if (authority.rows.length) return null;
  // Only an exact capture-only lifecycle marker is retryable. Read booleans,
  // not arbitrary stored error text or stats, into the eligibility decision.
  const runs = await client.query(`SELECT id,mode,status,finished_at,error IS NULL AS error_absent,source_database,
    stats->'initialCaptureRetry' = 'true'::jsonb AS capture_retry,
    error = ANY($1::text[]) AS controlled_interruption
    FROM migration_runs ORDER BY started_at DESC,id DESC LIMIT 2`, [INITIAL_CAPTURE_INTERRUPTION_MARKERS]);
  const run = runs.rows[0];
  const unrecordedInterruption = run?.status === "running" && run.error_absent === true;
  const controlledInterruption = run?.status === "interrupted" && run.capture_retry === true && run.controlled_interruption === true;
  if (runs.rows.length !== 1 || typeof run.id !== "string" || !run.id || run.mode !== "all" ||
      run.finished_at !== null || (!unrecordedInterruption && !controlledInterruption) || run.source_database !== expectedSourceDb) return null;
  // Do not silently inspect an empty search-path schema while control tables
  // resolve to another schema containing an existing application.
  const missing = await client.query(`SELECT name FROM unnest($1::text[]) AS name
    WHERE to_regclass(format('%I.%I',current_schema(),name)) IS NULL`, [CONTROL_TABLES]);
  if (missing.rows.length) return null;
  const ownership = await client.query(`SELECT EXISTS (SELECT 1 FROM legacy_documents) AS has_captures,
    EXISTS (SELECT 1 FROM legacy_documents WHERE last_seen_run_id IS DISTINCT FROM $1) AS foreign_owner`, [run.id]);
  if (ownership.rows[0]?.has_captures !== true || ownership.rows[0]?.foreign_owner !== false) return null;
  const invalid = await client.query(`SELECT 1 FROM migration_checkpoints WHERE
    status IS NULL OR status NOT IN ('running','complete') OR documents_processed < 0 OR source_count < 0 OR target_count < 0
    OR documents_processed > source_count
    OR (status='complete' AND (documents_processed <> source_count OR target_count <> source_count)) LIMIT 1`);
  if (invalid.rows.length) return null;
  const tables = await client.query<{ schema_name: string; name: string }>(`SELECT n.nspname AS schema_name,c.relname AS name
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=current_schema() AND c.relkind IN ('r','p') AND c.relname <> ALL($1::text[])
    ORDER BY c.relname`, [CONTROL_TABLES]);
  for (const table of tables.rows) {
    if ((await client.query(`SELECT 1 FROM ${quoteIdentifier(table.schema_name)}.${quoteIdentifier(table.name)} LIMIT 1`)).rows.length) return null;
  }
  return { runId: run.id };
}

function validateCapturedDocument(row: CapturedDocument): { id: any; identity: string } {
  if (!row.payload || typeof row.payload !== "object" || Array.isArray(row.payload) ||
      !row.bson_payload || typeof row.bson_payload !== "object" || Array.isArray(row.bson_payload)) {
    throw new Error("Initial capture resume refused invalid captured document structure");
  }
  const bytes = Buffer.byteLength(JSON.stringify(row.payload)) + Buffer.byteLength(JSON.stringify(row.bson_payload));
  if (bytes > CAPTURE_RESUME_MAX_DOCUMENT_BYTES) throw new Error("Initial capture resume document exceeds the validation memory limit; review the record size before retrying");
  if (checksum(row.payload) !== row.checksum || checksum(row.bson_payload) !== row.bson_checksum) {
    throw new Error("Initial capture resume refused a corrupted captured checksum");
  }
  let decoded: Record<string, any>;
  try { decoded = BSON.EJSON.deserialize(row.bson_payload, { relaxed: false }) as Record<string, any>; }
  catch { throw new Error("Initial capture resume refused invalid captured BSON"); }
  if (!Object.hasOwn(decoded, "_id") || String(decoded._id) !== row.document_id ||
      checksum(jsonSafe(decoded)) !== row.checksum || checksum(bsonSafe(decoded)) !== row.bson_checksum) {
    throw new Error("Initial capture resume refused inconsistent captured identity or JSON/BSON content");
  }
  return { id: decoded._id, identity: checksum(bsonSafe({ _id: decoded._id })) };
}

/** Reusable insert-conflict check. Never print document contents or identifiers. */
export function assertCapturedDocumentMatches(row: CapturedDocument, sourceDocument: Record<string, any>): void {
  const captured = validateCapturedDocument(row);
  if (!Object.hasOwn(sourceDocument, "_id") || String(sourceDocument._id) !== row.document_id ||
      checksum(bsonSafe({ _id: sourceDocument._id })) !== captured.identity) {
    throw new Error("Initial capture resume refused a changed or colliding source identity");
  }
  const sourcePayload = jsonSafe(sourceDocument);
  const sourceBson = bsonSafe(sourceDocument);
  if (Buffer.byteLength(JSON.stringify(sourcePayload)) + Buffer.byteLength(JSON.stringify(sourceBson)) > CAPTURE_RESUME_MAX_DOCUMENT_BYTES) {
    throw new Error("Initial capture resume source document exceeds the validation memory limit");
  }
  if (checksum(sourcePayload) !== row.checksum || checksum(sourceBson) !== row.bson_checksum) {
    throw new Error("Initial capture resume refused changed source content");
  }
}

/** Verify every existing capture against the frozen primary before ANY mutation. */
export async function validateCapturedSource(client: Client, mongoDb: Db, runId: string, options: {
  batchSize?: number;
  signal?: AbortSignal;
  assertHealthy?: () => void;
  log?: (message: string) => void;
} = {}): Promise<void> {
  const batchSize = Number.isSafeInteger(options.batchSize) && options.batchSize! > 0 ? Math.min(options.batchSize!, 250) : 100;
  const healthy = () => {
    if (options.signal?.aborted) throw new Error("Initial capture validation was cancelled");
    options.assertHealthy?.();
  };
  healthy();
  const owner = await client.query(`SELECT EXISTS (SELECT 1 FROM legacy_documents) AS has_captures,
    EXISTS (SELECT 1 FROM legacy_documents WHERE last_seen_run_id IS DISTINCT FROM $1) AS foreign_owner`, [runId]);
  if (owner.rows[0]?.has_captures !== true || owner.rows[0]?.foreign_owner !== false) throw new Error("Initial capture resume refused missing captures or mixed run ownership");
  const sourceCollections = new Set((await mongoDb.listCollections({}, { nameOnly: true, signal: options.signal }).toArray()).map((item) => item.name));
  const collections = await client.query<{ collection_name: string }>(`SELECT collection_name FROM legacy_documents
    UNION SELECT collection_name FROM migration_checkpoints ORDER BY collection_name`);
  let validatedTotal = 0n;
  let completedCollections = 0;
  let lastProgress = Date.now();
  const progress = (force = false) => {
    if (!force && Date.now() - lastProgress < 15_000) return;
    try { options.log?.(`[resume:validation] ${validatedTotal} captured documents verified against source; ${completedCollections}/${collections.rows.length} recorded collections checked.`); } catch { /* Logs cannot affect validation. */ }
    lastProgress = Date.now();
  };
  for (const { collection_name: name } of collections.rows) {
    healthy();
    if (!sourceCollections.has(name)) throw new Error("Initial capture resume refused a missing source collection");
    const checkpoint = await client.query<{ source_count: number }>("SELECT source_count FROM migration_checkpoints WHERE collection_name=$1", [name]);
    if (checkpoint.rows.length) {
      const currentCount = await mongoDb.collection(name).countDocuments({}, { signal: options.signal });
      const recordedCount = Number(checkpoint.rows[0].source_count);
      if (currentCount !== recordedCount) {
        // Keep this refusal diagnostic-only: disclose aggregate counts and the
        // stable sorted ordinal, never source names, identifiers or payloads.
        const change = currentCount > recordedCount ? "growth" : currentCount < recordedCount ? "shrink" : "invalid-count";
        throw new Error(`Initial capture resume refused source-count drift (collection ${completedCollections + 1}/${collections.rows.length}; recorded=${recordedCount}; current=${currentCount}; change=${change})`);
      }
    }
    const countCaptured = async () => {
      const count = await client.query<{ captured_count: string }>("SELECT count(*)::text AS captured_count FROM legacy_documents WHERE collection_name=$1", [name]);
      return BigInt(count.rows[0].captured_count);
    };
    const initialCaptureCount = await countCaptured();
    let validatedCount = 0n;
    let after: string | null = null;
    while (true) {
      healthy();
      const keys = await client.query<{ document_id: string; encoded_bytes: string }>(`SELECT document_id,
        (octet_length(payload::text)::bigint+octet_length(bson_payload::text)::bigint)::text AS encoded_bytes
        FROM legacy_documents WHERE collection_name=$1 AND ($2::text IS NULL OR document_id>$2)
        ORDER BY document_id LIMIT $3`, [name, after, batchSize]);
      if (!keys.rows.length) break;
      const selected: string[] = [];
      let bytes = 0;
      for (const row of keys.rows) {
        const size = Number(row.encoded_bytes);
        if (!Number.isSafeInteger(size) || size < 0 || size > CAPTURE_RESUME_MAX_DOCUMENT_BYTES) throw new Error("Initial capture resume document exceeds the validation memory limit; review the record size before retrying");
        if (selected.length && bytes + size > PAGE_BYTES) break;
        selected.push(row.document_id);
        bytes += size;
      }
      const captures = await client.query<CapturedDocument>(`SELECT collection_name,document_id,payload,checksum,bson_payload,bson_checksum,last_seen_run_id
        FROM legacy_documents WHERE collection_name=$1 AND document_id=ANY($2::text[]) ORDER BY document_id`, [name, selected]);
      if (captures.rows.length !== selected.length) throw new Error("Initial capture resume refused a changing captured keyset");
      const expected = new Map<string, CapturedDocument>();
      const ids: any[] = [];
      for (const capture of captures.rows) {
        if (capture.collection_name !== name || capture.last_seen_run_id !== runId || !selected.includes(capture.document_id)) throw new Error("Initial capture resume refused inconsistent run ownership or capture keys");
        const identity = validateCapturedDocument(capture);
        if (expected.has(identity.identity)) throw new Error("Initial capture resume refused duplicate typed identities");
        expected.set(identity.identity, capture);
        ids.push(identity.id);
      }
      const seen = new Set<string>();
      const cursor = mongoDb.collection(name).find({ _id: { $in: ids } }, { promoteValues: false, signal: options.signal }).batchSize(Math.min(batchSize, 10));
      try {
        for await (const document of cursor) {
          healthy();
          // BSON input is at most MongoDB's document limit. Stream one result at
          // a time instead of collecting an unbounded changed-source response.
          const identity = checksum(bsonSafe({ _id: document._id }));
          const captured = expected.get(identity);
          if (!captured || seen.has(identity)) throw new Error("Initial capture resume refused a changed or colliding source identity");
          assertCapturedDocumentMatches(captured, document);
          seen.add(identity);
          validatedTotal += 1n;
          progress();
        }
      } finally { await cursor.close().catch(() => undefined); }
      if (seen.size !== expected.size) throw new Error("Initial capture resume refused missing source documents");
      validatedCount += BigInt(captures.rows.length);
      after = selected[selected.length - 1];
    }
    if (validatedCount !== initialCaptureCount || await countCaptured() !== initialCaptureCount) {
      throw new Error("Initial capture resume refused a changing captured keyset");
    }
    completedCollections += 1;
    progress(true);
  }
  healthy();
}
