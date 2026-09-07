import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isPristineDestination,
  isVerifiedImport,
  readBootstrapState,
  runAutomaticBootstrap,
  sanitizedBootstrapError,
  sourceDatabaseName,
  validateAutomaticImport,
  type BootstrapDependencies,
  type BootstrapState,
} from "../../../lib/legacy-migration/src/auto-bootstrap-postgres";

const environment = () => ({
  DATABASE_URL: "postgresql://localhost/disposable_test",
  MONGODB_URI: "mongodb://localhost/radiohub_source",
  MIGRATION_SOURCE_WRITERS_STOPPED: "true",
  MIGRATION_TARGET_WRITERS_STOPPED: "true",
  MIGRATION_SOURCE_BACKUP_CONFIRMED: "true",
});
const fresh = (): BootstrapState => ({
  postgresOwned: false, latestRun: null, checkpointCount: 0, checkpointsComplete: false,
});
const complete = (): BootstrapState => ({
  postgresOwned: false, latestRun: { mode: "all", status: "complete", finished_at: new Date() },
  checkpointCount: 3, checkpointsComplete: true,
});

function fixture(initial = fresh()) {
  let state = initial;
  let imports = 0;
  let schemaCalls = 0;
  let closes = 0;
  let releases = 0;
  let locks = 0;
  const errors = new Set<() => void>();
  const pending: Array<() => void> = [];
  const logs: string[] = [];
  const dependencies: BootstrapDependencies = {
    async connect() {
      return {
        client: {
          query: (async (sql: string) => {
            if (sql.includes("pg_advisory_lock(")) {
              if (locks) await new Promise<void>((resolve) => pending.push(resolve));
              locks = 1;
            } else if (sql.includes("pg_advisory_unlock(")) {
              const next = pending.shift();
              if (next) next(); else locks = 0;
            }
            return { rows: [] };
          }) as any,
          release(error?: Error) { releases++; if (error) locks = 0; },
          on: ((_event: string, listener: () => void) => { errors.add(listener); }) as any,
          off: ((_event: string, listener: () => void) => { errors.delete(listener); }) as any,
        },
        async close() { closes++; },
      };
    },
    async applySchema() { schemaCalls++; },
    async readState() { return state; },
    async isPristine() { return true; },
    async runImport(_environment, beforeWrite) {
      if (!await beforeWrite({ query: (async () => ({ rows: [] })) as any, release() {} })) return;
      imports++; state = complete();
    },
    log(message) { logs.push(message); },
  };
  return {
    dependencies, logs,
    counts: () => ({ imports, schemaCalls, closes, releases, locks }),
    setState(value: BootstrapState) { state = value; },
    disconnect() { for (const listener of errors) listener(); },
  };
}

test("pristine initialization applies schema, imports all data and requires durable verification", async () => {
  const f = fixture();
  assert.equal(await runAutomaticBootstrap(environment(), f.dependencies), "imported");
  assert.deepEqual(f.counts(), { imports: 1, schemaCalls: 1, closes: 1, releases: 1, locks: 0 });
});

test("completed import is skipped on every later execution without source credentials or acknowledgements", async () => {
  const f = fixture(complete());
  assert.equal(await runAutomaticBootstrap({ DATABASE_URL: environment().DATABASE_URL }, f.dependencies), "already-imported");
  assert.equal(await runAutomaticBootstrap({ DATABASE_URL: environment().DATABASE_URL }, f.dependencies), "already-imported");
  assert.equal(f.counts().imports, 0);
});

test("durable PostgreSQL authority is never cleared or replayed, even with a failed historical import", async () => {
  const f = fixture({ ...fresh(), postgresOwned: true, latestRun: { mode: "all", status: "failed", finished_at: null } });
  assert.equal(await runAutomaticBootstrap({ DATABASE_URL: environment().DATABASE_URL }, f.dependencies), "already-postgres");
  assert.equal(f.counts().imports, 0);
});

test("concurrent initializer processes serialize and only one imports", async () => {
  const f = fixture();
  const result = await Promise.all([
    runAutomaticBootstrap(environment(), f.dependencies),
    runAutomaticBootstrap(environment(), f.dependencies),
    runAutomaticBootstrap(environment(), f.dependencies),
  ]);
  assert.deepEqual(result.sort(), ["already-imported", "already-imported", "imported"]);
  assert.deepEqual(f.counts(), { imports: 1, schemaCalls: 3, closes: 3, releases: 3, locks: 0 });
});

