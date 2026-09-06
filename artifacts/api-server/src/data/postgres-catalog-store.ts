import crypto from "node:crypto";
import { isDeepStrictEqual } from 'node:util';
import type pg from "pg";
import { getPostgresPool } from "../postgres-runtime";

export type CatalogDocument = Record<string, any>;
export type CatalogFilter = Record<string, any>;
function syncFencedError(): Error & { code: string } {
  return Object.assign(new Error('PostgreSQL sync run is cancelled, finished or no longer authoritative'), { code: 'SYNC_FENCED' });
}
async function fenceProviderWrite(client: pg.PoolClient, syncRunId?: string): Promise<void> {
  if (!syncRunId) return;
  // Keep a shared row lock until the catalog mutation commits. A replacement
  // leader must finish fencing the old run before creating its own run; it
  // waits for in-flight writes, and all subsequent old writes fail closed.
  const result = await client.query('SELECT status,cancel_requested FROM catalog_sync_runs WHERE id=$1 FOR SHARE', [syncRunId]);
  if (!result.rowCount || result.rows[0].status !== 'running' || result.rows[0].cancel_requested) throw syncFencedError();
}
const fields: Record<string, [string, string]> = {
  _id: ["id","text"], stationuuid: ["station_uuid","text"], changeUuid: ["change_uuid","text"],
  name: ["name","text"], slug: ["slug","text"], slugAliases: ["slug_aliases","text[]"],
  redirectToSlug: ["redirect_to_slug","text"], url: ["url","text"], urlResolved: ["url_resolved","text"],
  homepage: ["homepage","text"], favicon: ["favicon","text"], country: ["country","text"],
  countryCode: ["country_code","text"], state: ["state","text"], language: ["language","text"],
  languageCodes: ["language_codes","text"], tags: ["tags_raw","text"], codec: ["codec","text"],
  bitrate: ["bitrate","integer"], hls: ["hls","boolean"], votes: ["votes","integer"],
  clickCount: ["click_count","integer"], clickTrend: ["click_trend","float8"],
  averageRating: ["average_rating","real"], totalRatings: ["total_ratings","integer"],
  lastCheckOk: ["last_check_ok","boolean"], lastCheckTime: ["last_check_time","timestamptz"],
  geoLat: ["latitude","float8"], geoLong: ["longitude","float8"], hasLogo: ["has_logo","boolean"],
  logoAssets: ["logo_assets","jsonb"], descriptions: ["descriptions","jsonb"],
  manualEditFields: ["manual_edit_fields","jsonb"], mediaGroupId: ["media_group_id","text"],
  isFeatured: ["is_featured","boolean"], showInGlobalPopular: ["show_in_global_popular","boolean"],
  noIndex: ["no_index","boolean"], createdAt: ["created_at","timestamptz"], updatedAt: ["updated_at","timestamptz"],
};
const forbiddenPaths = new Set(["__proto__","prototype","constructor"]);
const providerAliases: Record<string,string> = { countrycode:'countryCode',languagecodes:'languageCodes',url_resolved:'urlResolved',changeuuid:'changeUuid',lastcheckok:'lastCheckOk',lastchecktime:'lastCheckTime',geo_lat:'geoLat',geo_long:'geoLong',clickcount:'clickCount',clicktrend:'clickTrend' };
// High-volume maintenance writes have a deliberately small set-based grammar.
// Complex/nested mutations and provider/manual-field protection keep the fully
// locked document path below; they must never silently lose their safeguards.
const bulkScalarFields: Record<string,'boolean'|'string'|'date'> = {
  noIndex:'boolean', hasLogo:'boolean', isFeatured:'boolean', showInGlobalPopular:'boolean',
  redirectToSlug:'string', city:'string', tagsCheckedAt:'date', aiDescriptionSkipped:'boolean',
  logoEnrichmentAttemptedAt:'date', logoEnrichmentResult:'string',
};
type BulkMutation = { field:string; remove:boolean; value?:any };
function nativeBulkMutations(update:CatalogDocument):BulkMutation[]|null {
  if (update.$inc) return null;
  const mutations=new Map<string,BulkMutation>();
  for (const [field,value] of Object.entries(update.$set || update)) {
    if (field.startsWith('$')) continue;
    const type=bulkScalarFields[field];
    if (!type || value===undefined) return null;
    if (value!==null && !(type==='boolean' ? typeof value==='boolean' : type==='string' ? typeof value==='string' : value instanceof Date && Number.isFinite(value.getTime()))) return null;
    // Non-nullable scalar unsets/explicit nulls require default handling in persist.
    if (value===null && fields[field]?.[1]==='boolean') return null;
    mutations.set(field,{field,value,remove:false});
  }
  for (const field of Object.keys(update.$unset || {})) {
    // logoAssets has no default; clearing it does not affect tag relations.
    if ((!bulkScalarFields[field] && field!=='logoAssets') || (fields[field] && field!=='logoAssets')) return null;
    mutations.set(field,{field,remove:true});
  }
  return mutations.size ? [...mutations.values()] : null;
}
function pathParts(field: string): string[] {
  const parts = field.split(".");
  if (!parts.length || parts.some((part) => !/^[a-zA-Z0-9_-]+$/.test(part) || forbiddenPaths.has(part))) {
    throw new Error(`Unsupported catalog field: ${field}`);
  }
  return parts;
}
export function catalogShape(row: CatalogDocument): CatalogDocument {
  const doc = { ...(row.source || {}) };
  for (const [field,[column]] of Object.entries(fields)) doc[field] = row[column];
  return doc;
}

