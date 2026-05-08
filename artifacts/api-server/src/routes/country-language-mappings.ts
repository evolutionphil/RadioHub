import { Express } from 'express';

// Bound the audit collection's working set. The 180-day TTL on the schema
// caps total growth, but the panel only needs a recent slice — so we both
// limit list responses and prune older entries beyond this cap on write.
const CLEAR_OVERRIDES_AUDIT_MAX_ENTRIES = 100;
const CLEAR_OVERRIDES_AUDIT_LIST_LIMIT = 25;
const CLEAR_OVERRIDES_AUDIT_MAX_PAGE_LIMIT = 100;

// Mongo treats unescaped regex metacharacters as operators. Strip them so
// admin-provided filter strings are matched literally (case-insensitive).
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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
      const { COUNTRY_TO_CODE } = await import('@workspace/seo-shared/seo-config');
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
      const { COUNTRY_TO_LANGUAGE } = await import('@workspace/seo-shared/seo-config');
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
      const { SEO_LANGUAGES } = await import('@workspace/seo-shared/seo-config');
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
      const { COUNTRY_TO_LANGUAGE, SEO_LANGUAGES } = await import('@workspace/seo-shared/seo-config');

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

      const actorEmail =
        (req.user as { email?: string } | undefined)?.email ?? undefined;
      const languageNames: Record<string, string> = {};
      for (const lang of SEO_LANGUAGES) {
        languageNames[lang.code] = lang.name;
      }

      // Persist an audit entry for every Clear overrides invocation —
      // including no-ops — so admins always have a record of who pressed
      // the button and when, even if nothing was deleted.
      const persistAuditEntry = async (deletedCount: number) => {
        try {
          const { ClearedOverridesAuditLog } = await import('../shared/mongo-schemas');
          await ClearedOverridesAuditLog.create({
            actorEmail: actorEmail ?? null,
            deletedCount,
            snapshot: overrideSnapshot,
          });

          // Enforce a soft cap on total entries so the panel and backing
          // queries stay snappy. The TTL on the schema covers the long tail.
          const total = await ClearedOverridesAuditLog.estimatedDocumentCount();
          if (total > CLEAR_OVERRIDES_AUDIT_MAX_ENTRIES) {
            const excess = total - CLEAR_OVERRIDES_AUDIT_MAX_ENTRIES;
            const oldest = await ClearedOverridesAuditLog
              .find({}, { _id: 1 })
              .sort({ createdAt: 1 })
              .limit(excess)
              .lean();
            if (oldest.length > 0) {
              await ClearedOverridesAuditLog.deleteMany({
                _id: { $in: oldest.map((d) => d._id) },
              });
            }
          }
        } catch (err) {
          console.error('Failed to persist cleared-overrides audit entry:', err);
        }
      };

      if (overrideSnapshot.length === 0) {
        await persistAuditEntry(0);
        return res.json({ success: true, deletedCount: 0 });
      }

      const overrideCountryCodes = overrideSnapshot.map(m => m.countryCode);
      const result = await CountryLanguageMapping.deleteMany({ countryCode: { $in: overrideCountryCodes } });

      // Clear performance cache to force reload
      const { performanceCache } = await import('../performance-cache');
      performanceCache.clearCountryLanguageMappings();

      console.log(`✅ Deleted ${result.deletedCount} overridden country-language mappings`);

      await persistAuditEntry(result.deletedCount);

      // Fire-and-forget audit email of the cleared overrides CSV. Opt-in via
      // ADMIN_AUDIT_EMAIL_RECIPIENTS env var; safe no-op when unset.
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

  // List cleared-overrides audit entries for the in-app history panel.
  // Supports pagination and filtering so admins can find a specific clear
  // by actor email, date range, or affected country (matching the snapshot
  // by country code or country name) without scrolling. The on-write prune
  // keeps total count bounded by CLEAR_OVERRIDES_AUDIT_MAX_ENTRIES.
  app.get('/api/admin/country-language-mappings/cleared-overrides-log', requireAdmin, async (req, res) => {
    try {
      const { ClearedOverridesAuditLog } = await import('../shared/mongo-schemas');

      const parseIntParam = (raw: unknown, fallback: number, max?: number) => {
        const n = typeof raw === 'string' ? parseInt(raw, 10) : NaN;
        if (!Number.isFinite(n) || n < 0) return fallback;
        return max !== undefined ? Math.min(n, max) : n;
      };

      const limit = Math.max(
        1,
        parseIntParam(
          req.query.limit,
          CLEAR_OVERRIDES_AUDIT_LIST_LIMIT,
          CLEAR_OVERRIDES_AUDIT_MAX_PAGE_LIMIT,
        ),
      );
      const offset = parseIntParam(req.query.offset, 0);

      const actorEmail =
        typeof req.query.actorEmail === 'string'
          ? req.query.actorEmail.trim()
          : '';
      const country =
        typeof req.query.country === 'string' ? req.query.country.trim() : '';
      const fromRaw = typeof req.query.from === 'string' ? req.query.from : '';
      const toRaw = typeof req.query.to === 'string' ? req.query.to : '';

      const filter: Record<string, unknown> = {};

      if (actorEmail) {
        filter.actorEmail = { $regex: escapeRegex(actorEmail), $options: 'i' };
      }

      if (country) {
        const re = { $regex: escapeRegex(country), $options: 'i' };
        filter.$or = [
          { 'snapshot.countryCode': re },
          { 'snapshot.countryName': re },
        ];
      }

      const createdAt: Record<string, Date> = {};
      const fromDate = fromRaw ? new Date(fromRaw) : null;
      if (fromDate && !isNaN(fromDate.getTime())) {
        createdAt.$gte = fromDate;
      }
      const toDate = toRaw ? new Date(toRaw) : null;
      if (toDate && !isNaN(toDate.getTime())) {
        // If admins pass a date-only value (YYYY-MM-DD), treat the upper
        // bound as inclusive of that whole day so a same-day from/to picks
        // up entries created later in the day.
        if (/^\d{4}-\d{2}-\d{2}$/.test(toRaw)) {
          toDate.setUTCHours(23, 59, 59, 999);
        }
        createdAt.$lte = toDate;
      }
      if (Object.keys(createdAt).length > 0) {
        filter.createdAt = createdAt;
      }

      const [entries, total] = await Promise.all([
        ClearedOverridesAuditLog
          .find(filter, { snapshot: 0 })
          .sort({ createdAt: -1 })
          .skip(offset)
          .limit(limit)
          .lean<Array<{
            _id: unknown;
            actorEmail: string | null;
            deletedCount: number;
            createdAt: Date;
          }>>(),
        ClearedOverridesAuditLog.countDocuments(filter),
      ]);

      res.json({
        entries: entries.map((e) => ({
          id: String(e._id),
          actorEmail: e.actorEmail,
          deletedCount: e.deletedCount,
          createdAt: e.createdAt,
        })),
        total,
        limit,
        offset,
      });
      return;
    } catch (error) {
      console.error('Error listing cleared-overrides audit log:', error);
      res.status(500).json({ error: 'Failed to list cleared-overrides audit log' });
      return;
    }
  });

  // Stream the CSV for a specific cleared-overrides audit entry so admins
  // can download the original snapshot from the dashboard, mirroring the
  // emailed attachment exactly.
  app.get('/api/admin/country-language-mappings/cleared-overrides-log/:id/csv', requireAdmin, async (req, res) => {
    try {
      const mongoose = (await import('mongoose')).default;
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ error: 'Invalid audit entry id' });
      }

      const { ClearedOverridesAuditLog } = await import('../shared/mongo-schemas');
      const { SEO_LANGUAGES } = await import('@workspace/seo-shared/seo-config');
      const entry = await ClearedOverridesAuditLog.findById(id).lean<{
        _id: unknown;
        snapshot: Array<{
          countryCode: string;
          countryName: string;
          currentLanguageCode: string;
          defaultLanguageCode: string;
        }>;
        createdAt: Date;
      }>();

      if (!entry) {
        return res.status(404).json({ error: 'Audit entry not found' });
      }

      const languageNames: Record<string, string> = {};
      for (const lang of SEO_LANGUAGES) {
        languageNames[lang.code] = lang.name;
      }

      const { buildClearedOverridesCsv } = await import('../services/admin-audit-email');
      const csv = buildClearedOverridesCsv(entry.snapshot, languageNames);

      const when = new Date(entry.createdAt);
      const yyyy = when.getFullYear();
      const mm = String(when.getMonth() + 1).padStart(2, '0');
      const dd = String(when.getDate()).padStart(2, '0');
      const filename = `country-overrides-${yyyy}-${mm}-${dd}.csv`;

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      // Prefix with a UTF-8 BOM so Excel opens the file with the right encoding.
      res.send('\ufeff' + csv);
      return;
    } catch (error) {
      console.error('Error downloading cleared-overrides audit CSV:', error);
      res.status(500).json({ error: 'Failed to download cleared-overrides audit CSV' });
      return;
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
  app.delete('/api/admin/country-language-mappings', requireAdmin, async (req, res) => {
    try {
      const { CountryLanguageMapping } = await import('../shared/mongo-schemas');
      const { SEO_LANGUAGES } = await import('@workspace/seo-shared/seo-config');

      // Snapshot every mapping before deletion so the audit email captures
      // exactly what was wiped, mirroring the "Cleared overrides" flow.
      const snapshot = await CountryLanguageMapping
        .find({}, { countryCode: 1, countryName: 1, languageCode: 1, isActive: 1, notes: 1 })
        .lean<Array<{
          countryCode: string;
          countryName?: string;
          languageCode: string;
          isActive?: boolean;
          notes?: string;
        }>>();

      const result = await CountryLanguageMapping.deleteMany({});

      // Clear performance cache to force reload
      const { performanceCache } = await import('../performance-cache');
      performanceCache.clearCountryLanguageMappings();

      console.log(`✅ Deleted all ${result.deletedCount} country-language mappings`);

      // Fire-and-forget audit email of the wiped mappings. Opt-in via
      // ADMIN_AUDIT_EMAIL_RECIPIENTS env var; safe no-op when unset.
      if (snapshot.length > 0) {
        const languageNames: Record<string, string> = {};
        for (const lang of SEO_LANGUAGES) {
          languageNames[lang.code] = lang.name;
        }
        const actorEmail =
          (req.user as { email?: string } | undefined)?.email ?? undefined;
        const rows = snapshot.map((m) => ({
          countryCode: m.countryCode,
          countryName: m.countryName || m.countryCode,
          languageCode: m.languageCode,
          isActive: m.isActive !== false,
          notes: m.notes || '',
        }));
        void import('../services/admin-audit-email')
          .then(({ emailResetAllMappingsCsv }) =>
            emailResetAllMappingsCsv({ rows, languageNames, actorEmail }),
          )
          .catch((err) => {
            console.error('Failed to load admin-audit-email service:', err);
          });
      }

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
