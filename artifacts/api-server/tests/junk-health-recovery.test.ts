import { test } from 'node:test';
import assert from 'node:assert/strict';
import { automaticNoIndexExpectedFilter, automaticNoIndexPatch, evaluateJunkStation, getIndexableLanguagesForStation, STREAM_HEALTH_FRESHNESS_MS } from '../src/seo/junk-station-rules';
import { compileCatalogFilter } from '../src/data/postgres-catalog-store';

const day = 86400000;
const ago = (milliseconds: number) => new Date(Date.now() - milliseconds).toISOString();
const station = (changes: any = {}) => ({ name: 'NRJ Oriental', slug: 'nrj-oriental', url: 'https://example.invalid/audio', noIndex: false,
  lastCheckOk: false, lastCheckTime: ago(60000), lastCheckOkTime: ago(31 * day), ...changes });

test('current failed check after a known30day unsuccessful interval stays excluded', () => {
  const row = station();
  assert.deepEqual(evaluateJunkStation(row), { isJunk: true, reason: 'stream-dead-30d' });
  assert.deepEqual(getIndexableLanguagesForStation(row, ['en']), []);
  const patch = automaticNoIndexPatch(row, evaluateJunkStation(row));
  assert.equal(patch.noIndex, true);
  assert.equal(patch.automaticNoIndex.owner, 'radiohub-junk-policy');
  assert.equal(patch.automaticNoIndex.failedCheckAt, row.lastCheckTime);
});

for (const [label, change] of [
  ['2025 failed observation', { lastCheckTime: '2025-09-01T00:00:00Z', lastCheckOkTime: '2025-01-01T00:00:00Z' }],
  ['stale failure', { lastCheckTime: ago(STREAM_HEALTH_FRESHNESS_MS + 1000) }],
  ['missing failure time', { lastCheckTime: undefined }],
  ['invalid failure time', { lastCheckTime: 'not-a-date' }],
  ['future failure', { lastCheckTime: new Date(Date.now() + day).toISOString() }],
  ['no successful history', { lastCheckOkTime: undefined }],
  ['old never-recovered observation', { lastCheckTime: ago(60 * day), lastCheckOkTime: null }],
  ['recent successful check', { lastCheckOkTime: ago(day) }],
  ['success after recorded failure', { lastCheckOkTime: ago(1000) }],
  ['future success', { lastCheckOkTime: new Date(Date.now() + day).toISOString() }],
  ['healthy stream', { lastCheckOk: true }],
] as const) test(`${label} does not establish a current30day outage`, () => {
  assert.equal(evaluateJunkStation(station(change)).isJunk, false);
});

const ownedHealthy = () => station({ noIndex: true, lastCheckOk: true, lastCheckTime: ago(1000), lastCheckOkTime: ago(1000),
  automaticNoIndex: { owner: 'radiohub-junk-policy', version: 1, active: true, reason: 'stream-dead-30d', failedCheckAt: ago(day), markedAt: ago(day) } });

test('fresh recovery clears only owned health flag and retains provenance history', () => {
  const row = ownedHealthy();
  const patch = automaticNoIndexPatch(row, evaluateJunkStation(row));
  assert.equal(patch.noIndex, false);
  assert.equal(patch.automaticNoIndex.active, false);
  assert.equal(patch.automaticNoIndex.failedCheckAt, row.automaticNoIndex.failedCheckAt);
  assert.ok(patch.automaticNoIndex.recoveredAt);
  assert.deepEqual(automaticNoIndexPatch({ ...row, ...patch }, { isJunk: false }), {});
});

for (const [label, change] of [
  ['unknown historical flag', { automaticNoIndex: undefined }],
  ['manual flag', { manualEditFields: { noIndex: true } }],
  ['redirect duplicate', { redirectToSlug: 'nrj-original' }],
  ['stale success', { lastCheckTime: ago(4 * day), lastCheckOkTime: ago(4 * day) }],
  ['missing success', { lastCheckOkTime: undefined }],
  ['no fresh check', { lastCheckTime: undefined }],
  ['old recovered observation', { lastCheckOkTime: ago(2 * day) }],
  ['still failing', { lastCheckOk: false }],
  ['codec variant', { slug: 'nrj-oriental-aac' }],
  ['test stream', { slug: 'nrj-test-stream' }],
] as const) test(`recovery preserves ${label}`, () => {
  const row = { ...ownedHealthy(), ...change };
  assert.deepEqual(automaticNoIndexPatch(row, evaluateJunkStation(row)), {});
});

for (const [key, value] of [['owner','manual'], ['version',2], ['active',false], ['reason','duplicate-of:nrj'], ['reason','codec-suffix:-aac'], ['failedCheckAt','invalid']] as const) {
  test(`recovery rejects incompatible provenance ${key}=${value}`, () => {
    const row = ownedHealthy(); row.automaticNoIndex = { ...row.automaticNoIndex, [key]: value };
    assert.deepEqual(automaticNoIndexPatch(row, { isJunk: false }), {});
  });
}

test('automarking never adopts unknown/manual flags or duplicate redirects', () => {
  for (const extra of [{ noIndex: true }, { manualEditFields: { noIndex: true } }, { redirectToSlug: 'different' }]) {
    const row = station(extra);
    assert.deepEqual(automaticNoIndexPatch(row, evaluateJunkStation(row)), {});
  }
});

test('CAS includes whole policy/manual/redirect/health before-image and parameterizes SQL', () => {
  const row = ownedHealthy();
  const filter = automaticNoIndexExpectedFilter(row);
  assert.deepEqual(filter.noIndex, { $eq: true });
  assert.deepEqual(filter.automaticNoIndex, { $eq: row.automaticNoIndex });
  assert.deepEqual(filter.manualEditFields, { $exists: false });
  assert.deepEqual(filter.redirectToSlug, { $exists: false });
  const compiled = compileCatalogFilter(filter);
  assert.match(compiled.sql, /s\.no_index/);
  assert.match(compiled.sql, /s\.manual_edit_fields/);
  assert.ok(compiled.values.some(value => typeof value === 'string' && value.includes('radiohub-junk-policy')));
  assert.ok(!compiled.sql.includes('radiohub-junk-policy'));
});
