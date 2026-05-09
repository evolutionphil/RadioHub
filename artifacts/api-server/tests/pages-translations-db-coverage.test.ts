/**
 * Regression guard: every `t("key", "...")` call inside the listed SPA
 * source files must have a non-empty translation in the runtime DB
 * translation store for every language listed in SEO_LANGUAGES.
 *
 * Background: Task #298 added a per-language DB coverage guard for the
 * search results page (`search-translations-db-coverage.test.ts`). The
 * exact same silent-fallback hazard exists on every other SPA surface
 * with a runtime translation: the Mongo-backed translation store falls
 * back to the hard-coded English fallback per-key when a language
 * hasn't been backfilled, so the user sees English for that key with
 * no warning. This test generalizes the guard to the rest of the
 * heavy translation surfaces (radio frontend, users index, stations
 * filters, radio header).
 *
 * Strategy:
 *   1. For each tracked page/component file, statically parse for
 *      every literal `t("...", ...)` call so the allow-list can never
 *      drift from the source of truth.
 *   2. Connect to the runtime Mongo (MONGODB_URI / DATABASE_URL /
 *      MONGO_URI) using the production schemas, fetch the keys + every
 *      Translation row keyed off them, and assert that for each
 *      SEO_LANGUAGES code every page key has a non-empty value.
 *   3. If no Mongo connection string is configured (e.g. an isolated
 *      dev sandbox), soft-skip locally but hard-fail on CI — same
 *      behavior as the search guard so it can't silently disable
 *      itself in CI.
 *
 * Runner: requires `--experimental-test-module-mocks` (wired up in
 * artifacts/api-server/package.json#scripts.test).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import mongoose from 'mongoose';

import { SEO_LANGUAGES } from '@workspace/seo-shared/seo-config';
import {
  Translation,
  TranslationKey,
} from '@workspace/db-shared/mongo-schemas';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MEGARADIO_SRC = resolve(__dirname, '../../megaradio/src');

/**
 * Pages / components whose runtime t("...") keys are checked against
 * the DB translation store. Add a new entry whenever a page/component
 * grows a new translation surface so missing rows for any
 * SEO_LANGUAGES code fail the build with a clear, page-scoped message.
 *
 * Each entry is keyed by a short page label used purely for the
 * failure message (not for filtering keys), so two pages can legally
 * share the same key.
 *
 * `expectKeys: false` marks a page that's tracked for visibility (so
 * a future maintainer adding `useTranslation` + literal `t("...")`
 * calls there is automatically covered) but is allowed to currently
 * have zero literal keys — used for the api-docs page, which doesn't
 * call `t("...")` today and would otherwise fail the
 * "every tracked page has at least one key" sanity check.
 */
const TRACKED_PAGES: Array<{
  page: string;
  file: string;
  expectKeys?: boolean;
}> = [
  // The search page has its own dedicated guard in
  // `search-translations-db-coverage.test.ts` (Task #298). Listing it
  // here too keeps the "all SPA pages with a runtime t() surface are
  // checked" invariant true in one place — duplicate coverage is
  // harmless because the assertion is idempotent and shares the
  // same DB query batch.
  { page: 'search', file: 'pages/search.tsx' },
  { page: 'radio-frontend', file: 'pages/radio-frontend.tsx' },
  { page: 'users', file: 'pages/users/index.tsx' },
  { page: 'stations-filters', file: 'components/stations/filters.tsx' },
  { page: 'radio-header', file: 'components/layout/radio-header.tsx' },
  // api-docs.tsx currently has no `t("...")` calls and doesn't import
  // useTranslation, but the task explicitly listed it as a tracked
  // surface. Keep it in the list so the moment someone adds a
  // translation key to the page it's automatically covered, without
  // having to remember to update this test too.
  { page: 'api-docs', file: 'pages/api-docs.tsx', expectKeys: false },
];

/**
 * Extract every literal key string passed to a `t("...", ...)` call
 * inside the given source file. Computed keys (e.g. `t(varHoldingKey,
 * ...)` or `` t(`prefix_${x}`) ``) are intentionally not supported —
 * the whole point of the guard is that the keys are statically
 * discoverable, and a switch to dynamic keys would defeat the
 * SEO/translation backfill workflow regardless. A future quoting
 * style change in the page source can't silently shrink the
 * allow-list because all three quote styles are matched.
 */
