import type { Express, RequestHandler } from 'express';
import type { PoolClient } from 'pg';
import { getPostgresPool } from '../postgres-runtime';
import { stationListVisibleSql, stationAvailabilityStatusSql } from '../utils/station-visibility';

const visible = stationListVisibleSql('s');
const availability = stationAvailabilityStatusSql('s');
const fields = `s.id AS "_id",s.station_uuid AS stationuuid,s.name,s.url,s.country,s.country_code AS "countryCode",
  s.language,s.tags_raw AS tags,s.favicon,s.codec,s.bitrate,s.votes,s.click_count AS "clickCount",s.click_trend AS "clickTrend",
  s.last_check_ok AS "lastCheckOk",s.last_check_time AS "lastCheckTime",
  s.availability_checked_at AS "availabilityCheckedAt",(${visible}) AS "isListVisible",(${availability}) AS "availabilityStatus",
  (s.source->>'sslError'='true') AS "sslError",s.source->>'lastCheckOkTime' AS "lastCheckOkTime"`;

/** Bounded operational reads: no full source/descriptions, worker triggers or provider calls. */
export function registerAdminOperationsStatusRoutes(app: Express, requireAdmin: RequestHandler): void {
  let cache: { expires: number; value: unknown } | undefined;
  let pending: Promise<unknown> | undefined;
  const load = async () => {
    const client = await getPostgresPool().connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await client.query("SET LOCAL statement_timeout='2000ms'");
      const totals = (await client.query(`SELECT count(*)::int AS total,
        count(*) FILTER (WHERE (${availability})='working')::int AS working,
        count(*) FILTER (WHERE NOT (${visible}))::int AS unavailable,
        count(*) FILTER (WHERE (${availability})='unverified')::int AS unverified,
        count(*) FILTER (WHERE source->>'sslError'='true')::int AS "sslErrors",
        count(*) FILTER (WHERE availability_checked_at>now()-interval '1 hour' AND availability_checked_at<=now()+interval '5 minutes')::int AS "recentChecks",
        count(*) FILTER (WHERE click_trend>0)::int AS uptrend,count(*) FILTER (WHERE click_trend<0)::int AS downtrend
        FROM stations s`)).rows[0];
      const recent = await client.query(`SELECT ${fields} FROM stations s WHERE availability_checked_at>now()-interval '1 hour'
        AND availability_checked_at<=now()+interval '5 minutes' ORDER BY availability_checked_at DESC,id LIMIT 20`);
      const problems = await client.query(`SELECT ${fields} FROM stations s WHERE NOT (${visible}) OR source->>'sslError'='true'
        ORDER BY availability_checked_at DESC NULLS LAST,id LIMIT 50`);
      const trends = await client.query(`SELECT ${fields} FROM stations s WHERE click_trend<>0 ORDER BY abs(click_trend) DESC,id LIMIT 20`);
      await client.query('COMMIT');
      return { totals, recentChecks: recent.rows, problemStations: problems.rows, stations: trends.rows, sampledAt: new Date().toISOString() };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  };
  app.get('/api/admin/operations-status', requireAdmin, async (_req, res) => {
    res.set('Cache-Control', 'private, no-store');
    try {
      if (!cache || cache.expires <= Date.now()) {
        pending ??= load().finally(() => { pending = undefined; });
        cache = { value: await pending, expires: Date.now() + 60_000 };
      }
      res.json(cache.value);
    } catch { res.status(503).json({ error: 'Operational status is temporarily unavailable' }); }
  });

  app.get('/api/admin/radio-browser/stations', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    if (Object.values(req.query).some(value => typeof value !== 'string' || value.length > 200)) return void res.status(400).json({ error: 'Invalid catalogue filters' });
    const limit = Math.min(100, Math.max(1, Number.parseInt(String(req.query.limit || '50'), 10) || 50));
    const minBitrate = Number(req.query.bitrate || (req.query.kind === 'quality' ? 128 : 0));
    if (!Number.isFinite(minBitrate) || minBitrate < 0 || minBitrate > 100000) return void res.status(400).json({ error: 'Invalid minimum bitrate' });
    const values: unknown[] = [];
    const filters: string[] = [];
    for (const [key, column] of [['name','s.name'],['country','s.country'],['language','s.language'],['tag','s.tags_raw'],['codec','s.codec']] as const) {
      const input = String(req.query[key] || '').trim();
      if (input) { values.push('%' + input.replace(/[\\%_]/g, '\\$&') + '%'); filters.push(`${column} ILIKE $${values.length} ESCAPE '\\'`); }
    }
    if (minBitrate > 0) { values.push(minBitrate); filters.push(`s.bitrate >= $${values.length}`); }
    if (req.query.hidebroken !== 'false') filters.push(`(${visible})`);
    if (req.query.is_https === 'true') filters.push("s.url ILIKE 'https://%'");
    const order = req.query.kind === 'recent' ? 's.updated_at DESC NULLS LAST' : req.query.kind === 'quality' ? 's.bitrate DESC' : req.query.kind === 'trending' ? 's.click_trend DESC' : 's.votes DESC';
    values.push(limit);
    let client: PoolClient | undefined;
    try {
      client = await getPostgresPool().connect();
      await client.query('BEGIN READ ONLY');
      await client.query("SET LOCAL statement_timeout='2000ms'");
      const result = await client.query(`SELECT ${fields},count(*) OVER()::int AS "matchedTotal" FROM stations s
        WHERE ${filters.join(' AND ') || 'TRUE'} ORDER BY ${order},s.id LIMIT $${values.length}`, values);
      await client.query('COMMIT');
      res.json({ stations: result.rows.map(({ matchedTotal, ...station }) => station), total: result.rows[0]?.matchedTotal || 0 });
    } catch { if (client) await client.query('ROLLBACK'); res.status(503).json({ error: 'Catalogue browser is temporarily unavailable' }); }
    finally { client?.release(); }
  });
}
