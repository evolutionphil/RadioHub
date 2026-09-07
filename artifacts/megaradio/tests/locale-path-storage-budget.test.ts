import { afterEach, expect, it, vi } from 'vitest';
import { getLanguageFromPath, ACTIVE_SITEMAP_LANGUAGES } from '@workspace/seo-shared/seo-config';

afterEach(() => vi.restoreAllMocks());
it('parses every public locale repeatedly without synchronous storage reads', () => {
  const storage = vi.spyOn(Storage.prototype, 'getItem');
  for (let repeat = 0; repeat < 100; repeat++) {
    for (const language of ACTIVE_SITEMAP_LANGUAGES) {
      expect(getLanguageFromPath(`/${language}`).language).toBe(language);
      expect(getLanguageFromPath(`/${language}/station/kral-fm`).language).toBe(language);
    }
  }
  expect(storage).not.toHaveBeenCalled();
});
it('preserves saved preference for an untranslated legacy country alias', () => {
  const storage = vi.spyOn(Storage.prototype, 'getItem').mockReturnValue('tr');
  expect(getLanguageFromPath('/at').language).toBe('tr');
  expect(storage).toHaveBeenCalledWith('preferredLanguage');
});
