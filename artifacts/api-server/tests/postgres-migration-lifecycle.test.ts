import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import type pg from "pg";
import { createMigrationLifecycle, lockedMigrationDatabase, MigrationLifecycleError } from "../../../lib/legacy-migration/src/migration-lifecycle";

const privateError = new Error("postgresql://private:password@host/database customer_id=private-customer");

test("pool and held-client errors become a fixed fatal state and abort without leaking driver data", () => {
  for (const kind of ["postgres-pool", "postgres-client"] as const) {
    const pool = new EventEmitter();
    const client = new EventEmitter();
    const signals = new EventEmitter();
    const logs: string[] = [];
    const lifecycle = createMigrationLifecycle({ pool, signalTarget: signals, log: (message) => logs.push(message) });
    lifecycle.watchClient(client);
    lifecycle.watchClient(client);
    assert.equal(client.listenerCount("error"), 1);
    assert.doesNotThrow(() => (kind === "postgres-pool" ? pool : client).emit("error", privateError));
    assert.equal(lifecycle.signal.aborted, true);
    assert.throws(() => lifecycle.assertHealthy(), (error: unknown) => error instanceof MigrationLifecycleError && error.kind === kind);
    assert.ok(lifecycle.signal.reason instanceof MigrationLifecycleError);
    assert.doesNotMatch(JSON.stringify(logs) + lifecycle.signal.reason.message, /private|password|customer_id|postgresql:\/\//);
    assert.equal(logs.length, 1);
    assert.doesNotThrow(() => pool.emit("error", privateError));
    assert.equal(logs.length, 1, "later failures cannot replace the first interruption");
    lifecycle.cleanupAfterConnectionsClosed();
  }
});

test("SIGTERM/SIGINT interrupt cooperatively and retain handlers until connections have closed", () => {
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    const pool = new EventEmitter();
    const client = new EventEmitter();
    const signals = new EventEmitter();
    let unrelatedCalls = 0;
    const unrelated = () => { unrelatedCalls += 1; };
    signals.on(signal, unrelated);
    const lifecycle = createMigrationLifecycle({ pool, signalTarget: signals });
    lifecycle.watchClient(client);
    signals.emit(signal);
    assert.throws(() => lifecycle.assertHealthy(), (error: unknown) => error instanceof MigrationLifecycleError && error.kind === signal);
    assert.equal(unrelatedCalls, 1);
    assert.equal(lifecycle.signal.aborted, true);
    assert.equal(pool.listenerCount("error"), 1);
    assert.equal(client.listenerCount("error"), 1);
    assert.doesNotThrow(() => client.emit("error", privateError), "late teardown errors remain handled");
    lifecycle.cleanupAfterConnectionsClosed();
    lifecycle.cleanupAfterConnectionsClosed();
    assert.equal(pool.listenerCount("error"), 0);
    assert.equal(client.listenerCount("error"), 0);
    assert.equal(signals.listenerCount(signal), 1, "unrelated signal handler is preserved");
    assert.equal(signals.listenerCount(signal === "SIGTERM" ? "SIGINT" : "SIGTERM"), 0);
  }
});

test("coordinator cancellation propagates even when already aborted and ignores its private reason", () => {
  for (const alreadyAborted of [false, true]) {
    const parent = new AbortController();
    if (alreadyAborted) parent.abort(privateError);
    const lifecycle = createMigrationLifecycle({ pool: new EventEmitter(), signalTarget: new EventEmitter(), parentSignal: parent.signal });
    if (!alreadyAborted) parent.abort(privateError);
    assert.throws(() => lifecycle.assertHealthy(), (error: unknown) => error instanceof MigrationLifecycleError && error.kind === "coordinator");
    assert.doesNotMatch(lifecycle.signal.reason.message, /private|password|customer_id/);
    lifecycle.cleanupAfterConnectionsClosed();
  }
});

