import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const { Pool } = pg;

const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
  throw new Error("DATABASE_URL (or POSTGRES_URL) must be a PostgreSQL URL");
}

const migrationCandidates = process.env.POSTGRES_MIGRATIONS_DIR
  ? [path.resolve(process.env.POSTGRES_MIGRATIONS_DIR)]
  : [
      path.resolve(process.cwd(), "db-migrations"),
      path.resolve(process.cwd(), "../../lib/db/migrations"),
      path.resolve(process.cwd(), "lib/db/migrations"),
    ];
let migrationsDirectory;
for (const candidate of migrationCandidates) {
  if (await fs.stat(candidate).then((entry) => entry.isDirectory()).catch(() => false)) {
    migrationsDirectory = candidate;
    break;
  }
}
if (!migrationsDirectory) {
  throw new Error(`PostgreSQL migrations directory not found; checked ${migrationCandidates.join(", ")}`);
}

const ssl = process.env.POSTGRES_SSL === "disable"
  ? false
  : {
      rejectUnauthorized: process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED !== "false",
      ...(process.env.POSTGRES_SSL_CA
        ? { ca: process.env.POSTGRES_SSL_CA.replace(/\\n/g, "\n") }
        : {}),
    };

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  ssl,
  application_name: "radiohub-schema-migrator",
});

const client = await pool.connect();
try {
  await client.query("SELECT pg_advisory_lock(hashtext('radiohub-schema-migrations'))");
  await client.query(`
    CREATE TABLE IF NOT EXISTS radiohub_schema_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const names = (await fs.readdir(migrationsDirectory))
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort((left, right) => left.localeCompare(right));
  if (!names.length) throw new Error(`No SQL migrations found in ${migrationsDirectory}`);

  for (const name of names) {
    const sql = await fs.readFile(path.join(migrationsDirectory, name), "utf8");
    const checksum = crypto.createHash("sha256").update(sql).digest("hex");
    const applied = await client.query(
      "SELECT checksum FROM radiohub_schema_migrations WHERE name=$1",
      [name],
    );
    if (applied.rowCount) {
      if (applied.rows[0].checksum !== checksum) {
        throw new Error(`Applied migration ${name} has been modified`);
      }
      console.log(`[schema] already applied: ${name}`);
      continue;
    }

    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query(
        "INSERT INTO radiohub_schema_migrations(name,checksum) VALUES ($1,$2)",
        [name, checksum],
      );
      await client.query("COMMIT");
      console.log(`[schema] applied: ${name}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  await client.query("SELECT pg_advisory_unlock(hashtext('radiohub-schema-migrations'))").catch(() => undefined);
  client.release();
  await pool.end();
}
