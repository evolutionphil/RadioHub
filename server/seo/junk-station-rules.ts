/**
 * Centralized SEO rules for stations.
 *
 * Three responsibilities:
 *   1. slugifyStationName(name) — produce a stable, ASCII-safe URL slug that
 *      transliterates non-Latin scripts (Arabic, Cyrillic, Thai, Hangul, …)
 *      and accented Latin characters instead of stripping them.
 *   2. isJunkStation(station) — detect "thin / low-value" station records
 *      that should never enter Google or Bing's index (test feeds, codec
 *      suffix names, song titles posing as stations, accidental duplicates).
 *   3. getEligibleLanguages(station) — determine which UI languages are an
 *      "appropriate language match" for a given station so the sitemap and
 *      hreflang only emit those variants and the others get noindex.
 *
 * This module exists because Bing reported 51 themegaradio.com URLs with
 * `NotIndexedAndMayNeedAttention/ContentQuality`. Most of those URLs were
 * either (a) broken slugs (accents/non-Latin stripped to bare punctuation),
 * (b) junk station records, or (c) a station forcibly translated into a
 * language nobody in that region speaks (e.g. a Mexican station rendered
 * in Korean at /ko/스테이션/...).
 */

import { slugify as transliterateSlugify } from 'transliteration';
import { COUNTRY_TO_LANGUAGE, SEO_LANGUAGES } from '../../shared/seo-config';

const KNOWN_LANGUAGE_CODES = new Set(SEO_LANGUAGES.map((l) => l.code.toLowerCase()));

// -----------------------------------------------------------------------------
// 1. Slug generation
// -----------------------------------------------------------------------------

/**
 * Generate an ASCII slug from any station name.
 *
 * Replaces the previous `name.toLowerCase().replace(/[^\w\s-]/g, '')` regex
 * which silently dropped every accented or non-Latin character. For Arabic
 * "إذاعة" (radio) the old code produced `''`; the new code produces `'idhaa'`.
 */
export function slugifyStationName(name: string): string {
  if (!name || typeof name !== 'string') return '';

  // 1) Transliterate Unicode → ASCII (handles Arabic, Cyrillic, Thai, CJK,
  //    accented Latin, etc.). The library lowercases and replaces separators.
  let slug = transliterateSlugify(name, {
    lowercase: true,
    separator: '-',
    trim: true,
  });

  // 2) Belt-and-braces sanitisation: keep only [a-z0-9-], collapse repeated
  //    hyphens, and trim edge hyphens. The transliteration library is usually
  //    correct, but some upstream characters slip through.
  slug = slug
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug;
}

// -----------------------------------------------------------------------------
// 2. Junk station detection
// -----------------------------------------------------------------------------

/** Substring tokens that, when present in a slug, mark it as junk. */
const JUNK_SLUG_SUBSTRINGS = [
  'dolby-atmos-test',
  'atmos-test',
  'audio-test',
  'codec-test',
  'test-feed',
  'test-stream',
  'test-loop',
  'pink-noise',
  'white-noise',
  'sweep-tone',
  'silence-stream',
];

/**
 * Suffix tokens that almost always indicate the station record is not actually
 * a distinct station — it's a codec/format/bitrate variant, a song name, or a
 * collision-counter duplicate created by the old slug generator.
 */
const JUNK_SLUG_SUFFIXES = [
  '-mp3',
  '-mp3-1',
  '-mp3-2',
  '-aac',
  '-aac-1',
  '-aac-plus',
  '-aacp',
  '-dab',
  '-dab-plus',
  '-flac',
  '-ogg',
  '-opus',
  '-128',
  '-192',
  '-256',
  '-320',
];

/** Regex hints that the "name" is a song/program rather than a station. */
const SONG_LIKE_NAME_PATTERNS: RegExp[] = [
  /\bremix\b/i,
  /\bphonk\b/i,
  /\bnon[\s-]?stop\s+music\b/i,
  /\bonly\s+\w+\s+(mp3|aac)\b/i,   // "Only Mozart MP3"
  /\bmore\s+bounce\s+to\s+the\s+ounce\b/i,
];

