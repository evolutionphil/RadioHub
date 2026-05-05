import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSeoRouting } from "@/hooks/useSeoRouting";
import { SeoHead } from "@/components/seo/SeoHead";
import { SeoMetaTags } from "@shared/seo-config";
import { useLocation } from "wouter";

interface SeoPageWrapperProps {
  children: React.ReactNode;
  pageType?: string;
}

export function SeoPageWrapper({ children, pageType = 'home' }: SeoPageWrapperProps) {
  const { currentLanguage, cleanPath } = useSeoRouting();
  const [location] = useLocation();
  
  // CRITICAL FIX: Use full URL with country code, not just cleanPath
  // This ensures the API returns SEO in the correct language
  const fullUrl = location;
  
  // CRITICAL FIX: Initialize with server-preloaded title (already language-correct from htmlLangMiddleware)
  // instead of hardcoded English 'MegaRadio - Free Online Radio' — this eliminates the window
  // where analytics tools (Flowalive) or bots capture an English title on non-English pages.
  const [seoTags, setSeoTags] = useState<SeoMetaTags>(() => {
    const preTitle =
      typeof window !== 'undefined' && window.__INITIAL_TRANSLATIONS__?.meta_title
        ? window.__INITIAL_TRANSLATIONS__.meta_title
        : 'MegaRadio - Free Online Radio';
    const preDesc =
      typeof window !== 'undefined' && window.__INITIAL_TRANSLATIONS__?.meta_description
        ? window.__INITIAL_TRANSLATIONS__.meta_description
        : 'Listen to free online radio stations from around the world.';
    return { title: preTitle, description: preDesc };
  });

  // Fetch SEO data from server using FULL URL with country code
  const { data: seoData } = useQuery({
    queryKey: ['/api/seo/page-data', fullUrl, currentLanguage],
    queryFn: async () => {
      const response = await fetch(`/api/seo/page-data?url=${encodeURIComponent(fullUrl)}`);
      return response.json();
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Update SEO tags when data changes
  useEffect(() => {
    if (seoData?.seoTags) {
      setSeoTags(seoData.seoTags);
    }
  }, [seoData]);

  return (
    <>
      <SeoHead seoData={seoTags} />
      {children}
    </>
  );
}