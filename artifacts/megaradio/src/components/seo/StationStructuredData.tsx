import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { generateRadioStationData, generateBreadcrumbData, injectMultipleStructuredData, getCurrentDomain } from '@/utils/structured-data';

interface StationStructuredDataProps {
  station: {
    _id: string;
    name: string;
    slug?: string;
    country?: string;
    tags?: string[];
    bitrate?: number;
    codec?: string;
  };
  breadcrumbs?: Array<{name: string, url: string}>;
}

export default function StationStructuredData({ station, breadcrumbs = [] }: StationStructuredDataProps) {
  const [location] = useLocation();
  const currentUrl = getCurrentDomain() + location;

  useEffect(() => {
    const structuredData = [];

    // Add radio station structured data
    structuredData.push(generateRadioStationData(station, currentUrl));

    // Add breadcrumbs if provided
    if (breadcrumbs.length > 0) {
      structuredData.push(generateBreadcrumbData(breadcrumbs));
    }

    // Inject all structured data
    injectMultipleStructuredData(structuredData);
  }, [station, breadcrumbs, currentUrl]);

  return null;
}