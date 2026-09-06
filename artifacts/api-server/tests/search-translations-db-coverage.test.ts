/**
 * Every search-page t("search_*") key must have a non-empty translation for
 * every SEO language after the real PostgreSQL boot seeder runs. This tests the
 * checked-in multilingual content, not English fallback or fabricated values.
 * Deleting keys/rows and blanking values must produce actionable diagnostics.
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
import { seedSearchPageTranslations } from "../src/seo/search-page-translations-seed";

import { SEO_LANGUAGES } from "@workspace/seo-shared/seo-config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SEARCH_PAGE_SOURCE = resolve(
  __dirname,
  "../../megaradio/src/pages/search.tsx",
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
  const src = readFileSync(SEARCH_PAGE_SOURCE, "utf8");
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

describe("Per-language search-page DB translation coverage", () => {
  const searchKeys = extractSearchKeysFromSource();

  it('finds at least one t("search_*", ...) key in search.tsx', () => {
    assert.ok(
      searchKeys.length > 0,
      `No t("search_*", ...) calls found in ${SEARCH_PAGE_SOURCE}. ` +
        "Either the regex stopped matching or the page no longer uses " +
        "the runtime translation store — update this test to match.",
    );
  });

  let fixture: NativePostgresFixture;
  let translationsByLanguage: Map<string, Map<string, string>> = new Map();
  let knownKeys: Set<string> = new Set();

  async function readCoverage(): Promise<void> {
    knownKeys.clear();
    translationsByLanguage.clear();
    const keyDocs = await pgLocalization().getKeys(searchKeys);
    for (const doc of keyDocs) knownKeys.add(doc.key);
    for (const { code } of SEO_LANGUAGES)
      translationsByLanguage.set(code, new Map());
    const rows = await pgLocalization().listTranslations(
      undefined,
      searchKeys,
      true,
    );
    for (const row of rows) {
      translationsByLanguage.get(row.language)?.set(row.keyId.key, row.value);
    }
  }

  before(async () => {
    fixture = await createNativePostgresFixture("search-translation-coverage");
    // Exercise the actual checked-in multilingual boot seeder, not placeholder
    // values: a newly referenced key or language without seed content must fail.
    await seedSearchPageTranslations();
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
          missing.push({ language: code, key, reason: "no rows for language" });
        }
        continue;
      }
      for (const key of searchKeys) {
        // If the TranslationKey itself is absent, we already reported it
        // above — skip per-language noise for that key so the failure
        // list stays focused on rows the team actually has to write.
        if (!knownKeys.has(key)) continue;
        const value = langMap.get(key);
        if (typeof value !== "string" || value.trim().length === 0) {
          missing.push({
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

    const hasGap = missingKeyRows.length > 0 || missing.length > 0;

    assert.ok(
      !hasGap,
      [
        `The runtime DB translation store is missing search-page entries.`,
        "Each missing entry causes the SPA to silently fall back to the hard-coded English copy for that language.",
        "",
        ...(missingKeyRows.length > 0
          ? [
              `Missing TranslationKey rows (${missingKeyRows.length}) — create one row per key, then a Translation per language:`,
              ...missingKeyRows.map((k) => `  - key="${k}"`),
              "",
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
      ].join("\n"),
    );
  }

  it(
    "has a TranslationKey and non-empty seeded Translation for every search key and SEO language",
    assertCompleteCoverage,
  );

  it("reports missing keys, missing translations and whitespace values from PostgreSQL", async () => {
    const [deletedKey, missingTranslationKey, blankTranslationKey] = searchKeys;
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
