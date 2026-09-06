import crypto from "node:crypto";
import type pg from "pg";
import { getPostgresPool } from "../postgres-runtime";

export const API_PLAN_LIMITS = {
  demo: { rateLimitPerMin: 10, dailyQuota: 100, monthlyQuota: 500 },
  free: { rateLimitPerMin: 60, dailyQuota: 1000, monthlyQuota: 10000 },
  pro: { rateLimitPerMin: 300, dailyQuota: 10000, monthlyQuota: 100000 },
  internal: { rateLimitPerMin: 999999, dailyQuota: 999999999, monthlyQuota: 999999999 },
};
export type ApiPlan = keyof typeof API_PLAN_LIMITS;
export class ApiAccessError extends Error {
  constructor(public status: number, message: string, public details: Record<string, unknown> = {}) { super(message); }
}
const newId = () => crypto.randomBytes(12).toString("hex");
export const hashApiSecret = (secret: string) => crypto.createHash("sha256").update(secret).digest("hex");
const emailKey = (email: string) => email.trim().toLowerCase();
const isoDay = (now: Date) => now.toISOString().slice(0, 10);
const isoMonth = (now: Date) => now.toISOString().slice(0, 7);

async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}

function keyShape(row: any, now = new Date()): any {
  if (!row) return null;
  return {
    _id: row.id, id: row.id, keyPrefix: row.key_prefix, name: row.name, email: row.email,
    appName: row.app_name, appUrl: row.app_url, usageReason: row.usage_reason,
    userId: row.user_id, plan: row.plan,
    status: row.status === "active" && row.expires_at && new Date(row.expires_at) <= now ? "expired" : row.status,
    rateLimitPerMin: row.rate_limit_per_min, dailyQuota: Number(row.daily_quota), monthlyQuota: Number(row.monthly_quota),
    usage: {
      todayCount: row.last_reset_day === isoDay(now) ? Number(row.today_count) : 0,
      monthCount: row.last_reset_month === isoMonth(now) ? Number(row.month_count) : 0,
      totalCount: Number(row.total_count), lastUsedAt: row.last_used_at,
      lastResetDay: row.last_reset_day, lastResetMonth: row.last_reset_month,
    },
    minuteCount: row.minute_reset_at && new Date(row.minute_reset_at) > now ? row.minute_count : 0,
    minuteResetAt: row.minute_reset_at, createdAt: row.created_at, expiresAt: row.expires_at,
  };
}

function userShape(row: any): any {
  return row ? { _id: row.id, id: row.id, email: row.email, passwordHash: row.password_hash,
    name: row.name, company: row.company, website: row.website, plan: row.plan, status: row.status,
    createdAt: row.created_at, lastLoginAt: row.last_login_at } : null;
}

export async function pgFindApiKeyByHash(hash: string): Promise<any> {
  const result = await getPostgresPool().query(
    `SELECT k.*,CASE WHEN u.status='suspended' THEN 'suspended' ELSE k.status END status
     FROM api_keys k LEFT JOIN api_developer_users u ON u.id=k.user_id WHERE k.key_hash=$1`, [hash]);
  return keyShape(result.rows[0]);
}
export async function pgFindApiDeveloperByEmail(email: string): Promise<any> {
  return userShape((await getPostgresPool().query("SELECT * FROM api_developer_users WHERE lower(email)=$1", [emailKey(email)])).rows[0]);
}
export async function pgFindApiDeveloper(id: string): Promise<any> {
  return userShape((await getPostgresPool().query("SELECT * FROM api_developer_users WHERE id=$1", [id])).rows[0]);
}
export async function pgApiKeysForEmail(email: string): Promise<any[]> {
  return (await getPostgresPool().query("SELECT * FROM api_keys WHERE lower(email)=$1 AND plan<>'demo' ORDER BY created_at DESC,id", [emailKey(email)])).rows.map(row => keyShape(row));
}

