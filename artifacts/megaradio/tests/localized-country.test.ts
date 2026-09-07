import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLocalizedCountryDisplayName } from '../src/utils/localized-country';

afterEach(() => vi.restoreAllMocks());

describe('lightweight display-only country localization', () => {
  it.each([['de', 'Österreich'], ['tr', 'Avusturya'], ['ar', 'النمسا'], ['en', 'Austria']])('localizes Austria for %s', (language, expected) => {
    expect(getLocalizedCountryDisplayName('Austria', language)).toBe(expected);
    expect(getLocalizedCountryDisplayName('AT', language)).toBe(expected);
  });
  it('does not mislabel unknown countries from their first two letters and safely handles invalid locales', () => {
    expect(getLocalizedCountryDisplayName('Atlantis', 'de')).toBe('Atlantis');
    expect(getLocalizedCountryDisplayName('Austria', 'bad_locale')).toBe('Austria');
  });
  it('constructs one formatter for repeated country cards in the same locale', () => {
    const Original = Intl.DisplayNames;
    const constructor = vi.spyOn(Intl, 'DisplayNames').mockImplementation(function(locales, options) {
      return new Original(locales, options);
    });
    expect(getLocalizedCountryDisplayName('Austria', 'fr')).toBe('Autriche');
    expect(getLocalizedCountryDisplayName('AT', 'fr')).toBe('Autriche');
    expect(getLocalizedCountryDisplayName('Germany', 'fr')).toBe('Allemagne');
    expect(constructor).toHaveBeenCalledTimes(1);
    expect(getLocalizedCountryDisplayName('Atlantis', 'fr')).toBe('Atlantis');
    expect(constructor).toHaveBeenCalledTimes(1);
  });
  it('bounds formatter retention and keeps invalid-language/country fallbacks unchanged', () => {
    const Original = Intl.DisplayNames;
    const constructor = vi.spyOn(Intl, 'DisplayNames').mockImplementation(function(locales, options) {
      return new Original(locales, options);
    });
    for (let i = 0; i < 65; i++) expect(getLocalizedCountryDisplayName('AT', `de-x-cache-${i}`)).toBe('Österreich');
    expect(constructor).toHaveBeenCalledTimes(65);
    expect(getLocalizedCountryDisplayName('AT', 'de-x-cache-0')).toBe('Österreich');
    expect(constructor).toHaveBeenCalledTimes(66);
    expect(getLocalizedCountryDisplayName('Austria', 'bad_locale')).toBe('Austria');
    expect(getLocalizedCountryDisplayName('?', 'de')).toBe('?');
    expect(getLocalizedCountryDisplayName('', 'de')).toBe('');
  });
});
