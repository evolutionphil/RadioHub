import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Bounded, exact public-identity lookups. Never persist a complete station response.
const origin = 'https://themegaradio.com';
const inputName = process.argv[2] || '2026-09-25-gsc-404-live.json';
const outputName = process.argv[3] || '2026-09-25-gsc-404-identities.json';
for (const name of [inputName, outputName]) {
  if (!/^[a-z0-9-]+\.json$/i.test(name)) throw new Error('Only audit filenames are allowed');
}
if (inputName === outputName) throw new Error('Input and output must differ');
const sourceText = await readFile(new URL(inputName, import.meta.url), 'utf8');
const source = JSON.parse(sourceText);
const sourceSha256 = createHash('sha256').update(sourceText).digest('hex');
if (!Array.isArray(source.rows)) throw new Error('Missing source rows');
const selectedRows = source.rows.filter(row => row.status === 410 || row.noindex === true);
const stationRouteSegments = new Set(['station', 'mahta', 'stazione', 'estacao', 'estacion', '电台', 'ステーション', '스테이션', 'tachana', 'stantsiya', 'sender']);
const isStationRow = row => stationRouteSegments.has(decodeURIComponent(new URL(row.final).pathname.split('/').filter(Boolean)[1] || ''));
const nonStationRows = selectedRows.filter(row => !isStationRow(row)).map(({ url, final, status, noindex }) => ({ url, final, status, noindex, classification: 'outside-station-lookup-scope' }));
function slugFromUrl(value) {
  const url = new URL(value);
  if (url.origin !== origin) throw new Error('Out-of-scope source origin');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length !== 3) throw new Error(`Unexpected station path ${url.pathname}`);
  const slug = decodeURIComponent(parts[2]);
  if (!slug || slug.length > 600 || /[\x00-\x1f/\\]/.test(slug)) throw new Error('Invalid station identifier');
  return slug;
}
const scopedRows = selectedRows.filter(isStationRow).map(row => ({ url: row.url, final: row.final, status: row.status,
  noindex: row.noindex, sourceSlug: slugFromUrl(row.url), finalSlug: slugFromUrl(row.final) }));
