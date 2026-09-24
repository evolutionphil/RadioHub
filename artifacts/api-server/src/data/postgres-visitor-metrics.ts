import { getPostgresPool } from '../postgres-runtime';
import type { VisitorContext } from '../middleware/visitor-client-context';

type Pool = Pick<ReturnType<typeof getPostgresPool>, 'query'>;
type DetailsPool = Pick<ReturnType<typeof getPostgresPool>, 'connect'>;
export const VISITOR_TIMEZONE = 'Europe/Berlin';
export const VISITOR_ACTIVE_MINUTES = 30;
export const VISITOR_RETENTION_DAYS = 30;

export async function pgTrackQualifiedVisitor(ip: string, context: VisitorContext, pool: Pool = getPostgresPool()): Promise<void> {
  // inet's primary key canonicalizes equivalent IPv6 spellings. The caller
  // additionally normalizes IPv4-mapped IPv6 addresses to their IPv4 identity.
  const query = { text: `INSERT INTO qualified_visitor_presence
    (ip_address,country_code,channel,platform,device_type,os,browser,context_source,context_collected_at)
    VALUES ($1::inet,$2,$3,$4,$5,$6,$7,$8,now())
    ON CONFLICT(ip_address) DO UPDATE SET
      last_seen_at=EXCLUDED.last_seen_at,country_code=EXCLUDED.country_code,
      channel=EXCLUDED.channel,platform=EXCLUDED.platform,device_type=EXCLUDED.device_type,
      os=EXCLUDED.os,browser=EXCLUDED.browser,context_source=EXCLUDED.context_source,
      context_collected_at=EXCLUDED.context_collected_at
    WHERE qualified_visitor_presence.last_seen_at<=EXCLUDED.last_seen_at`,
    values: [ip, context.countryCode, context.channel, context.platform, context.deviceType,
      context.os, context.browser, context.contextSource], query_timeout: 3000 };
  await pool.query(query);
}

export type VisitorWindow = 'active' | 'today' | 'week';
export interface VisitorDetailsQuery {
  window: VisitorWindow;
  page: number;
  limit: number;
  country?: string;
  platform?: VisitorContext['platform'];
  deviceType?: VisitorContext['deviceType'];
}
export interface VisitorBreakdown { value: string; count: number }
export interface VisitorDetail extends VisitorContext {
  activityId?: string | null;
  maskedIp: string;
  firstSeenAt: string;
  lastSeenAt: string;
  contextCollectedAt: string | null;
}
export interface VisitorDetails {
  window: VisitorWindow;
  computedAt: string;
  collectionStartedAt: string;
  dimensionsStartedAt: string;
  timezone: string;
  identity: 'unique-ip';
  attribution: 'latest-request';
  activeWindowMinutes: number;
  retentionDays: number;
  totalVisitors: number;
  matchedVisitors: number;
  breakdowns: { countries: VisitorBreakdown[]; channels: VisitorBreakdown[]; platforms: VisitorBreakdown[]; devices: VisitorBreakdown[] };
  pagination: { page: number; limit: number; total: number; totalPages: number };
  visitors: VisitorDetail[];
}

async function readDetailsSnapshot(query: { text: string; values: unknown[]; query_timeout: number }, pool: DetailsPool) {
  // Reserve one connection for a scoped timeout; never change shared pool/session
  // settings. Pool acquisition retains the runtime's existing connection timeout.
  const client = await pool.connect();
  let discardClient = false;
  try {
    const begin = { text: "BEGIN READ ONLY; SET LOCAL statement_timeout='3s'", query_timeout: 3000 };
    await client.query(begin);
    const result = await client.query(query);
    const commit = { text: 'COMMIT', query_timeout: 3000 };
    await client.query(commit);
    return result.rows[0];
  } catch (error) {
    // A timed-out/cancelled SELECT leaves a failed transaction. Clear it before
    // reuse, or destroy the connection if rollback itself cannot complete.
    try {
      const rollback = { text: 'ROLLBACK', query_timeout: 3000 };
      await client.query(rollback);
    } catch { discardClient = true; }
    throw error;
  } finally {
    client.release(discardClient);
  }
}

