import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getPostgresPool } from '../postgres-runtime';
import { descriptionTextSql } from './station-description-sql';
import { AUDIT_LANGUAGES } from '../seo/station-indexability-audit';
import { assessLegacyNoindexRecovery, createRecoveryIdentityIndex, RECOVERY_CANDIDATE_LIMIT,
  type RecoveryCandidate, type RecoveryStation } from '../seo/legacy-noindex-recovery';

const SNAPSHOT_TTL_MS = 10 * 60 * 1000;
const MAX_SNAPSHOTS = 8;
const BATCH_SIZE = 500;
export const RECOVERY_APPLY_DEADLINE_MS = 5000;
export const RECOVERY_PREVIEW_DEADLINE_MS = 60_000;
const identityProjection = `s.id,s.name,s.slug,s.slug_aliases AS "slugAliases",s.country,s.country_code AS "countryCode",s.url,s.url_resolved AS "urlResolved",s.station_uuid AS stationuuid`;
const stationProjection = `${identityProjection},s.no_index AS "noIndex",
  s.redirect_to_slug AS "redirectToSlug",s.manual_edit_fields AS "manualEditFields",
  s.source->'automaticNoIndex' AS "automaticNoIndex",s.last_check_ok AS "lastCheckOk",
  s.last_check_time AS "lastCheckTime",s.source->'lastCheckOkTime' AS "lastCheckOkTime",s.xmin::text AS "rowVersion",
  (jsonb_typeof(s.source)='object') AS "sourceIsObject",
  (s.no_index_recovery_journal IS NULL OR jsonb_typeof(s.no_index_recovery_journal)='object') AS "journalIsObject",
  (SELECT count(*)::integer FROM jsonb_each(CASE WHEN jsonb_typeof(s.descriptions)='object' THEN s.descriptions ELSE '{}'::jsonb END) d
    WHERE d.key IN (${AUDIT_LANGUAGES.map(language => `'${language}'`).join(',')})
      AND ${descriptionTextSql("d.value->'full'")} AND ${descriptionTextSql("d.value->'meta'")}) AS "completeLanguageCount"`;

const failure = (code: string, message: string) => Object.assign(new Error(message), { code });
const fingerprint = (station: RecoveryStation) => createHash('sha256').update(JSON.stringify(station)).digest('hex');
type RecoveryPool = Pick<pg.Pool, 'connect'>;
type RecoveryQuery = (sql: string, parameters?: any[]) => Promise<pg.QueryResult>;
type Snapshot = { expiresAt: number; fingerprints: Map<string, string> };
export interface RecoveryPreview {
  previewId: string; createdAt: string; expiresAt: string; totalScanned: number; totalNoIndex: number;
  totalCandidates: number; candidateLimit: number; reasonCounts: Record<string, number>; candidates: RecoveryCandidate[];
}

/** Both paths are bounded and have checked-out-client error listeners. Apply
 * has a hard five-second connection deadline, including rollback on timeout;
 * it never holds the catalog writer lock through an HTTP response. */
