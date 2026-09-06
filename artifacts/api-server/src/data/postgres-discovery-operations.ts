import { getPostgresPool } from "../postgres-runtime";
import { catalogShape } from "./postgres-catalog-store";
export async function pgCityCounts(
  countries: string[],
  cities: Array<{ name: string; terms: string[] }>,
): Promise<{
  cities: Array<{ name: string; stationCount: number }>;
  total: number;
  unassigned: number;
}> {
  const rows = (
    await getPostgresPool().query(
      `WITH selected AS MATERIALIZED (
    SELECT name,tags_raw FROM stations WHERE lower(country)=ANY($1::text[])
  ), specs AS (SELECT name,terms FROM jsonb_to_recordset($2::jsonb) AS x(name text,terms jsonb))
  SELECT specs.name,count(s.name)::int count FROM specs LEFT JOIN selected s ON EXISTS(
    SELECT 1 FROM jsonb_array_elements_text(specs.terms) t WHERE strpos(lower(s.name),lower(t))>0 OR strpos(lower(s.tags_raw),lower(t))>0)
  GROUP BY specs.name
  UNION ALL SELECT NULL,count(*)::int FROM selected
  UNION ALL SELECT '',count(*)::int FROM selected s WHERE NOT EXISTS(
    SELECT 1 FROM specs CROSS JOIN LATERAL jsonb_array_elements_text(terms) t
    WHERE strpos(lower(s.name),lower(t))>0 OR strpos(lower(s.tags_raw),lower(t))>0)`,
      [
        countries.map((country) => country.toLowerCase()),
        JSON.stringify(cities),
      ],
    )
  ).rows;
  return {
    cities: rows
      .filter((row) => row.name)
      .map((row) => ({ name: row.name, stationCount: row.count })),
    total: rows.find((row) => row.name === null)?.count || 0,
    unassigned: rows.find((row) => row.name === "")?.count || 0,
  };
}
export async function pgGlobalCityCounts(
  specs: Array<{ name: string; country: string; countries: string[] }>,
): Promise<any[]> {
  return (
    await getPostgresPool().query(
      `SELECT c.name,c.country,count(s.id)::int "stationCount"
    FROM jsonb_to_recordset($1::jsonb) AS c(name text,country text,countries jsonb) JOIN stations s
    ON lower(s.country) IN(SELECT lower(value) FROM jsonb_array_elements_text(c.countries))
    AND strpos(lower(s.state),lower(c.name))>0 GROUP BY c.name,c.country ORDER BY count(s.id) DESC,c.name LIMIT 20`,
      [JSON.stringify(specs)],
    )
  ).rows;
}
export async function pgDiverseStations(
  country: string | null,
  limit: number,
): Promise<any[]> {
  const bounded = Math.max(1, Math.min(50, Math.trunc(limit) || 20));
  const rows = (
    await getPostgresPool().query(
      `WITH top_genres AS MATERIALIZED (
    SELECT name FROM genres WHERE station_count>5 ORDER BY station_count DESC,id LIMIT 10
  ) SELECT sampled.* FROM top_genres g CROSS JOIN LATERAL (
    SELECT s.* FROM stations s WHERE ($1::text IS NULL OR lower(s.country)=lower($1))
    AND (strpos(lower(s.tags_raw),lower(g.name))>0 OR strpos(lower(s.source->>'genre'),lower(g.name))>0)
    ORDER BY random() LIMIT greatest(2,ceil($2::numeric/greatest((SELECT count(*) FROM top_genres),1))::int)
  ) sampled`,
      [country, bounded],
    )
  ).rows;
  const fields = [
    "_id",
    "name",
    "slug",
    "favicon",
    "url",
    "country",
    "language",
    "genre",
    "tags",
    "votes",
    "codec",
    "bitrate",
  ];
  const seen = new Set<string>();
  return rows
    .filter((row) => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    })
    .slice(0, bounded)
    .map((row) => {
      const station = catalogShape(row);
      return Object.fromEntries(fields.map((field) => [field, station[field]]));
    });
}
export async function pgDashboardTotals(): Promise<any> {
  const result = (
    await getPostgresPool().query(`SELECT count(*)::int "totalStations",
    count(DISTINCT nullif(country,''))::int "totalCountries",count(DISTINCT nullif(language,''))::int "totalLanguages",
    count(DISTINCT nullif(tags_raw,''))::int "totalGenres",count(DISTINCT nullif(codec,''))::int "totalCodecs",
    count(*) FILTER(WHERE last_check_ok)::int "workingStations",
    count(*) FILTER(WHERE updated_at>=now()-interval '24 hours')::int "recentlyUpdated",
    count(*) FILTER(WHERE nullif(favicon,'') IS NOT NULL)::int "stationsWithFavicon",
    count(*) FILTER(WHERE descriptions ? 'en')::int "stationsWithDesc",
    (SELECT count(*)::int FROM users) "userCount",
    (SELECT count(*)::int FROM users WHERE coalesce((source->>'lastActiveDate')::timestamptz,last_login_at)>=now()-interval '7 days') "activeRegisteredUsers",
    (SELECT count(*)::int FROM visitor_sessions WHERE last_active_date>=now()-interval '30 minutes') "activeVisitors",
    (SELECT count(*)::int FROM visitor_sessions WHERE last_active_date>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') "todayVisitors",
    (SELECT count(*)::int FROM visitor_sessions WHERE last_active_date>=now()-interval '7 days') "weekVisitors"
    FROM stations`)
  ).rows[0];
  return result;
}
