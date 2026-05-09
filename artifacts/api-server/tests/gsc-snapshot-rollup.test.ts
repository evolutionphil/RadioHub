/**
 * Regression tests for GscInspectionService.recordDailySnapshot
 * (Task #267, covered by Task #361).
 *
 * `recordDailySnapshot` rolls up the per-URL `GscUrlInspection` cache
 * into one `GscIndexingSnapshot` row per (UTC day, language, group),
 * plus per-language and per-group "all" rollups, plus a single overall
 * `language=all`/`group=all` row. The unique
 * `(date, language, group)` index makes a second run on the same UTC
 * day overwrite (not duplicate) the previous numbers.
 *
 * These tests boot a real in-memory MongoDB, seed a small but
 * deliberately uneven cross-section of inspection rows, run the
 * snapshot, and assert:
 *
 *   1. Every (language, group) combo with seeded rows has a row whose
 *      per-state counts equal the seeded distribution.
 *   2. Each per-language `group='all'` row sums every group for that
 *      language (and only that language).
 *   3. Each per-group `language='all'` row sums every language for
 *      that group (and only that group).
 *   4. The single `language='all'`/`group='all'` overall row equals
 *      the grand total across every seeded row.
 *   5. A second call on the same UTC day overwrites the existing
 *      rows in place — no duplicates, and the counts reflect the
 *      mutation between the two runs.
 *
 * Runner: `--experimental-test-module-mocks` (wired up in
 * artifacts/api-server/package.json#scripts.test).
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

import {
  GscUrlInspection,
  GscIndexingSnapshot,
  type IGscUrlInspection,
} from '@workspace/db-shared/mongo-schemas';

let mongod: MongoMemoryServer;
let gscInspectionService: typeof import('../src/services/gsc-inspection').gscInspectionService;

before(async () => {
  process.env.NODE_ENV = 'test';
  // Make sure the cron initializer in the imported module is a no-op
  // for these tests — we only ever invoke recordDailySnapshot directly.
  process.env.ENABLE_GSC_INSPECTION_CRON = 'false';

  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'gsc-snapshot-test' });

  // Make sure the snapshot collection's unique
  // (date, language, group) index is materialized BEFORE the first
  // recordDailySnapshot call. Without this, the second run
  // (overwrite) test could race the index build and end up inserting
  // duplicates instead of updating in place.
  await GscIndexingSnapshot.syncIndexes();

  ({ gscInspectionService } = await import('../src/services/gsc-inspection'));
});

after(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

beforeEach(async () => {
  await GscUrlInspection.deleteMany({});
  await GscIndexingSnapshot.deleteMany({});
});

type State = IGscUrlInspection['state'];
type Group = IGscUrlInspection['group'];

let seedNonce = 0;

/**
 * Seed rows for a single (language, group) bucket with the given
 * per-state counts. URL is just a unique synthetic — the snapshot
 * doesn't read it, only counts.
 */
async function seedBucket(
  language: string,
  group: Group,
  counts: Partial<Record<State, number>>,
) {
  const docs: Array<Record<string, unknown>> = [];
  for (const [state, n] of Object.entries(counts) as Array<[State, number]>) {
    for (let i = 0; i < n; i++) {
      docs.push({
        url: `https://example.com/${language}/${group}/${state}/${i}/${seedNonce++}`,
        language,
        group,
        state,
        errorCount: 0,
        discoveredAt: new Date(),
        updatedAt: new Date(),
      });
    }
  }
  if (docs.length > 0) await GscUrlInspection.insertMany(docs);
}

function utcMidnight(d: Date = new Date()): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

// ---------------------------------------------------------------------------
// 1+2+3+4: a single snapshot run produces correct per-bucket and rollup rows.
// ---------------------------------------------------------------------------

