import assert from 'node:assert/strict';
import { it } from 'node:test';
import { parseStationDescriptionPatch } from '../src/utils/station-description-patch';
const change = { locale: 'de', field: 'meta', value: 'Reviewed summary.', expectedCurrentValue: '', expectedLocaleObject: { full: 'Existing article', meta: '' } };
it('accepts precise full/meta edits and makes absent locale preconditions explicit', () => {
  assert.deepEqual(parseStationDescriptionPatch({ slug: 'radio', changes: [change] }).changes[0], change);
  assert.equal(parseStationDescriptionPatch({ slug: 'radio', changes: [{ ...change, expectedCurrentValue: null, expectedLocaleObject: null }] }).changes.length, 1);
});
it('rejects unsupported locales, paths, duplicate fields, missing expectations and oversized or blank data', () => {
  for (const invalid of [
    { ...change, locale: 'de.full' }, { ...change, locale: '__proto__' }, { ...change, locale: 'xx' },
    { ...change, field: 'other' }, { ...change, value: '' }, { ...change, value: ' '.repeat(4) },
    { ...change, value: 'x'.repeat(1001) }, { ...change, expectedLocaleObject: [] },
    { ...change, expectedCurrentValue: 'not-the-baseline' }, { ...change, surprise: true },
    { locale: 'de', field: 'meta', value: 'Missing preconditions' },
  ]) assert.throws(() => parseStationDescriptionPatch({ slug: 'radio', changes: [invalid] }));
  for (const changes of [[], [change, change], Array(29).fill(change)]) assert.throws(() => parseStationDescriptionPatch({ slug: 'radio', changes }));
  assert.throws(() => parseStationDescriptionPatch({ slug: 'radio', changes: [change], replaceEverything: true }));
});
