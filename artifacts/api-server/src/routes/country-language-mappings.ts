import { Express } from 'express';
import { pgLocalization } from '../data/postgres-localization-store';

type CountryLanguageMappingAuditAction = 'clear-overrides' | 'reset-all' | 'edit' | 'delete' | 'bulk-save';

async function refreshMappingCache(): Promise<void> {
  const { performanceCache } = await import('../performance-cache');
  performanceCache.clearCountryLanguageMappings();
  {
    const { loadDatabaseCountryLanguageMappings } = await import('../seo/load-database-mappings');
    await loadDatabaseCountryLanguageMappings();
  }
}

// Bound the audit collection's working set. The 180-day TTL on the schema
// caps total growth, but the panel only needs a recent slice — so we both
// limit list responses and prune older entries beyond this cap on write.

const CLEAR_OVERRIDES_AUDIT_LIST_LIMIT = 50;
const CLEAR_OVERRIDES_AUDIT_MAX_PAGE_LIMIT = 100;

// Mongo treats unescaped regex metacharacters as operators. Strip them so
// admin-provided filter strings are matched literally (case-insensitive).


const VALID_AUDIT_ACTIONS: ReadonlyArray<CountryLanguageMappingAuditAction> = [
  'clear-overrides',
  'reset-all',
  'edit',
  'delete',
  'bulk-save',
];

/**
 * Persist a single audit entry for any country-language-mapping admin
 * action and prune older rows beyond the soft cap. Fire-and-forget: errors
 * are logged but never thrown so the originating request stays unaffected.
 */


