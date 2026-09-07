import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ACTIVE_SITEMAP_LANGUAGES } from '@workspace/seo-shared/seo-config';
import { getSchemaCountry, generateOrganizationSchema, generateWebSiteSchema, generateDeveloperOrganizationSchema } from '@workspace/seo-shared/structured-data';
import { getStationPageCopy } from '@workspace/seo-shared/station-page-copy';

for (const code of ACTIVE_SITEMAP_LANGUAGES) {
  test(`${code}: schema country follows ISO source and never invents an Unknown country`, () => {
    const actual = getSchemaCountry({country:'The United States Of America',countryCode:'US'},code);
    assert.equal(actual?.name,new Intl.DisplayNames([code],{type:'region'}).of('US'));
    assert.equal(actual?.code,'US');
    assert.equal(getSchemaCountry({country:'Unknown',countryCode:'ZZ'},code),undefined);
    assert.equal(getSchemaCountry({},code),undefined);
  });
  test(`${code}: station SSR auxiliary prose has a same-language fallback`, () => {
    const copy = getStationPageCopy(code);
    assert.match(copy.intro, /\{station_name\}/);
    assert.doesNotMatch(copy.outro, /24\/7/);
    for (const value of Object.values(copy)) assert.ok(value.trim());
    if (code !== 'en') {
      assert.notEqual(copy.about, getStationPageCopy('en').about);
      assert.notEqual(copy.information, getStationPageCopy('en').information);
      assert.notEqual(copy.intro, getStationPageCopy('en').intro);
    }
  });
  test(`${code}: global schema prose is localized even without database translation rows`, () => {
    const org = generateOrganizationSchema('themegaradio.com', code);
    const website = generateWebSiteSchema('themegaradio.com', code);
    const developer = generateDeveloperOrganizationSchema(code);
    assert.equal(org['@id'], 'https://themegaradio.com/#organization');
    assert.equal(org.name, 'Mega Radio');
    assert.equal(org.alternateName, 'MegaRadio');
    assert.equal(developer.name, 'Vision GO');
    assert.equal(developer['@id'], 'https://visiongo.at/#organization');
    assert.equal(website.inLanguage, code);
    assert.equal(website.potentialAction.target.urlTemplate, `https://themegaradio.com/${code}/search?q={search_term_string}`);
    assert.deepEqual(org.contactPoint.availableLanguage, [...ACTIVE_SITEMAP_LANGUAGES]);
    assert.equal(org.address.addressCountry, 'AT');
    assert.equal(org.address.streetAddress, 'Bäckerstraße 7');
    assert.equal(org.inLanguage, undefined); // Not a schema.org Organization property.
    assert.equal(org.logo.width, 194);
    assert.equal(org.logo.height, 180);
    assert.ok(org.description.length > 25);
    assert.equal(website.description, org.description);
    if (code !== 'en') {
      assert.notEqual(org.description, generateOrganizationSchema('themegaradio.com','en').description);
      assert.notEqual(developer.description, generateDeveloperOrganizationSchema('en').description);
      assert.doesNotMatch(JSON.stringify([org, website, developer]), /Free Online Radio|Customer [Ss]ervice|Vienna-based/);
    }
  });
}

test('Turkish values remain Turkish and same-locale admin descriptions are preserved', () => {
  const station = getStationPageCopy('tr', {station_about_station:'İstasyon hakkında özel başlık',default_station_about:'{station_name} dinle.'});
  assert.equal(station.about, 'İstasyon hakkında özel başlık');
  assert.equal(station.intro.replace(/\{STATION(?:_NAME)?\}/gi,'KRAL FM'), 'KRAL FM dinle.');
  const org = generateOrganizationSchema('themegaradio.com', 'tr', {faq_seo_intro:'Türkçe özel kuruluş açıklaması'});
  assert.equal(org.description, 'Türkçe özel kuruluş açıklaması');
  assert.equal(org.contactPoint.contactType, 'Müşteri hizmetleri');
  assert.equal(org.address.addressLocality, 'Viyana');
  assert.match(generateDeveloperOrganizationSchema('tr').description, /yazılım stüdyosu/);
  assert.equal(generateDeveloperOrganizationSchema('de-AT').address.addressLocality, 'Wien');
});

test('server HTML and client page-data use the same global schema builders', () => {
  const source = readFileSync(new URL('../src/seo-renderer.ts', import.meta.url), 'utf8');
  assert.match(source, /generateOrganizationSchema\(schemaDomain, language, translations\)/);
  assert.match(source, /generateWebSiteSchema\(schemaDomain, language, translations\)/);
  assert.match(source, /generateDeveloperOrganizationSchema\(language\)/);
  assert.doesNotMatch(source, /Vienna-based software studio|"alternateName": "Mega Radio - Free Online Radio"/);
});
