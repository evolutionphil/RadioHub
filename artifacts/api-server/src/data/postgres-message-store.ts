import { getPostgresPool } from "../postgres-runtime";
import { newPublicUserId } from "./postgres-user-store";

export const messageStore: string = "postgres";

function shape(row: any): any {
  return {
    _id: row.id, fromUserId: row.from_user_id, toUserId: row.to_user_id,
    content: row.content, messageType: row.message_type, imageUrl: row.image_url,
    read: row.is_read, readAt: row.read_at, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export async function pgCreateMessage(input: {
  id?: string; fromUserId: string; toUserId: string; content: string;
  messageType: string; imageUrl?: string | null; createdAt?: Date;
}): Promise<any> {
  const result = await getPostgresPool().query(
    `INSERT INTO direct_messages(id,from_user_id,to_user_id,content,message_type,image_url,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [input.id || newPublicUserId(), input.fromUserId, input.toUserId, input.content,
      input.messageType, input.imageUrl || null, input.createdAt || new Date()],
  );
  return shape(result.rows[0]);
}

export async function pgConversationMessages(
  userId: string, partnerId: string, before: string | undefined, limit: number,
): Promise<any[]> {
  const result = await getPostgresPool().query(
    `SELECT * FROM direct_messages WHERE
       ((from_user_id=$1 AND to_user_id=$2) OR (from_user_id=$2 AND to_user_id=$1))
       AND ($3='' OR (created_at,id)<(SELECT created_at,id FROM direct_messages WHERE id=$3))
       ORDER BY created_at DESC,id DESC LIMIT $4`,
    [userId, partnerId, before || "", limit],
  );
  return result.rows.map(shape).reverse();
}

export async function pgMarkMessagesRead(userId: string, partnerId: string): Promise<number> {
  const result = await getPostgresPool().query(
    `UPDATE direct_messages SET is_read=true,read_at=COALESCE(read_at,now())
     WHERE from_user_id=$2 AND to_user_id=$1 AND is_read=false`,
    [userId, partnerId],
  );
  return result.rowCount || 0;
}

export async function pgUnreadMessageCount(userId: string): Promise<number> {
  const result = await getPostgresPool().query<{ count: string }>(
    "SELECT count(*)::text count FROM direct_messages WHERE to_user_id=$1 AND is_read=false",
    [userId],
  );
  return Number(result.rows[0]?.count || 0);
}

export async function pgMessageContacts(userId: string, query?: string): Promise<any[]> {
  const result = await getPostgresPool().query(
    `WITH contacts AS (
       SELECT following_id id,true i_follow,false follows_me FROM user_follows WHERE follower_id=$1
       UNION ALL SELECT follower_id,false,true FROM user_follows WHERE following_id=$1
     ), flags AS (
       SELECT id,bool_or(i_follow) i_follow,bool_or(follows_me) follows_me FROM contacts
       WHERE id<>$1 GROUP BY id
     )
     SELECT u.id AS _id,u.username,u.full_name AS "fullName",u.avatar,
       u.source->>'profileImageUrl' AS "profileImageUrl",f.i_follow AS "iFollow",f.follows_me AS "followsMe"
     FROM flags f JOIN users u ON u.id=f.id
     WHERE ($2='' OR u.username ILIKE '%'||$2||'%' OR u.full_name ILIKE '%'||$2||'%')
     ORDER BY u.full_name NULLS LAST,u.username LIMIT 100`,
    [userId, query || ""],
  );
  return result.rows;
}

export async function pgConversations(userId: string, limit = 50): Promise<any[]> {
  const result = await getPostgresPool().query(
    `WITH ranked AS (
       SELECT m.*,
         CASE WHEN from_user_id=$1 THEN to_user_id ELSE from_user_id END partner_id,
         row_number() OVER (PARTITION BY LEAST(from_user_id,to_user_id),GREATEST(from_user_id,to_user_id)
                            ORDER BY created_at DESC,id DESC) rn,
         count(*) FILTER (WHERE to_user_id=$1 AND is_read=false) OVER
           (PARTITION BY LEAST(from_user_id,to_user_id),GREATEST(from_user_id,to_user_id)) unread_count
       FROM direct_messages m WHERE from_user_id=$1 OR to_user_id=$1
     )
     SELECT r.*,u.username,u.full_name,u.avatar,u.source->>'profileImageUrl' profile_image_url
     FROM ranked r JOIN users u ON u.id=r.partner_id WHERE rn=1
     ORDER BY r.created_at DESC LIMIT $2`,
    [userId, limit],
  );
  return result.rows.map((row) => ({
    partnerId: row.partner_id,
    partner: { _id: row.partner_id, username: row.username, fullName: row.full_name,
      avatar: row.avatar, profileImageUrl: row.profile_image_url },
    lastMessage: row.content, lastMessageAt: row.created_at,
    unreadCount: Number(row.unread_count || 0),
  }));
}
