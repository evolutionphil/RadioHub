import { randomBytes, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type pg from 'pg';
import { PostgresCatalogStore } from './postgres-catalog-store';
import { assessDuplicateGroup } from '../utils/station-duplicate-policy';

const SUMMARY_LIMIT = 20;
const jobError = (message: string, status: number) => Object.assign(new Error(message), { status });
const newId = () => randomBytes(12).toString('hex');
const safeId = (id: unknown): id is string => typeof id === 'string' && /^[a-f0-9]{24}$/i.test(id);
const text = (value: unknown, max = 160) => String(value ?? '').slice(0, max);
type Row = Record<string, any>;

function jobShape(row: Row) {
  const done = row.status === 'completed' || row.status === 'failed';
  return {
    jobId: row.id, status: done ? row.status : 'running', kind: row.kind,
    dryRun: row.kind === 'preview', threshold: row.threshold, previewJobId: row.preview_job_id,
    startedAt: new Date(row.started_at || row.created_at).getTime(),
    createdAt: new Date(row.created_at).toISOString(),
    finishedAt: row.finished_at ? new Date(row.finished_at).getTime() : undefined,
    errorMessage: row.error_message || undefined,
    progress: {
      currentStep: done ? (row.status === 'failed' ? 'Finished with errors' : row.kind === 'preview' ? 'Preview complete' : 'Merge complete')
        : row.phase === 'scan' ? 'Detecting duplicate groups' : `Processed ${row.groups_processed}/${row.total_groups}`,
      percentage: done ? 100 : Math.round(row.groups_processed / Math.max(1, row.total_groups) * 100),
      groupsProcessed: row.groups_processed, totalGroups: row.total_groups,
    },
    results: {
      message: row.kind === 'preview' ? `${row.eligible_groups} safe groups; ${row.skipped_groups} skipped.`
        : `${row.merged_groups} groups merged; ${row.stations_deleted} duplicate records merged into survivors.`,
      mergedStations: row.merged_stations, errors: row.errors,
      totalGroups: row.total_groups, eligibleGroups: row.eligible_groups, skippedGroups: row.skipped_groups,
      skippedReasons: Object.entries(row.skipped_reasons || {}).map(([reason, count]) => ({ reason, count })),
      mergedGroups: row.merged_groups, totalStationsToDelete: row.stations_to_delete, totalStationsDeleted: row.stations_deleted,
      summariesTruncated: Math.max(row.eligible_groups, row.merged_groups) > SUMMARY_LIMIT,
    },
  };
}

/** IDs are frozen in the completed preview. Only the owning transaction may
 * merge and checkpoint a group; no request performs stream/AI calls or merges.
 */
export class PostgresDuplicateJobsStore {
  constructor(private pool: pg.Pool) {}

  async createPreview(threshold = 0.85): Promise<string> {
    const id = newId();
    await this.pool.query(`INSERT INTO station_duplicate_jobs(id,kind,threshold) VALUES($1,'preview',$2)`,
      [id, Number.isFinite(threshold) ? Math.max(0, Math.min(1, threshold)) : 0.85]);
    return id;
  }

  async createApply(previewId: unknown): Promise<string> {
    if (!safeId(previewId)) throw jobError('A completed previewJobId is required', 400);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout='2s'; SET LOCAL lock_timeout='200ms'");
      const preview = (await client.query('SELECT * FROM station_duplicate_jobs WHERE id=$1 FOR UPDATE', [previewId])).rows[0];
      if (!preview || preview.kind !== 'preview' || preview.status !== 'completed') throw jobError('Preview is not complete; preview the groups first', 409);
      const existing = (await client.query('SELECT id FROM station_duplicate_jobs WHERE preview_job_id=$1', [previewId])).rows[0];
      if (existing) { await client.query('COMMIT'); return existing.id; }
      if (!preview.eligible_groups) throw jobError('Preview contains no safely mergeable groups', 400);
      const id = newId();
      await client.query(`INSERT INTO station_duplicate_jobs(id,kind,phase,threshold,preview_job_id,total_groups,eligible_groups,stations_to_delete)
        VALUES($1,'manual','evaluate',$2,$3,$4,$4,$5)`, [id, preview.threshold, previewId, preview.eligible_groups, preview.stations_to_delete]);
      await client.query(`INSERT INTO station_duplicate_job_groups(job_id,ordinal,station_ids,station_count,group_name,country)
        SELECT $1,ordinal,station_ids,station_count,group_name,country FROM station_duplicate_job_groups
        WHERE job_id=$2 AND status='eligible'`, [id, previewId]);
      await client.query('COMMIT');
      return id;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async getJob(id: unknown) {
    if (!safeId(id)) return null;
    const row = (await this.pool.query('SELECT * FROM station_duplicate_jobs WHERE id=$1', [id])).rows[0];
    return row ? jobShape(row) : null;
  }

  async getStatus() {
    const control = (await this.pool.query('SELECT next_auto_at,last_run_at,summary FROM station_duplicate_merge_control WHERE id=1')).rows[0];
    const [current, preview, apply] = await Promise.all([
      this.pool.query("SELECT * FROM station_duplicate_jobs WHERE status IN ('queued','running') ORDER BY created_at,id LIMIT 1"),
      this.pool.query("SELECT * FROM station_duplicate_jobs WHERE kind='preview' ORDER BY created_at DESC,id DESC LIMIT 1"),
      this.pool.query("SELECT * FROM station_duplicate_jobs WHERE kind IN ('manual','automatic') ORDER BY created_at DESC,id DESC LIMIT 1"),
    ]);
    return {
      nextRunAt: control?.next_auto_at || null, lastRunAt: control?.last_run_at || null,
      currentJob: current.rows[0] ? jobShape(current.rows[0]) : null,
      latestPreview: preview.rows[0] ? jobShape(preview.rows[0]) : null,
      latestApply: apply.rows[0] ? jobShape(apply.rows[0]) : null,
    };
  }

  private async seed(client: pg.PoolClient, job: Row, automaticCursor?: { name: string; country: string }) {
    // SQL stores only IDs + bounded group metadata, never source/descriptions.
    // Automatic discovery is deliberately stricter than manual preview: an
    // identical raw endpoint is required before even entering its 100-group cap.
    const seed = async (cursor?: { name: string; country: string }) => client.query(`WITH grouped AS (
      SELECT lower(btrim(regexp_replace(normalize(name,NFKC),'\\s+',' ','g'))) AS name,
        lower(btrim(regexp_replace(normalize(COALESCE(country,''),NFKC),'\\s+',' ','g'))) AS country,
        (array_agg(id ORDER BY id))[1:51] AS ids,count(*)::integer AS members
      FROM stations WHERE char_length(btrim(name)) >= $2
      GROUP BY 1,2 HAVING count(*)>1
      ${job.kind === 'automatic' ? "AND count(DISTINCT btrim(url))=1 AND bool_and(NULLIF(btrim(url),'') IS NOT NULL)" : ''}
    ), candidates AS (
      SELECT * FROM grouped WHERE ($4::text IS NULL OR (name,country)>($4,$5))
      ORDER BY name,country LIMIT $3
    ) INSERT INTO station_duplicate_job_groups(job_id,ordinal,station_ids,station_count,group_name,country)
      SELECT $1,row_number() OVER(ORDER BY name,country)::integer,ids,members,name,country FROM candidates`,
    [job.id, 1, job.kind === 'automatic' ? 100 : 50_000, cursor?.name ?? null, cursor?.country ?? null]);
    let inserted = await seed(job.kind === 'automatic' ? automaticCursor : undefined);
    if (job.kind === 'automatic' && !inserted.rowCount && automaticCursor) inserted = await seed();
    if (job.kind === 'automatic') {
      const last = (await client.query('SELECT group_name AS name,country FROM station_duplicate_job_groups WHERE job_id=$1 ORDER BY ordinal DESC LIMIT 1', [job.id])).rows[0];
      await client.query("UPDATE station_duplicate_merge_control SET summary=jsonb_set(summary,'{automaticCursor}',$1::jsonb) WHERE id=1", [JSON.stringify(last || null)]);
    }
    const count = (await client.query('SELECT count(*)::integer total FROM station_duplicate_job_groups WHERE job_id=$1', [job.id])).rows[0].total;
    await client.query("UPDATE station_duplicate_jobs SET phase='evaluate',total_groups=$2 WHERE id=$1", [job.id, count]);
    job.phase = 'evaluate'; job.total_groups = count;
  }

  private async record(client: pg.PoolClient, job: Row, group: Row, outcome: 'eligible'|'skipped'|'merged', reason: string | null, summary?: Row, deleted = 0) {
    const eligible = outcome === 'eligible' || (outcome === 'merged' && job.kind === 'automatic') ? 1 : 0;
    const planned = outcome === 'eligible' || (outcome === 'merged' && job.kind === 'automatic') ? group.station_count - 1 : 0;
    await client.query('UPDATE station_duplicate_job_groups SET status=$3,reason=$4 WHERE job_id=$1 AND ordinal=$2', [job.id, group.ordinal, outcome, reason]);
    await client.query(`UPDATE station_duplicate_jobs SET groups_processed=groups_processed+1,
      eligible_groups=eligible_groups+$2,skipped_groups=skipped_groups+$3,merged_groups=merged_groups+$4,
      stations_to_delete=stations_to_delete+$5,stations_deleted=stations_deleted+$6,
      merged_stations=CASE WHEN $7::jsonb IS NOT NULL AND jsonb_array_length(merged_stations)<${SUMMARY_LIMIT}
        THEN merged_stations || jsonb_build_array($7::jsonb) ELSE merged_stations END,
      skipped_reasons=CASE WHEN $8::text IS NOT NULL THEN jsonb_set(skipped_reasons,ARRAY[$8],
        to_jsonb(COALESCE((skipped_reasons->>$8)::integer,0)+1)) ELSE skipped_reasons END,updated_at=now()
      WHERE id=$1`, [job.id, eligible, outcome === 'skipped' ? 1 : 0, outcome === 'merged' ? 1 : 0,
      planned, deleted, summary ? JSON.stringify(summary) : null, reason]);
  }

  /** One replica-safe transaction, max10 groups and a 750ms soft cycle budget.
   * Each SQL statement is separately capped at600ms, lock waits at50ms. A
   * started group may finish after the soft budget; never begin another then.
   */
  async runCycle(now = new Date()): Promise<{ processed: number; deleted: number; completed: boolean; deferred: boolean; refreshCounts: boolean }> {
    const idle = { processed: 0, deleted: 0, completed: false, deferred: true, refreshCounts: false };
    if (this.pool.waitingCount) return idle;
    const started = performance.now(), client = await this.pool.connect();
    let processed = 0, deleted = 0, completed = false, refreshCounts = false;
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout='600ms'; SET LOCAL lock_timeout='50ms'");
      const locked = (await client.query("SELECT pg_try_advisory_xact_lock(hashtextextended(current_schema() || ':station-duplicate-merge',0)) locked")).rows[0].locked;
      if (!locked) { await client.query('ROLLBACK'); return idle; }
      const control = (await client.query('SELECT * FROM station_duplicate_merge_control WHERE id=1 FOR UPDATE')).rows[0];
      if (!control || new Date(control.next_cycle_at).getTime() > now.getTime()) { await client.query('ROLLBACK'); return idle; }
      await client.query(`UPDATE station_duplicate_merge_control SET next_cycle_at=$1::timestamptz+interval '15 seconds',
        last_run_at=$1,lease_owner=$2,lease_until=$1::timestamptz+interval '15 seconds' WHERE id=1`, [now, randomUUID()]);
      let job = (await client.query("SELECT * FROM station_duplicate_jobs WHERE status IN ('queued','running') ORDER BY created_at,id LIMIT 1 FOR UPDATE")).rows[0];
      if (!job && new Date(control.next_auto_at).getTime() <= now.getTime()) {
        job = (await client.query("INSERT INTO station_duplicate_jobs(id,kind) VALUES($1,'automatic') RETURNING *", [newId()])).rows[0];
        await client.query("UPDATE station_duplicate_merge_control SET next_auto_at=$1::timestamptz+interval '24 hours' WHERE id=1", [now]);
      }
      if (job) {
        await client.query("UPDATE station_duplicate_jobs SET status='running',started_at=COALESCE(started_at,$2),updated_at=$2 WHERE id=$1", [job.id, now]);
        if (job.phase === 'scan') await this.seed(client, job, control.summary?.automaticCursor || undefined);
        const groups = (await client.query("SELECT * FROM station_duplicate_job_groups WHERE job_id=$1 AND status='pending' ORDER BY ordinal LIMIT 10 FOR UPDATE", [job.id])).rows;
        for (const group of groups) {
          if (performance.now() - started >= 750 || this.pool.waitingCount) break;
          await client.query('SAVEPOINT duplicate_group');
          try {
            if (group.station_count > 50) {
              await this.record(client, job, group, 'skipped', 'group_too_large');
            } else if (job.kind === 'preview') {
              const docs = (await client.query(`SELECT id AS "_id",name,country,country_code AS "countryCode",source->>'city' AS city,state,url,
                url_resolved AS "urlResolved",manual_edit_fields AS "manualEditFields",votes FROM stations WHERE id=ANY($1::text[]) ORDER BY id`, [group.station_ids])).rows;
              const decision = docs.length === group.station_count ? assessDuplicateGroup(docs) : { eligible: false, reason: 'station_missing' };
              const planned = [...docs].sort((a,b) => (b.votes || 0)-(a.votes || 0) || a._id.localeCompare(b._id));
              await this.record(client, job, group, decision.eligible ? 'eligible' : 'skipped', decision.eligible ? null : decision.reason,
                decision.eligible ? this.summary(group, { ...planned[0], votes: planned.reduce((sum,doc) => sum + (Number(doc.votes) || 0), 0) }, planned.slice(1)) : undefined);
            } else {
              const merged = await new PostgresCatalogStore(this.pool).mergeDuplicates(group.station_ids, { client, requireSafeIdentity: true });
              if (!merged.primary || !merged.deletedCount) {
                await this.record(client, job, group, 'skipped', 'station_missing');
              } else {
                await this.record(client, job, group, 'merged', null, this.summary(group, merged.primary, merged.duplicates), merged.deletedCount);
                deleted += merged.deletedCount;
              }
            }
            await client.query('RELEASE SAVEPOINT duplicate_group');
            processed++;
          } catch (error: any) {
            await client.query('ROLLBACK TO SAVEPOINT duplicate_group');
            if (['57014','55P03','40P01','40001'].includes(error?.code)) {
              // Retry transient contention, but never let one persistent slow
              // group starve every later group or the daily schedule forever.
              if (group.attempts >= 2) {
                await this.record(client, job, group, 'skipped', 'deferred_timeout_requires_review'); processed++;
              } else {
                await client.query('UPDATE station_duplicate_job_groups SET attempts=attempts+1 WHERE job_id=$1 AND ordinal=$2', [job.id, group.ordinal]);
              }
              break;
            }
            if (['UNSAFE_DUPLICATE_GROUP','PRIMARY_NOT_FOUND','MERGE_ALIAS_CONFLICT'].includes(error?.code)) {
              await this.record(client, job, group, 'skipped', error.code === 'MERGE_ALIAS_CONFLICT' ? 'alias_conflict_requires_review' : 'group_changed_or_unsafe'); processed++;
            } else if (group.attempts >= 2) {
              await this.record(client, job, group, 'skipped', 'merge_failed'); processed++;
              await client.query(`UPDATE station_duplicate_jobs SET errors=CASE WHEN jsonb_array_length(errors)<${SUMMARY_LIMIT}
                THEN errors || jsonb_build_array('Group ' || $2::text || ': merge failed after retries') ELSE errors END WHERE id=$1`, [job.id, group.ordinal]);
            } else {
              await client.query('UPDATE station_duplicate_job_groups SET attempts=attempts+1 WHERE job_id=$1 AND ordinal=$2', [job.id, group.ordinal]);
              break;
            }
          }
        }
        const pending = (await client.query("SELECT 1 FROM station_duplicate_job_groups WHERE job_id=$1 AND status='pending' LIMIT 1", [job.id])).rowCount;
        if (!pending) {
          await client.query(`UPDATE station_duplicate_jobs SET status=CASE WHEN jsonb_array_length(errors)>0 THEN 'failed' ELSE 'completed' END,
            finished_at=$2,updated_at=$2 WHERE id=$1`, [job.id, now]);
          completed = true;
          refreshCounts = job.kind !== 'preview' && Number(job.stations_deleted) + deleted > 0;
        }
      }
      await client.query('UPDATE station_duplicate_merge_control SET lease_owner=NULL,lease_until=NULL,summary=summary || $1::jsonb WHERE id=1', [JSON.stringify({ processed, deleted, completed })]);
      await client.query('COMMIT');
      return { processed, deleted, completed, deferred: false, refreshCounts };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  private summary(group: Row, primary: Row, duplicates: Row[]) {
    return { groupName: text(group.group_name), primaryStation: { name: text(primary.name), country: text(primary.country) },
      mergedStations: duplicates.slice(0,5).map(doc => ({ name: text(doc.name), votes: Number(doc.votes) || 0, url: text(doc.url,512) })),
      fallbackUrlsAdded: 0, totalVotes: Number(primary.votes) || 0 };
  }
}
