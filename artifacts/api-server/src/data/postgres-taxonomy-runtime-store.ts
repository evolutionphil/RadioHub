import { randomBytes } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { getPostgresPool } from '../postgres-runtime';
import { SAFE_GENRE_SLUG_RE } from '../seo/genre-slug';
import { GENRE_WHITELIST_SEED } from '../seo/genre-whitelist-seed';

const newId = () => randomBytes(12).toString('hex');
// Match legacy tag counts exactly: lowercase genre, comma-split/trim tags,
// one occurrence of each tag per station. No substring matching or loss of multiword tags.
const stationTags = `CROSS JOIN LATERAL (
  SELECT DISTINCT tag FROM (
    SELECT lower(COALESCE(s.source->>'genre','')) tag
    UNION ALL SELECT lower(btrim(raw_tag)) FROM unnest(string_to_array(COALESCE(s.tags_raw,''),',')) raw_tag
  ) raw_tags WHERE tag<>''
) tags`;

export interface GenreCountRun {
  _id: string; trigger: string; status: 'running' | 'completed' | 'failed'; startedAt: Date;
  finishedAt: Date | null; durationMs: number | null; totalGenres: number; updatedSlugs: number; errorMessage: string | null;
}

export class PostgresTaxonomyRuntimeStore {
  constructor(private readonly pool: Pool) {}