export async function pgUniqueVisitorDetails(options: VisitorDetailsQuery, pool: DetailsPool = getPostgresPool()): Promise<VisitorDetails> {
  // One statement means every count, breakdown and page uses one MVCC snapshot.
  // Materialize only the selected (at most seven-day) window, not retained history.
  // Raw inet addresses stay inside PostgreSQL, including the stable paging tie-break.
  const query = { text: `WITH windowed AS MATERIALIZED (
      SELECT * FROM qualified_visitor_presence WHERE last_seen_at >= CASE $1::text
        WHEN 'active' THEN now()-interval '30 minutes'
        WHEN 'today' THEN date_trunc('day',now() AT TIME ZONE 'Europe/Berlin') AT TIME ZONE 'Europe/Berlin'
        WHEN 'week' THEN now()-interval '7 days' END
    ), filtered AS MATERIALIZED (
      SELECT * FROM windowed WHERE ($2::text IS NULL OR coalesce(country_code,'unknown')=$2)
        AND ($3::text IS NULL OR platform=$3) AND ($4::text IS NULL OR device_type=$4)
    ), breakdown AS (
      SELECT dimension,value,count(*)::int AS count FROM windowed
      CROSS JOIN LATERAL (VALUES ('countries',coalesce(country_code,'unknown')),
        ('channels',channel),('platforms',platform),('devices',device_type)) AS d(dimension,value)
      GROUP BY dimension,value
    ), paged AS (
      SELECT filtered.*,activity.id AS activity_id FROM filtered
      LEFT JOIN visitor_activity_subjects activity ON activity.ip_address=filtered.ip_address AND activity.traffic_kind='qualified'
      ORDER BY filtered.last_seen_at DESC,filtered.ip_address ASC LIMIT $5 OFFSET $6
    ) SELECT now() AS measured_at,
      (SELECT value->>'collectionStartedAt' FROM runtime_app_state WHERE key='unique-visitor-metrics:v1') AS started_at,
      (SELECT value->>'dimensionsStartedAt' FROM runtime_app_state WHERE key='unique-visitor-details:v1') AS dimensions_started_at,
      (SELECT count(*)::int FROM windowed) AS total_visitors,
      (SELECT count(*)::int FROM filtered) AS matched_visitors,
      coalesce((SELECT jsonb_agg(jsonb_build_object('value',value,'count',count) ORDER BY count DESC,value ASC)
        FROM breakdown WHERE dimension='countries'),'[]'::jsonb) AS countries,
      coalesce((SELECT jsonb_agg(jsonb_build_object('value',value,'count',count) ORDER BY count DESC,value ASC)
        FROM breakdown WHERE dimension='channels'),'[]'::jsonb) AS channels,
      coalesce((SELECT jsonb_agg(jsonb_build_object('value',value,'count',count) ORDER BY count DESC,value ASC)
        FROM breakdown WHERE dimension='platforms'),'[]'::jsonb) AS platforms,
      coalesce((SELECT jsonb_agg(jsonb_build_object('value',value,'count',count) ORDER BY count DESC,value ASC)
        FROM breakdown WHERE dimension='devices'),'[]'::jsonb) AS devices,
      coalesce((SELECT jsonb_agg(jsonb_build_object(
        'activityId',activity_id,
        'maskedIp',host(network(set_masklen(ip_address,CASE family(ip_address) WHEN 4 THEN 24 ELSE 48 END)))
          || CASE family(ip_address) WHEN 4 THEN '/24' ELSE '/48' END,
        'firstSeenAt',first_seen_at,'lastSeenAt',last_seen_at,'countryCode',country_code,
        'channel',channel,'platform',platform,'deviceType',device_type,'os',os,'browser',browser,
        'contextSource',context_source,'contextCollectedAt',context_collected_at)
        ORDER BY last_seen_at DESC,ip_address ASC) FROM paged),'[]'::jsonb) AS visitors`,
    values: [options.window, options.country ?? null, options.platform ?? null, options.deviceType ?? null,
      options.limit, (options.page - 1) * options.limit], query_timeout: 3000 };
  const row = await readDetailsSnapshot(query, pool);
  if (!row || !row.started_at || !row.dimensions_started_at
      || !Number.isFinite(new Date(row.started_at).getTime())
      || !Number.isFinite(new Date(row.dimensions_started_at).getTime())) {
    throw new Error('Unique visitor dimensions are not initialized');
  }
  const matchedVisitors = Number(row.matched_visitors);
  return {
    window: options.window, computedAt: new Date(row.measured_at).toISOString(),
    collectionStartedAt: new Date(row.started_at).toISOString(),
    dimensionsStartedAt: new Date(row.dimensions_started_at).toISOString(),
    timezone: VISITOR_TIMEZONE, identity: 'unique-ip', attribution: 'latest-request',
    activeWindowMinutes: VISITOR_ACTIVE_MINUTES, retentionDays: VISITOR_RETENTION_DAYS,
    totalVisitors: Number(row.total_visitors), matchedVisitors,
    breakdowns: { countries: row.countries, channels: row.channels, platforms: row.platforms, devices: row.devices },
    pagination: { page: options.page, limit: options.limit, total: matchedVisitors, totalPages: Math.ceil(matchedVisitors / options.limit) },
    visitors: row.visitors.map((visitor: VisitorDetail) => ({ ...visitor,
      firstSeenAt: new Date(visitor.firstSeenAt).toISOString(), lastSeenAt: new Date(visitor.lastSeenAt).toISOString(),
      contextCollectedAt: visitor.contextCollectedAt ? new Date(visitor.contextCollectedAt).toISOString() : null,
    })),
  };
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