type KeyInput = { name: string; email: string; appName?: string; appUrl?: string; usageReason?: string; plan?: ApiPlan; userId?: string; expiresAt?: Date };
async function issueKey(client: pg.PoolClient, input: KeyInput): Promise<{ apiKey: string; key: any }> {
  const email = emailKey(input.email);
  // Serializes issuance for standalone requests and portal registrations alike.
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`api-key-email:${email}`]);
  const plan = input.plan || "free";
  if (plan !== "demo" && plan !== "internal") {
    const count = await client.query("SELECT count(*)::int count FROM api_keys WHERE lower(email)=$1 AND status='active' AND plan<>'demo' AND (expires_at IS NULL OR expires_at>now())", [email]);
    if (count.rows[0].count >= 3) throw new ApiAccessError(429, "Maximum 3 active API keys. Please revoke an existing key first.");
  }
  if (input.userId) {
    const user = await client.query("SELECT id FROM api_developer_users WHERE id=$1 AND lower(email)=$2 AND status='active' FOR SHARE", [input.userId, email]);
    if (!user.rowCount) throw new ApiAccessError(403, "Account is suspended or unavailable");
  }
  const apiKey = `mr_${crypto.randomBytes(24).toString("base64url")}`;
  const limits = API_PLAN_LIMITS[plan];
  const result = await client.query(
    `INSERT INTO api_keys(id,key_hash,key_prefix,name,email,app_name,app_url,usage_reason,plan,user_id,
       rate_limit_per_min,daily_quota,monthly_quota,expires_at,last_reset_day,last_reset_month)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
       to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD'),to_char(now() AT TIME ZONE 'UTC','YYYY-MM')) RETURNING *`,
    [newId(), hashApiSecret(apiKey), apiKey.slice(0, 7), input.name, email, input.appName || null,
      input.appUrl || null, input.usageReason || null, plan, input.userId || null,
      limits.rateLimitPerMin, limits.dailyQuota, limits.monthlyQuota, input.expiresAt || null]);
  return { apiKey, key: keyShape(result.rows[0]) };
}
export const pgIssueApiKey = (input: KeyInput) => transaction(client => issueKey(client, input));

export async function pgRegisterApiDeveloper(input: { email: string; name: string; passwordHash: string; company?: string; website?: string }): Promise<any> {
  return transaction(async client => {
    const email = emailKey(input.email);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`api-key-email:${email}`]);
    if ((await client.query("SELECT 1 FROM api_developer_users WHERE lower(email)=$1", [email])).rowCount) {
      throw new ApiAccessError(409, "An account with this email already exists");
    }
    const result = await client.query(
      "INSERT INTO api_developer_users(id,email,password_hash,name,company,website) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
      [newId(), email, input.passwordHash, input.name, input.company || null, input.website || null]);
    const user = userShape(result.rows[0]);
    const issued = await issueKey(client, { email, name: input.name, userId: user._id });
    const token = await createSession(client, user._id);
    return { user, ...issued, token };
  });
}

async function createSession(client: pg.PoolClient, userId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  const result = await client.query("UPDATE api_developer_users SET last_login_at=now() WHERE id=$1 AND status='active' RETURNING id", [userId]);
  if (!result.rowCount) throw new ApiAccessError(403, "Account is suspended");
  await client.query("INSERT INTO api_developer_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')", [hashApiSecret(token), userId]);
  return token;
}
export const pgCreateApiDeveloperSession = (userId: string) => transaction(client => createSession(client, userId));
export async function pgAuthenticateApiDeveloper(token: string): Promise<{ userId: string; email: string } | null> {
  const result = await getPostgresPool().query(
    `SELECT u.id,u.email FROM api_developer_sessions s JOIN api_developer_users u ON u.id=s.user_id
     WHERE s.token_hash=$1 AND s.expires_at>now() AND u.status='active'`, [hashApiSecret(token)]);
  return result.rows[0] ? { userId: result.rows[0].id, email: result.rows[0].email } : null;
}
export async function pgRevokeApiDeveloperSession(token: string): Promise<void> {
  await getPostgresPool().query("DELETE FROM api_developer_sessions WHERE token_hash=$1", [hashApiSecret(token)]);
}
export async function pgRevokeOwnedApiKey(id: string, email: string): Promise<void> {
  const result = await getPostgresPool().query("UPDATE api_keys SET status='revoked' WHERE id=$1 AND lower(email)=$2 AND plan<>'demo' RETURNING id", [id, emailKey(email)]);
  if (!result.rowCount) throw new ApiAccessError(404, "API key not found");
}

