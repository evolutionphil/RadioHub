/**
 * HTML Language Middleware - Server-Side Language Injection
 * 
 * This middleware solves the "flash of untranslated content" (FOUC) problem by:
 * 1. Detecting language from URL on the server
 * 2. Injecting language-specific HTML attributes and meta tags
 * 3. Pre-loading ONLY the language code (translations fetched async by client)
 * 
 * PERFORMANCE: Full translation JSON.stringify was causing event loop blocks
 * (up to 107 seconds!) under high traffic. Now we only inject the language code
 * and let the client fetch translations via API (which are cached by TanStack Query).
 */

import { Request, Response, NextFunction } from 'express';
import { getLanguageFromPath, SEO_LANGUAGES, DEFAULT_LANGUAGE } from '@workspace/seo-shared/seo-config';
import { performanceCache } from './performance-cache';
import { logger } from './utils/logger';

const CRITICAL_TRANSLATION_KEYS = [
  'meta_title', 'meta_description', 'search_placeholder', 'popular_stations',
  'all_stations', 'genres', 'favorites', 'recently_played', 'settings',
  'loading', 'error', 'no_results', 'play', 'pause', 'stop', 'volume',
  'home', 'about', 'contact', 'login', 'register', 'logout'
];

const HTML_REGEX = {
  htmlLang: /<html lang="en">/,
  scriptTag: /(<script type="module" src="\/(?:src\/main\.tsx|assets\/[^"]+\.js)"[^>]*><\/script>)/,
  headClose: /<\/head>/,
  metaDesc: /<meta name="description" content="[^"]*" \/>/,
  title: /<title>[^<]*<\/title>/,
};

interface PrecomputedLangData {
  script: string;
  metaTitle: string;
  metaDescription: string;
}
const precomputedTranslationScripts = new Map<string, PrecomputedLangData>();

function getPrecomputedScript(lang: string): PrecomputedLangData | null {
  return precomputedTranslationScripts.get(lang) || null;
}

