import type { Express, Request, Response } from 'express';
import {
  Genre,
  GenreWhitelistOverride,
  SAFE_GENRE_SLUG_RE,
  Station,
  normalizeGenreSlug,
} from '@workspace/db-shared/mongo-schemas';
import {
  GENRE_WHITELIST,
  GENRE_ALIASES,
  MIN_STATIONS_FOR_GENRE_INDEX,
} from '../seo/genre-whitelist';
import {
  getMergedWhitelist,
  getMergedAliases,
  refreshGenreWhitelistFromDb,
  getLastRefreshAt,
} from '../seo/genre-whitelist-store';
import { RESERVED_GENRE_SLUGS, isReservedGenreSlug } from '../seo/reserved-genre-slugs';
import { logger } from '../utils/logger';
import { IndexNowService } from '../services/indexnow';
import { buildAllSitemapManifests } from '../seo/sitemap-manifest-builder';
import { getCachedQualifiedLanguages } from '../seo/qualified-languages';
import { buildLocalizedUrl } from '../seo/url-helpers';
import { URL_TRANSLATIONS } from '@workspace/seo-shared/url-translations';
import { performanceCache } from '../performance-cache';
import {
  getGenreStationCountsStatus,
  recomputeGenreStationCounts,
} from '../services/genre-station-counts';
import {
  startPushStatus,
  updatePushStep,
  completePushStatus,
  getLastPushStatus,
  getRecentPushHistory,
} from '../seo/genre-whitelist-push-status';

const PUSH_HISTORY_LIMIT = 20;

const PRIMARY_HOST = 'themegaradio.com';

// Build the merged forward translation map (database overrides + static)
// the same way the sitemap routes do. Keeps the per-language genre URLs
// we ping IndexNow with in lockstep with what's actually published in
// the sitemap.
async function loadForwardTranslationMap(): Promise<Map<string, string>> {
  const forwardMap = new Map<string, string>();
  try {
    const dbTranslations = await performanceCache.getUrlTranslations();
    for (const [k, v] of dbTranslations) forwardMap.set(k, v);
  } catch (err: any) {
    // Non-fatal — we'll fall back to static translations only.
    logger.error('genre-whitelist: failed to load db url translations:', err?.message ?? err);
  }
  for (const [lang, translations] of Object.entries(URL_TRANSLATIONS)) {
    for (const [english, translated] of Object.entries(translations)) {
      const key = `${lang}:${english}`;
      if (!forwardMap.has(key)) forwardMap.set(key, translated);
    }
  }
  return forwardMap;
}

