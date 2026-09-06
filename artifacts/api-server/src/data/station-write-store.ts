import { getPostgresPool } from "../postgres-runtime";

export const stationWriteMode = "postgres" as const;

async function updatePostgresCounter(stationId: string, field: "click_count" | "votes"): Promise<number | null> {
  const result = await getPostgresPool().query<{ value: number }>(
    `UPDATE stations SET ${field}=${field}+1,
       source=CASE WHEN $2 THEN jsonb_set(source,'{clickTimestamp}',to_jsonb(now()),true) ELSE source END
     WHERE id=$1 RETURNING ${field} AS value`,
    [stationId, field === "click_count"],
  );
  return result.rows[0]?.value ?? null;
}

export async function incrementStationClick(stationId: string): Promise<boolean> {
  return (await updatePostgresCounter(stationId, "click_count")) !== null;
}

export async function incrementStationVote(stationId: string): Promise<number | null> {
  return updatePostgresCounter(stationId, "votes");
}
