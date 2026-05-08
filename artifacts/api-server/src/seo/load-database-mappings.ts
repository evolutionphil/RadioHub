import { setDatabaseCountryLanguageMappings } from '@workspace/seo-shared/seo-config';
import { setDatabaseUrlTranslations } from '@workspace/seo-shared/url-translations';
import { performanceCache } from '../performance-cache';
import { logger } from '../utils/logger';

export async function loadDatabaseCountryLanguageMappings(): Promise<void> {
  try {
    const mappings = await performanceCache.getCountryLanguageMappings();
    setDatabaseCountryLanguageMappings(mappings);
  } catch (error) {
    logger.error('Failed to load database country-language mappings:', error);
  }
}

export async function loadDatabaseUrlTranslations(): Promise<void> {
  try {
    const translations = await performanceCache.getUrlTranslations();
    setDatabaseUrlTranslations(translations);
  } catch (error) {
    logger.error('Failed to load database URL translations:', error);
  }
}
