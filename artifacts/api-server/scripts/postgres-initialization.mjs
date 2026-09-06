export class PostgresInitializationPendingError extends Error {
  code = "POSTGRES_INITIALIZATION_PENDING";
}

/** Default to preserving an existing installation until its one-time import is verified. */
export function postgresInitializationMode(environment = process.env) {
  const mode = (environment.POSTGRES_INIT_MODE || "import").toLowerCase();
  if (mode !== "import" && mode !== "empty") {
    throw new Error("POSTGRES_INIT_MODE must be import (default) or empty (explicitly start a new installation without old data)");
  }
  return mode;
}

/** Caller MUST hold the radiohub-data-migration transaction advisory lock. */
export async function assertPostgresInitializationReady(client, environment = process.env) {
  const mode = postgresInitializationMode(environment);
  const authority = await client.query("SELECT domain FROM database_write_authority WHERE authority='postgres' LIMIT 1");
  if (authority.rows.length) return "existing";
  const runs = await client.query("SELECT id,mode,status,finished_at FROM migration_runs ORDER BY started_at DESC,id DESC LIMIT 1");
  const latest = runs.rows[0];
  if (mode === "empty") {
    const evidence = await client.query(`SELECT
      EXISTS (SELECT 1 FROM legacy_documents) AS has_documents,
      EXISTS (SELECT 1 FROM migration_checkpoints) AS has_checkpoints`);
    if (latest || evidence.rows[0]?.has_documents || evidence.rows[0]?.has_checkpoints) {
      throw new Error("POSTGRES_INIT_MODE=empty cannot bypass an attempted data import. Complete and verify the import, then use POSTGRES_INIT_MODE=import; do not clear migration records.");
    }
    return "empty";
  }
  if (!latest || !["all", "verify"].includes(latest.mode) || latest.status !== "complete" || !latest.finished_at) {
    throw new PostgresInitializationPendingError("PostgreSQL schema is installed, but the one-time data import is not verified. Run the initializer and finish verification before starting API/web. Use POSTGRES_INIT_MODE=empty only for an intentional new installation without old data.");
  }
  const checkpoints = await client.query(`SELECT count(*)::int AS checkpoint_count,
    count(*) FILTER (WHERE status IS DISTINCT FROM 'complete'
      OR documents_processed <> source_count OR source_count <> target_count)::int AS incomplete_count
    FROM migration_checkpoints`);
  if (!Number(checkpoints.rows[0]?.checkpoint_count) || Number(checkpoints.rows[0]?.incomplete_count)) {
    throw new PostgresInitializationPendingError("PostgreSQL data import has incomplete or mismatched checkpoints. Complete and verify the initializer before starting API/web.");
  }
  return "imported";
}
