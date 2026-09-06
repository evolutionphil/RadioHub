import crypto from "node:crypto";
import { getPostgresPool } from "../postgres-runtime";
import { logger } from "../utils/logger";
export type AuthStore = "postgres";
export const authStore: AuthStore = "postgres";
export interface ActiveAuthToken {
    token: string;
    userId: string;
    expiresAt: Date;
    isRevoked: boolean;
    deviceType: string;
    deviceName?: string;
}
export async function ensurePostgresUser(userId: string): Promise<void> {
    const exists = await getPostgresPool().query("SELECT 1 FROM users WHERE id=$1", [userId]);
    if (exists.rowCount)
        return;
    throw new Error(`Cannot create PostgreSQL auth token: user ${userId} is missing`);
}
export async function findActiveAuthToken(token: string, touch = true): Promise<ActiveAuthToken | null> {
    {
        const result = await getPostgresPool().query<{
            token: string;
            user_id: string;
            expires_at: Date;
            is_revoked: boolean;
            device_type: string;
            device_name: string | null;
        }>(`UPDATE auth_tokens SET last_used_at=CASE WHEN $2 THEN now() ELSE last_used_at END
       WHERE token=$1 AND is_revoked=false AND expires_at>now()
       RETURNING token,user_id,expires_at,is_revoked,device_type,device_name`, [token, touch]);
        const row = result.rows[0];
        return row ? {
            token: row.token, userId: row.user_id, expiresAt: row.expires_at,
            isRevoked: row.is_revoked, deviceType: row.device_type,
            deviceName: row.device_name || undefined,
        } : null;
    }
}
export async function createAuthToken(userId: string, deviceType: "mobile" | "tv" | "desktop" | "web" = "mobile", deviceName?: string): Promise<string> {
    const prefix = deviceType === "tv" ? "mrt_tv_" : "mrt_";
    const token = `${prefix}${crypto.randomBytes(32).toString("hex")}`;
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    {
        await ensurePostgresUser(userId);
        const id = crypto.randomUUID();
        await getPostgresPool().query(`INSERT INTO auth_tokens(id,token,user_id,device_type,device_name,expires_at,last_used_at)
       VALUES ($1,$2,$3,$4,$5,$6,now())`, [id, token, userId, deviceType, deviceName || null, expiresAt]);
        const verify = await findActiveAuthToken(token, false);
        if (!verify)
            throw new Error("AuthToken PostgreSQL persistence verification failed");
        logger.log(`✅ PostgreSQL auth token persisted+verified userId=${userId} deviceType=${deviceType}`);
        return token;
    }
}
export async function revokeAuthToken(token: string): Promise<void> {
    {
        await getPostgresPool().query("UPDATE auth_tokens SET is_revoked=true WHERE token=$1", [token]);
        return;
    }
}
export async function deleteUserAuthTokens(userId: string): Promise<void> {
    {
        await getPostgresPool().query("DELETE FROM auth_tokens WHERE user_id=$1", [userId]);
        return;
    }
}
export async function revokeUserAuthTokens(userId: string, filter: {
    deviceType?: string;
    deviceNameSuffix?: string;
} = {}): Promise<number> {
    {
        const result = await getPostgresPool().query(`UPDATE auth_tokens SET is_revoked=true
       WHERE user_id=$1 AND is_revoked=false
         AND ($2='' OR device_type=$2)
         AND ($3='' OR right(device_name,length($3))=$3)`, [userId, filter.deviceType || "", filter.deviceNameSuffix || ""]);
        return result.rowCount || 0;
    }
}
