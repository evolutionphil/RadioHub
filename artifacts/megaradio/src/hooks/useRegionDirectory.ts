import { useLocation } from 'wouter';
import { getLanguageFromPath } from '@workspace/seo-shared/seo-config';
import { getLocalizedRegionName } from '@workspace/seo-shared/region-name-translations';
import { useSeoRouting } from './useSeoRouting';
import { getLocalizedCountryDisplayName } from '@/utils/localized-country';
import { getRegionDirectoryCopy } from '@/utils/region-directory-copy';
import { parseRegionDirectoryPath } from '@/utils/region-directory';

const REGION_NAMES: Record<string, string> = {
  africa: 'Africa', asia: 'Asia', europe: 'Europe', 'north-america': 'North America', 'south-america': 'South America', oceania: 'Oceania',
};
export function useRegionDirectory() {
  const [location] = useLocation();
  const routing = useSeoRouting();
  const language = getLanguageFromPath(location).language || routing.currentLanguage || 'en';
  const copy = getRegionDirectoryCopy(language);
  return {
    language, copy, ...parseRegionDirectoryPath(routing.englishPath),
    getLocalizedUrl: (path: string) => routing.getLocalizedUrl(path, language),
    regionName: (slug: string, fallback?: string) => {
      // The site's lightweight DisplayNames polyfill only contains countries;
      // UN macroregion codes otherwise leak into the UI as "002", "150", etc.
      return getLocalizedRegionName(REGION_NAMES[slug] || fallback || slug.replace(/-/g, ' '), language);
    },
    countryName: (name: string) => getLocalizedCountryDisplayName(name, language),
    formatCount: (count: number, kind: 'countries' | 'cities' | 'stations') =>
      `${copy[kind]} · ${new Intl.NumberFormat(language).format(Number.isFinite(count) ? Math.max(0, count) : 0)}`,
  };
}