async function withTransaction<T>(pool: RecoveryPool, write: boolean, signal: AbortSignal | undefined,
  work: (query: RecoveryQuery, now: number) => Promise<T>): Promise<T> {
  signal?.throwIfAborted();
  const client = await pool.connect();
  let released = false, connectionLost = false, interrupted: Error | undefined;
  const release = (discard: boolean) => { if (!released) { released = true; client.release(discard); } };
  const abort = () => {
    interrupted ||= failure('RECOVERY_INTERRUPTED', 'Recovery operation interrupted');
    // Destroying a checked-out client terminates any active query and rolls
    // back its transaction, bounding the writer lock independently of SQL.
    release(true);
  };
  const lost = () => { connectionLost = true; interrupted ||= failure('RECOVERY_UNAVAILABLE', 'Recovery connection lost'); };
  client.on('error', lost); client.on('end', lost);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const duration = write ? RECOVERY_APPLY_DEADLINE_MS : RECOVERY_PREVIEW_DEADLINE_MS;
  const expiresAt = Date.now() + duration;
  const deadline = setTimeout(abort, duration); deadline.unref();
  const query: RecoveryQuery = async (sql, parameters) => {
    if (interrupted) throw interrupted;
    if (Date.now() >= expiresAt) { abort(); throw interrupted; }
    // pg supports per-query deadlines at runtime; its QueryConfig typings
    // omit query_timeout, so retain it in a structurally compatible variable.
    const config = { text: sql, values: parameters, query_timeout: Math.max(1, expiresAt - Date.now()) };
    const result = await client.query(config);
    if (interrupted) throw interrupted;
    return result;
  };
  try {
    await query(write ? 'BEGIN' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await query(`SET LOCAL statement_timeout = '${write ? '4s' : '15s'}'`);
    await query(`SET LOCAL idle_in_transaction_session_timeout = '${write ? '3s' : '20s'}'`);
    if (write) {
      // Advisory locks alone cannot fence provider/manual writers that do not
      // participate. This conflicts with every catalog INSERT/UPDATE/DELETE
      // while allowing ordinary SELECTs, and fails immediately if writers run.
      await query('LOCK TABLE stations IN SHARE ROW EXCLUSIVE MODE NOWAIT');
    }
    const lock = await query("SELECT pg_try_advisory_xact_lock(hashtext('station-legacy-noindex-recovery')) AS acquired");
    if (!lock.rows[0]?.acquired) throw failure('RECOVERY_BUSY', 'Another recovery operation is running');
    const timestamp = await query('SELECT transaction_timestamp() AS at');
    const result = await work(query, new Date(timestamp.rows[0].at).getTime());
    await query('COMMIT');
    return result;
  } catch (error: any) {
    if (!released && !connectionLost) {
      try { const rollback = { text: 'ROLLBACK', query_timeout: 500 }; await client.query(rollback); }
      catch { release(true); }
    }
    if (error?.code === '55P03') throw failure('RECOVERY_BUSY', 'Catalog is being updated; retry preview');
    throw interrupted || error;
  } finally {
    clearTimeout(deadline);
    signal?.removeEventListener('abort', abort);
    try { release(connectionLost || Boolean(interrupted)); }
    finally {
      // A destroyed socket can emit a final asynchronous error after release.
      // Its listener remains attached only to that discarded client.
      if (!connectionLost && !interrupted) client.removeListener('error', lost);
      client.removeListener('end', lost);
    }
  }
}

async function readIdentityIndex(query: RecoveryQuery, singleQuery = false) {
  const index = createRecoveryIdentityIndex();
  if (singleQuery) {
    // Avoid 100+ cursor round trips while the short writer lock is held.
    // This contains only identity fields, never article text or source JSON.
    const rows = await query(`SELECT ${identityProjection} FROM stations s`);
    for (const station of rows.rows) index.add(station);
    return index;
  }
  await query(`DECLARE noindex_recovery_identity NO SCROLL CURSOR FOR SELECT ${identityProjection} FROM stations s ORDER BY s.id`);
  while (true) {
    const batch = await query(`FETCH FORWARD ${BATCH_SIZE} FROM noindex_recovery_identity`);
    if (!batch.rows.length) break;
    for (const station of batch.rows) index.add(station);
  }
  await query('CLOSE noindex_recovery_identity');
  return index;
}

export class LegacyNoindexRecoveryStore {
  private readonly snapshots = new Map<string, Snapshot>();
  constructor(private readonly pool: () => RecoveryPool = getPostgresPool,
    private readonly invalidate: (slugs: string[]) => Promise<boolean> = invalidateRecoveryCaches) {}

  async preview(options: { signal?: AbortSignal } = {}): Promise<RecoveryPreview> {
    const snapshot: Snapshot = { expiresAt: Date.now() + SNAPSHOT_TTL_MS, fingerprints: new Map() };
    const report = await withTransaction(this.pool(), false, options.signal, async (query, now) => {
      // The full catalog identity scan includes indexed rows and redirects;
      // limiting it to noindex rows would miss real duplicate peers.
      const index = await readIdentityIndex(query);
      const result: RecoveryPreview = { previewId: randomUUID(), createdAt: new Date(now).toISOString(),
        expiresAt: '', totalScanned: index.total, totalNoIndex: 0, totalCandidates: 0,
        candidateLimit: RECOVERY_CANDIDATE_LIMIT, reasonCounts: {}, candidates: [] };
      await query(`DECLARE noindex_recovery_candidates NO SCROLL CURSOR FOR SELECT ${stationProjection}
        FROM stations s WHERE s.no_index=true ORDER BY s.id`);
      while (true) {
        const batch = await query(`FETCH FORWARD ${BATCH_SIZE} FROM noindex_recovery_candidates`);
        if (!batch.rows.length) break;
        for (const station of batch.rows as RecoveryStation[]) {
          result.totalNoIndex++;
          const decision = assessLegacyNoindexRecovery(station, index, now);
          result.reasonCounts[decision.reason] = (result.reasonCounts[decision.reason] || 0) + 1;
          if (!decision.candidate) continue;
          result.totalCandidates++;
          if (result.candidates.length < RECOVERY_CANDIDATE_LIMIT) {
            result.candidates.push(decision.candidate);
            snapshot.fingerprints.set(station.id, fingerprint(station));
          }
        }
      }
      return result;
    });
    const now = Date.now();
    snapshot.expiresAt = now + SNAPSHOT_TTL_MS;
    report.expiresAt = new Date(snapshot.expiresAt).toISOString();
    for (const [id, value] of this.snapshots) if (value.expiresAt <= now) this.snapshots.delete(id);
    while (this.snapshots.size >= MAX_SNAPSHOTS) this.snapshots.delete(this.snapshots.keys().next().value!);
    this.snapshots.set(report.previewId, snapshot);
    return report;
  }

  async apply(input: { previewId: string; stationIds: string[]; actor?: string; signal?: AbortSignal }) {
    if (!input || typeof input.previewId !== 'string' || !Array.isArray(input.stationIds) ||
        input.stationIds.length < 1 || input.stationIds.length > RECOVERY_CANDIDATE_LIMIT ||
        input.stationIds.some(id => typeof id !== 'string' || !id || id.length > 200) ||
        new Set(input.stationIds).size !== input.stationIds.length) throw failure('RECOVERY_INVALID', 'Select between 1 and 100 distinct preview candidates');
    const snapshot = this.snapshots.get(input.previewId);
    if (!snapshot || snapshot.expiresAt <= Date.now()) throw failure('RECOVERY_STALE', 'Preview expired; run preview again');
    if (input.stationIds.some(id => !snapshot.fingerprints.has(id))) throw failure('RECOVERY_INVALID', 'Selection is not in this preview');
    // Single use prevents overlapping applies or an uncertain response from
    // reusing evidence. Every later batch needs a fresh catalog preview.
    this.snapshots.delete(input.previewId);
    let restoredSlugs: string[] = [];
    const result = await withTransaction(this.pool(), true, input.signal, async (query, now) => {
      const selected = await query(`SELECT ${stationProjection} FROM stations s WHERE s.id=ANY($1::text[]) ORDER BY s.id FOR UPDATE`, [input.stationIds]);
      if (selected.rows.length !== input.stationIds.length) throw failure('RECOVERY_STALE', 'A selected station changed; run preview again');
      const index = await readIdentityIndex(query, true);
      const candidates: RecoveryCandidate[] = [];
      for (const station of selected.rows as RecoveryStation[]) {
        const decision = assessLegacyNoindexRecovery(station, index, now);
        if (!decision.candidate || fingerprint(station) !== snapshot.fingerprints.get(station.id)) {
          throw failure('RECOVERY_STALE', 'Station evidence or identity peers changed; run preview again');
        }
        candidates.push(decision.candidate);
      }
      const result = await query(`UPDATE stations s SET no_index=false,
        source=s.source || jsonb_build_object('noIndex',false),
        no_index_recovery_journal=COALESCE(s.no_index_recovery_journal,'{}'::jsonb) || jsonb_build_object($2::text,jsonb_build_object(
            'version',1,'action','explicit-selected-legacy-noindex-recovery','recoveredAt',$3::text,'actor',$4::text,
            'before',jsonb_build_object('noIndex',s.no_index,'sourceNoIndexPresent',s.source ? 'noIndex',
              'sourceNoIndex',s.source->'noIndex','automaticNoIndex',s.source->'automaticNoIndex'),
            'after',jsonb_build_object('noIndex',false),'evidence',evidence.value)),
        updated_at=transaction_timestamp()
        FROM jsonb_array_elements($5::jsonb) evidence(value)
        WHERE s.id=ANY($1::text[]) AND s.id=evidence.value->>'id' AND s.no_index=true
        RETURNING s.id`, [input.stationIds, input.previewId, new Date(now).toISOString(),
        (input.actor || 'authenticated-admin').slice(0, 200), JSON.stringify(candidates)]);
      if (result.rows.length !== input.stationIds.length) throw failure('RECOVERY_STALE', 'Recovery selection changed; run preview again');
      restoredSlugs = candidates.map(candidate => candidate.slug);
      return { restored: result.rows.length, restoredIds: result.rows.map(row => String(row.id)), skipped: 0, skippedReasons: [] };
    });
    // The database transaction is already committed and the writer lock is
    // released. A cache failure must never masquerade as a failed recovery.
    const cacheInvalidated = await this.invalidate(restoredSlugs).catch(() => false);
    return { ...result, cacheInvalidated };
  }
}

async function invalidateRecoveryCaches(slugs: string[]): Promise<boolean> {
  const [{ performanceCache }, { default: CacheManager }] = await Promise.all([
    import('../performance-cache'), import('../cache'),
  ]);
  const results = await Promise.allSettled([
    Promise.resolve().then(() => { for (const slug of slugs) performanceCache.invalidateStationCache(slug); performanceCache.clearSeoCaches(); }),
    ...['admin_stations:', 'stations', 'popular_stations', 'community_favorites', 'genres'].map(pattern =>
      Promise.resolve().then(() => CacheManager.clearByPattern(pattern))),
    Promise.resolve().then(() => CacheManager.del('admin-station-filter-options:v1')),
  ]);
  return results.every(result => result.status === 'fulfilled');
}

const store = new LegacyNoindexRecoveryStore();
export const pgPreviewLegacyNoindexRecovery = (options: { signal?: AbortSignal } = {}) => store.preview(options);
export const pgApplyLegacyNoindexRecovery = (input: Parameters<LegacyNoindexRecoveryStore['apply']>[0]) => store.apply(input);