// Fire-and-forget: force-rebuild the sitemap manifests so the affected
// genre URLs appear/disappear from the published sitemap right away,
// then ping IndexNow with both the sitemap index and the affected
// /genres/<slug> URLs across every qualified language (sitemap publishes
// one localized URL per language, e.g. `/de/genre/<slug>`,
// `/it/generi/<slug>`). Without this the change would only become
// visible to Google/Bing on the next 6h manifest cycle.
//
// We deliberately do NOT await this — admins shouldn't wait on an
// outbound HTTP call to api.indexnow.org or a full manifest scan
// before their UI returns. Errors are logged and swallowed.
function triggerSearchEnginePush(
  affectedSlugs: string[],
  meta: { triggeredBy: string | null; trigger: string },
): void {
  // Each push gets its own isolated `pushId`. All step updates +
  // completion are scoped to that id so overlapping fire-and-forget
  // pushes (e.g. an admin spam-clicking add/remove) can never overwrite
  // each other's step state or persist a cross-pollinated history row
  // (task #255).
  const pushId = startPushStatus({
    triggeredBy: meta.triggeredBy,
    trigger: meta.trigger,
    affectedSlugs,
  });
  void (async () => {
    try {
      await buildAllSitemapManifests({ force: true });
      updatePushStep(pushId, 'sitemapRebuild', { status: 'success' });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      logger.error('genre-whitelist: sitemap rebuild failed:', msg);
      updatePushStep(pushId, 'sitemapRebuild', { status: 'failed', error: msg });
    }
    try {
      const result = await IndexNowService.submitSitemaps(undefined, 'sitemap-regen');
      if (result.success) {
        updatePushStep(pushId, 'indexnowSitemap', { status: 'success', urlCount: 1 });
      } else {
        updatePushStep(pushId, 'indexnowSitemap', {
          status: 'failed',
          error: result.error ?? `IndexNow returned status ${result.statusCode ?? 'unknown'}`,
        });
      }
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      logger.error('genre-whitelist: IndexNow sitemap ping failed:', msg);
      updatePushStep(pushId, 'indexnowSitemap', { status: 'failed', error: msg });
    }
    if (affectedSlugs.length === 0) {
      updatePushStep(pushId, 'indexnowGenreUrls', { status: 'skipped' });
      completePushStatus(pushId);
      return;
    }

    // Expand per qualified language using the same translation map the
    // sitemap uses, so we ping the canonical localized URL (not a
    // redirect source). Fall back to a single `/en/...` ping if we
    // can't load qualified languages — better than nothing.
    try {
      const languages = await getCachedQualifiedLanguages();
      const translations = await loadForwardTranslationMap();
      const urls: string[] = [];
      for (const slug of affectedSlugs) {
        for (const lang of languages) {
          const path = buildLocalizedUrl(`/genres/${slug}`, lang, undefined, translations);
          urls.push(`https://${PRIMARY_HOST}${path}`);
        }
      }
      if (urls.length > 0) {
        const result = await IndexNowService.submitToIndexNow(urls, 'manual');
        if (result.success) {
          updatePushStep(pushId, 'indexnowGenreUrls', { status: 'success', urlCount: urls.length });
        } else {
          updatePushStep(pushId, 'indexnowGenreUrls', {
            status: 'failed',
            error: result.error ?? `IndexNow returned status ${result.statusCode ?? 'unknown'}`,
            urlCount: urls.length,
          });
        }
      } else {
        updatePushStep(pushId, 'indexnowGenreUrls', { status: 'skipped' });
      }
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      logger.error('genre-whitelist: IndexNow genre URL ping failed:', msg);
      // Best-effort fallback: ping the English canonical only.
      try {
        const fallback = await IndexNowService.submitGenreUrls(affectedSlugs, undefined, 'manual');
        if (fallback.success) {
          updatePushStep(pushId, 'indexnowGenreUrls', {
            status: 'success',
            urlCount: affectedSlugs.length,
            error: `Localized expansion failed (${msg}); fell back to English-only ping.`,
          });
        } else {
          updatePushStep(pushId, 'indexnowGenreUrls', {
            status: 'failed',
            error: `Localized expansion failed (${msg}); fallback also failed: ${fallback.error ?? 'unknown'}`,
          });
        }
      } catch (fallbackErr: any) {
        const fbMsg = fallbackErr?.message ?? String(fallbackErr);
        logger.error('genre-whitelist: IndexNow fallback ping failed:', fbMsg);
        updatePushStep(pushId, 'indexnowGenreUrls', {
          status: 'failed',
          error: `${msg} (fallback: ${fbMsg})`,
        });
      }
    }
    completePushStatus(pushId);
  })();
}

// Admin endpoints backing the "Genre whitelist" dashboard page (task #114).
// Each mutation:
//   1. Validates the slug shape (lowercase + hyphens only — same shape as
//      the static seed in `genre-whitelist.ts`).
//   2. Persists a row in `GenreWhitelistOverride`.
//   3. Calls `refreshGenreWhitelistFromDb()` so the in-memory snapshot is
//      consistent before we respond — the SSR layer reads it sync.
//
// The merged set drives both SSR (`isWhitelistedGenreSlug` /
// `getCanonicalGenreSlug` in seo-renderer.ts) and the sitemap manifest
// builder, so a removal noindexes the page immediately and drops it
// from the sitemap on the next manifest rebuild — same path the static
// file would have taken.