function extractKeysFromSource(absPath: string): string[] {
  const src = readFileSync(absPath, 'utf8');
  const re = /\bt\(\s*["'`]([a-zA-Z0-9_]+)["'`]/g;
  const seen = new Set<string>();
  for (const match of src.matchAll(re)) {
    seen.add(match[1]!);
  }
  return Array.from(seen).sort();
}

const MONGO_URI =
  process.env.MONGODB_URI ||
  process.env.DATABASE_URL ||
  process.env.MONGO_URI ||
  '';

describe('Per-language SPA-page DB translation coverage', () => {
  // Resolve + extract keys eagerly so a missing source file or empty
  // key set fails fast with an actionable message instead of a
  // confusing zero-coverage pass.
  const tracked = TRACKED_PAGES.map(({ page, file, expectKeys }) => {
    const absPath = resolve(MEGARADIO_SRC, file);
    const keys = extractKeysFromSource(absPath);
    return { page, file, expectKeys, absPath, keys };
  });

  it('finds at least one t("...", ...) key in every tracked page (except those marked expectKeys: false)', () => {
    // Only fail for pages we expect to have keys today. A page marked
    // `expectKeys: false` (e.g. api-docs) is tracked for future-proofing
    // but is allowed to have zero literal `t("...")` calls right now.
    const empty = tracked.filter(
      (t) => t.expectKeys !== false && t.keys.length === 0,
    );
    assert.equal(
      empty.length,
      0,
      `These tracked pages had no t("...", ...) calls — either the file moved, ` +
        `the regex stopped matching, or the page no longer uses the runtime ` +
        `translation store. Update TRACKED_PAGES in this test to match:\n` +
        empty.map((e) => `  - page="${e.page}" file=${e.file}`).join('\n'),
    );
  });

  if (!MONGO_URI) {
    it('requires MONGODB_URI to run the DB coverage check', () => {
      // CI is the place this guard MUST fire — silently skipping there
      // would let a regression land just because env wiring drifted.
      // Locally (no CI=true), we soft-skip so an isolated dev sandbox
      // without a Mongo URL doesn't block unrelated work.
      if (process.env.CI) {
        assert.fail(
          '[pages-translations-db-coverage] No Mongo URI configured ' +
            '(MONGODB_URI / DATABASE_URL / MONGO_URI) but CI=true. ' +
            'CI must provide a Mongo URI so the SPA-translation guard ' +
            'cannot silently disable itself.',
        );
      }
      // eslint-disable-next-line no-console
      console.warn(
        '[pages-translations-db-coverage] MONGODB_URI not set — skipping DB coverage assertion. ' +
          'CI runs must have MONGODB_URI configured for this guard to fire.',
      );
      assert.ok(true);
    });
    return;
  }

  let connection: mongoose.Connection | null = null;
  // language -> (key -> value)
  const translationsByLanguage: Map<string, Map<string, string>> = new Map();
  const knownKeys: Set<string> = new Set();
  let connectError: Error | null = null;

  // De-duplicate keys across pages for the DB query — many keys (e.g.
  // `search_placeholder`) appear in more than one tracked file, and
  // querying once is enough to hydrate every per-page assertion below.
  const allKeys = Array.from(
    new Set(tracked.flatMap((t) => t.keys)),
  ).sort();

  before(async () => {
    try {
      connection = await mongoose
        .createConnection(MONGO_URI, {
          serverSelectionTimeoutMS: 15000,
        })
        .asPromise();

      // Bind production schemas to *this* isolated connection so we never
      // contaminate the default mongoose connection that the api-server
      // owns at runtime. Reusing the schema objects guarantees the
      // collection names line up with what the production warmup queries.
      const KeyModel = connection.model(
        'TranslationKey',
        TranslationKey.schema,
      );
      const TxModel = connection.model('Translation', Translation.schema);

      const keyDocs = await KeyModel.find({ key: { $in: allKeys } })
        .select({ _id: 1, key: 1 })
        .lean();
      const keyIdToKey = new Map<string, string>();
      for (const doc of keyDocs) {
        keyIdToKey.set(String(doc._id), doc.key);
        knownKeys.add(doc.key);
      }

      const languageCodes = SEO_LANGUAGES.map((l) => l.code);
      const txDocs = await TxModel.find({
        language: { $in: languageCodes },
        keyId: { $in: keyDocs.map((d) => d._id) },
      })
        .select({ keyId: 1, language: 1, value: 1 })
        .lean();

      for (const code of languageCodes) {
        translationsByLanguage.set(code, new Map());
      }
      for (const tx of txDocs) {
        const key = keyIdToKey.get(String(tx.keyId));
        if (!key) continue;
        const value = typeof tx.value === 'string' ? tx.value : '';
        translationsByLanguage.get(tx.language)?.set(key, value);
      }
    } catch (err) {
      connectError = err as Error;
    }
  });

  after(async () => {
    if (connection) {
      await connection.close().catch(() => undefined);
    }
  });

  it('has a TranslationKey + non-empty Translation for every t("...", ...) key in every SEO_LANGUAGES code, for every tracked page', () => {
    if (connectError) {
      assert.fail(
        `Could not connect to Mongo to verify SPA-page translations: ${connectError.message}. ` +
          'Either MONGODB_URI is misconfigured or the DB is unreachable from the test runner.',
      );
    }

    // Surface absent TranslationKey rows separately from absent
    // Translation rows — the fix is different (create the key once vs
    // backfill one row per language), so naming them distinctly makes
    // the failure actionable instead of a wall of repeated noise.
    // Group every gap by page so the failure message points at the
    // file the developer just edited.
    const missingKeyRowsByPage: Array<{ page: string; key: string }> = [];
    const missingTranslations: Array<{
      page: string;
      language: string;
      key: string;
      reason: string;
    }> = [];

    for (const { page, keys } of tracked) {
      for (const key of keys) {
        if (!knownKeys.has(key)) {
          missingKeyRowsByPage.push({ page, key });
        }
      }

      for (const { code } of SEO_LANGUAGES) {
        const langMap = translationsByLanguage.get(code);
        if (!langMap) {
          // Defensive: should never happen because before() seeds an
          // empty map for every code. If it does, treat every key as
          // missing for that language so the failure message is
          // unambiguous.
          for (const key of keys) {
            missingTranslations.push({
              page,
              language: code,
              key,
              reason: 'no rows for language',
            });
          }
          continue;
        }
        for (const key of keys) {
          // If the TranslationKey itself is absent we already
          // reported it above — skip per-language noise for that key
          // so the failure list stays focused on rows the team
          // actually has to write.
          if (!knownKeys.has(key)) continue;
          const value = langMap.get(key);
          if (typeof value !== 'string' || value.trim().length === 0) {
            missingTranslations.push({
              page,
              language: code,
              key,
              reason:
                value === undefined
                  ? 'no Translation row'
                  : 'empty/whitespace value',
            });
          }
        }
      }
    }

    const hasGap =
      missingKeyRowsByPage.length > 0 || missingTranslations.length > 0;

    assert.ok(
      !hasGap,
      [
        `The runtime DB translation store is missing SPA-page entries.`,
        'Each missing entry causes the SPA to silently fall back to the hard-coded English copy for that language.',
        '',
        ...(missingKeyRowsByPage.length > 0
          ? [
              `Missing TranslationKey rows (${missingKeyRowsByPage.length}) — create one row per key, then a Translation per language:`,
              ...missingKeyRowsByPage.map(
                (m) => `  - page="${m.page}" key="${m.key}"`,
              ),
              '',
            ]
          : []),
        ...(missingTranslations.length > 0
          ? [
              `Missing per-language Translation rows (${missingTranslations.length}):`,
              ...missingTranslations
                .slice(0, 200)
                .map(
                  (m) =>
                    `  - page="${m.page}" language="${m.language}" key="${m.key}" (${m.reason})`,
                ),
              ...(missingTranslations.length > 200
                ? [`  ... and ${missingTranslations.length - 200} more`]
                : []),
            ]
          : []),
      ].join('\n'),
    );
  });
});
