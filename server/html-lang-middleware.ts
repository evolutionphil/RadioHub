/**
 * HTML Language Middleware - Server-Side Language Injection
 * 
 * This middleware solves the "flash of untranslated content" (FOUC) problem by:
 * 1. Detecting language from URL on the server
 * 2. Injecting language-specific HTML attributes and meta tags
 * 3. Pre-loading translations as inline script to prevent flash
 * 
 * BEFORE (Client-Side Only):
 * /tr → English HTML → JS loads → Fetch translations → Turkish (2-3 sec flash!)
 * 
 * AFTER (Server-Side + Client-Side):
 * /tr → Turkish HTML → JS loads → Use injected translations → Turkish (instant!)
 */

import { Request, Response, NextFunction } from 'express';
import { getLanguageFromPath, SEO_LANGUAGES, DEFAULT_LANGUAGE, getLanguageFromCode } from '../shared/seo-config';
import { performanceCache } from './performance-cache';
import { logger } from './utils/logger';

/**
 * Get language data by code
 */
function getLanguageData(code: string) {
  return SEO_LANGUAGES.find(l => l.code === code);
}

export function htmlLangMiddleware(req: Request, res: Response, next: NextFunction) {
  // Only process HTML requests (not API, static files, etc.)
  const acceptsHtml = req.headers.accept?.includes('text/html');
  if (!acceptsHtml || req.path.startsWith('/api') || req.path.startsWith('/ws')) {
    return next();
  }

  // Detect language from URL
  const { language } = getLanguageFromPath(req.path);
  const lang = language || DEFAULT_LANGUAGE;
  
  // Store language in res.locals for use in templates
  res.locals.language = lang;
  res.locals.languageData = SEO_LANGUAGES.find(l => l.code === lang);

  // Store the original send method
  const originalSend = res.send;
  const originalWrite = res.write;
  const originalEnd = res.end;
  
  let buffer = '';
  
  // Override write to capture chunks
  res.write = function(chunk: any, ...args: any[]): boolean {
    if (typeof chunk === 'string') {
      buffer += chunk;
    } else if (chunk instanceof Buffer) {
      buffer += chunk.toString('utf8');
    }
    return true;
  };
  
  // Override end to process the complete HTML
  res.end = function(chunk?: any, encodingOrCb?: BufferEncoding | (() => void), cb?: () => void): Response {
    if (chunk) {
      if (typeof chunk === 'string') {
        buffer += chunk;
      } else if (chunk instanceof Buffer) {
        buffer += chunk.toString('utf8');
      }
    }
    
    // Restore original methods immediately
    res.write = originalWrite;
    res.end = originalEnd;
    res.send = originalSend;
    
    // Process HTML if we have a complete document
    if (buffer && buffer.includes('<!DOCTYPE html>')) {
      // 1. Update HTML lang attribute
      buffer = buffer.replace(/<html lang="en">/, `<html lang="${lang}">`);
      
      // 2. Get translations synchronously from cache (non-blocking)
      const translations = performanceCache.getTranslations(lang);
      
      // Construct language-specific meta tags (use translations or defaults)
      const langName = getLanguageData(lang)?.name || 'Radio';
      const metaTitle = translations?.meta_title || 
        (lang !== 'en' ? `Mega Radio - ${langName}` : 'Mega Radio - Listen to Free Live Radio Online');
      
      const metaDescription = translations?.meta_description ||
        (lang !== 'en' ? `Mega Radio - ${langName} radyo istasyonları` : 'Listen to live radio online with Mega Radio! 60,000+ AM/FM stations from 120+ countries, music, news, sports, and talk shows for free.');
      
      // 3. Inject inline script with initial translations to prevent flash
      const translationsScript = `
        <script id="initial-translations">
          // Pre-loaded translations to prevent flash of untranslated content
          window.__INITIAL_LANGUAGE__ = "${lang}";
          window.__INITIAL_TRANSLATIONS__ = ${JSON.stringify(translations || {})};
          window.__PRELOADED__ = true;
        </script>
      `;
      
      // Inject before the main app script - supports BOTH development AND production builds
      // Development: <script type="module" src="/src/main.tsx"></script>
      // Production:  <script type="module" src="/assets/main-HASH.js"></script>
      const scriptInjected = buffer.replace(
        /(<script type="module" src="\/(?:src\/main\.tsx|assets\/[^"]+\.js)"[^>]*><\/script>)/,
        `${translationsScript}\n    $1`
      );
      
      // Fallback: If no script tag matched, inject before </head>
      if (scriptInjected === buffer) {
        buffer = buffer.replace(
          /<\/head>/,
          `${translationsScript}\n  </head>`
        );
      } else {
        buffer = scriptInjected;
      }
      
      // 4. Update meta description with language-specific content
      buffer = buffer.replace(
        /<meta name="description" content="[^"]*" \/>/,
        `<meta name="description" content="${metaDescription}" />`
      );
      
      // 5. Update title with language-specific content
      buffer = buffer.replace(
        /<title>[^<]*<\/title>/,
        `<title>${metaTitle}</title>`
      );
    }
    
    // Call original end with buffer (type assertion to handle Express overloads)
    return (originalEnd as any).call(res, buffer);
  };
  
  // Override send for backward compatibility
  res.send = function(body: any): Response {
    if (typeof body === 'string') {
      return res.end(body);
    }
    return originalSend.call(res, body);
  };
  
  next();
}

