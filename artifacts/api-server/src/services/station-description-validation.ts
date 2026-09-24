export type DescriptionLanguageIssue = {
  language: string;
  field: 'full' | 'meta';
  reason: 'source-copy' | 'wrong-script' | 'untranslated-opener';
};

export type DescriptionLanguageValidationOptions = {
  stationName?: string;
  // The caller must nominate a known source; duplicate text alone cannot prove
  // which of two Latin-script locales is wrong. The source is never a copy target.
  sourceLanguage?: string;
};

const EXPECTED_SCRIPTS: Record<string, RegExp> = {
  ru: /\p{Script=Cyrillic}/u,
  ar: /\p{Script=Arabic}/u,
  zh: /\p{Script=Han}/u,
  // Han-only Japanese and historical Korean text are ambiguous, not evidence
  // of a failed translation. This intentionally misses some wrong-language text.
  ja: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u,
  ko: /[\p{Script=Hangul}\p{Script=Han}]/u,
  hi: /\p{Script=Devanagari}/u,
  he: /\p{Script=Hebrew}/u,
};
const MIN_PROSE_LETTERS = 24;
const baseLanguage = (language: string) => language.toLowerCase().split(/[-_]/)[0];

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function cleanPart(value: unknown, field: 'full' | 'meta'): string {
  if (typeof value !== 'string') return '';
  const marker = field === 'full'
    ? /^\[(?:TRANSLATED\s+)?FULL DESCRIPTION[^\]]*\]\s*/i
    : /^\[(?:TRANSLATED META|SEO META|META)[^\]]*\]\s*/i;
  return value.trim().replace(marker, '').normalize('NFC').replace(/\s+/gu, ' ').trim();
}

function proseWithoutNames(value: string, stationName?: string): string {
  let prose = value;
  const names = [...new Set([stationName?.trim(), 'Mega Radio', 'MegaRadio'].filter((name): name is string => Boolean(name)))];
  for (const name of names.sort((a, b) => b.length - a.length)) {
    const escaped = name.normalize('NFC').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    prose = prose.replace(new RegExp(escaped, 'giu'), ' ');
  }
  return prose.replace(/<[^>]*>/gu, ' ')
    .replace(/&(?:#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]+);/giu, ' ')
    .replace(/\b(?:https?|ftp|mms|rtsp):\/\/\S+|\bwww\.\S+/giu, ' ');
}

function hasSubstantialProse(value: string): boolean {
  // Short names, genre lists and technical labels can legitimately be unchanged.
  // Count Unicode letters, not UTF-16 units or words (CJK prose need not use spaces).
  return (value.match(/\p{Letter}/gu)?.length || 0) >= MIN_PROSE_LETTERS;
}

/** Narrow evidence of an untranslated sentence starter, not a language detector.
 * Preserve proper names and legitimate Latin text in otherwise native prose.
 * A lone "is" is inconclusive except immediately before a target's native script.
 */
export function hasUntranslatedDescriptionOpener(value: string, language: string, stationName?: string): boolean {
  const base = baseLanguage(language);
  if (base === 'en') return false;
  const prose = proseWithoutNames(value, stationName).replace(/^[\s\p{P}\p{S}]*/u, '');
  if (/^(?:tune\s+in\s+to\b|is\s+(?:a|an|the|vibrant)\b)/iu.test(prose)) return true;
  const nativeStart = prose.match(/^is\s+(\S)/iu)?.[1];
  return Boolean(nativeStart && EXPECTED_SCRIPTS[base]?.test(nativeStart));
}

/** Find explicit source copies, known English openers and clear missing-script evidence.
 * An empty result means "no conclusive issue", not verified language correctness.
 * Missing fields, arbitrary Latin-language guesses, other mixed scripts and proper
 * names are intentionally outside this repair decision. Inputs are never changed.
 */
export function findDescriptionLanguageIssues(
  descriptions: unknown,
  languages: readonly string[],
  options: DescriptionLanguageValidationOptions = {},
): DescriptionLanguageIssue[] {
  const collection = record(descriptions);
  if (!collection) return [];
  const sourceLanguage = options.sourceLanguage;
  const source = sourceLanguage ? record(collection[sourceLanguage]) : undefined;
  const issues: DescriptionLanguageIssue[] = [];
  for (const language of new Set(languages)) {
    const description = record(collection[language]);
    if (!description) continue;
    const expectedScript = EXPECTED_SCRIPTS[baseLanguage(language)];
    for (const field of ['full', 'meta'] as const) {
      const text = cleanPart(description[field], field);
      const prose = proseWithoutNames(text, options.stationName);
      if (!hasSubstantialProse(prose)) continue;
      const sourceText = cleanPart(source?.[field], field);
      if (sourceLanguage && baseLanguage(language) !== baseLanguage(sourceLanguage) &&
          sourceText && text.toLowerCase() === sourceText.toLowerCase()) {
        issues.push({ language, field, reason: 'source-copy' });
      } else if (expectedScript && !expectedScript.test(prose)) {
        issues.push({ language, field, reason: 'wrong-script' });
      } else if (hasUntranslatedDescriptionOpener(text, language, options.stationName)) {
        issues.push({ language, field, reason: 'untranslated-opener' });
      }
    }
  }
  return issues;
}

export function getInvalidDescriptionLocales(
  descriptions: unknown,
  languages: readonly string[],
  options: DescriptionLanguageValidationOptions = {},
): string[] {
  return [...new Set(findDescriptionLanguageIssues(descriptions, languages, options).map(issue => issue.language))];
}
