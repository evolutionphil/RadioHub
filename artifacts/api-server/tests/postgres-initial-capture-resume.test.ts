import assert from "node:assert/strict";
import { test } from "node:test";
import { BSON, bsonSafe, checksum, jsonSafe } from "@workspace/legacy-migration/legacy-document-codec";
import { assertCapturedDocumentMatches, INITIAL_CAPTURE_INTERRUPTION_MARKERS, inspectInitialCaptureResume, validateCapturedSource, type CapturedDocument } from "../../../lib/legacy-migration/src/initial-capture-resume";

const capture = (document: Record<string, any>, overrides: Partial<CapturedDocument> = {}): CapturedDocument => {
  const payload = jsonSafe(document);
  const bson = bsonSafe(document);
  return { collection_name: "fixtures", document_id: String(document._id), payload, checksum: checksum(payload),
    bson_payload: bson, bson_checksum: checksum(bson), last_seen_run_id: "run-1", ...overrides };
};
const documents = () => [{ _id: new BSON.ObjectId("507f1f77bcf86cd799439001"), value: "original", exact: BSON.Long.fromString("9223372036854775807") },
  { _id: "opaque-id", value: "second" }];

function fixture(overrides: Record<string, any> = {}) {
  const state: Record<string, any> = {
    authority: false, native: false, missingSchema: false, invalidCheckpoints: false,
    runs: [{ id: "run-1", mode: "all", status: "running", finished_at: null, error_absent: true, source_database: "source_test" }],
    rows: documents().map((document) => capture(document)), source: documents(), sourceExists: true, sourceCount: 2,
    checkpoints: [{ collection_name: "fixtures", source_count: 2 }], ...overrides,
  };
  const queries: string[] = [];
  const selections: any[] = [];
  let sourceReads = 0;
  let closed = 0;
  const client = { async query(sql: string, values: any[] = []) {
    queries.push(sql);
    if (sql.startsWith("SELECT 1 FROM database_write_authority")) return { rows: state.authority ? [{}] : [] };
    if (sql.startsWith("SELECT id,mode")) return { rows: state.runs.map((run: any) => ({ ...run,
      ...(run.status === "interrupted" ? { capture_retry: run.stats?.initialCaptureRetry === true,
        controlled_interruption: values[0].includes(run.error) } : {}),
    })) };
    if (sql.includes("FROM unnest")) return { rows: state.missingSchema ? [{}] : [] };
    if (sql.startsWith("SELECT EXISTS")) return { rows: [{ has_captures: state.rows.length > 0, foreign_owner: state.rows.some((row: CapturedDocument) => row.last_seen_run_id !== values[0]) }] };
    if (sql.startsWith("SELECT 1 FROM migration_checkpoints")) return { rows: state.invalidCheckpoints ? [{}] : [] };
    if (sql.includes("FROM pg_class")) return { rows: [{ schema_name: "public", name: 'users"safe' }] };
    if (sql.startsWith('SELECT 1 FROM "public"')) return { rows: state.native ? [{}] : [] };
    if (sql.includes("UNION SELECT collection_name")) return { rows: [...new Set([...state.rows.map((row: CapturedDocument) => row.collection_name), ...state.checkpoints.map((row: any) => row.collection_name)])].sort().map((collection_name) => ({ collection_name })) };
    if (sql.startsWith("SELECT source_count")) return { rows: state.checkpoints.filter((row: any) => row.collection_name === values[0]) };
    if (sql.startsWith("SELECT count(*)::text AS captured_count")) return { rows: [{ captured_count: String(state.rows.filter((row: CapturedDocument) => row.collection_name === values[0]).length) }] };
    if (sql.startsWith("SELECT document_id,")) return { rows: state.rows.filter((row: CapturedDocument) => row.collection_name === values[0] && (values[1] === null || row.document_id > values[1])).sort((a: CapturedDocument, b: CapturedDocument) => a.document_id < b.document_id ? -1 : 1).slice(0, values[2]).map((row: CapturedDocument) => ({ document_id: row.document_id, encoded_bytes: String(state.encodedBytes || Buffer.byteLength(JSON.stringify(row.payload)) + Buffer.byteLength(JSON.stringify(row.bson_payload))) })) };
    if (sql.startsWith("SELECT collection_name,document_id")) return { rows: state.disappear ? [] : state.rows.filter((row: CapturedDocument) => row.collection_name === values[0] && values[1].includes(row.document_id)) };
    throw new Error("Unexpected fixture query");
  } } as any;
  const mongo = {
    listCollections() { return { async toArray() { return state.sourceExists ? [{ name: "fixtures" }] : []; } }; },
    collection() { return {
      async countDocuments() { return state.sourceCount; },
      find(filter: any, options: any) {
        sourceReads += 1;
        selections.push({ filter, options });
        const identities = new Set(filter._id.$in.map((id: any) => checksum(bsonSafe({ _id: id }))));
        const cursor = {
          batchSize() { return cursor; },
          async *[Symbol.asyncIterator]() { for (const document of state.source) if (identities.has(checksum(bsonSafe({ _id: document._id })))) yield document; },
          async close() { closed += 1; if (state.closeError) throw new Error("private cursor cleanup failure"); },
        };
        return cursor;
      },
    }; },
  } as any;
  return { state, client, mongo, queries, selections, counts: () => ({ sourceReads, closed }) };
}