export async function pgApiDemoStatus(ipHash: string): Promise<any | null> {
  const row = (await getPostgresPool().query("SELECT expires_at FROM api_demo_usage WHERE ip_hash=$1 AND expires_at>now()", [ipHash])).rows[0];
  return row ? { available: false, expiresAt: row.expires_at, hoursRemaining: Math.max(1, Math.ceil((new Date(row.expires_at).getTime() - Date.now()) / 3600000)) } : null;
}
export async function pgIssueDemoApiKey(ipHash: string): Promise<any> {
  return transaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`api-demo-ip:${ipHash}`]);
    const row = (await client.query("SELECT expires_at FROM api_demo_usage WHERE ip_hash=$1 AND expires_at>now()", [ipHash])).rows[0];
    if (row) throw new ApiAccessError(429, "Demo key already issued for this IP", {
      expiresAt: row.expires_at, hoursRemaining: Math.max(1, Math.ceil((new Date(row.expires_at).getTime() - Date.now()) / 3600000)),
    });
    const expiresAt = new Date(Date.now() + 86400000);
    const issued = await issueKey(client, { name: "Demo User", email: `demo-${ipHash.slice(0, 8)}@themegaradio.com`,
      appName: "API Documentation", usageReason: "API Testing", plan: "demo", expiresAt });
    await client.query(
      `INSERT INTO api_demo_usage(id,ip_hash,demo_key_hash,expires_at) VALUES($1,$2,$3,$4)
       ON CONFLICT(ip_hash) DO UPDATE SET demo_key_hash=EXCLUDED.demo_key_hash,last_issued_at=now(),
       expires_at=EXCLUDED.expires_at,usage_count=api_demo_usage.usage_count+1`,
      [newId(), ipHash, hashApiSecret(issued.apiKey), expiresAt]);
    return issued;
  });
}

export async function pgConsumeApiKey(hash: string): Promise<{ key: any; remaining: number; resetIn: number }> {
  return transaction(async client => {
    // Quota decision + rollover + increment are protected by the same row lock
    // across every API replica. Database clock is authoritative for UTC periods.
    const result = await client.query("SELECT * FROM api_keys WHERE key_hash=$1 FOR UPDATE", [hash]);
    const row = result.rows[0];
    if (!row) throw new ApiAccessError(401, "Invalid API key");
    const now = new Date((await client.query("SELECT clock_timestamp() now")).rows[0].now);
    const key = keyShape(row, now);
    if (key.status !== "active") throw new ApiAccessError(403, `API key is ${key.status}`);
    if (row.user_id) {
      const owner = await client.query("SELECT status FROM api_developer_users WHERE id=$1 FOR SHARE", [row.user_id]);
      if (owner.rows[0]?.status !== "active") throw new ApiAccessError(403, "API account is suspended");
    }
    const resetAt = !row.minute_reset_at || new Date(row.minute_reset_at) <= now ? new Date(now.getTime() + 60000) : new Date(row.minute_reset_at);
    const minute = key.minuteCount;
    const resetIn = Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000));
    const internal = row.plan === "internal";
    if (!internal && minute >= key.rateLimitPerMin) throw new ApiAccessError(429, "Rate limit exceeded", { retryAfter: resetIn, limit: key.rateLimitPerMin });
    if (!internal && key.usage.todayCount >= key.dailyQuota) throw new ApiAccessError(429, "Daily quota exceeded", { dailyQuota: key.dailyQuota });
    if (!internal && key.usage.monthCount >= key.monthlyQuota) throw new ApiAccessError(429, "Monthly quota exceeded", { monthlyQuota: key.monthlyQuota });
    const updated = await client.query(
      `UPDATE api_keys SET today_count=$2,month_count=$3,total_count=total_count+1,last_used_at=$4,
       last_reset_day=$5,last_reset_month=$6,minute_count=$7,minute_reset_at=$8 WHERE id=$1 RETURNING *`,
      [row.id, key.usage.todayCount + (internal ? 0 : 1), key.usage.monthCount + (internal ? 0 : 1),
        now, isoDay(now), isoMonth(now), minute + (internal ? 0 : 1), resetAt]);
    return { key: keyShape(updated.rows[0], now), remaining: Math.max(0, key.rateLimitPerMin - minute - 1), resetIn };
  });
}

