import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyBootstrapFailure,
  readBootstrapDiagnostics,
  reportBootstrapDiagnostics,
  runAutomaticBootstrap,
  validateAutomaticImport,
  type BootstrapDependencies,
  type BootstrapState,
} from "../../../lib/legacy-migration/src/auto-bootstrap-postgres";

const secret = "private-customer-123-password-value";
const environment = {
  DATABASE_URL: "postgresql://localhost/disposable_test",
  MONGODB_URI: "mongodb://localhost/source_test",
  MIGRATION_SOURCE_WRITERS_STOPPED: "true",
  MIGRATION_TARGET_WRITERS_STOPPED: "true",
  MIGRATION_SOURCE_BACKUP_CONFIRMED: "true",
};
const interrupted: BootstrapState = {
  postgresOwned: false, latestRun: { mode: "all", status: "running", finished_at: null },
  checkpointCount: 2, checkpointsComplete: false,
};
const completed: BootstrapState = {
  postgresOwned: false, latestRun: { mode: "all", status: "complete", finished_at: new Date() },
  checkpointCount: 2, checkpointsComplete: true,
};

function metadataFixture(overrides: Record<string, any> = {}) {
  const queries: Array<{ text: string; query_timeout?: number }> = [];
  const run = {
    mode: "all", status: "running", started_at: new Date("2026-09-07T00:16:00Z"), finished_at: null,
    recorded_error: null, ...overrides.run,
  };
  const totals = { total: "3", complete: "1", running: "2", mismatch: "0", documents_processed: "500",
    source_count: "1000", target_count: "250", ...overrides.totals };
  const recent = overrides.recent || [{ status: "running", documents_processed: 250, source_count: 750,
    target_count: 0, updated_at: new Date("2026-09-07T00:17:00Z") }];
  const client = {
    async query(input: string | { text: string; query_timeout?: number }) {
      const query = typeof input === "string" ? { text: input } : input;
      queries.push(query);
      if (overrides.fail) throw new Error(secret);
      if (query.text.includes("FROM migration_runs")) return { rows: overrides.noRun ? [] : [run] };
      if (query.text.includes("count(*)::text AS total")) return { rows: [totals] };
      if (query.text.includes("FROM migration_checkpoints")) return { rows: recent };
      return { rows: [] };
    },
    release() {},
  };
  return { client: client as any, queries };
}

test("diagnostics use bounded SELECT-only metadata queries without customer payloads or identifiers", async () => {
  const f = metadataFixture();
  const report = await readBootstrapDiagnostics(f.client);
  assert.equal(f.queries.length, 3);
  assert.ok(f.queries.every((query) => query.text.startsWith("SELECT") && query.query_timeout === 3000));
  for (const query of f.queries) {
    assert.doesNotMatch(query.text, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b|legacy_documents|payload|last_document_id|source_database|\bstats\b/i);
  }
  assert.match(f.queries[0].text, /left\(error,8192\)/);
  assert.match(f.queries[0].text, /LIMIT 1/);
  assert.match(f.queries[2].text, /LIMIT 3/);
  assert.equal(report.recordedMirrorCheckpointSnapshot.documentsProcessed, "500");
  assert.equal(report.recentCheckpointSnapshots[0].recordedTargetCount, "0");
  assert.match(report.note, /span runs/);
  assert.match(report.note, /zero\/stale/);
});

test("diagnostics classify errors into fixed hints without logging any original text or secrets", async () => {
  for (const [raw, category] of [
    ["self-signed certificate", "tls"], ["ECONNRESET", "connection"], ["statement timeout", "timeout"],
    ["JavaScript heap out of memory", "memory"], ["integer outside exact numeric range", "numeric-data"],
    ["Migration verification failed", "verification"], ["unrecognized stored failure", "unknown"],
  ]) {
    const rawError = `${raw}: ${secret} postgresql://user:verysecret@host/db SQL customer_id='secret-id'`;
    const f = metadataFixture({ run: { status: "failed", recorded_error: rawError } });
    const logs: string[] = [];
    await reportBootstrapDiagnostics(f.client, (message) => logs.push(message));
    assert.equal(logs.length, 1);
    assert.ok(logs[0].startsWith("[bootstrap:diagnostic] "));
    const report = JSON.parse(logs[0].slice("[bootstrap:diagnostic] ".length));
    assert.equal(report.latestRun.failure.category, category);
    assert.doesNotMatch(logs[0], /private-customer|verysecret|secret-id|postgresql:\/\/|SQL customer_id/);
    assert.notEqual(report.latestRun.failure.hint, rawError);
  }
});

test("unfinished run without stored error reports uncertainty rather than inventing a crash cause", async () => {
  const report = await readBootstrapDiagnostics(metadataFixture().client);
  assert.equal(report.latestRun?.failure.category, "not-recorded");
  assert.match(report.latestRun?.failure.hint || "", /abrupt interruption or an unrecorded failure is possible/);
  assert.doesNotMatch(JSON.stringify(report), /OOM|out of memory|memory exhaustion/);
  assert.equal(classifyBootstrapFailure(null).category, "not-recorded");
  assert.equal((await readBootstrapDiagnostics(metadataFixture({ noRun: true }).client)).latestRun, null);
});

