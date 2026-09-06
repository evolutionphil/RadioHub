import { getPostgresPool } from '../postgres-runtime';
import { catalogShape, compileCatalogFilter, type CatalogFilter } from './postgres-catalog-store';

/** SQL groups retain the stable public station IDs used throughout the UI. */
export async function pgDuplicateStationGroups(minLength = 3, limit = 10000): Promise<any[]> {
  const result = await getPostgresPool().query(`SELECT lower(btrim(name)) AS name_key,COALESCE(country,'') AS country_key,
    count(*)::integer AS count,jsonb_agg(to_jsonb(s) ORDER BY votes DESC,id) AS stations
    FROM stations s WHERE char_length(lower(btrim(name)))>=$1 GROUP BY lower(btrim(name)),COALESCE(country,'')
    HAVING count(*)>1 ORDER BY count(*) DESC,lower(btrim(name)),COALESCE(country,'') LIMIT $2`,[minLength,limit]);
  return result.rows.map(row=>({ _id: { name: row.name_key,country: row.country_key },count: row.count,stations: row.stations.map(catalogShape) }));
}
export async function pgContentDuplicateGroups(): Promise<any[]> {
  const result = await getPostgresPool().query(`SELECT btrim(name) AS name_key,btrim(url) AS url_key,upper(COALESCE(country_code,'')) AS country_key,
    count(*)::integer AS count,jsonb_agg(jsonb_build_object('_id',id,'stationuuid',station_uuid,'votes',votes,'clickCount',click_count,'noIndex',no_index) ORDER BY id) AS docs
    FROM stations GROUP BY btrim(name),btrim(url),upper(COALESCE(country_code,'')) HAVING count(*)>1
    ORDER BY count(*) DESC,btrim(name),btrim(url),upper(COALESCE(country_code,'')) LIMIT 5000`);
  return result.rows.map(row=>({ _id: { name: row.name_key,url: row.url_key,countryCode: row.country_key },count: row.count,docs: row.docs }));
}
export async function pgDuplicateCityGroups(): Promise<any[]> {
  return (await getPostgresPool().query(`WITH variations AS (
    SELECT lower(btrim(source->>'city')) AS city_key,source->>'city' AS name,count(*)::integer AS count,
      array_agg(DISTINCT COALESCE(country,'')) AS countries
    FROM stations WHERE jsonb_typeof(source->'city')='string' AND char_length(btrim(source->>'city'))>=2
    GROUP BY lower(btrim(source->>'city')),source->>'city'
  ) SELECT city_key AS _id,jsonb_agg(jsonb_build_object('name',name,'count',count,'countries',countries) ORDER BY count DESC,name) AS variations,
    sum(count)::integer AS "totalStations",jsonb_agg(countries) AS "allCountries"
    FROM variations GROUP BY city_key HAVING count(*)>1 ORDER BY sum(count) DESC,city_key LIMIT 10000`)).rows;
}
export async function pgAdminCatalogPage(filter: CatalogFilter, options: { descriptionState?: string; sortBy: string; direction: number; limit: number; offset: number }): Promise<{ stations: any[]; total: number }> {
  const { sql,values } = compileCatalogFilter(filter);
  const countExpr = "(SELECT count(*) FROM jsonb_object_keys(CASE WHEN jsonb_typeof(s.descriptions)='object' THEN s.descriptions ELSE '{}'::jsonb END))";
  const status = options.descriptionState;
  const extra = status==='yes' ? `${countExpr}>0` : status==='no' ? `${countExpr}=0` : status==='partial' ? `${countExpr} BETWEEN 1 AND 13` : 'TRUE';
  const orderFields: Record<string,string> = { name:'s.name',country:'s.country',countryCode:'s.country_code',votes:'s.votes',clickCount:'s.click_count',bitrate:'s.bitrate',codec:'s.codec',language:'s.language',tags:'s.tags_raw',createdAt:'s.created_at',updatedAt:'s.updated_at',noIndex:'s.no_index',hasLogo:'s.has_logo',lastCheckOk:'s.last_check_ok',favicon:"(char_length(COALESCE(s.favicon,''))>5)" };
  const order = orderFields[options.sortBy] || 's.name';
  const direction = options.sortBy==='favicon' ? -options.direction : options.direction;
  const client = await getPostgresPool().connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const count = (await client.query(`SELECT count(*)::integer AS total FROM stations s WHERE ${sql} AND (${extra})`,values)).rows[0].total;
    const rows = await client.query(`SELECT s.* FROM stations s WHERE ${sql} AND (${extra}) ORDER BY ${order} ${direction<0?'DESC':'ASC'} NULLS LAST,s.name,s.id LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,options.limit,options.offset]);
    await client.query('COMMIT');
    return { total: count,stations: rows.rows.map(catalogShape) };
  } catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
export async function pgDatabaseSizeReport(): Promise<any> {
  const tables = (await getPostgresPool().query(`SELECT relname AS name,COALESCE(n_live_tup,0)::float8 AS count,
    round(pg_table_size(relid)/1048576.0,2)::float8 AS "sizeMB",
    round(pg_total_relation_size(relid)/1048576.0,2)::float8 AS "storageSizeMB",
    round(pg_indexes_size(relid)/1048576.0,2)::float8 AS "indexSizeMB"
    FROM pg_stat_user_tables WHERE schemaname=current_schema() ORDER BY pg_total_relation_size(relid) DESC`)).rows;
  return { engine:'postgresql',countsAreEstimates:true,totalSizeMB:tables.reduce((n,row)=>n+row.sizeMB,0),storageSizeMB:tables.reduce((n,row)=>n+row.storageSizeMB,0),indexSizeMB:tables.reduce((n,row)=>n+row.indexSizeMB,0),collections:tables };
}
// Legacy endpoint names remain API aliases, never SQL identifiers from clients.
const purgeTargets: Record<string,{ table: string; column: string; days: number; guard?: string }> = {
  analyticsevent: { table:'analytics_events',column:'created_at',days:0 },
  analyticsevents: { table:'analytics_events',column:'created_at',days:0 },
  synclogs: { table:'catalog_sync_runs',column:'started_at',days:7,guard:"status<>'running'" },
  stationdebuglogs: { table:'station_debug_logs',column:'timestamp',days:3 },
  bulkdescriptionjobs: { table:'bulk_description_jobs',column:'created_at',days:1,guard:"status<>'running'" },
  applogs: { table:'app_logs',column:'created_at',days:30 },
  visitorsessions: { table:'visitor_sessions',column:'created_at',days:30 },
  userlisteninghistories: { table:'listening_history',column:'listened_at',days:30 },
};
export async function pgPurgeOperationalData(targets?: string[], clear = false): Promise<any[]> {
  const names = targets || Object.keys(purgeTargets).filter(key=>key!=='analyticsevent');
  const results = [];
  for (const name of [...new Set(names)]) {
    const key = String(name).toLowerCase().replace(/[_-]/g,''), target = purgeTargets[key];
    if (!target) continue;
    try {
      const where = clear || target.days===0 ? 'TRUE' : `${target.column}<$1`;
      const result = await getPostgresPool().query(`DELETE FROM ${target.table} WHERE (${where}) AND (${target.guard || 'TRUE'})`,clear || target.days===0 ? [] : [new Date(Date.now()-target.days*86400000)]);
      results.push({ collection:name,status:'cleaned',deletedCount:result.rowCount || 0 });
    } catch(error) { results.push({ collection:name,status:'error',error:error instanceof Error ? error.message : String(error) }); }
  }
  return results;
}