test("source and destination writer quiescence and independent backup must be explicitly confirmed", () => {
  for (const flag of ["MIGRATION_SOURCE_WRITERS_STOPPED", "MIGRATION_TARGET_WRITERS_STOPPED", "MIGRATION_SOURCE_BACKUP_CONFIRMED"]) {
    assert.throws(() => validateAutomaticImport({ ...environment(), [flag]: undefined }, true), new RegExp(flag));
    assert.throws(() => validateAutomaticImport({ ...environment(), [flag]: "false" }, true), new RegExp(flag));
  }
  assert.doesNotThrow(() => validateAutomaticImport(environment(), true));
});

test("source URI must explicitly identify an application database including replica-set URLs", () => {
  assert.equal(sourceDatabaseName("mongodb+srv://user:pass@cluster.example/radiohub?retryWrites=true"), "radiohub");
  assert.equal(sourceDatabaseName("mongodb://host1:27017,host2:27017/radiohub?replicaSet=rs0"), "radiohub");
  for (const value of [undefined, "", "mongodb://host", "mongodb://host/", "mongodb://host/?authSource=admin", "postgresql://host/db", "mongodb://host/%2F", "mongodb://host/%", "mongodb://host/db/other"]) {
    assert.throws(() => sourceDatabaseName(value), /explicit application database/);
  }
});

test("partial imports fail closed unless deletion reconciliation has been deliberately approved", async () => {
  const f = fixture({ ...fresh(), latestRun: { mode: "all", status: "failed", finished_at: new Date() } });
  await assert.rejects(runAutomaticBootstrap(environment(), f.dependencies), /incomplete\/failed import/);
  assert.equal(f.counts().imports, 0);
  assert.throws(() => validateAutomaticImport({ ...environment(), MIGRATION_PRUNE: "true" }, false), /Reviewed reconciliation/);
  assert.throws(() => validateAutomaticImport({ ...environment(), MIGRATION_PRUNE: "true", DATABASE_MAINTENANCE_READ_ONLY: "true", MIGRATION_EXPECT_SOURCE_DATABASE: "wrong" }, false), /exactly matching/);
  assert.doesNotThrow(() => validateAutomaticImport({ ...environment(), MIGRATION_PRUNE: "true", DATABASE_MAINTENANCE_READ_ONLY: "true", MIGRATION_EXPECT_SOURCE_DATABASE: "radiohub_source" }, false));
});

test("existing destination data without migration history is not silently overwritten", async () => {
  const f = fixture();
  f.dependencies.isPristine = async () => false;
  await assert.rejects(runAutomaticBootstrap(environment(), f.dependencies), /existing rows/);
  assert.equal(f.counts().imports, 0);
});

test("automatic mode refuses collection allowlists, partial phases and intentional empty-source overrides", () => {
  for (const [flag, value] of [["MIGRATION_COLLECTIONS", "stations"], ["MIGRATION_PHASE", "mirror"], ["MIGRATION_ALLOW_EMPTY_SOURCE", "true"]]) {
    assert.throws(() => validateAutomaticImport({ ...environment(), [flag]: value }, true));
  }
});

test("latest run and every checkpoint must be durably complete before skipping or declaring success", async () => {
  assert.equal(isVerifiedImport(complete()), true);
  for (const state of [
    { ...complete(), checkpointCount: 0 },
    { ...complete(), checkpointsComplete: false },
    { ...complete(), latestRun: { mode: "mirror", status: "complete", finished_at: new Date() } },
    { ...complete(), latestRun: { mode: "all", status: "running", finished_at: null } },
    { ...complete(), latestRun: { mode: "verify", status: "complete", finished_at: null } },
  ]) assert.equal(isVerifiedImport(state), false);
  const f = fixture();
  f.dependencies.runImport = async () => undefined;
  await assert.rejects(runAutomaticBootstrap(environment(), f.dependencies), /without durable completed verification/);
  assert.equal(f.counts().locks, 0);
});

