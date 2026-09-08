import assert from 'node:assert/strict';
import { before, mock, test } from 'node:test';
import { buildCountrySeo, buildRegionSeo } from '@workspace/seo-shared/region-seo-templates';
const languages = ['en','de','tr','es','fr','pt','it','ru','ar','zh','ja','ko','hi','he'];
mock.module(new URL('../src/performance-cache.ts', import.meta.url).href, { namedExports: {
  performanceCache: { getStats: () => ({ hits: 0, misses: 0 }) }, PerformanceCache: class {}, deepFreeze: <T,>(value: T) => value,
} });
mock.module(new URL('../src/seo/qualified-languages.ts', import.meta.url).href, { namedExports: {
  getCachedQualifiedLanguages: async () => languages,
  getCachedQualifiedLanguagesSync: () => languages,
  getQualifiedLanguagesState: async () => ({ languages, source: 'test' }),
  initializeQualifiedLanguages: async () => ({ languages, source: 'test' }),
  invalidateQualifiedLanguages: async () => {},
  EMERGENCY_SEED_QUALIFIED_LANGUAGES: languages,
  QualifiedLanguagesUnavailableError: class extends Error {},
} });
let renderer: any;
before(async () => { const { SeoRenderer } = await import('../src/seo-renderer'); renderer = new SeoRenderer(); });
for (const language of languages) for (const country of [false, true]) {
  test(`${language} ${country ? 'country' : 'continent'} social cards describe the actual detail page`, async () => {
    const path = country ? '/regions/europe/germany' : '/regions/europe';
    const data = country ? { country: 'germany' } : { region: 'europe' };
    const tags = await renderer.generateEnhancedSeoTags('regions', language, {}, path,
      'https://themegaradio.com', undefined, data, `/${language}${path}`, `/${language}${path}`, new Map());
    const expected = country ? buildCountrySeo('Germany', language, {}) : buildRegionSeo('Europe', language, {});
    for (const field of ['title', 'ogTitle', 'twitterTitle']) assert.equal(tags[field], expected.title, field);
    for (const field of ['description', 'ogDescription', 'twitterDescription']) assert.equal(tags[field], expected.description, field);
    assert.equal(tags.canonical, `https://themegaradio.com/${language}${path}`);
    assert.equal(tags.hreflangs.length, 15);
    assert.ok(tags.hreflangs.some((row: any) => row.url === tags.canonical));
  });
}
