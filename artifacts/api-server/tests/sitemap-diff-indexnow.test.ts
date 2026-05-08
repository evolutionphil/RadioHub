/**
 * Task #190 — unit coverage for the sitemap-diff IndexNow helpers.
 *
 * Pure-function tests for the diff + URL-builder logic so a regression in
 * the canonical URL shape (or a botched diff) trips this guard before the
 * nightly job ships duplicate or empty IndexNow submissions.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {
  diffUrlSets,
  computeMainSitemapUrls,
  computeGenresSitemapUrls,
  isSafeGenreSlug,
  mapGenreIdsToSlugs,
} from '../src/services/sitemap-diff-indexnow';

test('diffUrlSets returns sorted additions only', () => {
  const previous = ['https://example.com/a', 'https://example.com/b'];
  const current = [
    'https://example.com/b',
    'https://example.com/c',
    'https://example.com/a',
    'https://example.com/d',
  ];
  const additions = diffUrlSets(previous, current);
  assert.deepEqual(additions, ['https://example.com/c', 'https://example.com/d']);
});

test('diffUrlSets returns empty array when nothing new', () => {
  const previous = ['x', 'y', 'z'];
  const current = ['y', 'x'];
  assert.deepEqual(diffUrlSets(previous, current), []);
});

test('computeMainSitemapUrls covers all static pages plus top-country pairs', () => {
  const translations = new Map<string, string>();
  const urls = computeMainSitemapUrls({
    language: 'en',
    topCountries: [
      { regionSlug: 'europe', countrySlug: 'germany' },
      { regionSlug: 'asia', countrySlug: 'japan' },
    ],
    translations,
    baseUrl: 'https://example.com',
  });

  // 16 static pages + 2 top-country region pages = 18.
  assert.equal(urls.length, 18);
  assert.ok(urls.includes('https://example.com/en'));
  assert.ok(urls.includes('https://example.com/en/regions/europe/germany'));
  assert.ok(urls.includes('https://example.com/en/regions/asia/japan'));
  assert.ok(urls.includes('https://example.com/en/faq'));

  // Sorted output for deterministic snapshots/diffs.
  const sorted = [...urls].sort();
  assert.deepEqual(urls, sorted);
});

test('computeMainSitemapUrls + diffUrlSets surfaces newly-added top-country pair', () => {
  const translations = new Map<string, string>();
  const previousTop = [{ regionSlug: 'europe', countrySlug: 'germany' }];
  const currentTop = [
    { regionSlug: 'europe', countrySlug: 'germany' },
    { regionSlug: 'europe', countrySlug: 'spain' },
  ];
  const previousUrls = computeMainSitemapUrls({
    language: 'en',
    topCountries: previousTop,
    translations,
    baseUrl: 'https://example.com',
  });
  const currentUrls = computeMainSitemapUrls({
    language: 'en',
    topCountries: currentTop,
    translations,
    baseUrl: 'https://example.com',
  });
  const additions = diffUrlSets(previousUrls, currentUrls);
  assert.deepEqual(additions, ['https://example.com/en/regions/europe/spain']);
});

test('isSafeGenreSlug accepts kebab lowercase, rejects unsafe values', () => {
  assert.equal(isSafeGenreSlug('pop'), true);
  assert.equal(isSafeGenreSlug('drum-and-bass'), true);
  assert.equal(isSafeGenreSlug('genre-pop-2'), true);
  assert.equal(isSafeGenreSlug(''), false);
  assert.equal(isSafeGenreSlug(undefined), false);
  assert.equal(isSafeGenreSlug(null), false);
  assert.equal(isSafeGenreSlug('Pop'), false);
  assert.equal(isSafeGenreSlug('bassline"'), false);
  assert.equal(isSafeGenreSlug('-leading'), false);
  assert.equal(isSafeGenreSlug('trailing-'), false);
  assert.equal(isSafeGenreSlug('with space'), false);
});

test('computeGenresSitemapUrls drops unsafe slugs and dedupes', () => {
  const translations = new Map<string, string>();
  const urls = computeGenresSitemapUrls({
    language: 'en',
    genreSlugs: ['pop', 'rock', 'pop', 'bassline"', 'Jazz', 'drum-and-bass'],
    translations,
    baseUrl: 'https://example.com',
  });
  assert.deepEqual(urls, [
    'https://example.com/en/genres/drum-and-bass',
    'https://example.com/en/genres/pop',
    'https://example.com/en/genres/rock',
  ]);
});

test('computeGenresSitemapUrls + diffUrlSets surfaces newly-whitelisted genre', () => {
  const translations = new Map<string, string>();
  const previousUrls = computeGenresSitemapUrls({
    language: 'en',
    genreSlugs: ['pop', 'rock'],
    translations,
    baseUrl: 'https://example.com',
  });
  const currentUrls = computeGenresSitemapUrls({
    language: 'en',
    genreSlugs: ['pop', 'rock', 'jazz'],
    translations,
    baseUrl: 'https://example.com',
  });
  const additions = diffUrlSets(previousUrls, currentUrls);
  assert.deepEqual(additions, ['https://example.com/en/genres/jazz']);
});

test('mapGenreIdsToSlugs resolves ObjectId and legacy string ids in order, dropping unknowns', () => {
  // Architect-flagged regression guard (task #253): the manifest stores genre
  // ids as a mix of ObjectIds (new docs) and legacy string slugs (seed data).
  // String(ObjectId) === ObjectId.toHexString(), which is what the lookup map
  // uses as a key — verify both flavors resolve, the original ordering is
  // preserved, and ids with no slug are silently dropped.
  const objId1 = new mongoose.Types.ObjectId();
  const objId2 = new mongoose.Types.ObjectId();
  const objIdMissing = new mongoose.Types.ObjectId();
  const slugsById = new Map<string, string>([
    [objId1.toHexString(), 'pop'],
    [objId2.toHexString(), 'rock'],
    ['genre-jazz', 'jazz'],
  ]);
  const out = mapGenreIdsToSlugs(
    [objId1, 'genre-jazz', objIdMissing, objId2, 'genre-unknown'],
    slugsById,
  );
  assert.deepEqual(out, ['pop', 'jazz', 'rock']);
});

test('mapGenreIdsToSlugs piped through computeGenresSitemapUrls yields the live route URL set', () => {
  // End-to-end-ish check that the manifest → slug → URL pipeline produces
  // exactly what the live /sitemap-genres-{lang}.xml route would emit.
  const objId = new mongoose.Types.ObjectId();
  const slugsById = new Map<string, string>([
    [objId.toHexString(), 'pop'],
    ['genre-jazz', 'jazz'],
  ]);
  const slugs = mapGenreIdsToSlugs([objId, 'genre-jazz'], slugsById);
  const urls = computeGenresSitemapUrls({
    language: 'en',
    genreSlugs: slugs,
    translations: new Map(),
    baseUrl: 'https://example.com',
  });
  assert.deepEqual(urls, [
    'https://example.com/en/genres/jazz',
    'https://example.com/en/genres/pop',
  ]);
});