const slugs = [...new Set(scopedRows.flatMap(row => [row.sourceSlug, row.finalSlug]))].sort();
const output = Array(slugs.length);
let reusedReport = null;
if (process.argv[4] === '--reuse-cached') {
  reusedReport = JSON.parse(await readFile(new URL(outputName, import.meta.url), 'utf8'));
  if (reusedReport.sourceSha256 !== sourceSha256) throw new Error('Cached lookups belong to another source');
}
const cachedLookups = new Map((reusedReport?.lookups || []).map(row => [row.lookupSlug, row]));
let next = 0;
let completed = 0;
const booleanOrNull = value => typeof value === 'boolean' ? value : null;
const safeReason = value => typeof value === 'string' && value.length <= 160 && /^[a-z0-9:_./-]+$/i.test(value) ? value : null;
function projectIdentity(data) {
  if (!data || typeof data !== 'object' || typeof data._id !== 'string' || typeof data.slug !== 'string') {
    throw new Error('Unexpected station identity response');
  }
  const descriptions = data.descriptions && typeof data.descriptions === 'object' ? Object.values(data.descriptions) : [];
  const nonempty = value => typeof value === 'string' && value.trim().length > 0;
  const full = value => value && typeof value === 'object' && nonempty(value.full);
  return {
    id: data._id,
    slug: data.slug,
    slugAliases: Array.isArray(data.slugAliases) ? data.slugAliases.filter(value => typeof value === 'string') : [],
    noIndex: booleanOrNull(data.noIndex),
    excludeFromSitemap: booleanOrNull(data.excludeFromSitemap),
    excludeFromSeo: booleanOrNull(data.excludeFromSeo),
    isListVisible: booleanOrNull(data.isListVisible),
    redirectToSlug: typeof data.redirectToSlug === 'string' ? data.redirectToSlug : null,
    manualNoIndexOwnership: booleanOrNull(data.manualEditFields?.noIndex),
    manualRedirectOwnership: booleanOrNull(data.manualEditFields?.redirectToSlug),
    automaticNoIndex: data.automaticNoIndex && typeof data.automaticNoIndex === 'object' ? {
      owner: data.automaticNoIndex.owner === 'radiohub-junk-policy' ? 'radiohub-junk-policy' : 'other-or-unknown',
      active: booleanOrNull(data.automaticNoIndex.active),
      reason: safeReason(data.automaticNoIndex.reason),
    } : null,
    descriptionLocaleCount: descriptions.length,
    fullDescriptionLocaleCount: descriptions.filter(full).length,
    fullAndMetaDescriptionLocaleCount: descriptions.filter(value => full(value) && nonempty(value.meta)).length,
  };
}
function classification(row) {
  if (row.status === 404) return 'missing-exact-identity';
  if (!row.identity) return 'lookup-error';
  const identity = row.identity;
  if (identity.redirectToSlug) return 'retained-redirect';
  if (identity.noIndex === true || identity.excludeFromSitemap === true || identity.excludeFromSeo === true) {
    if (identity.manualNoIndexOwnership === true) return 'retained-manual-exclusion';
    if (identity.automaticNoIndex?.active === true) return 'retained-automatic-exclusion';
    return 'retained-exclusion-without-recorded-ownership';
  }
  return 'retained-without-stored-seo-exclusion';
}
async function worker() {
  while (next < slugs.length) {
    const index = next++;
    const slug = slugs[index];
    if (reusedReport) {
      if (!cachedLookups.has(slug)) throw new Error(`No cached lookup for ${slug}`);
      output[index] = cachedLookups.get(slug);
      completed += 1;
      continue;
    }
    const url = `${origin}/api/station/${encodeURIComponent(slug)}`;
    const row = { lookupSlug: slug, apiUrl: url };
    try {
      const response = await fetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(20000),
        headers: { 'user-agent': 'RadioHub-Public-GSC-Identity-Audit/1.0', accept: 'application/json' } });
      row.status = response.status;
      row.stale = response.headers.get('x-data-stale') === 'true';
      if (response.status === 200) row.identity = projectIdentity(await response.json());
      else {
        await response.body?.cancel();
        if (response.status !== 404) row.error = `HTTP ${response.status}`;
      }
    } catch (error) {
      row.error = error?.name === 'TimeoutError' ? 'Request timed out after 20 seconds' : 'Public lookup failed';
    }
    row.classification = classification(row);
    output[index] = row;
    completed += 1;
    if (completed % 50 === 0 || completed === slugs.length) console.log(JSON.stringify({ phase: 'checking', completed, total: slugs.length }));
  }
}
console.log(JSON.stringify({ phase: 'starting', sourceRows: source.rows.length, scopedRows: scopedRows.length, uniqueLookupSlugs: slugs.length, concurrency: 2 }));
await Promise.all([worker(), worker()]);
const lookups = new Map(output.map(row => [row.lookupSlug, row]));
const counts = rows => rows.reduce((all, row) => { const key = row.classification; all[key] = (all[key] || 0) + 1; return all; }, {});
const rows = scopedRows.map(row => {
  const final = lookups.get(row.finalSlug);
  const original = lookups.get(row.sourceSlug);
  return { ...row, classification: final.classification, finalIdentityId: final.identity?.id ?? null,
    sourceIdentityId: original.identity?.id ?? null,
    sourceResolvesToDifferentRecord: !!original.identity && !!final.identity && original.identity.id !== final.identity.id };
});
const retained = new Map();
for (const row of rows) {
  const lookup = lookups.get(row.finalSlug);
  if (!lookup.identity) continue;
  let item = retained.get(lookup.identity.id);
  if (!item) {
    item = { identity: lookup.identity, classification: lookup.classification, sourceUrlCount: 0,
      finalStatuses: {}, exampleUrls: [] };
    retained.set(lookup.identity.id, item);
  }
  item.sourceUrlCount += 1;
  item.finalStatuses[row.status] = (item.finalStatuses[row.status] || 0) + 1;
  if (item.exampleUrls.length < 3) item.exampleUrls.push(row.url);
}
const retainedRecords = [...retained.values()].sort((a, b) => b.sourceUrlCount - a.sourceUrlCount || a.identity.slug.localeCompare(b.identity.slug));
const report = {
  checkedAt: reusedReport?.checkedAt || new Date().toISOString(), source: inputName, sourceCheckedAt: source.checkedAt,
  ...(reusedReport ? { reclassifiedAt: new Date().toISOString() } : {}),
  sourceSha256, concurrency: 2, timeoutMs: 20000,
  scope: 'Exact original and final station slugs for URLs with final HTTP 410 or noindex in the supplied live audit. Public GET only; no search, aliases, database changes, or name-based identity inference.',
  limitations: [
    'Public API absence means no current exact slug/alias identity resolved; it does not prove historical deletion or absence of an archive.',
    'Unknown stored noIndex ownership is not permission to remove the exclusion; current runtime policy may also independently exclude a record.',
    'Description counts show nonempty stored fields, not editorial quality, language accuracy, or station continuity.',
    'The earlier HTML audit and these API lookups have different timestamps; public caches can also differ.',
    'France Bleu besanon, radio-russia and 1fm-movie-soundtrack remain historically unproven; no proposed modern name matches are adopted.',
  ],
  summary: { sourceRows: source.rows.length, selectedNonindexOrGoneRows: selectedRows.length, nonStationRows: nonStationRows.length, scopedRows: rows.length, uniqueLookupSlugs: slugs.length,
    uniqueFinalSlugs: new Set(rows.map(row => row.finalSlug)).size, retainedFinalIdentityCount: retainedRecords.length,
    retainedFinal200NoindexIdentityCount: retainedRecords.filter(row => row.finalStatuses['200']).length,
    retainedFinal410IdentityCount: retainedRecords.filter(row => row.finalStatuses['410']).length,
    retainedIdentityClassifications: counts(retainedRecords),
    lookupClassifications: counts(output), urlClassifications: counts(rows),
    final200NoindexClassifications: counts(rows.filter(row => row.status === 200 && row.noindex)),
    final410Classifications: counts(rows.filter(row => row.status === 410)),
    lookupErrors: output.filter(row => row.classification === 'lookup-error').length,
    staleResponses: output.filter(row => row.stale).length,
    differingSourceAndFinalIdentities: rows.filter(row => row.sourceResolvesToDifferentRecord).length },
  nonStationRows, retainedRecords, lookups: output, rows,
};
await writeFile(new URL(outputName, import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ phase: 'complete', output: outputName, summary: report.summary }));
