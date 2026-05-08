/**
 * Regression guard: every language code in SEO_LANGUAGES must have a complete
 * entry in SEARCH_SEO_TEMPLATES.
 *
 * Background: SEARCH_SEO_TEMPLATES silently falls back to English when a
 * language entry is missing (see getSearchSeoTemplate). That's the same
 * silent-fallback hazard that caused 41 languages to quietly serve English
 * region/genre copy for months. This test fails loudly the moment someone
 * adds a new language to SEO_LANGUAGES without backfilling the search-page
 * template.
 *
 * Mirrors the structure of seo-templates-coverage.test.ts so the failure
 * message is consistent across all three template registries.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { SEO_LANGUAGES } from '@workspace/seo-shared/seo-config';
import {
  SEARCH_SEO_TEMPLATES,
  type SearchSeoTemplate,
} from '@workspace/seo-shared/search-seo-templates';

const SEARCH_TEMPLATE_FIELDS: Array<keyof SearchSeoTemplate> = [
  'title',
  'description',
  'keywords',
  'h1',
  'bodyIntro',
];

type TemplateRegistry = Record<string, Record<string, unknown>>;

function findCoverageGaps(
  registry: TemplateRegistry,
  expectedFields: ReadonlyArray<string>,
): { missingLanguages: string[]; incompleteEntries: Record<string, string[]> } {
  const missingLanguages: string[] = [];
  const incompleteEntries: Record<string, string[]> = {};

  for (const { code } of SEO_LANGUAGES) {
    const entry = registry[code];
    if (!entry) {
      missingLanguages.push(code);
      continue;
    }
    const missingFields = expectedFields.filter((field) => {
      const value = entry[field];
      return typeof value !== 'string' || value.trim().length === 0;
    });
    if (missingFields.length > 0) {
      incompleteEntries[code] = missingFields;
    }
  }

  return { missingLanguages, incompleteEntries };
}

function formatGapMessage(
  registryName: string,
  expectedCount: number,
  gaps: ReturnType<typeof findCoverageGaps>,
): string {
  const lines: string[] = [
    `${registryName} is missing entries for languages defined in SEO_LANGUAGES.`,
  ];
  if (gaps.missingLanguages.length > 0) {
    lines.push(
      `  Missing language codes (${gaps.missingLanguages.length}): ${gaps.missingLanguages.join(', ')}`,
    );
  }
  for (const [code, fields] of Object.entries(gaps.incompleteEntries)) {
    lines.push(`  Incomplete entry for "${code}" — missing fields: ${fields.join(', ')}`);
  }
  lines.push(
    `  Each entry must define all ${expectedCount} non-empty string fields. Add the missing language(s) to ${registryName} so we don't silently fall back to English.`,
  );
  return lines.join('\n');
}

describe('Per-language search SEO template coverage', () => {
  it('covers every SEO_LANGUAGES code in SEARCH_SEO_TEMPLATES with all 5 fields', () => {
    const gaps = findCoverageGaps(
      SEARCH_SEO_TEMPLATES as unknown as TemplateRegistry,
      SEARCH_TEMPLATE_FIELDS as ReadonlyArray<string>,
    );
    const hasGaps =
      gaps.missingLanguages.length > 0 ||
      Object.keys(gaps.incompleteEntries).length > 0;
    assert.ok(
      !hasGaps,
      formatGapMessage('SEARCH_SEO_TEMPLATES', SEARCH_TEMPLATE_FIELDS.length, gaps),
    );
  });
});
