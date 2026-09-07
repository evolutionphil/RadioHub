import { describe, expect, it } from 'vitest';
import { getStationBroadcastLanguages, generateRadioStationSchema } from '@workspace/seo-shared/structured-data';
import { SITEMAP_PRIORITY_LANGUAGES } from '@workspace/seo-shared/seo-config';

describe('broadcast language schema uses actual station data', () => {
  it.each([
    [{ languageCodes: 'tr', language: 'english' }, 'tr'],
    [{ languagecodes: 'de-DE' }, 'de-DE'],
    [{ languageCodes: ['tr', 'de', 'tr'] }, ['tr', 'de']],
    [{ language: 'turkish' }, 'tr'],
    [{ language: 'Türkçe' }, 'tr'],
    [{ language: 'english, german' }, ['en', 'de']],
    [{ languageCodes: 'zh-hant,pt-br' }, ['zh-Hant', 'pt-BR']],
    [{ languageCodes: 'not a language', language: 'Turkish' }, 'tr'],
    [{ language: null, languageCodes: null }, undefined],
    [{ language: 'unknown' }, undefined],
    [{ language: 'xx, und, <script>x</script>' }, undefined],
    [{ languageCodes: { tr: true } }, undefined],
    [{ countryCode: 'TR', country: 'Türkiye' }, undefined],
  ])('normalizes %j without inventing a language', (station, expected) => {
    expect(getStationBroadcastLanguages(station)).toEqual(expected);
  });

  it('all 14 translated pages retain Turkish broadcasts and localized descriptions independently', () => {
    for (const language of SITEMAP_PRIORITY_LANGUAGES.universal14) {
      const schema = generateRadioStationSchema({ name: 'Test Radio', languageCodes: 'tr' }, 'themegaradio.com', language,
        `/${language}/station/test`, `${language}: Localized text`);
      expect(schema.inLanguage).toBe('tr');
      expect(schema.description).toBe(`${language}: Localized text`);
      const unknown = generateRadioStationSchema({ name: 'Unknown Radio' }, 'themegaradio.com', language,
        `/${language}/station/unknown`, `${language}: Localized text`);
      expect(unknown).not.toHaveProperty('inLanguage');
    }
  });
});
