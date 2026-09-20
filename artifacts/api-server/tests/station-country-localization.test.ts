import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateLocalizedStationTitle, generateSeoTags, getLocalizedStationDescription,
  getNativeCountryName, getStationMetaDescription } from '@workspace/seo-shared/seo-config';

const station = { name: 'KISS 98.1', slug: 'kiss-98-1', country: 'The United States Of America', countryCode: 'US' };

for (const [language, country, segment] of [['de', 'Vereinigte Staaten', 'sender'], ['tr', 'Amerika Birleşik Devletleri', 'istasyon']]) {
  test(`${language}: station titles and generated descriptions localize the ISO country without rewriting source or URLs`, () => {
    const before = structuredClone(station);
    const path = `/${language}/${segment}/${station.slug}`;
    const tags = generateSeoTags('station', language, {}, `/station/${station.slug}`, 'https://themegaradio.com', station, path, path);
    for (const title of [tags.title, tags.ogTitle, tags.twitterTitle]) {
      assert.ok(title?.includes(country));
      assert.ok(!title.includes(station.country));
    }
    assert.ok(getLocalizedStationDescription(station, language, {}).includes(country));
    assert.ok(getStationMetaDescription(station, language, {}).includes(country));
    assert.equal(tags.canonical, `https://themegaradio.com${path}`);
    assert.deepEqual(station, before);
  });
}

test('English source wording, invalid ISO fallbacks and stored editorial content stay unchanged', () => {
  assert.equal(getNativeCountryName(station.country, 'en', 'US'), station.country);
  assert.ok(generateLocalizedStationTitle(station, 'en', {}).includes(station.country));
  assert.equal(getNativeCountryName(station.country, 'de', ' us '), 'Vereinigte Staaten');
  for (const code of ['', 'USA', 'ZZ', 'XX', '12', null]) {
    assert.equal(getNativeCountryName('Germany', 'tr', code), 'Almanya');
  }
  const editorial = { ...station, descriptions: { de: { full: 'Freigegebener redaktioneller Text.', meta: 'Freigegebene Beschreibung.' } } };
  assert.equal(getLocalizedStationDescription(editorial, 'de', {}), editorial.descriptions.de.full);
  assert.equal(getStationMetaDescription(editorial, 'de', {}), editorial.descriptions.de.meta);
  assert.equal(generateLocalizedStationTitle(station, 'de', { 'radio_playing_page.title': 'Redaktioneller Titel' }), 'Redaktioneller Titel');
});
