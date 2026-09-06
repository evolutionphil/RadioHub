/**
 * Task #419: behavioural SSR guard for the per-language about / contact /
 * applications pages.
 *
 * Background: Task #309 added per-language SEO copy in
 * `lib/seo-shared/src/static-page-seo-templates.ts` and a registry-coverage
 * test in `seo-templates-coverage.test.ts` that fails when STATIC_PAGE_SEO_TEMPLATES
 * is missing a language entry. That coverage test does NOT prove the SSR
 * pipeline (artifacts/api-server/src/seo-renderer.ts) actually wires the
 * per-language template into the rendered `<title>` and `<meta name="description">`.
 * If a future refactor of seo-renderer's pageType branching dropped the
 * `pageType === 'about' || === 'contact' || === 'applications'` branch — or
 * stopped calling `buildStaticPageSeo` — every non-English about / contact /
 * applications page would silently regress to the English-fallback inside
 * `generateSeoTags(...)` and the registry-coverage test would still pass.
 *
 * This test renders the SSR HTML for /xx/about, /xx/contact and /xx/applications
 * across a representative spread of SEO_LANGUAGES (en, tr, de, ja, ar, ru, fr)
 * and asserts the rendered `<title>` and `<meta name="description">` match
 * `buildStaticPageSeo(pageType, language).title|description` exactly. Mirrors
 * the SSR-vs-shared-helper assertion pattern used by `faq-schema-visible-content.test.ts`.
 *
 * Runner: requires `--experimental-test-module-mocks`, which the api-server
 * `test` script already passes.
 */

import { test, mock, before } from 'node:test';
import assert from 'node:assert/strict';

// Keep the rendering assertions database-independent by stubbing native read stores.
mock.module('../src/data/postgres-localization-store', { namedExports: {
  pgLocalization: () => ({ getTranslations: async () => ({}) }),
} });
mock.module('../src/data/postgres-seo-read-store', { namedExports: {
  pgSeoCatalog: () => ({ find: async () => [], count: async () => 0, findById: async () => null, findOne: async () => null }),
} });
mock.module('../src/data/postgres-taxonomy-store', { namedExports: { pgStoredGenreBySlug: async () => null } });
mock.module('../src/data/postgres-content-store', { namedExports: { pgSeoMetadata: async () => null } });
mock.module('../src/services/precomputed-genres', { namedExports: {
  PrecomputedGenresService: { getGenres: async () => ({ genres: [], total: 0 }) },
} });
mock.module('../src/seo/qualified-languages', { namedExports: {
  getCachedQualifiedLanguages: async () => ['en', 'tr', 'de', 'ja', 'ar', 'ru', 'fr'],
  getCachedQualifiedLanguagesSync: () => ['en', 'tr', 'de', 'ja', 'ar', 'ru', 'fr'],
} });

mock.module(new URL('../src/performance-cache.ts', import.meta.url).href, {
  namedExports: {
    performanceCache: {
      getTranslations: () => null,
      setTranslations: () => {},
      getPageData: () => null,
      setPageData: () => {},
      getUrlTranslations: async () => new Map<string, string>(),
      getStats: () => ({ hits: 0, misses: 0 }),
    },
    PerformanceCache: class {},
    deepFreeze: <T,>(v: T) => v,
  },
});

// ---------------------------------------------------------------------------
// Module-load: only after mocks are in place.
// ---------------------------------------------------------------------------

let SeoRenderer: new () => {
  renderStaticPage: (
    url: string,
    domain?: string,
    preferredLanguage?: string,
  ) => Promise<{
    language: string;
    cleanPath: string;
    seoTags: { title?: string; description?: string };
    translations: Record<string, string>;
    urlTranslations?: Map<string, string>;
  }>;
  generateHtmlHead: (
    seoTags: any,
    language?: string,
    translations?: Record<string, string>,
    cleanPath?: string,
    stationData?: any,
    urlTranslations?: Map<string, string>,
    additionalData?: any,
  ) => string;
};
let buildStaticPageSeo: (
  pageType: 'about' | 'contact' | 'applications',
  language: string,
  dbTranslations?: Record<string, string>,
) => { title: string; description: string };

