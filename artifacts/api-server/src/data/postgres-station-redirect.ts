import type pg from 'pg';
import { getPostgresPool } from '../postgres-runtime';
import { assessDuplicateRedirect } from '../utils/station-duplicate-policy';
import { getIndexableLanguagesForStation } from '../seo/junk-station-rules';

export interface StationRedirectChange {
  id: string;
  targetSlug: string | null;
  expectedRedirectToSlug: string | null;
}
export interface StationRedirectResult {
  stationId: string; slug: string; redirectToSlug: string | null; changed: boolean;
  cacheKeys: string[];
}
const fail = (code: string) => Object.assign(new Error(code), { code });
// Match the supported per-station description languages, not all UI locales.
const REDIRECT_TARGET_LANGUAGES = ['en', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'ar', 'zh', 'tr', 'ja', 'ko', 'hi', 'he'] as const;
const projection = `id,station_uuid AS stationuuid,name,slug,slug_aliases AS "slugAliases",url,
  no_index AS "noIndex",redirect_to_slug AS "redirectToSlug",descriptions,
  (source IS NULL OR jsonb_typeof(source)='object') AS "sourceIsObject"`;

function hasCompleteRedirectContent(descriptions: unknown): boolean {
  if (!descriptions || typeof descriptions !== 'object' || Array.isArray(descriptions)) return false;
  return REDIRECT_TARGET_LANGUAGES.every(language => {
    const entry = (descriptions as Record<string, any>)[language];
    return typeof entry?.full === 'string' && entry.full.trim().length > 0 &&
      typeof entry?.meta === 'string' && entry.meta.trim().length > 0;
  });
}

/** One reversible field change. No station deletion, merge, alias reassignment,
 * metadata rewrite or user-reference transfer is performed. */
export async function pgSetStationRedirect(change: StationRedirectChange,
  pool: Pick<pg.Pool, 'connect'> = getPostgresPool()): Promise<StationRedirectResult> {
  const client = await pool.connect();
  let connectionError = false;
  const lost = () => { connectionError = true; };
  client.on('error', lost);
  const query = (text: string, values?: any[]) => client.query({ text, values, query_timeout: 4000 } as pg.QueryConfig);
  try {
    await query('BEGIN');
    await query("SET LOCAL statement_timeout='3s'");
    await query("SET LOCAL idle_in_transaction_session_timeout='2s'");
    // Prevent phantom slug owners/incoming redirects and concurrent provider,
    // editor or maintenance writes. Fail immediately instead of queuing a
    // catalogue-wide writer lock; only two station projections are read.
    await query('LOCK TABLE stations IN SHARE ROW EXCLUSIVE MODE NOWAIT');
    const rows = await query(`SELECT ${projection} FROM stations WHERE id=$1 OR slug=$2 ORDER BY id FOR UPDATE`,
      [change.id, change.targetSlug]);
    const source = rows.rows.find(row => row.id === change.id);
    if (!source) throw fail('REDIRECT_SOURCE_MISSING');
    const current = source.redirectToSlug || null;
    if (current !== change.expectedRedirectToSlug) throw fail('REDIRECT_STALE');
    if (!source.sourceIsObject) throw fail('REDIRECT_SOURCE_INVALID');

    if (change.targetSlug !== null) {
      const owners = rows.rows.filter(row => row.slug === change.targetSlug);
      const target = owners[0];
      if (owners.length !== 1 || !target || target.id === source.id || !source.slug || source.slug === target.slug ||
          target.noIndex !== false || target.redirectToSlug) {
        throw fail('REDIRECT_TARGET_INVALID');
      }
      if (!hasCompleteRedirectContent(target.descriptions)) throw fail('REDIRECT_TARGET_CONTENT');
      if (!getIndexableLanguagesForStation(target).length) throw fail('REDIRECT_TARGET_INVALID');
      if (!assessDuplicateRedirect(source, target).eligible) throw fail('REDIRECT_NOT_DUPLICATE');
      const conflicts = await query(`SELECT 1 FROM stations
        WHERE (slug=$1 AND id<>$2) OR redirect_to_slug=$1 LIMIT 1`, [source.slug, source.id]);
      if (conflicts.rows.length) throw fail('REDIRECT_CHAIN');
    }

    const changed = current !== change.targetSlug;
    if (changed) {
      // source is an extensible metadata object: change only its mirrored
      // redirect property, retaining manual flags, noindex, health and content.
      await query(`UPDATE stations SET redirect_to_slug=$2,updated_at=now(),
        source=COALESCE(source,'{}'::jsonb)||jsonb_build_object('redirectToSlug',$2::text)
        WHERE id=$1`, [source.id, change.targetSlug]);
    }
    await query('COMMIT');
    return { stationId: source.id, slug: source.slug, redirectToSlug: change.targetSlug, changed,
      cacheKeys: [...new Set([source.id, source.stationuuid, source.slug, ...(source.slugAliases || []),
        current, change.targetSlug].filter((value): value is string => typeof value === 'string' && Boolean(value)))],
    };
  } catch (error: any) {
    if (!connectionError) {
      try { await client.query({ text: 'ROLLBACK', query_timeout: 500 } as pg.QueryConfig); }
      catch { connectionError = true; }
    }
    if (error?.code === '55P03') throw fail('REDIRECT_BUSY');
    throw error;
  } finally {
    client.release(connectionError);
    if (!connectionError) client.removeListener('error', lost);
  }
}