function getActorEmail(req: { user?: unknown }): string | undefined {
  return (req.user as { email?: string } | undefined)?.email ?? undefined;
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

      const mappings = (await pgLocalization().getCountryLanguageMappings(false));
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

      const { countryCode, countryName, languageCode, isActive, notes } = req.body;

      if (!countryCode || !countryName || !languageCode) {
        return void res.status(400).json({ error: 'countryCode, countryName, and languageCode are required' });
      }

      {
        const mappings = await pgLocalization().saveCountryLanguageMappings([{ countryCode, countryName, languageCode, isActive, notes }], 'edit', getActorEmail(req));
        await refreshMappingCache();
        return void res.json(mappings[0]);
      }

      // Capture the previous languageCode (if any) so the audit entry can
      // record a true before/after diff rather than just the new value.

    } catch (error) {
      console.error('Error saving country-language mapping:', error);
      res.status(500).json({ error: 'Failed to save country-language mapping' });
    }
  });

  // Bulk update country-language mappings
  app.post('/api/admin/country-language-mappings/bulk', requireAdmin, async (req, res) => {
    try {

      const { mappings } = req.body;

      if (!Array.isArray(mappings)) {
        return void res.status(400).json({ error: 'mappings array is required' });
      }

      {
        const valid = mappings.filter((mapping) => mapping && mapping.countryCode && mapping.countryName && mapping.languageCode);
        const saved = await pgLocalization().saveCountryLanguageMappings(valid, 'bulk-save', getActorEmail(req));
        await refreshMappingCache();
        return void res.json({ success: true, count: saved.length, mappings: saved });
      }

      // Snapshot prior languageCodes for every country we're about to touch
      // so the audit entry records true before/after diffs in one write.

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

      const { COUNTRY_TO_LANGUAGE, SEO_LANGUAGES } = await import('@workspace/seo-shared/seo-config');

      const pgDeletion = (await pgLocalization().deleteCountryLanguageMappings('overrides', COUNTRY_TO_LANGUAGE, getActorEmail(req)));
      const allMappings = (pgDeletion.snapshot);
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

      const actorEmail = getActorEmail(req);
      const languageNames: Record<string, string> = {};
      for (const lang of SEO_LANGUAGES) {
        languageNames[lang.code] = lang.name;
      }

      if (overrideSnapshot.length === 0) {

        return void res.json({ success: true, deletedCount: 0 });
      }


      const result = pgDeletion;

      // Clear performance cache to force reload
      await refreshMappingCache();

      console.log(`✅ Deleted ${result.deletedCount} overridden country-language mappings`);



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

  // List recent admin-action audit entries for the in-app history panel.
  // Supports pagination and filtering so admins can find a specific clear
  // by actor email, date range, or affected country (matching the snapshot
  // by country code or country name) without scrolling. The on-write prune
  // keeps total count bounded by CLEAR_OVERRIDES_AUDIT_MAX_ENTRIES.
  app.get('/api/admin/country-language-mappings/cleared-overrides-log', requireAdmin, async (req, res) => {
    try {


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

      const actionParam = typeof req.query.action === 'string' ? req.query.action : undefined;
      const actorEmail =
        typeof req.query.actorEmail === 'string'
          ? req.query.actorEmail.trim()
          : '';
      const country =
        typeof req.query.country === 'string' ? req.query.country.trim() : '';
      const fromRaw = typeof req.query.from === 'string' ? req.query.from : '';
      const toRaw = typeof req.query.to === 'string' ? req.query.to : '';



      if (actionParam && actionParam !== 'all') {
        if (!VALID_AUDIT_ACTIONS.includes(actionParam as CountryLanguageMappingAuditAction)) {
          return void res.status(400).json({ error: 'Invalid action filter' });
        }

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


      // Exclude the bulky `snapshot` array from the list response — it can
      // be hundreds of entries per row for reset-all. The per-entry CSV
      // endpoint loads it on demand. `changes` stays inline so the panel
      // can render diffs without an extra round-trip per row.
      const pgPage = (await pgLocalization().listMappingAudit({
        action: actionParam, actorEmail, country, from: createdAt.$gte, to: createdAt.$lte,
      }, limit, offset));
      const [entries, total] = ([pgPage.entries, pgPage.total]);

      res.json({
        entries: entries.map((e) => ({
          id: String(e._id),
          // Default to 'clear-overrides' for any pre-existing rows written
          // before the action field was introduced.
          action: e.action ?? 'clear-overrides',
          actorEmail: e.actorEmail,
          deletedCount: e.deletedCount,
          changes: e.changes ?? [],
          createdAt: e.createdAt,
        })),
        total,
        limit,
        offset,
      });
      return;
    } catch (error) {
      console.error('Error listing country-language-mapping audit log:', error);
      res.status(500).json({ error: 'Failed to list audit log' });
      return;
    }
  });

  // Stream a single combined CSV containing every snapshot row across
  // every audit entry that matches the same actor/country/date/action
  // filters as the list endpoint. Lets admins hand off a quarterly audit
  // report in one file instead of downloading per-entry CSVs.
  //
  // NOTE: this is registered before the parameterized `/:id/csv` route so
  // the literal "all/csv" path doesn't get captured as `:id = "all"`.
  app.get('/api/admin/country-language-mappings/cleared-overrides-log/all/csv', requireAdmin, async (req, res) => {
    try {


      const actionParam = typeof req.query.action === 'string' ? req.query.action : undefined;
      const actorEmail =
        typeof req.query.actorEmail === 'string'
          ? req.query.actorEmail.trim()
          : '';
      const country =
        typeof req.query.country === 'string' ? req.query.country.trim() : '';
      const fromRaw = typeof req.query.from === 'string' ? req.query.from : '';
      const toRaw = typeof req.query.to === 'string' ? req.query.to : '';



      if (actionParam && actionParam !== 'all') {
        if (!VALID_AUDIT_ACTIONS.includes(actionParam as CountryLanguageMappingAuditAction)) {
          return res.status(400).json({ error: 'Invalid action filter' });
        }

      }





      const createdAt: Record<string, Date> = {};
      const fromDate = fromRaw ? new Date(fromRaw) : null;
      if (fromDate && !isNaN(fromDate.getTime())) {
        createdAt.$gte = fromDate;
      }
      const toDate = toRaw ? new Date(toRaw) : null;
      if (toDate && !isNaN(toDate.getTime())) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(toRaw)) {
          toDate.setUTCHours(23, 59, 59, 999);
        }
        createdAt.$lte = toDate;
      }


      const entries = ((await pgLocalization().listMappingAudit({ action: actionParam, actorEmail, country, from: createdAt.$gte, to: createdAt.$lte })).entries);

      const { buildClearedOverridesHistoryCsv } = await import('../services/admin-audit-email');

      // One CSV row per snapshot entry across every matching audit row.
      // Audit entries with an empty snapshot (e.g. a no-op clear, or
      // edit/delete/bulk-save action types whose detail lives in
      // `changes` instead of `snapshot`) emit a single placeholder row so
      // the createdAt / actor / deletedCount metadata is still captured.
      const rows: Array<{
        createdAt: Date;
        actorEmail: string | null;
        deletedCount: number;
        countryCode: string;
        countryName: string;
        currentLanguageCode: string;
        defaultLanguageCode: string;
      }> = [];
      for (const e of entries) {
        const snap = e.snapshot ?? [];
        if (snap.length === 0) {
          rows.push({
            createdAt: e.createdAt,
            actorEmail: e.actorEmail,
            deletedCount: e.deletedCount,
            countryCode: '',
            countryName: '',
            currentLanguageCode: '',
            defaultLanguageCode: '',
          });
        } else {
          for (const s of snap) {
            rows.push({
              createdAt: e.createdAt,
              actorEmail: e.actorEmail,
              deletedCount: e.deletedCount,
              countryCode: s.countryCode,
              countryName: s.countryName,
              currentLanguageCode: s.currentLanguageCode,
              defaultLanguageCode: s.defaultLanguageCode,
            });
          }
        }
      }

      const csv = buildClearedOverridesHistoryCsv(rows);

      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const filename = `country-overrides-history-${yyyy}-${mm}-${dd}.csv`;

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send('\ufeff' + csv);
      return;
    } catch (error) {
      console.error('Error downloading combined cleared-overrides audit CSV:', error);
      res.status(500).json({ error: 'Failed to download combined cleared-overrides audit CSV' });
      return;
    }
  });

  // Stream the CSV for a specific cleared-overrides audit entry so admins
  // can download the original snapshot from the dashboard, mirroring the
  // emailed attachment exactly.
  app.get('/api/admin/country-language-mappings/cleared-overrides-log/:id/csv', requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      if (typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id)) {
        return void res.status(400).json({ error: 'Invalid audit entry id' });
      }


      const { SEO_LANGUAGES } = await import('@workspace/seo-shared/seo-config');
      const entry = (await pgLocalization().findMappingAudit(String(id)));

      if (!entry) {
        return void res.status(404).json({ error: 'Audit entry not found' });
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
        return void res.status(400).json({ error: 'mappings array is required' });
      }

      const valid = mappings.filter(
        (m): m is { countryCode: string; countryName: string; languageCode: string; isActive?: boolean; notes?: string } =>
          !!m && typeof m.countryCode === 'string' && !!m.countryCode &&
          typeof m.countryName === 'string' && !!m.countryName &&
          typeof m.languageCode === 'string' && !!m.languageCode,
      );

      if (valid.length === 0) {
        return void res.json({ success: true, restoredCount: 0, mappings: [] });
      }

      const restored = (await pgLocalization().saveCountryLanguageMappings(valid, 'bulk-save', getActorEmail(req)));

      await refreshMappingCache();

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

      const { COUNTRY_TO_LANGUAGE, SEO_LANGUAGES } = await import('@workspace/seo-shared/seo-config');

      // Snapshot every mapping before deletion so the audit email captures
      // exactly what was wiped, mirroring the "Cleared overrides" flow.
      const pgDeletion = (await pgLocalization().deleteCountryLanguageMappings('all', COUNTRY_TO_LANGUAGE, getActorEmail(req)));
      const snapshot = (pgDeletion.snapshot);

      const result = pgDeletion;

      // Clear performance cache to force reload
      await refreshMappingCache();

      console.log(`✅ Deleted all ${result.deletedCount} country-language mappings`);

      const actorEmail = getActorEmail(req);
      const defaults = COUNTRY_TO_LANGUAGE as Record<string, string>;

      // Always log reset-all so admins see who hit the button even when the
      // collection was already empty.



      // Fire-and-forget audit email of the wiped mappings. Opt-in via
      // ADMIN_AUDIT_EMAIL_RECIPIENTS env var; safe no-op when unset.
      if (snapshot.length > 0) {
        const languageNames: Record<string, string> = {};
        for (const lang of SEO_LANGUAGES) {
          languageNames[lang.code] = lang.name;
        }
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

      const { countryCode } = req.params;

      {
        await pgLocalization().deleteCountryLanguageMappings('country', {}, getActorEmail(req), String(countryCode));
        await refreshMappingCache();
        return void res.json({ success: true });
      }

      // Capture the document being deleted so the audit log records what
      // was actually removed (not just the country code).

    } catch (error) {
      console.error('Error deleting country-language mapping:', error);
      res.status(500).json({ error: 'Failed to delete country-language mapping' });
    }
  });

  // Manual trigger for the daily mapping-audit digest email (Task #211).
  // Same opt-in gates as the scheduled cron — if recipients or SendGrid
  // aren't configured the underlying sender skips with a structured
  // reason, which we surface to the admin UI for diagnostics.
  app.post('/api/admin/country-language-mappings/audit-digest/run', requireAdmin, async (_req, res) => {
    try {
      const { scheduledMappingAuditDigest } = await import(
        '../services/scheduled-mapping-audit-digest'
      );
      const result = await scheduledMappingAuditDigest.runOnce('manual:admin-api');
      if (result?.reason === 'error') {
        return void res.status(500).json({ ok: false, result, status: scheduledMappingAuditDigest.getStatus() });
      }
      res.json({ ok: true, result, status: scheduledMappingAuditDigest.getStatus() });
    } catch (error) {
      console.error('Error running mapping audit digest:', error);
      res.status(500).json({ error: 'Failed to run mapping audit digest' });
    }
  });
}