export interface JunkDecision {
  isJunk: boolean;
  reason?: string;
}

/**
 * Decide whether a station record is junk and should never be indexed.
 * Returns the matched reason for audit/logging.
 */
export function evaluateJunkStation(station: {
  name?: string;
  slug?: string;
  url?: string;
  homepage?: string;
  tags?: string;
  bitrate?: number;
  lastCheckOk?: boolean;
}): JunkDecision {
  const name = (station.name || '').trim();
  const slug = (station.slug || '').trim().toLowerCase();
  const lowerName = name.toLowerCase();

  if (!name) return { isJunk: true, reason: 'empty-name' };
  if (!station.url) return { isJunk: true, reason: 'empty-stream-url' };

  // NOTE: We deliberately do NOT mark every `-N` slug as junk here. Many
  // legitimate stations have numbers in their names ("Radio 100", "FM 89-1")
  // and the migration script reuses `-N` to break collisions, so blanket
  // matching would noindex valid stations. Duplicate detection is performed
  // by the migration script via `findDuplicateOfBaseSlug` below, which only
  // marks a record junk when an actual sibling with the canonical base slug
  // exists in the database.

  for (const suffix of JUNK_SLUG_SUFFIXES) {
    if (slug.endsWith(suffix)) {
      return { isJunk: true, reason: `codec-suffix:${suffix}` };
    }
  }

  for (const sub of JUNK_SLUG_SUBSTRINGS) {
    if (slug.includes(sub) || lowerName.includes(sub.replace(/-/g, ' '))) {
      return { isJunk: true, reason: `test-feed:${sub}` };
    }
  }

  for (const re of SONG_LIKE_NAME_PATTERNS) {
    if (re.test(lowerName)) {
      return { isJunk: true, reason: `song-or-program-name:${re.source}` };
    }
  }

  // NOTE: We deliberately do NOT flag short slugs as junk. Many legitimate
  // call-sign / brand stations have 2–3 character slugs (e.g. `bbc`, `npr`,
  // `kxt`, `q2`). The transliteration fix already prevents the original
  // "stripped to nothing" failure mode for non-Latin names.

  return { isJunk: false };
}

export function isJunkStation(station: any): boolean {
  return evaluateJunkStation(station).isJunk;
}

/**
 * If `slug` looks like a frequency-prefix duplicate candidate
 * (e.g. "1046-rtl-luxus-hits", "941-bilal-fm", "999-radio-x"), returns the
 * canonical base slug (the part after the leading "<2-4 digit number>-").
 * Returns null when the slug doesn't match the frequency-prefix shape.
 *
 * The caller is expected to confirm a real sibling exists with the base slug
 * before flagging the record as a duplicate — the regex alone is not enough,
 * because some legitimate stations are genuinely named after their frequency.
 *
 * Examples:
 *   "1046-rtl-luxus-hits" -> "rtl-luxus-hits"
 *   "941-bilal-fm"        -> "bilal-fm"
 *   "radio-100"           -> null   (number is the suffix, not prefix)
 *   "99-2"                -> null   (no alphabetic base)
 *   "12-am"               -> null   (base too short)
 */
export function frequencyPrefixBaseSlug(slug: string): string | null {
  if (!slug || typeof slug !== 'string') return null;
  const m = /^(\d{2,4})-([a-z][a-z0-9-]+)$/.exec(slug.toLowerCase());
  if (!m) return null;
  const base = m[2];
  if (base.length < 4) return null;
  return base;
}

// -----------------------------------------------------------------------------
// 3. Eligible languages per station
// -----------------------------------------------------------------------------

/**
 * Major-diaspora / lingua-franca languages that are reasonable for any
 * station regardless of country. English is always included.
 */
const UNIVERSAL_LANGUAGES = ['en'];

/**
 * Map of country code → extra languages spoken by sizable communities in that
 * country (beyond the primary `COUNTRY_TO_LANGUAGE` mapping). Keeps the
 * "appropriate language set" tight while still covering legitimate diaspora
 * audiences. Lowercase ISO 3166-1 alpha-2 keys.
 */
