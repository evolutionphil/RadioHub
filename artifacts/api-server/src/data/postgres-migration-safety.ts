import type pg from "pg";
import { validatePostgresStoreConfiguration } from './postgres-store-config';
import { assertPostgresInitializationReady } from '../../scripts/postgres-initialization.mjs';

const writeStores = [
  "USER_STORE", "AUTH_STORE", "ENGAGEMENT_STORE", "NOTIFICATION_STORE",
  "MESSAGE_STORE", "BILLING_STORE", "LOCALIZATION_STORE", "STATION_WRITE_MODE",
] as const;

export function postgresOwnedDomains(environment: NodeJS.ProcessEnv = process.env): string[] {
  return writeStores.filter((name) => (environment[name] || "mongo").toLowerCase() === "postgres");
}

export function validateMigrationWriteSafety(phase: string, environment: NodeJS.ProcessEnv = process.env): void {
  if (phase === "verify") return;
  const owned = postgresOwnedDomains(environment);
  if (owned.length) {
    throw new Error(`MongoDB replay is forbidden after PostgreSQL write cutover: ${owned.join(", ")}`);
  }
  // Maintenance middleware alone does not stop jobs, WebSockets or CDC.
  if (environment.MIGRATION_TARGET_WRITERS_STOPPED !== "true") {
    throw new Error("Migration writes require MIGRATION_TARGET_WRITERS_STOPPED=true after stopping all target writers (API, web, jobs and CDC), or using an isolated target database");
  }
}

export async function assertNoPostgresWriteAuthority(client: Pick<pg.PoolClient, "query">): Promise<void> {
  const result = await client.query<{ domain: string }>(
    "SELECT domain FROM database_write_authority WHERE authority='postgres' ORDER BY domain",
  );
  if (result.rows.length) {
    throw new Error(`MongoDB replay is forbidden: durable PostgreSQL write authority exists for ${result.rows.map((row) => row.domain).join(", ")}. Use a reviewed reverse migration or a fresh staging database; do not clear cutover markers.`);
  }
}

export async function recordPostgresWriteAuthority(pool: pg.Pool, environment: NodeJS.ProcessEnv = process.env): Promise<void> {
  validatePostgresStoreConfiguration(environment);
  // These domains have no legacy switch. Record them even if old feature flags
  // were not explicitly configured, so an offline snapshot cannot overwrite
  // native writes after the first application startup.
  const domains = [...new Set([...writeStores, "SESSION_STORE", "API_ACCESS", "TV_CAST", "CATALOG_SYNC", "ADMIN_SETTINGS"])];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Same lock as the migration runner: startup cannot change authority midway
    // through a snapshot import. The operator must still stop existing writers.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('radiohub-data-migration'))");
    // A newly provisioned database must not become writable before its one-time
    // import is verified. Keep this check inside the import/cutover lock, even
    // when the deployment launcher already checked readiness.
    await assertPostgresInitializationReady(client, environment);
    const previous = await client.query<{ domain: string }>("SELECT domain FROM database_write_authority");
    const rollback = previous.rows.filter((row) => !domains.includes(row.domain));
    if (rollback.length) {
      throw new Error(`Refusing implicit PostgreSQL write-authority rollback: ${rollback.map((row) => row.domain).join(", ")}`);
    }
    for (const domain of domains) {
      await client.query("INSERT INTO database_write_authority(domain,authority) VALUES ($1,'postgres') ON CONFLICT (domain) DO NOTHING", [domain]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