  private async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
    catch(error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async storedCounts(country: string): Promise<Map<string, number>> {
    const { rows } = await this.pool.query('SELECT slug,count FROM genre_counts WHERE country=$1',[country]);
    return new Map(rows.map(r => [r.slug,Number(r.count)]));
  }

  async liveCounts(country: string | null = null): Promise<Map<string, number>> {
    const { rows } = await this.pool.query(`SELECT tags.tag,count(*)::int count FROM stations s ${stationTags}
      WHERE ($1::text IS NULL OR lower(s.country)=lower($1)) GROUP BY tags.tag`,[country]);
    return new Map(rows.map(r => [r.tag,Number(r.count)]));
  }

  async replaceCounts(country: string, counts: Map<string, number>): Promise<void> {
    const values = [...counts].map(([slug,count]) => {
      if (!slug || !Number.isSafeInteger(count) || count<0) throw new Error('Invalid genre count');
      return { id:newId(),slug,count };
    });
    await this.transaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('genre-counts:' || $1,0))",[country]);
      await client.query('DELETE FROM genre_counts WHERE country=$1 AND NOT(slug=ANY($2::text[]))',[country,values.map(r=>r.slug)]);
      await client.query(`INSERT INTO genre_counts(id,country,slug,count)
        SELECT v.id,$1,v.slug,v.count FROM jsonb_to_recordset($2::jsonb) v(id text,slug text,count integer)
        ON CONFLICT(country,slug) DO UPDATE SET count=EXCLUDED.count,updated_at=now()`,[country,JSON.stringify(values)]);
    });
  }

  async genres(slugs?: string[], limit?: number): Promise<Array<{ _id:string; slug:string|null; stationCount:number }>> {
    const { rows } = await this.pool.query(`SELECT id,slug,station_count FROM genres
      WHERE ($1::text[] IS NULL OR slug=ANY($1)) AND ($2::integer IS NULL OR station_count>0)
      ORDER BY station_count DESC,slug LIMIT $2`,[slugs??null,limit??null]);
    return rows.map(r=>({_id:r.id,slug:r.slug,stationCount:Number(r.station_count)}));
  }

  async countryBreakdown(slugs: string[]): Promise<Array<{ _id:{tag:string;cc:string};count:number }>> {
    const { rows } = await this.pool.query(`SELECT tags.tag,upper(s.country_code) cc,count(*)::int count
      FROM stations s ${stationTags} WHERE tags.tag=ANY($1::text[]) AND NULLIF(s.country_code,'') IS NOT NULL
      GROUP BY tags.tag,upper(s.country_code) ORDER BY count DESC,cc`,[slugs]);
    return rows.map(r=>({_id:{tag:r.tag,cc:r.cc},count:Number(r.count)}));
  }

  async cityCounts(countries: string[], cities: string[]): Promise<{total:number;counts:Map<string,number>}> {
    const {rows}=await this.pool.query(`WITH scoped AS MATERIALIZED (
      SELECT name,tags_raw,state FROM stations WHERE country=ANY($1::text[]) AND last_check_ok=true
    ), buckets AS (
      SELECT (SELECT c.name FROM unnest($2::text[]) WITH ORDINALITY c(name,position)
        WHERE strpos(lower(COALESCE(s.name,'')),lower(c.name))>0
          OR strpos(lower(COALESCE(s.tags_raw,'')),lower(c.name))>0
          OR strpos(lower(COALESCE(s.state,'')),lower(c.name))>0
        ORDER BY c.position LIMIT 1) city FROM scoped s
    ), counts AS (SELECT city,count(*)::int count FROM buckets WHERE city IS NOT NULL GROUP BY city)
    SELECT (SELECT count(*)::int FROM scoped) total,c.city,c.count FROM (VALUES(1)) anchor(n) LEFT JOIN counts c ON true`,[countries,cities]);
    return {total:Number(rows[0]?.total??0),counts:new Map(rows.filter(r=>r.city!=null).map(r=>[r.city,Number(r.count)]))};
  }

  async overrides(): Promise<any[]> {
    const {rows} = await this.pool.query('SELECT * FROM genre_whitelist_overrides ORDER BY kind,slug');
    return rows.map(r=>({_id:r.id,kind:r.kind,slug:r.slug,canonical:r.canonical,notes:r.notes,createdBy:r.created_by,createdAt:r.created_at}));
  }

  /** Opposing deltas and dangling aliases are changed atomically across replicas. */
  async mutateOverride(input: {kind:'slug-add'|'slug-remove'|'alias-add'|'alias-remove';slug:string;canonical?:string;notes?:string;createdBy:string;seeded:boolean}): Promise<void> {
    if (!SAFE_GENRE_SLUG_RE.test(input.slug) || !input.createdBy || input.canonical && !SAFE_GENRE_SLUG_RE.test(input.canonical)) throw new Error('Invalid genre override');
    await this.transaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('genre-whitelist',0))");
      if(input.kind==='alias-add') {
        const {rows}=await client.query("SELECT kind,slug FROM genre_whitelist_overrides WHERE slug=ANY($1::text[]) AND kind IN ('slug-add','slug-remove')",[[input.slug,input.canonical]]);
        const allowed = (slug:string) => rows.some(r=>r.slug===slug&&r.kind==='slug-add') || GENRE_WHITELIST_SEED.has(slug)&&!rows.some(r=>r.slug===slug&&r.kind==='slug-remove');
        if(!input.canonical || !allowed(input.canonical) || allowed(input.slug)) {
          const error=new Error('Alias source or target changed; refresh the whitelist and retry');
          Object.assign(error,{code:'GENRE_ALIAS_CONFLICT'});throw error;
        }
      }
      const opposite = input.kind.endsWith('-add') ? input.kind.replace('-add','-remove') : input.kind.replace('-remove','-add');
      await client.query('DELETE FROM genre_whitelist_overrides WHERE kind=$1 AND slug=$2',[opposite,input.slug]);
      if(input.kind==='slug-remove') await client.query("DELETE FROM genre_whitelist_overrides WHERE kind='alias-add' AND canonical=$1",[input.slug]);
      const persist = input.kind==='alias-add' || (input.kind==='slug-add' ? !input.seeded : input.seeded);
      if(persist) await client.query(`INSERT INTO genre_whitelist_overrides(id,kind,slug,canonical,notes,created_by)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(kind,slug) ${input.kind.endsWith('-remove')?'DO NOTHING':'DO UPDATE SET canonical=EXCLUDED.canonical,notes=EXCLUDED.notes,updated_at=now()'}`,
        [newId(),input.kind,input.slug,input.canonical??null,input.notes??'',input.createdBy]);
    });
  }

  async createWhitelistedGenre(slug: string, name: string): Promise<{created:boolean;stationCount:number}> {
    if(!SAFE_GENRE_SLUG_RE.test(slug)||!name.trim()) throw new Error('Invalid genre');
    // Count and insertion share a statement snapshot; conflicts never alter an existing row.
    const {rows} = await this.pool.query(`INSERT INTO genres(id,name,slug,is_discoverable,station_count,source)
      SELECT $1,$2,$3,false,count(*)::int,jsonb_build_object('name',$2::text,'slug',$3::text,'isDiscoverable',false)
      FROM stations s WHERE lower(btrim(COALESCE(s.source->>'genre','')))=lower($2)
        OR EXISTS(SELECT 1 FROM unnest(string_to_array(COALESCE(s.tags_raw,''),',')) tag WHERE lower(btrim(tag))=lower($2))
      ON CONFLICT(slug) DO NOTHING RETURNING station_count`,[newId(),name,slug]);
    return {created:rows.length>0,stationCount:Number(rows[0]?.station_count??0)};
  }

  async recomputeGenreCounts(trigger: string, maxRows: number): Promise<{updatedSlugs:number;totalGenres:number;finishedAt:Date;durationMs:number}> {
    const id = newId(); const startedAt = new Date();
    await this.pool.query("INSERT INTO genre_station_counts_runs(id,trigger,status,started_at) VALUES($1,$2,'running',$3)",[id,trigger,startedAt]);
    try {
      return await this.transaction(async client => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended('genre-station-counts',0))");
        const {rows} = await client.query(`WITH counts AS (SELECT tags.tag,count(*)::int count FROM stations s ${stationTags} GROUP BY tags.tag),
          updated AS (UPDATE genres g SET station_count=COALESCE((SELECT count FROM counts WHERE tag=lower(g.slug)),0),updated_at=now()
            WHERE station_count IS DISTINCT FROM COALESCE((SELECT count FROM counts WHERE tag=lower(g.slug)),0) RETURNING id)
          SELECT (SELECT count(*)::int FROM updated) updated,(SELECT count(*)::int FROM genres) total`);
        const finishedAt = new Date(); const durationMs = finishedAt.getTime()-startedAt.getTime();
        await client.query("UPDATE genre_station_counts_runs SET status='completed',finished_at=$2,duration_ms=$3,total_genres=$4,updated_slugs=$5 WHERE id=$1",
          [id,finishedAt,durationMs,rows[0].total,rows[0].updated]);
        await this.pruneRuns(client,maxRows);
        return {updatedSlugs:rows[0].updated,totalGenres:rows[0].total,finishedAt,durationMs};
      });
    } catch(error) {
      try {
        await this.transaction(async client => {
          await client.query("UPDATE genre_station_counts_runs SET status='failed',finished_at=now(),duration_ms=$2,error_message=$3 WHERE id=$1",
            [id,Date.now()-startedAt.getTime(),error instanceof Error?error.message:String(error)]);
          await this.pruneRuns(client,maxRows);
        });
      } catch(auditError) { throw new AggregateError([error,auditError],'Genre count recompute and failure audit both failed'); }
      throw error;
    }
  }

  private async pruneRuns(client: PoolClient, maxRows: number): Promise<void> {
    const cap = Number.isFinite(maxRows)?Math.max(1,Math.trunc(maxRows)):200;
    await client.query(`DELETE FROM genre_station_counts_runs WHERE id IN (
      SELECT id FROM genre_station_counts_runs WHERE status<>'running' ORDER BY started_at DESC,id DESC OFFSET $1)`,[cap]);
  }

  async runs(limit=20, nightlyOnly=false): Promise<GenreCountRun[]> {
    const {rows} = await this.pool.query(`SELECT * FROM genre_station_counts_runs
      WHERE ($2=false OR trigger LIKE 'cron:nightly%' AND status IN ('completed','failed'))
      ORDER BY started_at DESC,id DESC LIMIT $1`,[Math.max(1,Math.min(limit,100)),nightlyOnly]);
    return rows.map(r=>({_id:r.id,trigger:r.trigger,status:r.status,startedAt:r.started_at,finishedAt:r.finished_at,durationMs:r.duration_ms,totalGenres:r.total_genres,updatedSlugs:r.updated_slugs,errorMessage:r.error_message}));
  }
  async runCount(): Promise<number> { return Number((await this.pool.query('SELECT count(*)::int count FROM genre_station_counts_runs')).rows[0].count); }

  async savePush(id: string, value: Record<string,any>): Promise<void> {
    await this.transaction(async client=>{
      await client.query(`INSERT INTO genre_whitelist_push_logs(id,triggered_at,completed_at,triggered_by,trigger,affected_slugs,sitemap_rebuild,indexnow_sitemap,indexnow_genre_urls)
        VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb) ON CONFLICT(id) DO NOTHING`,
        [id,value.triggeredAt,value.completedAt,value.triggeredBy,value.trigger,value.affectedSlugs,JSON.stringify(value.sitemapRebuild),JSON.stringify(value.indexnowSitemap),JSON.stringify(value.indexnowGenreUrls)]);
      await client.query("DELETE FROM genre_whitelist_push_logs WHERE created_at<now()-interval '90 days'");
    });
  }
  async recentPushes(limit=20): Promise<any[]> {
    const cap=Number.isFinite(limit)?Math.min(Math.max(Math.floor(limit),1),100):20;
    const {rows}=await this.pool.query('SELECT * FROM genre_whitelist_push_logs ORDER BY triggered_at DESC,id DESC LIMIT $1',[cap]);
    return rows.map(r=>({triggeredAt:r.triggered_at,completedAt:r.completed_at,triggeredBy:r.triggered_by,trigger:r.trigger,affectedSlugs:r.affected_slugs,sitemapRebuild:r.sitemap_rebuild,indexnowSitemap:r.indexnow_sitemap,indexnowGenreUrls:r.indexnow_genre_urls}));
  }
}

export const pgTaxonomyRuntime = () => new PostgresTaxonomyRuntimeStore(getPostgresPool());
