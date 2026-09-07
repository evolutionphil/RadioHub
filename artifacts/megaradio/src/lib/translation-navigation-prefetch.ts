import type { QueryClient } from '@tanstack/react-query';
import { getSupportedLanguage } from '@workspace/seo-shared/language-preference';

/** Preserve the requested-locale warmup on SPA navigation, without subscribing
 * URL-only consumers to dictionaries/auth or speculatively loading seven locales. */
export async function prefetchNavigationTranslations(client: QueryClient, language: string): Promise<void> {
  if (getSupportedLanguage(language) !== language || client.getQueryData(['/api/translations', language])) return;
  await client.prefetchQuery({
    queryKey: ['/api/translations', language],
    queryFn: async () => {
      const response = await fetch(`/api/translations/${language}`);
      if (!response.ok) throw new Error('Failed to fetch translations');
      return response.json();
    },
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });
}
