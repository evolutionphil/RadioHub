import { getPostgresPool } from "../postgres-runtime";
import { lockStationIdentity } from './station-identity-store';

export const stationWriteMode = "postgres" as const;

async function updatePostgresCounter(stationId: string, field: "click_count" | "votes"): Promise<number | null> {
  const client = await getPostgresPool().connect();
  try {
    await client.query('BEGIN');
    const canonical = await lockStationIdentity(stationId, client);
    if (!canonical) { await client.query('COMMIT'); return null; }
    const result = await client.query<{ value: number }>(
    `UPDATE stations SET ${field}=${field}+1,
       source=CASE WHEN $2 THEN jsonb_set(source,'{clickTimestamp}',to_jsonb(now()),true) ELSE source END
     WHERE id=$1 RETURNING ${field} AS value`,
    [canonical, field === "click_count"],
  );
    await client.query('COMMIT');
    return result.rows[0]?.value ?? null;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export async function incrementStationClick(stationId: string): Promise<boolean> {
  return (await updatePostgresCounter(stationId, "click_count")) !== null;
}

export async function incrementStationVote(stationId: string): Promise<number | null> {
  return updatePostgresCounter(stationId, "votes");
}
