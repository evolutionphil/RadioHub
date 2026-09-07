import { CODE_TO_COUNTRY, getCountryCodeFromName } from '@workspace/seo-shared/seo-config';

/** Display-only localization; leave API filters and unknown country names intact. */
export function getLocalizedCountryDisplayName(country: string, language: string): string {
  const code = getCountryCodeFromName(country) ||
    Object.entries(CODE_TO_COUNTRY).find(([, name]) => name === country)?.[0] ||
    (/^[a-z]{2}$/i.test(country) ? country : null);
  if (!code) return country;
  try {
    return new Intl.DisplayNames([language], { type: 'region', fallback: 'none' }).of(code.toUpperCase()) || country;
  } catch { return country; }
}