before(async () => {
  const rendererMod = (await import('../src/seo-renderer.ts')) as {
    SeoRenderer: typeof SeoRenderer;
  };
  SeoRenderer = rendererMod.SeoRenderer;
  const tplMod = (await import(
    '@workspace/seo-shared/static-page-seo-templates'
  )) as { buildStaticPageSeo: typeof buildStaticPageSeo };
  buildStaticPageSeo = tplMod.buildStaticPageSeo;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// The renderer HTML-escapes every emitted value (escapeHtml — an XSS guard,
// not a bug), so `&` in a template legitimately renders as `&amp;`. Decode
// the extracted markup before comparing against the raw template strings.
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'");
}

function extractTitle(html: string): string | null {
  const m = /<title>([\s\S]*?)<\/title>/.exec(html);
  return m ? decodeHtmlEntities(m[1]) : null;
}

function extractMetaDescription(html: string): string | null {
  // Match the FIRST `<meta name="description" content="...">` — the
  // standalone description meta. og:description / twitter:description live
  // on different `property=` / `name=` attributes and won't match.
  const m = /<meta\s+name="description"\s+content="([^"]*)"/.exec(html);
  return m ? decodeHtmlEntities(m[1]) : null;
}

/**
 * The SSR generateHtmlHead renders `seoTags.title` / `seoTags.description`
 * verbatim into the markup (no HTML-escaping pass). The per-language
 * STATIC_PAGE_SEO_TEMPLATES strings are author-controlled and contain no
 * raw `<` / `>` characters, but they DO contain characters like `&` and
 * `'` which the renderer leaves un-escaped. So our comparison must be
 * raw-string equality, not escaped equality — otherwise we'd be testing
 * an escaping pass the renderer doesn't actually do, and the test would
 * paper over (rather than catch) a future regression.
 */

// ---------------------------------------------------------------------------
// Test matrix: a representative spread of SEO_LANGUAGES (LTR + RTL,
// Latin + Cyrillic + CJK + Arabic) crossed with all three static pages.
// ---------------------------------------------------------------------------

const STATIC_PAGES: ReadonlyArray<'about' | 'contact' | 'applications'> = [
  'about',
  'contact',
  'applications',
];

const TEST_LANGUAGES = ['en', 'tr', 'de', 'ja', 'ar', 'ru', 'fr'] as const;

for (const language of TEST_LANGUAGES) {
  for (const pageType of STATIC_PAGES) {
    const url = `/${language}/${pageType}`;
    const label = `${url} (${pageType}, lang=${language})`;

    test(`SSR renders per-language <title> + <meta description> from buildStaticPageSeo for ${label}`, async () => {
      const renderer = new SeoRenderer();
      const expected = buildStaticPageSeo(pageType, language);

      // Sanity check the test fixture itself: each per-language template
      // must be non-empty and language-distinct, otherwise the assertions
      // below would pass even if the renderer dropped the pageType branch
      // and fell back to English.
      assert.ok(
        expected.title && expected.title.trim().length > 0,
        `${label}: buildStaticPageSeo returned an empty title — fix the template first`,
      );
      assert.ok(
        expected.description && expected.description.trim().length > 0,
        `${label}: buildStaticPageSeo returned an empty description — fix the template first`,
      );

      const result = await renderer.renderStaticPage(
        url,
        'https://themegaradio.com',
      );

      // 1. The renderer correctly identified the language from the URL prefix.
      assert.equal(
        result.language,
        language,
        `${label}: renderStaticPage parsed the wrong language ` +
          `(got "${result.language}", expected "${language}")`,
      );

      // 2. The renderer's about/contact/applications branch wrote the
      //    per-language title/description into seoTags. This is the
      //    direct wiring assertion — if the branch is removed or stops
      //    calling buildStaticPageSeo, this fails for every non-English
      //    language because seoTags would carry the English-fallback
      //    copy from generateSeoTags(...) instead.
      assert.equal(
        result.seoTags.title,
        expected.title,
        `${label}: SSR seoTags.title doesn't match buildStaticPageSeo(${pageType}, ${language}).title.\n` +
          `  expected: ${JSON.stringify(expected.title)}\n` +
          `  actual:   ${JSON.stringify(result.seoTags.title)}\n` +
          `  This is the silent-fallback regression class Task #419 guards against — the per-language ` +
          `pageType branch in seo-renderer.ts likely stopped calling buildStaticPageSeo.`,
      );
      assert.equal(
        result.seoTags.description,
        expected.description,
        `${label}: SSR seoTags.description doesn't match buildStaticPageSeo(${pageType}, ${language}).description.\n` +
          `  expected: ${JSON.stringify(expected.description)}\n` +
          `  actual:   ${JSON.stringify(result.seoTags.description)}\n` +
          `  This is the silent-fallback regression class Task #419 guards against — the per-language ` +
          `pageType branch in seo-renderer.ts likely stopped calling buildStaticPageSeo.`,
      );

      // 3. The actual rendered <head> HTML carries the same per-language
      //    title and description. Belt-and-braces — proves the seoTags
      //    actually flow into the user-facing markup (and didn't get
      //    overwritten by the safety-net fallback at the bottom of
      //    generateHtmlHead).
      const head = renderer.generateHtmlHead(
        result.seoTags,
        result.language,
        result.translations,
        result.cleanPath,
        undefined,
        result.urlTranslations,
        { pageType },
      );

      const renderedTitle = extractTitle(head);
      assert.equal(
        renderedTitle,
        expected.title,
        `${label}: rendered <title> doesn't match per-language template.\n` +
          `  expected: ${JSON.stringify(expected.title)}\n` +
          `  actual:   ${JSON.stringify(renderedTitle)}`,
      );

      const renderedDescription = extractMetaDescription(head);
      assert.equal(
        renderedDescription,
        expected.description,
        `${label}: rendered <meta name="description"> doesn't match per-language template.\n` +
          `  expected: ${JSON.stringify(expected.description)}\n` +
          `  actual:   ${JSON.stringify(renderedDescription)}`,
      );
    });
  }
}

