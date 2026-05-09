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

// ---------------------------------------------------------------------------
// Module mocks: SeoRenderer pulls in mongoose models, the in-memory perf
// cache, and the qualified-languages cache at import / call time. We don't
// need the DB for the pure render-pipeline assertions exercised here, so
// stub the few imports that would otherwise crash module load or hit Mongo.
// Mirrors faq-schema-visible-content.test.ts.
// ---------------------------------------------------------------------------

interface FakeQuery<T> extends PromiseLike<T> {
  select: (..._args: unknown[]) => FakeQuery<T>;
  sort: (..._args: unknown[]) => FakeQuery<T>;
  populate: (..._args: unknown[]) => FakeQuery<T>;
  limit: (..._args: unknown[]) => FakeQuery<T>;
  setOptions: (..._args: unknown[]) => FakeQuery<T>;
  lean: () => Promise<T>;
}
function fakeQuery<T>(value: T): FakeQuery<T> {
  const q: FakeQuery<T> = {
    select: () => q,
    sort: () => q,
    populate: () => q,
    limit: () => q,
    // `withSignal()` wraps mongoose queries with `query.setOptions(...)` to
    // attach the AbortSignal — must be present on the fake or every
    // mocked Translation.find() call throws and gets swallowed by error
    // handling, leaving noisy logs.
    setOptions: () => q,
    lean: async () => value,
    then: (resolve, reject) =>
      Promise.resolve(value).then(resolve, reject),
  };
  return q;
}

const NULL_MODEL = {
  find: () => fakeQuery([]),
  findOne: () => fakeQuery(null),
  findById: () => fakeQuery(null),
  countDocuments: async () => 0,
  aggregate: () => ({
    allowDiskUse: () => Promise.resolve([]),
    exec: async () => [],
  }),
};

const MONGO_MODEL_NAMES = [
  'AdminPreference', 'AdvancedSearch', 'Advertisement', 'AnalyticsEvent',
  'ApiKey', 'ApiKeyModel', 'ApiUser', 'AppleWebhookEvent', 'AppLog',
  'AuthToken', 'BackfillRun', 'BlacklistedStation', 'BulkDescriptionJob',
  'CastCommand', 'CastNowPlaying', 'CastSession', 'Country',
  'CoverageSnapshot', 'DemoUsage', 'DirectMessage', 'Feedback',
  'FooterSocialMedia', 'Genre', 'GenreSlugCleanupRun', 'GenreWhitelistOverride',
  'IapEvent', 'IndexNowLog', 'Language', 'ListeningSession', 'Notification',
  'PublicUserProfile', 'PushToken', 'Recommendation', 'SeoMetadata',
  'SeoQualifiedLanguagesLkg', 'SitemapManifest', 'Station', 'StationComment',
  'StationDebugLog', 'StationRating', 'StationSimilarity', 'SyncLog',
  'Translation', 'TranslationKey', 'TranslationLanguage', 'TranslationMetadata',
  'TvLoginCode', 'UrlTranslation', 'User', 'UserDevice', 'UserFavorite',
  'UserFollow', 'UserListeningHistory', 'UserMusicProfile', 'UserNotification',
] as const;

const mongoMockExports: Record<string, unknown> = {};
for (const name of MONGO_MODEL_NAMES) mongoMockExports[name] = NULL_MODEL;
mongoMockExports.SAFE_GENRE_SLUG_RE = /^[a-z0-9-]+$/;

mock.module('@workspace/db-shared/mongo-schemas', {
  namedExports: mongoMockExports,
});

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

function extractTitle(html: string): string | null {
  const m = /<title>([\s\S]*?)<\/title>/.exec(html);
  return m ? m[1] : null;
}

function extractMetaDescription(html: string): string | null {
  // Match the FIRST `<meta name="description" content="...">` — the
  // standalone description meta. og:description / twitter:description live
  // on different `property=` / `name=` attributes and won't match.
  const m = /<meta\s+name="description"\s+content="([^"]*)"/.exec(html);
  return m ? m[1] : null;
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
