import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateLanguageUrls, getLanguageFromPath, ACTIVE_SITEMAP_LANGUAGES } from '@workspace/seo-shared/seo-config';

const origin = 'https://themegaradio.com';
const languages = ACTIVE_SITEMAP_LANGUAGES;

for (const path of ['', '/station/bbc-radio-1', '/genres/pop', '/regions/europe']) {
  test(`all 14 SEO locales share the same alternate and x-default cluster: ${path || '/'}`, () => {
    assert.equal(languages.length, 14, 'the existing 14-language SEO scope must be preserved');
    const baseline = generateLanguageUrls(path, origin, 'en', undefined, undefined, languages);
    for (const language of languages) {
      const currentUrl = baseline.find((entry) => entry.lang === language)!.url;
      const actual = generateLanguageUrls(path, origin, language, undefined, currentUrl, languages);
      assert.deepEqual(actual, baseline, `alternate cluster differs on ${language}`);
      assert.equal(actual.find((entry) => entry.lang === language)?.url, currentUrl);
      assert.equal(actual.find((entry) => entry.lang === 'x-default')?.url,
        baseline.find((entry) => entry.lang === 'en')?.url);
    }
  });
}

test('x-default uses an existing qualified alternate when English is unavailable', () => {
  const allowed = ['de', 'tr'];
  const baseline = generateLanguageUrls('/station/bbc-radio-1', origin, 'de', undefined, undefined, allowed);
  const turkishUrl = baseline.find((entry) => entry.lang === 'tr')!.url;
  assert.deepEqual(generateLanguageUrls('/station/bbc-radio-1', origin, 'tr', undefined, turkishUrl, allowed), baseline);
  assert.equal(baseline.find((entry) => entry.lang === 'x-default')?.url, baseline[0].url);
  assert.equal(baseline.some((entry) => entry.lang === 'en'), false);
});

test('non-indexable pages do not advertise an alternate or fallback cluster', () => {
  assert.deepEqual(generateLanguageUrls('/station/test', origin, 'en', undefined, undefined, []), []);
});

test('real localized station paths reverse-translate into reciprocal singular detail alternates', () => {
  const baseline = generateLanguageUrls('/station/mangoradio', origin, 'en', undefined, undefined, languages);
  for (const language of languages) {
    const current = baseline.find(entry => entry.lang === language)!.url;
    const parsed = getLanguageFromPath(new URL(current).pathname);
    const actual = generateLanguageUrls(parsed.cleanPath, origin, language, undefined, current, languages);
    assert.deepEqual(actual, baseline, `${language}: localized singular/plural collision`);
  }
});

test('ambiguous station leaf normalization preserves opaque slugs and database route overrides', () => {
  const map = new Map([['de:station', 'mein-sender'], ['de:stations', 'sender-liste']]);
  for (const slug of ['station', 'profile', '1-21', 'a%3Fb%23c', encodeURIComponent('東京 ラジオ')]) {
    const actual = generateLanguageUrls(`/stations/${slug}`, origin, 'en', map, undefined, languages);
    assert.equal(actual.find(entry => entry.lang === 'en')?.url, `${origin}/en/station/${slug}`);
    assert.equal(actual.find(entry => entry.lang === 'de')?.url, `${origin}/de/mein-sender/${slug}`);
  }
});

test('station catalog hubs and A-Z leaves stay plural', () => {
  for (const path of ['/stations', '/stations/a', '/stations/Z', '/stations/0-9']) {
    const actual = generateLanguageUrls(path, origin, 'en', undefined, undefined, languages);
    assert.equal(actual.find(entry => entry.lang === 'en')?.url, origin + '/en' + path);
  }
});
