/**
 * Quality-core station eligibility (2026-07-01).
 *
 * Locks down the CONTENT-DRIVEN indexability contract introduced to fight the
 * "Crawled – currently not indexed" backlog: a non-junk station is no longer
 * seeded as indexable in all 14 universal languages unconditionally. Instead:
 *
 *   - English is ALWAYS eligible (primary index target + the /en canonical the
 *     lang-ineligibility middleware redirects every non-universal variant to).
 *   - The station's native country / broadcast language stays eligible.
 *   - Any other universal language is eligible ONLY where the station has a
 *     real full+meta description for it (description-fill output).
 *
 * These are pure functions — no DB, no module mocks required.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getEligibleLanguages,
  getIndexableLanguagesForStation,
} from '../src/seo/junk-station-rules';

const UNIVERSAL_14 = ['en', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'ar', 'zh', 'tr', 'ja', 'ko', 'hi', 'he'];

test('thin GB station (no descriptions, no diaspora extras) is eligible ONLY in English', () => {
  // GB has COUNTRY_EXTRA_LANGUAGES['gb'] === [] and native language English,
  // so it isolates the seed change cleanly (no diaspora langs to add).
  const station = {
    name: 'Classical 95.9 WCRI',
    slug: 'classical-95-9-wcri',
    url: 'https://stream.example/listen.mp3',
    countryCode: 'GB',
    languageCodes: 'en',
    descriptions: null,
  };
  const eligible = getEligibleLanguages(station);
  assert.deepEqual(eligible.sort(), ['en']);
  // No Spanish/French/etc. thin pages minted for a content-less station —
  // this is the whole point of the quality-core seed change.
  for (const lang of ['es', 'fr', 'de', 'tr', 'ar', 'zh']) {
    assert.ok(!eligible.includes(lang), `must NOT be eligible in ${lang}`);
  }
});

test('native-language station stays eligible in its own language without a description', () => {
  // Austria: native language German, no diaspora extras (at: []).
  const station = {
    name: 'Radio Wien',
    slug: 'radio-wien',
    url: 'https://stream.example/listen.mp3',
    countryCode: 'AT',
    languageCodes: 'de',
    descriptions: null,
  };
  const eligible = getEligibleLanguages(station);
  // English (always) + German (native country + broadcast). Nothing else.
  assert.deepEqual(eligible.sort(), ['de', 'en']);
});

test('enriched station lights up every language it has a real full+meta description for', () => {
  const desc = (n: string) => ({ full: `${n} full description long enough`, meta: `${n} meta` });
  const station = {
    name: 'Kronehit',
    slug: 'kronehit',
    url: 'https://stream.example/listen.mp3',
    countryCode: 'AT', // Austria → de
    languageCodes: 'de',
    descriptions: {
      de: desc('de'),
      en: desc('en'),
      es: desc('es'),
      fr: desc('fr'),
    },
  };
  const eligible = getEligibleLanguages(station).sort();
  // en (seed) + de (native) + de/en/es/fr (descriptions) = en, de, es, fr.
  assert.deepEqual(eligible, ['de', 'en', 'es', 'fr']);
});

test('a description with an empty full or meta does NOT make a language eligible', () => {
  const station = {
    name: 'Half Filled',
    slug: 'half-filled',
    url: 'https://stream.example/listen.mp3',
    countryCode: 'GB', // no diaspora extras → isolates the description gate
    languageCodes: 'en',
    descriptions: {
      es: { full: 'has full but no meta', meta: '' },
      fr: { full: '', meta: 'has meta but no full' },
    },
  };
  const eligible = getEligibleLanguages(station);
  assert.deepEqual(eligible.sort(), ['en']);
});

test('getIndexableLanguagesForStation intersects eligibility with qualified langs', () => {
  const station = {
    name: 'Radio España',
    slug: 'radio-espana',
    url: 'https://stream.example/listen.mp3',
    countryCode: 'ES', // → es
    languageCodes: 'es',
    descriptions: null,
  };
  // eligible = en + es. Qualified only has en → indexable is en only.
  assert.deepEqual(
    getIndexableLanguagesForStation(station, ['en']).sort(),
    ['en'],
  );
  // Qualified has both → indexable is en + es.
  assert.deepEqual(
    getIndexableLanguagesForStation(station, ['en', 'es']).sort(),
    ['en', 'es'],
  );
});

test('no station is ever eligible OUTSIDE the 14 universal languages after qualified intersection', () => {
  // A Greek station: cc GR → el (non-universal). el is never in qualifiedLangs
  // (qualifiedLangs ⊆ universal14), so it must be filtered out.
  const station = {
    name: 'Athens FM',
    slug: 'athens-fm',
    url: 'https://stream.example/listen.mp3',
    countryCode: 'GR',
    languageCodes: 'el',
    descriptions: null,
  };
  const indexable = getIndexableLanguagesForStation(station, UNIVERSAL_14);
  assert.deepEqual(indexable.sort(), ['en']);
  assert.ok(!indexable.includes('el'), 'el (non-universal) must never be indexable');
});