const COUNTRY_EXTRA_LANGUAGES: Record<string, string[]> = {
  us: ['es'], ca: ['fr', 'es'], mx: ['es'], gb: [], ie: [],
  de: ['tr'], at: [], ch: ['fr', 'it'], be: ['fr', 'nl'], lu: ['fr', 'de'],
  fr: ['ar'], es: ['ca'], pt: [], it: [],
  ru: [], ua: ['ru'], by: ['ru'], kz: ['ru'],
  in: ['hi', 'ta', 'te', 'bn', 'mr', 'gu', 'ur'],
  pk: ['ur', 'en'], bd: ['bn'], lk: ['ta'],
  cn: ['zh'], tw: ['zh'], hk: ['zh'], jp: ['ja'], kr: ['ko'],
  sa: ['ar'], ae: ['ar'], eg: ['ar'], ma: ['ar', 'fr'], dz: ['ar', 'fr'],
  tn: ['ar', 'fr'], ly: ['ar'], jo: ['ar'], lb: ['ar', 'fr'],
  br: ['pt'], ar: ['es'], cl: ['es'], co: ['es'], pe: ['es'], ve: ['es'],
  // Türkiye: Almanya'da yaklaşık 3M Türk diasporası — Türk istasyonlarını
  // Almanca arayanlar için /de/sender/* sayfaları da uygun bir dil eşleşmesi.
  tr: ['de'], gr: ['el'], il: ['he', 'ar', 'ru'], ir: ['fa'],
  pl: ['pl'], cz: ['cs'], sk: ['sk'], hu: ['hu'], ro: ['ro'], bg: ['bg'],
  hr: ['hr'], si: ['sl'], rs: ['sr'], ba: ['bs', 'hr', 'sr'],
  fi: ['fi', 'sv'], se: ['sv'], no: ['no'], dk: ['da'], is: ['is'],
  nl: ['nl'], za: ['en', 'af', 'zu'], ng: ['en'], ke: ['en', 'sw'],
  au: ['en'], nz: ['en'], ph: ['en'], my: ['en', 'ms'], sg: ['en', 'zh', 'ms'],
  id: ['id'], th: ['th'], vn: ['vi'], kh: [],
};

/**
 * Return the set of language codes for which a station has an "appropriate
 * language match" — i.e. the language is genuinely spoken by part of the
 * station's audience or its country's residents.
 *
 * The sitemap should only emit `<url>` entries for these languages; other
 * languages get a `noindex` robots tag so Bing/Google stop reporting the
 * station as a low-quality alternate.
 */
export function getEligibleLanguages(station: {
  country?: string;
  countryCode?: string;
  language?: string;
  languageCodes?: string;
  descriptions?: Record<string, { full?: string; meta?: string } | null | undefined> | null;
}): string[] {
  const set = new Set<string>(UNIVERSAL_LANGUAGES);

  const cc = (station.countryCode || '').toLowerCase();
  if (cc && COUNTRY_TO_LANGUAGE[cc]) set.add(COUNTRY_TO_LANGUAGE[cc]);
  if (cc && COUNTRY_EXTRA_LANGUAGES[cc]) {
    for (const l of COUNTRY_EXTRA_LANGUAGES[cc]) set.add(l);
  }

  // Station's own broadcast language(s) — use the ISO codes field (real codes
  // like "en,es"). Skip the freeform `language` field which is a NAME like
  // "Spanish" and would yield bogus 2-char prefixes.
  const codes = (station.languageCodes || '').toString().toLowerCase();
  if (codes) {
    for (const piece of codes.split(/[,;\s]+/)) {
      const norm = piece.trim();
      if (KNOWN_LANGUAGE_CODES.has(norm)) set.add(norm);
    }
  }

  // Station-specific AI-generated descriptions (meta + full). If the station
  // has BOTH a meta description and a full description written for a given
  // language, that language is considered eligible — the page has real,
  // non-templated content to serve, not a thin/auto-translated placeholder.
  // This is what lets multi-language stations like Kronehit get indexed in
  // every language where they genuinely have content, not just in their
  // country-of-origin language.
  const descriptions = station.descriptions;
  if (descriptions && typeof descriptions === 'object') {
    for (const rawLang of Object.keys(descriptions)) {
      const lang = rawLang.toLowerCase();
      if (!KNOWN_LANGUAGE_CODES.has(lang)) continue;
      const entry = descriptions[rawLang];
      if (!entry) continue;
      const full = (entry.full || '').trim();
      const meta = (entry.meta || '').trim();
      // Require BOTH fields non-empty so a half-filled record does not
      // advertise a language that will render a blank/thin page.
      if (full.length > 0 && meta.length > 0) {
        set.add(lang);
      }
    }
  }

  return Array.from(set);
}

