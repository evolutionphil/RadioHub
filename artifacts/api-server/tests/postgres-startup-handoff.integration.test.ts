import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { EventEmitter, once } from "node:events";
import http from "node:http";
import path from "node:path";
import { test } from "node:test";
import pg from "pg";
import { startPostgresApplication } from "../scripts/start-postgres.mjs";
import { startPostgresStartupServer } from "../scripts/postgres-startup-server.mjs";

const postgresTestUrl = process.env.PG_TEST_DATABASE_URL;
const repository = path.resolve(import.meta.dirname, "../../..");

function localTestUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Invalid disposable PostgreSQL test URL"); }
  assert.ok(["127.0.0.1", "[::1]"].includes(url.hostname), "Startup integration requires a literal loopback PostgreSQL host");
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol), "Unexpected test URL protocol");
  assert.match(decodeURIComponent(url.pathname.slice(1)), /(?:^|[_-])(?:test|tests|validation)(?:$|[_-])/i,
    "PostgreSQL database must be explicitly named as a disposable test/validation database");
  for (const key of url.searchParams.keys()) {
    assert.ok(["sslmode", "sslrootcert"].includes(key), "Test URL must not override the host, database or search path through query options");
  }
  return url;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

async function bounded<T>(promise: Promise<T>, milliseconds = 20_000): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([promise, new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Disposable startup integration timed out")), milliseconds);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

function request(port: number, pathname: string, method = "GET") {
  return new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
    const connection = http.request({ host: "127.0.0.1", port, path: pathname, method, agent: false, timeout: 3_000 }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.once("end", () => resolve({ status: response.statusCode, body }));
      response.once("error", reject);
    });
    connection.once("timeout", () => connection.destroy(new Error("Disposable startup HTTP request timed out")));
    connection.once("error", reject);
    connection.end();
  });
}

