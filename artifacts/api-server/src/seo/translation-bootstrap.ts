import {CRITICAL_TRANSLATION_KEYS} from '@workspace/seo-shared/critical-translation-keys';

/** The production SSR template bypasses the legacy HTML middleware. Emit the
 * same current-language first-paint contract here; keep the full API refresh. */
export function renderTranslationBootstrap(language: string, translations: Record<string, string>): string {
  const critical = Object.fromEntries(CRITICAL_TRANSLATION_KEYS.filter(key => typeof translations?.[key] === 'string')
    .map(key => [key,translations[key]]));
  const json = JSON.stringify(critical).replace(/</g,'\\u003c');
  const lang = JSON.stringify(language).replace(/</g,'\\u003c');
  return `<script id="initial-translations">window.__INITIAL_LANGUAGE__=${lang};window.__INITIAL_TRANSLATIONS__=${json};window.__PRELOADED__=true;</script>`;
}
