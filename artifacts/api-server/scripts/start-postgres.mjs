import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { setTimeout as delay } from "node:timers/promises";
import { applyPostgresMigrations, postgresMigrationConnectionOptions, postgresMigrationLockTimeout, safePostgresInitializationError } from "./apply-postgres-migrations.mjs";
import { assertPostgresInitializationReady, postgresInitializationMode, PostgresInitializationPendingError } from "./postgres-initialization.mjs";
import { startPostgresStartupServer } from "./postgres-startup-server.mjs";

const allowedEntries = new Set(["dist/index-api.mjs", "dist/index-web.mjs", "dist/index.mjs"]);

function initializationWaitMilliseconds(environment) {
  if (environment.POSTGRES_INIT_WAIT_MS === undefined || environment.POSTGRES_INIT_WAIT_MS === "forever") return Infinity;
  const value = Number(environment.POSTGRES_INIT_WAIT_MS);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("POSTGRES_INIT_WAIT_MS must be a non-negative integer in milliseconds");
  return Math.min(value, 3_600_000);
}

/** Schema and import checks run before the application module or its jobs are loaded. */
export async function startPostgresApplication(entry, {
  environment = process.env,
  cwd = process.cwd(),
  applyMigrations = applyPostgresMigrations,
  createPool = (options) => new pg.Pool(options),
  importApplication = (url) => import(url),
  startMaintenanceServer = startPostgresStartupServer,
  log = console.log,
  wait = (milliseconds, signal) => delay(milliseconds, undefined, { signal }),
  now = Date.now,
  signal,
  signalTarget = process,
} = {}) {
  if (!allowedEntries.has(entry)) throw new Error("PostgreSQL launcher requires dist/index-api.mjs, dist/index-web.mjs or dist/index.mjs");
  postgresInitializationMode(environment);
  const waitMilliseconds = initializationWaitMilliseconds(environment);
  const connectionOptions = postgresMigrationConnectionOptions(environment);
  if (signal?.aborted) throw new Error("PostgreSQL startup was interrupted; application was not started");
  await applyMigrations({ environment, cwd, log });
  const pool = createPool({ ...connectionOptions, application_name: "radiohub-startup-gate" });
  const controller = new AbortController();
  const watchedClients = new Map();
  let failure;
  let activeClient;
  let drainDeadline;
  let maintenance;
  const releaseActive = (destroy = false) => {
    if (!activeClient) return;
    const client = activeClient;
    activeClient = undefined;
    client.release(destroy);
  };
  const interrupt = (message) => {
    if (failure) return;
    failure = new Error(message);
    controller.abort(failure);
    drainDeadline = setTimeout(() => releaseActive(true), 5_000);
    drainDeadline.unref();
  };
  const onDatabaseError = () => interrupt("PostgreSQL startup connection was lost; application was not started");
  const onStop = () => interrupt("PostgreSQL startup was interrupted; application was not started");
  const onServerError = () => interrupt("PostgreSQL maintenance listener failed; application was not started");
  const assertHealthy = () => { if (failure) throw failure; };
  pool.on?.("error", onDatabaseError);
  signalTarget.on("SIGTERM", onStop);
  signalTarget.on("SIGINT", onStop);
  signal?.addEventListener("abort", onStop, { once: true });
  if (signal?.aborted) onStop();
  let state;
  let waitingLogged = false;
  const deadline = now() + waitMilliseconds;
  try {
    while (true) {
      assertHealthy();
      let client;
      let transaction = false;
      let nextWait;
      try {
        client = await pool.connect();
        activeClient = client;
        if (!watchedClients.has(client)) {
          const watched = client;
          const onEnd = () => {
            watched.off?.("error", onDatabaseError);
            watched.off?.("end", onEnd);
            watchedClients.delete(watched);
          };
          watchedClients.set(client, onEnd);
          client.on?.("error", onDatabaseError);
          client.once?.("end", onEnd);
        }
        assertHealthy();
        await client.query("BEGIN");
        transaction = true;
        await client.query("SELECT set_config('lock_timeout', $1, true)", [String(postgresMigrationLockTimeout(environment))]);
        const lock = await client.query("SELECT pg_try_advisory_xact_lock(hashtext('radiohub-data-migration')) AS acquired");
        if (!lock.rows[0]?.acquired) throw new PostgresInitializationPendingError("PostgreSQL data initialization is in progress in another process");
        state = await assertPostgresInitializationReady(client, environment);
        await client.query("COMMIT");
        transaction = false;
        assertHealthy();
        break;
      } catch (error) {
        if (client && transaction) await client.query("ROLLBACK").catch(() => undefined);
        assertHealthy();
        if (error?.code !== "POSTGRES_INITIALIZATION_PENDING") throw error;
        const remaining = deadline - now();
        if (remaining <= 0) {
          error.message += " Initialization wait deadline reached; check the initializer service before retrying.";
          throw error;
        }
        if (!waitingLogged) {
          log("[postgres-start] waiting for the one-time data import to finish verification; application and jobs remain stopped");
          waitingLogged = true;
        }
        nextWait = Math.min(5_000, remaining);
      } finally {
        releaseActive(!!failure);
      }
      // Only an established pending import enters maintenance. Schema errors
      // and normal ready restarts never get a premature liveness response.
      if (!maintenance) {
        maintenance = await startMaintenanceServer({ environment, entry, log });
        maintenance.failureSignal?.addEventListener("abort", onServerError, { once: true });
        if (maintenance.failureSignal?.aborted) onServerError();
      }
      assertHealthy();
      try { await wait(nextWait, controller.signal); }
      catch (error) { assertHealthy(); throw error; }
    }
  } finally {
    try {
      await maintenance?.close();
    } finally {
      try { await pool.end(); }
      finally {
        clearTimeout(drainDeadline);
        maintenance?.failureSignal?.removeEventListener("abort", onServerError);
        for (const [client, onEnd] of watchedClients) {
          client.off?.("error", onDatabaseError);
          client.off?.("end", onEnd);
        }
        watchedClients.clear();
        pool.off?.("error", onDatabaseError);
        signalTarget.off("SIGTERM", onStop);
        signalTarget.off("SIGINT", onStop);
        signal?.removeEventListener("abort", onStop);
      }
    }
  }
  assertHealthy();
  log(`[postgres-start] schema and initialization verified (${state}); starting ${entry}`);
  return importApplication(pathToFileURL(path.resolve(cwd, entry)).href);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  startPostgresApplication(process.argv[2]).catch((error) => {
    console.error(`[postgres-start] ${safePostgresInitializationError(error)}`);
    process.exitCode = 1;
  });
}