// This deliberately bounded filter language is compiled to SQL; no records are
// scanned in JavaScript and unknown operators fail instead of broadening a query.
export function compileCatalogFilter(filter: CatalogFilter, values: any[] = []): { sql: string; values: any[] } {
  const bind = (value: any) => { values.push(value); return `$${values.length}`; };
  const fieldExpression = (field: string, candidate?: any): { sql: string; type: string; exists: string } => {
    if (fields[field]) {
      const [column,type] = fields[field];
      return { sql: `s.${column}`, type, exists: `s.${column} IS NOT NULL` };
    }
    const parts = pathParts(field);
    const mapped = fields[parts[0]];
    const root = mapped?.[1] === "jsonb" ? `s.${mapped[0]}` : "s.source";
    const path = bind(mapped?.[1] === "jsonb" ? parts.slice(1) : parts);
    const json = `(${root} #> ${path}::text[])`;
    const text = `(${root} #>> ${path}::text[])`;
    if (typeof candidate === "number") return { sql: `(CASE WHEN jsonb_typeof(${json})='number' THEN ${text}::numeric END)`, type: "numeric", exists: `${json} IS NOT NULL` };
    if (typeof candidate === "boolean") return { sql: `(CASE WHEN jsonb_typeof(${json})='boolean' THEN ${text}::boolean END)`, type: "boolean", exists: `${json} IS NOT NULL` };
    if (candidate instanceof Date) return { sql: `${text}::timestamptz`, type: "timestamptz", exists: `${json} IS NOT NULL` };
    if (candidate && typeof candidate === "object") return { sql: json, type: "jsonb", exists: `${json} IS NOT NULL` };
    return { sql: text, type: "text", exists: `${json} IS NOT NULL` };
  };
  const comparison = (field: string, op: string, value: any): string => {
    const expression = fieldExpression(field, value);
    if (value == null) {
      if (op === "=") return `${expression.sql} IS NULL`;
      if (op === "<>") return `${expression.sql} IS NOT NULL`;
      throw new Error("Ordered null comparison is not supported");
    }
    const candidate = expression.type === "jsonb" ? JSON.stringify(value) : value;
    if (expression.type.endsWith('[]') && !Array.isArray(value)) {
      if (!['=','<>'].includes(op)) throw new Error('Ordered scalar comparison against an array is not supported');
      const match = `${bind(candidate)}::${expression.type.slice(0,-2)}=ANY(${expression.sql})`;
      return op==='=' ? `(${match})` : `NOT COALESCE((${match}),FALSE)`;
    }
    const sql = `${expression.sql} ${op} ${bind(candidate)}::${expression.type}`;
    return op === "<>" ? `(${sql} OR ${expression.sql} IS NULL)` : sql;
  };
  const walk = (node: CatalogFilter): string => {
    const clauses: string[] = [];
    for (const [field, condition] of Object.entries(node)) {
      if (["$or","$and","$nor"].includes(field)) {
        if (!Array.isArray(condition)) throw new Error(`${field} must contain filters`);
        const joined = condition.map((value) => `(${walk(value)})`).join(field === "$and" ? " AND " : " OR ");
        clauses.push(field === "$nor" ? `NOT COALESCE((${joined || "FALSE"}),FALSE)` : `(${joined || (field === "$and" ? "TRUE" : "FALSE")})`);
      } else if (field.startsWith("$")) throw new Error(`Unsupported catalog operator: ${field}`);
      else if (condition instanceof RegExp) {
        if (/[^iu]/.test(condition.flags)) throw new Error("Unsupported regex flags");
        clauses.push(`${fieldExpression(field).sql} ${condition.ignoreCase ? "~*" : "~"} ${bind(condition.source)}`);
      } else if (condition && typeof condition === "object" && !(condition instanceof Date) && !Array.isArray(condition) && Object.keys(condition).some((key) => key.startsWith("$"))) {
        for (const [operator,value] of Object.entries(condition)) {
          if (operator === "$options") {
            if (!("$regex" in condition)) throw new Error("Regex options require a regex predicate");
            continue;
          }
          if (operator === "$exists") clauses.push(value ? fieldExpression(field).exists : `NOT (${fieldExpression(field).exists})`);
          else if (["$in","$nin"].includes(operator)) {
            if (!Array.isArray(value)) throw new Error(`${operator} must be an array`);
            if (!value.length) clauses.push(operator === "$in" ? "FALSE" : "TRUE");
            else clauses.push(`(${value.map((item) => comparison(field, operator === "$in" ? "=" : "<>", item)).join(operator === "$in" ? " OR " : " AND ")})`);
          } else if (operator === "$regex") {
            const options = String(condition.$options || (value instanceof RegExp ? value.flags : ""));
            if (/[^iu]/.test(options)) throw new Error("Unsupported regex flags");
            clauses.push(`${fieldExpression(field).sql} ${options.includes("i") ? "~*" : "~"} ${bind(value instanceof RegExp ? value.source : String(value))}`);
          } else if (operator === "$not") clauses.push(`NOT COALESCE((${walk({ [field]: value })}),FALSE)`);
          else {
            const ops: Record<string,string> = { $eq:"=",$ne:"<>",$gt:">",$gte:">=",$lt:"<",$lte:"<=" };
            if (!ops[operator]) throw new Error(`Unsupported catalog operator: ${operator}`);
            clauses.push(comparison(field,ops[operator],value));
          }
        }
      } else clauses.push(comparison(field,"=",condition));
    }
    return clauses.join(" AND ") || "TRUE";
  };
  return { sql: walk(filter), values };
}

