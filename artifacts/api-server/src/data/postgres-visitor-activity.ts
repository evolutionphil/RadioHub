import type { VisitorActivityAction, VisitorActivitySource, VisitorAutomationStatus, VisitorReferralCategory, VisitorTrafficKind } from '@workspace/seo-shared/visitor-activity';
import { getPostgresPool } from '../postgres-runtime';
import type { VisitorContext } from '../middleware/visitor-client-context';

type Pool = Pick<ReturnType<typeof getPostgresPool>, 'connect'>;
export const ACTIVITY_RETENTION_DAYS = 7;
export interface VisitorActivityWrite {
  ip: string; context: VisitorContext; trafficKind: VisitorTrafficKind;
  path: string; action: VisitorActivityAction; method: string; status: number;
  source: VisitorActivitySource; referralCategory: VisitorReferralCategory; automationStatus: VisitorAutomationStatus;
}
export interface ActivityCursor { time: string; id: string }
export const ACTIVITY_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function encodeActivityCursor(time: string, id: string): string {
  return Buffer.from(JSON.stringify({ time, id })).toString('base64url');
}
export function decodeActivityCursor(raw: unknown): ActivityCursor | null {
  if (typeof raw !== 'string' || raw.length > 256 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  try {
    const value = JSON.parse(Buffer.from(raw, 'base64url').toString());
    if (!value || Object.keys(value).sort().join(',') !== 'id,time' || typeof value.time !== 'string'
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value.time)
        || !Number.isFinite(Date.parse(value.time)) || !ACTIVITY_UUID.test(value.id)) return null;
    return value;
  } catch { return null; }
}

async function scopedQuery(text: string, values: unknown[], pool: Pool, readOnly = true) {
  const client = await pool.connect();
  let discard = false;
  try {
    const begin = { text: `BEGIN${readOnly ? ' READ ONLY' : ''}; SET LOCAL statement_timeout='3s'`, query_timeout: 3000 };
    const statement = { text, values, query_timeout: 3000 };
    const commit = { text: 'COMMIT', query_timeout: 3000 };
    await client.query(begin);
    const result = await client.query(statement);
    await client.query(commit);
    return result;
  } catch (error) {
    try { const rollback = { text: 'ROLLBACK', query_timeout: 3000 }; await client.query(rollback); } catch { discard = true; }
    throw error;
  } finally { client.release(discard); }
}

/** Independent of presence counters. A single upsert serializes each IP/kind's
 * hourly event quota across processes. Raw IP lives only in the subject table. */
export async function pgTrackVisitorActivity(event: VisitorActivityWrite, pool: Pool = getPostgresPool()): Promise<void> {
  const c = event.context;
  await scopedQuery(`WITH admitted AS (
    INSERT INTO visitor_activity_subjects(ip_address,traffic_kind,country_code,channel,platform,device_type,os,browser,context_source)
    VALUES($1::inet,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT(ip_address,traffic_kind) DO UPDATE SET last_seen_at=now(),
      country_code=EXCLUDED.country_code,channel=EXCLUDED.channel,platform=EXCLUDED.platform,
      device_type=EXCLUDED.device_type,os=EXCLUDED.os,browser=EXCLUDED.browser,context_source=EXCLUDED.context_source,
      hour_started_at=date_trunc('hour',now()),
      hour_events=CASE WHEN visitor_activity_subjects.hour_started_at<date_trunc('hour',now()) THEN 1 ELSE visitor_activity_subjects.hour_events+1 END
    WHERE visitor_activity_subjects.hour_started_at<date_trunc('hour',now())
      OR visitor_activity_subjects.hour_events<CASE WHEN $2='automated' THEN 6 ELSE 60 END
    RETURNING id
  ) INSERT INTO visitor_activity_events(subject_id,path,action,method,status,source,referral_category,automation_status)
    SELECT id,$10,$11,$12,$13,$14,$15,$16 FROM admitted`,
  [event.ip,event.trafficKind,c.countryCode,c.channel,c.platform,c.deviceType,c.os,c.browser,c.contextSource,
    event.path,event.action,event.method,event.status,event.source,event.referralCategory,event.automationStatus],pool,false);
}

