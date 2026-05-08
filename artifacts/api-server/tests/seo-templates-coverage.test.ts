/**
 * Regression guard: every language code in SEO_LANGUAGES must have a complete
 * entry in every per-language SEO template registry (region, genre, ...).
 *
 * Background: REGION_SEO_TEMPLATES and GENRE_SEO_TEMPLATES silently fall back to
 * English when a language entry is missing. That's how 41 languages quietly
 * served English copy for months. This test fails loudly the moment someone
 * adds a new language to SEO_LANGUAGES without backfilling templates.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { SEO_LANGUAGES } from '../src/shared/seo-config';
import {
  REGION_SEO_TEMPLATES,
  type RegionSeoTemplate,
} from '../src/shared/region-seo-templates';
import {
  GENRE_SEO_TEMPLATES,
  type GenreSeoTemplate,
} from '../src/shared/genre-seo-templates';

const REGION_TEMPLATE_FUNCTIONS: Array<keyof RegionSeoTemplate> = [
  'countryTitle',
  'countryDescription',
  'countryKeywords',
  'countryH1',
  'countryBodyIntro',
  'countryBodyAvailability',
  'regionTitle',
  'regionDescription',
  'regionKeywords',
  'regionH1',
  'regionBodyIntro',
  'regionBodyAvailability',
];

const GENRE_TEMPLATE_FUNCTIONS: Array<keyof GenreSeoTemplate> = [
  'title',
  'description',
  'keywords',
  'h1',
  'bodyIntro',
  'bodyAvailability',
];

type TemplateRegistry = Record<string, Record<string, unknown>>;

function findCoverageGaps(
  registry: TemplateRegistry,
  expectedFunctions: ReadonlyArray<string>,
): { missingLanguages: string[]; incompleteEntries: Record<string, string[]> } {
  const missingLanguages: string[] = [];
  const incompleteEntries: Record<string, string[]> = {};

  for (const { code } of SEO_LANGUAGES) {
    const entry = registry[code];
    if (!entry) {
      missingLanguages.push(code);
      continue;
    }
    const missingFns = expectedFunctions.filter(
      (fn) => typeof entry[fn] !== 'function',
    );
    if (missingFns.length > 0) {
      incompleteEntries[code] = missingFns;
    }
  }

  return { missingLanguages, incompleteEntries };
}

function formatGapMessage(
  registryName: string,
  expectedCount: number,
  gaps: ReturnType<typeof findCoverageGaps>,
): string {
  const lines: string[] = [`${registryName} is missing entries for languages defined in SEO_LANGUAGES.`];
  if (gaps.missingLanguages.length > 0) {
    lines.push(
      `  Missing language codes (${gaps.missingLanguages.length}): ${gaps.missingLanguages.join(', ')}`,
    );
  }
  for (const [code, fns] of Object.entries(gaps.incompleteEntries)) {
    lines.push(`  Incomplete entry for "${code}" — missing functions: ${fns.join(', ')}`);
  }
  lines.push(
    `  Each entry must define all ${expectedCount} template functions. Add the missing language(s) to ${registryName} so we don't silently fall back to English.`,
  );
  return lines.join('\n');
}

describe('Per-language SEO template coverage', () => {
  it('covers every SEO_LANGUAGES code in REGION_SEO_TEMPLATES with all 12 functions', () => {
    const gaps = findCoverageGaps(
      REGION_SEO_TEMPLATES as unknown as TemplateRegistry,
      REGION_TEMPLATE_FUNCTIONS as ReadonlyArray<string>,
    );
    const hasGaps =
      gaps.missingLanguages.length > 0 ||
      Object.keys(gaps.incompleteEntries).length > 0;
    assert.ok(
      !hasGaps,
      formatGapMessage('REGION_SEO_TEMPLATES', REGION_TEMPLATE_FUNCTIONS.length, gaps),
    );
  });

  it('covers every SEO_LANGUAGES code in GENRE_SEO_TEMPLATES with all 6 functions', () => {
    const gaps = findCoverageGaps(
      GENRE_SEO_TEMPLATES as unknown as TemplateRegistry,
      GENRE_TEMPLATE_FUNCTIONS as ReadonlyArray<string>,
    );
    const hasGaps =
      gaps.missingLanguages.length > 0 ||
      Object.keys(gaps.incompleteEntries).length > 0;
    assert.ok(
      !hasGaps,
      formatGapMessage('GENRE_SEO_TEMPLATES', GENRE_TEMPLATE_FUNCTIONS.length, gaps),
    );
  });
});
