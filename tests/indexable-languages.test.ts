/**
 * Unit tests for the unified indexability gate in
 * server/seo/junk-station-rules.ts.
 *
 * These are critical SEO invariants — if any of these assertions fail, Google
 * will re-start dumping per-station language variants into "Crawled - currently
 * not indexed".
 */
import assert from 'node:assert/strict';
import {
  getIndexableLanguagesForStation,
  isStationIndexableInLanguage,
  getEligibleLanguages,
} from '../server/seo/junk-station-rules';

// Guard against regressions of the strict contract: a noIndex:true station
// returns an empty indexable list — the sitemap, SSR, AND hreflang must all
// see zero indexable languages for it.
{
  const station = {
    name: 'Baba Radyo',
    slug: 'baba-radyo',
    url: 'http://example.com/stream',
    countryCode: 'tr',
    languageCodes: 'tr',
    noIndex: true,
  };
  assert.deepEqual(
    getIndexableLanguagesForStation(station),
    [],
    'noIndex:true station must produce an empty indexable-language list',
  );
  assert.equal(
    isStationIndexableInLanguage(station, 'en'),
    false,
    'noIndex station must not be indexable in English',
  );
  assert.equal(
    isStationIndexableInLanguage(station, 'tr'),
    false,
    'noIndex station must not be indexable in its own country language',
  );
}

// Junk heuristic (codec-suffix slug) must zero out the list even without an
// explicit noIndex flag — defence in depth against DB records that predate
// the nightly junk-cleanup cron.
{
  const station = {
    name: 'Some Station',
    slug: 'some-station-mp3',
    url: 'http://example.com/stream.mp3',
    countryCode: 'de',
    languageCodes: 'de',
  };
  assert.deepEqual(
    getIndexableLanguagesForStation(station),
    [],
    'codec-suffix junk slug must produce empty indexable list',
  );
}

// Empty-name is also junk (missing name fails evaluateJunkStation).
{
  const station = {
    name: '',
    slug: 'mystery',
    url: 'http://example.com/stream',
    countryCode: 'fr',
  };
  assert.deepEqual(
    getIndexableLanguagesForStation(station),
    [],
    'empty-name station must be treated as junk and produce []',
  );
}

// Turkish station → eligible = [en, tr, de] (tr country + tr diaspora in de +
// universal en). With no qualifiedLangs filter, all three come back.
{
  const station = {
    name: 'Baba Radyo',
    slug: 'baba-radyo',
    url: 'http://example.com/stream',
    countryCode: 'tr',
    languageCodes: 'tr',
  };
  const indexable = getIndexableLanguagesForStation(station);
  const set = new Set(indexable);
  assert.ok(set.has('en'), 'TR station must be indexable in en');
  assert.ok(set.has('tr'), 'TR station must be indexable in tr');
  assert.ok(set.has('de'), 'TR station must be indexable in de (diaspora)');
  assert.equal(
    set.has('ko'),
    false,
    'TR station must NOT be indexable in ko',
  );
  assert.equal(
    set.has('th'),
    false,
    'TR station must NOT be indexable in th',
  );

  // Sanity: eligibility helper should match.
  assert.deepEqual(
    new Set(getEligibleLanguages(station)),
    set,
    'With no qualifiedLangs filter, indexable == eligible',
  );
}

// qualifiedLangs arg intersects the eligibility set — pass a whitelist that
// lacks `tr` and verify tr is dropped even though the station is TR.
{
  const station = {
    name: 'Baba Radyo',
    slug: 'baba-radyo',
    url: 'http://example.com/stream',
    countryCode: 'tr',
    languageCodes: 'tr',
  };
  const qualified = ['en', 'de', 'fr']; // simulate tr translations incomplete
  const indexable = getIndexableLanguagesForStation(station, qualified);
  const set = new Set(indexable);
  assert.ok(set.has('en'), 'en survives intersection');
  assert.ok(set.has('de'), 'de survives intersection');
  assert.equal(
    set.has('tr'),
    false,
    'tr must be dropped when qualifiedLangs lacks it',
  );
  assert.equal(
    set.has('fr'),
    false,
    'fr is qualified but not eligible — must not appear',
  );
}

// Set semantics: passing a Set for qualifiedLangs must produce the same
// result as passing an array.
{
  const station = {
    name: 'KroneHit',
    slug: 'kronehit',
    url: 'http://example.com/stream',
    countryCode: 'at',
    languageCodes: 'de',
  };
  const arr = getIndexableLanguagesForStation(station, ['en', 'de', 'tr']);
  const set = getIndexableLanguagesForStation(station, new Set(['en', 'de', 'tr']));
  assert.deepEqual(
    new Set(arr),
    new Set(set),
    'Array and Set forms of qualifiedLangs must yield same indexable set',
  );
}

// Case-insensitivity: callers may pass mixed-case language codes or
// uppercase request-path prefixes.
{
  const station = {
    name: 'BBC Radio 1',
    slug: 'bbc-radio-1',
    url: 'http://example.com/stream',
    countryCode: 'gb',
    languageCodes: 'en',
  };
  assert.equal(
    isStationIndexableInLanguage(station, 'EN'),
    true,
    'uppercase lang must be accepted',
  );
  assert.equal(
    isStationIndexableInLanguage(station, 'En'),
    true,
    'mixed-case lang must be accepted',
  );
}

console.log('✅ indexable-languages tests passed');
