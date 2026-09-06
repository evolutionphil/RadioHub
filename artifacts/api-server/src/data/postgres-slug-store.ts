import type pg from "pg";
import { getPostgresPool } from "../postgres-runtime";
import {
  slugifyStationName,
  evaluateJunkStation,
} from "../seo/junk-station-rules";
import { SAFE_GENRE_SLUG_RE, normalizeGenreSlug } from "../seo/genre-slug";
import {
  pgStartMaintenanceJob,
  pgSaveMaintenanceJob,
  pgMaintenanceBatch,
  MaintenanceStopped,
} from "./postgres-maintenance-store";
type SlugTable = "stations" | "genres" | "users";
const tables: SlugTable[] = ["stations", "genres", "users"];
const projection = {
  stations:
    "id,name,slug,url,homepage,tags_raw,bitrate,last_check_ok,last_check_time,jsonb_build_object('lastCheckOkTime',source->'lastCheckOkTime') source",
  genres: "id,name,slug",
  users:
    "id,username,full_name,email,slug,jsonb_build_object('name',source->'name') source",
};
const needsSlug = "nullif(slug,'') IS NULL";
export async function pgSlugStatistics(): Promise<any> {
  const row = (
    await getPostgresPool().query(`SELECT count(*)::int "totalStations",
    count(*) FILTER(WHERE nullif(slug,'') IS NOT NULL)::int "stationsWithSlugs" FROM stations`)
  ).rows[0];
  return {
    ...row,
    stationsWithoutSlugs: row.totalStations - row.stationsWithSlugs,
    completionPercentage:
      row.totalStations > 0
        ? (row.stationsWithSlugs / row.totalStations) * 100
        : 0,
  };
}
async function uniqueSlug(
  client: pg.PoolClient,
  table: SlugTable,
  id: string,
  name: string,
): Promise<string> {
  const normalized =
    slugifyStationName(name) || (table === "users" ? "user" : "station");
  const base = table === "genres" ? normalizeGenreSlug(normalized) : normalized;
  if (table === "genres" && !SAFE_GENRE_SLUG_RE.test(base))
    throw new Error("Cannot produce a safe genre slug");
  for (let suffix = 0; suffix < 1000000; suffix++) {
    const candidate = base + (suffix ? "-" + suffix : "");
    const taken = (
      await client.query(
        `SELECT EXISTS(
      SELECT 1 FROM stations WHERE (slug=$1 OR $1=ANY(slug_aliases)) AND NOT($2='stations' AND id=$3)
      UNION ALL SELECT 1 FROM genres WHERE slug=$1 AND NOT($2='genres' AND id=$3)
      UNION ALL SELECT 1 FROM users WHERE slug=$1 AND NOT($2='users' AND id=$3)
    ) taken`,
        [candidate, table, id],
      )
    ).rows[0].taken;
    if (!taken) return candidate;
  }
  throw new Error("Unable to allocate a unique slug");
}
async function assign(
  client: pg.PoolClient,
  table: SlugTable,
  row: any,
): Promise<void> {
  const name =
    table === "users"
      ? row.username ||
        row.full_name ||
        row.source?.name ||
        row.email?.split("@")[0] ||
        "user-" + row.id
      : row.name;
  const slug = await uniqueSlug(client, table, row.id, name);
  if (table === "stations") {
    const verdict = evaluateJunkStation({
      ...row.source,
      name: row.name,
      slug,
      url: row.url,
      homepage: row.homepage,
      tags: row.tags_raw,
      bitrate: row.bitrate,
      lastCheckOk: row.last_check_ok,
      lastCheckTime: row.last_check_time,
    });
    await client.query(
      `UPDATE stations SET slug=$2,no_index=no_index OR $3,
      slug_aliases=CASE WHEN nullif(slug,'') IS NOT NULL AND slug<>$2 AND NOT(slug=ANY(slug_aliases)) THEN array_append(slug_aliases,slug) ELSE slug_aliases END,
      updated_at=now() WHERE id=$1`,
      [row.id, slug, verdict.isJunk],
    );
  } else {
    await client.query(
      `UPDATE ${table} SET slug=$2,updated_at=now() WHERE id=$1`,
      [row.id, slug],
    );
    if (table === "genres" && row.slug && row.slug !== slug) {
      await client.query(
        `INSERT INTO station_genres(station_id,genre_slug,position,created_at)
        SELECT station_id,$2,position,created_at FROM station_genres WHERE genre_slug=$1 ON CONFLICT DO NOTHING`,
        [row.slug, slug],
      );
      await client.query("DELETE FROM station_genres WHERE genre_slug=$1", [
        row.slug,
      ]);
    }
  }
}
export async function pgStartSlugGeneration(
  regenerateAll = false,
  stationsOnly = false,
): Promise<{ job: any; token: string }> {
  const counts = await Promise.all(
    tables.map(async (table) =>
      stationsOnly && table !== "stations"
        ? 0
        : (
            await getPostgresPool().query(
              `SELECT count(*)::int count FROM ${table} WHERE ${regenerateAll ? "TRUE" : needsSlug}`,
            )
          ).rows[0].count,
    ),
  );
  return pgStartMaintenanceJob("slug", {
    progress: { current: 0, total: counts.reduce((a, b) => a + b, 0) },
    regenerateAll,
    stationsOnly,
    counts: { stations: counts[0], genres: counts[1], users: counts[2] },
    message: "Slug generation started",
  });
}
export async function runPgSlugGeneration(
  jobId: string,
  token: string,
  regenerateAll = false,
  stationsOnly = false,
): Promise<void> {
  let current = 0;
  const updated: Record<string, number> = { stations: 0, genres: 0, users: 0 };
  try {
    for (const table of tables) {
      if (stationsOnly && table !== "stations") continue;
      let cursor = "";
      while (true) {
        const batch = await pgMaintenanceBatch(jobId, token, async (client) => {
          await client.query(
            "SELECT pg_advisory_xact_lock(hashtextextended('admin-slug-assignment',0))",
          );
          const rows = (
            await client.query(
              `SELECT ${projection[table]} FROM ${table} WHERE id>$1 AND ${regenerateAll ? "TRUE" : needsSlug} ORDER BY id LIMIT 100 FOR UPDATE`,
              [cursor],
            )
          ).rows;
          for (const row of rows) await assign(client, table, row);
          return rows.map((row) => row.id);
        });
        if (!batch.length) break;
        cursor = batch[batch.length - 1];
        current += batch.length;
        updated[table] += batch.length;
        if (
          !(await pgSaveMaintenanceJob(jobId, token, {
            progress: { current, total: undefined },
            counts: updated,
            message: "Generating " + table + " slugs",
          }))
        )
          throw new MaintenanceStopped();
      }
    }
    await pgSaveMaintenanceJob(
      jobId,
      token,
      {
        progress: { current, total: current },
        counts: updated,
        message: "Slug generation completed",
      },
      "completed",
    );
  } catch (error) {
    if (!(error instanceof MaintenanceStopped))
      await pgSaveMaintenanceJob(
        jobId,
        token,
        { error: (error as Error).message, message: "Slug generation failed" },
        "failed",
      );
  }
}
export async function pgClearAllSlugs(): Promise<any> {
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('admin-maintenance-kind:slug',0))",
    );
    const active = await client.query(
      "SELECT 1 FROM admin_maintenance_jobs WHERE kind='slug' AND status='running' AND lease_until>now()",
    );
    if (active.rowCount)
      throw new Error("Stop the running slug job before clearing slugs");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('admin-slug-assignment',0))",
    );
    const stations =
      (
        await client.query(`UPDATE stations SET slug_aliases=CASE WHEN NOT(slug=ANY(slug_aliases)) THEN array_append(slug_aliases,slug) ELSE slug_aliases END,
      slug=NULL,updated_at=now() WHERE nullif(slug,'') IS NOT NULL`)
      ).rowCount || 0;
    const users =
      (
        await client.query(
          "UPDATE users SET slug=NULL,updated_at=now() WHERE nullif(slug,'') IS NOT NULL",
        )
      ).rowCount || 0;
    // Genre routes require a valid unique slug. Regenerate these atomically
    // instead of putting the taxonomy into a temporarily unusable state.
    let genreCount = 0,
      cursor = "";
    while (true) {
      const genres = (
        await client.query(
          "SELECT id,name,slug FROM genres WHERE id>$1 ORDER BY id LIMIT 100 FOR UPDATE",
          [cursor],
        )
      ).rows;
      if (!genres.length) break;
      for (const genre of genres) await assign(client, "genres", genre);
      genreCount += genres.length;
      cursor = genres[genres.length - 1].id;
    }
    await client.query("COMMIT");
    return {
      success: true,
      totalCleared: stations + users + genreCount,
      stations,
      users,
      genres: genreCount,
      message:
        "Station/user slugs cleared; genre slugs safely regenerated and station redirects preserved",
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
