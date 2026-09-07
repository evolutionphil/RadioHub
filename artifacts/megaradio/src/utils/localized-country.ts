import { CODE_TO_COUNTRY, getCountryCodeFromName } from '@workspace/seo-shared/seo-config';

const regionFormatters = new Map<string, Intl.DisplayNames>();
const MAX_REGION_FORMATTERS = 64;

/** Display-only localization; leave API filters and unknown country names intact. */
export function getLocalizedCountryDisplayName(country: string, language: string): string {
  const code = getCountryCodeFromName(country) ||
    Object.entries(CODE_TO_COUNTRY).find(([, name]) => name === country)?.[0] ||
    (/^[a-z]{2}$/i.test(country) ? country : null);
  if (!code) return country;
  try {
    let formatter = regionFormatters.get(language);
    if (!formatter) {
      formatter = new Intl.DisplayNames([language], { type: 'region', fallback: 'none' });
      if (regionFormatters.size >= MAX_REGION_FORMATTERS) regionFormatters.delete(regionFormatters.keys().next().value!);
      regionFormatters.set(language, formatter);
    }
    return formatter.of(code.toUpperCase()) || country;
  } catch { return country; }
}
