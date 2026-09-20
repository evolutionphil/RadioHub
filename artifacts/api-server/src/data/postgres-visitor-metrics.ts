import { getPostgresPool } from '../postgres-runtime';

type Pool = Pick<ReturnType<typeof getPostgresPool>, 'query'>;
export const VISITOR_TIMEZONE = 'Europe/Berlin';
export const VISITOR_ACTIVE_MINUTES = 30;
export const VISITOR_RETENTION_DAYS = 30;

export async function pgTrackQualifiedVisitor(ip: string, pool: Pool = getPostgresPool()): Promise<void> {
  // inet's primary key canonicalizes equivalent IPv6 spellings. The caller
  // additionally normalizes IPv4-mapped IPv6 addresses to their IPv4 identity.
  const query = { text: `INSERT INTO qualified_visitor_presence(ip_address) VALUES ($1::inet)
    ON CONFLICT(ip_address) DO UPDATE SET last_seen_at=now()`, values: [ip], query_timeout: 3000 };
  await pool.query(query);
}

export async function pgPruneQualifiedVisitors(pool: Pool = getPostgresPool()): Promise<number> {
  // A returning visitor is retained by last activity, never by account/row age.
  return (await pool.query(`DELETE FROM qualified_visitor_presence WHERE last_seen_at<now()-interval '30 days'`)).rowCount || 0;
}

export async function pgUniqueVisitorMetrics(pool: Pool = getPostgresPool()) {
  const query = { text: `SELECT
    count(*) FILTER (WHERE last_seen_at>=now()-interval '30 minutes')::int AS active,
    count(*) FILTER (WHERE last_seen_at>=date_trunc('day',now() AT TIME ZONE 'Europe/Berlin') AT TIME ZONE 'Europe/Berlin')::int AS today,
    count(*)::int AS week, now() AS measured_at,
    (SELECT value->>'collectionStartedAt' FROM runtime_app_state WHERE key='unique-visitor-metrics:v1') AS started_at
    FROM qualified_visitor_presence WHERE last_seen_at>=now()-interval '7 days'`, query_timeout: 3000 };
  const result = await pool.query(query);
  const row = result.rows[0];
  // An unavailable measurement is not a zero, nor an inferred start time.
  if (!row || !row.started_at || !Number.isFinite(new Date(row.started_at).getTime())) {
    throw new Error('Unique visitor measurement is not initialized');
  }
  return {
    activeVisitors: Number(row.active), todayVisitors: Number(row.today), weekVisitors: Number(row.week),
    computedAt: new Date(row.measured_at).toISOString(), collectionStartedAt: new Date(row.started_at).toISOString(),
    activeWindowMinutes: VISITOR_ACTIVE_MINUTES, timezone: VISITOR_TIMEZONE,
    identity: 'unique-ip' as const, source: 'qualified-http-requests' as const, retentionDays: VISITOR_RETENTION_DAYS,
  };
}
