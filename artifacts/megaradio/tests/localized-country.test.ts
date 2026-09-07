import { describe, expect, it } from 'vitest';
import { getLocalizedCountryDisplayName } from '../src/utils/localized-country';

describe('lightweight display-only country localization', () => {
  it.each([['de', 'Österreich'], ['tr', 'Avusturya'], ['ar', 'النمسا'], ['en', 'Austria']])('localizes Austria for %s', (language, expected) => {
    expect(getLocalizedCountryDisplayName('Austria', language)).toBe(expected);
    expect(getLocalizedCountryDisplayName('AT', language)).toBe(expected);
  });
  it('does not mislabel unknown countries from their first two letters and safely handles invalid locales', () => {
    expect(getLocalizedCountryDisplayName('Atlantis', 'de')).toBe('Atlantis');
    expect(getLocalizedCountryDisplayName('Austria', 'bad_locale')).toBe('Austria');
  });
});