test("failed initialization releases its session lock and closes the connection without false success", async () => {
  const f = fixture();
  f.dependencies.runImport = async () => { throw new Error("source unavailable"); };
  await assert.rejects(runAutomaticBootstrap(environment(), f.dependencies), /source unavailable/);
  assert.deepEqual(f.counts(), { imports: 0, schemaCalls: 1, closes: 1, releases: 1, locks: 0 });
  assert.ok(!f.logs.some((message) => message.includes("completed successfully")));
});

test("post-import authority races still preserve durable verification evidence without any writes", async () => {
  const queries: string[] = [];
  const client = { query: async (sql: string) => {
    queries.push(sql);
    if (sql.includes("database_write_authority")) return { rows: [{}] };
    if (sql.includes("migration_runs")) return { rows: [complete().latestRun] };
    return { rows: [{ count: 3, complete: true }] };
  }, release() {} } as any;
  const state = await readBootstrapState(client);
  assert.equal(state.postgresOwned, true);
  assert.equal(isVerifiedImport(state), true);
  assert.equal(queries.length, 3);
  assert.ok(queries.every((sql) => sql.startsWith("SELECT")));
  const f = fixture();
  f.dependencies.runImport = async () => { f.setState({ ...complete(), postgresOwned: true }); };
  assert.equal(await runAutomaticBootstrap(environment(), f.dependencies), "imported");
});

test("the importer lock guard rechecks durable completion and never replays another completed initializer", async () => {
  const f = fixture();
  let allowed: boolean | undefined;
  f.dependencies.runImport = async (_environment, beforeWrite) => {
    f.setState(complete());
    allowed = await beforeWrite({ query: (async () => ({ rows: [] })) as any, release() {} });
  };
  assert.equal(await runAutomaticBootstrap(environment(), f.dependencies), "imported");
  assert.equal(allowed, false);
});

test("loss of coordinator lock fences the importer and never reports false success", async () => {
  const f = fixture();
  f.dependencies.runImport = async (_environment, beforeWrite) => {
    f.disconnect();
    await beforeWrite({ query: (async () => ({ rows: [] })) as any, release() {} });
  };
  await assert.rejects(runAutomaticBootstrap(environment(), f.dependencies), /coordinator connection was lost/);
  assert.equal(f.counts().locks, 0);
  assert.equal(f.counts().imports, 0);
});

test("eligible interrupted capture resumes only after the same candidate is rechecked under the importer lock", async () => {
  const f = fixture({ ...fresh(), latestRun: { mode: "all", status: "running", finished_at: null }, checkpointCount: 1 });
  const inspected: unknown[] = [];
  f.dependencies.inspectResume = async (client, database) => {
    inspected.push(client);
    assert.equal(database, "radiohub_source");
    return { runId: "same-initial-run" };
  };
  const runImport = f.dependencies.runImport;
  f.dependencies.runImport = async (env, beforeWrite, options) => {
    assert.equal(options?.resumeInitialCapture, true);
    assert.equal(options?.signal?.aborted, false);
    await runImport(env, beforeWrite, options);
  };
  assert.equal(await runAutomaticBootstrap(environment(), f.dependencies), "imported");
  assert.equal(inspected.length, 2);
  assert.notEqual(inspected[0], inspected[1]);
  assert.equal(f.counts().imports, 1);
});

test("initial-capture resume never bypasses writer/backup acknowledgements or partial-import restrictions", async () => {
  const interrupted = { ...fresh(), latestRun: { mode: "all", status: "running", finished_at: null }, checkpointCount: 1 };
  for (const [name, value] of [
    ["MIGRATION_SOURCE_WRITERS_STOPPED", undefined], ["MIGRATION_TARGET_WRITERS_STOPPED", undefined],
    ["MIGRATION_SOURCE_BACKUP_CONFIRMED", undefined], ["MIGRATION_COLLECTIONS", "stations"],
    ["MIGRATION_PHASE", "mirror"], ["MIGRATION_ALLOW_EMPTY_SOURCE", "true"],
  ] as const) {
    const f = fixture(interrupted);
    f.dependencies.inspectResume = async () => ({ runId: "same-initial-run" });
    await assert.rejects(runAutomaticBootstrap({ ...environment(), [name]: value }, f.dependencies));
    assert.equal(f.counts().imports, 0);
  }
});