export class PostgresCatalogStore {
  constructor(private readonly pool: pg.Pool = getPostgresPool()) {}
  private queryField(field: string, values: any[]): string {
    if (fields[field]) return `s.${fields[field][0]}`;
    const parts = pathParts(field), mapped = fields[parts[0]];
    values.push(mapped?.[1] === "jsonb" ? parts.slice(1) : parts);
    const root = mapped?.[1] === "jsonb" ? `s.${mapped[0]}` : "s.source";
    return `(${root} #>> $${values.length}::text[])`;
  }
  async find(filter: CatalogFilter = {}, options: { limit?: number; offset?: number; sort?: Record<string,number>; fields?: string[] } = {}): Promise<CatalogDocument[]> {
    const { sql,values } = compileCatalogFilter(filter);
    const sort = Object.entries(options.sort || { _id: 1 }).map(([key,direction]) => {
      return `${this.queryField(key,values)} ${direction < 0 ? "DESC" : "ASC"} NULLS LAST`;
    }).join(",");
    let suffix = "";
    if (options.limit !== undefined) { values.push(Math.max(0,Math.min(100_000,Math.trunc(options.limit)))); suffix += ` LIMIT $${values.length}`; }
    if (options.offset) { values.push(Math.max(0,Math.trunc(options.offset))); suffix += ` OFFSET $${values.length}`; }
    const result = await this.pool.query(`SELECT s.* FROM stations s WHERE ${sql} ORDER BY ${sort}${suffix}`,values);
    return result.rows.map((row) => {
      const doc = catalogShape(row);
      if (!options.fields) return doc;
      const selected: CatalogDocument = { _id: doc._id };
      for (const field of options.fields) {
        const parts = pathParts(field);
        let from = doc, to = selected;
        for (const part of parts.slice(0,-1)) { from = from?.[part]; to = to[part] ||= {}; }
        if (from?.[parts.at(-1)!] !== undefined) to[parts.at(-1)!] = from[parts.at(-1)!];
      }
      return selected;
    });
  }
  async findById(id: string): Promise<CatalogDocument | null> { return (await this.find({ _id: id }, { limit: 1 }))[0] || null; }
  async findOne(filter: CatalogFilter, options: { sort?: Record<string,number>; fields?: string[] } = {}): Promise<CatalogDocument | null> {
    return (await this.find(filter, { ...options, limit: 1 }))[0] || null;
  }
  async groupCount(field: string, filter: CatalogFilter = {}): Promise<Array<{ _id: string | null; count: number }>> {
    const { sql,values } = compileCatalogFilter(filter);
    const expression = this.queryField(field,values);
    return (await this.pool.query(`SELECT ${expression} AS _id,count(*)::integer AS count FROM stations s WHERE ${sql} GROUP BY ${expression}`, values)).rows;
  }
  async *iterate(filter: CatalogFilter = {}, options: { batchSize?: number; limit?: number; fields?: string[] } = {}): AsyncGenerator<CatalogDocument> {
    let lastId: string | undefined;
    let emitted = 0;
    const batchSize = Math.max(1, Math.min(options.batchSize || 200, 5000));
    while (options.limit === undefined || emitted < options.limit) {
      const batch = await this.find(lastId ? { $and: [filter, { _id: { $gt: lastId } }] } : filter, {
        fields: options.fields, sort: { _id: 1 }, limit: Math.min(batchSize, options.limit === undefined ? batchSize : options.limit - emitted),
      });
      if (!batch.length) return;
      for (const row of batch) { lastId = row._id; emitted++; yield row; }
    }
  }
  async *descriptionFillCandidates(phase: 'empty' | 'partial', languages: readonly string[]): AsyncGenerator<CatalogDocument> {
    let lastId = '';
    const descriptions = "(CASE WHEN jsonb_typeof(s.descriptions)='object' THEN s.descriptions ELSE '{}'::jsonb END)";
    const predicate = phase === 'empty' ? `${descriptions}='{}'::jsonb` :
      `${descriptions}<>'{}'::jsonb AND EXISTS(SELECT 1 FROM unnest($2::text[]) AS lang
        WHERE jsonb_typeof(${descriptions} #> ARRAY[lang,'full']) IS DISTINCT FROM 'string'
          OR char_length(COALESCE(${descriptions} #>> ARRAY[lang,'full'],'')) <= 20)`;
    while (true) {
      const result = await this.pool.query(`SELECT s.* FROM stations s WHERE s.id>$1 AND no_index=false
        AND source->>'aiDescriptionSkipped' IS DISTINCT FROM 'true' AND ${predicate} ORDER BY s.id LIMIT 200`,
        phase === 'empty' ? [lastId] : [lastId,languages]);
      if (!result.rows.length) return;
      for (const row of result.rows) { lastId = row.id; yield catalogShape(row); }
    }
  }
  async claimLogo(id: string, operationId: string, folder: string, expectedFavicon?: string | null): Promise<{ favicon: string | null } | null> {
    // Queued URL processing must claim the URL it actually intends to download,
    // not a newer favicon fetched after the queued work was created. Buffer
    // uploads deliberately bind to a fresh before-image when none is supplied.
    const current = expectedFavicon === undefined ? await this.findById(id) : null;
    if (expectedFavicon === undefined && !current) return null;
    const favicon = expectedFavicon === undefined ? current!.favicon : expectedFavicon;
    const claim = await this.update({ _id: id, favicon, $or: [
      { "logoAssets.status": { $ne: "processing" } },
      { "logoAssets.lastAttempt": { $lt: new Date(Date.now() - 60 * 60 * 1000) } },
      { "logoAssets.lastAttempt": { $exists: false } },
    ] }, { $set: { "logoAssets.status": "processing", "logoAssets.folder": folder,
      "logoAssets.lastAttempt": new Date(), "logoAssets.operationId": operationId } });
    return claim.matchedCount ? { favicon } : null;
  }
  async count(filter: CatalogFilter = {}): Promise<number> {
    const { sql,values } = compileCatalogFilter(filter);
    return Number((await this.pool.query(`SELECT count(*) AS count FROM stations s WHERE ${sql}`,values)).rows[0].count);
  }
  async insertMany(documents: CatalogDocument[], options: { syncRunId?: string } = {}): Promise<CatalogDocument[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await fenceProviderWrite(client, options.syncRunId);
      const saved: CatalogDocument[] = [];
      if (options.syncRunId) {
        // A sync's initial blacklist snapshot is only an optimization. Serialize
        // this short insert transaction with live blacklist changes as well.
        // Station-table lock comes first, matching snapshot/restore lock order.
        await client.query('LOCK TABLE stations IN ROW EXCLUSIVE MODE');
        await client.query('LOCK TABLE station_blacklist IN SHARE MODE');
      }
      // Acquire both uniqueness locks in one stable order, including UUIDs.
      // Overlapping batches must never deadlock by claiming keys in input order.
      const keys = [...new Set(documents.flatMap((doc) => [
        `uuid:${doc.stationuuid}`, `content:${JSON.stringify([doc.name,doc.url,doc.countryCode || ""])}`,
      ]))].sort();
      for (const key of keys) await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [key]);
      for (const input of documents) {
        // Dedup races across sync replicas are prevented by the sync leader
        // lock; the content-key lock also covers direct native insert callers.
        const doc: CatalogDocument = { ...input, _id: input._id || crypto.randomBytes(12).toString("hex") };
        if (options.syncRunId && (await client.query('SELECT 1 FROM station_blacklist WHERE station_uuid=$1 OR url=$2 LIMIT 1',[doc.stationuuid,doc.url])).rowCount) continue;
        const duplicate = await client.query("SELECT id FROM stations WHERE station_uuid=$1 OR (name=$2 AND url=$3 AND COALESCE(country_code,'')=$4) LIMIT 1", [doc.stationuuid,doc.name,doc.url,doc.countryCode || ""]);
        if (duplicate.rowCount) continue;
        saved.push(await this.persist(client,doc,true));
      }
      await client.query("COMMIT");
      return saved;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async update(filter: CatalogFilter, update: CatalogDocument, options: { many?: boolean; respectManualFields?: boolean; protectLocalCounters?: boolean; fillMissingFaviconOnly?: boolean; returnDocument?: boolean; syncRunId?: string } = {}): Promise<{ matchedCount: number; modifiedCount: number; document?: CatalogDocument }> {
    if (Object.keys(update).some((key) => key.startsWith("$") && !["$set","$unset","$inc"].includes(key))) throw new Error("Unsupported catalog mutation operator");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await fenceProviderWrite(client, options.syncRunId);
      const bulk = options.many && !options.returnDocument && !options.respectManualFields &&
        !options.protectLocalCounters && !options.fillMissingFaviconOnly ? nativeBulkMutations(update) : null;
      if (bulk) {
        const result=await this.updateNativeBulk(client,filter,bulk);
        await client.query('COMMIT');
        return result;
      }
      const { sql,values } = compileCatalogFilter(filter);
      const rows = await client.query(`SELECT s.* FROM stations s WHERE ${sql} ORDER BY s.id ${options.many ? "" : "LIMIT 1"} FOR UPDATE`, values);
      let document: CatalogDocument | undefined;
      let modifiedCount = 0;
      for (const row of rows.rows) {
        const current = catalogShape(row);
        const patch = update.$set || update;
        const next = structuredClone(current);
        const setPath = (field: string, value: any, remove = false) => {
          const parts = pathParts(field);
          if (["_id","createdAt"].includes(parts[0])) throw new Error(`Immutable catalog field: ${field}`);
          if (options.respectManualFields && current.manualEditFields?.[parts[0]]) return;
          if (options.fillMissingFaviconOnly && parts[0] === 'favicon' && (
            current.hasLogo === true || current.faviconLocal ||
            (current.logoAssets && Object.keys(current.logoAssets).length > 0) ||
            (typeof current.favicon === 'string' && current.favicon.trim().length > 0)
          )) return;
          if (options.protectLocalCounters && ["votes","clickCount","averageRating","totalRatings"].includes(parts[0])) {
            if (["votes","clickCount"].includes(parts[0])) next[parts[0] === "votes" ? "providerVotes" : "providerClickCount"] = value;
            return;
          }
          let cursor = next;
          for (const part of parts.slice(0,-1)) { if (!cursor[part] || typeof cursor[part] !== "object") cursor[part] = {}; cursor = cursor[part]; }
          if (remove) delete cursor[parts.at(-1)!]; else cursor[parts.at(-1)!] = value;
        };
        for (const [field,value] of Object.entries(patch)) if (!field.startsWith("$")) setPath(field,value);
        for (const field of Object.keys(update.$unset || {})) setPath(field,undefined,true);
        for (const [field,value] of Object.entries(update.$inc || {})) {
          const existing = pathParts(field).reduce((value,key) => value?.[key],next);
          if (!Number.isFinite(Number(value))) throw new Error("Invalid catalog increment");
          setPath(field,Number(existing || 0)+Number(value));
        }
        if (isDeepStrictEqual(current,next)) {
          if (options.returnDocument) document=current;
          continue;
        }
        const saved = await this.persist(client,next,false,current);
        modifiedCount++;
        if (options.returnDocument) document = saved;
      }
      await client.query("COMMIT");
      return { matchedCount: rows.rowCount || 0, modifiedCount, ...(options.returnDocument ? { document } : {}) };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  private async updateNativeBulk(client:pg.PoolClient,filter:CatalogFilter,mutations:BulkMutation[]):Promise<{matchedCount:number;modifiedCount:number}> {
    const {sql,values}=compileCatalogFilter(filter);
    const bind=(value:any)=>{values.push(value);return `$${values.length}`;};
    const selected=new Set(['s.id','s.source']);
    const assignments:string[]=[],changed:string[]=[],removed:string[]=[];
    const sourcePatch:CatalogDocument={};
    for(const mutation of mutations) {
      const mapping=fields[mutation.field];
      if(mapping)selected.add(`s.${mapping[0]}`);
      const key=!mapping || mutation.remove ? bind(mutation.field) : '';
      if(mutation.remove) {
        removed.push(mutation.field);
        changed.push(`m.source ? ${key}::text`);
        if(mapping){assignments.push(`${mapping[0]}=NULL`);changed.push(`m.${mapping[0]} IS NOT NULL`);}
      } else {
        sourcePatch[mutation.field]=mutation.value;
        if(mapping) {
          const value=bind(mutation.value);
          assignments.push(`${mapping[0]}=${value}::${mapping[1]}`);
          changed.push(`m.${mapping[0]} IS DISTINCT FROM ${value}::${mapping[1]}`);
        } else changed.push(`m.source->${key}::text IS DISTINCT FROM ${bind(JSON.stringify(mutation.value))}::jsonb`);
      }
    }
    sourcePatch.updatedAt=new Date().toISOString();
    assignments.push(`source=(m.source-${bind(removed)}::text[])||${bind(JSON.stringify(sourcePatch))}::jsonb`,'updated_at=now()');
    // Materialize only matching IDs/source/changed columns inside PostgreSQL.
    // Ordered row locks preserve CAS rechecks and atomic rollback, while the
    // application receives two counts instead of every station's descriptions.
    const result=await client.query(`WITH matched AS MATERIALIZED (
      SELECT ${[...selected].join(',')} FROM stations s WHERE ${sql} ORDER BY s.id FOR UPDATE
    ), changed AS (
      UPDATE stations s SET ${assignments.join(',')} FROM matched m
      WHERE s.id=m.id AND (${changed.join(' OR ')}) RETURNING s.id
    ) SELECT (SELECT count(*)::int FROM matched) AS matched,(SELECT count(*)::int FROM changed) AS modified`,values);
    return {matchedCount:result.rows[0].matched,modifiedCount:result.rows[0].modified};
  }
  async updateProviderBatch(updates: Array<{ uuid: string; patch: CatalogDocument }>, syncRunId?: string): Promise<{ modifiedCount: number }> {
    let count = 0;
    for (const entry of updates) count += (await this.update({ stationuuid: entry.uuid }, { $set: entry.patch }, { respectManualFields: true, protectLocalCounters: true, fillMissingFaviconOnly: true, syncRunId })).modifiedCount;
    return { modifiedCount: count };
  }
  async patchById(id: string, patch: CatalogDocument): Promise<CatalogDocument | null> {
    return (await this.update({ _id: id },patch,{ returnDocument: true })).document || null;
  }
  async redirectDuplicates(primaryId: string, canonicalSlug: string, losers: Array<{ id:string; slug:string }>): Promise<number> {
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      const rows=await client.query('SELECT * FROM stations WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE',[[primaryId,...losers.map(row=>row.id)]]);
      const docs=rows.rows.map(catalogShape),primary=docs.find(row=>row._id===primaryId);
      if (!primary || primary.slug!==canonicalSlug) throw new Error('Canonical station changed; detect duplicates again');
      const expected=new Map(losers.map(row=>[row.id,row.slug]));
      const selected=docs.filter(row=>row._id!==primaryId);
      if(selected.some(row=>row.slug!==expected.get(row._id))) throw new Error('Duplicate slug changed; detect duplicates again');
      const aliases=[...new Set([...(primary.slugAliases || []),...selected.map(row=>row.slug)].filter(slug=>typeof slug==='string' && slug && slug!==canonicalSlug))];
      if(!isDeepStrictEqual(primary.slugAliases,aliases)) await this.persist(client,{...primary,slugAliases:aliases},false,primary);
      let redirected=0;
      for(const doc of selected) {
        if(doc.redirectToSlug===canonicalSlug && doc.noIndex===true) continue;
        await this.persist(client,{...doc,redirectToSlug:canonicalSlug,noIndex:true},false,doc);redirected++;
      }
      await client.query('COMMIT');return redirected;
    } catch(error) { await client.query('ROLLBACK');throw error; } finally { client.release(); }
  }
  /** Administrative replacement preserves IDs and their relational dependants. */
  async importSnapshot(inputs: CatalogDocument[], replace = false): Promise<{ imported: number; removed: number }> {
    const normalized = inputs.map(normalizeCatalogImport);
    const seen = new Set<string>();
    for (const doc of normalized) {
      if (seen.has(doc.stationuuid)) throw new Error(`Duplicate station UUID in import: ${doc.stationuuid}`);
      seen.add(doc.stationuuid);
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // An admin snapshot must not race a provider write or another snapshot.
      await client.query('LOCK TABLE stations IN EXCLUSIVE MODE');
      const keep: string[] = [];
      for (const input of normalized) {
        const result = await client.query('SELECT * FROM stations WHERE station_uuid=$1', [input.stationuuid]);
        const current = result.rows[0] ? catalogShape(result.rows[0]) : undefined;
        const doc = { ...current,...input,_id: current?._id || input._id || crypto.randomBytes(12).toString('hex') };
        await this.persist(client,doc,!current,current);
        keep.push(doc._id);
      }
      const removed = replace ? (await client.query('DELETE FROM stations WHERE NOT(id=ANY($1::text[]))',[keep])).rowCount || 0 : 0;
      await client.query('COMMIT');
      return { imported: normalized.length,removed };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  /** Blacklist and delete are atomic: a failed audit write never deletes data. */
  async remove(filter: CatalogFilter, audit?: { reason: string; deletedBy?: string }): Promise<{ deletedCount: number; documents: CatalogDocument[] }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { sql,values } = compileCatalogFilter(filter);
      const rows = await client.query(`SELECT s.* FROM stations s WHERE ${sql} ORDER BY id FOR UPDATE`,values);
      const documents = rows.rows.map(catalogShape);
      if (audit) for (const doc of documents) await blacklistInTransaction(client, { ...doc,stationUuid: doc.stationuuid,...audit });
      const deleted = await client.query('DELETE FROM stations WHERE id=ANY($1::text[])',[documents.map(doc=>doc._id)]);
      await client.query('COMMIT');
      return { deletedCount: deleted.rowCount || 0,documents };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async restoreBlacklisted(id: string, fresh?: CatalogDocument): Promise<CatalogDocument | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('LOCK TABLE stations IN EXCLUSIVE MODE');
      const result = await client.query('SELECT * FROM station_blacklist WHERE id=$1 FOR UPDATE',[id]);
      if (!result.rowCount) { await client.query('ROLLBACK'); return null; }
      const bl = result.rows[0];
      if ((await client.query('SELECT 1 FROM stations WHERE station_uuid=$1 OR url=$2 LIMIT 1',[bl.station_uuid,bl.url])).rowCount) throw new Error('Station already exists in database');
      const restoredInput = { ...bl.source,...fresh,stationuuid: bl.station_uuid || fresh?.stationuuid || crypto.randomUUID(),name: fresh?.name || bl.name,url: fresh?.url || bl.url };
      // Fresh provider aliases take priority over the canonical cached snapshot.
      for (const [alias,key] of Object.entries(providerAliases)) if (fresh?.[alias] !== undefined && fresh?.[key] === undefined) delete restoredInput[key];
      const doc = normalizeCatalogImport(restoredInput);
      const restored = await this.persist(client,{ ...doc,_id: crypto.randomBytes(12).toString('hex') },true);
      await client.query('DELETE FROM station_blacklist WHERE id=$1',[id]);
      await client.query('COMMIT');
      return restored;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  /** Recompute totals under row locks; concurrent merges cannot double-count. */
  async mergeDuplicates(ids: string[], options: { primaryId?:string; validateGroup?:boolean; patch?:CatalogDocument } = {}): Promise<{ deletedCount: number; primary: CatalogDocument | null; duplicates: CatalogDocument[] }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const rows = await client.query('SELECT * FROM stations WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE',[ids]);
      const docs = rows.rows.map(catalogShape).sort((a,b)=>(b.votes || 0)-(a.votes || 0) || a._id.localeCompare(b._id));
      const primary = options.primaryId ? docs.find(doc=>doc._id===options.primaryId) : docs[0];
      if (options.primaryId && !primary) throw Object.assign(new Error('Primary station not found'),{ code:'PRIMARY_NOT_FOUND' });
      if (docs.length < 2) { await client.query('COMMIT'); return { deletedCount: 0,primary: primary || null,duplicates: [] }; }
      // Revalidate the detected group: an admin may have edited it since scanning.
      if (options.validateGroup !== false && docs.some(doc=>doc.name.trim().toLowerCase()!==primary!.name.trim().toLowerCase() || (doc.country || '')!==(primary!.country || ''))) throw new Error('Duplicate group changed; detect duplicates again');
      if (!primary) throw new Error('Primary station not found');
      const duplicates = docs.filter(doc=>doc._id!==primary._id), loserIds = duplicates.map(doc=>doc._id);
      for (const field of ['name','url','homepage','favicon','country','language','genre']) {
        const value = options.patch?.[field];
        if (typeof value==='string' && value.trim()) { primary[field] = value.trim();primary.manualEditFields = { ...primary.manualEditFields,[field]:true }; }
      }
      primary.slugAliases = [...new Set([...(primary.slugAliases || []),...duplicates.flatMap(doc=>[doc.slug,...(doc.slugAliases || [])])].filter(value=>typeof value==='string' && value && value!==primary.slug))];
      const changeTimes = docs.map(doc=>new Date(doc.lastChangeTime).getTime()).filter(Number.isFinite);
      if (changeTimes.length) primary.lastChangeTime = new Date(Math.min(...changeTimes));
      for (const doc of duplicates) await blacklistInTransaction(client,{ ...doc,stationUuid: doc.stationuuid,reason: 'Auto-merge-all duplicate removal',deletedBy: 'admin' });
      await client.query(`INSERT INTO user_favorites(user_id,station_id,created_at)
        SELECT user_id,$1,min(created_at) FROM user_favorites WHERE station_id=ANY($2::text[]) GROUP BY user_id
        ON CONFLICT(user_id,station_id) DO UPDATE SET created_at=least(user_favorites.created_at,excluded.created_at)`,[primary._id,loserIds]);
      // Preserve ratings unless that principal already rated the survivor.
      const ratings = await client.query('SELECT id,user_id,session_id FROM station_ratings WHERE station_id=ANY($1::text[]) ORDER BY updated_at DESC,id FOR UPDATE',[loserIds]);
      for (const rating of ratings.rows) {
        const conflict = await client.query('SELECT 1 FROM station_ratings WHERE station_id=$1 AND (($2::text IS NOT NULL AND user_id=$2) OR ($3::text IS NOT NULL AND session_id=$3)) LIMIT 1',[primary._id,rating.user_id,rating.session_id]);
        if (!conflict.rowCount) await client.query('UPDATE station_ratings SET station_id=$1 WHERE id=$2',[primary._id,rating.id]);
      }
      await client.query('UPDATE listening_history SET station_id=$1,station_name=$3 WHERE station_id=ANY($2::text[])',[primary._id,loserIds,primary.name]);
      primary.votes = docs.reduce((sum,doc)=>sum+(doc.votes || 0),0);
      primary.clickCount = docs.reduce((sum,doc)=>sum+(doc.clickCount || 0),0);
      const ratingsSummary = (await client.query('SELECT count(*)::integer AS total,COALESCE(avg(rating),0)::real AS average FROM station_ratings WHERE station_id=$1',[primary._id])).rows[0];
      primary.totalRatings = ratingsSummary.total; primary.averageRating = ratingsSummary.average;
      const saved = await this.persist(client,primary,false,primary);
      const deleted = await client.query('DELETE FROM stations WHERE id=ANY($1::text[])',[loserIds]);
      await client.query('COMMIT');
      return { deletedCount: deleted.rowCount || 0,primary: saved,duplicates };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  private async persist(client: pg.PoolClient, input: CatalogDocument, insert: boolean, previous?:CatalogDocument): Promise<CatalogDocument> {
    const now = new Date();
    const doc: CatalogDocument = { slugAliases: [],hls: false,votes: 0,clickCount: 0,clickTrend: 0,averageRating: 0,totalRatings: 0,
      lastCheckOk: true,hasLogo: false,descriptions: {},manualEditFields: {},isFeatured: false,
      showInGlobalPopular: false,noIndex: false,createdAt: now,...input,updatedAt: now };
    if (!doc.stationuuid || !doc.name || !doc.url) throw new Error("Station UUID, name and URL are required");
    if (Array.isArray(doc.tags)) doc.tags = doc.tags.join(",");
    const entries = Object.entries(fields);
    const values = entries.map(([field,[,type]]) => type === "jsonb" ? (doc[field] == null ? null : JSON.stringify(doc[field])) : doc[field] ?? null);
    values.push(JSON.stringify(doc));
    const columns = [...entries.map(([, [column]]) => column),"source"];
    const query = insert
      ? `INSERT INTO stations(${columns.join(",")}) VALUES (${values.map((_,i) => `$${i+1}`).join(",")}) RETURNING *`
      : `UPDATE stations SET ${columns.slice(1).map((column,i) => `${column}=$${i+2}`).join(",")} WHERE id=$1 RETURNING *`;
    const result = await client.query(query,values);
    if (insert || !previous || String(previous.tags || '')!==String(doc.tags || '')) {
      const tagList = String(doc.tags || "").split(",");
      const genres = [...new Set(tagList.map((value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,160)).filter(Boolean))];
      await client.query("DELETE FROM station_genres WHERE station_id=$1", [doc._id]);
      if(genres.length)await client.query("INSERT INTO station_genres(station_id,genre_slug,position) SELECT $1,slug,(position-1)::integer FROM unnest($2::text[]) WITH ORDINALITY AS tags(slug,position)",[doc._id,genres]);
    }
    return catalogShape(result.rows[0]);
  }
}

let catalog: PostgresCatalogStore | undefined;
export const pgCatalog = () => catalog ||= new PostgresCatalogStore();

export function normalizeCatalogImport(input: CatalogDocument): CatalogDocument {
  const doc = { ...input };
  for (const [alias,key] of Object.entries(providerAliases)) if (doc[key] === undefined && doc[alias] !== undefined) doc[key] = doc[alias];
  for (const key of ['name','url','stationuuid']) if (typeof doc[key] !== 'string' || !doc[key].trim()) throw new Error(`Station ${key} is required`); else doc[key] = doc[key].trim();
  for (const key of ['hls','lastCheckOk']) if (typeof doc[key] === 'number') doc[key] = doc[key] === 1;
  if (Array.isArray(doc.languageCodes)) doc.languageCodes = doc.languageCodes.join(',');
  if (doc.lastCheckTime === '') doc.lastCheckTime = null;
  if (doc.hasLogo === undefined) doc.hasLogo = Boolean(doc.logoAssets?.webp256 || doc.logoAssets?.webp96 || doc.favicon);
  return doc;
}
async function blacklistInTransaction(client: pg.PoolClient, doc: CatalogDocument): Promise<CatalogDocument> {
  for (const key of [`blacklist:url:${doc.url}`, ...(doc.stationUuid ? [`blacklist:uuid:${doc.stationUuid}`] : [])].sort()) await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[key]);
  const existing = await client.query('SELECT * FROM station_blacklist WHERE url=$1 OR ($2::text IS NOT NULL AND station_uuid=$2) ORDER BY id LIMIT 1',[doc.url,doc.stationUuid || null]);
  if (existing.rows[0]) return blacklistShape(existing.rows[0]);
  const row = (await client.query(`INSERT INTO station_blacklist(id,station_uuid,url,name,reason,deleted_by,source)
    VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING *`,[crypto.randomBytes(12).toString('hex'),doc.stationUuid || null,doc.url,doc.name,doc.reason || null,doc.deletedBy || 'admin',JSON.stringify(doc)])).rows[0];
  return blacklistShape(row);
}
function blacklistShape(row: CatalogDocument): CatalogDocument {
  return { ...row.source,_id: row.id,stationUuid: row.station_uuid,url: row.url,name: row.name,reason: row.reason,deletedBy: row.deleted_by,deletedAt: row.deleted_at,createdAt: row.created_at };
}
export async function pgBlacklistAdd(doc: CatalogDocument): Promise<CatalogDocument> {
  const client = await getPostgresPool().connect();
  try { await client.query('BEGIN'); const row = await blacklistInTransaction(client,doc); await client.query('COMMIT'); return row; }
  catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
export async function pgBlacklistGet(id: string): Promise<CatalogDocument | null> {
  const row = (await getPostgresPool().query('SELECT * FROM station_blacklist WHERE id=$1',[id])).rows[0];
  return row ? blacklistShape(row) : null;
}
export async function pgBlacklistFind(url: string, uuid?: string): Promise<CatalogDocument | null> {
  const row = (await getPostgresPool().query('SELECT * FROM station_blacklist WHERE url=$1 OR ($2::text IS NOT NULL AND station_uuid=$2) ORDER BY id LIMIT 1',[url,uuid || null])).rows[0];
  return row ? blacklistShape(row) : null;
}
export async function pgBlacklistPage(search: string, limit: number, offset: number): Promise<{ rows: CatalogDocument[]; total: number }> {
  const predicate = "($1='' OR position(lower($1) in lower(name))>0 OR position(lower($1) in lower(url))>0 OR position(lower($1) in lower(COALESCE(reason,'')))>0)";
  const [rows,count] = await Promise.all([getPostgresPool().query(`SELECT * FROM station_blacklist WHERE ${predicate} ORDER BY created_at DESC,id LIMIT $2 OFFSET $3`,[search,limit,offset]),getPostgresPool().query(`SELECT count(*)::integer AS total FROM station_blacklist WHERE ${predicate}`,[search])]);
  return { rows: rows.rows.map(blacklistShape),total: count.rows[0].total };
}

export async function pgCreateSyncRun(): Promise<CatalogDocument> {
  const id = crypto.randomBytes(12).toString("hex");
  const row = (await getPostgresPool().query("INSERT INTO catalog_sync_runs(id,sync_type,status) VALUES ($1,'incremental','running') RETURNING *", [id])).rows[0];
  return { _id: id, syncType: "incremental",status: row.status,startedAt: row.started_at };
}
export async function pgSaveSyncRun(run: CatalogDocument, pool: pg.Pool = getPostgresPool()): Promise<void> {
  const counters = Object.fromEntries(Object.entries(run).filter(([key]) => key.startsWith("stations")));
  const result = await pool.query(`UPDATE catalog_sync_runs
    SET status=CASE WHEN cancel_requested THEN 'stopped' ELSE $2 END,
        counters=counters||$3::jsonb,error=$4,completed_at=$5
    WHERE id=$1 AND status='running' AND (NOT cancel_requested OR $2<>'running') RETURNING status`,
    [run._id,run.status,JSON.stringify(counters),run.error || run.errorMessage || null,run.completedAt || null]);
  if (!result.rowCount) throw syncFencedError();
  run.status = result.rows[0].status;
}
export async function pgSyncLogs(limit = 10): Promise<CatalogDocument[]> {
  const result = await getPostgresPool().query("SELECT * FROM catalog_sync_runs ORDER BY started_at DESC LIMIT $1", [Math.max(1,Math.min(limit,1000))]);
  return result.rows.map((row) => ({ ...row.counters,_id: row.id,syncType: row.sync_type,status: row.status,error: row.error,errorMessage: row.error,startedAt: row.started_at,completedAt: row.completed_at }));
}
export async function pgSyncBlacklist(): Promise<CatalogDocument[]> {
  return (await getPostgresPool().query('SELECT station_uuid AS "stationUuid",url FROM station_blacklist')).rows;
}