// ---------------------------------------------------------------------------
// Cross-language distinctness guard: prove the per-language templates
// actually differ from the English fallback for our non-English test
// languages. Without this, the assertions above would still pass if
// every language entry in STATIC_PAGE_SEO_TEMPLATES happened to be a
// copy of the English entry (which is exactly the silent-fallback
// failure mode this task suite exists to prevent).
// ---------------------------------------------------------------------------

test('per-language about/contact/applications templates differ from English (no copy-paste fallback)', async () => {
  const offenders: string[] = [];
  for (const language of TEST_LANGUAGES) {
    if (language === 'en') continue;
    for (const pageType of STATIC_PAGES) {
      const en = buildStaticPageSeo(pageType, 'en');
      const xx = buildStaticPageSeo(pageType, language);
      if (en.title === xx.title) {
        offenders.push(`${language}/${pageType}.title === en/${pageType}.title`);
      }
      if (en.description === xx.description) {
        offenders.push(
          `${language}/${pageType}.description === en/${pageType}.description`,
        );
      }
    }
  }
  assert.equal(
    offenders.length,
    0,
    `STATIC_PAGE_SEO_TEMPLATES has non-English entries identical to English ` +
      `— that's the silent-fallback regression Task #309 fixed:\n  ${offenders.join('\n  ')}`,
  );
});

// ---------------------------------------------------------------------------
// A-Z station index pages (Task #11, 2026-07-03): /stations/<a-z|0-9>.
// Rendered end-to-end through the mocked renderer: the Station model mock
// returns an empty list (the soft-fail path), which must still produce a
// letter-suffixed <title>/H1, the canonical on the PLURAL letter URL, and
// the full 27-link A-Z rail — the crawl surface the feature exists for.
// ---------------------------------------------------------------------------

test('A-Z letter page /en/stations/a: letter-suffixed title, canonical, 27-link rail', async () => {
  const renderer = new SeoRenderer();
  const result = await renderer.renderStaticPage(
    '/en/stations/a',
    'https://themegaradio.com',
  );

  assert.equal(result.language, 'en');
  assert.equal(result.cleanPath, '/stations/a', 'cleanPath must be normalized to the plural form');

  const seoTags = result.seoTags as any;
  assert.ok(
    String(seoTags.title || '').includes('— A'),
    `letter page <title> must carry the letter label, got ${JSON.stringify(seoTags.title)}`,
  );
  assert.ok(
    String(seoTags.canonical || '').endsWith('/en/stations/a'),
    `canonical must be the plural letter URL, got ${JSON.stringify(seoTags.canonical)}`,
  );
  // Every hreflang alternate must keep the letter key untranslated.
  if (Array.isArray(seoTags.hreflangs)) {
    for (const alt of seoTags.hreflangs) {
      assert.match(
        String(alt.url),
        /\/a$/,
        `hreflang ${alt.hreflang} must end with the raw letter, got ${alt.url}`,
      );
    }
  }

  const pageData = (result as any).pageData ?? {};
  assert.equal(pageData.azLetter, 'a', 'additionalData.azLetter must reach pageData');

  const body = renderer.generateHtmlBody({
    pageType: 'stations',
    language: result.language,
    translations: result.translations,
    seoTags: result.seoTags,
    additionalData: pageData,
    urlTranslations: result.urlTranslations,
    cleanPath: result.cleanPath,
  } as any);

  assert.ok(body.includes('class="az-index"'), 'body must render the A-Z rail');
  assert.ok(
    body.includes('<span aria-current="page">A</span>'),
    'current letter must render as a non-link current marker',
  );
  // All other keys are links; spot-check a letter, the 0-9 bucket and count.
  // Scope the count to the rail itself — the breadcrumb also links the page.
  const railStart = body.indexOf('class="az-index"');
  const rail = body.slice(railStart, body.indexOf('</nav>', railStart));
  assert.ok(rail.includes('href="/en/stations/b"'), 'rail must link sibling letters');
  assert.ok(rail.includes('href="/en/stations/0-9"'), 'rail must link the 0-9 bucket');
  const railLinks = (rail.match(/href="\/en\/stations\/(?:0-9|[a-z])"/g) || []).length;
  assert.equal(railLinks, 26, 'rail must link the 26 non-current keys');
  assert.match(
    body,
    /<h1>[^<]*— A<\/h1>/,
    'H1 must carry the letter label so letter pages are not a duplicate-H1 cluster',
  );
});

