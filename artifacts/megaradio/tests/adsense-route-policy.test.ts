import { afterEach, describe, expect, it } from 'vitest';
import { ACTIVE_SITEMAP_LANGUAGES } from '@workspace/seo-shared/seo-config';
import { setDatabaseUrlTranslations, URL_TRANSLATIONS } from '@workspace/seo-shared/url-translations';
import { getAdSensePageType, getAdvertisementLabel, isAdSensePage } from '../src/lib/adsense-runtime';

afterEach(() => setDatabaseUrlTranslations(new Map()));
describe.each(ACTIVE_SITEMAP_LANGUAGES)('%s advertising route policy', language => {
  const segment = (name: string) => URL_TRANSLATIONS[language]?.[name] || name;
  const localized = (path: string) => `/${language}/${path.split('/').map(segment).join('/')}`;
  it('allows only editorial/catalog route families and distinguishes station from directory', () => {
    expect(getAdSensePageType(`/${language}?country=Austria`)).toBe('home');
    expect(getAdSensePageType(localized('station/kral-fm'))).toBe('station');
    expect(getAdSensePageType(localized('stations/a'))).toBe('catalog');
    for (const path of ['stations','genres','genres/rock','radios','regions','regions/austria/vienna','regions/austria/vienna/stations']) {
      expect(getAdSensePageType(localized(path)), path).toBe('catalog');
    }
    // ar/zh static maps share the radios and stations prefix. Until their
    // existing database override supplies a distinct alias, this exact URL is
    // a station route in the shared router too; do not invent a country match.
    expect(getAdSensePageType(localized('radios/austria'))).toBe(segment('radios') === segment('stations') ? 'station' : 'catalog');
    expect(getAdvertisementLabel(language)).toBeTruthy();
    if (language !== 'en') expect(getAdvertisementLabel(language)).not.toBe('Advertisement');
  });
  it('denies all account/social/auth/payment/support/legal/error families in raw and translated URLs', () => {
    for (const path of ['profile','profile/favorites','profile/discover','profile/messages','profile/settings','users','users/listener',
      'messages','favorites','discover','recommendations','notifications','settings','login','signup','auth/login','admin','admin/advertisements',
      'admin-login','premium','premium/success','activate','activate/success','tv','checkout','payment','billing',
      'about','contact','feedback','privacy-policy','terms-and-conditions','pages/privacy-policy','404','500','error','unknown-page']) {
      expect(isAdSensePage(localized(path)), path).toBe(false);
      expect(isAdSensePage(`/${language}/${path}`), path).toBe(false);
    }
  });
});
it('honors the shared administrator-controlled reverse route map without allowing a private alias', () => {
  setDatabaseUrlTranslations(new Map([['de:station','hoeren-live'],['de:profile','hoererkonto']]));
  expect(getAdSensePageType('/de/hoeren-live/kral-fm')).toBe('station');
  expect(getAdSensePageType('/de/hoererkonto/favorites')).toBeNull();
});
it('fails closed for malformed, unknown-language, traversal and personal query destinations', () => {
  for (const path of ['https://themegaradio.com/de','//example.com/de','/xx/station/kral-fm','/de/station/%2Fprofile','/de/%ZZ',
    '/de/station/../profile','/de/station/%2e%2e/profile','/de/station/name/extra','/de?tab=favorites',
    '/de?tab=recently-played','/de?view=discover','/de?tab=recommendations','/de?view=messages','/de?tab=profile']) expect(getAdSensePageType(path), path).toBeNull();
  expect(getAdSensePageType('/')).toBe('home'); expect(getAdSensePageType('/station/kral-fm')).toBe('station');
  expect(getAdSensePageType('/de/istasyon/kral-fm')).toBe('station');
});
