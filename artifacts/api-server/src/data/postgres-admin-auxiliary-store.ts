import crypto from 'node:crypto';
import type pg from 'pg';
import { getPostgresPool } from '../postgres-runtime';
type Doc = Record<string,any>;
const presetShape = (row: Doc): Doc => ({ _id:row.id,name:row.name,countries:row.countries,ownerUsername:row.owner_username,createdAt:row.created_at,updatedAt:row.updated_at });
const issueShape = (row: Doc): Doc => ({ _id:row.id,url:row.url,statusCode:row.status_code,issueType:row.issue_type,issueDescription:row.issue_description,priority:row.priority,importedAt:row.imported_at,expiresAt:row.expires_at });
const id = () => crypto.randomBytes(12).toString('hex');
export class PostgresAdminAuxiliaryStore {
  constructor(private readonly pool: pg.Pool = getPostgresPool()) {}
  async preferenceGet(admin: string,key: string): Promise<Doc | null> {
    const row = (await this.pool.query('SELECT value,updated_at AS "updatedAt" FROM admin_preferences WHERE admin_username=$1 AND key=$2',[admin,key])).rows[0];
    return row || null;
  }
  async preferenceSet(admin: string,key: string,value: unknown): Promise<Doc> {
    return (await this.pool.query(`INSERT INTO admin_preferences(id,admin_username,key,value) VALUES($1,$2,$3,$4::jsonb)
      ON CONFLICT(admin_username,key) DO UPDATE SET value=excluded.value,updated_at=now() RETURNING value,updated_at AS "updatedAt"`,[id(),admin,key,JSON.stringify(value ?? null)])).rows[0];
  }
  async preferenceDelete(admin: string,key: string): Promise<{ deletedCount:number }> {
    return { deletedCount:(await this.pool.query('DELETE FROM admin_preferences WHERE admin_username=$1 AND key=$2',[admin,key])).rowCount || 0 };
  }
  async presets(): Promise<Doc[]> { return (await this.pool.query('SELECT * FROM shared_comparison_presets ORDER BY updated_at DESC,id')).rows.map(presetShape); }
  async preset(id: string): Promise<Doc | null> {
    const row = (await this.pool.query('SELECT * FROM shared_comparison_presets WHERE id=$1',[id])).rows[0]; return row ? presetShape(row) : null;
  }
  async presetCreate(doc: Doc,maximum: number): Promise<Doc> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('admin-shared-presets',0))");
      if (Number((await client.query('SELECT count(*) FROM shared_comparison_presets')).rows[0].count)>=maximum) throw Object.assign(new Error('Shared preset limit reached'),{ code:'PRESET_LIMIT' });
      const row = (await client.query('INSERT INTO shared_comparison_presets(id,name,countries,owner_username) VALUES($1,$2,$3,$4) RETURNING *',[id(),doc.name,doc.countries,doc.ownerUsername])).rows[0];
      await client.query('COMMIT'); return presetShape(row);
    } catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async presetUpdate(presetId: string,actor: string,superAdmin: boolean,patch: Doc): Promise<Doc | null> {
    const row = (await this.pool.query(`UPDATE shared_comparison_presets SET name=COALESCE($4,name),countries=COALESCE($5,countries),updated_at=now()
      WHERE id=$1 AND (owner_username=$2 OR $3) RETURNING *`,[presetId,actor,superAdmin,patch.name ?? null,patch.countries ?? null])).rows[0];
    return row ? presetShape(row) : null;
  }
  async presetDelete(presetId: string,actor: string,superAdmin: boolean): Promise<number> {
    return (await this.pool.query('DELETE FROM shared_comparison_presets WHERE id=$1 AND (owner_username=$2 OR $3)',[presetId,actor,superAdmin])).rowCount || 0;
  }
  async replaceIssues(docs: Doc[]): Promise<number> {
    for (const doc of docs) if (!doc.url || !doc.issueType || !['High','Medium','Low','Info'].includes(doc.priority) || !Number.isFinite(new Date(doc.expiresAt).getTime())) throw new Error('Invalid SEMrush issue record');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('semrush-import',0))");
      await client.query('DELETE FROM semrush_issues');
      for (let offset=0;offset<docs.length;offset+=1000) {
        const batch = docs.slice(offset,offset+1000).map(doc=>({ id:id(),url:doc.url,status_code:doc.statusCode || 0,issue_type:doc.issueType,issue_description:doc.issueDescription || '',priority:doc.priority,imported_at:doc.importedAt || new Date(),expires_at:doc.expiresAt }));
        await client.query(`INSERT INTO semrush_issues SELECT * FROM jsonb_to_recordset($1::jsonb)
          AS x(id text,url text,status_code integer,issue_type text,issue_description text,priority text,imported_at timestamptz,expires_at timestamptz)`,[JSON.stringify(batch)]);
      }
      await client.query('COMMIT'); return docs.length;
    } catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async issues(priority: string,type: string,limit: number,offset: number): Promise<{ total:number; items:Doc[] }> {
    const predicate = "expires_at>now() AND ($1='' OR $1='all' OR priority=$1) AND ($2='' OR $2='all' OR position(lower($2) in lower(issue_type))>0)";
    const [count,rows] = await Promise.all([this.pool.query(`SELECT count(*)::integer AS total FROM semrush_issues WHERE ${predicate}`,[priority,type]),this.pool.query(`SELECT * FROM semrush_issues WHERE ${predicate} ORDER BY priority,imported_at DESC,id LIMIT $3 OFFSET $4`,[priority,type,limit,offset])]);
    return { total:count.rows[0].total,items:rows.rows.map(issueShape) };
  }
  async issueSummary(): Promise<Doc> {
    const [priorities,types,latest,count] = await Promise.all([
      this.pool.query('SELECT priority,count(*)::integer AS count FROM semrush_issues WHERE expires_at>now() GROUP BY priority ORDER BY priority'),
      this.pool.query('SELECT issue_type AS type,count(*)::integer AS count FROM semrush_issues WHERE expires_at>now() GROUP BY issue_type ORDER BY count(*) DESC,issue_type LIMIT 20'),
      this.pool.query('SELECT imported_at,expires_at FROM semrush_issues WHERE expires_at>now() ORDER BY imported_at DESC LIMIT 1'),
      this.pool.query('SELECT count(*)::integer AS total FROM semrush_issues WHERE expires_at>now()'),
    ]);
    return { total:count.rows[0].total,byPriority:priorities.rows,topIssueTypes:types.rows,lastImportedAt:latest.rows[0]?.imported_at || null,expiresAt:latest.rows[0]?.expires_at || null };
  }
  async clearIssues(): Promise<{ deletedCount:number }> {
    const client = await this.pool.connect();
    try { await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtextextended('semrush-import',0))");const result = await client.query('DELETE FROM semrush_issues');await client.query('COMMIT');return { deletedCount:result.rowCount || 0 }; }
    catch(error) { await client.query('ROLLBACK');throw error; } finally { client.release(); }
  }
}
let store: PostgresAdminAuxiliaryStore | undefined;
export const pgAdminAux = () => store ||= new PostgresAdminAuxiliaryStore();
