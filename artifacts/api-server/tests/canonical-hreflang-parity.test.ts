/**
 * SEO audit 2026-06, Finding A — canonical / hreflang segment parity.
 *
 * The canonical builder (`buildLocalizedUrl`) and the hreflang builder
 * (`generateLanguageUrls`) resolve localized path segments through two
 * different code paths. If they ever disagree on a segment, the page's
 * canonical URL is absent from its own hreflang set and Google discards
 * the entire hreflang cluster ("Duplicate, Google chose different
 * canonical" / "crawled — not indexed").
 *
 * Both paths share the same precedence: DB translation map →
 * FALLBACK_SEGMENT_TRANSLATIONS → raw English segment. With an empty DB
 * map (the worst case that actually occurs in production when the
 * UrlTranslation collection is sparse), the canonical MUST still localize
 * `station`/`stations` via the fallback table so it matches hreflang.
 *
 * This test fails if a future refactor de-syncs the two resolvers.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLocalizedUrl } from '../src/seo/url-helpers';
import { FALLBACK_SEGMENT_TRANSLATIONS } from '@workspace/seo-shared/seo-config';

const UNIVERSAL_14 = ['en', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'ar', 'zh', 'tr', 'ja', 'ko', 'hi', 'he'];

// Reproduces hreflang's segment resolution (generateLanguageUrls) with an
// empty DB map so we can assert canonical parity against the same logic.
function hreflangSegment(segment: string, lang: string): string {
  return FALLBACK_SEGMENT_TRANSLATIONS[segment]?.[lang] || segment;
}

test('canonical builder localizes `station` segment to match hreflang fallback (empty DB map)', () => {
  const emptyMap = new Map<string, string>();
  for (const lang of UNIVERSAL_14) {
    const canonical = buildLocalizedUrl('/station/bbc-radio-1', lang, undefined, emptyMap);
    const expectedSeg = hreflangSegment('station', lang);
    // Slug stays raw; only the `station` keyword is localized.
    assert.equal(
      canonical,
      `/${lang}/${encodeSeg(expectedSeg)}/bbc-radio-1`,
      `canonical/hreflang segment mismatch for lang=${lang}`,
    );
  }
});

test('canonical builder localizes `stations` segment to match hreflang fallback (empty DB map)', () => {
  const emptyMap = new Map<string, string>();
  for (const lang of UNIVERSAL_14) {
    const canonical = buildLocalizedUrl('/stations', lang, undefined, emptyMap);
    const expectedSeg = hreflangSegment('stations', lang);
    assert.equal(
      canonical,
      `/${lang}/${encodeSeg(expectedSeg)}`,
      `canonical/hreflang segment mismatch for lang=${lang}`,
    );
  }
});

test('DB translation map still takes precedence over the fallback table', () => {
  const dbMap = new Map<string, string>([['de:station', 'radiosender']]);
  const canonical = buildLocalizedUrl('/station/bbc-radio-1', 'de', undefined, dbMap);
  assert.equal(canonical, '/de/radiosender/bbc-radio-1');
});

// Mirror the per-segment encoding buildLocalizedUrl applies so the
// expectation matches for non-ASCII fallbacks (e.g. ja/ko/zh/ar).
function encodeSeg(seg: string): string {
  return encodeURIComponent(seg).replace(
    /[!*'()]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}