const MAX_SLUG_LEN = 64;
const MAX_NOTES_LEN = 500;

// Task #205: route every admin-typed slug through the shared
// `normalizeGenreSlug` + `SAFE_GENRE_SLUG_RE` pair (the same gate the
// Genre.slug schema validator uses), and refuse to silently coerce. If
// what the admin typed doesn't already match the safe charset we return
// 422 with the normalized suggestion instead of quietly rewriting their
// input — a surprise rewrite is exactly how typos used to slip into
// `GenreWhitelistOverride` rows and SEO URLs.
type SlugParseResult =
  | { ok: true; slug: string }
  | { ok: false; status: 400 | 422; error: string };

function parseAdminSlug(input: unknown, field = 'slug'): SlugParseResult {
  if (typeof input !== 'string') {
    return { ok: false, status: 400, error: `Invalid ${field} — must be a string` };
  }
  // Compare against the raw typed value — do NOT trim first. Surrounding
  // whitespace is itself a coercion the admin would otherwise not see, so
  // we surface it as a 422 with a "Did you mean ..." suggestion rather
  // than silently stripping it (Task #205).
  if (input.length === 0) {
    return { ok: false, status: 400, error: `Invalid ${field} — empty` };
  }
  if (input.length > MAX_SLUG_LEN) {
    return {
      ok: false,
      status: 400,
      error: `Invalid ${field} — too long (max ${MAX_SLUG_LEN} characters)`,
    };
  }
  const normalized = normalizeGenreSlug(input);
  if (!normalized || !SAFE_GENRE_SLUG_RE.test(normalized)) {
    return {
      ok: false,
      status: 422,
      error: `Invalid ${field} "${input}" — must contain lowercase letters or digits separated by single hyphens`,
    };
  }
  if (normalized !== input) {
    return {
      ok: false,
      status: 422,
      error: `Invalid ${field} "${input}" — slugs must use only lowercase letters, digits, and single hyphens with no leading/trailing hyphens or surrounding whitespace. Did you mean "${normalized}"?`,
    };
  }
  return { ok: true, slug: normalized };
}

function getAdminUsername(req: Request): string | null {
  const adminAuth = (req.session as any)?.adminAuth;
  const username = adminAuth?.username;
  return typeof username === 'string' && username.length > 0 ? username : null;
}

