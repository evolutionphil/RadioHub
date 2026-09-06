/**
 * Regression tests for the one-shot duplicate `Genre.slug` cleanup
 * (Task #210 → #282, covered by Task #369).
 *
 * `runDuplicateGenreSlugCleanup()` is run once against prod to clear
 * legacy duplicate-slug groups so the new partial unique index on
 * `Genre.slug` can build cleanly. Its tiebreak order (stationCount →
 * isDiscoverable → createdAt → _id) decides which doc keeps the slug
 * and which docs lose it forever — a regression here would silently
 * delete the wrong genre's slug on production. These tests pin that
 * ordering down and verify DRY_RUN performs no writes.
 *
 * Tests use an isolated PostgreSQL corruption-recovery schema, temporarily
 * remove slug uniqueness there, seed legacy duplicate rows, and execute the
 * production SQL cleanup in-process. Production constraints are never changed.
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createNativePostgresFixture } from './helpers/native-postgres-fixture';
import { runDuplicateGenreSlugCleanup } from '../src/scripts/cleanup-duplicate-genre-slugs';

let fixture: Awaited<ReturnType<typeof createNativePostgresFixture>>;
const newId=()=>randomBytes(12).toString('hex');
before(async () => {
  fixture=await createNativePostgresFixture('duplicate_genre_cleanup');
  // Only this isolated corruption-recovery fixture permits legacy duplicates.
  await fixture.pool.query('ALTER TABLE genres DROP CONSTRAINT genres_slug_key');
});
after(async () => { if(fixture) await fixture.close(); });
beforeEach(async () => { await fixture.clear('genres'); });

interface RawGenre {
  _id: string;
  name: string;
  slug?: string;
  isDiscoverable?: boolean;
  stationCount?: number;
  createdAt?: Date;
}

async function seedRaw(docs: RawGenre[]): Promise<void> {
  for(const doc of docs) await fixture.insert('genres',{
    id:doc._id,name:doc.name,slug:doc.slug ?? null,is_discoverable:doc.isDiscoverable ?? Boolean(doc.slug),
    station_count:doc.stationCount ?? 0,created_at:doc.createdAt ?? new Date(),source:doc,
  });
}

async function fetchById(id: string): Promise<{
  slug?: string | null;
  isDiscoverable?: boolean;
  cleanupDemotion?: {
    reason?: string;
    originalSlug?: string;
    normalizedSlug?: string;
    collisionWinnerId?: unknown;
    collisionWinnerSlug?: string;
    collisionWinnerName?: string;
    demotedAt?: Date;
  };
}> {
  const row=(await fixture.pool.query('SELECT * FROM genres WHERE id=$1',[id])).rows[0];
  const demotion=row.source.cleanupDemotion;
  return {slug:row.slug,isDiscoverable:row.is_discoverable,...(demotion?{cleanupDemotion:{...demotion,demotedAt:new Date(demotion.demotedAt)}}:{})};
}

// ---------------------------------------------------------------------------
// Tiebreak: highest stationCount wins regardless of discoverability,
// createdAt, or _id ordering.
// ---------------------------------------------------------------------------

test('highest stationCount wins, even when other docs are discoverable / older / smaller _id', async () => {
  // Build _ids in ascending lexicographic order so the loser has the
  // smaller _id — proves stationCount beats the _id tiebreak.
  const loserA = '000000000000000000000001';
  const winner = '000000000000000000000002';
  const loserB = '000000000000000000000003';

  await seedRaw([
    {
      _id: loserA,
      name: 'Pop (old hidden)',
      slug: 'pop',
      isDiscoverable: true,
      stationCount: 3,
      createdAt: new Date('2020-01-01T00:00:00Z'),
    },
    {
      _id: winner,
      name: 'Pop (busy)',
      slug: 'pop',
      isDiscoverable: false,
      stationCount: 99,
      createdAt: new Date('2024-06-01T00:00:00Z'),
    },
    {
      _id: loserB,
      name: 'Pop (rookie)',
      slug: 'pop',
      isDiscoverable: true,
      stationCount: 0,
      createdAt: new Date('2025-02-01T00:00:00Z'),
    },
  ]);

  const stats = await runDuplicateGenreSlugCleanup({
    manageConnection: false,
    log: () => {},
  });

  assert.equal(stats.duplicateGroups, 1);
  assert.equal(stats.scanned, 3);
  assert.equal(stats.winnersKept, 1);
  assert.equal(stats.losersDemoted, 2);
  assert.equal(stats.errors, 0);

  const winnerDoc = await fetchById(winner);
  assert.equal(winnerDoc.slug, 'pop', 'winner keeps the slug untouched');
  assert.equal(
    winnerDoc.isDiscoverable,
    false,
    'winner is left exactly as it was (still not discoverable)',
  );
  assert.equal(
    winnerDoc.cleanupDemotion,
    undefined,
    'winner gets no cleanupDemotion subdoc',
  );

  for (const id of [loserA, loserB]) {
    const loser = await fetchById(id);
    assert.equal(loser.slug, null, `loser ${id} has slug unset`);
    assert.equal(loser.isDiscoverable, false, `loser ${id} is hidden`);
    assert.ok(loser.cleanupDemotion, `loser ${id} has cleanupDemotion`);
    assert.equal(loser.cleanupDemotion!.reason, 'collision');
    assert.equal(loser.cleanupDemotion!.originalSlug, 'pop');
    assert.equal(loser.cleanupDemotion!.normalizedSlug, 'pop');
    assert.equal(
      String(loser.cleanupDemotion!.collisionWinnerId),
      String(winner),
    );
    assert.equal(loser.cleanupDemotion!.collisionWinnerSlug, 'pop');
    assert.equal(loser.cleanupDemotion!.collisionWinnerName, 'Pop (busy)');
    assert.ok(loser.cleanupDemotion!.demotedAt instanceof Date);
  }
});

// ---------------------------------------------------------------------------
// Tiebreak: when stationCount is tied, the discoverable doc wins over a
// hidden one — never accidentally promote a hidden/junk row.
// ---------------------------------------------------------------------------

test('with equal stationCount, the discoverable doc wins over a hidden one', async () => {
  const hiddenOlderSmallerId = '000000000000000000000010';
  const discoverable = '000000000000000000000020';

  await seedRaw([
    {
      _id: hiddenOlderSmallerId,
      name: 'Rock (hidden)',
      slug: 'rock',
      isDiscoverable: false,
      stationCount: 5,
      createdAt: new Date('2019-01-01T00:00:00Z'),
    },
    {
      _id: discoverable,
      name: 'Rock (live)',
      slug: 'rock',
      isDiscoverable: true,
      stationCount: 5,
      createdAt: new Date('2024-01-01T00:00:00Z'),
    },
  ]);

  const stats = await runDuplicateGenreSlugCleanup({
    manageConnection: false,
    log: () => {},
  });
  assert.equal(stats.losersDemoted, 1);

  const winner = await fetchById(discoverable);
  assert.equal(winner.slug, 'rock');
  assert.equal(winner.cleanupDemotion, undefined);

  const loser = await fetchById(hiddenOlderSmallerId);
  assert.equal(loser.slug, null);
  assert.equal(loser.isDiscoverable, false);
  assert.equal(loser.cleanupDemotion?.collisionWinnerName, 'Rock (live)');
});

// ---------------------------------------------------------------------------
// Tiebreak: when stationCount AND isDiscoverable are tied, the older
// createdAt wins (favor the original record).
// ---------------------------------------------------------------------------

test('with equal stationCount and discoverability, the older createdAt wins', async () => {
  const older = '000000000000000000000200';
  const newer = '000000000000000000000100'; // smaller _id but newer

  await seedRaw([
    {
      _id: newer,
      name: 'Jazz (newer)',
      slug: 'jazz',
      isDiscoverable: true,
      stationCount: 10,
      createdAt: new Date('2024-12-01T00:00:00Z'),
    },
    {
      _id: older,
      name: 'Jazz (original)',
      slug: 'jazz',
      isDiscoverable: true,
      stationCount: 10,
      createdAt: new Date('2018-03-01T00:00:00Z'),
    },
  ]);

  await runDuplicateGenreSlugCleanup({
    manageConnection: false,
    log: () => {},
  });

  const winner = await fetchById(older);
  assert.equal(winner.slug, 'jazz');
  assert.equal(winner.cleanupDemotion, undefined);

  const loser = await fetchById(newer);
  assert.equal(loser.slug, null);
  assert.equal(loser.cleanupDemotion?.collisionWinnerName, 'Jazz (original)');
  assert.equal(
    String(loser.cleanupDemotion?.collisionWinnerId),
    String(older),
  );
});

// ---------------------------------------------------------------------------
// Tiebreak: with everything else equal, the lexicographically smallest
// _id wins — gives deterministic, stable re-runs.
// ---------------------------------------------------------------------------

test('with everything else equal, the lexicographically smallest _id wins (stable re-runs)', async () => {
  const small = '000000000000000000000aaa';
  const big = '000000000000000000000bbb';
  const sameTime = new Date('2022-05-05T00:00:00Z');

  await seedRaw([
    {
      _id: big,
      name: 'Indie (B)',
      slug: 'indie',
      isDiscoverable: true,
      stationCount: 7,
      createdAt: sameTime,
    },
    {
      _id: small,
      name: 'Indie (A)',
      slug: 'indie',
      isDiscoverable: true,
      stationCount: 7,
      createdAt: sameTime,
    },
  ]);

  await runDuplicateGenreSlugCleanup({
    manageConnection: false,
    log: () => {},
  });

  assert.equal((await fetchById(small)).slug, 'indie');
  assert.equal((await fetchById(big)).slug, null);
  assert.equal(
    (await fetchById(big)).cleanupDemotion?.collisionWinnerName,
    'Indie (A)',
  );
});

// ---------------------------------------------------------------------------
// Multiple groups + isolation: a non-duplicated slug is left alone, and
// each duplicate group is resolved independently.
// ---------------------------------------------------------------------------

test('handles multiple duplicate groups independently and leaves unique slugs alone', async () => {
  const popWinner = newId();
  const popLoser = newId();
  const rockWinner = newId();
  const rockLoser = newId();
  const lonely = newId();

  await seedRaw([
    {
      _id: popWinner,
      name: 'Pop',
      slug: 'pop',
      isDiscoverable: true,
      stationCount: 50,
      createdAt: new Date('2020-01-01T00:00:00Z'),
    },
    {
      _id: popLoser,
      name: 'Pop dup',
      slug: 'pop',
      isDiscoverable: false,
      stationCount: 1,
      createdAt: new Date('2024-01-01T00:00:00Z'),
    },
    {
      _id: rockWinner,
      name: 'Rock',
      slug: 'rock',
      isDiscoverable: true,
      stationCount: 20,
      createdAt: new Date('2021-01-01T00:00:00Z'),
    },
    {
      _id: rockLoser,
      name: 'Rock dup',
      slug: 'rock',
      isDiscoverable: false,
      stationCount: 2,
      createdAt: new Date('2024-01-01T00:00:00Z'),
    },
    {
      _id: lonely,
      name: 'Lonely',
      slug: 'lonely',
      isDiscoverable: true,
      stationCount: 1,
      createdAt: new Date('2023-01-01T00:00:00Z'),
    },
  ]);

  const stats = await runDuplicateGenreSlugCleanup({
    manageConnection: false,
    log: () => {},
  });

  assert.equal(stats.duplicateGroups, 2);
  assert.equal(stats.winnersKept, 2);
  assert.equal(stats.losersDemoted, 2);
  assert.equal(stats.errors, 0);

  assert.equal((await fetchById(popWinner)).slug, 'pop');
  assert.equal((await fetchById(popLoser)).slug, null);
  assert.equal((await fetchById(rockWinner)).slug, 'rock');
  assert.equal((await fetchById(rockLoser)).slug, null);

  const lonelyDoc = await fetchById(lonely);
  assert.equal(lonelyDoc.slug, 'lonely', 'unique slug must be untouched');
  assert.equal(lonelyDoc.isDiscoverable, true);
  assert.equal(lonelyDoc.cleanupDemotion, undefined);
});

// ---------------------------------------------------------------------------
// DRY_RUN mode: stats reflect the planned changes, but no writes happen.
// ---------------------------------------------------------------------------

test('DRY_RUN performs no writes — losers keep their slug, isDiscoverable, and have no cleanupDemotion', async () => {
  const winner = newId();
  const loser = newId();

  await seedRaw([
    {
      _id: winner,
      name: 'Electro',
      slug: 'electro',
      isDiscoverable: true,
      stationCount: 40,
      createdAt: new Date('2020-01-01T00:00:00Z'),
    },
    {
      _id: loser,
      name: 'Electro dup',
      slug: 'electro',
      isDiscoverable: true,
      stationCount: 5,
      createdAt: new Date('2024-01-01T00:00:00Z'),
    },
  ]);

  const stats = await runDuplicateGenreSlugCleanup({
    manageConnection: false,
    dryRun: true,
    log: () => {},
  });

  assert.equal(stats.duplicateGroups, 1);
  assert.equal(stats.winnersKept, 1);
  assert.equal(
    stats.losersDemoted,
    0,
    'DRY_RUN must NOT report any losers as actually demoted',
  );
  assert.equal(stats.errors, 0);

  // Both docs are unchanged on disk.
  const winnerDoc = await fetchById(winner);
  assert.equal(winnerDoc.slug, 'electro');
  assert.equal(winnerDoc.isDiscoverable, true);
  assert.equal(winnerDoc.cleanupDemotion, undefined);

  const loserDoc = await fetchById(loser);
  assert.equal(
    loserDoc.slug,
    'electro',
    'DRY_RUN must NOT clear the loser slug',
  );
  assert.equal(
    loserDoc.isDiscoverable,
    true,
    'DRY_RUN must NOT flip isDiscoverable',
  );
  assert.equal(
    loserDoc.cleanupDemotion,
    undefined,
    'DRY_RUN must NOT write a cleanupDemotion subdoc',
  );
});

// ---------------------------------------------------------------------------
// No-op safety: a clean DB returns zero groups and writes nothing.
// ---------------------------------------------------------------------------

test('no duplicate groups → stats are all zero and nothing is mutated', async () => {
  await seedRaw([
    {
      _id: newId(),
      name: 'Solo',
      slug: 'solo',
      isDiscoverable: true,
      stationCount: 3,
      createdAt: new Date('2024-01-01T00:00:00Z'),
    },
  ]);

  const stats = await runDuplicateGenreSlugCleanup({
    manageConnection: false,
    log: () => {},
  });

  assert.equal(stats.duplicateGroups, 0);
  assert.equal(stats.scanned, 0);
  assert.equal(stats.winnersKept, 0);
  assert.equal(stats.losersDemoted, 0);
  assert.equal(stats.errors, 0);
});
