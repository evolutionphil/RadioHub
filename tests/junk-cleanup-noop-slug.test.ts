import assert from 'node:assert';
import fs from 'node:fs/promises';
import mongoose from 'mongoose';

// Regression for task #28: when the collision-resolution loop appends a -N
// suffix that ends up identical to the station's existing slug, the script
// must NOT emit an audit row, increment slugRewrites, or issue a Mongo
// update. Earlier the branch wrote a no-op `{ slug, slugAliases }` `$set`
// and produced rows like `old=foo-bar-1 → new=foo-bar-1` in the audit CSV.

import { Station } from '../shared/mongo-schemas';

let updateOneCalls = 0;

(Station as any).countDocuments = async () => 1;

// Pretend the canonical "foo-bar" slug is already taken by a sibling, while
// "foo-bar-1" (this station's current slug) is unique. That's the exact
// shape that previously triggered the no-op rewrite.
(Station as any).exists = async (query: any) => {
  if (query?.slug === 'foo-bar') {
    return { _id: new mongoose.Types.ObjectId() };
  }
  return false;
};

(Station as any).updateOne = async () => {
  updateOneCalls++;
  return { acknowledged: true, modifiedCount: 1 };
};

(Station as any).find = () => ({
  select: () => ({
    lean: () => ({
      cursor: () => {
        const docs = [
          {
            _id: new mongoose.Types.ObjectId(),
            slug: 'foo-bar-1',
            slugAliases: [],
            // Already noindexed so the dupe-of-base branch can't introduce
            // an unrelated write that would mask the bug we're testing.
            noIndex: true,
            name: 'Foo Bar',
            url: 'http://example.com/stream',
            homepage: '',
            tags: '',
            country: '',
            countryCode: '',
            language: '',
            languageCodes: '',
            bitrate: 128,
          },
        ];
        return (async function* () {
          for (const d of docs) yield d;
        })();
      },
    }),
  }),
});

const reportPath = '/tmp/junk-cleanup-noop-slug-test.csv';

const { runJunkCleanup } = await import('../scripts/clean-content-quality-urls');

const result = await runJunkCleanup({
  dryRun: false,
  manageConnection: false,
  reportPath,
  log: () => {},
});

const csv = await fs.readFile(reportPath, 'utf8');
const dataRows = csv.split('\n').slice(1).filter(Boolean);

assert.strictEqual(
  updateOneCalls,
  0,
  `Expected zero updateOne calls when collision resolution lands on the existing slug, got ${updateOneCalls}`,
);
assert.strictEqual(
  result.slugRewrites,
  0,
  `Expected slugRewrites=0 for no-op rewrite, got ${result.slugRewrites}`,
);
assert.strictEqual(
  dataRows.length,
  0,
  `Expected zero audit rows for no-op rewrite, got ${dataRows.length}: ${dataRows.join('\n')}`,
);

console.log(
  `✅ collision-loop landing on current slug skipped (slugRewrites=${result.slugRewrites}, audit rows=${dataRows.length})`,
);
