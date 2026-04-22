import assert from 'node:assert';
import mongoose from 'mongoose';

// Regression: callers passing { dryRun: true } to runJunkCleanup must NOT
// trigger any DB write. Earlier the script gated writes on the global
// DRY_RUN constant (process.argv) instead of the resolved option, so a
// programmatic dryRun call could still write to Mongo.
//
// We exercise the bug surface by:
//   1. Stubbing Station.find / Station.updateOne via a tiny in-memory mock.
//   2. Calling runJunkCleanup({ dryRun: true, manageConnection: false }).
//   3. Asserting updateOne was NEVER invoked.
//
// We do NOT spin up a real Mongo. This keeps the test self-contained and
// runnable in CI / by tests/run-tests.ts.

import { Station } from '../shared/mongo-schemas';

let updateOneCalls = 0;

(Station as any).countDocuments = async () => 1;
(Station as any).exists = async () => false;
(Station as any).updateOne = async () => {
  updateOneCalls++;
  return { acknowledged: true, modifiedCount: 1 };
};
(Station as any).find = () => ({
  select: () => ({
    lean: () => ({
      cursor: () => {
        // Single fake station that WOULD trigger a slug rewrite (name
        // produces a slug different from the empty currentSlug).
        const docs = [
          {
            _id: new mongoose.Types.ObjectId(),
            slug: '',
            slugAliases: [],
            noIndex: false,
            name: 'Test Radio Station',
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

const { runJunkCleanup } = await import('../scripts/clean-content-quality-urls');

const result = await runJunkCleanup({
  dryRun: true,
  manageConnection: false,
  reportPath: '/tmp/junk-cleanup-dry-run-test.csv',
  log: () => {},
});

assert.strictEqual(updateOneCalls, 0, `Expected zero updateOne calls in dryRun mode, got ${updateOneCalls}`);
assert.strictEqual(result.dryRun, true);
assert.ok(result.processed >= 1, 'cursor should have produced at least one station');
console.log(`✅ dryRun:true produced 0 DB writes (processed=${result.processed}, slugRewrites=${result.slugRewrites})`);
