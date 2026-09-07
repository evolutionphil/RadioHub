import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateLanguageUrls, ACTIVE_SITEMAP_LANGUAGES } from '@workspace/seo-shared/seo-config';

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
