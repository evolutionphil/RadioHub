import session from "express-session";
import type { Pool } from "pg";

type StoreCallback = (error?: unknown) => void;

/** Minimal PostgreSQL session store with the express-session Store contract. */
export class PostgresSessionStore extends session.Store {
  private readonly cleanupTimer: NodeJS.Timeout;
  private readonly pool: Pool;
  private readonly defaultTtlMs: number;

  constructor(
    pool: Pool,
    defaultTtlMs = 3 * 24 * 60 * 60 * 1000,
  ) {
    super();
    this.pool = pool;
    this.defaultTtlMs = defaultTtlMs;
    this.cleanupTimer = setInterval(() => {
      void this.pool.query("DELETE FROM user_sessions WHERE expire < now()").catch(() => undefined);
    }, 15 * 60 * 1000);
    this.cleanupTimer.unref();
  }

  private expiresAt(value: session.SessionData): Date {
    const cookieExpiry = value.cookie?.expires;
    const parsed = cookieExpiry ? new Date(cookieExpiry) : null;
    return parsed && Number.isFinite(parsed.getTime())
      ? parsed
      : new Date(Date.now() + this.defaultTtlMs);
  }

  get(sid: string, callback: (error: unknown, session?: session.SessionData | null) => void): void {
    void this.pool
      .query<{ sess: session.SessionData }>(
        "SELECT sess FROM user_sessions WHERE sid=$1 AND expire >= now()",
        [sid],
      )
      .then((result) => callback(null, result.rows[0]?.sess ?? null))
      .catch((error) => callback(error));
  }

  set(sid: string, value: session.SessionData, callback?: StoreCallback): void {
    void this.pool
      .query(
        `INSERT INTO user_sessions(sid, sess, expire) VALUES ($1,$2,$3)
         ON CONFLICT (sid) DO UPDATE SET sess=EXCLUDED.sess, expire=EXCLUDED.expire`,
        [sid, JSON.stringify(value), this.expiresAt(value)],
      )
      .then(() => callback?.())
      .catch((error) => callback?.(error));
  }

  destroy(sid: string, callback?: StoreCallback): void {
    void this.pool
      .query("DELETE FROM user_sessions WHERE sid=$1", [sid])
      .then(() => callback?.())
      .catch((error) => callback?.(error));
  }

  touch(sid: string, value: session.SessionData, callback?: StoreCallback): void {
    void this.pool
      .query("UPDATE user_sessions SET expire=$2 WHERE sid=$1", [sid, this.expiresAt(value)])
      .then(() => callback?.())
      .catch((error) => callback?.(error));
  }

  clear(callback?: StoreCallback): void {
    void this.pool
      .query("DELETE FROM user_sessions")
      .then(() => callback?.())
      .catch((error) => callback?.(error));
  }

  length(callback: (error: unknown, length?: number) => void): void {
    void this.pool
      .query<{ count: string }>(
        "SELECT count(*)::text AS count FROM user_sessions WHERE expire >= now()",
      )
      .then((result) => callback(null, Number(result.rows[0]?.count || 0)))
      .catch((error) => callback(error));
  }
}
