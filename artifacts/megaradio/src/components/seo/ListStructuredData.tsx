import { useContext, useEffect, useId } from 'react';
import { useLocation, useSearch } from 'wouter';
import { getLanguageFromPath } from '@workspace/seo-shared/seo-config';
import { translateUrl } from '@workspace/seo-shared/url-translations';
import { generateStationListData, generateGenreListData, generateBreadcrumbData, injectOwnedStructuredData } from '@/utils/structured-data';
import { preserveInitialSsrHead, ServerSeoHeadContext } from '@/utils/ssr-seo-head';
import { useTranslation } from '@/hooks/useTranslation';

interface ListStructuredDataProps {
  type: 'stations' | 'genres';
  items: any[];
  listName: string;
  listDescription?: string;
  breadcrumbs?: Array<{name: string, url: string}>;
  currentCountry?: string;
}

export default function ListStructuredData({ 
  type, 
  items, 
  listName, 
  listDescription, 
  breadcrumbs = [],
  currentCountry 
}: ListStructuredDataProps) {
  const owner = useId();
  const serverHeadOwned = useContext(ServerSeoHeadContext);
  const [location] = useLocation();
  const search = useSearch();
  const { t } = useTranslation();
  const language = getLanguageFromPath(location).language || 'en';
  useEffect(() => {
    // The first response already has server-rendered, localized lists. Avoid
    // adding a second conflicting list after React mounts.
    if (serverHeadOwned || preserveInitialSsrHead(`${location}${search ? `?${search}` : ''}`)) return;
    const structuredData = [];
    const localizedPath = (path: string) => `/${language}${translateUrl(path, language)}`;

    // Add appropriate list structured data
    if (type === 'stations') {
      const list = generateStationListData(items, t('popular_stations_title', listName), language === 'en' ? listDescription : undefined, localizedPath);
      list.inLanguage = language;
      structuredData.push(list);
    } else if (type === 'genres') {
      const list = generateGenreListData(items, currentCountry, localizedPath);
      list.name = t('popular_genres_title', listName);
      list.description = language === 'en' ? listDescription : undefined;
      list.inLanguage = language;
      structuredData.push(list);
    }

    // Add breadcrumbs if provided
    if (breadcrumbs.length > 0) {
      structuredData.push(generateBreadcrumbData(breadcrumbs.map(crumb => ({
        ...crumb,
        name: crumb.name === 'Home' ? t('home', crumb.name) : crumb.name,
        url: crumb.url.replace(/\/$/, ''),
      }))));
    }

    // Inject all structured data
    return injectOwnedStructuredData(structuredData, owner);
  }, [type, items, listName, listDescription, breadcrumbs, currentCountry, owner, location, search, language, t, serverHeadOwned]);

  return null;
}