test("logging failure cannot disable abort and cleanup forbids subsequent import work", () => {
  const pool = new EventEmitter();
  const lifecycle = createMigrationLifecycle({ pool, signalTarget: new EventEmitter(), log() { throw privateError; } });
  assert.doesNotThrow(() => pool.emit("error", privateError));
  assert.equal(lifecycle.signal.aborted, true);
  lifecycle.cleanupAfterConnectionsClosed();
  const completed = createMigrationLifecycle({ pool: new EventEmitter(), signalTarget: new EventEmitter() });
  completed.assertHealthy();
  completed.cleanupAfterConnectionsClosed();
  assert.throws(() => completed.assertHealthy(), /already closed/);
  assert.throws(() => completed.watchClient(new EventEmitter()), /after migration lifecycle cleanup/);
});

test("locked database facade uses only the lock-owning client and keeps physical release with its owner", async () => {
  const queries: unknown[] = [];
  let physicalReleases = 0;
  const client = Object.assign(new EventEmitter(), {
    async query(input: unknown) { assert.equal(this, client); queries.push(input); return { rows: [] }; },
    release() { physicalReleases += 1; },
  });
  const lifecycle = createMigrationLifecycle({ pool: new EventEmitter(), signalTarget: new EventEmitter() });
  const database = lockedMigrationDatabase(client as unknown as pg.PoolClient, lifecycle);
  await database.query("SELECT 1");
  const leased = await database.connect();
  await assert.rejects(database.connect(), /Concurrent migration database leases/);
  await leased.query("BEGIN");
  await leased.query({ text: "INSERT INTO synthetic_table VALUES (1)" });
  await leased.query("COMMIT");
  leased.release();
  assert.equal(physicalReleases, 0);
  const again = await database.connect();
  assert.equal(again, leased);
  again.release();
  assert.deepEqual(queries, ["SELECT 1", "BEGIN", { text: "INSERT INTO synthetic_table VALUES (1)" }, "COMMIT"]);
  client.release();
  assert.equal(physicalReleases, 1);
  lifecycle.cleanupAfterConnectionsClosed();
});

test("locked database refuses all new statements after interruption and permits only exact rollback cleanup", async () => {
  const queries: unknown[] = [];
  const client = Object.assign(new EventEmitter(), {
    async query(input: unknown) { queries.push(input); return { rows: [] }; }, release() {},
  });
  const pool = new EventEmitter();
  const lifecycle = createMigrationLifecycle({ pool, signalTarget: new EventEmitter() });
  const database = lockedMigrationDatabase(client as unknown as pg.PoolClient, lifecycle);
  const lease = await database.connect();
  pool.emit("error", privateError);
  for (const input of ["COMMIT", "INSERT INTO synthetic_table VALUES (1)", "ROLLBACK; DELETE FROM synthetic_table", { text: "SELECT 1" }]) {
    await assert.rejects(async () => { await (database.query as (input: unknown) => Promise<unknown>)(input); }, MigrationLifecycleError);
    await assert.rejects(async () => { await (lease.query as (input: unknown) => Promise<unknown>)(input); }, MigrationLifecycleError);
  }
  await assert.rejects(database.connect(), MigrationLifecycleError);
  await lease.query("ROLLBACK");
  await database.query({ text: "  rollback;  " });
  assert.deepEqual(queries, ["ROLLBACK", { text: "  rollback;  " }]);
  lease.release();
  lifecycle.cleanupAfterConnectionsClosed();
});

