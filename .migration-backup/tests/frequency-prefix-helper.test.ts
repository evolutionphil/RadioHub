import assert from 'node:assert';
import { frequencyPrefixBaseSlug } from '../server/seo/junk-station-rules';

const cases: Array<[string, string|null]> = [
  ['1046-rtl-luxus-hits', 'rtl-luxus-hits'],
  ['941-bilal-fm', 'bilal-fm'],
  ['999-radio-x', 'radio-x'],
  ['radio-100', null],
  ['99-2', null],
  ['12-am', null],
  ['100-fm', null],
  ['rtl', null],
  ['', null],
  ['12345-something', null],
];
let failed = 0;
for (const [input, expected] of cases) {
  const got = frequencyPrefixBaseSlug(input);
  if (got !== expected) {
    console.error(`FAIL "${input}" -> ${got} (expected ${expected})`);
    failed++;
  }
}
assert.strictEqual(failed, 0, `${failed} cases failed`);
console.log(`✅ ${cases.length}/${cases.length} frequency-prefix cases passed`);
