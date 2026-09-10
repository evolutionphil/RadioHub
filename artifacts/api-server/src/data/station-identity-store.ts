import type pg from 'pg';
import { getPostgresPool } from '../postgres-runtime';

type Queryable = Pick<pg.PoolClient, 'query'>;

/** Public IDs only: do not use this to redirect administrative edit/delete targets. */
export async function resolveStationIds(ids: string[], db: Queryable = getPostgresPool()): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const result = await db.query<{ requested: string; id: string }>(
    `SELECT requested,COALESCE(d.id,u.id,a.station_id) AS id
     FROM unnest($1::text[]) requested
     LEFT JOIN stations d ON d.id=requested
     LEFT JOIN stations u ON d.id IS NULL AND u.station_uuid=requested
     LEFT JOIN station_merge_aliases a ON d.id IS NULL AND u.id IS NULL AND a.alias=requested
     WHERE COALESCE(d.id,u.id,a.station_id) IS NOT NULL`, [[...new Set(ids)]],
  );
  return new Map(result.rows.map(row => [row.requested, row.id]));
}

export async function resolveStationId(id: string, db?: Queryable): Promise<string | null> {
  return (await resolveStationIds([id], db)).get(id) ?? null;
}

/** Caller owns the transaction. Lock stations BEFORE users/engagement rows,
 * matching the merge worker. A fresh snapshot handles a merge committed while
 * our first station lock waited; no favorite/rating may be written to a loser. */
export async function lockStationIdentity(id: string, client: pg.PoolClient, mode: 'UPDATE' | 'KEY SHARE' = 'UPDATE'): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const canonical = await resolveStationId(id, client);
    if (!canonical) return null;
    const locked = await client.query<{ id: string }>(`SELECT id FROM stations WHERE id=$1 FOR ${mode}`, [canonical]);
    if (locked.rows[0]) return locked.rows[0].id;
  }
  return null;
}