test('A-Z letter page localizes the stations segment: /tr/istasyonlar/m', async () => {
  const renderer = new SeoRenderer();
  const result = await renderer.renderStaticPage(
    '/tr/istasyonlar/m',
    'https://themegaradio.com',
  );

  assert.equal(result.language, 'tr');
  assert.equal(result.cleanPath, '/stations/m');
  const seoTags = result.seoTags as any;
  assert.ok(
    String(seoTags.canonical || '').endsWith('/tr/istasyonlar/m'),
    `canonical must stay on the localized plural segment, got ${JSON.stringify(seoTags.canonical)}`,
  );

  const body = renderer.generateHtmlBody({
    pageType: 'stations',
    language: result.language,
    translations: result.translations,
    seoTags: result.seoTags,
    additionalData: (result as any).pageData ?? {},
    urlTranslations: result.urlTranslations,
    cleanPath: result.cleanPath,
  } as any);

  assert.ok(
    body.includes('href="/tr/istasyonlar/a"'),
    'rail links must use the localized stations segment',
  );
  assert.ok(body.includes('<span aria-current="page">M</span>'));
});

test('stations hub /en/stations still renders and now carries the A-Z rail', async () => {
  const renderer = new SeoRenderer();
  const result = await renderer.renderStaticPage(
    '/en/stations',
    'https://themegaradio.com',
  );
  assert.equal(result.cleanPath, '/stations');
  const seoTags = result.seoTags as any;
  assert.ok(
    !String(seoTags.title || '').includes('— A'),
    'hub title must NOT carry a letter label',
  );

  const body = renderer.generateHtmlBody({
    pageType: 'stations',
    language: result.language,
    translations: result.translations,
    seoTags: result.seoTags,
    additionalData: (result as any).pageData ?? {},
    urlTranslations: result.urlTranslations,
    cleanPath: result.cleanPath,
  } as any);

  assert.ok(body.includes('class="az-index"'), 'hub must render the A-Z rail');
  const railLinks = (body.match(/href="\/en\/stations\/(?:0-9|[a-z])"/g) || []).length;
  assert.equal(railLinks, 27, 'hub rail must link all 27 keys (none is current)');
});

// ---------------------------------------------------------------------------
// LCP hero (PageSpeed 2026-07-03): the SSR home body must paint the SAME
// hero <picture> the SPA renders, or mobile LCP regresses back to the
// React-mount repaint (~8s on slow 4G, Lighthouse perf 50).
// ---------------------------------------------------------------------------

test('home SSR body renders the LCP hero picture with fetchpriority=high', async () => {
  const renderer = new SeoRenderer();
  const result = await renderer.renderStaticPage('/en', 'https://themegaradio.com');
  const body = renderer.generateHtmlBody({
    pageType: 'home',
    language: result.language,
    translations: result.translations,
    seoTags: result.seoTags,
    additionalData: (result as any).pageData ?? {},
    urlTranslations: result.urlTranslations,
    cleanPath: result.cleanPath,
  } as any);

  assert.ok(body.includes('class="hero-container overflow-visible"'), 'hero container missing');
  assert.ok(body.includes('srcset="/images/hero-bg.webp"'), 'desktop hero source missing');
  assert.ok(body.includes('src="/images/hero-bg-430w.webp"'), 'mobile hero img missing');
  assert.ok(body.includes('fetchpriority="high"'), 'hero must keep fetchpriority=high');
  assert.ok(/width="1920" height="600"/.test(body), 'hero must keep intrinsic dimensions (CLS)');
  assert.ok(/<h1[^>]*>/.test(body), 'home H1 must survive inside the hero overlay');
});
