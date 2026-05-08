/**
 * Regression guard: every language code in SEO_LANGUAGES must have a complete
 * entry in every per-language SEO template registry (region, genre, search,
 * legal, ...).
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
import {
  LEGAL_SEO_TEMPLATES,
  type LegalSeoTemplate,
} from '@workspace/seo-shared/legal-seo-templates';
import { URL_TRANSLATIONS } from '@workspace/seo-shared/url-translations';

const SEARCH_DESCRIPTION_MAX_CHARS = 145;

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

// LEGAL_SEO_TEMPLATES entries nest two pages (terms / privacy) each with
// title + description, so coverage uses dotted paths instead of flat keys.
const LEGAL_TEMPLATE_FIELDS = [
  'terms.title',
  'terms.description',
  'privacy.title',
  'privacy.description',
] as const;

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
  {
    name: 'LEGAL_SEO_TEMPLATES',
    registry: LEGAL_SEO_TEMPLATES as unknown as TemplateRegistry,
    expectedFields: LEGAL_TEMPLATE_FIELDS as ReadonlyArray<string>,
    expectedFieldType: 'string',
  },
];

function getByPath(obj: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (acc, p) => (acc == null ? acc : (acc as Record<string, unknown>)[p]),
      obj,
    );
}

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
      const value = getByPath(entry, field);
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

  // URL_TRANSLATIONS is the per-language slug registry that powers the
  // localised URLs of the static info/legal pages (e.g. /de/datenschutz,
  // /tr/kullanim-kosullari). When a language is missing one of these slugs
  // the router silently falls through to the English path, which Google
  // then indexes as the English URL on a localised hreflang cluster — the
  // exact silent-fallback regression class the per-language SEO template
  // guards above exist to prevent. English itself is the source language
  // (identity mapping) and is intentionally absent from URL_TRANSLATIONS.
  const STATIC_PAGE_URL_SLUGS = [
    'about',
    'contact',
    'applications',
    'privacy-policy',
    'terms-and-conditions',
  ] as const;

  it(`covers every non-English SEO_LANGUAGES code in URL_TRANSLATIONS with all ${STATIC_PAGE_URL_SLUGS.length} static-page slugs`, () => {
    const missingLanguages: string[] = [];
    const incompleteEntries: Record<string, string[]> = {};

    for (const { code } of SEO_LANGUAGES) {
      if (code === 'en') continue;
      const entry = URL_TRANSLATIONS[code];
      if (!entry) {
        missingLanguages.push(code);
        continue;
      }
      const missingSlugs = STATIC_PAGE_URL_SLUGS.filter((slug) => {
        const value = entry[slug];
        return typeof value !== 'string' || value.trim() === '';
      });
      if (missingSlugs.length > 0) {
        incompleteEntries[code] = [...missingSlugs];
      }
    }

    const lines: string[] = [];
    if (missingLanguages.length > 0) {
      lines.push(
        `URL_TRANSLATIONS is missing entries for languages defined in SEO_LANGUAGES.`,
        `  Missing language codes (${missingLanguages.length}): ${missingLanguages.join(', ')}`,
      );
    }
    for (const [code, slugs] of Object.entries(incompleteEntries)) {
      lines.push(
        `  Incomplete entry for "${code}" — missing static-page slugs: ${slugs.join(', ')}`,
      );
    }
    if (lines.length > 0) {
      lines.push(
        `  Each non-English SEO_LANGUAGES entry must define a localised slug for every static page (${STATIC_PAGE_URL_SLUGS.join(', ')}). Without them the router falls back to the English path on a localised hreflang cluster — the same silent fallback the per-language SEO template guards above prevent.`,
      );
    }

    assert.ok(lines.length === 0, lines.join('\n'));
  });

  it(`keeps every SEARCH_SEO_TEMPLATES description within ${SEARCH_DESCRIPTION_MAX_CHARS} chars (meta cap)`, () => {
    const tooLong: Array<{ code: string; length: number }> = [];

    for (const { code } of SEO_LANGUAGES) {
      const entry = SEARCH_SEO_TEMPLATES[code];
      if (!entry || typeof entry.description !== 'string') continue;
      if (entry.description.length > SEARCH_DESCRIPTION_MAX_CHARS) {
        tooLong.push({ code, length: entry.description.length });
      }
    }

    assert.ok(
      tooLong.length === 0,
      `SEARCH_SEO_TEMPLATES has descriptions exceeding the ${SEARCH_DESCRIPTION_MAX_CHARS}-char meta cap:\n` +
        tooLong
          .map(({ code, length }) => `  "${code}": ${length} chars`)
          .join('\n') +
        `\nTrim each entry's \`description\` to ${SEARCH_DESCRIPTION_MAX_CHARS} chars or fewer so Google doesn't truncate it.`,
    );
  });
});

// Touch the LegalSeoTemplate type so tsc --noEmit doesn't strip the import
// and re-introduces a future regression where the type drifts from the registry.
type _LegalSeoTemplateRef = LegalSeoTemplate;
