import type { Express, RequestHandler } from 'express';
import { catalogShape, pgCatalog, type CatalogDocument } from '../data/postgres-catalog-store';
import { pgContentDuplicateGroups } from '../data/postgres-admin-catalog-store';
import { getPostgresPool } from '../postgres-runtime';
import { assessDuplicateGroup, DUPLICATE_POLICY_FIELDS } from '../utils/station-duplicate-policy';
import { frequencyClusterKey, getIndexableLanguagesForStation } from '../seo/junk-station-rules';
import { performanceCache } from '../performance-cache';
import CacheManager from '../cache';
import { logger } from '../utils/logger';

type Mode = 'content' | 'frequency';
type Plan = { primary: CatalogDocument; losers: CatalogDocument[]; docs: CatalogDocument[] };
const fields = [...DUPLICATE_POLICY_FIELDS, 'slug', 'slugAliases', 'noIndex', 'redirectToSlug',
  'homepage', 'tags', 'bitrate', 'lastCheckOk', 'lastCheckOkTime', 'lastCheckTime', 'votes', 'clickCount'];
const protectedFields = ['noIndex', 'slug', 'slugAliases', 'redirectToSlug', 'isListVisible', 'lastCheckOk'];

// A slug collision only proposes a group. It never proves broadcaster identity.
function planGroup(docs: CatalogDocument[], mode: Mode): { plan?: Plan; reason?: string } {
  const identity = assessDuplicateGroup(docs);
  if (!identity.eligible) return { reason: identity.reason };
  if (docs.some(doc => protectedFields.some(field => doc.manualEditFields?.[field]))) {
    return { reason: 'Manually protected indexing, slug or visibility decision' };
  }
  if (docs.some(doc => doc.redirectToSlug)) return { reason: 'Existing redirect requires reviewed duplicate merge' };
  if (mode === 'frequency') {
    const keys = new Set(docs.map(doc => frequencyClusterKey(doc.slug)));
    if (keys.has(null) || keys.size !== 1 || new Set(docs.map(doc => doc.slug)).size < 2) {
      return { reason: 'Frequency slug group changed' };
    }
  }
  const eligible = docs.filter(doc => typeof doc.slug === 'string' && doc.slug.trim() &&
    getIndexableLanguagesForStation(doc, ['en']).includes('en'));
  eligible.sort((a, b) => (Number(b.votes || 0) + Number(b.clickCount || 0)) -
    (Number(a.votes || 0) + Number(a.clickCount || 0)) ||
    Number(Boolean(b.lastCheckOk)) - Number(Boolean(a.lastCheckOk)) ||
    a.slug.length - b.slug.length || String(a._id).localeCompare(String(b._id)));
  const primary = eligible[0];
  if (!primary) return { reason: 'No eligible canonical station' };
  if (docs.filter(doc => doc.slug === primary.slug).length !== 1) {
    return { reason: 'Canonical slug is shared by multiple station rows; reviewed merge required' };
  }
  const losers = docs.filter(doc => doc._id !== primary._id && (mode === 'frequency' || doc.noIndex !== true));
  return losers.length ? { plan: { primary, losers, docs } } : { reason: 'Already deduplicated' };
}

