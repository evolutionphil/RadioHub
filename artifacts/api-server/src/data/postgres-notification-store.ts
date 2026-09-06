import { newPublicUserId } from "./postgres-user-store";
import { getPostgresPool } from "../postgres-runtime";

export const notificationStore: string = "postgres";

export interface NotificationInput {
  id?: string;
  userId: string;
  fromUserId?: string | null;
  type: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  read?: boolean;
  readAt?: Date | null;
  expiresAt?: Date | null;
  createdAt?: Date;
}

function shape(row: any): any {
  return {
    _id: row.id, userId: row.user_id, fromUserId: row.from_user_id,
    type: row.type, title: row.title, message: row.message, data: row.data || {},
    read: row.is_read, readAt: row.read_at, expiresAt: row.expires_at,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export async function pgCreateNotification(input: NotificationInput): Promise<any> {
  const result = await getPostgresPool().query(
    `INSERT INTO user_notifications(id,user_id,from_user_id,type,title,message,data,is_read,read_at,expires_at,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [input.id || newPublicUserId(), input.userId, input.fromUserId || null, input.type,
      input.title, input.message, JSON.stringify(input.data || {}), !!input.read,
      input.readAt || null, input.expiresAt || null, input.createdAt || new Date()],
  );
  return shape(result.rows[0]);
}

export async function pgListNotifications(userId: string, page: number, limit: number): Promise<any> {
  const offset = Math.max(0, page - 1) * limit;
  const [rows, total, unread] = await Promise.all([
    getPostgresPool().query(
      `SELECT * FROM user_notifications WHERE user_id=$1
       AND ((type IN ('new_station','follow') AND created_at>=now()-interval '10 days')
         OR (type='new_message' AND created_at>=now()-interval '7 days')
         OR (type='system' AND created_at>=now()-interval '30 days'))
       AND (expires_at IS NULL OR expires_at>now())
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    ),
    getPostgresPool().query<{ count: string }>(
      `SELECT count(*)::text count FROM user_notifications WHERE user_id=$1
       AND ((type IN ('new_station','follow') AND created_at>=now()-interval '10 days')
         OR (type='new_message' AND created_at>=now()-interval '7 days')
         OR (type='system' AND created_at>=now()-interval '30 days'))
       AND (expires_at IS NULL OR expires_at>now())`,
      [userId],
    ),
    getPostgresPool().query<{ count: string }>(
      `SELECT count(*)::text count FROM user_notifications WHERE user_id=$1 AND is_read=false
       AND ((type IN ('new_station','follow') AND created_at>=now()-interval '10 days')
         OR (type='new_message' AND created_at>=now()-interval '7 days')
         OR (type='system' AND created_at>=now()-interval '30 days'))
       AND (expires_at IS NULL OR expires_at>now())`,
      [userId],
    ),
  ]);
  return { notifications: rows.rows.map(shape), pagination: {
    page, limit, total: Number(total.rows[0]?.count || 0),
    totalPages: Math.ceil(Number(total.rows[0]?.count || 0) / limit),
  }, unreadCount: Number(unread.rows[0]?.count || 0) };
}

export async function pgMarkNotificationRead(userId: string, id: string): Promise<any | null> {
  const result = await getPostgresPool().query(
    "UPDATE user_notifications SET is_read=true,read_at=COALESCE(read_at,now()) WHERE id=$1 AND user_id=$2 RETURNING *",
    [id, userId],
  );
  return result.rows[0] ? shape(result.rows[0]) : null;
}

export async function pgMarkAllNotificationsRead(userId: string): Promise<number> {
  const result = await getPostgresPool().query(
    "UPDATE user_notifications SET is_read=true,read_at=COALESCE(read_at,now()) WHERE user_id=$1 AND is_read=false",
    [userId],
  );
  return result.rowCount || 0;
}

export async function pgMarkConversationNotificationsRead(userId: string, fromUserId: string): Promise<number> {
  const result = await getPostgresPool().query(
    `UPDATE user_notifications SET is_read=true,read_at=COALESCE(read_at,now())
     WHERE user_id=$1 AND from_user_id=$2 AND type='new_message' AND is_read=false`,
    [userId, fromUserId],
  );
  return result.rowCount || 0;
}

export async function pgUpsertMessageNotification(input: Omit<NotificationInput, "id" | "type"> & { id?: string }): Promise<any> {
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`message:${input.userId}:${input.fromUserId || ""}`]);
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM user_notifications WHERE user_id=$1 AND from_user_id=$2
       AND type='new_message' AND is_read=false LIMIT 1`,
      [input.userId, input.fromUserId || null],
    );
    const result = existing.rowCount
      ? await client.query(
          `UPDATE user_notifications SET title=$2,message=$3,data=$4,created_at=$5,updated_at=now()
           WHERE id=$1 RETURNING *`,
          [existing.rows[0].id, input.title, input.message, JSON.stringify(input.data || {}), input.createdAt || new Date()],
        )
      : await client.query(
          `INSERT INTO user_notifications(id,user_id,from_user_id,type,title,message,data,created_at)
           VALUES ($1,$2,$3,'new_message',$4,$5,$6,$7) RETURNING *`,
          [input.id || newPublicUserId(), input.userId, input.fromUserId || null, input.title,
            input.message, JSON.stringify(input.data || {}), input.createdAt || new Date()],
        );
    await client.query("COMMIT");
    return shape(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