export async function pgPruneApiAccess(): Promise<void> {
  await getPostgresPool().query(`DELETE FROM api_keys WHERE plan='demo' AND expires_at<=now();
    DELETE FROM api_demo_usage WHERE expires_at<=now();
    DELETE FROM api_developer_sessions WHERE expires_at<=now();
    DELETE FROM auth_event_logs WHERE ts<now()-interval '30 days'`);
}

export async function pgApiAccessStats(): Promise<any> {
  const result = await getPostgresPool().query(
    `SELECT (SELECT count(*) FROM api_developer_users)::int total_developers,
       count(*) FILTER (WHERE plan<>'demo')::int total_keys,
       count(*) FILTER (WHERE plan<>'demo' AND status='active' AND (expires_at IS NULL OR expires_at>now()))::int active_keys,
       (SELECT count(*) FROM api_demo_usage WHERE expires_at>now())::int active_demo_keys,
       COALESCE(sum(today_count) FILTER (WHERE last_reset_day=to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD')),0)::text today,
       COALESCE(sum(month_count) FILTER (WHERE last_reset_month=to_char(now() AT TIME ZONE 'UTC','YYYY-MM')),0)::text AS "month",
       COALESCE(sum(total_count),0)::text total FROM api_keys`);
  const byPlan = { demo: 0, free: 0, pro: 0 } as Record<string, number>;
  for (const row of (await getPostgresPool().query("SELECT plan,count(*)::int count FROM api_keys GROUP BY plan")).rows) byPlan[row.plan] = row.count;
  const row = result.rows[0];
  return { totalDevelopers: row.total_developers, totalKeys: row.total_keys, activeKeys: row.active_keys,
    activeDemoKeys: row.active_demo_keys, byPlan,
    requests: { today: Number(row.today), month: Number(row.month), total: Number(row.total) } };
}

