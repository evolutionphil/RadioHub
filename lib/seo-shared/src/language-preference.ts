import { SEO_LANGUAGES } from './seo-config';

const enabledLanguages = new Set(SEO_LANGUAGES.filter(language => language.enabled).map(language => language.code));

/** Device language tags such as de-AT/de-DE select the supported German locale. */
export function getSupportedLanguage(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^[a-z]{2}(?:-[a-z0-9]{2,8})*$/i.test(value.trim())) return undefined;
  const language = value.trim().split('-')[0].toLowerCase();
  return enabledLanguages.has(language) ? language : undefined;
}

export function getPreferredLanguageCookie(cookieHeader: string): string | undefined {
  for (const cookie of cookieHeader.split(';')) {
    const separator = cookie.indexOf('=');
    if (cookie.slice(0, separator).trim() !== 'preferredLanguage') continue;
    try { return getSupportedLanguage(decodeURIComponent(cookie.slice(separator + 1).trim())); }
    catch { return undefined; }
  }
  return undefined;
}

export function getExplicitLanguageFromPath(pathname: string): string | undefined {
  const code = pathname.match(/^\/([a-z]{2})(?:\/|$)/i)?.[1].toLowerCase();
  return code && enabledLanguages.has(code) ? code : undefined;
}
