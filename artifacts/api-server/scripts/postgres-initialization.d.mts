import type pg from "pg";

export class PostgresInitializationPendingError extends Error {
  readonly code: "POSTGRES_INITIALIZATION_PENDING";
}

export function postgresInitializationMode(environment?: NodeJS.ProcessEnv): "import" | "empty";
/** Caller must already hold the radiohub-data-migration transaction advisory lock. */
export function assertPostgresInitializationReady(
  client: Pick<pg.PoolClient, "query">,
  environment?: NodeJS.ProcessEnv,
): Promise<"existing" | "empty" | "imported">;
