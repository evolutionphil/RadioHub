import assert from 'node:assert/strict';
import { before, mock, test } from 'node:test';
import { LEGAL_CONTENT, LEGAL_LOCALES } from '@workspace/seo-shared/legal-content';
import { renderLegalPageHtml } from '@workspace/seo-shared/legal-content-html';

// Rendering legal text requires no app startup, database or background cache.
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

for (const language of LEGAL_LOCALES) {
  for (const pageType of ['privacy', 'terms'] as const) {
    test(`raw SSR ${language}/${pageType} serves the complete translated policy`, () => {
      const body = renderer.generateHtmlBody({
        pageType, language, translations: {}, cleanPath: `/${pageType === 'privacy' ? 'privacy-policy' : 'terms-and-conditions'}`,
      });
      assert.ok(body.includes(renderLegalPageHtml(pageType, language)));
      assert.equal((body.match(/<h1\b/g) || []).length, 1);
      assert.equal((body.match(/<section\b/g) || []).length, LEGAL_CONTENT[language][pageType].sections.length);
      assert.ok(body.includes(`lang="${language}"`));
      assert.ok(!body.includes('123 Radio Street'));
      assert.ok(!body.includes('Last updated:'));
      if (language !== 'en') assert.ok(!body.includes(LEGAL_CONTENT.en[pageType].sections[0].text!));
    });
  }
}
