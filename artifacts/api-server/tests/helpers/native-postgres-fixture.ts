import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import pg from "pg";

/** Explicit opt-in database; one validated random schema per test process.
 * This is fixture setup only, not a Mongo query emulation layer. Production
 * routes and stores execute their real SQL against PostgreSQL constraints.
 */
export async function createNativePostgresFixture(label: string) {
  const databaseUrl = process.env.PG_TEST_DATABASE_URL;
  if (!databaseUrl)
    throw new Error(
      "PG_TEST_DATABASE_URL is required for native regression fixtures; use a disposable PostgreSQL database",
    );
  const parsed = new URL(databaseUrl);
  assert.ok(
    ["postgres:", "postgresql:"].includes(parsed.protocol),
    "Fixture URL must be PostgreSQL",
  );
  const schema =
    "native_" +
    label
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "_")
      .slice(0, 22) +
    "_" +
    randomBytes(7).toString("hex");
  assert.match(schema, /^native_[a-z0-9_]+$/);
  const ssl =
    process.env.POSTGRES_SSL === "require"
      ? { rejectUnauthorized: true }
      : false;
  const admin = new pg.Pool({
    connectionString: databaseUrl,
    ssl,
    max: 1,
    connectionTimeoutMillis: 5000,
  });
  const previousUrl = process.env.DATABASE_URL,
    previousSsl = process.env.POSTGRES_SSL;
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set("options", "-c search_path=" + schema + ",public");
  let pool: pg.Pool | undefined;
  const runtime = await import("../../src/postgres-runtime");
  await runtime.closePostgres();
  try {
    await admin.query('CREATE SCHEMA "' + schema + '"');
    pool = new pg.Pool({
      connectionString: scoped.href,
      ssl,
      max: 4,
      connectionTimeoutMillis: 5000,
    });
    const migrations = new URL(
      "../../../../lib/db/migrations/",
      import.meta.url,
    );
    for (const name of (await readdir(migrations))
      .filter((value) => value.endsWith(".sql"))
      .sort())
      await pool.query(await readFile(new URL(name, migrations), "utf8"));
    process.env.DATABASE_URL = scoped.href;
    process.env.POSTGRES_SSL = ssl ? "require" : "disable";
  } catch (error) {
    await pool?.end();
    await admin.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
    await admin.end();
    throw error;
  }
  const tableColumns = new Map<string, Map<string, string>>();
  async function columns(table: string) {
    assert.match(table, /^[a-z][a-z0-9_]*$/);
    if (!tableColumns.has(table)) {
      const rows = (
        await pool!.query(
          "SELECT column_name,data_type FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2",
          [schema, table],
        )
      ).rows;
      assert.ok(rows.length, "Unknown fixture table " + table);
      tableColumns.set(
        table,
        new Map(rows.map((row) => [row.column_name, row.data_type])),
      );
    }
    return tableColumns.get(table)!;
  }
  const aliases: Record<string, string> = {
    _id: "id",
    stationuuid: "station_uuid",
    tags: "tags_raw",
    languagecodes: "language_codes",
    lastcheckok: "last_check_ok",
    clickcount: "click_count",
  };
  const shape = (row: any) => ({
    ...row.source,
    ...Object.fromEntries(
      Object.entries(row)
        .filter(([key]) => key !== "source")
        .map(([key, value]) => [
          key === "id"
            ? "_id"
            : key.replace(/_([a-z])/g, (_match, letter) =>
                letter.toUpperCase(),
              ),
          value,
        ]),
    ),
  });
  return {
    pool: pool!,
    schema,
    async clear(...tables: string[]) {
      for (const table of tables) await columns(table);
      if (tables.length)
        await pool!.query(
          "TRUNCATE " +
            tables
              .map((table) => '"' + schema + '"."' + table + '"')
              .join(",") +
            " CASCADE",
        );
    },
    async insert(table: string, input: Record<string, any>): Promise<any> {
      const fields = await columns(table);
      const values: Record<string, any> = {};
      if (fields.has("id"))
        values.id = String(
          input._id ?? input.id ?? randomBytes(12).toString("hex"),
        );
      for (const [key, value] of Object.entries(input)) {
        const column =
          aliases[key] ??
          key.replace(/[A-Z]/g, (letter) => "_" + letter.toLowerCase());
        if (fields.has(column) && value !== undefined) values[column] = value;
      }
      if (fields.has("source")) values.source = { ...input, ...input.source };
      const names = Object.keys(values),
        parameters = names.map((name) =>
          fields.get(name) === "jsonb"
            ? JSON.stringify(values[name])
            : values[name],
        );
      const row = (
        await pool!.query(
          'INSERT INTO "' +
            schema +
            '"."' +
            table +
            '"(' +
            names.map((name) => '"' + name + '"').join(",") +
            ") VALUES (" +
            names.map((_name, index) => "$" + (index + 1)).join(",") +
            ") RETURNING *",
          parameters,
        )
      ).rows[0];
      return shape(row);
    },
    async close() {
      try {
        await runtime.closePostgres();
        await pool!.end();
        await admin.query('DROP SCHEMA "' + schema + '" CASCADE');
      } finally {
        await admin.end();
        if (previousUrl === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = previousUrl;
        if (previousSsl === undefined) delete process.env.POSTGRES_SSL;
        else process.env.POSTGRES_SSL = previousSsl;
      }
    },
  };
}
export type NativePostgresFixture = Awaited<
  ReturnType<typeof createNativePostgresFixture>
>;
