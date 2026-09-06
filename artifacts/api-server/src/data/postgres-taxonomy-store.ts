import { getPostgresPool } from "../postgres-runtime";
import { randomBytes } from 'node:crypto';
import { SAFE_GENRE_SLUG_RE } from '../seo/genre-slug';

function genreShape(row: Record<string, any>): any {
  return {
    ...(row.source && typeof row.source === "object" ? row.source : {}),
    _id: row.id,
    name: row.name,
    slug: row.slug,
    stationCount: Number(row.station_count || 0),
    total_stations: Number(row.station_count || 0),
    isDiscoverable: row.is_discoverable,
    discoverable: row.is_discoverable,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isDynamic: String(row.id).startsWith('dynamic-'),
  };
}

export async function pgCountryCounts(): Promise<Array<{ name: string; count: number }>> {
  const result = await getPostgresPool().query<{ name: string; count: string }>(
    `SELECT country AS name,count(*)::text count FROM stations
     WHERE NULLIF(country,'') IS NOT NULL GROUP BY country ORDER BY country`,
  );
  return result.rows.map((row) => ({ name: row.name, count: Number(row.count) }));
}

export async function pgGenres(country?: string, includeDynamic = false): Promise<any[]> {
  if (country || includeDynamic) {
    const result = await getPostgresPool().query(
      `SELECT COALESCE(g.id,'dynamic-' || sg.genre_slug) id,
         COALESCE(g.name,initcap(replace(sg.genre_slug,'-',' '))) name,
         sg.genre_slug slug,count(DISTINCT sg.station_id)::int station_count,
         COALESCE(g.is_discoverable,true) is_discoverable,g.source,g.created_at,g.updated_at
       FROM station_genres sg JOIN stations s ON s.id=sg.station_id
       LEFT JOIN genres g ON g.slug=sg.genre_slug
       WHERE ($1='' OR lower(s.country)=lower($1))
       GROUP BY sg.genre_slug,g.id,g.name,g.is_discoverable,g.source,g.created_at,g.updated_at`,
      [country || ''],
    );
    return result.rows.map(genreShape);
  }
  const result = await getPostgresPool().query(
    "SELECT * FROM genres WHERE is_discoverable=true",
  );
  return result.rows.map(genreShape);
}

export async function pgDiscoverableGenres(country: string | undefined, limit: number): Promise<any[]> {
  const genres = await pgGenres(country);
  return genres
    .filter((genre) => genre.isDiscoverable !== false)
    .sort((a, b) => (a.displayOrder ?? 9999) - (b.displayOrder ?? 9999) || b.stationCount - a.stationCount)
    .slice(0, Number.isFinite(limit) ? Math.max(1, Math.min(Math.trunc(limit), 200)) : 13);
}

export async function pgGenreBySlug(slug: string): Promise<any | null> {
  const result = await getPostgresPool().query(
    `SELECT * FROM genres WHERE slug=$1
     UNION ALL
     SELECT 'dynamic-' || $1,initcap(replace($1,'-',' ')),$1,true,count(*)::int,
       '{}'::jsonb,now(),now() FROM station_genres WHERE genre_slug=$1
       AND NOT EXISTS(SELECT 1 FROM genres WHERE slug=$1)
     LIMIT 1`,
    [slug],
  );
  const row = result.rows[0];
  if (!row || Number(row.station_count || 0) === 0 && String(row.id).startsWith("dynamic-")) return null;
  return genreShape(row);
}

export async function pgStoredGenreBySlug(slug: string): Promise<any | null> {
  const result = await getPostgresPool().query('SELECT * FROM genres WHERE slug=$1', [slug]);
  return result.rows[0] ? genreShape(result.rows[0]) : null;
}

function validateGenre(input: Record<string, any>): void {
  if (typeof input.name !== 'string' || !input.name.trim() || typeof input.slug !== 'string' || !SAFE_GENRE_SLUG_RE.test(input.slug)) {
    const error = new Error('A non-empty genre name and valid lowercase genre slug are required');
    error.name = 'ValidationError'; throw error;
  }
  if (input.displayOrder !== undefined && !Number.isFinite(input.displayOrder)) {
    const error = new Error('Genre displayOrder must be finite'); error.name = 'ValidationError'; throw error;
  }
}

export async function pgCreateGenre(input: Record<string, any>): Promise<any> {
  validateGenre(input);
  const id = randomBytes(12).toString('hex');
  const result = await getPostgresPool().query(
    `INSERT INTO genres(id,name,slug,is_discoverable,source) VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING *`,
    [id,input.name.trim(),input.slug,input.isDiscoverable ?? false,JSON.stringify({ ...input,_id:id })],
  );
  return genreShape(result.rows[0]);
}

export async function pgUpdateGenre(id: string, patch: Record<string, any>, clearDemotion = false): Promise<any | null> {
  const client = await getPostgresPool().connect();
  try {
    await client.query('BEGIN');
    const current = (await client.query('SELECT * FROM genres WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if (!current) { await client.query('COMMIT'); return null; }
    const source = { ...current.source,...patch };
    if (clearDemotion) delete source.cleanupDemotion;
    const input = { ...genreShape(current),...patch };
    validateGenre(input);
    const result = await client.query(
      'UPDATE genres SET name=$2,slug=$3,is_discoverable=$4,source=$5::jsonb,updated_at=now() WHERE id=$1 RETURNING *',
      [id,input.name,input.slug,input.isDiscoverable,JSON.stringify(source)],
    );
    await client.query('COMMIT'); return genreShape(result.rows[0]);
  } catch(error) { await client.query('ROLLBACK');throw error; }
  finally { client.release(); }
}

export async function pgDeleteGenre(id: string): Promise<any | null> {
  const result = await getPostgresPool().query('DELETE FROM genres WHERE id=$1 RETURNING *',[id]);
  return result.rows[0] ? genreShape(result.rows[0]) : null;
}