/**
 * True if the given UI language is an appropriate match for this station and
 * the page should remain indexable.
 */
export function isLanguageEligibleForStation(
  station: any,
  language: string,
): boolean {
  return getEligibleLanguages(station).includes(language.toLowerCase());
}

// -----------------------------------------------------------------------------
// 4. Unified indexability gate (architect P0)
// -----------------------------------------------------------------------------
//
// The sitemap builder, the SSR robots-meta decision, and the hreflang alternate
// list MUST all agree on which URLs are indexable. Previously each caller
// re-derived its own answer, which caused hreflang to advertise ~57 language
// variants per station even after sitemap/SSR had correctly excluded them —
// Google would discover those advertised URLs, fetch them, and dump them into
// "Crawled - currently not indexed".
//
// `getIndexableLanguagesForStation` is the single source of truth:
//   - returns `[]` when the station is junk / noIndex:true
//     (no alternate should be emitted; the URL itself should 410)
//   - otherwise returns the intersection of
//       (a) languages an audience of this station would reasonably speak
//           (`getEligibleLanguages`), and
//       (b) languages whose UI translations pass the strict
//           `hasCompleteSeoTranslations` gate (`qualifiedLangs` arg).
//
// If `qualifiedLangs` is undefined the caller is opting out of the translation
// gate (e.g. a unit test); in that case only the eligibility filter runs.

/**
 * The definitive "which languages may this station be indexed in?" answer.
 * Used by the sitemap, the SSR noindex decision, the hreflang alternate list,
 * and the 410 handler. Always go through this function — never re-derive.
 */
export function getIndexableLanguagesForStation(
  station: {
    name?: string;
    slug?: string;
    url?: string;
    homepage?: string;
    tags?: string;
    bitrate?: number;
    lastCheckOk?: boolean;
    country?: string;
    countryCode?: string;
    language?: string;
    languageCodes?: string;
    noIndex?: boolean;
  },
  qualifiedLangs?: string[] | ReadonlyArray<string> | Set<string>,
): string[] {
  if (!station) return [];
  if (station.noIndex === true) return [];
  if (isJunkStation(station)) return [];

  const eligible = getEligibleLanguages(station);

  if (!qualifiedLangs) return eligible;

  const qualifiedSet =
    qualifiedLangs instanceof Set
      ? qualifiedLangs
      : new Set(Array.from(qualifiedLangs).map((l) => l.toLowerCase()));

  return eligible.filter((lang) => qualifiedSet.has(lang.toLowerCase()));
}

/**
 * Thin wrapper: is a specific language/station combination indexable?
 * Equivalent to `getIndexableLanguagesForStation(...).includes(lang)` but
 * short-circuits on junk/noIndex.
 */
export function isStationIndexableInLanguage(
  station: any,
  language: string,
  qualifiedLangs?: string[] | ReadonlyArray<string> | Set<string>,
): boolean {
  if (!station || !language) return false;
  if (station.noIndex === true) return false;
  if (isJunkStation(station)) return false;
  const indexable = getIndexableLanguagesForStation(station, qualifiedLangs);
  return indexable.includes(language.toLowerCase());
}
