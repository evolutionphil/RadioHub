import { useLocation } from "wouter";
import { useEffect, useState } from "react";
import { useQueryClient } from '@tanstack/react-query';
import { getLanguageFromPath, DEFAULT_LANGUAGE, SEO_LANGUAGES, COUNTRY_TO_LANGUAGE } from "@workspace/seo-shared/seo-config";
import { translateUrl, reverseTranslateUrl, normalizeUrlForLanguage } from "@workspace/seo-shared/url-translations";
import { getBrowserLanguage, saveBrowserLanguage, syncBrowserLanguageFromUrl } from '@/lib/browser-language';
import { prefetchNavigationTranslations } from '@/lib/translation-navigation-prefetch';
import { getExplicitLanguageFromPath } from '@workspace/seo-shared/language-preference';
import { logger } from '@/lib/logger';

// Language-prefixed URLs are authoritative; country selection is a content filter.
export function useSeoRouting() {
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();
  
  // Parse current URL for language
  const { language: urlLanguage, cleanPath } = getLanguageFromPath(location);
  
  // The server normally negotiates `/` before loading the SPA. Handle internal
  // navigation to `/` identically without changing explicit localized URLs.
  useEffect(() => {
    if (typeof window !== 'undefined' && location === '/') {
      const newUrl = `/${getBrowserLanguage('/')}${window.location.search}${window.location.hash}`;
      setLocation(newUrl, { replace: true });
    }
  }, [location, setLocation]);
  
  // CROSS-LANGUAGE URL NORMALIZATION
  // Handles cases like /de/istasyon/slug → /de/sender/slug
  // When user manually changes language code, ensure path segments match the new language
  useEffect(() => {
    if (typeof window !== 'undefined' && urlLanguage) {
      const normResult = normalizeUrlForLanguage(location, urlLanguage);
      if (normResult.needsRedirect) {
        logger.log(`🔄 Cross-language URL normalization: ${location} → ${normResult.normalized}`);
        // Use replace to avoid adding to history stack
        window.history.replaceState(null, '', normResult.normalized);
        setLocation(normResult.normalized);
      }
    }
  }, [location, urlLanguage, setLocation]);
  
  // Use detected language or fallback to default
  const effectiveLanguage = location === '/' && typeof window !== 'undefined'
    ? getBrowserLanguage('/') : urlLanguage || DEFAULT_LANGUAGE;
  
  // CRITICAL FIX: Calculate English path for routing
  // cleanPath might be in translated language (e.g., "/zhanret"), but router needs English (e.g., "/genres")
  const englishPath = reverseTranslateUrl(cleanPath, effectiveLanguage);
  
  
  // State for current language - use effective language (with fallback)
  const [currentLanguage, setCurrentLanguage] = useState(effectiveLanguage);
  
  // Update translation language when URL language changes
  // CRITICAL: Also save to localStorage AND cookie so language persists across country changes
  useEffect(() => {
    if (effectiveLanguage !== currentLanguage) {
      setCurrentLanguage(effectiveLanguage);
      // Routing does not consume translated text. Keep the target dictionary
      // warm without creating five translation/auth observers per URL helper.
      void prefetchNavigationTranslations(queryClient, effectiveLanguage);
    }
    
    // Persist explicit URL choices in both stores, including English. A bare
    // content URL's fallback must not overwrite a previously chosen language.
    if (getExplicitLanguageFromPath(location)) syncBrowserLanguageFromUrl(effectiveLanguage);
  }, [location, effectiveLanguage, currentLanguage, queryClient]);

  // Note: Location data is fetched in radio-frontend.tsx to avoid duplicate calls

  // CRITICAL: NO automatic redirects based on localStorage country detection
  // URLs from Google (without country codes) must stay as they are
  // Only user-initiated navigation should add country codes
  
  // Function to change language - stays on current page, translates URL
  // User expects to stay on same page when switching language (better UX)
  const changeLanguage = (newLanguage: string) => {
    if (!SEO_LANGUAGES.find(lang => lang.code === newLanguage && lang.enabled)) {
      // Invalid language code
      return;
    }
    
    // Store the preferred language immediately (localStorage + cookie for SSR)
    saveBrowserLanguage(newLanguage);
    
    // Translate current page to new language and stay on same page
    // Use englishPath (already computed) to get canonical English route
    const currentEnglishPath = englishPath || '/';
    
    // Translate path to new language (English paths stay as-is)
    const translatedPath = newLanguage !== 'en' 
      ? translateUrl(currentEnglishPath, newLanguage) 
      : currentEnglishPath;
    
    // Build new URL: /{newLanguage}/{translatedPath}
    // Handle root path (homepage) case
    const newPath = translatedPath === '/' 
      ? `/${newLanguage}` 
      : `/${newLanguage}${translatedPath}`;
    
    logger.log(`🌐 Language changed to: ${newLanguage}, navigating to: ${newPath}`);
    
    // CRITICAL FIX: Use full page reload instead of SPA navigation
    // This ensures translations are properly loaded for non-Latin scripts
    // (Arabic, Chinese, Japanese, Hindi, etc.)
    // SPA navigation (setLocation) doesn't trigger proper re-render of translation system
    window.location.href = newPath;
  };
  
  // Function to navigate with language prefix preservation (for SEO URLs)
  // ALL languages (including English) use /{lang}/* format for consistency
  const navigateWithLanguage = (path: string) => {
    // Get current URL path to extract language/country code if present
    const currentPath = location;
    const pathSegments = currentPath.split('/').filter(Boolean);
    const firstSegment = pathSegments[0]?.toLowerCase();
    
    // Check if first segment is a valid language code
    const isLanguageCode = SEO_LANGUAGES.some(lang => lang.code === firstSegment);
    
    // Check if first segment is a valid country code (2 letters)
    const isCountryCode = firstSegment && firstSegment.length === 2 && 
                         COUNTRY_TO_LANGUAGE[firstSegment] !== undefined;
    
    if (isLanguageCode || isCountryCode) {
      // Use existing language/country code prefix
      const newPath = `/${firstSegment}${path}`;
      setLocation(newPath);
    } else {
      // No language/country code, use current language (default to /en for English)
      const newPath = `/${currentLanguage}${path}`;
      setLocation(newPath);
    }
  };
  
  // Function to get localized URL with language prefix AND translated path
  // ALL languages (including English) use /{lang}/* format for consistency
  const getLocalizedUrl = (path: string, targetLanguage?: string) => {
    const langToUse = targetLanguage || currentLanguage;

    // Translate the path to the target language (English paths stay as-is)
    const translatedPath = langToUse !== 'en' ? translateUrl(path, langToUse) : path;

    // Root path fix (2026-07-01): `getLocalizedUrl("/")` used to return
    // `/${lang}` + "/" = "/hi/" — a trailing-slash URL that the canonical
    // middleware 301s to "/hi". The header/footer home logo is on EVERY page,
    // so every page ended up linking to a redirect ("Page has links to 3xx" in
    // Ahrefs). Return the bare canonical "/{lang}" for the root so the home
    // link never redirects.
    if (translatedPath === '/' || translatedPath === '') {
      return `/${langToUse}`;
    }

    // ALL languages use /{lang}/* format for SEO consistency
    // English: /en/radios, Turkish: /tr/radyolar, German: /de/radios
    return `/${langToUse}${translatedPath}`;
  };
  
  // Function to navigate with translated URLs based on current language
  const navigateTranslated = (englishPath: string) => {
    const translatedUrl = getLocalizedUrl(englishPath);
    setLocation(translatedUrl);
  };
  
  // NOTE: navigateToCountry removed - country selection no longer changes URL
  // Country is just a content filter stored in localStorage/cookie
  // User's language preference (URL slug) stays unchanged
  
  return {
    currentLanguage,
    cleanPath,
    englishPath,             // CRITICAL: English path for router matching
    changeLanguage,
    navigateWithLanguage,
    navigateTranslated,      // Navigate with auto-translation
    getLocalizedUrl,         // Get localized URL with translation
    translateUrl: (path: string) => translateUrl(path, currentLanguage),  // Helper
    reverseTranslateUrl: (path: string) => reverseTranslateUrl(path, currentLanguage), // Helper
    isDefaultLanguage: currentLanguage === DEFAULT_LANGUAGE
  };
}