test('recordDailySnapshot rolls per-URL state into per-bucket, per-language, per-group, and overall rows', async () => {
  // Deliberately uneven seed across two languages and three groups so
  // the rollups can't accidentally pass by symmetry.
  // en/static:  2 indexed, 1 crawled-not-indexed                → 3 total
  // en/station: 4 indexed, 2 discovered-not-indexed, 1 excluded → 7 total
  // en/genre:   1 pending, 1 error                              → 2 total
  // de/static:  3 indexed, 1 unknown                            → 4 total
  // de/station: 2 indexed                                       → 2 total
  await seedBucket('en', 'static', { indexed: 2, 'crawled-not-indexed': 1 });
  await seedBucket('en', 'station', {
    indexed: 4,
    'discovered-not-indexed': 2,
    excluded: 1,
  });
  await seedBucket('en', 'genre', { pending: 1, error: 1 });
  await seedBucket('de', 'static', { indexed: 3, unknown: 1 });
  await seedBucket('de', 'station', { indexed: 2 });

  const stats = await gscInspectionService.recordDailySnapshot('test');
  assert.ok(stats, 'recordDailySnapshot must return stats on success');

  const today = utcMidnight();
  const allRows = await GscIndexingSnapshot.find({ date: today }).lean();

  // Expected row layout: 5 per-bucket + 2 per-language rollups +
  // 3 per-group rollups + 1 overall = 11.
  assert.equal(
    allRows.length,
    11,
    `expected 11 snapshot rows (5 buckets + 2 lang + 3 group + 1 overall), got ${allRows.length}`,
  );
  assert.equal(stats!.rows, 11);
  assert.equal(stats!.date, today.toISOString());

  const findRow = (language: string, group: string) =>
    allRows.find((r) => r.language === language && r.group === group);

  // ---- 1. Per-bucket rows match the seeded distribution exactly.
  const enStatic = findRow('en', 'static');
  assert.ok(enStatic, 'missing en/static bucket row');
  assert.equal(enStatic!.total, 3);
  assert.equal(enStatic!.indexed, 2);
  assert.equal(enStatic!.crawledNotIndexed, 1);
  assert.equal(enStatic!.discoveredNotIndexed, 0);
  assert.equal(enStatic!.excluded, 0);
  assert.equal(enStatic!.error, 0);
  assert.equal(enStatic!.pending, 0);
  assert.equal(enStatic!.unknown, 0);

  const enStation = findRow('en', 'station');
  assert.ok(enStation);
  assert.equal(enStation!.total, 7);
  assert.equal(enStation!.indexed, 4);
  assert.equal(enStation!.discoveredNotIndexed, 2);
  assert.equal(enStation!.excluded, 1);

  const enGenre = findRow('en', 'genre');
  assert.ok(enGenre);
  assert.equal(enGenre!.total, 2);
  assert.equal(enGenre!.pending, 1);
  assert.equal(enGenre!.error, 1);

  const deStatic = findRow('de', 'static');
  assert.ok(deStatic);
  assert.equal(deStatic!.total, 4);
  assert.equal(deStatic!.indexed, 3);
  assert.equal(deStatic!.unknown, 1);

  const deStation = findRow('de', 'station');
  assert.ok(deStation);
  assert.equal(deStation!.total, 2);
  assert.equal(deStation!.indexed, 2);

  // ---- 2. Per-language `group='all'` rows sum every group for that
  // language and only that language.
  const enAll = findRow('en', 'all');
  assert.ok(enAll, 'missing per-language rollup en/all');
  // 3 + 7 + 2 = 12
  assert.equal(enAll!.total, 12, 'en/all total must sum every en bucket');
  // 2 + 4 + 0 = 6
  assert.equal(enAll!.indexed, 6);
  assert.equal(enAll!.crawledNotIndexed, 1);
  assert.equal(enAll!.discoveredNotIndexed, 2);
  assert.equal(enAll!.excluded, 1);
  assert.equal(enAll!.error, 1);
  assert.equal(enAll!.pending, 1);
  assert.equal(enAll!.unknown, 0);

  const deAll = findRow('de', 'all');
  assert.ok(deAll, 'missing per-language rollup de/all');
  assert.equal(deAll!.total, 6);
  assert.equal(deAll!.indexed, 5);
  assert.equal(deAll!.unknown, 1);
  assert.equal(deAll!.crawledNotIndexed, 0);
  assert.equal(deAll!.error, 0);

  // ---- 3. Per-group `language='all'` rows sum every language for
  // that group and only that group.
  const allStatic = findRow('all', 'static');
  assert.ok(allStatic, 'missing per-group rollup all/static');
  // en/static (3) + de/static (4) = 7
  assert.equal(allStatic!.total, 7);
  assert.equal(allStatic!.indexed, 5);
  assert.equal(allStatic!.crawledNotIndexed, 1);
  assert.equal(allStatic!.unknown, 1);

  const allStation = findRow('all', 'station');
  assert.ok(allStation);
  // en/station (7) + de/station (2) = 9
  assert.equal(allStation!.total, 9);
  assert.equal(allStation!.indexed, 6);
  assert.equal(allStation!.discoveredNotIndexed, 2);
  assert.equal(allStation!.excluded, 1);

  const allGenre = findRow('all', 'genre');
  assert.ok(allGenre);
  assert.equal(allGenre!.total, 2);
  assert.equal(allGenre!.pending, 1);
  assert.equal(allGenre!.error, 1);

  // No rollup row should exist for groups we never seeded (e.g. country).
  assert.equal(
    findRow('all', 'country'),
    undefined,
    'no rollup row should be emitted for un-seeded groups',
  );

  // ---- 4. The single overall row equals the grand total.
  const overall = findRow('all', 'all');
  assert.ok(overall, 'missing overall all/all row');
  // 3 + 7 + 2 + 4 + 2 = 18
  assert.equal(overall!.total, 18, 'overall total must equal seeded grand total');
  assert.equal(overall!.indexed, 11); // 2 + 4 + 0 + 3 + 2
  assert.equal(overall!.crawledNotIndexed, 1);
  assert.equal(overall!.discoveredNotIndexed, 2);
  assert.equal(overall!.excluded, 1);
  assert.equal(overall!.error, 1);
  assert.equal(overall!.pending, 1);
  assert.equal(overall!.unknown, 1);

  // Cross-check: every per-bucket row's `total` summed equals the
  // overall total. Catches rollups that silently drop a bucket.
  const bucketRows = allRows.filter(
    (r) => r.language !== 'all' && r.group !== 'all',
  );
  const bucketSum = bucketRows.reduce((acc, r) => acc + r.total, 0);
  assert.equal(
    bucketSum,
    overall!.total,
    'per-bucket totals must sum to the overall total',
  );
});

