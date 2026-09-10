import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assessDuplicateGroup } from '../src/utils/station-duplicate-policy';
import { preserveMergedStationMetadata } from '../src/utils/station-merge-preservation';

const station = (id: string, patch: Record<string, any> = {}) => ({ _id: id, stationuuid: `uuid-${id}`, name: 'Radio One', country: 'Germany', countryCode: 'DE', url: 'https://stream.example/live?channel=1', ...patch });
describe('conservative duplicate identity policy', () => {
  it('requires matching normalized names, country and a common actual HTTP endpoint', () => {
    assert.equal(assessDuplicateGroup([station('a'), station('b', { name: '  RADIO   ONE ', country: ' germany ', url: 'https://STREAM.example/live?channel=1#player' })]).eligible, true);
    assert.equal(assessDuplicateGroup([station('a'), station('b', { url: 'https://other.example/one', urlResolved: station('a').url })]).eligible, true);
  });
  it('never merges regional editions or stations with missing identity', () => {
    for (const patch of [{ name: 'Radio One FM' }, { country: 'Austria' }, { country: '' }, { countryCode: 'AT' }, { city: 'Munich' }, { state: 'Bavaria' }]) {
      assert.equal(assessDuplicateGroup([station('a', { city: 'Berlin', state: 'Berlin' }), station('b', patch)]).eligible, false);
    }
    assert.equal(assessDuplicateGroup([station('a', { country: '' }), station('b', { country: '' })]).eligible, true);
    assert.equal(assessDuplicateGroup([station('a', { country: '', countryCode: '' }), station('b', { country: '', countryCode: '' })]).eligible, false);
    assert.equal(assessDuplicateGroup([station('a')]).eligible, false);
  });
  it('preserves protocol, path case and queries rather than matching only a broadcaster host', () => {
    for (const url of ['http://stream.example/live?channel=1', 'https://stream.example/Live?channel=1', 'https://stream.example/live?channel=2', 'https://stream.example/another']) {
      assert.equal(assessDuplicateGroup([station('a'), station('b', { url })]).eligible, false);
    }
  });
  it('requires an intersection across every member, not a transitive chain', () => {
    const a = 'https://example.org/a', b = 'https://example.org/b', c = 'https://example.org/c';
    assert.equal(assessDuplicateGroup([station('a', { url: a, urlResolved: b }), station('b', { url: b, urlResolved: c }), station('c', { url: c, urlResolved: a })]).eligible, false);
  });
  it('does not treat an obsolete resolved URL as identity after a manual raw URL repair', () => {
    const manual = station('b', { url: 'https://repaired.example/live', urlResolved: station('a').url, manualEditFields: { url: true } });
    assert.equal(assessDuplicateGroup([station('a'), manual]).eligible, false);
    assert.equal(assessDuplicateGroup([station('a'), { ...manual, manualEditFields: { url: true, urlResolved: true } }]).eligible, true);
  });
  it('rejects missing, non-HTTP and credential-bearing shared values', () => {
    for (const url of ['', '/live', 'ftp://example.org/live', 'javascript:alert(1)', 'https://user:secret@example.org/live']) {
      assert.equal(assessDuplicateGroup([station('a', { url }), station('b', { url })]).eligible, false);
    }
  });
});

describe('deterministic duplicate content preservation', () => {
  it('keeps survivor content and fills missing locale subfields from sorted donors without mutating inputs', () => {
    const primary = station('p', { descriptions: { de: { full: 'Keep German', meta: '' }, en: 'Legacy English' }, manualEditFields: { name: true }, slug: 'radio-one' });
    const donorA = station('a', { descriptions: { de: { full: 'Do not overwrite', meta: 'German meta A' }, tr: { full: 'Türkçe', meta: 'Türkçe meta' } } });
    const donorZ = station('z', { descriptions: { de: { meta: 'German meta Z' }, en: { full: 'Do not replace a legacy string' } } });
    const snapshot = structuredClone(primary);
    const merged = preserveMergedStationMetadata(primary, [donorZ, donorA]);
    assert.deepEqual(merged.descriptions, { de: { full: 'Keep German', meta: 'German meta A' }, en: 'Legacy English', tr: { full: 'Türkçe', meta: 'Türkçe meta' } });
    assert.deepEqual(primary, snapshot);
    assert.deepEqual(merged.descriptions, preserveMergedStationMetadata(primary, [donorA, donorZ]).descriptions);
    assert.equal(merged.name, primary.name); assert.equal(merged.url, primary.url); assert.equal(merged.manualEditFields.name, true);
  });
  it('does not fill intentionally protected missing fields and keeps copied manual text protected', () => {
    const donor = station('d', { descriptions: { de: { full: 'Manual German', meta: 'Manual meta' }, tr: { full: 'Manual Turkish' } }, manualEditFields: { descriptions: true } });
    const protectedAll = station('p', { descriptions: { en: { full: 'English' } }, manualEditFields: { descriptions: true } });
    assert.deepEqual(preserveMergedStationMetadata(protectedAll, [donor]).descriptions, protectedAll.descriptions);
    const partial = preserveMergedStationMetadata(station('p', { descriptions: {}, manualEditFields: { 'descriptions.de.meta': true } }), [donor]);
    assert.deepEqual(partial.descriptions, { de: { full: 'Manual German' }, tr: { full: 'Manual Turkish' } });
    assert.equal(partial.manualEditFields.descriptions, true);
  });
  it('unions raw/resolved/historical URLs and all old slugs, IDs and UUIDs', () => {
    const result = preserveMergedStationMetadata(station('p', { slug: 'keep', slugAliases: ['old-keep'], mergedUrls: ['https://old.example/keep'] }), [station('d', {
      slug: 'old-slug', slugAliases: ['older-slug', 'keep'], urlResolved: 'https://resolved.example/live', mergedStationIds: ['older-id'], mergedStationUuids: ['older-uuid'],
    })]);
    assert.deepEqual(result.slugAliases, ['old-keep', 'older-slug', 'old-slug']);
    assert.deepEqual(result.mergedStationIds, ['d', 'older-id']);
    assert.deepEqual(result.mergedStationUuids, ['uuid-d', 'older-uuid']);
    assert.deepEqual(result.mergedUrls, [station('p').url, 'https://old.example/keep', 'https://resolved.example/live']);
  });
});
