/**
 * Regression guard: every `t("search_*", "...")` key used inside the SPA's
 * search results page must have a non-empty translation in the runtime DB
 * translation store for every language listed in SEO_LANGUAGES.
 *
 * Background: Task #221 added a build-time guard for SEARCH_SEO_TEMPLATES
 * (the title / description / H1 SEO copy). The interactive SPA copy on the
 * search page (placeholder, no-results, paging hints, Esc hints, section
 * headings, ...) is keyed off a *separate* translation store loaded from
 * MongoDB at runtime. That store silently falls back to the hard-coded
 * English fallback per-key when a language hasn't been backfilled — exactly
 * the same silent-fallback hazard the SEO guard prevents, just for the
 * interactive UI half. This test is the missing other half.
 *
 * Strategy:
 *   1. Statically parse `artifacts/megaradio/src/pages/search.tsx` for
 *      every `t("search_*", ...)` call, so the allow-list can never
 *      drift from the source of truth.
 *   2. Connect to the runtime Mongo (MONGODB_URI / DATABASE_URL /
 *      MONGO_URI) using the production schemas, fetch the keys + every
 *      Translation row keyed off them, and assert that for each
 *      SEO_LANGUAGES code every search-page key has a non-empty value.
 *   3. If no Mongo connection string is configured (e.g. an isolated
 *      dev sandbox), skip — exactly like the production warmup loop
 *      can't run without a DB either. CI / merge runs always have it.
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

const SEARCH_PAGE_SOURCE = resolve(
  __dirname,
  '../../megaradio/src/pages/search.tsx',
);

/**
 * Extract every key string passed to a `t("search_*", ...)` call inside
 * the search results page. We deliberately scope to the search page
 * (the task's source of truth for "in-page search translations") rather
 * than the entire SPA, so the failure message points at the same file
 * the developer just edited. Other pages have their own translation
 * surfaces and should grow their own coverage tests as needed.
 */
function extractSearchKeysFromSource(): string[] {
  const src = readFileSync(SEARCH_PAGE_SOURCE, 'utf8');
  // Match `t("search_*")`, `t('search_*')`, and `` t(`search_*`) `` so a
  // future quoting style change in the page source can't silently shrink
  // the allow-list. Computed keys (e.g. `t(varHoldingKey, ...)`) are
  // intentionally not supported — the whole point of the guard is that
  // the keys are statically discoverable, and a switch to dynamic keys
  // would defeat the SEO/translation backfill workflow regardless.
  const re = /\bt\(\s*["'`](search_[a-zA-Z0-9_]+)["'`]/g;
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

describe('Per-language search-page DB translation coverage', () => {
  const searchKeys = extractSearchKeysFromSource();

  it('finds at least one t("search_*", ...) key in search.tsx', () => {
    assert.ok(
      searchKeys.length > 0,
      `No t("search_*", ...) calls found in ${SEARCH_PAGE_SOURCE}. ` +
        'Either the regex stopped matching or the page no longer uses ' +
        'the runtime translation store — update this test to match.',
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
          '[search-translations-db-coverage] No Mongo URI configured ' +
            '(MONGODB_URI / DATABASE_URL / MONGO_URI) but CI=true. ' +
            'CI must provide a Mongo URI so the search-translation guard ' +
            'cannot silently disable itself.',
        );
      }
      // eslint-disable-next-line no-console
      console.warn(
        '[search-translations-db-coverage] MONGODB_URI not set — skipping DB coverage assertion. ' +
          'CI runs must have MONGODB_URI configured for this guard to fire.',
      );
      assert.ok(true);
    });
    return;
  }

  let connection: mongoose.Connection | null = null;
  let translationsByLanguage: Map<string, Map<string, string>> = new Map();
  let knownKeys: Set<string> = new Set();
  let connectError: Error | null = null;

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

      const keyDocs = await KeyModel.find({ key: { $in: searchKeys } })
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

  it('has a TranslationKey + non-empty Translation for every search_* key in every SEO_LANGUAGES code', () => {
    if (connectError) {
      assert.fail(
        `Could not connect to Mongo to verify search-page translations: ${connectError.message}. ` +
          'Either MONGODB_URI is misconfigured or the DB is unreachable from the test runner.',
      );
    }

    // Surface absent TranslationKey rows separately from absent
    // Translation rows — the fix is different (create the key once vs
    // backfill one row per language), so naming them distinctly makes
    // the failure actionable instead of a wall of repeated noise.
    const missingKeyRows: string[] = [];
    for (const key of searchKeys) {
      if (!knownKeys.has(key)) missingKeyRows.push(key);
    }

    const missing: Array<{ language: string; key: string; reason: string }> =
      [];

    for (const { code } of SEO_LANGUAGES) {
      const langMap = translationsByLanguage.get(code);
      if (!langMap) {
        // Defensive: should never happen because before() seeds an empty
        // map for every code. If it does, treat every key as missing for
        // that language so the failure message is unambiguous.
        for (const key of searchKeys) {
          missing.push({ language: code, key, reason: 'no rows for language' });
        }
        continue;
      }
      for (const key of searchKeys) {
        // If the TranslationKey itself is absent, we already reported it
        // above — skip per-language noise for that key so the failure
        // list stays focused on rows the team actually has to write.
        if (!knownKeys.has(key)) continue;
        const value = langMap.get(key);
        if (typeof value !== 'string' || value.trim().length === 0) {
          missing.push({
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

    const hasGap = missingKeyRows.length > 0 || missing.length > 0;

    assert.ok(
      !hasGap,
      [
        `The runtime DB translation store is missing search-page entries.`,
        'Each missing entry causes the SPA to silently fall back to the hard-coded English copy for that language.',
        '',
        ...(missingKeyRows.length > 0
          ? [
              `Missing TranslationKey rows (${missingKeyRows.length}) — create one row per key, then a Translation per language:`,
              ...missingKeyRows.map((k) => `  - key="${k}"`),
              '',
            ]
          : []),
        ...(missing.length > 0
          ? [
              `Missing per-language Translation rows (${missing.length}):`,
              ...missing
                .slice(0, 200)
                .map(
                  (m) =>
                    `  - language="${m.language}" key="${m.key}" (${m.reason})`,
                ),
              ...(missing.length > 200
                ? [`  ... and ${missing.length - 200} more`]
                : []),
            ]
          : []),
      ].join('\n'),
    );
  });
});
