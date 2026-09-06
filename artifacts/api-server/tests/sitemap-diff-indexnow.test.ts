/**
 * Task #190 — unit coverage for the sitemap-diff IndexNow helpers.
 *
 * Pure-function tests for the diff + URL-builder logic so a regression in
 * the canonical URL shape (or a botched diff) trips this guard before the
 * nightly job ships duplicate or empty IndexNow submissions.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
const newId=()=>randomBytes(12).toString('hex');
import {
  diffUrlSets,
  computeMainSitemapUrls,
  computeGenresSitemapUrls,
  computeStationsSitemapUrlsForChunk,
  isSafeGenreSlug,
  mapGenreIdsToSlugs,
  type StationSitemapDoc,
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

  // 16 static pages + 27 A-Z station index pages (Task #11, 2026-07-03)
  // + 2 top-country region pages = 45.
  assert.equal(urls.length, 45);
  assert.ok(urls.includes('https://example.com/en'));
  assert.ok(urls.includes('https://example.com/en/regions/europe/germany'));
  assert.ok(urls.includes('https://example.com/en/regions/asia/japan'));
  assert.ok(urls.includes('https://example.com/en/faq'));
  assert.ok(urls.includes('https://example.com/en/stations/a'));
  assert.ok(urls.includes('https://example.com/en/stations/0-9'));

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

test('mapGenreIdsToSlugs resolves 24-hex and legacy slug IDs in order, dropping unknowns', () => {
  // PostgreSQL preserves imported 24-hex identifiers and legacy seed slugs
  // as strings. Both forms must resolve while retaining manifest order.
  const objId1 = newId();
  const objId2 = newId();
  const objIdMissing = newId();
  const slugsById = new Map<string, string>([
    [objId1, 'pop'],
    [objId2, 'rock'],
    ['genre-jazz', 'jazz'],
  ]);
  const out = mapGenreIdsToSlugs(
    [objId1, 'genre-jazz', objIdMissing, objId2, 'genre-unknown'],
    slugsById,
  );
  assert.deepEqual(out, ['pop', 'jazz', 'rock']);
});

test('computeStationsSitemapUrlsForChunk emits one URL per indexable, non-junk station with a slug', () => {
  // Task #339 — mirrors the live `/sitemap-stations-{lang}-{chunk}.xml` filter
  // (see routes/seo-sitemap-routes.ts): junk/noIndex stations are dropped,
  // stations missing a slug are dropped, and the order is sorted for
  // deterministic snapshot comparisons.
  const id1 = newId();
  const id2 = newId();
  const id3 = newId();
  const idJunk = newId();
  const idNoIndex = newId();
  const idMissing = newId();
  const idNoSlug = newId();

  const goodStation = (slug: string, name: string): StationSitemapDoc => ({
    _id: newId(),
    slug,
    name,
    url: 'https://stream.example/listen.mp3',
    homepage: 'https://example.com',
    tags: 'pop,rock',
    bitrate: 192,
    lastCheckOk: true,
    lastCheckOkTime: new Date(),
    country: 'Germany',
    countryCode: 'DE',
    language: 'german',
    languageCodes: 'de',
    noIndex: false,
  });

  const stationsById = new Map<string, StationSitemapDoc>([
    [String(id1), { ...goodStation('alpha-fm', 'Alpha FM'), _id: id1 }],
    [String(id2), { ...goodStation('bravo-radio', 'Bravo Radio'), _id: id2 }],
    [String(id3), { ...goodStation('charlie-am', 'Charlie AM'), _id: id3 }],
    // noIndex=true → indexable returns []
    [String(idNoIndex), { ...goodStation('delta-fm', 'Delta FM'), _id: idNoIndex, noIndex: true }],
    // missing slug
    [String(idNoSlug), { ...goodStation('placeholder', 'No Slug'), _id: idNoSlug, slug: undefined }],
    // junk station: stream dead 31 days (lastCheckOk=false + lastCheckOkTime
    // older than 30d) trips evaluateJunkStation's stream-dead-30d rule.
    [String(idJunk), {
      ...goodStation('echo-fm', 'Echo FM'),
      _id: idJunk,
      lastCheckOk: false,
      lastCheckOkTime: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
    }],
    // idMissing intentionally absent → silently dropped
  ]);

  const urls = computeStationsSitemapUrlsForChunk({
    language: 'de',
    qualifiedLanguages: ['de', 'en'],
    stationIds: [id1, idNoIndex, id2, idJunk, idMissing, idNoSlug, id3],
    stationsById,
    translations: new Map(),
    baseUrl: 'https://example.com',
  });

  assert.deepEqual(urls, [
    'https://example.com/de/sender/alpha-fm',
    'https://example.com/de/sender/bravo-radio',
    'https://example.com/de/sender/charlie-am',
  ]);
});

test('computeStationsSitemapUrlsForChunk + diffUrlSets surfaces newly-whitelisted station', () => {
  const id1 = newId();
  const id2 = newId();
  const mk = (slug: string): StationSitemapDoc => ({
    _id: newId(),
    slug,
    name: slug,
    url: 'https://stream.example/listen.mp3',
    tags: 'pop',
    bitrate: 128,
    lastCheckOk: true,
    lastCheckOkTime: new Date(),
    country: 'Germany',
    countryCode: 'DE',
    language: 'german',
    languageCodes: 'de',
  });
  const stationsById = new Map<string, StationSitemapDoc>([
    [String(id1), { ...mk('alpha-fm'), _id: id1 }],
    [String(id2), { ...mk('bravo-radio'), _id: id2 }],
  ]);
  const previousUrls = computeStationsSitemapUrlsForChunk({
    language: 'de',
    qualifiedLanguages: ['de'],
    stationIds: [id1],
    stationsById,
    translations: new Map(),
    baseUrl: 'https://example.com',
  });
  const currentUrls = computeStationsSitemapUrlsForChunk({
    language: 'de',
    qualifiedLanguages: ['de'],
    stationIds: [id1, id2],
    stationsById,
    translations: new Map(),
    baseUrl: 'https://example.com',
  });
  const additions = diffUrlSets(previousUrls, currentUrls);
  assert.deepEqual(additions, ['https://example.com/de/sender/bravo-radio']);
});

test('mapGenreIdsToSlugs piped through computeGenresSitemapUrls yields the live route URL set', () => {
  // End-to-end-ish check that the manifest → slug → URL pipeline produces
  // exactly what the live /sitemap-genres-{lang}.xml route would emit.
  const objId = newId();
  const slugsById = new Map<string, string>([
    [objId, 'pop'],
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
