/**
 * Regression guard: every language code in SEO_LANGUAGES must have a complete
 * entry in every per-language SEO template registry (region, genre, search, ...).
 *
 * Background: REGION_SEO_TEMPLATES and GENRE_SEO_TEMPLATES silently fall back to
 * English when a language entry is missing. That's how 41 languages quietly
 * served English copy for months. This test fails loudly the moment someone
 * adds a new language to SEO_LANGUAGES — or a new per-language template
 * registry — without backfilling all entries.
 *
 * When you introduce a new `Record<string, SomeTemplate>` keyed by language
 * code in `lib/seo-shared/src/`, add it to REGISTRIES below so it's covered too.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { SEO_LANGUAGES } from '@workspace/seo-shared/seo-config';
import {
  REGION_SEO_TEMPLATES,
  type RegionSeoTemplate,
} from '@workspace/seo-shared/region-seo-templates';
import {
  GENRE_SEO_TEMPLATES,
  type GenreSeoTemplate,
} from '@workspace/seo-shared/genre-seo-templates';
import {
  SEARCH_SEO_TEMPLATES,
  type SearchSeoTemplate,
} from '@workspace/seo-shared/search-seo-templates';

const REGION_TEMPLATE_FIELDS: Array<keyof RegionSeoTemplate> = [
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

const GENRE_TEMPLATE_FIELDS: Array<keyof GenreSeoTemplate> = [
  'title',
  'description',
  'keywords',
  'h1',
  'bodyIntro',
  'bodyAvailability',
];

const SEARCH_TEMPLATE_FIELDS: Array<keyof SearchSeoTemplate> = [
  'title',
  'description',
  'keywords',
  'h1',
  'bodyIntro',
];

type TemplateRegistry = Record<string, Record<string, unknown>>;
type ExpectedFieldType = 'function' | 'string';

interface RegistrySpec {
  name: string;
  registry: TemplateRegistry;
  expectedFields: ReadonlyArray<string>;
  expectedFieldType: ExpectedFieldType;
}

const REGISTRIES: ReadonlyArray<RegistrySpec> = [
  {
    name: 'REGION_SEO_TEMPLATES',
    registry: REGION_SEO_TEMPLATES as unknown as TemplateRegistry,
    expectedFields: REGION_TEMPLATE_FIELDS as ReadonlyArray<string>,
    expectedFieldType: 'function',
  },
  {
    name: 'GENRE_SEO_TEMPLATES',
    registry: GENRE_SEO_TEMPLATES as unknown as TemplateRegistry,
    expectedFields: GENRE_TEMPLATE_FIELDS as ReadonlyArray<string>,
    expectedFieldType: 'function',
  },
  {
    name: 'SEARCH_SEO_TEMPLATES',
    registry: SEARCH_SEO_TEMPLATES as unknown as TemplateRegistry,
    expectedFields: SEARCH_TEMPLATE_FIELDS as ReadonlyArray<string>,
    expectedFieldType: 'string',
  },
];

function findCoverageGaps(
  registry: TemplateRegistry,
  expectedFields: ReadonlyArray<string>,
  expectedFieldType: ExpectedFieldType,
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
      if (typeof value !== expectedFieldType) return true;
      if (expectedFieldType === 'string' && (value as string).trim() === '') {
        return true;
      }
      return false;
    });
    if (missingFields.length > 0) {
      incompleteEntries[code] = missingFields;
    }
  }

  return { missingLanguages, incompleteEntries };
}

function formatGapMessage(
  spec: RegistrySpec,
  gaps: ReturnType<typeof findCoverageGaps>,
): string {
  const noun = spec.expectedFieldType === 'function' ? 'functions' : 'strings';
  const lines: string[] = [
    `${spec.name} is missing entries for languages defined in SEO_LANGUAGES.`,
  ];
  if (gaps.missingLanguages.length > 0) {
    lines.push(
      `  Missing language codes (${gaps.missingLanguages.length}): ${gaps.missingLanguages.join(', ')}`,
    );
  }
  for (const [code, fields] of Object.entries(gaps.incompleteEntries)) {
    lines.push(
      `  Incomplete entry for "${code}" — missing ${noun}: ${fields.join(', ')}`,
    );
  }
  lines.push(
    `  Each entry must define all ${spec.expectedFields.length} template ${noun}. Add the missing language(s) to ${spec.name} so we don't silently fall back to English.`,
  );
  return lines.join('\n');
}

describe('Per-language SEO template coverage', () => {
  for (const spec of REGISTRIES) {
    const noun = spec.expectedFieldType === 'function' ? 'functions' : 'strings';
    it(`covers every SEO_LANGUAGES code in ${spec.name} with all ${spec.expectedFields.length} ${noun}`, () => {
      const gaps = findCoverageGaps(
        spec.registry,
        spec.expectedFields,
        spec.expectedFieldType,
      );
      const hasGaps =
        gaps.missingLanguages.length > 0 ||
        Object.keys(gaps.incompleteEntries).length > 0;
      assert.ok(!hasGaps, formatGapMessage(spec, gaps));
    });
  }
});
