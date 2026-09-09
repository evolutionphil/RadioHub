import { randomUUID } from 'node:crypto';
import type pg from 'pg';

export interface HealthCandidate {
  id: string; url: string; lastCheckTime: Date | null; lastCheckOk: boolean; token: string;
}
export interface HealthObservation {
  outcome: 'healthy' | 'failed' | 'inconclusive'; reason: string;
  checkedAt: string; bytesRead: number;
}
const minutes = (n: number) => n * 60_000;

/** Small transactions only: no stream socket or long-lived DB lock in this store. */
export class PostgresStreamHealthStore {
  constructor(private pool: pg.Pool) {}

  async claim(now = new Date()): Promise<HealthCandidate[]> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout='2s'; SET LOCAL lock_timeout='500ms'");
      // Durable quota shared by replicas and restarts, not an in-process flag.
      const gate = await client.query(`UPDATE station_stream_health_control
        SET next_run_at=$1::timestamptz+interval '2 minutes',last_run_at=$1
        WHERE id=1 AND next_run_at<=$1 RETURNING id`, [now]);
      if (!gate.rowCount) { await client.query('COMMIT'); return []; }
      // Gradual seeding includes broken records, so they can recover. No DDL,
      // archive scan or full source JSON hydration occurs during application boot.
      await client.query(`INSERT INTO station_stream_health(station_id,next_check_at)
        SELECT s.id,$1 FROM stations s WHERE NOT EXISTS
          (SELECT 1 FROM station_stream_health h WHERE h.station_id=s.id)
        ORDER BY s.last_check_ok,s.id LIMIT 500 ON CONFLICT DO NOTHING`, [now]);
      const token = randomUUID();
      const result = await client.query(`WITH due AS (
        SELECT station_id FROM station_stream_health WHERE next_check_at<=$1
          AND (lease_until IS NULL OR lease_until<$1)
        ORDER BY next_check_at,station_id LIMIT 12 FOR UPDATE SKIP LOCKED
      ), claimed AS (
        UPDATE station_stream_health h SET lease_token=$2,lease_until=$1::timestamptz+interval '10 minutes'
        FROM due WHERE h.station_id=due.station_id RETURNING h.station_id
      ) SELECT s.id,COALESCE(NULLIF(btrim(s.url_resolved),''),s.url) url,s.last_check_time,s.last_check_ok
        FROM claimed JOIN stations s ON s.id=claimed.station_id`, [now, token]);
      await client.query('COMMIT');
      return result.rows.map(row => ({ id: row.id, url: row.url || '', lastCheckTime: row.last_check_time, lastCheckOk:row.last_check_ok, token }));
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async complete(candidate: HealthCandidate, observation: HealthObservation, now = new Date()): Promise<boolean> {
    const checkedAt = new Date(observation.checkedAt);
    if (!Number.isFinite(checkedAt.getTime()) || Math.abs(+now - +checkedAt) > minutes(5) ||
        !['healthy','failed','inconclusive'].includes(observation.outcome) ||
        !Number.isInteger(observation.bytesRead) || observation.bytesRead < 0 || observation.bytesRead > 65_536) {
      throw new Error('Invalid bounded stream-health evidence');
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout='2s'; SET LOCAL lock_timeout='500ms'");
      const h = (await client.query(`SELECT * FROM station_stream_health
        WHERE station_id=$1 AND lease_token=$2 AND lease_until>$3 FOR UPDATE`,
      [candidate.id, candidate.token, now])).rows[0];
      if (!h) { await client.query('COMMIT'); return false; }
      const s = (await client.query(`SELECT id,url,url_resolved,last_check_ok,last_check_time,manual_edit_fields
        FROM stations WHERE id=$1 FOR UPDATE`, [candidate.id])).rows[0];
      if (!s) { await client.query('COMMIT'); return false; }
      const sameUrl = (s.url_resolved?.trim() || s.url || '') === candidate.url;
      const sameHealth = s.last_check_ok === candidate.lastCheckOk &&
        (s.last_check_time?.getTime() ?? null) === (candidate.lastCheckTime?.getTime() ?? null);
      const eligible = sameUrl && sameHealth && !s.manual_edit_fields?.lastCheckOk &&
        (!s.last_check_time || +checkedAt >= +s.last_check_time);
      const priorSameUrl = h.stream_url === candidate.url && !(s.last_check_ok === true &&
        h.first_failure_at && s.last_check_time && +s.last_check_time > +h.first_failure_at);
      let failures = priorSameUrl ? h.failure_count : 0;
      let firstFailure: Date | null = priorSameUrl ? h.first_failure_at : null;
      let health: boolean | null = null;
      let next = new Date(+now + minutes(6 * 60));
      if (!eligible) {
        failures = 0; firstFailure = null; next = new Date(+now + minutes(15));
      } else if (observation.outcome === 'healthy') {
        health = true; failures = 0; firstFailure = null;
        next = new Date(+now + minutes(7 * 24 * 60));
      } else if (observation.outcome === 'failed') {
        if (!firstFailure) { firstFailure = now; failures = 1; }
        else if (+now - +firstFailure >= minutes(10)) failures = 2;
        if (failures >= 2) { health = false; next = new Date(+now + minutes(12 * 60)); }
        else next = new Date(+now + minutes(15));
      } else {
        // A timeout/geo-block/429 is not proof of a dead station. Break the
        // consecutive-failure chain, preserve the last confirmed availability.
        failures = 0; firstFailure = null;
      }
      let changed = false;
      if (health !== null) {
        changed = s.last_check_ok !== health;
        // Preserve articles, logos, votes, favorites, manual noIndex and archive.
        // Health sampling alone must not bump sitemap content lastmod.
        await client.query(`UPDATE stations SET last_check_ok=$2,last_check_time=$3,
          source=COALESCE(source,'{}'::jsonb) || $4::jsonb WHERE id=$1`,
        [candidate.id, health, checkedAt, JSON.stringify({
          ...(health ? { lastCheckOkTime: checkedAt.toISOString() } : {}),
          streamHealth: { actor: 'bounded-local-probe', outcome: observation.outcome,
            checkedAt: checkedAt.toISOString(), reason: observation.reason.slice(0,80) },
        })]);
      }
      await client.query(`UPDATE station_stream_health SET lease_token=NULL,lease_until=NULL,
        next_check_at=$3,stream_url=$4,checked_at=$5,outcome=$6,failure_count=$7,
        first_failure_at=$8,reason=$9,bytes_read=$10 WHERE station_id=$1 AND lease_token=$2`,
      [candidate.id,candidate.token,next,candidate.url,checkedAt,eligible ? observation.outcome : 'inconclusive',
        failures,firstFailure,eligible ? observation.reason.slice(0,80) : 'concurrent-station-change',observation.bytesRead]);
      await client.query('COMMIT');
      return changed;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async finishBatch(summary: Record<string, number | boolean>, pause: boolean, now = new Date()): Promise<void> {
    await this.pool.query(`UPDATE station_stream_health_control SET summary=$1::jsonb,
      next_run_at=CASE WHEN $2 THEN greatest(next_run_at,$3::timestamptz+interval '15 minutes') ELSE next_run_at END WHERE id=1`,
    [JSON.stringify(summary),pause,now]);
  }
}
