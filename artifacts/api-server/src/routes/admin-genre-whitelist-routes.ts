import type { Express, Request, Response } from 'express';
import { GenreWhitelistOverride } from '../shared/mongo-schemas';
import { GENRE_WHITELIST, GENRE_ALIASES } from '../seo/genre-whitelist';
import {
  getMergedWhitelist,
  getMergedAliases,
  refreshGenreWhitelistFromDb,
  getLastRefreshAt,
} from '../seo/genre-whitelist-store';
import { logger } from '../utils/logger';

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

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG_LEN = 64;
const MAX_NOTES_LEN = 500;

function normalizeSlug(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const slug = input.trim().toLowerCase();
  if (!slug || slug.length > MAX_SLUG_LEN) return null;
  if (!SLUG_REGEX.test(slug)) return null;
  return slug;
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

        const overrides = await GenreWhitelistOverride.find({})
          .sort({ kind: 1, slug: 1 })
          .lean();

        const merged = getMergedWhitelist();
        const aliases = getMergedAliases();

        return res.json({
          slugs: Array.from(merged).sort(),
          aliases: Array.from(aliases.entries())
            .map(([source, canonical]) => ({ source, canonical }))
            .sort((a, b) => a.source.localeCompare(b.source)),
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
        });
      } catch (error: any) {
        logger.error('Error reading genre whitelist:', error);
        return res.status(500).json({ error: 'Failed to read genre whitelist' });
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
        const slug = normalizeSlug((req.body ?? {}).slug);
        if (!slug) {
          return res
            .status(400)
            .json({ error: 'Invalid slug — must be lowercase letters/digits with single hyphens' });
        }
        const notes = String((req.body ?? {}).notes ?? '').slice(0, MAX_NOTES_LEN);
        const createdBy = getAdminUsername(req);
        if (!createdBy) {
          return res.status(401).json({ error: 'Admin identity unavailable' });
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
        return res.json({ ok: true, slug });
      } catch (error: any) {
        logger.error('Error adding genre whitelist slug:', error);
        return res.status(500).json({ error: 'Failed to add slug' });
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
        const slug = normalizeSlug(req.params.slug);
        if (!slug) {
          return res.status(400).json({ error: 'Invalid slug' });
        }
        const createdBy = getAdminUsername(req);
        if (!createdBy) {
          return res.status(401).json({ error: 'Admin identity unavailable' });
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
        return res.json({ ok: true, slug });
      } catch (error: any) {
        logger.error('Error removing genre whitelist slug:', error);
        return res.status(500).json({ error: 'Failed to remove slug' });
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
        const source = normalizeSlug((req.body ?? {}).source);
        const canonical = normalizeSlug((req.body ?? {}).canonical);
        if (!source || !canonical) {
          return res.status(400).json({
            error: 'Both source and canonical must be valid slugs',
          });
        }
        if (source === canonical) {
          return res.status(400).json({ error: 'Source cannot equal canonical' });
        }

        // Make sure the merged snapshot is current before we validate
        // the canonical target — an admin could have just added it.
        await refreshGenreWhitelistFromDb();
        if (!getMergedWhitelist().has(canonical)) {
          return res.status(400).json({
            error: `Canonical "${canonical}" is not on the whitelist — add it first`,
          });
        }
        // An alias can't shadow a whitelisted slug — that slug should
        // resolve to itself, not redirect.
        if (getMergedWhitelist().has(source)) {
          return res.status(400).json({
            error: `Source "${source}" is already a whitelisted slug — remove it first to alias it`,
          });
        }

        const notes = String((req.body ?? {}).notes ?? '').slice(0, MAX_NOTES_LEN);
        const createdBy = getAdminUsername(req);
        if (!createdBy) {
          return res.status(401).json({ error: 'Admin identity unavailable' });
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
        return res.json({ ok: true, source, canonical });
      } catch (error: any) {
        logger.error('Error adding genre alias:', error);
        return res.status(500).json({ error: 'Failed to add alias' });
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
        const source = normalizeSlug(req.params.source);
        if (!source) {
          return res.status(400).json({ error: 'Invalid source slug' });
        }
        const createdBy = getAdminUsername(req);
        if (!createdBy) {
          return res.status(401).json({ error: 'Admin identity unavailable' });
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
        return res.json({ ok: true, source });
      } catch (error: any) {
        logger.error('Error removing genre alias:', error);
        return res.status(500).json({ error: 'Failed to remove alias' });
      }
    },
  );
}
