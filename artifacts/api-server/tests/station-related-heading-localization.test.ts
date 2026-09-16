import assert from 'node:assert/strict';
import { before, mock, test } from 'node:test';
import { ACTIVE_SITEMAP_LANGUAGES } from '@workspace/seo-shared/seo-config';
import { getStationRelatedHeading } from '@workspace/seo-shared/station-page-copy';

// Exercise real SSR markup without starting the database or background cache.
mock.module(new URL('../src/performance-cache.ts', import.meta.url).href, {
  namedExports: {
    performanceCache: {
      getTranslations: () => null, setTranslations: () => {},
      getPageData: () => null, setPageData: () => {},
      getUrlTranslations: async () => new Map(),
      getStats: () => ({ hits: 0, misses: 0 }),
    },
    PerformanceCache: class {}, deepFreeze: <T,>(value: T) => value,
  },
});

let renderer: { generateHtmlBody(input: any): string };
before(async () => {
  const { SeoRenderer } = await import('../src/seo-renderer');
  renderer = new SeoRenderer();
});

function stationBody(language: string, translations: Record<string, string> = {}, crossLinks: Record<string, unknown> = {}) {
  return renderer.generateHtmlBody({
    pageType: 'station', language, translations,
    stationData: { name: 'Example Radio', slug: 'example-radio', country: 'Germany', descriptions: {} },
    urlTranslations: new Map([[`${language}:station`, language === 'de' ? 'sender' : 'station']]),
    additionalData: { crossLinks: {
      sameCountry: [{ name: 'Country & Radio', slug: 'country-radio' }],
      sameCity: [{ name: 'City Radio', slug: 'city-radio' }],
      countryName: 'Germany', cityName: 'Hamburg', ...crossLinks,
    } },
  });
}

function section(body: string, kind: 'country' | 'city') {
  return body.match(new RegExp(`<section class="related-stations related-stations--${kind}">([\\s\\S]*?)</section>`))?.[1] || '';
}

for (const language of ACTIVE_SITEMAP_LANGUAGES) {
  test(`${language}: all country/city headings have localized fallback text`, () => {
    for (const kind of ['country', 'city'] as const) {
      for (const location of ['Test Location', '']) {
        const heading = getStationRelatedHeading(language, kind, location);
        assert.ok(heading.trim());
        assert.doesNotMatch(heading, /\{location\}|similar_in_country|stations_in_city/);
        if (location) assert.ok(heading.includes(location));
        if (language !== 'en') assert.notEqual(heading, getStationRelatedHeading('en', kind, location));
      }
    }
  });
}

for (const fixture of [
  { language: 'en', country: 'More radio stations from Germany', city: 'Radio stations in Hamburg' },
  { language: 'de', country: 'Weitere Radiosender aus Deutschland', city: 'Radiosender in Hamburg' },
  { language: 'tr', country: 'Almanya ülkesindeki diğer radyo istasyonları', city: 'Hamburg şehrindeki radyo istasyonları' },
]) {
  test(`${fixture.language}: actual station SSR localizes related headings and preserves crawlable links`, () => {
    const body = stationBody(fixture.language);
    assert.ok(section(body, 'country').includes(`<h2>${fixture.country}</h2>`));
    assert.ok(section(body, 'city').includes(`<h2>${fixture.city}</h2>`));
    const segment = fixture.language === 'de' ? 'sender' : 'station';
    assert.ok(section(body, 'country').includes(`href="/${fixture.language}/${segment}/country-radio">Country &amp; Radio</a>`));
    assert.ok(section(body, 'city').includes(`href="/${fixture.language}/${segment}/city-radio">City Radio</a>`));
    assert.equal((body.match(/<h1\b/g) || []).length, 1);
  });
}

test('default locale stays English and locale variants use the base-language fallback', () => {
  for (const language of ['', 'unknown', 'en-US']) {
    assert.equal(getStationRelatedHeading(language, 'country', 'Germany'), 'More radio stations from Germany');
    assert.equal(getStationRelatedHeading(language, 'city', ''), 'Nearby stations');
  }
  assert.equal(getStationRelatedHeading(' DE_at ', 'country', 'Deutschland'), 'Weitere Radiosender aus Deutschland');
  assert.equal(getStationRelatedHeading('tr-TR', 'city', 'Ankara'), 'Ankara şehrindeki radyo istasyonları');
});

test('English seeds, missing-key echoes and blanks do not replace a localized fallback', () => {
  const seeds = {
    similar_in_country: 'More radio stations from', stations_in_city: 'Radio stations in',
    similar_stations: 'Similar stations', nearby_stations: 'Nearby stations',
  };
  for (const language of ['de', 'tr']) {
    for (const kind of ['country', 'city'] as const) {
      for (const location of ['Test Location', '']) {
        const fallback = getStationRelatedHeading(language, kind, location);
        assert.equal(getStationRelatedHeading(language, kind, location, seeds), fallback);
        assert.equal(getStationRelatedHeading(language, kind, location, Object.fromEntries(Object.keys(seeds).map(key => [key, key]))), fallback);
        assert.equal(getStationRelatedHeading(language, kind, location, Object.fromEntries(Object.keys(seeds).map(key => [key, '  ']))), fallback);
      }
    }
    const body = stationBody(language, seeds);
    assert.doesNotMatch(section(body, 'country') + section(body, 'city'), /More radio stations from|Radio stations in/);
  }
  assert.equal(getStationRelatedHeading('de', 'city', 'Hamburg', { stations_in_city: 'Radio stations in {location}' }), 'Radiosender in Hamburg');
});

test('localized database prefixes and location templates remain honored and are escaped once', () => {
  assert.equal(getStationRelatedHeading('de', 'country', 'Deutschland', { similar_in_country: '  Sender aus  ' }), 'Sender aus Deutschland');
  assert.equal(getStationRelatedHeading('tr', 'city', 'Ankara', { stations_in_city: '{location} radyoları' }), 'Ankara radyoları');
  assert.equal(getStationRelatedHeading('en', 'city', '$& Town'), 'Radio stations in $& Town');
  assert.equal(getStationRelatedHeading('de', 'city', '$& Stadt', { stations_in_city: 'Sender in {location}' }), 'Sender in $& Stadt');
  assert.equal(getStationRelatedHeading('de', 'country', '', { similar_stations: 'Weitere Empfehlungen' }), 'Weitere Empfehlungen');
  const body = stationBody('de', { stations_in_city: 'Sender & Musik in {location}' }, { cityName: '<script>alert("x")</script> & Hamburg' });
  assert.ok(section(body, 'city').includes('Sender &amp; Musik in &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; Hamburg'));
  assert.doesNotMatch(section(body, 'city'), /<script>|&amp;amp;|&amp;lt;/);
});

test('missing location names use localized generic headings and empty related lists stay absent', () => {
  const body = stationBody('de', {}, { countryName: '', cityName: '' });
  assert.ok(section(body, 'country').includes('<h2>Ähnliche Sender</h2>'));
  assert.ok(section(body, 'city').includes('<h2>Sender in der Nähe</h2>'));
  const empty = stationBody('tr', {}, { sameCountry: [], sameCity: [] });
  assert.equal(section(empty, 'country'), '');
  assert.equal(section(empty, 'city'), '');
});
