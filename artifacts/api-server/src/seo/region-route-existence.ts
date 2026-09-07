import { COUNTRY_TO_REGION_SLUG, countrySlug } from '@workspace/seo-shared/country-regions';
import { ALIAS_TO_DB } from '../utils/normalize-country';

interface ExistenceLookup {
  isSlugExistenceReady(): boolean;
  hasCountrySlug(slug: string): boolean;
  hasCityDataForCountry(slug: string): boolean;
  hasCitySlug(country: string, city: string): boolean;
}
const referenceCountries = new Set(Object.keys(COUNTRY_TO_REGION_SLUG).map(countrySlug));

/** Never infer geographic absence from an empty station grid or a cold cache. */
export function regionRouteExistence(cleanPath: string, lookup: ExistenceLookup): 'known' | 'missing' | 'unavailable' {
  const parts = cleanPath.split('/').filter(Boolean);
  const countryIndex = parts[0] === 'regions' ? 2 : parts[0] === 'country' ? 1 : -1;
  if (countryIndex < 0 || !parts[countryIndex]) return 'known';
  const requestedCountry = parts[countryIndex].toLowerCase();
  const country = ALIAS_TO_DB[requestedCountry] ? countrySlug(ALIAS_TO_DB[requestedCountry]) : requestedCountry;
  const ready = lookup.isSlugExistenceReady();
  if (!referenceCountries.has(country) && !(ready && (lookup.hasCountrySlug(country) || lookup.hasCountrySlug(requestedCountry)))) {
    return ready ? 'missing' : 'unavailable';
  }
  const city = parts[countryIndex + 1]?.toLowerCase();
  if (city && city !== 'stations' && city !== 'cities' && ready && lookup.hasCityDataForCountry(country) && !lookup.hasCitySlug(country, city)) return 'missing';
  return 'known';
}