test("arbitrary mode/status values, invalid dates and oversized counters cannot leak through diagnostics", async () => {
  const f = metadataFixture({
    run: { mode: secret, status: secret, started_at: secret, finished_at: secret },
    totals: { total: secret, documents_processed: "90071992547409930", source_count: Infinity, target_count: Number.MAX_SAFE_INTEGER + 1 },
    recent: Array.from({ length: 6 }, () => ({ status: secret, updated_at: secret, collection_name: secret,
      last_document_id: secret, documents_processed: secret, source_count: "123", target_count: "0" })),
  });
  const report = await readBootstrapDiagnostics(f.client);
  assert.equal(report.latestRun?.mode, "unknown");
  assert.equal(report.latestRun?.status, "unknown");
  assert.equal(report.latestRun?.startedAt, null);
  assert.equal(report.recordedMirrorCheckpointSnapshot.documentsProcessed, "90071992547409930");
  assert.equal(report.recordedMirrorCheckpointSnapshot.recordedSourceCount, "unknown");
  assert.equal(report.recordedMirrorCheckpointSnapshot.recordedTargetCount, "unknown");
  assert.equal(report.recentCheckpointSnapshots.length, 3);
  assert.deepEqual(report.recentCheckpointSnapshots.map((row) => row.ordinal), [1, 2, 3]);
  assert.ok(!JSON.stringify(report).includes(secret));
});

test("diagnostic query or logging failure is best effort and never exposes the exception", async () => {
  const logs: string[] = [];
  await reportBootstrapDiagnostics(metadataFixture({ fail: true }).client, (message) => logs.push(message));
  assert.equal(logs.length, 1);
  assert.match(logs[0], /Metadata report unavailable/);
  assert.ok(!logs[0].includes(secret));
  await assert.doesNotReject(reportBootstrapDiagnostics(metadataFixture().client, () => { throw new Error(secret); }));
});

function bootstrapFixture(initial: BootstrapState = interrupted) {
  let state = initial;
  let imports = 0;
  let releases = 0;
  let closed = 0;
  const logs: string[] = [];
  const f = metadataFixture();
  f.client.release = () => { releases += 1; };
  const dependencies: BootstrapDependencies = {
    async connect() { return { client: f.client, async close() { closed += 1; } }; },
    async applySchema() {}, async readState() { return state; }, async isPristine() { return true; },
    async runImport() { imports += 1; state = completed; },
    log(message) { logs.push(message); },
  };
  return { dependencies, logs, queries: f.queries, counts: () => ({ imports, releases, closed }) };
}

test("nonpristine initialization reports metadata then preserves the exact rejection without any import", async () => {
  const f = bootstrapFixture();
  let expected = "";
  try { validateAutomaticImport(environment, false); } catch (error) { expected = (error as Error).message; }
  await assert.rejects(runAutomaticBootstrap(environment, f.dependencies), (error: Error) => error.message === expected);
  assert.equal(f.logs.filter((line) => line.startsWith("[bootstrap:diagnostic]")).length, 1);
  assert.deepEqual(f.counts(), { imports: 0, releases: 1, closed: 1 });
  assert.equal("MIGRATION_PRUNE" in environment, false);
});

test("diagnostic failure and throwing logger cannot replace the original nonpristine safety guard", async () => {
  for (const failLogger of [false, true]) {
    const f = bootstrapFixture();
    if (failLogger) f.dependencies.log = () => { throw new Error(secret); };
    else f.dependencies.diagnostics = async () => { throw new Error(secret); };
    await assert.rejects(runAutomaticBootstrap(environment, f.dependencies), /Destination has an incomplete\/failed import or existing rows/);
    assert.equal(f.counts().imports, 0);
    assert.equal(f.counts().closed, 1);
  }
});

test("completed or already-PostgreSQL executions skip diagnostics and never need source credentials", async () => {
  for (const state of [completed, { ...interrupted, postgresOwned: true }]) {
    const f = bootstrapFixture(state);
    let diagnostics = 0;
    f.dependencies.diagnostics = async () => { diagnostics += 1; };
    assert.equal(await runAutomaticBootstrap({ DATABASE_URL: environment.DATABASE_URL }, f.dependencies), state.postgresOwned ? "already-postgres" : "already-imported");
    assert.equal(diagnostics, 0);
    assert.equal(f.counts().imports, 0);
    assert.ok(!f.logs.some((line) => line.startsWith("[bootstrap:diagnostic]")));
  }
});

test("pristine first initialization keeps its existing path without diagnostic queries", async () => {
  const f = bootstrapFixture({ postgresOwned: false, latestRun: null, checkpointCount: 0, checkpointsComplete: false });
  let diagnostics = 0;
  f.dependencies.diagnostics = async () => { diagnostics += 1; };
  assert.equal(await runAutomaticBootstrap(environment, f.dependencies), "imported");
  assert.equal(diagnostics, 0);
  assert.equal(f.counts().imports, 1);
});