// ---------------------------------------------------------------------------
// 5: same-day idempotency — a second call overwrites, never duplicates.
// ---------------------------------------------------------------------------

test('recordDailySnapshot is idempotent for the same UTC day (overwrites, never duplicates)', async () => {
  await seedBucket('en', 'static', { indexed: 2 });
  await seedBucket('en', 'station', { indexed: 1, 'crawled-not-indexed': 1 });

  const first = await gscInspectionService.recordDailySnapshot('test-1');
  assert.ok(first);
  const today = utcMidnight();

  const rowsAfterFirst = await GscIndexingSnapshot.find({
    date: today,
  }).lean();
  // 2 buckets + 1 per-lang + 2 per-group + 1 overall = 6
  assert.equal(rowsAfterFirst.length, 6);

  const overallAfterFirst = rowsAfterFirst.find(
    (r) => r.language === 'all' && r.group === 'all',
  );
  assert.ok(overallAfterFirst);
  assert.equal(overallAfterFirst!.total, 4);
  assert.equal(overallAfterFirst!.indexed, 3);
  assert.equal(overallAfterFirst!.crawledNotIndexed, 1);
  const firstCreatedAt = overallAfterFirst!.createdAt;

  // Mutate the cache between runs: an extra indexed station and a
  // newly-discovered pending genre. The second snapshot must reflect
  // those numbers, not the first run's.
  await seedBucket('en', 'station', { indexed: 1 });
  await seedBucket('en', 'genre', { pending: 1 });

  const second = await gscInspectionService.recordDailySnapshot('test-2');
  assert.ok(second);

  const rowsAfterSecond = await GscIndexingSnapshot.find({
    date: today,
  }).lean();
  // 3 buckets + 1 per-lang + 3 per-group + 1 overall = 8 (not 6 + 8)
  assert.equal(
    rowsAfterSecond.length,
    8,
    'second run must overwrite, not append — expected 8 rows total, not 14',
  );

  // Hard guarantee against duplicates on the unique key.
  const seen = new Set<string>();
  for (const r of rowsAfterSecond) {
    const key = `${r.date.toISOString()}|${r.language}|${r.group}`;
    assert.ok(
      !seen.has(key),
      `duplicate row for (date, language, group) = ${key}`,
    );
    seen.add(key);
  }

  const overallAfterSecond = rowsAfterSecond.find(
    (r) => r.language === 'all' && r.group === 'all',
  );
  assert.ok(overallAfterSecond);
  // 2 + 2 + 1 + 1 = 6 indexed/crawled/pending/etc → total 6
  assert.equal(overallAfterSecond!.total, 6);
  assert.equal(overallAfterSecond!.indexed, 4);
  assert.equal(overallAfterSecond!.crawledNotIndexed, 1);
  assert.equal(overallAfterSecond!.pending, 1);

  // The createdAt sentinel must be preserved across overwrites — the
  // production code uses $setOnInsert for createdAt, so re-running on
  // the same day must keep the original insert timestamp.
  assert.deepEqual(
    overallAfterSecond!.createdAt,
    firstCreatedAt,
    'createdAt must be preserved on overwrite (uses $setOnInsert)',
  );

  // And the en/station bucket must reflect the mutated count.
  const enStation = rowsAfterSecond.find(
    (r) => r.language === 'en' && r.group === 'station',
  );
  assert.ok(enStation);
  assert.equal(enStation!.total, 3);
  assert.equal(enStation!.indexed, 2);
  assert.equal(enStation!.crawledNotIndexed, 1);
});