test("real pg pool lifecycle reproduces unhandled errors in child processes and captures them with the helper", () => {
  const helperUrl = new URL("../../../lib/legacy-migration/src/migration-lifecycle.ts", import.meta.url).href;
  for (const kind of ["checked-out-lock-client", "released-pool-client"]) {
    for (const fixed of [false, true]) {
      // Actual installed pg pool, fake transport: no database or network access.
      const script = `
        import { EventEmitter } from 'node:events';
        import pg from ${JSON.stringify(import.meta.resolve("pg"))};
        import { createMigrationLifecycle } from ${JSON.stringify(helperUrl)};
        class FakeClient extends EventEmitter {
          constructor() { super(); this._queryable = true; this._ending = false; }
          connect(callback) { queueMicrotask(() => callback(null)); }
          end(callback) { if (callback) callback(); }
        }
        const pool = new pg.Pool({ Client: FakeClient, max: 5, idleTimeoutMillis: 1000 });
        const lifecycle = ${fixed} ? createMigrationLifecycle({ pool, signalTarget: new EventEmitter() }) : undefined;
        const client = await pool.connect();
        if (${JSON.stringify(kind)} === 'checked-out-lock-client') lifecycle?.watchClient(client);
        else client.release();
        console.log('RUNNING');
        try {
          setImmediate(() => client.emit('error', new Error('Synthetic connection failure')));
          await new Promise(resolve => setTimeout(resolve, 20));
          lifecycle?.assertHealthy();
          console.log('UNEXPECTED_SUCCESS');
        } catch (error) {
          console.log('CONTROLLED_FAILURE:' + error.code);
        } finally {
          if (${JSON.stringify(kind)} === 'checked-out-lock-client') client.release(new Error('Discard synthetic client'));
          await pool.end();
          lifecycle?.cleanupAfterConnectionsClosed();
          console.log('FINALIZED');
        }
      `;
      const child = spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), "--input-type=module", "-e", script], {
        encoding: "utf8", timeout: 10_000, windowsHide: true,
      });
      assert.ifError(child.error);
      if (fixed) {
        assert.equal(child.status, 0, child.stderr);
        assert.match(child.stdout, /CONTROLLED_FAILURE:MIGRATION_INTERRUPTED/);
        assert.match(child.stdout, /FINALIZED/);
        assert.doesNotMatch(child.stderr, /Unhandled 'error' event/);
      } else {
        assert.equal(child.status, 1);
        assert.match(child.stderr, /Unhandled 'error' event/);
        assert.doesNotMatch(child.stdout, /CONTROLLED_FAILURE|FINALIZED/);
      }
      assert.doesNotMatch(child.stdout, /UNEXPECTED_SUCCESS/);
    }
  }
});