test("real PostgreSQL startup gate serves maintenance then automatically hands the same HTTP port to the application after verification", {
  skip: !postgresTestUrl,
  timeout: 45_000,
}, async () => {
  const pgUrl = localTestUrl(postgresTestUrl!);
  const schema = `startup_handoff_test_${process.pid}_${randomBytes(6).toString("hex")}`;
  const schemaPattern = /^startup_handoff_test_\d+_[a-f0-9]{12}$/;
  assert.match(schema, schemaPattern);
  const scopedUrl = new URL(pgUrl);
  scopedUrl.searchParams.set("options", `-c search_path=${schema},public`);
  const ssl = process.env.PG_TEST_SSL === "require" ? { rejectUnauthorized: true } : false;
  const admin = new pg.Pool({ connectionString: pgUrl.toString(), ssl, max: 1, connectionTimeoutMillis: 5_000, statement_timeout: 10_000 });
  const destination = new pg.Pool({ connectionString: scopedUrl.toString(), ssl, max: 1, connectionTimeoutMillis: 5_000, statement_timeout: 10_000 });
  const environment = {
    DATABASE_URL: scopedUrl.toString(), POSTGRES_SSL: ssl ? "require" : "disable",
    POSTGRES_MIGRATIONS_DIR: path.join(repository, "lib/db/migrations"),
    POSTGRES_CONNECT_TIMEOUT_MS: "5000", POSTGRES_MIGRATION_STATEMENT_TIMEOUT_MS: "10000",
    POSTGRES_MIGRATION_LOCK_TIMEOUT_MS: "5000", POSTGRES_INIT_WAIT_MS: "30000", PORT: "5000",
  };
  const controller = new AbortController();
  const signals = new EventEmitter();
  const maintenanceStarted = deferred<number>();
  const allowNextPoll = deferred<void>();
  const logs: string[] = [];
  let schemaCreated = false;
  let application: http.Server | undefined;
  let startup: Promise<unknown> | undefined;
  let maintenance: Awaited<ReturnType<typeof startPostgresStartupServer>> | undefined;
  let imported = false;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    assert.equal((await destination.query("SELECT current_schema() AS name")).rows[0].name, schema);
    startup = startPostgresApplication("dist/index-web.mjs", {
      environment, cwd: repository, signal: controller.signal, signalTarget: signals,
      log: (message: string) => logs.push(message),
      startMaintenanceServer: async (settings: Record<string, unknown>) => {
        maintenance = await startPostgresStartupServer({ ...settings, listenPort: 0, listenHost: "127.0.0.1" });
        environment.PORT = String(maintenance.port);
        maintenanceStarted.resolve(maintenance.port);
        return maintenance;
      },
      wait: async (_milliseconds: number, signal: AbortSignal) => {
        signal.throwIfAborted();
        let onAbort!: () => void;
        try {
          await Promise.race([allowNextPoll.promise, new Promise<void>((_, reject) => {
            onAbort = () => reject(signal.reason);
            signal.addEventListener("abort", onAbort, { once: true });
          })]);
          signal.throwIfAborted();
        } finally {
          signal.removeEventListener("abort", onAbort);
        }
      },
      importApplication: async (url: string) => {
        assert.match(url, /dist\/index-web\.mjs$/);
        assert.equal((await destination.query("SELECT count(*)::int AS count FROM database_write_authority")).rows[0].count, 0,
          "The startup gate must not grant database write authority itself");
        assert.equal((await destination.query("SELECT status FROM migration_runs")).rows[0].status, "complete");
        imported = true;
        application = http.createServer((_request, response) => {
          response.writeHead(200, { "Content-Type": "text/plain", Connection: "close" });
          response.end("application started after verification");
        });
        application.listen(Number(environment.PORT), "127.0.0.1");
        await once(application, "listening");
        return "automatically started";
      },
    });
    // Observe errors immediately while waiting for the first real maintenance response.
    startup.catch(() => undefined);
    const port = await bounded(Promise.race([
      maintenanceStarted.promise,
      startup.then(() => { throw new Error("Application started before maintenance and verification"); }),
    ]));
    assert.equal(imported, false);
    assert.equal((await request(port, "/healthz")).status, 200);
    assert.equal((await request(port, "/readyz")).status, 503);
    assert.equal((await request(port, "/api/favorites", "POST")).status, 503);
    assert.equal((await request(port, "/en")).status, 503);
    assert.equal(imported, false);
    assert.ok(Number((await destination.query("SELECT count(*) AS count FROM radiohub_schema_migrations")).rows[0].count) >= 24);
    assert.equal((await destination.query("SELECT count(*)::int AS count FROM migration_runs")).rows[0].count, 0);

    // This isolated fixture exercises the durable completion gate, not data conversion.
    // The separate MongoDB integration tests cover actual capture/normalization/verification.
    const writer = await destination.connect();
    try {
      await writer.query("BEGIN");
      await writer.query("SELECT pg_advisory_xact_lock(hashtext('radiohub-data-migration'))");
      await writer.query("INSERT INTO migration_runs(id,mode,status,started_at,finished_at,source_database) VALUES('synthetic-startup-run','all','complete',now(),now(),'synthetic-only')");
      await writer.query("INSERT INTO migration_checkpoints(collection_name,documents_processed,source_count,target_count,status) VALUES('synthetic-only',1,1,1,'complete')");
      await writer.query("COMMIT");
    } catch (error) {
      await writer.query("ROLLBACK");
      throw error;
    } finally {
      writer.release();
    }
    assert.equal(imported, false, "Committing metadata alone must not import the app outside the launcher gate");
    allowNextPoll.resolve();
    assert.equal(await bounded(startup), "automatically started");
    assert.equal(imported, true);
    const active = await request(port, "/en");
    assert.equal(active.status, 200);
    assert.equal(active.body, "application started after verification");
    assert.equal((await destination.query("SELECT count(*)::int AS count FROM database_write_authority")).rows[0].count, 0);
    assert.ok(logs.some((line) => line.includes("schema and initialization verified (imported)")));
    assert.equal(signals.listenerCount("SIGTERM"), 0);
    assert.equal(signals.listenerCount("SIGINT"), 0);
  } finally {
    controller.abort();
    allowNextPoll.resolve();
    try {
      if (startup) await bounded(startup.catch(() => undefined), 10_000);
    } finally {
      await maintenance?.close();
      if (application) {
        const closing = new Promise<void>((resolve) => application!.close(() => resolve()));
        application.closeAllConnections();
        await bounded(closing, 5_000);
      }
      await destination.end();
      try {
        if (schemaCreated) {
          // Only this generated schema in the validated disposable loopback database may be removed.
          assert.match(schema, schemaPattern);
          await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
        }
      } finally {
        await admin.end();
      }
    }
  }
});