test("a candidate that becomes ineligible or changes run identity under the data lock is never resumed", async () => {
  for (const second of [null, { runId: "different-run" }]) {
    const f = fixture({ ...fresh(), latestRun: { mode: "all", status: "running", finished_at: null }, checkpointCount: 1 });
    let inspections = 0;
    f.dependencies.inspectResume = async () => ++inspections === 1 ? { runId: "same-initial-run" } : second;
    await assert.rejects(runAutomaticBootstrap(environment(), f.dependencies), /incomplete\/failed import/);
    assert.equal(inspections, 2);
    assert.equal(f.counts().imports, 0);
  }
});

test("approved prune keeps its existing separately acknowledged path rather than enabling automatic resume", async () => {
  const f = fixture({ ...fresh(), latestRun: { mode: "all", status: "failed", finished_at: new Date() }, checkpointCount: 1 });
  f.dependencies.inspectResume = async () => { throw new Error("Automatic resume inspection must not run for prune"); };
  const runImport = f.dependencies.runImport;
  f.dependencies.runImport = async (env, beforeWrite, options) => {
    assert.equal(options?.resumeInitialCapture, false);
    await runImport(env, beforeWrite, options);
  };
  assert.equal(await runAutomaticBootstrap({ ...environment(), MIGRATION_PRUNE: "true", DATABASE_MAINTENANCE_READ_ONLY: "true", MIGRATION_EXPECT_SOURCE_DATABASE: "radiohub_source" }, f.dependencies), "imported");
});

test("coordinator disconnect immediately aborts an already-running importer without retaining its raw failure", async () => {
  const f = fixture();
  f.dependencies.runImport = async (_environment, _beforeWrite, options) => {
    assert.equal(options?.signal?.aborted, false);
    f.disconnect();
    assert.equal(options?.signal?.aborted, true);
    assert.match(options?.signal?.reason.message, /coordinator connection was lost/);
  };
  await assert.rejects(runAutomaticBootstrap(environment(), f.dependencies), /coordinator connection was lost/);
  assert.equal(f.counts().imports, 0);
  assert.equal(f.counts().closes, 1);
});

test("pristine detection quotes catalog identifiers and checks all application tables", async () => {
  const queries: string[] = [];
  const client = { query: async (sql: string) => {
    queries.push(sql);
    if (sql.includes("pg_class")) return { rows: [{ name: 'odd"name' }, { name: "users" }] };
    return { rows: sql.includes('"users"') ? [{}] : [] };
  }, release() {} } as any;
  assert.equal(await isPristineDestination(client), false);
  assert.match(queries[1], /"odd""name"/);
  assert.ok(queries[0].includes("radiohub_schema_migrations"));
});

test("bootstrap error output redacts connection strings and encoded/decoded database passwords", () => {
  const env = { DATABASE_URL: "postgresql://operator:p%40ssword@host/private", MONGODB_URI: "mongodb://operator:secret123@host/source" };
  const result = sanitizedBootstrapError(new Error(`Cannot connect ${env.DATABASE_URL} ${env.MONGODB_URI}; password p@ssword or secret123; mongodb://other:unsafe@host/db`), env);
  for (const secret of [env.DATABASE_URL, env.MONGODB_URI, "p@ssword", "secret123", "unsafe"]) assert.ok(!result.includes(secret));
});

test("the one-time importer explicitly forces primary reads and remains isolated from runtime", () => {
  const importer = readFileSync(new URL("../../../lib/legacy-migration/src/migrate-mongo-to-postgres.ts", import.meta.url), "utf8");
  const bootstrap = readFileSync(new URL("../../../lib/legacy-migration/src/auto-bootstrap-postgres.ts", import.meta.url), "utf8");
  assert.match(importer, /options\.forcePrimary === true \|\|/);
  assert.match(importer, /readPreference: finalReconciliation \? "primary" : "secondaryPreferred"/);
  assert.match(bootstrap, /runMigration\(\{ phase: "all", forcePrimary: true, beforeWrite, signal: options\?\.signal, resumeInitialCapture: options\?\.resumeInitialCapture \}\)/);
  assert.ok(importer.indexOf("options.beforeWrite(migrationLockClient)") < importer.indexOf("if (mongoUrl) {"));
  assert.doesNotMatch(bootstrap, /fsync|fsyncUnlock|deleteMany|dropDatabase/);
});