test("only one unfinished pristine-native run with exact source and exclusive capture ownership is eligible", async () => {
  const f = fixture();
  assert.deepEqual(await inspectInitialCaptureResume(f.client, "source_test"), { runId: "run-1" });
  assert.ok(f.queries.every((sql) => sql.startsWith("SELECT")));
  assert.ok(f.queries.some((sql) => sql.includes('"public"."users""safe"')));
  assert.equal(await inspectInitialCaptureResume(f.client, "wrong_source"), null);
});

test("failed/finished/ambiguous runs, authority, native data or mixed capture owners cannot resume", async () => {
  for (const flags of [{ authority: true }, { native: true }, { missingSchema: true }, { invalidCheckpoints: true }, { rows: [] },
    { rows: [capture(documents()[0], { last_seen_run_id: "another-run" })] }, { runs: [] },
    { runs: [fixture().state.runs[0], fixture().state.runs[0]] }]) {
    assert.equal(await inspectInitialCaptureResume(fixture(flags).client, "source_test"), null);
  }
  for (const field of [{ status: "failed" }, { finished_at: new Date() }, { error_absent: false }, { mode: "mirror" }, { mode: "normalize" }]) {
    const f = fixture(); f.state.runs[0] = { ...f.state.runs[0], ...field };
    assert.equal(await inspectInitialCaptureResume(f.client, "source_test"), null);
  }
});

test("only fixed capture-only lifecycle interruptions with a real boolean retry marker are eligible", async () => {
  for (const error of INITIAL_CAPTURE_INTERRUPTION_MARKERS) {
    const f = fixture();
    f.state.runs[0] = { ...f.state.runs[0], status: "interrupted", error_absent: false, error, stats: { initialCaptureRetry: true } };
    assert.deepEqual(await inspectInitialCaptureResume(f.client, "source_test"), { runId: "run-1" });
    assert.ok(f.queries.every((sql) => sql.startsWith("SELECT")));
    assert.ok(f.queries.some((sql) => sql.includes("stats->'initialCaptureRetry' = 'true'::jsonb")));
  }
});

test("ordinary failures, fabricated interruption errors and altered retry markers never gain resume eligibility", async () => {
  const good = { ...fixture().state.runs[0], status: "interrupted", error_absent: false,
    error: "MIGRATION_CAPTURE_INTERRUPTED:SIGTERM", stats: { initialCaptureRetry: true } };
  for (const change of [
    { error: "customer data error" }, { error: "MIGRATION_CAPTURE_INTERRUPTED:out-of-memory" },
    { error: "MIGRATION_CAPTURE_INTERRUPTED:SIGTERM additional private error" }, { error: null },
    { stats: {} }, { stats: { initialCaptureRetry: "true" } }, { stats: { initialCaptureRetry: false } },
    { status: "failed" }, { status: "running" }, { mode: "normalize" }, { finished_at: new Date() },
  ]) {
    assert.equal(await inspectInitialCaptureResume(fixture({ runs: [{ ...good, ...change }] }).client, "source_test"), null);
  }
  for (const state of [{ authority: true }, { native: true }, { invalidCheckpoints: true },
    { rows: [capture(documents()[0], { last_seen_run_id: "other" })] }]) {
    assert.equal(await inspectInitialCaptureResume(fixture({ ...state, runs: [good] }).client, "source_test"), null);
  }
});

