import { useEffect } from 'react';
import { generateStationListData, generateGenreListData, generateBreadcrumbData, injectMultipleStructuredData } from '@/utils/structured-data';

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
  useEffect(() => {
    const structuredData = [];

    // Add appropriate list structured data
    if (type === 'stations') {
      structuredData.push(generateStationListData(items, listName, listDescription));
    } else if (type === 'genres') {
      structuredData.push(generateGenreListData(items, currentCountry));
    }

    // Add breadcrumbs if provided
    if (breadcrumbs.length > 0) {
      structuredData.push(generateBreadcrumbData(breadcrumbs));
    }

    // Inject all structured data
    injectMultipleStructuredData(structuredData);
  }, [type, items, listName, listDescription, breadcrumbs, currentCountry]);

  return null;
}