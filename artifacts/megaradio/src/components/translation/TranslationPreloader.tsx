import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getLanguageFromPath } from '@workspace/seo-shared/seo-config';

/**
 * TranslationPreloader - Intelligent translation loading based on user preferences
 * OPTIMIZED: Uses requestIdleCallback instead of setTimeout to avoid Main Thread blocking
 */
export function TranslationPreloader() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const intelligentTranslationLoading = async () => {
    // CRITICAL: Non-blocking background load - allows LCP to happen immediately
      // Use the same URL locale resolver as the actual translation consumer.
      // IP location is unrelated to the requested language: a visitor in
      // Germany on /tr needs Turkish, not an unused German dictionary.
      // Unprefixed global pages still resolve to English.
      const { language: detectedLanguage } = getLanguageFromPath(window.location.pathname);

      // Loading translations in background (non-blocking for LCP)

      // 1. Load detected/selected language in background (priority) - FIRE AND FORGET
      const cached = queryClient.getQueryData(["/api/translations", detectedLanguage]);
      if (!cached) {
        // Fire-and-forget: Don't await this, let it load in background
        // This prevents blocking LCP while translations load
        queryClient.prefetchQuery({
          queryKey: ["/api/translations", detectedLanguage],
          queryFn: async () => {
    // CRITICAL: Non-blocking background load - allows LCP to happen immediately
            const response = await fetch(`/api/translations/${detectedLanguage}`);
            if (!response.ok) throw new Error(`Failed to fetch ${detectedLanguage} translations`);
            return response.json();
          },
          staleTime: 24 * 60 * 60 * 1000,
          gcTime: 24 * 60 * 60 * 1000,
        }).catch(error => {
          // Failed to load translations - app still renders with fallback
        });
      }

      // 2. Async background loading of other common languages (deferred to idle)
      // OPTIMIZED: Use requestIdleCallback instead of setTimeout to avoid Main Thread blocking
      const scheduleBackgroundLoad = () => {
        // PageSpeed 2026-07-03: 'de' was hardcoded here as a speculative
        // "likely switch" preload, so EVERY /en visit also downloaded the
        // full German dictionary (24 KB, and a 7s request in the Lighthouse
        // trace) that almost no visitor ever uses. Only English — the
        // language switcher's default target — is worth warming; a real
        // language switch fetches its dictionary on demand.
        const backgroundLanguages = ['en'].filter(lang => lang !== detectedLanguage);
        
        backgroundLanguages.forEach((lang) => {
          // Use requestIdleCallback for non-blocking background loads
          if ('requestIdleCallback' in window) {
            requestIdleCallback(() => {
              const backgroundCached = queryClient.getQueryData(["/api/translations", lang]);
              if (!backgroundCached) {
                queryClient.prefetchQuery({
                  queryKey: ["/api/translations", lang],
                  queryFn: async () => {
    // CRITICAL: Non-blocking background load - allows LCP to happen immediately
                    const response = await fetch(`/api/translations/${lang}`);
                    if (!response.ok) throw new Error(`Failed to fetch ${lang} translations`);
                    return response.json();
                  },
                  staleTime: 24 * 60 * 60 * 1000,
                  gcTime: 24 * 60 * 60 * 1000,
                }).catch(error => {
                  // Failed to preload translations
                });
              }
            }, { timeout: 5000 }); // Timeout after 5s to ensure it runs
          } else {
            // Fallback for browsers without requestIdleCallback
            setTimeout(() => {
              const backgroundCached = queryClient.getQueryData(["/api/translations", lang]);
              if (!backgroundCached) {
                queryClient.prefetchQuery({
                  queryKey: ["/api/translations", lang],
                  queryFn: async () => {
    // CRITICAL: Non-blocking background load - allows LCP to happen immediately
                    const response = await fetch(`/api/translations/${lang}`);
                    if (!response.ok) throw new Error(`Failed to fetch ${lang} translations`);
                    return response.json();
                  },
                  staleTime: 24 * 60 * 60 * 1000,
                  gcTime: 24 * 60 * 60 * 1000,
                }).catch(error => {
                  // Failed to preload translations
                });
              }
            }, 3000);
          }
        });
      };

      // PERF: Defer background language prefetch (en+de) until AFTER 'load' event AND idle.
      // Previously prefetch fired during initial paint window and competed with critical
      // requests for bandwidth/CPU — pushing FCP +0.4-1.2s on slow 4G.
      // Now: wait for full load, then idle, then 6s buffer to ensure LCP/TTI are settled.
      const runDeferredPrefetch = () => {
        if ('requestIdleCallback' in window) {
          requestIdleCallback(scheduleBackgroundLoad, { timeout: 10000 });
        } else {
          setTimeout(scheduleBackgroundLoad, 6000);
        }
      };
      if (document.readyState === 'complete') {
        setTimeout(runDeferredPrefetch, 6000);
      } else {
        window.addEventListener('load', () => {
          setTimeout(runDeferredPrefetch, 6000);
        }, { once: true });
      }
    };

    // Start intelligent loading after minimal delay
    // Using requestIdleCallback for better Main Thread performance
    if ('requestIdleCallback' in window) {
      requestIdleCallback(intelligentTranslationLoading, { timeout: 2000 });
    } else {
      setTimeout(intelligentTranslationLoading, 500); // Faster fallback
    }
  }, [queryClient]);

  return null; // This component doesn't render anything
}