test("full stored prefix validation is SELECT-only and uses typed BSON IDs with bounded source cursors", async () => {
  const f = fixture();
  await validateCapturedSource(f.client, f.mongo, "run-1", { batchSize: 1 });
  assert.ok(f.queries.every((sql) => sql.startsWith("SELECT")));
  assert.equal(f.counts().sourceReads, 2);
  assert.equal(f.counts().closed, 2);
  assert.ok(f.selections.some((selection) => selection.filter._id.$in[0] instanceof BSON.ObjectId));
  assert.ok(f.selections.every((selection) => selection.options.promoteValues === false));
});

test("changed or missing source documents fail without any mutations", async () => {
  for (const source of [[{ ...documents()[0], value: "changed" }, documents()[1]], [documents()[1]]]) {
    const f = fixture({ source });
    await assert.rejects(validateCapturedSource(f.client, f.mongo, "run-1", {}), /changed source content|missing source documents/);
    assert.ok(f.queries.every((sql) => sql.startsWith("SELECT")));
    assert.equal(f.counts().closed, 1);
  }
});

test("cursor cleanup failures never mask source drift or expose raw cleanup errors", async () => {
  const f = fixture({ source: [{ ...documents()[0], value: "changed" }, documents()[1]], closeError: true });
  await assert.rejects(validateCapturedSource(f.client, f.mongo, "run-1", {}), /changed source content/);
  assert.equal(f.counts().closed, 1);
});

test("same textual ID with a different BSON type is not treated as an existing matching record", () => {
  const row = capture(documents()[0]);
  assert.throws(() => assertCapturedDocumentMatches(row, { ...documents()[0], _id: row.document_id }), /colliding source identity/);
});

test("captured checksums, cross-format content and captured document IDs must all agree", () => {
  for (const row of [capture(documents()[0], { checksum: "corrupt" }), capture(documents()[0], { bson_checksum: "corrupt" }),
    capture(documents()[0], { document_id: "different" })]) {
    assert.throws(() => assertCapturedDocumentMatches(row, documents()[0]), /checksum|identity/);
  }
  const altered = capture(documents()[0]);
  altered.payload = { ...altered.payload, value: "tampered" }; altered.checksum = checksum(altered.payload);
  assert.throws(() => assertCapturedDocumentMatches(altered, documents()[0]), /JSON\/BSON content/);
});

test("missing collections, changed source counts and mixed ownership fail before source document reads", async () => {
  for (const flags of [{ sourceExists: false }, { sourceCount: 3 }, { rows: [capture(documents()[0], { last_seen_run_id: "other" })] }]) {
    const f = fixture(flags);
    await assert.rejects(validateCapturedSource(f.client, f.mongo, "run-1", {}), /source collection|source-count drift|ownership/);
    assert.equal(f.counts().sourceReads, 0);
  }
});

test("capture ahead of old checkpoint and empty collections without a checkpoint are not cursor assumptions", async () => {
  const f = fixture({ checkpoints: [] });
  await validateCapturedSource(f.client, f.mongo, "run-1", { batchSize: 1 });
  assert.equal(f.counts().sourceReads, 2);
  assert.ok(!f.queries.some((sql) => sql.includes("last_document_id")));
});

test("disappearing captured keys and oversize captures fail before source reads", async () => {
  for (const flags of [{ disappear: true }, { encodedBytes: 17 * 1024 * 1024 }]) {
    const f = fixture(flags);
    await assert.rejects(validateCapturedSource(f.client, f.mongo, "run-1", {}), /keyset|memory limit/);
    assert.equal(f.counts().sourceReads, 0);
  }
});

test("validation honors cancellation and authority-health fencing without mutation", async () => {
  const f = fixture();
  const controller = new AbortController(); controller.abort();
  await assert.rejects(validateCapturedSource(f.client, f.mongo, "run-1", { signal: controller.signal }), /cancelled/);
  assert.equal(f.queries.length, 0);
  await assert.rejects(validateCapturedSource(f.client, f.mongo, "run-1", { assertHealthy() { throw new Error("lock lost"); } }), /lock lost/);
  assert.equal(f.queries.length, 0);
});

test("validation progress reports counts without source names or document IDs and logger failure is harmless", async () => {
  const f = fixture();
  const logs: string[] = [];
  await validateCapturedSource(f.client, f.mongo, "run-1", { batchSize: 1, log: (message) => logs.push(message) });
  assert.equal(logs.length, 1);
  assert.match(logs[0], /2 captured documents verified against source; 1\/1 recorded collections checked/);
  assert.doesNotMatch(logs[0], /fixtures|opaque-id|507f1f77|run-1/);
  const second = fixture();
  await assert.doesNotReject(validateCapturedSource(second.client, second.mongo, "run-1", { log() { throw new Error("logger unavailable"); } }));
});
