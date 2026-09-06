import crypto from "node:crypto";
import type pg from "pg";
import { getPostgresPool } from "../postgres-runtime";
export type MaintenanceKind = "slug" | "optimization" | "health_check";
export class MaintenanceStopped extends Error {
  constructor() {
    super("Maintenance job stopped or lease expired");
  }
}
function shape(row: any): any {
  return row
    ? {
        ...row.payload,
        id: row.id,
        jobId: row.id,
        status: row.status,
        startedAt: row.started_at,
        updatedAt: row.updated_at,
        completedAt: row.completed_at,
      }
    : null;
}
async function expire(client: Pick<pg.Pool, "query">, kind: MaintenanceKind) {
  await client.query(
    `UPDATE admin_maintenance_jobs SET status='failed',completed_at=now(),updated_at=now(),
    payload=payload||'{"error":"Worker lease expired","message":"Job interrupted; run it again"}'::jsonb
    WHERE kind=$1 AND status='running' AND lease_until<now()`,
    [kind],
  );
}
export async function pgStartMaintenanceJob(
  kind: MaintenanceKind,
  payload: Record<string, any>,
): Promise<{ job: any; token: string }> {
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "admin-maintenance-kind:" + kind,
    ]);
    await expire(client, kind);
    const token = crypto.randomUUID(),
      id = kind + "-" + crypto.randomUUID();
    const row = (
      await client.query(
        `INSERT INTO admin_maintenance_jobs(id,kind,owner_token,payload) VALUES($1,$2,$3,$4) RETURNING *`,
        [id, kind, token, JSON.stringify(payload)],
      )
    ).rows[0];
    await client.query(
      `DELETE FROM admin_maintenance_jobs WHERE id IN(SELECT id FROM admin_maintenance_jobs
      WHERE kind=$1 AND status<>'running' ORDER BY started_at DESC,id DESC OFFSET 100)`,
      [kind],
    );
    await client.query("COMMIT");
    return { job: shape(row), token };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
export async function pgMaintenanceJobs(
  kind: MaintenanceKind,
  id?: string,
): Promise<any[]> {
  await expire(getPostgresPool(), kind);
  return (
    await getPostgresPool().query(
      `SELECT * FROM admin_maintenance_jobs WHERE kind=$1 AND ($2::text IS NULL OR id=$2)
    ORDER BY started_at DESC,id DESC LIMIT 100`,
      [kind, id || null],
    )
  ).rows.map(shape);
}
export async function pgSaveMaintenanceJob(
  id: string,
  token: string,
  payload: Record<string, any>,
  status = "running",
): Promise<boolean> {
  const result = await getPostgresPool().query(
    `UPDATE admin_maintenance_jobs SET payload=payload||$3::jsonb||
    CASE WHEN jsonb_typeof($3::jsonb->'progress')='object' THEN jsonb_build_object('progress',coalesce(payload->'progress','{}')||($3::jsonb->'progress')) ELSE '{}'::jsonb END,status=$4,
    updated_at=now(),lease_until=now()+interval '2 minutes',completed_at=CASE WHEN $4='running' THEN NULL ELSE now() END
    WHERE id=$1 AND owner_token=$2 AND status='running' AND lease_until>now()`,
    [id, token, JSON.stringify(payload), status],
  );
  return result.rowCount === 1;
}
export async function pgStopMaintenanceJobs(
  kind: MaintenanceKind,
): Promise<void> {
  await getPostgresPool().query(
    `UPDATE admin_maintenance_jobs SET status='stopped',completed_at=now(),updated_at=now(),
    payload=payload||'{"message":"Generation stopped by user"}'::jsonb WHERE kind=$1 AND status='running'`,
    [kind],
  );
}
export async function pgMaintenanceBatch<T>(
  id: string,
  token: string,
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const live = await client.query(
      "SELECT id FROM admin_maintenance_jobs WHERE id=$1 AND owner_token=$2 AND status='running' AND lease_until>now() FOR UPDATE",
      [id, token],
    );
    if (!live.rowCount) throw new MaintenanceStopped();
    const result = await work(client);
    await client.query(
      "UPDATE admin_maintenance_jobs SET updated_at=now(),lease_until=now()+interval '2 minutes' WHERE id=$1",
      [id],
    );
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