const STAMP = `to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
function metadata(row: any) {
  if (!row?.started_at || !Number.isFinite(Date.parse(row.started_at))) throw new Error('Visitor activity not initialized');
  return { computedAt: new Date(row.measured_at).toISOString(), collectionStartedAt: new Date(row.started_at).toISOString(),
    retentionDays: ACTIVITY_RETENTION_DAYS, sampling: 'bounded-best-effort' as const };
}
export async function pgVisitorActivity(activityId: string, limit: number, before: ActivityCursor | null = null, pool: Pool = getPostgresPool()) {
  const result = await scopedQuery(`WITH selected AS (
      SELECT * FROM visitor_activity_events WHERE subject_id=$1::uuid AND occurred_at>=now()-interval '7 days'
        AND ($3::timestamptz IS NULL OR (occurred_at,id)<($3::timestamptz,$4::uuid))
      ORDER BY occurred_at DESC,id DESC LIMIT $2
    ) SELECT now() AS measured_at,
      (SELECT value->>'collectionStartedAt' FROM runtime_app_state WHERE key='visitor-activity:v1') AS started_at,
      (SELECT traffic_kind FROM visitor_activity_subjects WHERE id=$1::uuid) AS traffic_kind,
      coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'occurredAt',${STAMP},'path',path,'action',action,
        'method',method,'status',status,'source',source,'referralCategory',referral_category,'automationStatus',automation_status)
        ORDER BY occurred_at DESC,id DESC) FROM selected),'[]'::jsonb) AS events`,
    [activityId,limit+1,before?.time??null,before?.id??null],pool);
  const row = result.rows[0];
  const meta = metadata(row);
  if (!row.traffic_kind) return null;
  const events = row.events.slice(0,limit);
  const last = events.at(-1);
  return { ...meta, activityId, trafficKind: row.traffic_kind as VisitorTrafficKind, events,
    nextCursor: row.events.length>limit && last ? encodeActivityCursor(last.occurredAt,last.id) : null };
}

export async function pgAutomatedVisitors(limit: number, before: ActivityCursor | null = null, pool: Pool = getPostgresPool()) {
  const result = await scopedQuery(`WITH selected AS (
      SELECT * FROM visitor_activity_subjects WHERE traffic_kind='automated' AND last_seen_at>=now()-interval '7 days'
        AND ($2::timestamptz IS NULL OR (last_seen_at,id)<($2::timestamptz,$3::uuid))
      ORDER BY last_seen_at DESC,id DESC LIMIT $1
    ) SELECT now() AS measured_at,
      (SELECT value->>'collectionStartedAt' FROM runtime_app_state WHERE key='visitor-activity:v1') AS started_at,
      coalesce((SELECT jsonb_agg(jsonb_build_object('activityId',id,
        'maskedIp',host(network(set_masklen(ip_address,CASE family(ip_address) WHEN 4 THEN 24 ELSE 48 END)))
          || CASE family(ip_address) WHEN 4 THEN '/24' ELSE '/48' END,
        'firstSeenAt',first_seen_at,'lastSeenAt',to_char(last_seen_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'countryCode',country_code,'channel',channel,'platform',platform,'deviceType',device_type,
        'os',os,'browser',browser,'contextSource',context_source,'automationStatus','automated')
        ORDER BY last_seen_at DESC,id DESC) FROM selected),'[]'::jsonb) AS visitors`,
    [limit+1,before?.time??null,before?.id??null],pool);
  const row = result.rows[0];
  const meta = metadata(row), visitors = row.visitors.slice(0,limit), last = visitors.at(-1);
  return { ...meta, visitors, nextCursor: row.visitors.length>limit && last ? encodeActivityCursor(last.lastSeenAt,last.activityId) : null };
}

export async function pgPruneVisitorActivity(pool: Pool = getPostgresPool()): Promise<void> {
  // Bounded work per hourly maintenance pass; reads always enforce seven days
  // even if maintenance is delayed. No unbounded delete on the request path.
  for (let batch=0;batch<4;batch++) {
    const result = await scopedQuery(`DELETE FROM visitor_activity_events WHERE id IN (
      SELECT id FROM visitor_activity_events WHERE occurred_at<now()-interval '7 days' ORDER BY occurred_at LIMIT 5000)`,[],pool,false);
    if ((result.rowCount??0)<5000) break;
  }
  for (let batch=0;batch<4;batch++) {
    const result = await scopedQuery(`DELETE FROM visitor_activity_subjects WHERE id IN (
      SELECT s.id FROM visitor_activity_subjects s WHERE last_seen_at<now()-interval '30 days'
        AND NOT EXISTS(SELECT 1 FROM visitor_activity_events e WHERE e.subject_id=s.id)
      ORDER BY last_seen_at LIMIT 5000)`,[],pool,false);
    if ((result.rowCount??0)<5000) break;
  }
}