export function precomputeTranslationScripts(): void {
  for (const langObj of SEO_LANGUAGES) {
    if (!langObj.enabled) continue;
    const lang = langObj.code;
    const translations = performanceCache.getTranslations(lang);
    if (!translations) continue;

    const critical: Record<string, string> = {};
    for (const key of CRITICAL_TRANSLATION_KEYS) {
      if (translations[key]) critical[key] = translations[key];
    }

    const langName = langObj.name || 'Radio';
    const metaTitle = translations.meta_title ||
      (lang !== 'en' ? `Mega Radio - ${langName}` : 'Mega Radio - Listen to Free Live Radio Online');
    const metaDescription = translations.meta_description ||
      (lang !== 'en' ? `Mega Radio - ${langName} radyo istasyonları` : 'Listen to live radio online with Mega Radio! 60,000+ AM/FM stations from 120+ countries, music, news, sports, and talk shows for free.');

    const hasCritical = Object.keys(critical).length > 0;
    // R5-XSS FIX (2026-05-08): escape `</` sequences inside the embedded JSON
    // so a translation value containing `</script>` (or `</style>` etc.)
    // cannot break out of the inline <script> block. JSON allows the
    // backslash-escape `\u003C` in place of `<`, which is parsed identically
    // by JSON.parse and the JS engine but is opaque to the HTML parser.
    const safeJson = JSON.stringify(critical).replace(/<\//g, '\\u003c/');
    const script = hasCritical
      ? `<script id="initial-translations">window.__INITIAL_LANGUAGE__="${lang}";window.__INITIAL_TRANSLATIONS__=${safeJson};window.__PRELOADED__=true;</script>`
      : `<script id="initial-translations">window.__INITIAL_LANGUAGE__="${lang}";</script>`;

    precomputedTranslationScripts.set(lang, { script, metaTitle, metaDescription });
  }
  if (precomputedTranslationScripts.size > 0) {
    logger.log(`🌐 Precomputed translation scripts for ${precomputedTranslationScripts.size} languages`);
  }
}

export function htmlLangMiddleware(req: Request, res: Response, next: NextFunction) {
  const acceptsHtml = req.headers.accept?.includes('text/html');
  if (!acceptsHtml || req.path.startsWith('/api') || req.path.startsWith('/ws')) {
    return next();
  }

  const { language } = getLanguageFromPath(req.path);
  const lang = language || DEFAULT_LANGUAGE;
  
  res.locals.language = lang;
  res.locals.languageData = SEO_LANGUAGES.find(l => l.code === lang);

  const originalSend = res.send;
  const originalWrite = res.write;
  const originalEnd = res.end;
  
  let buffer = '';
  
  res.write = function(chunk: any, ...args: any[]): boolean {
    if (typeof chunk === 'string') {
      buffer += chunk;
    } else if (chunk instanceof Buffer) {
      buffer += chunk.toString('utf8');
    }
    return true;
  };
  
  res.end = function(chunk?: any, encodingOrCb?: BufferEncoding | (() => void), cb?: () => void): Response {
    if (chunk) {
      if (typeof chunk === 'string') {
        buffer += chunk;
      } else if (chunk instanceof Buffer) {
        buffer += chunk.toString('utf8');
      }
    }
    
    res.write = originalWrite;
    res.end = originalEnd;
    res.send = originalSend;
    
    if (buffer && buffer.includes('<!DOCTYPE html>')) {
      buffer = buffer.replace(HTML_REGEX.htmlLang, `<html lang="${lang}">`);
      
      const cached = getPrecomputedScript(lang);
      let translationsScript: string;
      let metaTitle: string;
      let metaDescription: string;

      if (cached) {
        translationsScript = cached.script;
        metaTitle = cached.metaTitle;
        metaDescription = cached.metaDescription;
      } else {
        const translations = performanceCache.getTranslations(lang);
        const critical: Record<string, string> = {};
        if (translations) {
          for (const key of CRITICAL_TRANSLATION_KEYS) {
            if (translations[key]) critical[key] = translations[key];
          }
        }
        const langData = SEO_LANGUAGES.find(l => l.code === lang);
        const langName = langData?.name || 'Radio';
        metaTitle = translations?.meta_title ||
          (lang !== 'en' ? `Mega Radio - ${langName}` : 'Mega Radio - Listen to Free Live Radio Online');
        metaDescription = translations?.meta_description ||
          (lang !== 'en' ? `Mega Radio - ${langName} radyo istasyonları` : 'Listen to live radio online with Mega Radio! 60,000+ AM/FM stations from 120+ countries, music, news, sports, and talk shows for free.');
        const hasCritical = Object.keys(critical).length > 0;
        // R5-XSS FIX (2026-05-08): see precomputeTranslationScripts above.
        const safeJson = JSON.stringify(critical).replace(/<\//g, '\\u003c/');
        translationsScript = hasCritical
          ? `<script id="initial-translations">window.__INITIAL_LANGUAGE__="${lang}";window.__INITIAL_TRANSLATIONS__=${safeJson};window.__PRELOADED__=true;</script>`
          : `<script id="initial-translations">window.__INITIAL_LANGUAGE__="${lang}";</script>`;
      }
      
      const scriptInjected = buffer.replace(
        HTML_REGEX.scriptTag,
        `${translationsScript}\n    $1`
      );
      
      if (scriptInjected === buffer) {
        buffer = buffer.replace(HTML_REGEX.headClose, `${translationsScript}\n  </head>`);
      } else {
        buffer = scriptInjected;
      }
      
      buffer = buffer.replace(
        HTML_REGEX.metaDesc,
        `<meta name="description" content="${metaDescription}" />`
      );
      
      buffer = buffer.replace(
        HTML_REGEX.title,
        `<title>${metaTitle}</title>`
      );
    }
    
    return (originalEnd as any).call(res, buffer);
  };
  
  res.send = function(body: any): Response {
    if (typeof body === 'string') {
      res.end(body);
      return res;
    }
    return originalSend.call(res, body);
  };
  
  next();
}