export async function pgAdminApiKeys(options: { search: string; plan: string; status: string; page: number; limit: number }): Promise<any> {
  const values = [options.search, options.plan, options.status];
  const where = `WHERE ($1='' OR strpos(lower(email||' '||name||' '||COALESCE(app_name,'')||' '||key_prefix),lower($1))>0)
    AND ($2='' OR plan=$2) AND ($3='' OR status=$3)`;
  const total = (await getPostgresPool().query(`SELECT count(*)::int count FROM api_keys ${where}`, values)).rows[0].count;
  const result = await getPostgresPool().query(`SELECT * FROM api_keys ${where} ORDER BY last_used_at DESC NULLS LAST,created_at DESC,id LIMIT $4 OFFSET $5`,
    [...values, options.limit, (options.page - 1) * options.limit]);
  return { keys: result.rows.map(row => keyShape(row)), totalCount: total, page: options.page, limit: options.limit, pages: Math.ceil(total / options.limit) };
}
export async function pgAdminApiDevelopers(options: { search: string; page: number; limit: number }): Promise<any> {
  const where = `WHERE ($1='' OR strpos(lower(u.email||' '||u.name||' '||COALESCE(u.company,'')),lower($1))>0)`;
  const total = (await getPostgresPool().query(`SELECT count(*)::int count FROM api_developer_users u ${where}`, [options.search])).rows[0].count;
  const result = await getPostgresPool().query(
    `SELECT u.*,k.key_count,k.active_keys,k.today,k.month,k.total,k.last_used_at FROM api_developer_users u
     LEFT JOIN LATERAL (SELECT count(*)::int key_count,count(*) FILTER (WHERE status='active' AND (expires_at IS NULL OR expires_at>now()))::int active_keys,
       COALESCE(sum(today_count) FILTER (WHERE last_reset_day=to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD')),0)::text today,
       COALESCE(sum(month_count) FILTER (WHERE last_reset_month=to_char(now() AT TIME ZONE 'UTC','YYYY-MM')),0)::text AS "month",
       COALESCE(sum(total_count),0)::text total,max(last_used_at) last_used_at FROM api_keys WHERE lower(email)=lower(u.email)) k ON true
     ${where} ORDER BY u.created_at DESC,u.id LIMIT $2 OFFSET $3`, [options.search, options.limit, (options.page - 1) * options.limit]);
  return { users: result.rows.map(row => { const { passwordHash: _private, ...user } = userShape(row);
    return { ...user, keyCount: row.key_count, activeKeys: row.active_keys, usage: { today: Number(row.today), month: Number(row.month), total: Number(row.total) }, lastUsedAt: row.last_used_at };
  }), totalCount: total, page: options.page, limit: options.limit, pages: Math.ceil(total / options.limit) };
}
export async function pgUpdateApiKeyStatus(id: string, status: string): Promise<any> {
  return keyShape((await getPostgresPool().query("UPDATE api_keys SET status=$2 WHERE id=$1 RETURNING *", [id, status])).rows[0]);
}
export async function pgUpdateApiKeyPlan(id: string, plan: "free" | "pro"): Promise<any> {
  const limits = API_PLAN_LIMITS[plan];
  return keyShape((await getPostgresPool().query("UPDATE api_keys SET plan=$2,rate_limit_per_min=$3,daily_quota=$4,monthly_quota=$5 WHERE id=$1 RETURNING *",
    [id, plan, limits.rateLimitPerMin, limits.dailyQuota, limits.monthlyQuota])).rows[0]);
}

export async function pgInsertAuthEvent(input: { ts: Date; method: string; event: string; ok: boolean; email?: string | null; userId?: string | null; ip?: string; userAgent?: string; message?: string; detail?: unknown }): Promise<void> {
  await getPostgresPool().query("INSERT INTO auth_event_logs(id,ts,method,event,ok,email,user_id,ip,user_agent,message,detail) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
    [newId(), input.ts, input.method, input.event, input.ok, input.email || null, input.userId || null,
      input.ip || null, input.userAgent || null, input.message || null, input.detail === undefined ? null : JSON.stringify(input.detail)]);
}
export async function pgListAuthEvents(filter: { method?: string; email?: string; ok?: boolean; event?: string; since?: Date }, limit = 200): Promise<any[]> {
  const result = await getPostgresPool().query(
    `SELECT id AS _id,ts,method,event,ok,email,user_id AS "userId",ip,user_agent AS "userAgent",message,detail
     FROM auth_event_logs WHERE ts>=now()-interval '30 days' AND ($1::text IS NULL OR method=$1)
       AND ($2::text IS NULL OR email=$2) AND ($3::boolean IS NULL OR ok=$3)
       AND ($4::text IS NULL OR event=$4) AND ($5::timestamptz IS NULL OR ts>=$5)
     ORDER BY ts DESC,id DESC LIMIT $6`,
    [filter.method || null, filter.email || null, filter.ok ?? null, filter.event || null, filter.since || null, Math.max(1, Math.min(limit, 500))]);
  return result.rows;
}
