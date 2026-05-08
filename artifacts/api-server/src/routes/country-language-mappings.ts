import { Express } from 'express';

/**
 * Country-Language Mapping Routes
 * 
 * These routes allow admins to manually configure which language each country should use.
 * This overrides the hardcoded COUNTRY_TO_LANGUAGE mapping in seo-config.ts
 */
export function registerCountryLanguageMappingRoutes(app: Express, requireAdmin: any) {
  // Get all country-language mappings
  app.get('/api/admin/country-language-mappings', requireAdmin, async (req, res) => {
    try {
      const { CountryLanguageMapping } = await import('../shared/mongo-schemas');
      const mappings = await CountryLanguageMapping.find().sort({ countryName: 1 }).lean();
      res.json(mappings);
    } catch (error) {
      console.error('Error fetching country-language mappings:', error);
      res.status(500).json({ error: 'Failed to fetch country-language mappings' });
    }
  });

  // Get all available countries from COUNTRY_TO_CODE
  app.get('/api/admin/available-countries', requireAdmin, async (req, res) => {
    try {
      const { COUNTRY_TO_CODE } = await import('../shared/seo-config');
      const countries = Object.keys(COUNTRY_TO_CODE).map(name => ({
        name,
        code: COUNTRY_TO_CODE[name]
      })).sort((a, b) => a.name.localeCompare(b.name));
      res.json(countries);
    } catch (error) {
      console.error('Error fetching available countries:', error);
      res.status(500).json({ error: 'Failed to fetch available countries' });
    }
  });

  // Get hardcoded country-language defaults from COUNTRY_TO_LANGUAGE
  app.get('/api/admin/country-language-defaults', requireAdmin, async (req, res) => {
    try {
      const { COUNTRY_TO_LANGUAGE } = await import('../shared/seo-config');
      const defaults = Object.entries(COUNTRY_TO_LANGUAGE).map(([countryCode, languageCode]) => ({
        countryCode,
        languageCode,
      }));
      res.json(defaults);
    } catch (error) {
      console.error('Error fetching country-language defaults:', error);
      res.status(500).json({ error: 'Failed to fetch country-language defaults' });
    }
  });

  // Get all available languages from SEO_LANGUAGES
  app.get('/api/admin/available-languages', requireAdmin, async (req, res) => {
    try {
      const { SEO_LANGUAGES } = await import('../shared/seo-config');
      const languages = SEO_LANGUAGES.map(lang => ({
        code: lang.code,
        name: lang.name
      })).sort((a, b) => a.name.localeCompare(b.name));
      res.json(languages);
    } catch (error) {
      console.error('Error fetching available languages:', error);
      res.status(500).json({ error: 'Failed to fetch available languages' });
    }
  });

  // Create or update a country-language mapping
  app.post('/api/admin/country-language-mappings', requireAdmin, async (req, res) => {
    try {
      const { CountryLanguageMapping } = await import('../shared/mongo-schemas');
      const { countryCode, countryName, languageCode, isActive, notes } = req.body;

      if (!countryCode || !countryName || !languageCode) {
        return res.status(400).json({ error: 'countryCode, countryName, and languageCode are required' });
      }

      const mapping = await CountryLanguageMapping.findOneAndUpdate(
        { countryCode },
        {
          countryCode,
          countryName,
          languageCode,
          isActive: isActive !== undefined ? isActive : true,
          notes: notes || '',
          updatedAt: new Date()
        },
        { upsert: true, returnDocument: 'after' }
      );

      // Clear performance cache to force reload
      const { performanceCache } = await import('../performance-cache');
      performanceCache.clearCountryLanguageMappings();

      console.log(`✅ Updated country-language mapping: ${countryName} (${countryCode}) → ${languageCode}`);
      res.json(mapping);
    } catch (error) {
      console.error('Error saving country-language mapping:', error);
      res.status(500).json({ error: 'Failed to save country-language mapping' });
    }
  });

  // Bulk update country-language mappings
  app.post('/api/admin/country-language-mappings/bulk', requireAdmin, async (req, res) => {
    try {
      const { CountryLanguageMapping } = await import('../shared/mongo-schemas');
      const { mappings } = req.body;

      if (!Array.isArray(mappings)) {
        return res.status(400).json({ error: 'mappings array is required' });
      }

      const results = await Promise.all(
        mappings.map(async (mapping) => {
          if (!mapping.countryCode || !mapping.countryName || !mapping.languageCode) {
            return null;
          }

          return CountryLanguageMapping.findOneAndUpdate(
            { countryCode: mapping.countryCode },
            {
              countryCode: mapping.countryCode,
              countryName: mapping.countryName,
              languageCode: mapping.languageCode,
              isActive: mapping.isActive !== undefined ? mapping.isActive : true,
              notes: mapping.notes || '',
              updatedAt: new Date()
            },
            { upsert: true, returnDocument: 'after' }
          );
        })
      );

      const validResults = results.filter(r => r !== null);

      // Clear performance cache to force reload
      const { performanceCache } = await import('../performance-cache');
      performanceCache.clearCountryLanguageMappings();

      console.log(`✅ Bulk updated ${validResults.length} country-language mappings`);
      res.json({ 
        success: true, 
        count: validResults.length,
        mappings: validResults 
      });
    } catch (error) {
      console.error('Error bulk updating country-language mappings:', error);
      res.status(500).json({ error: 'Failed to bulk update country-language mappings' });
    }
  });

  // Delete only the country-language mappings whose languageCode differs from
  // the hardcoded COUNTRY_TO_LANGUAGE default. After deletion, the affected
  // countries fall back to that default. Mappings that already match the
  // default (or whose country is missing from the default map) are left alone.
  app.delete('/api/admin/country-language-mappings/overrides', requireAdmin, async (req, res) => {
    try {
      const { CountryLanguageMapping } = await import('../shared/mongo-schemas');
      const { COUNTRY_TO_LANGUAGE, SEO_LANGUAGES } = await import('../shared/seo-config');

      const allMappings = await CountryLanguageMapping
        .find({}, { countryCode: 1, countryName: 1, languageCode: 1 })
        .lean<Array<{ countryCode: string; countryName?: string; languageCode: string }>>();
      const defaults = COUNTRY_TO_LANGUAGE as Record<string, string>;
      const overrideSnapshot = allMappings
        .filter(m => {
          const def = defaults[m.countryCode];
          return !!def && m.languageCode !== def;
        })
        .map(m => ({
          countryCode: m.countryCode,
          countryName: m.countryName || m.countryCode,
          currentLanguageCode: m.languageCode,
          defaultLanguageCode: defaults[m.countryCode]!,
        }));

      if (overrideSnapshot.length === 0) {
        return res.json({ success: true, deletedCount: 0 });
      }

      const overrideCountryCodes = overrideSnapshot.map(m => m.countryCode);
      const result = await CountryLanguageMapping.deleteMany({ countryCode: { $in: overrideCountryCodes } });

      // Clear performance cache to force reload
      const { performanceCache } = await import('../performance-cache');
      performanceCache.clearCountryLanguageMappings();

      console.log(`✅ Deleted ${result.deletedCount} overridden country-language mappings`);

      // Fire-and-forget audit email of the cleared overrides CSV. Opt-in via
      // ADMIN_AUDIT_EMAIL_RECIPIENTS env var; safe no-op when unset.
      const languageNames: Record<string, string> = {};
      for (const lang of SEO_LANGUAGES) {
        languageNames[lang.code] = lang.name;
      }
      const actorEmail =
        (req.user as { email?: string } | undefined)?.email ?? undefined;
      void import('../services/admin-audit-email')
        .then(({ emailClearedOverridesCsv }) =>
          emailClearedOverridesCsv({
            rows: overrideSnapshot,
            languageNames,
            actorEmail,
          }),
        )
        .catch((err) => {
          console.error('Failed to load admin-audit-email service:', err);
        });

      res.json({ success: true, deletedCount: result.deletedCount });
    } catch (error) {
      console.error('Error deleting overridden country-language mappings:', error);
      res.status(500).json({ error: 'Failed to delete overridden country-language mappings' });
    }
  });

  // Restore a snapshot of country-language mappings. Used to power the
  // "Undo" action on the Clear overrides toast. Each entry is upserted by
  // countryCode so the mappings are restored exactly as they were even if
  // (rare) someone re-added a mapping for the same country in between.
  app.post('/api/admin/country-language-mappings/restore', requireAdmin, async (req, res) => {
    try {
      const { CountryLanguageMapping } = await import('../shared/mongo-schemas');
      const { mappings } = req.body as {
        mappings?: Array<{
          countryCode?: string;
          countryName?: string;
          languageCode?: string;
          isActive?: boolean;
          notes?: string;
        }>;
      };

      if (!Array.isArray(mappings)) {
        return res.status(400).json({ error: 'mappings array is required' });
      }

      const valid = mappings.filter(
        (m): m is { countryCode: string; countryName: string; languageCode: string; isActive?: boolean; notes?: string } =>
          !!m && typeof m.countryCode === 'string' && !!m.countryCode &&
          typeof m.countryName === 'string' && !!m.countryName &&
          typeof m.languageCode === 'string' && !!m.languageCode,
      );

      if (valid.length === 0) {
        return res.json({ success: true, restoredCount: 0, mappings: [] });
      }

      const restored = await Promise.all(
        valid.map(m =>
          CountryLanguageMapping.findOneAndUpdate(
            { countryCode: m.countryCode },
            {
              countryCode: m.countryCode,
              countryName: m.countryName,
              languageCode: m.languageCode,
              isActive: m.isActive !== undefined ? m.isActive : true,
              notes: m.notes || '',
              updatedAt: new Date(),
            },
            { upsert: true, returnDocument: 'after' },
          ),
        ),
      );

      const { performanceCache } = await import('../performance-cache');
      performanceCache.clearCountryLanguageMappings();

      console.log(`✅ Restored ${restored.length} country-language mappings`);
      res.json({ success: true, restoredCount: restored.length, mappings: restored });
    } catch (error) {
      console.error('Error restoring country-language mappings:', error);
      res.status(500).json({ error: 'Failed to restore country-language mappings' });
    }
  });

  // Delete all country-language mappings
  app.delete('/api/admin/country-language-mappings', requireAdmin, async (_req, res) => {
    try {
      const { CountryLanguageMapping } = await import('../shared/mongo-schemas');

      const result = await CountryLanguageMapping.deleteMany({});

      // Clear performance cache to force reload
      const { performanceCache } = await import('../performance-cache');
      performanceCache.clearCountryLanguageMappings();

      console.log(`✅ Deleted all ${result.deletedCount} country-language mappings`);
      res.json({ success: true, deletedCount: result.deletedCount });
    } catch (error) {
      console.error('Error deleting all country-language mappings:', error);
      res.status(500).json({ error: 'Failed to delete all country-language mappings' });
    }
  });

  // Delete a country-language mapping
  app.delete('/api/admin/country-language-mappings/:countryCode', requireAdmin, async (req, res) => {
    try {
      const { CountryLanguageMapping } = await import('../shared/mongo-schemas');
      const { countryCode } = req.params;

      await CountryLanguageMapping.deleteOne({ countryCode });

      // Clear performance cache to force reload
      const { performanceCache } = await import('../performance-cache');
      performanceCache.clearCountryLanguageMappings();

      console.log(`✅ Deleted country-language mapping for country code: ${countryCode}`);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting country-language mapping:', error);
      res.status(500).json({ error: 'Failed to delete country-language mapping' });
    }
  });
}
