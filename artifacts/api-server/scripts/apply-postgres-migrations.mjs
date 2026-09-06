import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import pg from "pg";

function positiveMilliseconds(value, fallback, maximum) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

/** The schema installer and first-start launcher use the same bounded TLS connection. */
export function postgresMigrationConnectionOptions(environment = process.env) {
  const databaseUrl = environment.DATABASE_URL || environment.POSTGRES_URL || "";
  if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl)) throw new Error("DATABASE_URL (or POSTGRES_URL) must be a PostgreSQL URL");
  return {
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: positiveMilliseconds(environment.POSTGRES_CONNECT_TIMEOUT_MS, 10_000, 120_000),
    statement_timeout: positiveMilliseconds(environment.POSTGRES_MIGRATION_STATEMENT_TIMEOUT_MS, 300_000, 3_600_000),
    idle_in_transaction_session_timeout: positiveMilliseconds(environment.POSTGRES_IDLE_TRANSACTION_TIMEOUT_MS, 60_000, 600_000),
    ssl: environment.POSTGRES_SSL === "disable" ? false : {
      rejectUnauthorized: environment.POSTGRES_SSL_REJECT_UNAUTHORIZED !== "false",
      ...(environment.POSTGRES_SSL_CA ? { ca: environment.POSTGRES_SSL_CA.replace(/\\n/g, "\n") } : {}),
    },
    application_name: "radiohub-schema-migrator",
  };
}

export function postgresMigrationLockTimeout(environment = process.env) {
  return positiveMilliseconds(environment.POSTGRES_MIGRATION_LOCK_TIMEOUT_MS, 60_000, 600_000);
}

export function safePostgresInitializationError(error, environment = process.env) {
  let message = error instanceof Error ? error.message : String(error);
  const secrets = new Set([environment.PGPASSWORD, environment.POSTGRES_PASSWORD]);
  for (const value of [environment.DATABASE_URL, environment.POSTGRES_URL]) {
    if (!value) continue;
    secrets.add(value);
    try {
      const password = new URL(value).password;
      if (password) {
        secrets.add(password);
        secrets.add(decodeURIComponent(password));
      }
    } catch { /* Invalid URLs must never prevent redaction. */ }
  }
  message = message.replace(/\bpostgres(?:ql)?:\/\/[^\s"'<>]+/gi, "[redacted PostgreSQL URL]");
  for (const secret of [...secrets].filter(Boolean).sort((a, b) => b.length - a.length)) message = message.split(secret).join("[redacted]");
  return message;
}

/** Apply immutable SQL migrations once, serialized across all starting replicas. */
export async function applyPostgresMigrations({
  environment = process.env,
  cwd = process.cwd(),
  migrationsDirectory,
  createPool = (options) => new pg.Pool(options),
  log = console.log,
} = {}) {
  const connectionOptions = postgresMigrationConnectionOptions(environment);
  const candidates = migrationsDirectory ? [path.resolve(migrationsDirectory)] : environment.POSTGRES_MIGRATIONS_DIR
    ? [path.resolve(cwd, environment.POSTGRES_MIGRATIONS_DIR)]
    : [path.resolve(cwd, "db-migrations"), path.resolve(cwd, "../../lib/db/migrations"), path.resolve(cwd, "lib/db/migrations")];
  let directory;
  for (const candidate of candidates) {
    if (await fs.stat(candidate).then((entry) => entry.isDirectory()).catch(() => false)) {
      directory = candidate;
      break;
    }
  }
  if (!directory) throw new Error(`PostgreSQL migrations directory not found; checked ${candidates.join(", ")}`);
  const names = (await fs.readdir(directory)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort((a, b) => a.localeCompare(b));
  if (!names.length) throw new Error(`No SQL migrations found in ${directory}`);
  const migrations = await Promise.all(names.map(async (name) => {
    const sql = await fs.readFile(path.join(directory, name), "utf8");
    return { name, sql, checksum: crypto.createHash("sha256").update(sql).digest("hex") };
  }));
  const pool = createPool(connectionOptions);
  let client;
  let locked = false;
  try {
    client = await pool.connect();
    await client.query("SELECT set_config('lock_timeout', $1, false)", [String(postgresMigrationLockTimeout(environment))]);
    await client.query("SELECT pg_advisory_lock(hashtext('radiohub-schema-migrations'))");
    locked = true;
    await client.query(`CREATE TABLE IF NOT EXISTS radiohub_schema_migrations (
      name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const applied = await client.query("SELECT name,checksum FROM radiohub_schema_migrations");
    const appliedChecksums = new Map(applied.rows.map((row) => [row.name, row.checksum]));
    // Check every deployed checksum before executing any new DDL.
    for (const migration of migrations) {
      if (appliedChecksums.has(migration.name) && appliedChecksums.get(migration.name) !== migration.checksum) {
        throw new Error(`Applied migration ${migration.name} has been modified`);
      }
    }
    let appliedCount = 0;
    for (const migration of migrations) {
      if (appliedChecksums.has(migration.name)) {
        log(`[schema] already applied: ${migration.name}`);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query("INSERT INTO radiohub_schema_migrations(name,checksum) VALUES ($1,$2)", [migration.name, migration.checksum]);
        await client.query("COMMIT");
        appliedCount += 1;
        log(`[schema] applied: ${migration.name}`);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    }
    return { applied: appliedCount, skipped: migrations.length - appliedCount };
  } finally {
    if (client) {
      if (locked) await client.query("SELECT pg_advisory_unlock(hashtext('radiohub-schema-migrations'))").catch(() => undefined);
      client.release();
    }
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  applyPostgresMigrations().catch((error) => {
    console.error(`[schema] ${safePostgresInitializationError(error)}`);
    process.exitCode = 1;
  });
}
