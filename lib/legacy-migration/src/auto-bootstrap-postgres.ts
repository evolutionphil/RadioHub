import { pathToFileURL } from "node:url";
import pg from "pg";
import { inspectInitialCaptureResume } from "./initial-capture-resume";

type Environment = NodeJS.ProcessEnv;
type Connection = Pick<pg.PoolClient, "query" | "release"> & Partial<Pick<pg.PoolClient, "on" | "off">>;

export interface BootstrapState {
  postgresOwned: boolean;
  latestRun: { mode: string; status: string; finished_at: unknown } | null;
  checkpointCount: number;
  checkpointsComplete: boolean;
}

export interface BootstrapDependencies {
  connect(environment: Environment): Promise<{ client: Connection; signal?: AbortSignal; close(): Promise<void> }>;
  applySchema(environment: Environment): Promise<void>;
  readState(client: Connection): Promise<BootstrapState>;
  isPristine(client: Connection): Promise<boolean>;
  diagnostics?(client: Connection, log: (message: string) => void): Promise<void>;
  inspectResume?(client: Connection, expectedSourceDb: string): Promise<{ runId: string } | null>;
  runImport(environment: Environment, beforeWrite: (client: Connection) => Promise<boolean>, options?: {
    signal?: AbortSignal; resumeInitialCapture?: boolean;
  }): Promise<void>;
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

/** Hints only: stored text cannot prove why a process exited. Never return that text. */
export function classifyBootstrapFailure(error: unknown, unfinished = false): { category: string; hint: string } {
  if (typeof error !== "string" || !error.trim()) {
    return { category: "not-recorded", hint: unfinished
      ? "Completion/error was not durably recorded: an abrupt interruption or an unrecorded failure is possible; inspect original deployment logs and exit reason."
      : "No failure text is stored; inspect original deployment logs if the import did not finish." };
  }
  const text = error.slice(0, 8192);
  const categories: Array<[string, RegExp, string]> = [
    ["interruption", /^MIGRATION_CAPTURE_INTERRUPTED:(?:SIGTERM|SIGINT|postgres-pool|postgres-client|coordinator)$/, "A controlled capture interruption was recorded; safe resume still requires source validation and an untouched native destination."],
    ["tls", /\bTLS\b|\bSSL\b|certificate|self[- ]signed/i, "Stored text suggests a TLS/certificate problem; verify trusted connection configuration."],
    ["memory", /out of memory|heap out of memory|heap limit|allocation failed|\bENOMEM\b/i, "Stored text mentions memory exhaustion; confirm with deployment memory and exit events."],
    ["verification", /verification (?:failed|refused)|parity|invalidChecksums|countMismatches/i, "Stored text suggests verification did not succeed; inspect the original failure privately."],
    ["numeric-data", /exact numeric range|out of range|invalid input syntax|duplicate key|violates .*constraint|foreign key|not-null|cannot convert|\b(?:22P02|22003|23502|23503|23505)\b/i, "Stored text suggests a numeric/data-integrity issue; inspect the original failure privately."],
    ["timeout", /timed? ?out|timeout|\bETIMEDOUT\b|statement cancellation/i, "Stored text suggests a timeout; inspect database and deployment limits."],
    ["connection", /\b(?:ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH)\b|connection (?:terminated|closed|lost|refused)|authentication failed|password authentication|server selection/i, "Stored text suggests connectivity/authentication trouble; inspect connection and deployment events."],
  ];
  for (const [category, pattern, hint] of categories) if (pattern.test(text)) return { category, hint };
  return { category: "unknown", hint: "A failure was stored but its category is unknown; inspect the original failure privately." };
}

function diagnosticLabel(value: unknown, allowed: string[]): string {
  return typeof value === "string" && allowed.includes(value) ? value : "unknown";
}

function diagnosticTime(value: unknown): string | null {
  if (!(value instanceof Date) && typeof value !== "string") return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function diagnosticCount(value: unknown): string {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? String(value) : "unknown";
  return typeof value === "string" && /^\d{1,30}$/.test(value) ? value : "unknown";
}

/** Metadata only. Checkpoints are global snapshots, not progress for the latest run. */
export async function readBootstrapDiagnostics(client: Connection) {
  // node-postgres supports per-query client timeouts; older @types/pg releases
  // omit this property from QueryConfig, so retain it through an explicit type.
  const query = (text: string): pg.QueryConfig & { query_timeout: number } => ({ text, query_timeout: 3000 });
  const latest = await client.query(query(`SELECT mode,status,started_at,finished_at,left(error,8192) AS recorded_error
    FROM migration_runs ORDER BY started_at DESC,id DESC LIMIT 1`));
  const totals = await client.query(query(`SELECT count(*)::text AS total,
    count(*) FILTER (WHERE status='complete')::text AS complete,
    count(*) FILTER (WHERE status='running')::text AS running,
    count(*) FILTER (WHERE status='mismatch')::text AS mismatch,
    coalesce(sum(documents_processed),0)::text AS documents_processed,
    coalesce(sum(source_count),0)::text AS source_count,
    coalesce(sum(target_count),0)::text AS target_count
    FROM migration_checkpoints`));
  const recent = await client.query(query(`SELECT status,documents_processed,source_count,target_count,updated_at
    FROM migration_checkpoints ORDER BY updated_at DESC,collection_name ASC LIMIT 3`));
  const run = latest.rows[0];
  const snapshot = totals.rows[0] || {};
  const counters = (row: Record<string, unknown>) => ({
    documentsProcessed: diagnosticCount(row.documents_processed),
    recordedSourceCount: diagnosticCount(row.source_count),
    recordedTargetCount: diagnosticCount(row.target_count),
  });
  return {
    latestRun: run ? {
      mode: diagnosticLabel(run.mode, ["all", "mirror", "normalize", "verify"]),
      status: diagnosticLabel(run.status, ["running", "interrupted", "complete", "failed"]),
      startedAt: diagnosticTime(run.started_at), finishedAt: diagnosticTime(run.finished_at),
      failure: classifyBootstrapFailure(run.recorded_error, !diagnosticTime(run.finished_at)),
    } : null,
    recordedMirrorCheckpointSnapshot: {
      total: diagnosticCount(snapshot.total), complete: diagnosticCount(snapshot.complete),
      running: diagnosticCount(snapshot.running), mismatch: diagnosticCount(snapshot.mismatch), ...counters(snapshot),
    },
    recentCheckpointSnapshots: recent.rows.slice(0, 3).map((row, index) => ({
      ordinal: index + 1, status: diagnosticLabel(row.status, ["pending", "running", "complete", "mismatch"]),
      updatedAt: diagnosticTime(row.updated_at), ...counters(row),
    })),
    note: "Checkpoint snapshots can span runs; target counts may remain zero/stale until a collection finishes. They do not establish data loss, normalization, verification, or a percentage complete.",
  };
}

/** Diagnostic failures must never replace a safety rejection or authorize replay. */
export async function reportBootstrapDiagnostics(client: Connection, log: (message: string) => void): Promise<void> {
  try {
    log("[bootstrap:diagnostic] " + JSON.stringify(await readBootstrapDiagnostics(client)));
  } catch {
    try { log("[bootstrap:diagnostic] Metadata report unavailable; the original initialization safety checks still apply."); } catch { /* best effort only */ }
  }
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
    const failures = new AbortController();
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
    const onPoolError = () => failures.abort(new Error("Bootstrap coordinator pool connection failed"));
    pool.on("error", onPoolError);
    try {
      const client = await pool.connect();
      return { client, signal: failures.signal, async close() {
        try { await pool.end(); } finally { pool.off("error", onPoolError); }
      } };
    } catch (error) {
      await pool.end().catch(() => undefined);
      pool.off("error", onPoolError);
      throw error;
    }
  },
  async applySchema(environment) {
    const { applyPostgresMigrations } = await import("../../../artifacts/api-server/scripts/apply-postgres-migrations.mjs");
    await applyPostgresMigrations({ environment });
  },
  readState: readBootstrapState,
  isPristine: isPristineDestination,
  async runImport(environment, beforeWrite, options) {
    // The offline importer reads process.env. Never mutate global environment to
    // inject test configuration or run multiple importers in one process.
    if (environment !== process.env) throw new Error("The real offline importer must run in its own process environment");
    const { runMigration } = await import("./migrate-mongo-to-postgres");
    await runMigration({ phase: "all", forcePrimary: true, beforeWrite, signal: options?.signal, resumeInitialCapture: options?.resumeInitialCapture });
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
  const coordinatorAbort = new AbortController();
  let locked = false;
  let connectionFailure: Error | undefined;
  const onConnectionError = () => {
    connectionFailure ||= new Error("Bootstrap coordinator connection was lost; initialization must be checked before retrying");
    coordinatorAbort.abort(connectionFailure);
  };
  connection.client.on?.("error", onConnectionError);
  connection.signal?.addEventListener("abort", onConnectionError, { once: true });
  if (connection.signal?.aborted) onConnectionError();
  const assertCoordinator = () => { if (connectionFailure) throw connectionFailure; };
  const diagnose = async (client: Connection) => {
    try { await (dependencies.diagnostics || reportBootstrapDiagnostics)(client, dependencies.log); } catch { /* never replace the original safety guard */ }
  };
  try {
    assertCoordinator();
    await connection.client.query("SELECT pg_advisory_lock(hashtext('radiohub-initial-bootstrap'))");
    locked = true;
    assertCoordinator();
    await dependencies.applySchema(environment);
    assertCoordinator();
    const state = await dependencies.readState(connection.client);
    assertCoordinator();
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
    if (!pristine) await diagnose(connection.client);
    // This first SELECT-only inspection is advisory. Eligibility is checked
    // again under the SAME session lock used for every import write.
    let initialCapture: { runId: string } | null = null;
    if (!pristine && environment.MIGRATION_PRUNE !== "true") {
      validateAutomaticImport(environment, true);
      initialCapture = await (dependencies.inspectResume || inspectInitialCaptureResume)(connection.client, sourceDatabaseName(environment.MONGODB_URI));
    }
    validateAutomaticImport(environment, pristine || !!initialCapture);
    assertCoordinator();
    dependencies.log(initialCapture
      ? "[bootstrap] Interrupted initial capture is eligible for source revalidation; existing captures will not be overwritten or pruned."
      : "[bootstrap] Capturing all source collections from the primary, normalizing and verifying PostgreSQL");
    await dependencies.runImport(environment, async (migrationClient) => {
      assertCoordinator();
      // Called after acquiring the importer/runtime authority lock. This fences
      // completion races even if another coordinator's session disappeared.
      const current = await dependencies.readState(migrationClient);
      assertCoordinator();
      if (current.postgresOwned || isVerifiedImport(current)) return false;
      const stillPristine = !current.latestRun && current.checkpointCount === 0 &&
        await dependencies.isPristine(migrationClient);
      if (!stillPristine) await diagnose(migrationClient);
      const stillEligible = !stillPristine && initialCapture
        ? await (dependencies.inspectResume || inspectInitialCaptureResume)(migrationClient, sourceDatabaseName(environment.MONGODB_URI))
        : null;
      const sameInitialCapture = !!initialCapture && stillEligible?.runId === initialCapture.runId;
      validateAutomaticImport(environment, stillPristine || sameInitialCapture);
      assertCoordinator();
      return true;
    }, { signal: coordinatorAbort.signal, resumeInitialCapture: !!initialCapture });
    assertCoordinator();
    const finalState = await dependencies.readState(connection.client);
    assertCoordinator();
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
    if (locked && !connectionFailure) {
      await connection.client.query("SELECT pg_advisory_unlock(hashtext('radiohub-initial-bootstrap'))").catch(() => undefined);
    }
    try { connection.client.release(connectionFailure); }
    finally {
      try { await connection.close(); }
      finally {
        connection.client.off?.("error", onConnectionError);
        connection.signal?.removeEventListener("abort", onConnectionError);
      }
    }
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
