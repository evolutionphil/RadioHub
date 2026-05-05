/**
 * Regression test: re-flagging stations whose slug is generated after ingest.
 *
 * `evaluateJunkStation` keys off the slug to match codec-suffix patterns.
 * Brand-new stations don't have a persisted slug at ingest time, so the sync
 * pipeline probes with `slugifyStationName(name)`. If the canonical slug is
 * later assigned with a collision suffix (e.g. `my-radio-mp3-1`), the station
 * must still be flagged the next time it's evaluated.
 *
 * Run with:  npx tsx tests/junk-station-resync.test.ts
 */
import assert from 'node:assert/strict';
import {
  evaluateJunkStation,
  slugifyStationName,
} from '../server/seo/junk-station-rules';

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  \u2714 ${name}`);
  } catch (err: any) {
    failures++;
    console.error(`  \u2718 ${name}\n    ${err?.message || err}`);
  }
}

console.log('junk-station-rules: slug-aware re-evaluation');

check('plain codec suffix flags station as junk', () => {
  const v = evaluateJunkStation({
    name: 'My Radio',
    slug: 'my-radio-mp3',
    url: 'http://example.com/stream',
  });
  assert.equal(v.isJunk, true);
  assert.match(v.reason || '', /codec-suffix:-mp3$/);
});

check('collision-counter codec suffix flags station as junk', () => {
  // This is the regression: the probe slug at ingest is `my-radio`, which
  // looks clean; only after the collision suffix `-mp3-1` is appended does
  // the codec-suffix rule fire. The canonical pipeline must call this
  // function with the *persisted* slug.
  const v = evaluateJunkStation({
    name: 'My Radio',
    slug: 'my-radio-mp3-1',
    url: 'http://example.com/stream',
  });
  assert.equal(v.isJunk, true);
  assert.match(v.reason || '', /codec-suffix:-mp3-1$/);
});

check('clean slug stays indexable', () => {
  const v = evaluateJunkStation({
    name: 'My Radio',
    slug: 'my-radio',
    url: 'http://example.com/stream',
  });
  assert.equal(v.isJunk, false);
});

check('probe slug from name alone misses collision suffix', () => {
  // Documents the failure mode the task fixes: probing with
  // `slugifyStationName(name)` cannot see a collision suffix that is added
  // later by the slug-uniqueness pass.
  const probe = slugifyStationName('My Radio');
  const probed = evaluateJunkStation({
    name: 'My Radio',
    slug: probe,
    url: 'http://example.com/stream',
  });
  assert.equal(probed.isJunk, false);
  // …but the same record evaluated with the persisted slug *is* junk.
  const persisted = evaluateJunkStation({
    name: 'My Radio',
    slug: `${probe}-mp3-1`,
    url: 'http://example.com/stream',
  });
  assert.equal(persisted.isJunk, true);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log('\nAll junk-station re-sync tests passed.');
