import { afterEach, expect, it } from 'vitest';
import { syncDocumentLocale } from '../src/lib/document-locale';
import { ACTIVE_SITEMAP_LANGUAGES } from '@workspace/seo-shared/seo-config';

afterEach(() => { document.documentElement.removeAttribute('lang'); document.documentElement.removeAttribute('dir'); });

it('updates both document language and direction through en/ar/de/he and back to en', () => {
  // Simulate an SSR Arabic document; subsequent switches must not inherit it.
  document.documentElement.lang = 'ar';
  document.documentElement.dir = 'rtl';
  const root = document.documentElement;
  for (const [language, direction] of [['en', 'ltr'], ['ar', 'rtl'], ['de', 'ltr'], ['he', 'rtl'], ['en', 'ltr']]) {
    syncDocumentLocale(language);
    expect(document.documentElement).toBe(root);
    expect(root.lang).toBe(language);
    expect(root.dir).toBe(direction);
  }
});

it.each(ACTIVE_SITEMAP_LANGUAGES)('matches SSR writing direction for %s', language => {
  syncDocumentLocale(language);
  expect(document.documentElement.lang).toBe(language);
  expect(document.documentElement.dir).toBe(language === 'ar' || language === 'he' ? 'rtl' : 'ltr');
});
