import { Request, Response, NextFunction } from 'express';
import { Station } from '../shared/mongo-schemas';
import { COUNTRY_TO_CODE, SEO_LANGUAGES } from '../shared/seo-config';
import { logger } from './utils/logger';

// Cache valid language codes for fast lookup
const VALID_LANGUAGE_CODES = new Set(SEO_LANGUAGES.map(lang => lang.code.toLowerCase()));

/**
 * Station Country Code Validation Middleware
 * 
 * UPDATED: Now works with the new /{lang}/* URL architecture where the first segment
 * is a LANGUAGE code (en, tr, de), NOT a country code.
 * 
 * The middleware now:
 * 1. Detects if the first segment is a valid language code (from SEO_LANGUAGES)
 * 2. If it's a language code, ALLOW the request (no redirect)
 * 3. Only redirect if it's NOT a valid language code (legacy country code format)
 * 
 * Examples:
 * - /en/station/any-radio → ALLOW (en is a language code)
 * - /tr/station/any-radio → ALLOW (tr is a language code) 
 * - /xx/station/any-radio → ALLOW (unknown codes just continue to next middleware)
 */

export async function stationCountryValidator(req: Request, res: Response, next: NextFunction): Promise<void> {
  const urlPath = req.path;
  
  // Match pattern: /:code/station/:slug
  const stationMatch = urlPath.match(/^\/([a-z]{2})\/(station)\/([^\/\?]+)$/i);
  
  if (!stationMatch) {
    return next();
  }
  
  const [, firstSegment] = stationMatch;
  const code = firstSegment.toLowerCase();
  
  // NEW ARCHITECTURE: If the first segment is a valid LANGUAGE code, always allow
  // URL format is /{lang}/station/{slug} where lang is a language (en, tr, de), NOT a country
  if (VALID_LANGUAGE_CODES.has(code)) {
    // This is a language code (en, tr, de, etc.) - allow request
    return next();
  }
  
  // If it's not a valid language code, it might be an old country code URL
  // For now, just allow it to continue - the SEO 301 redirect middleware will handle it
  return next();
}
