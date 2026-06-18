/**
 * Regression coverage for `frequencyClusterKey` (src/seo/junk-station-rules.ts).
 *
 * This key drives the /api/admin/stations/dedup-frequency endpoint, which
 * 301-redirects near-duplicate station records whose slugs differ ONLY in how
 * a broadcast frequency is punctuated (e.g. "classical-95-9-wcri" vs
 * "classical-959-wcri"). A wrong key here = a wrong production 301, so the two
 * critical properties are locked in below:
 *
 *   1. Frequency-punctuation variants MUST share a key (so they cluster).
 *   2. Genuinely-distinct numbered stations (BBC Radio 1 vs BBC Radio 2) MUST
 *      NOT share a key (so we never merge them).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frequencyClusterKey } from '../src/seo/junk-station-rules';

test('frequency-punctuation variants cluster together', () => {
  const shouldMatch: Array<[string, string]> = [
    ['classical-95-9-wcri', 'classical-959-wcri'],
    ['wcbe-90-5-columbus-oh', 'wcbe-905-columbus-oh'],
    ['hot-91-1', 'hot-911'],
    ['delta-90-3', 'delta-903'],
    ['coast-93-3', 'coast-933'],
    ['power100-100-7mhz', 'power100-1007mhz'],
  ];
  for (const [a, b] of shouldMatch) {
    assert.equal(
      frequencyClusterKey(a),
      frequencyClusterKey(b),
      `expected "${a}" and "${b}" to share a cluster key`,
    );
  }
});

test('distinct numbered stations do NOT cluster (no wrong 301)', () => {
  const shouldDiffer: Array<[string, string]> = [
    ['bbc-radio-1', 'bbc-radio-2'],
    ['radio-caroline', 'radio-caroline-2'],
    ['npo-radio-1', 'npo-radio-2'],
  ];
  for (const [a, b] of shouldDiffer) {
    assert.notEqual(
      frequencyClusterKey(a),
      frequencyClusterKey(b),
      `expected "${a}" and "${b}" to have DIFFERENT cluster keys`,
    );
  }
});

test('numeric-only and empty slugs return null (treated as junk, not clustered)', () => {
  for (const s of ['-553', '-2180', '1234', '', '   ']) {
    assert.equal(frequencyClusterKey(s), null, `expected null for "${s}"`);
  }
  assert.equal(frequencyClusterKey(null), null);
  assert.equal(frequencyClusterKey(undefined), null);
});

test('word hyphens are preserved (only digit-digit hyphens collapse)', () => {
  assert.equal(frequencyClusterKey('columbus-oh-rocks'), 'columbus-oh-rocks');
  // letter-digit hyphen preserved; only the 9-9 inside collapses
  assert.equal(frequencyClusterKey('kiss-103-1'), 'kiss-1031');
});