/** Recheck identity and protected state under the locks held for every write. */
async function applyPlan(expected: Plan, mode: Mode): Promise<{ changed: number; reason?: string }> {
  const client = await getPostgresPool().connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='2s'");
    await client.query("SET LOCAL statement_timeout='10s'");
    const ids = expected.docs.map(doc => String(doc._id));
    // Slugs are indexed but not unique. Lock any destination owner outside the
    // detected group too, otherwise SSR could resolve the redirect elsewhere.
    const rows = await client.query('SELECT * FROM stations WHERE id=ANY($1::text[]) OR slug=$2 ORDER BY id FOR UPDATE', [ids, expected.primary.slug]);
    const docs = rows.rows.map(catalogShape);
    const current = planGroup(docs, mode);
    if (docs.length !== new Set(ids).size || !current.plan ||
        current.plan.primary._id !== expected.primary._id || current.plan.primary.slug !== expected.primary.slug ||
        docs.some(doc => doc.slug !== expected.docs.find(prior => prior._id === doc._id)?.slug)) {
      await client.query('ROLLBACK');
      return { changed: 0, reason: current.reason || 'Duplicate group changed; run the preview again' };
    }
    const { primary, losers } = current.plan;
    const provenance = JSON.stringify({
      owner: 'radiohub-junk-policy', version: 1, active: true,
      reason: `duplicate-of:${primary.slug}`, markedAt: new Date().toISOString(),
      decision: 'verified-admin-dedup', canonicalStationId: primary._id,
    });
    let changed = 0;
    if (mode === 'frequency') {
      const aliases = [...new Set([...(Array.isArray(primary.slugAliases) ? primary.slugAliases : []),
        ...losers.map(doc => doc.slug)].filter(slug => typeof slug === 'string' && slug && slug !== primary.slug))];
      await client.query(`UPDATE stations SET slug_aliases=$2::text[],updated_at=now(),
        source=COALESCE(source,'{}'::jsonb)||jsonb_build_object('slugAliases',$2::text[])
        WHERE id=$1`, [primary._id, aliases]);
      // SET expressions see the old no_index value: adding a verified redirect
      // must not adopt an existing exclusion or overwrite its original owner.
      changed = (await client.query(`UPDATE stations SET redirect_to_slug=$2,no_index=true,updated_at=now(),
        source=COALESCE(source,'{}'::jsonb)||jsonb_build_object('redirectToSlug',$2::text,'noIndex',true)
          || CASE WHEN no_index IS NOT TRUE THEN jsonb_build_object('automaticNoIndex',$3::jsonb) ELSE '{}'::jsonb END
        WHERE id=ANY($1::text[])`, [losers.map(doc => doc._id), primary.slug, provenance])).rowCount || 0;
    } else {
      changed = (await client.query(`UPDATE stations SET no_index=true,updated_at=now(),
        source=COALESCE(source,'{}'::jsonb)||jsonb_build_object('noIndex',true,'automaticNoIndex',$2::jsonb)
        WHERE id=ANY($1::text[]) AND no_index IS NOT TRUE`, [losers.map(doc => doc._id), provenance])).rowCount || 0;
    }
    await client.query('COMMIT');
    return { changed };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

export function registerAdminSafeDedupRoutes(app: Express, requireAdmin: RequestHandler) {
  for (const mode of ['content', 'frequency'] as const) {
    app.post(`/api/admin/stations/${mode === 'content' ? 'dedup' : 'dedup-frequency'}`, requireAdmin, async (req, res) => {
      res.set('Cache-Control', 'private, no-store');
      try {
        const confirm = String(req.query.confirm || '').toLowerCase() === 'true';
        const candidates: Array<{ docs: CatalogDocument[]; original?: any }> = [];
        if (mode === 'content') {
          for (const group of await pgContentDuplicateGroups()) {
            const ids = group.docs.map((doc: CatalogDocument) => String(doc._id));
            const docs = await pgCatalog().find({ _id: { $in: ids } }, { fields, limit: ids.length });
            if (docs.length === new Set(ids).size) candidates.push({ docs, original: group });
          }
        } else {
          const punctuated = await pgCatalog().find({ slug: { $regex: /[0-9]-[0-9]/ } }, { fields, limit: 100000 });
          const siblingSlugs = [...new Set(punctuated.map(doc => frequencyClusterKey(doc.slug)).filter((slug): slug is string => !!slug))];
          const siblings = siblingSlugs.length ? await pgCatalog().find({ slug: { $in: siblingSlugs } }, { fields, limit: 100000 }) : [];
          const groups = new Map<string, Map<string, CatalogDocument>>();
          for (const doc of [...punctuated, ...siblings]) {
            const key = frequencyClusterKey(doc.slug);
            if (!key) continue;
            const groupKey = `${key}|${String(doc.countryCode || '').toUpperCase()}`;
            const group = groups.get(groupKey) || new Map<string, CatalogDocument>();
            group.set(String(doc._id), doc);
            groups.set(groupKey, group);
          }
          for (const group of groups.values()) if (group.size > 1) candidates.push({ docs: [...group.values()] });
        }
        const accepted: Array<{ plan: Plan; original?: any }> = [];
        const skipped: Array<{ ids: string[]; reason: string }> = [];
        for (const candidate of candidates) {
          const result = planGroup(candidate.docs, mode);
          if (result.plan) {
            const owners = await pgCatalog().find({ slug: result.plan.primary.slug }, { fields: ['_id', 'slug'], limit: 2 });
            if (owners.length === 1 && owners[0]._id === result.plan.primary._id) {
              accepted.push({ plan: result.plan, original: candidate.original });
              continue;
            }
            result.reason = 'Canonical slug is also owned outside this group; reviewed merge required';
          }
          skipped.push({ ids: candidate.docs.map(doc => doc._id), reason: result.reason! });
        }
        let changed = 0;
        if (confirm) {
          try {
            for (const { plan } of accepted) {
              const applied = await applyPlan(plan, mode);
              changed += applied.changed;
              if (applied.reason) skipped.push({ ids: plan.docs.map(doc => doc._id), reason: applied.reason });
            }
          } finally {
            // Earlier groups may have committed even when a later group fails.
            // Cache availability cannot change the outcome of committed writes.
            if (changed) {
              try { performanceCache.clearSeoAndQuickCaches(); }
              catch (error) { logger.error('Dedup SEO cache refresh failed:', error); }
              const results = await Promise.allSettled(['stations', 'station:detail:'].map(pattern => CacheManager.clearByPattern(pattern)));
              for (const result of results) if (result.status === 'rejected') logger.error('Dedup cache refresh failed:', result.reason);
            }
          }
        }
        res.json({
          confirm, clustersFound: accepted.length,
          ...(mode === 'content' ? { rowsMarked: changed } : { rowsRedirected: changed }),
          skippedClusters: skipped.length, sampleSkipped: skipped.slice(0, 25),
          message: confirm
            ? `${mode === 'content' ? 'Marked' : 'Redirected'} ${changed} verified duplicate stations. Station records and references are retained; protected or changed groups are skipped.`
            : 'DRY RUN — no data changed. Only exact identities with a shared stream and an eligible, unprotected canonical are listed. Pass ?confirm=true to apply after review.',
          sampleClusters: accepted.slice(0, mode === 'content' ? 20 : 25).map(({ plan, original }) => mode === 'content'
            ? { ...original, canonical: plan.primary.slug, canonicalStationId: plan.primary._id, idsToMark: plan.losers.map(doc => doc._id) }
            : { canonical: plan.primary.slug, losers: plan.losers.map(doc => doc.slug) }),
        });
      } catch (error: any) {
        logger.error('Verified station dedup failed:', error?.message ?? error);
        res.status(500).json({ error: 'Dedup failed; no unverified group was applied' });
      }
    });
  }
}
