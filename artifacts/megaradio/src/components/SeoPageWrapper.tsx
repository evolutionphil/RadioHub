import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSeoRouting } from "@/hooks/useSeoRouting";
import { SeoHead } from "@/components/seo/SeoHead";
import { SeoMetaTags } from "@workspace/seo-shared/seo-config";
import { useLocation } from "wouter";

interface SeoPageWrapperProps {
  children: React.ReactNode;
  pageType?: string;
}

// PageSpeed 2026-07-03: when the server SSR-rendered this page it already
// injected the full <head> (title/meta/canonical/hreflang/JSON-LD) AND
// window.__INITIAL_TRANSLATIONS__ — re-fetching /api/seo/page-data for the
// SAME url only re-applied identical tags at the cost of a ~100 KB JSON
// response in the critical window. Capture the SSR'd pathname once; the
// fetch is skipped ONLY while the user is still on that exact first page.
// The first client-side navigation releases the guard permanently (so
// navigating away and back re-fetches and canonical/hreflang stay correct).
const initialSsrPath: string | null =
  typeof window !== 'undefined' && window.__INITIAL_TRANSLATIONS__?.meta_title
    ? window.location.pathname
    : null;
let leftInitialSsrPage = false;

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

  // Release the SSR guard permanently on the first client-side navigation.
  if (initialSsrPath && fullUrl !== initialSsrPath) leftInitialSsrPage = true;
  const ssrHeadAlreadyCorrect =
    !!initialSsrPath && !leftInitialSsrPage && fullUrl === initialSsrPath;

  // Fetch SEO data from server using FULL URL with country code.
  // slim=1: only seoTags is consumed here, so ask the server to drop the
  // translations/urlTranslations/pageData bulk (~100 KB → a few KB).
  const { data: seoData } = useQuery({
    queryKey: ['/api/seo/page-data', fullUrl, currentLanguage],
    enabled: !ssrHeadAlreadyCorrect,
    queryFn: async () => {
      const response = await fetch(`/api/seo/page-data?url=${encodeURIComponent(fullUrl)}&slim=1`);
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