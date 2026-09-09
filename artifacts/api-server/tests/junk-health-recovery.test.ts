import { test } from 'node:test';
import assert from 'node:assert/strict';
import { automaticNoIndexExpectedFilter, automaticNoIndexPatch, evaluateJunkStation, getIndexableLanguagesForStation } from '../src/seo/junk-station-rules';
import { compileCatalogFilter } from '../src/data/postgres-catalog-store';

const day = 86400000;
const ago = (milliseconds: number) => new Date(Date.now() - milliseconds).toISOString();
const station = (changes: any = {}) => ({ name: 'NRJ Oriental', slug: 'nrj-oriental', url: 'https://example.invalid/audio', noIndex: false,
  lastCheckOk: false, lastCheckTime: ago(60000), lastCheckOkTime: ago(31 * day), ...changes });

test('a prolonged failed stream retains its information page and cannot acquire a health noindex', () => {
  const row = station();
  assert.deepEqual(evaluateJunkStation(row), { isJunk: false });
  assert.deepEqual(getIndexableLanguagesForStation(row, ['en']), ['en']);
  assert.deepEqual(automaticNoIndexPatch(row, evaluateJunkStation(row)), {});
  assert.deepEqual(automaticNoIndexPatch(row, { isJunk: true, reason: 'stream-dead-30d' }), {});
});

for (const [label, change] of [
  ['2025 failed observation', { lastCheckTime: '2025-09-01T00:00:00Z', lastCheckOkTime: '2025-01-01T00:00:00Z' }],
  ['stale failure', { lastCheckTime: ago(4 * day) }],
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

test('policy retirement clears only owned health flag and retains provenance without claiming stream recovery', () => {
  const row = ownedHealthy();
  const patch = automaticNoIndexPatch(row, evaluateJunkStation(row));
  assert.equal(patch.noIndex, false);
  assert.equal(patch.automaticNoIndex.active, false);
  assert.equal(patch.automaticNoIndex.failedCheckAt, row.automaticNoIndex.failedCheckAt);
  assert.ok(patch.automaticNoIndex.retiredAt);
  assert.equal(patch.automaticNoIndex.retiredReason, 'stream-health-is-not-content-quality');
  assert.equal(patch.automaticNoIndex.recoveredAt, undefined);
  assert.equal(patch.lastCheckOk, undefined);
  assert.deepEqual(automaticNoIndexPatch({ ...row, ...patch }, { isJunk: false }), {});
});

for (const [label, change] of [
  ['unknown historical flag', { automaticNoIndex: undefined }],
  ['manual flag', { manualEditFields: { noIndex: true } }],
  ['redirect duplicate', { redirectToSlug: 'nrj-original' }],
  ['codec variant', { slug: 'nrj-oriental-aac' }],
  ['test stream', { slug: 'nrj-test-stream' }],
] as const) test(`recovery preserves ${label}`, () => {
  const row = { ...ownedHealthy(), ...change };
  assert.deepEqual(automaticNoIndexPatch(row, evaluateJunkStation(row)), {});
});

for (const [label, change] of [
  ['still failing', { lastCheckOk: false }],
  ['unknown health', { lastCheckOk: undefined }],
  ['stale success', { lastCheckTime: ago(4 * day), lastCheckOkTime: ago(4 * day) }],
  ['no successful history', { lastCheckOkTime: undefined }],
] as const) test(`owned health-only policy retirement is independent of ${label}`, () => {
  const row = { ...ownedHealthy(), ...change };
  const before = structuredClone(row);
  const patch = automaticNoIndexPatch(row, evaluateJunkStation(row));
  assert.equal(patch.noIndex, false);
  assert.equal(patch.lastCheckOk, undefined);
  assert.equal(patch.automaticNoIndex.recoveredAt, undefined);
  assert.deepEqual(row, before, 'observed source is not mutated');
});

test('retirement rechecks all content quality rules even if a caller provides an incomplete verdict', () => {
  assert.deepEqual(automaticNoIndexPatch({ ...ownedHealthy(), slug: 'radio-test-stream' }, { isJunk: false }), {});
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