export function registerAdminGenreWhitelistRoutes(app: Express, deps: any) {
  const { requireAdmin } = deps;

  // GET — return the merged snapshot, the static seed (for read-only
  // reference), and the raw override rows so the UI can show what's been
  // changed and by whom.
  app.get(
    '/api/admin/genre-whitelist',
    requireAdmin,
    async (_req: Request, res: Response) => {
      try {
        // Make sure the snapshot reflects writes from other replicas
        // before we hand it back to the dashboard.
        await refreshGenreWhitelistFromDb();

        const [overrides, pushHistory] = await Promise.all([
          GenreWhitelistOverride.find({}).sort({ kind: 1, slug: 1 }).lean(),
          getRecentPushHistory(PUSH_HISTORY_LIMIT),
        ]);

        const merged = getMergedWhitelist();
        const aliases = getMergedAliases();
        const sortedSlugs = Array.from(merged).sort();

        // Per-slug station counts so the UI can flag whitelisted slugs that
        // are too thin to actually appear in sitemaps / be served as
        // indexable. Mirrors the gate in sitemap-manifest-builder.ts:
        // Genre.stationCount >= MIN_STATIONS_FOR_GENRE_INDEX. Slugs with no
        // matching Genre row at all show up as 0.
        //
        // Task #184: also surface which slugs have NO matching Genre row at
        // all (vs. a row that just happens to have stationCount=0). The two
        // look identical in `stationCounts` but mean very different things —
        // "no row" usually points to a typo or never-seeded slug that needs
        // to be removed or have a Genre row created.
        const stationCounts: Record<string, number> = {};
        const slugsWithGenreRow = new Set<string>();
        if (sortedSlugs.length > 0) {
          const genres = await Genre.find({ slug: { $in: sortedSlugs } })
            .select('slug stationCount')
            .lean();
          for (const g of genres as Array<{ slug?: string; stationCount?: number }>) {
            if (typeof g.slug === 'string') {
              stationCounts[g.slug] = g.stationCount ?? 0;
              slugsWithGenreRow.add(g.slug);
            }
          }
        }
        const slugsWithoutGenreRow = sortedSlugs.filter(
          (s) => !slugsWithGenreRow.has(s),
        );

        return void res.json({
          slugs: sortedSlugs,
          slugStationCounts: stationCounts,
          slugsWithoutGenreRow,
          minStationsThreshold: MIN_STATIONS_FOR_GENRE_INDEX,
          aliases: Array.from(aliases.entries())
            .map(([source, canonical]) => ({ source, canonical }))
            .sort((a, b) => a.source.localeCompare(b.source)),
          // Mirror the server-side reserved set to the admin UI so it can
          // block these client-side instead of round-tripping (task #148).
          reservedSlugs: Array.from(RESERVED_GENRE_SLUGS).sort(),
          seed: {
            slugCount: GENRE_WHITELIST.size,
            aliasCount: GENRE_ALIASES.size,
          },
          overrides: overrides.map((o) => ({
            kind: o.kind,
            slug: o.slug,
            canonical: o.canonical ?? null,
            createdBy: o.createdBy,
            createdAt: o.createdAt,
            notes: o.notes ?? '',
          })),
          lastRefreshAt: getLastRefreshAt(),
          // Task #185: surface when Genre.stationCount was last recomputed
          // so admins can tell whether the per-slug counts above are fresh
          // (e.g. after a bulk import or country backfill).
          stationCountsStatus: getGenreStationCountsStatus(),
          lastPush: getLastPushStatus(),
          // Task #255: persisted history of recent completed pushes
          // (newest first). Survives api-server restarts so admins can
          // spot a flapping IndexNow endpoint or a slug that keeps
          // failing across multiple attempts.
          pushHistory,
        });
      } catch (error: any) {
        logger.error('Error reading genre whitelist:', error);
        return void res.status(500).json({ error: 'Failed to read genre whitelist' });
      }
    },
  );

  // GET /suggestions — top Genre slugs by stationCount that are not yet
  // on the merged whitelist (and not aliased and not reserved). Powers
  // the autocomplete on the "add slug" input so admins pick real tags
  // stations actually use instead of guessing the normalized form.
  app.get(
    '/api/admin/genre-whitelist/suggestions',
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const rawLimit = Number((req.query as any)?.limit);
        const limit = Number.isFinite(rawLimit)
          ? Math.min(Math.max(Math.floor(rawLimit), 1), 200)
          : 50;

        await refreshGenreWhitelistFromDb();
        const merged = getMergedWhitelist();
        const aliases = getMergedAliases();

        // Pull a generous superset (limit * 4, capped) so we still have
        // enough candidates after filtering out already-whitelisted /
        // aliased / reserved slugs.
        const fetchCap = Math.min(limit * 4, 500);
        const genres = await Genre.find({
          slug: { $exists: true, $ne: null },
          stationCount: { $gt: 0 },
        })
          .select('slug stationCount')
          .sort({ stationCount: -1 })
          .limit(fetchCap)
          .lean<Array<{ slug?: string; stationCount?: number }>>();

        const suggestions: Array<{ slug: string; stationCount: number }> = [];
        for (const g of genres) {
          if (typeof g.slug !== 'string' || !g.slug) continue;
          const slug = g.slug;
          if (merged.has(slug)) continue;
          if (aliases.has(slug)) continue;
          if (isReservedGenreSlug(slug)) continue;
          if (!SAFE_GENRE_SLUG_RE.test(slug)) continue;
          suggestions.push({ slug, stationCount: g.stationCount ?? 0 });
          if (suggestions.length >= limit) break;
        }

        return void res.json({ suggestions, limit });
      } catch (error: any) {
        logger.error('Error loading genre whitelist suggestions:', error);
        return void res.status(500).json({ error: 'Failed to load suggestions' });
      }
    },
  );

  // POST /recompute-counts — task #185: manually re-aggregate
  // `Genre.stationCount` from the live Station collection. Useful when an
  // admin notices the counts look stale (e.g. between a bulk import and the
  // background recompute it kicks off, or for ad-hoc audits). Coalesces
  // with any in-flight recompute so spamming the button is safe.
  app.post(
    '/api/admin/genre-whitelist/recompute-counts',
    requireAdmin,
    async (_req: Request, res: Response) => {
      try {
        await recomputeGenreStationCounts('admin-manual');
        return void res.json({ ok: true, status: getGenreStationCountsStatus() });
      } catch (error: any) {
        logger.error('Error recomputing Genre.stationCount:', error);
        return void res.status(500).json({ error: 'Failed to recompute counts' });
      }
    },
  );

  // POST /slugs — add a slug to the whitelist. If the slug is in the
  // static seed this is a no-op at the merged-snapshot level, but we
  // still record the override for audit. If a 'slug-remove' override
  // existed for this slug, we drop it (un-remove) and then add an
  // explicit 'slug-add' if the slug isn't seeded.
  app.post(
    '/api/admin/genre-whitelist/slugs',
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const slugResult = parseAdminSlug((req.body ?? {}).slug);
        if (!slugResult.ok) {
          return void res.status(slugResult.status).json({ error: slugResult.error });
        }
        const slug = slugResult.slug;
        // Task #148: reject reserved/system slugs (e.g. `stations`,
        // `about`) — those would never produce a useful /genres/:slug page
        // and could conflict with existing top-level routes.
        if (isReservedGenreSlug(slug)) {
          return void res.status(400).json({
            error: `"${slug}" is a reserved system path and can't be used as a genre slug`,
          });
        }
        const notes = String((req.body ?? {}).notes ?? '').slice(0, MAX_NOTES_LEN);
        const createdBy = getAdminUsername(req);
        if (!createdBy) {
          return void res.status(401).json({ error: 'Admin identity unavailable' });
        }

        // Task #148: warn (don't block) if no Genre row matches this slug —
        // the page will exist but render empty until station tags catch up.
        // Task #184: distinguish "Genre row exists with 0 stations" from
        // "no Genre row at all" so admins know whether the slug is a typo
        // (no row) or just genuinely empty (row exists, 0 stations).
        const genreDoc = await Genre.findOne({ slug })
          .select('stationCount')
          .lean<{ stationCount?: number } | null>();
        const hasGenreRow = genreDoc != null;
        const stationCount = genreDoc?.stationCount ?? 0;
        let warning: string | undefined;
        if (!hasGenreRow) {
          warning = `No Genre row exists for "${slug}" yet — likely a typo or a slug that was never seeded. Create a Genre row from the admin page or remove the slug.`;
        } else if (stationCount === 0) {
          warning = `Genre row for "${slug}" exists but has 0 stations — the genre page will be empty until station tags are imported.`;
        }

        // Wipe any prior 'slug-remove' for this slug — adding overrides
        // removing.
        await GenreWhitelistOverride.deleteOne({ kind: 'slug-remove', slug });

        if (!GENRE_WHITELIST.has(slug)) {
          // Only persist an explicit add when the slug isn't already in
          // the static seed (otherwise it's redundant).
          await GenreWhitelistOverride.findOneAndUpdate(
            { kind: 'slug-add', slug },
            {
              $set: { canonical: null, notes },
              $setOnInsert: { kind: 'slug-add', slug, createdBy, createdAt: new Date() },
            },
            { upsert: true, new: true },
          );
        }

        await refreshGenreWhitelistFromDb();
        triggerSearchEnginePush([slug], { triggeredBy: createdBy, trigger: 'add-slug' });
        return void res.json({ ok: true, slug, stationCount, warning, rebuildQueued: true });
      } catch (error: any) {
        logger.error('Error adding genre whitelist slug:', error);
        return void res.status(500).json({ error: 'Failed to add slug' });
      }
    },
  );

  // DELETE /slugs/:slug — remove a slug. If it was an admin-added slug
  // we just drop the 'slug-add' row. If it lives in the static seed we
  // record a 'slug-remove' override so it stays removed across restarts.
  app.delete(
    '/api/admin/genre-whitelist/slugs/:slug',
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const slugResult = parseAdminSlug(req.params.slug);
        if (!slugResult.ok) {
          return void res.status(slugResult.status).json({ error: slugResult.error });
        }
        const slug = slugResult.slug;
        const createdBy = getAdminUsername(req);
        if (!createdBy) {
          return void res.status(401).json({ error: 'Admin identity unavailable' });
        }

        // Drop any admin add first.
        await GenreWhitelistOverride.deleteOne({ kind: 'slug-add', slug });

        // Garbage-collect alias-add overrides that pointed at this slug —
        // otherwise they'd linger as inert rows in the audit trail (the
        // runtime store already prunes them from the merged snapshot).
        await GenreWhitelistOverride.deleteMany({ kind: 'alias-add', canonical: slug });

        if (GENRE_WHITELIST.has(slug)) {
          // Static seed — record a removal override so refresh keeps it gone.
          await GenreWhitelistOverride.findOneAndUpdate(
            { kind: 'slug-remove', slug },
            {
              $setOnInsert: {
                kind: 'slug-remove',
                slug,
                canonical: null,
                createdBy,
                createdAt: new Date(),
              },
            },
            { upsert: true, new: true },
          );
        }

        await refreshGenreWhitelistFromDb();
        triggerSearchEnginePush([slug], { triggeredBy: createdBy, trigger: 'remove-slug' });
        return void res.json({ ok: true, slug, rebuildQueued: true });
      } catch (error: any) {
        logger.error('Error removing genre whitelist slug:', error);
        return void res.status(500).json({ error: 'Failed to remove slug' });
      }
    },
  );

  // POST /slugs/:slug/genre-row — Task #184. Create a Genre row for a
  // whitelisted slug that has none. This is the one-click "fix the typo
  // or seed the row" action surfaced on the admin page next to slugs
  // flagged "no Genre row". The row starts with stationCount=0 and
  // isDiscoverable=false; once station tags catch up the count will be
  // refreshed by the existing genre-count maintenance jobs.
  app.post(
    '/api/admin/genre-whitelist/slugs/:slug/genre-row',
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const slugResult = parseAdminSlug(req.params.slug);
        if (!slugResult.ok) {
          return void res.status(slugResult.status).json({ error: slugResult.error });
        }
        const slug = slugResult.slug;
        // Refresh the in-memory snapshot before checking whitelist
        // membership so we don't reject a slug another replica just added.
        await refreshGenreWhitelistFromDb();
        if (!getMergedWhitelist().has(slug)) {
          return void res.status(400).json({
            error: `"${slug}" is not on the whitelist — add it first`,
          });
        }
        // Humanize the slug into a passable display name
        // (e.g. "lo-fi-hip-hop" → "Lo Fi Hip Hop"). Admins can rename
        // later from the existing genre admin tools.
        const name = slug
          .split('-')
          .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
          .join(' ');
        // Upsert keeps this idempotent against concurrent clicks: the
        // Genre collection has a (non-unique) index on slug but no
        // uniqueness constraint, so a naive read-then-create would race.
        // findOneAndUpdate with upsert relies on Mongo's atomic upsert
        // semantics. We detect "row already existed" by checking
        // lastErrorObject.upserted on the raw result.
        type UpsertRawResult = {
          lastErrorObject?: { upserted?: unknown };
        };
        const result = (await Genre.findOneAndUpdate(
          { slug },
          {
            $setOnInsert: {
              name,
              slug,
              stationCount: 0,
              isDiscoverable: false,
              createdAt: new Date(),
            },
          },
          { upsert: true, new: false, rawResult: true },
        )) as unknown as UpsertRawResult;
        const created = result?.lastErrorObject?.upserted != null;
        if (!created) {
          return void res.status(409).json({ error: `Genre row for "${slug}" already exists` });
        }
        // Task #241: backfill stationCount immediately so admins can tell
        // right away whether the slug actually matches anything in the
        // catalog, rather than waiting for the next genre-count maintenance
        // pass. Mirrors the regex pattern used by the merge-winner refresh
        // in translation-admin-routes.ts: match the humanized name as a
        // standalone tag (comma-delimited) or as the legacy `genre` field,
        // case-insensitively. If the count call fails we keep the row at 0
        // — the background recompute will correct it on its next pass.
        let stationCount = 0;
        try {
          const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          stationCount = await Station.countDocuments({
            $or: [
              { tags: { $regex: new RegExp(`(^|,)\\s*${escapedName}\\s*(,|$)`, 'i') } },
              { genre: { $regex: new RegExp(`^\\s*${escapedName}\\s*$`, 'i') } },
            ],
          });
          if (stationCount > 0) {
            await Genre.updateOne(
              { slug },
              { $set: { stationCount, updatedAt: new Date() } },
            );
          }
        } catch (countErr: any) {
          logger.error(
            `Failed to backfill stationCount for new Genre row "${slug}":`,
            countErr?.message ?? countErr,
          );
        }
        return void res.json({ ok: true, slug, name, stationCount });
      } catch (error: any) {
        logger.error('Error creating genre row for whitelist slug:', error);
        return void res.status(500).json({ error: 'Failed to create genre row' });
      }
    },
  );

  // POST /aliases — add (or replace) an alias source → canonical. The
  // canonical must be on the merged whitelist; otherwise the alias would
  // be unreachable (lookup requires the target be whitelisted).
  app.post(
    '/api/admin/genre-whitelist/aliases',
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const sourceResult = parseAdminSlug((req.body ?? {}).source, 'source');
        if (!sourceResult.ok) {
          return void res.status(sourceResult.status).json({ error: sourceResult.error });
        }
        const canonicalResult = parseAdminSlug((req.body ?? {}).canonical, 'canonical');
        if (!canonicalResult.ok) {
          return void res.status(canonicalResult.status).json({ error: canonicalResult.error });
        }
        const source = sourceResult.slug;
        const canonical = canonicalResult.slug;
        if (source === canonical) {
          return void res.status(400).json({ error: 'Source cannot equal canonical' });
        }
        // Task #148: reserved system slugs can't appear on either side of
        // an alias for the same reasons they can't be added directly.
        if (isReservedGenreSlug(source)) {
          return void res.status(400).json({
            error: `"${source}" is a reserved system path and can't be used as an alias source`,
          });
        }
        if (isReservedGenreSlug(canonical)) {
          return void res.status(400).json({
            error: `"${canonical}" is a reserved system path and can't be used as a canonical slug`,
          });
        }

        // Make sure the merged snapshot is current before we validate
        // the canonical target — an admin could have just added it.
        await refreshGenreWhitelistFromDb();
        if (!getMergedWhitelist().has(canonical)) {
          return void res.status(400).json({
            error: `Canonical "${canonical}" is not on the whitelist — add it first`,
          });
        }
        // An alias can't shadow a whitelisted slug — that slug should
        // resolve to itself, not redirect.
        if (getMergedWhitelist().has(source)) {
          return void res.status(400).json({
            error: `Source "${source}" is already a whitelisted slug — remove it first to alias it`,
          });
        }

        const notes = String((req.body ?? {}).notes ?? '').slice(0, MAX_NOTES_LEN);
        const createdBy = getAdminUsername(req);
        if (!createdBy) {
          return void res.status(401).json({ error: 'Admin identity unavailable' });
        }

        // Drop any prior 'alias-remove' for this source — adding overrides
        // removing.
        await GenreWhitelistOverride.deleteOne({ kind: 'alias-remove', slug: source });

        await GenreWhitelistOverride.findOneAndUpdate(
          { kind: 'alias-add', slug: source },
          {
            $set: { canonical, notes },
            $setOnInsert: { kind: 'alias-add', slug: source, createdBy, createdAt: new Date() },
          },
          { upsert: true, new: true },
        );

        await refreshGenreWhitelistFromDb();
        // Push both the alias source (now 301s to canonical) and the
        // canonical (which may have just appeared) so search engines
        // pick up the new redirect target without waiting 6h.
        triggerSearchEnginePush([source, canonical], { triggeredBy: createdBy, trigger: 'add-alias' });
        return void res.json({ ok: true, source, canonical, rebuildQueued: true });
      } catch (error: any) {
        logger.error('Error adding genre alias:', error);
        return void res.status(500).json({ error: 'Failed to add alias' });
      }
    },
  );

  // DELETE /aliases/:source — remove an alias by its source slug. If
  // the alias lives in the static seed, persist a 'alias-remove' so it
  // stays removed across restarts.
  app.delete(
    '/api/admin/genre-whitelist/aliases/:source',
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const sourceResult = parseAdminSlug(req.params.source, 'source');
        if (!sourceResult.ok) {
          return void res.status(sourceResult.status).json({ error: sourceResult.error });
        }
        const source = sourceResult.slug;
        const createdBy = getAdminUsername(req);
        if (!createdBy) {
          return void res.status(401).json({ error: 'Admin identity unavailable' });
        }

        await GenreWhitelistOverride.deleteOne({ kind: 'alias-add', slug: source });

        if (GENRE_ALIASES.has(source)) {
          await GenreWhitelistOverride.findOneAndUpdate(
            { kind: 'alias-remove', slug: source },
            {
              $setOnInsert: {
                kind: 'alias-remove',
                slug: source,
                canonical: null,
                createdBy,
                createdAt: new Date(),
              },
            },
            { upsert: true, new: true },
          );
        }

        await refreshGenreWhitelistFromDb();
        triggerSearchEnginePush([source], { triggeredBy: createdBy, trigger: 'remove-alias' });
        return void res.json({ ok: true, source, rebuildQueued: true });
      } catch (error: any) {
        logger.error('Error removing genre alias:', error);
        return void res.status(500).json({ error: 'Failed to remove alias' });
      }
    },
  );

  // POST /repush — re-run the sitemap rebuild + IndexNow ping using the
  // affected slugs from the most recent push (or none, in which case it
  // pings the sitemap index only). Lets admins retry a failed push
  // without making a dummy whitelist edit (task #186).
  app.post(
    '/api/admin/genre-whitelist/repush',
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const createdBy = getAdminUsername(req);
        if (!createdBy) {
          return void res.status(401).json({ error: 'Admin identity unavailable' });
        }
        const previous = getLastPushStatus();
        const affectedSlugs = previous?.affectedSlugs ?? [];
        triggerSearchEnginePush(affectedSlugs, {
          triggeredBy: createdBy,
          trigger: 'manual-repush',
        });
        return void res.json({ ok: true, rebuildQueued: true, affectedSlugs });
      } catch (error: any) {
        logger.error('Error queuing manual re-push:', error);
        return void res.status(500).json({ error: 'Failed to queue re-push' });
      }
    },
  );
}