test("actual importer records a cooperative SIGTERM capture marker and revalidates/resumes that same run", () => {
  const importerUrl = new URL("../../../lib/legacy-migration/src/migrate-mongo-to-postgres.ts", import.meta.url).href;
  const resumeUrl = new URL("../../../lib/legacy-migration/src/initial-capture-resume.ts", import.meta.url).href;
  const legacyRequire = createRequire(new URL("../../../lib/legacy-migration/package.json", import.meta.url));
  // Windows does not deliver POSIX SIGTERM to children. Inject the process signal
  // event in an isolated child; actual runMigration and resume validators run,
  // while database transports are in-memory fakes and cannot open a socket.
  const script = `
    import assert from 'node:assert/strict';
    import { EventEmitter } from 'node:events';
    import pg from ${JSON.stringify(import.meta.resolve("pg"))};
    import { MongoClient } from ${JSON.stringify(pathToFileURL(legacyRequire.resolve("mongodb")).href)};
    const documents = Array.from({ length: 11 }, (_, index) => ({ _id: 'synthetic-' + String(index).padStart(2, '0'), value: index }));
    const captures = new Map();
    let run;
    let starts = 0;
    let resumeStarts = 0;
    let conflicts = 0;
    let poolQueries = 0;
    let releases = 0;
    let closes = 0;
    let blockCommit = false;
    let blockedReleases = 0;
    let checkpoint;
    const rows = (value) => ({ rows: value, rowCount: value.length });
    class FakeClient extends EventEmitter {
      closed = false;
      rejectBlocked = undefined;
      async query(input, values = []) {
        if (this.closed) throw new Error('Synthetic connection already closed');
        const sql = typeof input === 'string' ? input : input.text;
        if (blockCommit && sql === 'COMMIT') {
          queueMicrotask(() => process.emit('SIGTERM'));
          return await new Promise((_resolve, reject) => { this.rejectBlocked = reject; });
        }
        if (sql.includes('INSERT INTO migration_runs')) {
          assert.equal(run, undefined);
          run = { id: values[0], mode: values[1], status: 'running', source_database: values[2], finished_at: null, error: null, stats: {} };
          starts++;
        } else if (sql.includes("UPDATE migration_runs SET status='running'")) {
          assert.equal(values[0], run.id);
          run.status = 'running'; run.error = null; run.finished_at = null; resumeStarts++;
        } else if (sql.includes('UPDATE migration_runs SET status=$2')) {
          assert.equal(values[0], run.id);
          run.status = values[1]; run.finished_at = values[1] === 'interrupted' ? null : new Date();
          run.stats = JSON.parse(values[2]); run.error = values[3];
        } else if (sql.includes('INSERT INTO legacy_documents')) {
          for (let offset = 0; offset < values.length; offset += 8) {
            const [collection_name, document_id, payload, digest, last_seen_run_id, _time, bson_payload, bson_checksum] = values.slice(offset, offset + 8);
            if (captures.has(document_id)) {
              assert.ok(sql.includes('DO NOTHING'), 'resume must be insert-only'); conflicts++;
            } else captures.set(document_id, { collection_name, document_id, payload: JSON.parse(payload), checksum: digest, last_seen_run_id, bson_payload: JSON.parse(bson_payload), bson_checksum });
          }
        } else if (sql.includes('INSERT INTO migration_checkpoints')) {
          checkpoint = { source_count: values[3], documents_processed: values[2], status: 'running' };
        } else if (sql.includes('FROM migration_runs ORDER BY')) {
          return rows(run ? [{ ...run, error_absent: run.error === null, capture_retry: run.stats.initialCaptureRetry === true,
            controlled_interruption: values[0].includes(run.error) }] : []);
        } else if (sql.includes('has_captures')) {
          return rows([{ has_captures: captures.size > 0, foreign_owner: [...captures.values()].some(item => item.last_seen_run_id !== values[0]) }]);
        } else if (sql.includes('UNION SELECT collection_name FROM migration_checkpoints')) {
          return rows([{ collection_name: 'synthetic' }]);
        } else if (sql.includes('SELECT source_count FROM migration_checkpoints')) {
          return rows(checkpoint ? [checkpoint] : []);
        } else if (sql.includes('AS captured_count')) {
          return rows([{ captured_count: String(captures.size) }]);
        } else if (sql.includes('AS encoded_bytes')) {
          return rows([...captures.values()].filter(item => values[1] === null || item.document_id > values[1])
            .slice(0, values[2]).map(item => ({ document_id: item.document_id, encoded_bytes: String(Buffer.byteLength(JSON.stringify(item.payload)) + Buffer.byteLength(JSON.stringify(item.bson_payload))) })));
        } else if (sql.includes('document_id=ANY')) {
          return rows([...captures.values()].filter(item => values[1].includes(item.document_id)));
        }
        return rows([]);
      }
      release(discard) {
        assert.equal(discard, true); assert.equal(this.closed, false, 'physical client must be released only once');
        this.closed = true; releases++;
        if (this.rejectBlocked) { blockedReleases++; this.rejectBlocked(new Error('Synthetic active query destroyed by release')); }
      }
      async end() {}
    }
    class FakePool extends EventEmitter {
      async connect() { return new FakeClient(); }
      async query() { poolQueries++; throw new Error('No query may escape the lock-owning session'); }
      async end() { closes++; }
    }
    pg.Pool = FakePool;
    MongoClient.prototype.connect = async function () { return this; };
    MongoClient.prototype.close = async function () {};
    MongoClient.prototype.db = function () {
      return {
        databaseName: 'synthetic_source',
        listCollections() { return { async toArray() { return [{ name: 'synthetic' }]; } }; },
        collection() { return {
          async countDocuments() { return documents.length; },
          find(filter) {
            const selected = filter._id ? documents.filter(item => filter._id.$in.includes(item._id)) : documents;
            return {
              sort() { return this; }, batchSize() { return this; }, async close() {},
              async *[Symbol.asyncIterator]() {
                for (let index = 0; index < selected.length; index++) {
                  if (!filter._id && index === 10 && !blockCommit) process.emit('SIGTERM');
                  yield selected[index];
                }
              },
            };
          },
        }; },
      };
    };
    for (const name of Object.keys(process.env)) {
      if (/^(?:MIGRATION_|DATABASE_MAINTENANCE|USER_STORE|AUTH_STORE|ENGAGEMENT_STORE|NOTIFICATION_STORE|MESSAGE_STORE|BILLING_STORE|LOCALIZATION_STORE|STATION_WRITE_MODE)/.test(name)) delete process.env[name];
    }
    Object.assign(process.env, {
      DATABASE_URL: 'postgresql://127.0.0.1/disposable_test', MONGODB_URI: 'mongodb://127.0.0.1/synthetic_source',
      POSTGRES_SSL: 'disable', MIGRATION_BATCH_SIZE: '10', MIGRATION_TARGET_WRITERS_STOPPED: 'true',
      MIGRATION_SOURCE_WRITERS_STOPPED: 'true', MIGRATION_SOURCE_BACKUP_CONFIRMED: 'true',
    });
    const { runMigration } = await import(${JSON.stringify(importerUrl)});
    const { inspectInitialCaptureResume } = await import(${JSON.stringify(resumeUrl)});
    const signalsBefore = process.listenerCount('SIGTERM');
    await assert.rejects(runMigration({ phase: 'all' }), (error) => error.code === 'MIGRATION_INTERRUPTED' && error.kind === 'SIGTERM');
    assert.equal(captures.size, 10);
    assert.equal(run.status, 'interrupted'); assert.equal(run.finished_at, null);
    assert.equal(run.error, 'MIGRATION_CAPTURE_INTERRUPTED:SIGTERM');
    assert.equal(run.stats.initialCaptureRetry, true);
    const firstRunId = run.id;
    assert.deepEqual(await inspectInitialCaptureResume(new FakeClient(), 'synthetic_source'), { runId: firstRunId });
    await assert.rejects(runMigration({ phase: 'all', resumeInitialCapture: true }), (error) => error.code === 'MIGRATION_INTERRUPTED' && error.kind === 'SIGTERM');
    assert.equal(run.id, firstRunId); assert.equal(starts, 1); assert.equal(resumeStarts, 1);
    assert.equal(conflicts, 10); assert.equal(captures.size, 10);
    assert.equal(run.error, 'MIGRATION_CAPTURE_INTERRUPTED:SIGTERM');
    assert.equal(poolQueries, 0); assert.equal(releases, 2); assert.equal(closes, 2);
    assert.equal(process.listenerCount('SIGTERM'), signalsBefore);
    console.log('IMPORTER_SIGNAL_CAPTURE_RESUME_VERIFIED');
    // A blocked COMMIT cannot defer signal handling until the five-minute
    // statement timeout: the owner discards this same lock session after 5s.
    // The transport fixture does not claim transaction durability; real SQL
    // commit/rollback behavior is covered by PostgreSQL integration tests.
    run = undefined; captures.clear(); checkpoint = undefined; blockCommit = true;
    const startedAt = performance.now();
    const syntheticSocketHandle = setInterval(() => {}, 1000);
    try {
      await assert.rejects(runMigration({ phase: 'all' }), (error) => error.code === 'MIGRATION_INTERRUPTED' && error.kind === 'SIGTERM');
    } finally { clearInterval(syntheticSocketHandle); }
    const duration = performance.now() - startedAt;
    assert.ok(duration >= 4000 && duration < 8000, 'blocked query drain must finish within 8 seconds');
    assert.equal(blockedReleases, 1); assert.equal(releases, 3); assert.equal(closes, 3);
    assert.equal(poolQueries, 0); assert.equal(run.status, 'running'); assert.equal(run.error, null);
    assert.equal(process.listenerCount('SIGTERM'), signalsBefore);
    console.log('IMPORTER_BLOCKED_SQL_DRAIN_VERIFIED');
  `;
  const child = spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), "--input-type=module", "-e", script], {
    encoding: "utf8", timeout: 20_000, windowsHide: true,
  });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /IMPORTER_SIGNAL_CAPTURE_RESUME_VERIFIED/);
  assert.match(child.stdout, /IMPORTER_BLOCKED_SQL_DRAIN_VERIFIED/);
});
