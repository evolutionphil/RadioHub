import { useLocation } from "wouter";
import { useEffect, useState, useRef } from "react";
import { getLanguageFromPath, DEFAULT_LANGUAGE, SEO_LANGUAGES, COUNTRY_TO_CODE, COUNTRY_TO_LANGUAGE, getCountryCodeFromName } from "@workspace/seo-shared/seo-config";
import { translateUrl, reverseTranslateUrl, normalizeUrlForLanguage } from "@workspace/seo-shared/url-translations";
import { useTranslation } from "./useTranslation";
import { useQuery } from "@tanstack/react-query";
import { logger } from '@/lib/logger';

// RESTORED: Working version from 10+ days ago
// NO localStorage country detection that overwrites URLs
export function useSeoRouting() {
  const [location, setLocation] = useLocation();
  const { setLanguage: setTranslationLanguage } = useTranslation();
  
  // Parse current URL for language
  const { language: urlLanguage, cleanPath } = getLanguageFromPath(location);
  
  // CRITICAL FIX: If URL has no language prefix, redirect to default language (/en/...)
  // This ensures page refresh works correctly for bare URLs like /station/a-haber
  useEffect(() => {
    if (typeof window !== 'undefined' && !urlLanguage && location !== '/') {
      // Get preferred language from localStorage or default to 'en'
      const preferredLanguage = localStorage.getItem('preferredLanguage') || DEFAULT_LANGUAGE;
      const newUrl = `/${preferredLanguage}${location}`;
      logger.log(`🔄 Redirecting bare URL to language-prefixed: ${location} → ${newUrl}`);
      // Use replace to avoid adding to history stack
      window.history.replaceState(null, '', newUrl);
      setLocation(newUrl);
    }
  }, [location, urlLanguage, setLocation]);
  
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
  const effectiveLanguage = urlLanguage || DEFAULT_LANGUAGE;
  
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
      setTranslationLanguage(effectiveLanguage);
    }
    
    // LANGUAGE/COUNTRY SEPARATION: Save detected language to localStorage AND cookie
    // This ensures that when user changes country, their language preference is preserved
    // Cookie is SSR-compatible (server can read it on first render)
    // Example: User lands on /tr/radyolar → preferredLanguage = 'tr' saved
    // Later, user selects Germany → /de/radyolar → getLanguageFromPath uses stored 'tr'
    // CRITICAL: Save ALL languages including English for consistent behavior
    if (effectiveLanguage) {
      const storedLang = localStorage.getItem('preferredLanguage');
      if (storedLang !== effectiveLanguage) {
        // Save to localStorage (client-side)
        localStorage.setItem('preferredLanguage', effectiveLanguage);
        
        // Save to cookie (SSR-compatible) - 1 year expiry, path=/
        const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toUTCString();
        document.cookie = `preferredLanguage=${effectiveLanguage}; expires=${expires}; path=/; SameSite=Lax`;
        
        logger.log('💾 Language preference saved (localStorage + cookie):', effectiveLanguage);
      }
    }
  }, [effectiveLanguage, currentLanguage, setTranslationLanguage]);

  // Note: Location data is fetched in radio-frontend.tsx to avoid duplicate calls

  // CRITICAL: NO automatic redirects based on localStorage country detection
  // URLs from Google (without country codes) must stay as they are
  // Only user-initiated navigation should add country codes
  
  // Function to change language - stays on current page, translates URL
  // User expects to stay on same page when switching language (better UX)
  const changeLanguage = (newLanguage: string) => {
    if (!SEO_LANGUAGES.find(lang => lang.code === newLanguage)) {
      // Invalid language code
      return;
    }
    
    // Store the preferred language immediately (localStorage + cookie for SSR)
    localStorage.setItem('preferredLanguage', newLanguage);
    const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toUTCString();
    document.cookie = `preferredLanguage=${newLanguage}; expires=${expires}; path=/; SameSite=Lax`;
    
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
