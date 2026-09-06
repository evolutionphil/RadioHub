import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { applyPostgresMigrations, postgresMigrationConnectionOptions, postgresMigrationLockTimeout, safePostgresInitializationError } from "./apply-postgres-migrations.mjs";
import { assertPostgresInitializationReady, postgresInitializationMode, PostgresInitializationPendingError } from "./postgres-initialization.mjs";

const allowedEntries = new Set(["dist/index-api.mjs", "dist/index-web.mjs", "dist/index.mjs"]);

function initializationWaitMilliseconds(environment) {
  if (environment.POSTGRES_INIT_WAIT_MS === undefined) return 240_000;
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
  log = console.log,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now = Date.now,
} = {}) {
  if (!allowedEntries.has(entry)) throw new Error("PostgreSQL launcher requires dist/index-api.mjs, dist/index-web.mjs or dist/index.mjs");
  postgresInitializationMode(environment);
  const waitMilliseconds = initializationWaitMilliseconds(environment);
  const connectionOptions = postgresMigrationConnectionOptions(environment);
  await applyMigrations({ environment, cwd, log });
  const pool = createPool({ ...connectionOptions, application_name: "radiohub-startup-gate" });
  let state;
  let waitingLogged = false;
  const deadline = now() + waitMilliseconds;
  try {
    while (true) {
      let client;
      let transaction = false;
      let nextWait;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        transaction = true;
        await client.query("SELECT set_config('lock_timeout', $1, true)", [String(postgresMigrationLockTimeout(environment))]);
        const lock = await client.query("SELECT pg_try_advisory_xact_lock(hashtext('radiohub-data-migration')) AS acquired");
        if (!lock.rows[0]?.acquired) throw new PostgresInitializationPendingError("PostgreSQL data initialization is in progress in another process");
        state = await assertPostgresInitializationReady(client, environment);
        await client.query("COMMIT");
        transaction = false;
        break;
      } catch (error) {
        if (client && transaction) await client.query("ROLLBACK").catch(() => undefined);
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
        client?.release();
      }
      await wait(nextWait);
    }
  } finally {
    await pool.end();
  }
  log(`[postgres-start] schema and initialization verified (${state}); starting ${entry}`);
  return importApplication(pathToFileURL(path.resolve(cwd, entry)).href);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  startPostgresApplication(process.argv[2]).catch((error) => {
    console.error(`[postgres-start] ${safePostgresInitializationError(error)}`);
    process.exitCode = 1;
  });
}
