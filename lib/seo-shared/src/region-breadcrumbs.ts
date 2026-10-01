import { URL_TRANSLATIONS } from './url-translations';
import { getLocalizedRegionName } from './region-name-translations';
import { getCountryCodeFromName } from './seo-config';
import { COUNTRY_TO_REGION_SLUG, countrySlug } from './country-regions';

const canonicalCountries = new Map(Object.keys(COUNTRY_TO_REGION_SLUG).map(name => [countrySlug(name), name]));
const countryDisplayNames = new Map<string, Intl.DisplayNames>();

function localizedCountryName(name: string, language: string): string {
  const code = getCountryCodeFromName(name)?.toUpperCase();
  if (!code || language === 'en') return name;
  try {
    let names = countryDisplayNames.get(language);
    if (!names) {
      names = new Intl.DisplayNames([language], { type: 'region', fallback: 'none' });
      countryDisplayNames.set(language, names);
    }
    return names.of(code) || name;
  } catch {
    return name;
  }
}

/** Region directory hierarchy shared by the app, SSR HTML and BreadcrumbList. */
export function buildRegionBreadcrumbItems({
  language,
  cleanPath,
  getLocalizedText,
  urlTranslations,
  lastItemName,
}: {
  language: string;
  cleanPath: string;
  getLocalizedText: (key: string, fallback: string) => string;
  urlTranslations?: ReadonlyMap<string, string>;
  lastItemName?: string;
}): Array<{ name: string; path: string }> | null {
  const segments = cleanPath.split(/[?#]/, 1)[0].split('/').filter(Boolean);
  if (segments[0] !== 'regions') return null;
  const lang = language || 'en';
  const routeSegment = (segment: string) => lang === 'en' ? segment
    : urlTranslations?.get(`${lang}:${segment}`) || URL_TRANSLATIONS[lang]?.[segment] || segment;
  const isStationList = segments.at(-1) === 'stations'
    && (segments.length === 4 || segments.length === 5);
  const locationSegments = isStationList ? segments.slice(0, -1) : segments;
  const items = [{ name: getLocalizedText('nav_home', 'Home'), path: `/${lang}` }];
  let path = `/${lang}`;

  locationSegments.forEach((segment, index) => {
    // Country and city slugs identify catalogue records and are not route words.
    path += `/${index === 0 ? routeSegment('regions') : segment}`;
    const isLast = index === locationSegments.length - 1;
    const title = segment.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
    const fallback = index === 1 ? getLocalizedRegionName(title, lang)
      : index === 2 ? localizedCountryName(canonicalCountries.get(segment) || title, lang)
      : title;
    items.push({
      name: isLast && lastItemName ? lastItemName : getLocalizedText(`nav_${segment}`, fallback),
      // There is no standalone city route: its page includes /stations.
      path: isLast && isStationList ? `${path}/${routeSegment('stations')}` : path,
    });
  });
  return items;
}
