import { pathToFileURL } from "node:url";
import pg from "pg";

type Environment = NodeJS.ProcessEnv;
type Connection = Pick<pg.PoolClient, "query" | "release"> & Partial<Pick<pg.PoolClient, "on" | "off">>;

export interface BootstrapState {
  postgresOwned: boolean;
  latestRun: { mode: string; status: string; finished_at: unknown } | null;
  checkpointCount: number;
  checkpointsComplete: boolean;
}

export interface BootstrapDependencies {
  connect(environment: Environment): Promise<{ client: Connection; close(): Promise<void> }>;
  applySchema(environment: Environment): Promise<void>;
  readState(client: Connection): Promise<BootstrapState>;
  isPristine(client: Connection): Promise<boolean>;
  runImport(environment: Environment, beforeWrite: (client: Connection) => Promise<boolean>): Promise<void>;
  log(message: string): void;
}

export type BootstrapResult = "already-postgres" | "already-imported" | "imported";

/** Parse just the database component; the Mongo driver validates hosts/options later. */
export function sourceDatabaseName(value: string | undefined): string {
  const match = /^mongodb(?:\+srv)?:\/\/[^/?#]+\/([^/?#]+)(?:\?[^#]*)?$/i.exec(value || "");
  let database = "";
  try { database = match ? decodeURIComponent(match[1]) : ""; } catch { /* fail closed below */ }
  if (!database || /[\s\0/\\."$*<>:|?]/.test(database)) {
    throw new Error("MONGODB_URI must be a MongoDB URL with an explicit application database name after the host; do not use a URL ending in / or only ?options");
  }
  return database;
}

export function validateAutomaticImport(environment: Environment, pristine: boolean): void {
  const database = sourceDatabaseName(environment.MONGODB_URI);
  for (const name of [
    "MIGRATION_SOURCE_WRITERS_STOPPED",
    "MIGRATION_TARGET_WRITERS_STOPPED",
    "MIGRATION_SOURCE_BACKUP_CONFIRMED",
  ]) {
    if (environment[name] !== "true") {
      throw new Error(`${name}=true is required: first stop/drain all source and target writers and confirm an independent recoverable source backup; the initializer cannot perform or infer these external operations`);
    }
  }
  if (environment.MIGRATION_COLLECTIONS?.trim()) {
    throw new Error("Automatic initialization imports every collection; remove MIGRATION_COLLECTIONS");
  }
  if (environment.MIGRATION_PHASE && environment.MIGRATION_PHASE !== "all") {
    throw new Error("Automatic initialization requires MIGRATION_PHASE=all (or unset)");
  }
  if (environment.MIGRATION_ALLOW_EMPTY_SOURCE === "true") {
    throw new Error("Automatic initialization refuses an empty source; use the separately reviewed offline migration procedure for an intentionally empty application");
  }
  if (!pristine && environment.MIGRATION_PRUNE !== "true") {
    throw new Error("Destination has an incomplete/failed import or existing rows. Automatic replay is stopped to protect newer/stale data. Review the stopped source and destination; an approved reconciliation requires MIGRATION_PRUNE=true, DATABASE_MAINTENANCE_READ_ONLY=true and the exact MIGRATION_EXPECT_SOURCE_DATABASE. Never clear PostgreSQL write-authority markers");
  }
  if (environment.MIGRATION_PRUNE === "true" &&
      (environment.DATABASE_MAINTENANCE_READ_ONLY !== "true" ||
       environment.MIGRATION_EXPECT_SOURCE_DATABASE !== database)) {
    throw new Error("Reviewed reconciliation requires DATABASE_MAINTENANCE_READ_ONLY=true and MIGRATION_EXPECT_SOURCE_DATABASE exactly matching the source database");
  }
  if (environment.DATABASE_MAINTENANCE_READ_ONLY === "true" && environment.MIGRATION_PRUNE !== "true") {
    throw new Error("DATABASE_MAINTENANCE_READ_ONLY=true requires reviewed MIGRATION_PRUNE=true; do not enable it for an ordinary pristine import");
  }
}

export function isVerifiedImport(state: BootstrapState): boolean {
  return !!state.latestRun &&
    ["all", "verify"].includes(state.latestRun.mode) &&
    state.latestRun.status === "complete" &&
    !!state.latestRun.finished_at &&
    state.checkpointCount > 0 && state.checkpointsComplete;
}

export async function readBootstrapState(client: Connection): Promise<BootstrapState> {
  const authority = await client.query("SELECT 1 FROM database_write_authority WHERE authority='postgres' LIMIT 1");
  const latest = await client.query(
    "SELECT mode,status,finished_at FROM migration_runs ORDER BY started_at DESC,id DESC LIMIT 1",
  );
  const checkpoints = await client.query(`SELECT count(*)::int AS count,
    coalesce(bool_and(status='complete' AND documents_processed=source_count AND target_count=source_count),false) AS complete
    FROM migration_checkpoints`);
  return {
    postgresOwned: authority.rows.length > 0,
    latestRun: latest.rows[0] || null,
    checkpointCount: Number(checkpoints.rows[0]?.count || 0),
    checkpointsComplete: checkpoints.rows[0]?.complete === true,
  };
}

export async function isPristineDestination(client: Connection): Promise<boolean> {
  const tables = await client.query<{ name: string }>(`SELECT c.relname AS name
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=current_schema() AND c.relkind IN ('r','p')
      AND c.relname <> 'radiohub_schema_migrations' ORDER BY c.relname`);
  for (const { name } of tables.rows) {
    // Identifiers come only from the PostgreSQL catalog; quote even unusual names.
    const identifier = '"' + name.replace(/"/g, '""') + '"';
    if ((await client.query(`SELECT 1 FROM ${identifier} LIMIT 1`)).rows.length) return false;
  }
  return true;
}

const defaults: BootstrapDependencies = {
  async connect(environment) {
    const pool = new pg.Pool({
      connectionString: environment.DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 15_000,
      lock_timeout: 60_000,
      statement_timeout: 60_000,
      ssl: environment.POSTGRES_SSL === "disable" ? false : {
        rejectUnauthorized: environment.POSTGRES_SSL_REJECT_UNAUTHORIZED !== "false",
        ...(environment.POSTGRES_SSL_CA ? { ca: environment.POSTGRES_SSL_CA.replace(/\\n/g, "\n") } : {}),
      },
      application_name: "radiohub-initial-bootstrap",
    });
    try {
      const client = await pool.connect();
      return { client, close: () => pool.end() };
    } catch (error) {
      await pool.end().catch(() => undefined);
      throw error;
    }
  },
  async applySchema(environment) {
    const { applyPostgresMigrations } = await import("../../../artifacts/api-server/scripts/apply-postgres-migrations.mjs");
    await applyPostgresMigrations({ environment });
  },
  readState: readBootstrapState,
  isPristine: isPristineDestination,
  async runImport(environment, beforeWrite) {
    // The offline importer reads process.env. Never mutate global environment to
    // inject test configuration or run multiple importers in one process.
    if (environment !== process.env) throw new Error("The real offline importer must run in its own process environment");
    const { runMigration } = await import("./migrate-mongo-to-postgres");
    await runMigration({ phase: "all", forcePrimary: true, beforeWrite });
  },
  log: (message) => console.log(message),
};

/** Dedicated operator entry point, never imported by the API/web runtime. */
export async function runAutomaticBootstrap(
  environment: Environment = process.env,
  dependencies: BootstrapDependencies = defaults,
): Promise<BootstrapResult> {
  if (!/^postgres(?:ql)?:\/\//i.test(environment.DATABASE_URL || "")) {
    throw new Error("DATABASE_URL must be the destination PostgreSQL URL");
  }
  const connection = await dependencies.connect(environment);
  let locked = false;
  let connectionFailure: Error | undefined;
  const onConnectionError = () => {
    connectionFailure = new Error("Bootstrap coordinator connection was lost; initialization must be checked before retrying");
  };
  connection.client.on?.("error", onConnectionError);
  const assertCoordinator = () => { if (connectionFailure) throw connectionFailure; };
  try {
    await connection.client.query("SELECT pg_advisory_lock(hashtext('radiohub-initial-bootstrap'))");
    locked = true;
    await dependencies.applySchema(environment);
    const state = await dependencies.readState(connection.client);
    if (state.postgresOwned) {
      dependencies.log("[bootstrap] PostgreSQL already owns application writes; MongoDB will not be contacted or replayed");
      return "already-postgres";
    }
    if (isVerifiedImport(state)) {
      dependencies.log("[bootstrap] Verified import already completed; MongoDB will not be contacted or replayed");
      return "already-imported";
    }
    const pristine = !state.latestRun && state.checkpointCount === 0 &&
      await dependencies.isPristine(connection.client);
    validateAutomaticImport(environment, pristine);
    assertCoordinator();
    dependencies.log("[bootstrap] Capturing all source collections from the primary, normalizing and verifying PostgreSQL");
    await dependencies.runImport(environment, async (migrationClient) => {
      assertCoordinator();
      // Called after acquiring the importer/runtime authority lock. This fences
      // completion races even if another coordinator's session disappeared.
      const current = await dependencies.readState(migrationClient);
      if (current.postgresOwned || isVerifiedImport(current)) return false;
      const stillPristine = !current.latestRun && current.checkpointCount === 0 &&
        await dependencies.isPristine(migrationClient);
      validateAutomaticImport(environment, stillPristine);
      assertCoordinator();
      return true;
    });
    assertCoordinator();
    const finalState = await dependencies.readState(connection.client);
    if (!isVerifiedImport(finalState)) {
      if (finalState.postgresOwned) {
        dependencies.log("[bootstrap] PostgreSQL write authority was established while waiting; MongoDB was not replayed");
        return "already-postgres";
      }
      throw new Error("Import returned without durable completed verification/checkpoints; application startup must remain blocked");
    }
    dependencies.log("[bootstrap] One-time import and verification completed successfully");
    return "imported";
  } finally {
    if (locked) {
      await connection.client.query("SELECT pg_advisory_unlock(hashtext('radiohub-initial-bootstrap'))").catch(() => undefined);
    }
    connection.client.off?.("error", onConnectionError);
    connection.client.release();
    await connection.close();
  }
}

export function sanitizedBootstrapError(error: unknown, environment: Environment = process.env): string {
  let message = error instanceof Error ? error.message : "Unknown initialization failure";
  for (const [name, value] of Object.entries(environment)) {
    if (!value || !/(?:URL|URI|PASSWORD|SECRET|TOKEN)/i.test(name)) continue;
    message = message.split(value).join("[redacted]");
    // Drivers occasionally mention a decoded password instead of the full URI.
    const password = /^[a-z][a-z\d+.-]*:\/\/[^:/@]*:([^@]*)@/i.exec(value)?.[1];
    if (password) {
      message = message.split(password).join("[redacted]");
      try { message = message.split(decodeURIComponent(password)).join("[redacted]"); } catch { /* malformed URI */ }
    }
  }
  return message.replace(/(?:mongodb(?:\+srv)?|postgres(?:ql)?):\/\/[^\s"'<>]+/gi, "[redacted database URL]");
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  runAutomaticBootstrap().catch((error) => {
    console.error("[bootstrap] " + sanitizedBootstrapError(error));
    process.exitCode = 1;
  });
}
