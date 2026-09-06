import pg from "pg";
import { logger } from "./utils/logger";
import { validatePostgresStoreConfiguration } from "./data/postgres-store-config";
import { recordPostgresWriteAuthority } from "./data/postgres-migration-safety";

export { validatePostgresStoreConfiguration } from "./data/postgres-store-config";

const { Pool } = pg;

export const isPostgresRequired = (): boolean => true;

let pool: pg.Pool | null = null;
let coordinationPool: pg.Pool | null = null;

function positiveInt(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

export function postgresSsl(): false | { rejectUnauthorized: boolean; ca?: string } {
  if (process.env.POSTGRES_SSL === "disable") return false;
  const ca = process.env.POSTGRES_SSL_CA?.replace(/\\n/g, "\n");
  return {
    rejectUnauthorized: process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED !== "false",
    ...(ca ? { ca } : {}),
  };
}

function postgresUrl(): string {
  const value = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
  if (!/^postgres(?:ql)?:\/\//i.test(value)) {
    throw new Error(
      "DATABASE_URL (or POSTGRES_URL) must be a PostgreSQL URL; PostgreSQL is required by the application",
    );
  }
  return value;
}

function createPool(coordination: boolean): pg.Pool {
  const max = positiveInt(coordination ? process.env.POSTGRES_COORDINATION_POOL_MAX : process.env.POSTGRES_POOL_MAX, 10, 100);
  const created = new Pool({
    connectionString: postgresUrl(),
    max,
    min: coordination ? 0 : Math.max(0, Math.min(Number.parseInt(process.env.POSTGRES_POOL_MIN || "0", 10) || 0, max)),
    connectionTimeoutMillis: positiveInt(process.env.POSTGRES_CONNECT_TIMEOUT_MS, 10_000, 120_000),
    idleTimeoutMillis: positiveInt(process.env.POSTGRES_IDLE_TIMEOUT_MS, 30_000, 600_000),
    keepAlive: true,
    statement_timeout: positiveInt(process.env.POSTGRES_STATEMENT_TIMEOUT_MS, 60_000, 3_600_000),
    idle_in_transaction_session_timeout: positiveInt(process.env.POSTGRES_IDLE_TRANSACTION_TIMEOUT_MS, 60_000, 600_000),
    application_name: (process.env.POSTGRES_APPLICATION_NAME || "megaradio-api") + (coordination ? '-coordination' : ''),
    ssl: postgresSsl(),
  });
  created.on("error", (error) => {
    logger.error("PostgreSQL idle-client error:", error.message);
  });
  return created;
}

export function getPostgresPool(): pg.Pool {
  return pool ||= createPool(false);
}

/** Held session locks/LISTEN must not consume the capacity needed by their own work. */
export function getPostgresCoordinationPool(): pg.Pool {
  return coordinationPool ||= createPool(true);
}

export async function initializePostgres(): Promise<void> {
  validatePostgresStoreConfiguration();
  const client = getPostgresPool();
  const requiredTables = [
    "migration_runs","migration_checkpoints","legacy_documents","database_write_authority",
    "stations","station_genres","countries","languages","genres","users","user_favorites","user_follows","station_ratings","listening_history",
    "auth_tokens","user_sessions","user_notifications","direct_messages","subscriptions","payment_events",
    "translation_keys","translations","url_translations","translation_languages","translation_metadata","country_language_mappings","country_language_mapping_audit",
    "seo_qualified_languages_lkg","admin_settings","admin_setting_history","catalog_sync_runs","station_blacklist",
    "api_keys","api_developer_users","api_demo_usage","api_developer_sessions","auth_event_logs",
    "tv_device_codes","user_devices","cast_sessions","cast_commands","cast_now_playing","cast_events","cast_connections","push_tokens",
    "tv_version_config","tv_telemetry","tv_telemetry_daily","stripe_subscription_plans",
    "visitor_sessions","runtime_app_state","bulk_description_jobs",
    "recommendation_profiles","user_music_profiles","station_similarities","recommendation_events","listening_sessions",
    "genre_counts","genre_whitelist_overrides","genre_station_counts_runs","genre_whitelist_push_logs",
    "indexnow_logs","indexnow_submission_urls","sitemap_url_snapshots","sitemap_manifests",
    "gsc_url_inspections","gsc_indexing_snapshots","gsc_oauth_tokens","gsc_inspection_quota","gsc_oauth_states",
    "advertisements","footer_social_media","seo_metadata","app_logs","feedback",
    "coverage_snapshots","coverage_backfill_status","coverage_backfill_runs","backfill_runs","station_debug_logs","admin_maintenance_jobs",
    "admin_preferences","shared_comparison_presets","semrush_issues","analytics_events",
    "genre_merge_audit_logs","genre_slug_cleanup_runs",
  ];
  const missing = await client.query<{ name: string }>(
    "SELECT name FROM unnest($1::text[]) AS name WHERE to_regclass(name) IS NULL", [requiredTables]);
  if (missing.rowCount) throw new Error(`PostgreSQL schema is incomplete; missing tables: ${missing.rows.map(row=>row.name).join(", ")}`);
  await recordPostgresWriteAuthority(client);
  logger.log("PostgreSQL schema and write authority verified");
}

export async function getPostgresHealth(): Promise<{
  enabled: boolean;
  status: "disabled" | "connected" | "error";
  latencyMs: number;
  error?: string;
}> {
  const startedAt = Date.now();
  try {
    const healthQuery = { text:"select 1",query_timeout:3000 };
    await getPostgresPool().query(healthQuery);
    return {
      enabled: true,
      status: "connected",
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      enabled: true,
      status: "error",
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

let availabilityProbe: Promise<boolean> | undefined;
let availabilityUntil = 0;
/** Coalesce health probes so the circuit breaker adds at most one read/sec. */
export function postgresAvailable(): Promise<boolean> {
  if (availabilityProbe && Date.now() < availabilityUntil) return availabilityProbe;
  availabilityUntil = Date.now()+1000;
  availabilityProbe = getPostgresHealth().then(result=>result.status==='connected');
  return availabilityProbe;
}

export async function getPostgresMigrationStatus(): Promise<{
  lastRun: null | { mode: string; status: string; startedAt: Date; finishedAt: Date | null };
  checkpoints: { complete: number; mismatch: number; running: number };
} | null> {
  if (!isPostgresRequired()) return null;
  const [run, checkpoints] = await Promise.all([
    getPostgresPool().query<{
      mode: string; status: string; started_at: Date; finished_at: Date | null;
    }>(
      `SELECT mode,status,started_at,finished_at FROM migration_runs
       ORDER BY started_at DESC LIMIT 1`,
    ),
    getPostgresPool().query<{ status: string; count: string }>(
      "SELECT status,count(*)::text count FROM migration_checkpoints GROUP BY status",
    ),
  ]);
  const counts = { complete: 0, mismatch: 0, running: 0 };
  for (const row of checkpoints.rows) {
    if (row.status in counts) counts[row.status as keyof typeof counts] = Number(row.count);
  }
  const latest = run.rows[0];
  return {
    lastRun: latest ? {
      mode: latest.mode,
      status: latest.status,
      startedAt: latest.started_at,
      finishedAt: latest.finished_at,
    } : null,
    checkpoints: counts,
  };
}

export async function closePostgres(): Promise<void> {
  availabilityProbe = undefined;
  availabilityUntil = 0;
  const activePools = [pool,coordinationPool].filter((value): value is pg.Pool => value !== null);
  pool = null;
  coordinationPool = null;
  await Promise.all(activePools.map(activePool => activePool.end()));
}
