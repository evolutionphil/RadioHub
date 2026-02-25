import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { useStructuredDataUpdate } from '@/hooks/useStructuredDataUpdate';
import { injectMultipleStructuredData } from '@/utils/structured-data';

interface StructuredDataProps {
  additionalData?: any[];
}

export default function StructuredData({ additionalData = [] }: StructuredDataProps) {
  const [location] = useLocation();
  
  // Update base structured data with current domain
  useStructuredDataUpdate();

  useEffect(() => {
    // Only inject additional page-specific data if provided
    if (additionalData.length > 0) {
      injectMultipleStructuredData(additionalData);
    }
  }, [location, additionalData]);

  return null; // This component doesn't render anything visible
}