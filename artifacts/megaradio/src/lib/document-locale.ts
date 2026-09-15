/** Match SSR document metadata on SPA navigation, in both RTL/LTR directions. */
export function syncDocumentLocale(language: string): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = language;
  document.documentElement.dir = language === 'ar' || language === 'he' ? 'rtl' : 'ltr';
}
