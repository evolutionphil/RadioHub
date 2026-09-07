import { DEFAULT_LANGUAGE, getLanguageFromPath } from '@workspace/seo-shared/seo-config';
import { getPreferredLanguageCookie, getSupportedLanguage } from '@workspace/seo-shared/language-preference';

/** Only `/` is personalizable. Content URLs, including /en, define their language. */
export function getBrowserLanguage(pathname = window.location.pathname): string {
  if (pathname !== '/') return getLanguageFromPath(pathname).language;
  let saved: string | undefined;
  try { saved = getPreferredLanguageCookie(document.cookie); } catch { /* cookies can be blocked */ }
  if (saved) return saved;
  try { saved = getSupportedLanguage(localStorage.getItem('preferredLanguage')); } catch { /* Safari storage can be blocked */ }
  if (saved) return saved;
  for (const candidate of [...(navigator.languages || []), navigator.language]) {
    const language = getSupportedLanguage(candidate);
    if (language) return language;
  }
  return DEFAULT_LANGUAGE;
}

/** Keep the server-readable preference in sync even when localStorage already matches. */
export function saveBrowserLanguage(language: string): void {
  if (getSupportedLanguage(language) !== language) return;
  try {
    if (localStorage.getItem('preferredLanguage') !== language) localStorage.setItem('preferredLanguage', language);
  } catch { /* A blocked storage API must not break navigation. */ }
  try {
    if (getPreferredLanguageCookie(document.cookie) !== language) {
      document.cookie = `preferredLanguage=${language}; max-age=31536000; path=/; SameSite=Lax`;
    }
  } catch { /* Continue with the explicit URL when cookies are unavailable. */ }
}
