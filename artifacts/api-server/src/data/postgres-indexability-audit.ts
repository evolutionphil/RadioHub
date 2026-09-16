import type pg from 'pg';
import { getPostgresPool } from '../postgres-runtime';
import { descriptionTextSql } from './station-description-sql';
import { createStationAudit, type AuditStation, type StationAuditDecision } from '../seo/station-indexability-audit';

export const INDEXABILITY_AUDIT_BATCH_SIZE = 500;
type AuditOptions = {
  qualifiedLanguages: readonly string[];
  signal?: AbortSignal;
  onStation?: (station: AuditStation, decision: StationAuditDecision) => Promise<void>;
};

/** Read-only snapshot; one 500-row page in memory, only field-presence markers
 * for descriptions. Never SELECT source or full multilingual article text. */
export async function pgAuditStationIndexability(options: AuditOptions, pool: Pick<pg.Pool, 'connect'> = getPostgresPool()) {
  const client = await pool.connect();
  const started = Date.now();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout = '15s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '20s'");
    const lock = await client.query("SELECT pg_try_advisory_xact_lock(hashtext('station-indexability-audit')) AS acquired");
    if (!lock.rows[0].acquired) throw Object.assign(new Error('An indexability audit is already running'), { code: 'AUDIT_BUSY' });
    const snapshot = await client.query('SELECT transaction_timestamp() AS at');
    const audit = createStationAudit(options.qualifiedLanguages, new Date(snapshot.rows[0].at).toISOString());
    const manifests = await client.query(`SELECT language,total_urls,generated_at FROM sitemap_manifests WHERE type='stations' AND status='active'`);
    for (const language of audit.report.languages) {
      const manifest = manifests.rows.find(row => row.language === language.language);
      if (manifest) { language.publishedUrls = manifest.total_urls; language.manifestGeneratedAt = new Date(manifest.generated_at).toISOString(); }
    }
    const full = descriptionTextSql("d.value->'full'");
    const meta = descriptionTextSql("d.value->'meta'");
    await client.query(`DECLARE station_indexability_audit NO SCROLL CURSOR FOR
      SELECT s.id AS _id,s.name,s.slug,CASE WHEN s.url IS NOT NULL AND s.url<>'' THEN 'present' ELSE '' END AS url,
        s.country_code AS "countryCode",s.language_codes AS "languageCodes",s.no_index AS "noIndex",
        s.redirect_to_slug AS "redirectToSlug",s.last_check_ok AS "lastCheckOk",
        jsonb_build_object('noIndex',s.manual_edit_fields->'noIndex') AS "manualEditFields",
        jsonb_build_object('owner',s.source->'automaticNoIndex'->'owner','version',s.source->'automaticNoIndex'->'version',
          'active',s.source->'automaticNoIndex'->'active','reason',s.source->'automaticNoIndex'->'reason') AS "automaticNoIndex",
        COALESCE((SELECT jsonb_object_agg(d.key,jsonb_build_object('full',CASE WHEN ${full} THEN 'x' ELSE '' END,
          'meta',CASE WHEN ${meta} THEN 'x' ELSE '' END))
          FROM jsonb_each(CASE WHEN jsonb_typeof(s.descriptions)='object' THEN s.descriptions ELSE '{}'::jsonb END) d
          WHERE d.key ~ '^[a-zA-Z]{2,3}$'),'{}'::jsonb) AS descriptions
      FROM stations s ORDER BY s.id`);
    while (true) {
      if (options.signal?.aborted || Date.now() - started > 60_000) throw Object.assign(new Error('Indexability audit interrupted'), { code: 'AUDIT_INTERRUPTED' });
      const batch = await client.query(`FETCH FORWARD ${INDEXABILITY_AUDIT_BATCH_SIZE} FROM station_indexability_audit`);
      if (batch.rows.length === 0) break;
      for (const station of batch.rows as AuditStation[]) {
        const decision = audit.consume(station);
        if (options.onStation) await options.onStation(station, decision);
      }
    }
    await client.query('COMMIT');
    return audit.report;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}
