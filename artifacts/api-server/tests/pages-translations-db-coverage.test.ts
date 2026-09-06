/**
 * Source-to-PostgreSQL regression coverage for tracked SPA translation surfaces.
 *
 * Literal t() calls are extracted from the real frontend files. Native source
 * scanning plus explicit multilingual admin fixtures exercise key persistence,
 * language joins and completeness diagnostics without contacting a live system.
 * This validates data flow and gap detection, not the quality/completeness of
 * deployed translations. Search seed content has its own canonical-seeder test.
 *
 * PG_TEST_DATABASE_URL is mandatory; each test process owns a random schema.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  createNativePostgresFixture,
  type NativePostgresFixture,
} from "./helpers/native-postgres-fixture";
import { pgLocalization } from "../src/data/postgres-localization-store";
import { TranslationSyncService } from "../src/services/translation-sync";

import { SEO_LANGUAGES } from "@workspace/seo-shared/seo-config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MEGARADIO_SRC = resolve(__dirname, "../../megaradio/src");

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
  { page: "search", file: "pages/search.tsx" },
  { page: "radio-frontend", file: "pages/radio-frontend.tsx" },
  { page: "users", file: "pages/users/index.tsx" },
  { page: "stations-filters", file: "components/stations/filters.tsx" },
  { page: "radio-header", file: "components/layout/radio-header.tsx" },
  // api-docs.tsx currently has no `t("...")` calls and doesn't import
  // useTranslation, but the task explicitly listed it as a tracked
  // surface. Keep it in the list so the moment someone adds a
  // translation key to the page it's automatically covered, without
  // having to remember to update this test too.
  { page: "api-docs", file: "pages/api-docs.tsx", expectKeys: false },
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
  const src = readFileSync(absPath, "utf8");
  const re = /\bt\(\s*["'`]([a-zA-Z0-9_]+)["'`]/g;
  const seen = new Set<string>();
  for (const match of src.matchAll(re)) {
    seen.add(match[1]!);
  }
  return Array.from(seen).sort();
}

describe("Per-language SPA-page DB translation coverage", () => {
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
        empty.map((e) => `  - page="${e.page}" file=${e.file}`).join("\n"),
    );
  });

  let fixture: NativePostgresFixture;
  // language -> (key -> value)
  const translationsByLanguage: Map<string, Map<string, string>> = new Map();
  const knownKeys: Set<string> = new Set();

  // De-duplicate keys across pages for the DB query — many keys (e.g.
  // `search_placeholder`) appear in more than one tracked file, and
  // querying once is enough to hydrate every per-page assertion below.
  const allKeys = Array.from(new Set(tracked.flatMap((t) => t.keys))).sort();

  async function readCoverage(): Promise<void> {
    knownKeys.clear();
    translationsByLanguage.clear();
    const keyDocs = await pgLocalization().getKeys(allKeys);
    for (const doc of keyDocs) knownKeys.add(doc.key);
    for (const { code } of SEO_LANGUAGES)
      translationsByLanguage.set(code, new Map());
    const rows = await pgLocalization().listTranslations(
      undefined,
      allKeys,
      true,
    );
    for (const row of rows) {
      translationsByLanguage.get(row.language)?.set(row.keyId.key, row.value);
    }
  }

  before(async () => {
    fixture = await createNativePostgresFixture("page-translation-coverage");
    // These are explicitly synthetic admin-provided fixtures, not certified
    // production-language content. Discover keys with the real source scanner;
    // preserve every page/language completeness assertion on SQL round trips.
    const wanted = new Set(allKeys);
    const definitions = (
      await TranslationSyncService.scanFrontendForKeys()
    ).filter((definition) => wanted.has(definition.key));
    const values = Object.fromEntries(
      SEO_LANGUAGES.map(({ code }) => [
        code,
        Object.fromEntries(
          definitions.map(({ key }) => [key, "Fixture " + code + ": " + key]),
        ),
      ]),
    );
    await pgLocalization().seedTranslationBundle(
      definitions,
      values,
      fixture.schema,
    );
    await readCoverage();
  });

  after(async () => {
    await fixture?.close();
  });

  function assertCompleteCoverage(): void {
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
              reason: "no rows for language",
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
          if (typeof value !== "string" || value.trim().length === 0) {
            missingTranslations.push({
              page,
              language: code,
              key,
              reason:
                value === undefined
                  ? "no Translation row"
                  : "empty/whitespace value",
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
        "Each missing entry causes the SPA to silently fall back to the hard-coded English copy for that language.",
        "",
        ...(missingKeyRowsByPage.length > 0
          ? [
              `Missing TranslationKey rows (${missingKeyRowsByPage.length}) — create one row per key, then a Translation per language:`,
              ...missingKeyRowsByPage.map(
                (m) => `  - page="${m.page}" key="${m.key}"`,
              ),
              "",
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
      ].join("\n"),
    );
  }

  it(
    "round-trips every source-discovered page key and SEO language through the native translation store",
    assertCompleteCoverage,
  );

  it("reports missing keys, missing translations and whitespace values from PostgreSQL", async () => {
    const [deletedKey, missingTranslationKey, blankTranslationKey] = allKeys;
    assert.ok(deletedKey && missingTranslationKey && blankTranslationKey);
    const language = SEO_LANGUAGES[0].code;
    await fixture.pool.query("DELETE FROM translation_keys WHERE key=$1", [
      deletedKey,
    ]);
    await fixture.pool.query(
      "DELETE FROM translations WHERE key_id=(SELECT id FROM translation_keys WHERE key=$1) AND language=$2",
      [missingTranslationKey, language],
    );
    await fixture.pool.query(
      "UPDATE translations SET value=$3 WHERE key_id=(SELECT id FROM translation_keys WHERE key=$1) AND language=$2",
      [blankTranslationKey, language, "   "],
    );
    await readCoverage();
    assert.throws(assertCompleteCoverage, (error: any) => {
      assert.match(error.message, /Missing TranslationKey rows/);
      assert.match(error.message, /no Translation row/);
      assert.match(error.message, /empty\/whitespace value/);
      assert.ok(error.message.includes(deletedKey));
      assert.ok(error.message.includes(missingTranslationKey));
      assert.ok(error.message.includes(blankTranslationKey));
      return true;
    });
  });
});
