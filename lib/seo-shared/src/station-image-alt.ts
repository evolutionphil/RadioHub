import { LOCALIZED_LOGO_WORD } from './seo-config';

/** Shared by SSR and cards; translation content is text, never JavaScript. */
export function getStationImageAlt(
  station: { name?: unknown; country?: unknown; genre?: unknown },
  language: string,
  translate: (key: string, fallback: string) => string,
): string {
  const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
  const params: Record<string, string> = {
    name: text(station.name) || 'Radio Station',
    country: text(station.country),
    genre: text(station.genre) || 'radio',
  };
  const fallback = `${params.name} ${LOCALIZED_LOGO_WORD[language] || 'logo'}${params.country ? ` — ${params.country}` : ''}`;
  const key = params.country ? 'seo_station_logo_alt_with_country' : 'seo_station_logo_alt';
  // Fetch the template before interpolation so malformed legacy `${...}`
  // defaults cannot turn into literal JS fragments (or a stray `$` prefix).
  const template = translate(key, fallback);
  const placeholders = /\{(name|country|genre)\}/gi;
  if (typeof template !== 'string' || !template.trim() || template.includes('${')) {
    return fallback;
  }
  // Function replacement preserves literal `$&`/`$'` in station names.
  return template.replace(placeholders, (_match, key: string) => params[key.toLowerCase()]);
}
