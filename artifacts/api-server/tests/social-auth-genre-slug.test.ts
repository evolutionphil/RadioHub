/**
 * Regression test for Task #278.
 *
 * `generateUniqueSlug` in `src/auth/social-auth-simple.ts` is the third
 * Genre.slug write path flagged after Tasks #161 / #206 wired regression
 * coverage around `/api/generate-all-slugs` and
 * `/api/admin/populate-genres`. Today only the social-signup user path
 * uses it, but the helper signature has always exposed `'genre'` as an
 * entityType — so a future refactor that creates favorite-genre rows
 * from social-profile metadata is the most likely place malformed slugs
 * would re-emerge unnoticed.
 *
 * This test locks in the contract documented inline next to the helper:
 *   - clean genre names produce SAFE_GENRE_SLUG_RE-compatible output
 *   - dirty genre names are funneled through `normalizeGenreSlug` so
 *     the output still matches SAFE_GENRE_SLUG_RE (or the helper throws)
 *   - inputs that normalize to '' cause the helper to refuse to write
 *   - uniqueness collisions still produce safe slugs
 *
 * Runner: requires `--experimental-test-module-mocks` (wired up in
 * artifacts/api-server/package.json#scripts.test).
 */
import { test, mock, before } from 'node:test';
import assert from 'node:assert/strict';

// Pull in the real normalizer/regex BEFORE the mock so the mock can
// re-export the real helpers — we want to test production behavior.
import {
  normalizeGenreSlug,
  SAFE_GENRE_SLUG_RE,
} from '../src/seo/genre-slug';

// ---------------------------------------------------------------------------
// Recording SQL transport for the actual PostgreSQL-backed slug helper.
// ---------------------------------------------------------------------------

let existingGenreSlugs = new Set<string>();
let existingUserSlugs = new Set<string>();
let existingStationSlugs = new Set<string>();

const fixturePool = {
  query: async (sql:string, values:unknown[]) => {
    const table=/FROM (genres|users|stations) WHERE slug=/.exec(sql)?.[1];
    assert.ok(table, 'Unexpected SQL in native slug fixture: '+sql);
    const slugs=table==='genres'?existingGenreSlugs:table==='users'?existingUserSlugs:existingStationSlugs;
    const exists=slugs.has(String(values[0]));
    return {rowCount:exists?1:0,rows:exists?[{slug:values[0]}]:[]};
  },
};
mock.module('../src/postgres-runtime', {
  namedExports: {getPostgresPool:()=>fixturePool},
});

let generateUniqueSlug: (
  name: string,
  entityType: 'station' | 'genre' | 'user',
  excludeId?: string,
) => Promise<string>;

before(async () => {
  const mod = await import('../src/auth/social-auth-simple.ts');
  generateUniqueSlug = mod.generateUniqueSlug;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('generateUniqueSlug("genre"): clean names produce SAFE_GENRE_SLUG_RE output', async () => {
  existingGenreSlugs = new Set();
  for (const input of ['Rock', 'Hip Hop', 'drum and bass']) {
    const out = await generateUniqueSlug(input, 'genre');
    assert.match(
      out,
      SAFE_GENRE_SLUG_RE,
      `clean input "${input}" produced unsafe slug "${out}"`,
    );
  }
});

test('generateUniqueSlug("genre"): dirty names are funneled through normalizeGenreSlug', async () => {
  existingGenreSlugs = new Set();
  // Same dirty inputs the Task #161 / #206 tests cover for the other
  // two write paths — this helper must produce identically safe output.
  const cases: Array<[string, string]> = [
    ['R&B', 'r-b'],
    ['bassline"', 'bassline'],
    ['hip   hop', 'hip-hop'],
    ['  Drum & Bass  ', 'drum-bass'],
    ['---synthwave---', 'synthwave'],
    ['<script>alert(1)</script>', 'script-alert-1-script'],
    ['🎸 metal 🤘', 'metal'],
  ];
  for (const [input, expected] of cases) {
    const out = await generateUniqueSlug(input, 'genre');
    assert.equal(out, expected, `genre slug for "${input}" → "${out}"`);
    assert.match(
      out,
      SAFE_GENRE_SLUG_RE,
      `dirty input "${input}" produced unsafe slug "${out}"`,
    );
  }
});

test('generateUniqueSlug("genre"): pure-junk inputs are refused, not silently written', async () => {
  existingGenreSlugs = new Set();
  for (const junk of ['', '   ', '!!!', '???', '🤘🎸']) {
    await assert.rejects(
      () => generateUniqueSlug(junk, 'genre'),
      /refusing to write empty Genre\.slug/,
      `junk input ${JSON.stringify(junk)} should have been refused`,
    );
  }
});

test('generateUniqueSlug("genre"): collision suffix keeps slug safe', async () => {
  existingGenreSlugs = new Set(['rock', 'rock-1']);
  const out = await generateUniqueSlug('Rock', 'genre');
  assert.equal(out, 'rock-2');
  assert.match(out, SAFE_GENRE_SLUG_RE);
});

test('generateUniqueSlug("genre"): queries the Genre collection (not User)', async () => {
  // Pre-Task #278 the helper queried User.findOne regardless of
  // entityType — meaning a 'genre' caller could collide with a user
  // and silently mint a duplicate Genre.slug. Lock the routing in.
  existingGenreSlugs = new Set(['jazz']);
  existingUserSlugs = new Set(['jazz', 'jazz-1', 'jazz-2']);
  const out = await generateUniqueSlug('Jazz', 'genre');
  assert.equal(out, 'jazz-1', 'genre uniqueness must be checked against the Genre collection');
});

test('generateUniqueSlug("user"): unchanged behavior for the production caller', async () => {
  existingUserSlugs = new Set();
  const out = await generateUniqueSlug('Alice Example', 'user');
  // The user slugifier is the original (slightly different) regex;
  // we only assert it remains stable for a vanilla input so this
  // refactor doesn't change observable behavior for the social-signup
  // path that ships today.
  assert.equal(out, 'alice-example');
});
