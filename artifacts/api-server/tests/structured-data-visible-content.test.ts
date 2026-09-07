/**
 * Task #280: visible-content guard for the other rich-snippet schemas
 * we emit alongside FAQPage. Same class of "schema references content
 * that isn't on the page" bug Tasks #129/#164/#208 fixed for FAQPage —
 * Google flags any mismatch as deceptive markup.
 *
 * Coverage:
 *   1. BreadcrumbList JSON-LD: every itemListElement.name MUST appear
 *      as a visible breadcrumb link <a href="..."> in the rendered body,
 *      and the href must match the JSON-LD `item` (modulo origin).
 *      Exercised across station / about / regions / genres / FAQ pages
 *      in English plus a non-English language to catch translation drift.
 *
 *   2. ItemList JSON-LD (homepage popular stations): every ListItem.item.name
 *      must render as a visible <h3>, and every ListItem.item.url must
 *      appear as a visible <a href="..."> in the body.
 *
 * Runner: requires `--experimental-test-module-mocks`, which the
 * api-server `test` script already passes.
 */
import { test, mock, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Module mocks: mirror faq-schema-visible-content.test.ts so SeoRenderer
// can be imported without booting Mongo / the perf cache.
// ---------------------------------------------------------------------------

interface FakeQuery<T> extends PromiseLike<T> {
  select: (..._args: unknown[]) => FakeQuery<T>;
  sort: (..._args: unknown[]) => FakeQuery<T>;
  populate: (..._args: unknown[]) => FakeQuery<T>;
  limit: (..._args: unknown[]) => FakeQuery<T>;
  lean: () => Promise<T>;
}
function fakeQuery<T>(value: T): FakeQuery<T> {
  const q: FakeQuery<T> = {
    select: () => q,
    sort: () => q,
    populate: () => q,
    limit: () => q,
    lean: async () => value,
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject),
  };
  return q;
}

const NULL_MODEL = {
  find: () => fakeQuery([]),
  findOne: () => fakeQuery(null),
  findById: () => fakeQuery(null),
  countDocuments: async () => 0,
  aggregate: () => ({ allowDiskUse: () => Promise.resolve([]), exec: async () => [] }),
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
// 2026-07-03: mongo-schemas grew new exports (IndexNowSubmissionUrls,
// GenreCount, MediaGroup, normalizeGenreSlug, ...) AFTER this mock's model
// list was written, and the SSR import graph (seo-renderer -> services/
// indexnow.ts et al.) now imports some of them at module level. Any missing
// named export kills the WHOLE suite at module-instantiation ("does not
// provide an export named ..." -> every test hookFailed/SyntaxError), which
// is exactly how these suites silently rotted to 0 passing. Mirror EVERY
// runtime export of mongo-schemas: models default to NULL_MODEL, the few
// non-model exports get workable stand-ins below.
const SUPPLEMENTAL_MONGO_EXPORT_NAMES = [
  'AdminSetting', 'AdminSettingHistory', 'Ads', 'AuthEventLog',
  'ClearedOverridesAuditLog', 'Codec', 'CountryLanguageMapping',
  'CoverageBackfillRun', 'CoverageBackfillStatus', 'EnhancedLanguage',
  'GenreCount', 'GenreMergeAuditLog', 'GenreStationCountsRun',
  'GenreWhitelistPushLog', 'GscIndexingSnapshot', 'GscOAuthToken',
  'GscUrlInspection', 'IndexNowSubmissionUrls', 'LaravelPage', 'MediaGroup',
  'Page', 'SemrushIssue', 'SharedComparisonPreset', 'SitemapUrlSnapshot',
  'StationEngagement', 'StationErrorLog', 'StationPlaybackCache',
  'StationRequest', 'StationSubmission', 'StripeSaleEvent',
  'StripeSubscriptionPlan', 'TvSubscriptionCode', 'TvTelemetry',
  'TvTelemetryDaily', 'TvVersionConfig', 'UserProfile', 'UserSession',
  'VisitorSession',
] as const;
for (const name of SUPPLEMENTAL_MONGO_EXPORT_NAMES) {
  if (!(name in mongoMockExports)) mongoMockExports[name] = NULL_MODEL;
}
mongoMockExports.INDEXNOW_SUBMISSION_URLS_RETENTION_DAYS = 30;
mongoMockExports.ADMIN_SETTING_HISTORY_RETENTION_PER_KEY = 20;
mongoMockExports.normalizeGenreSlug = (raw: string) =>
  String(raw ?? '').toLowerCase().trim().replace(/\s+/g, '-');

mock.module('@workspace/legacy-migration/mongo-schemas', {
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
  applyCustomSeoMetadata: (baseSeoTags: any, customMetadata: any) => any;
  generateStructuredData: (
    seoTags: any, language?: string, translations?: Record<string, string>,
    cleanPath?: string, stationData?: any, urlTranslations?: Map<string, string>, additionalData?: any,
  ) => { global: any[]; page: any[] };
  generateHtmlBody: (pageData: any) => string;
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

before(async () => {
  const rendererMod = (await import('../src/seo-renderer.ts')) as {
    SeoRenderer: typeof SeoRenderer;
  };
  SeoRenderer = rendererMod.SeoRenderer;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(input: string): string {
  if (!input) return '';
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function extractSchemasOfType(head: string, type: string): any[] {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/g;
  const out: any[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(head)) !== null) {
    const raw = m[1].trim();
    if (!raw) continue;
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `Failed to JSON.parse a JSON-LD block: ${(err as Error).message}\n---\n${raw.slice(0, 200)}`,
      );
    }
    const blocks = Array.isArray(parsed) ? parsed : [parsed];
    for (const b of blocks) {
      if (b && b['@type'] === type) out.push(b);
    }
  }
  return out;
}

const DOMAIN = 'https://themegaradio.com';

test('SSR H1 emits special characters as text exactly once, including already literal entity text', async () => {
  const { buildGenreSeo } = await import('@workspace/seo-shared/genre-seo-templates');
  const { generateLocalizedStationTitle } = await import('@workspace/seo-shared/seo-config');
  const renderer = new SeoRenderer();
  const maliciousName = `Radio "Jazz" & O'Neil <img src=x onerror=alert(1)>`;
  const missingName = { name: '', country: 'Country & "Region"' };
  const fallbackTitle = generateLocalizedStationTitle(missingName, 'en', {});
  const lastDash = fallbackTitle.lastIndexOf(' — ');
  const fixtures = [
    { pageType: 'station', stationData: { name: maliciousName }, expected: maliciousName },
    { pageType: 'station', stationData: { name: 'Radio &amp; Roll' }, expected: 'Radio &amp; Roll' },
    { pageType: 'station', stationData: missingName, expected: lastDash > 0 ? fallbackTitle.slice(0, lastDash) : fallbackTitle },
    { pageType: 'genres', additionalData: { genreName: 'Rock & Roll' }, expected: buildGenreSeo('Rock & Roll', 'en', {}).h1 },
    { pageType: 'regions', additionalData: { regionName: 'R&B <Region>' }, translations: { seo_radio_stations: 'Radio & "Shows"' }, expected: 'R&B <Region> Radio & "Shows"' },
    { pageType: 'home', translations: { hero_worlds_best_radio: 'Radio & "Music"' }, expected: 'Radio & "Music"' },
  ];
  for (const fixture of fixtures) {
    const html = renderer.generateHtmlBody({ language: 'en', translations: {}, ...fixture,
      seoTags: { title: 'Fixture', description: 'Fixture', domain: DOMAIN },
      urlTranslations: new Map(), cleanPath: '/' });
    const headings = [...html.matchAll(/<h1(?:\s[^>]*)?>([\s\S]*?)<\/h1>/g)];
    assert.equal(headings.length, 1, fixture.pageType);
    assert.equal(headings[0][1], escapeHtml(fixture.expected), fixture.pageType);
    assert.doesNotMatch(headings[0][1], /<img|<script|<Region>/, 'untrusted text must never become HTML');
  }
});

test('SSR station image alt rejects corrupt templates in 14 locales and safely retains valid custom text', async () => {
  const { LOCALIZED_LOGO_WORD, SITEMAP_PRIORITY_LANGUAGES } = await import('@workspace/seo-shared/seo-config');
  const renderer = new SeoRenderer();
  const station = { name: 'Test "Radio" & $&', slug: 'test-radio', genre: 'rock',
    logoAssets: { webp256: 'https://example.invalid/logo.png' }, descriptions: {} };
  const body = (language: string, translation: string) => renderer.generateHtmlBody({
    pageType: 'station', language, stationData: station,
    translations: { seo_station_logo_alt: translation }, additionalData: { pageType: 'station' },
    urlTranslations: new Map(), cleanPath: '/station/test-radio',
    seoTags: { title: station.name, description: 'Fixture station', domain: DOMAIN, canonical: `${DOMAIN}/${language}/station/test-radio` },
  });
  for (const language of SITEMAP_PRIORITY_LANGUAGES.universal14) {
    const html = body(language, 'Listen to ${station.name} live - ${station.genre ||');
    assert.ok(html.includes(`alt="${escapeHtml(station.name)} ${LOCALIZED_LOGO_WORD[language]}"`));
    assert.doesNotMatch(html, /\$\{station\./);
  }
  const custom = body('tr', 'Özel "{NAME}" & {genre}');
  assert.ok(custom.includes(`alt="${escapeHtml(`Özel "${station.name}" & rock`)}"`));
  assert.doesNotMatch(custom.match(/<img[^>]*alt="([^"]*)"/)?.[1] || '', /&amp;quot;/, 'escape the completed alt only once');
});

test('SSR head retains localized station meta selection and explicit admin override priority in all 14 locales', async () => {
  const { generateSeoTags, getStationMetaDescription, SITEMAP_PRIORITY_LANGUAGES } = await import('@workspace/seo-shared/seo-config');
  const renderer = new SeoRenderer();
  for (const language of SITEMAP_PRIORITY_LANGUAGES.universal14) {
    const englishMeta = 'Fixture Radio: music and local news.';
    const station = {
      name: 'Fixture Radio', slug: 'fixture-radio', country: 'Germany', countryCode: 'DE',
      descriptions: {
        en: { full: 'English fixture description.', meta: englishMeta },
        ...(language === 'en' ? {} : { [language]: { full: `${language}: Localized fixture description.`, meta: englishMeta } }),
      },
    };
    const tags = generateSeoTags('station', language, {}, '/station/fixture-radio', DOMAIN, station);
    const expected = getStationMetaDescription(station, language, {});
    const html = renderer.generateHtmlHead(tags, language, {}, '/station/fixture-radio', station);
    assert.ok(html.includes(`<meta name="description" content="${escapeHtml(expected)}">`), language);
    assert.ok(html.includes(`<meta name="twitter:description" content="${escapeHtml(expected)}">`), language);
    const custom = { description: 'Admin-approved description.', twitterDescription: 'Admin-approved Twitter summary.' };
    const overridden = renderer.applyCustomSeoMetadata({ ...tags }, custom);
    const overriddenHtml = renderer.generateHtmlHead(overridden, language, {}, '/station/fixture-radio', station);
    assert.ok(overriddenHtml.includes(`<meta name="description" content="${custom.description}">`), `${language}: admin description`);
    assert.ok(overriddenHtml.includes(`<meta name="twitter:description" content="${custom.twitterDescription}">`), `${language}: admin Twitter description`);
  }
});

test('SSR and SPA share identical structured-data objects across all 14 indexable locales', async () => {
  const { SITEMAP_PRIORITY_LANGUAGES } = await import('@workspace/seo-shared/seo-config');
  const renderer = new SeoRenderer();
  assert.equal(SITEMAP_PRIORITY_LANGUAGES.universal14.length, 14);
  for (const language of SITEMAP_PRIORITY_LANGUAGES.universal14) {
    const station = {
      _id: 'schema-fixture', slug: 'fixture-radio', name: 'Fixture Radio', country: 'Germany', countryCode: 'DE', languageCodes: 'tr',
      tags: 'pop, FM 102.5', bitrate: 128, codec: 'mp3', descriptions: { [language]: { full: `${language}: Station description`, meta: `${language}: Station summary` } },
    };
    const translatedSegment = language === 'tr' ? 'istasyon' : language === 'de' ? 'sender' : 'station';
    const urlTranslations = new Map([[`${language}:station`, translatedSegment]]);
    const canonical = `${DOMAIN}/${language}/${translatedSegment}/fixture-radio`;
    const tags = { title: 'Fixture Radio', description: `${language}: Station summary`, canonical, domain: DOMAIN };
    const args = [tags, language, {}, '/station/fixture-radio', station, urlTranslations, { pageType: 'station' }] as const;
    const data = renderer.generateStructuredData(...args);
    const html = renderer.generateHtmlHead(...args);
    for (const scope of ['global', 'page'] as const) {
      const matches = [...html.matchAll(new RegExp(`<script[^>]*data-schema-scope="${scope}"[^>]*>([\\s\\S]*?)<\\/script>`, 'g'))];
      assert.deepEqual(matches.map(match => JSON.parse(match[1])), data[scope], `${language}: ${scope} schema diverged`);
    }
    const stationSchema = data.page.find(schema => schema['@type'] === 'RadioBroadcastService');
    assert.equal(stationSchema.url, canonical);
    assert.equal(stationSchema.inLanguage, 'tr', 'translating a page must not change the station broadcast language');
    assert.equal(stationSchema.description, `${language}: Station description`);
    assert.equal(stationSchema.aggregateRating, undefined, 'no synthetic ratings introduced by SPA payload');
    assert.deepEqual(stationSchema.category, ['pop', 'FM 102.5']);
    for (const invalidOrSuperseded of ['keywords', 'additionalProperty', 'isAccessibleForFree', 'area']) {
      assert.equal(invalidOrSuperseded in stationSchema, false, `${language}: Service must not emit ${invalidOrSuperseded}`);
    }
    assert.deepEqual(stationSchema.broadcastFrequency.broadcastFrequencyValue, {
      '@type': 'QuantitativeValue', value: 102.5, unitText: 'MHz',
    });
    assert.equal('frequencyUnit' in stationSchema.broadcastFrequency, false);
    assert.equal(data.page.find(schema => schema['@type'] === 'WebPage')?.isAccessibleForFree, true);
    assert.equal(data.page.find(schema => schema['@type'] === 'WebPage')?.inLanguage, language);
    assert.doesNotThrow(() => JSON.stringify(data), 'payload must be JSON serializable');
  }
});

test('missing broadcast language is never inferred from the page locale or station country', () => {
  const renderer = new SeoRenderer();
  for (const language of ['en', 'tr', 'ja', 'ar']) {
    const station = { name: 'KRAL FM', slug: 'kral-fm', country: 'Türkiye', countryCode: 'TR', language: null, languageCodes: null };
    const tags = { title: 'KRAL FM', canonical: `${DOMAIN}/${language}/station/kral-fm`, domain: DOMAIN };
    const data = renderer.generateStructuredData(tags, language, {}, '/station/kral-fm', station, new Map(), { pageType: 'station' });
    assert.equal(data.page.find(schema => schema['@type'] === 'RadioBroadcastService')?.inLanguage, undefined);
    assert.equal(data.page.find(schema => schema['@type'] === 'WebPage')?.inLanguage, language);
  }
});

test('shared schema builder replaces station entities with the current listing and retains noindex gates', () => {
  const renderer = new SeoRenderer();
  const seoTags = { title: 'Genres', description: 'Genre list', canonical: `${DOMAIN}/de/genres` };
  const listing = renderer.generateStructuredData(seoTags, 'de', {}, '/genres', undefined, undefined, { pageType: 'genres' });
  assert.equal(listing.page.some(schema => schema['@type'] === 'RadioBroadcastService'), false);
  assert.equal(listing.global.some(schema => schema['@type'] === 'WebSite'), true);
  const hidden = renderer.generateStructuredData({ ...seoTags, noIndex: true }, 'de', {}, '/station/hidden', {
    slug: 'hidden', name: 'Hidden station', descriptions: { de: { full: 'Verborgener Sender' } },
  }, undefined, { pageType: 'station' });
  assert.equal(hidden.page.some(schema => ['RadioBroadcastService', 'RadioStation', 'WebPage'].includes(schema['@type'])), false);
});

test('all 14 locales preserve station identity without fabricated network, profile, or person claims', async () => {
  const { SITEMAP_PRIORITY_LANGUAGES } = await import('@workspace/seo-shared/seo-config');
  const renderer = new SeoRenderer();
  for (const language of SITEMAP_PRIORITY_LANGUAGES.universal14) {
    const station = {
      _id: 'independent-radio', slug: 'independent-radio', name: 'Independent Radio',
      homepage: 'https://independent-radio.example/', country: 'Germany', countryCode: 'DE',
      tags: 'news', descriptions: { [language]: { full: `${language}: Independent radio description` } },
    };
    for (const pageType of ['home', 'station']) {
      const cleanPath = pageType === 'home' ? '/' : '/station/independent-radio';
      const tags = { title: station.name, description: `${language}: Summary`, canonical: `${DOMAIN}/${language}${cleanPath}` };
      const args = [tags, language, {}, cleanPath, pageType === 'station' ? station : undefined,
        undefined, { pageType, popularStations: [station] }] as const;
      const data = renderer.generateStructuredData(...args);
      const html = renderer.generateHtmlHead(...args);
      assert.equal(data.global.some(schema => schema['@type'] === 'Person'), false);
      assert.deepEqual(extractSchemasOfType(html, 'Person'), []);
      assert.equal(JSON.stringify(data).includes('broadcastAffiliateOf'), false, `${language}/${pageType}: directory is not a broadcast network`);
      const brand = data.global.find(schema => schema['@id'] === `${DOMAIN}/#organization`);
      assert.equal(brand?.name, 'Mega Radio');
      assert.equal(brand?.sameAs, undefined, 'do not guess organization social profiles from its name');
      const studio = data.global.find(schema => schema['@id'] === 'https://visiongo.at/#organization');
      assert.equal(studio?.name, 'Vision GO');
      assert.equal(studio?.address.streetAddress, 'Bäckerstraße 7/7');
      if (pageType === 'station') {
        const radio = data.page.find(schema => schema['@type'] === 'RadioBroadcastService');
        assert.equal(radio?.sameAs, station.homepage, 'station-owned homepage must not be removed with guessed organization profiles');
        assert.equal(radio?.broadcaster.name, station.name);
        assert.equal(radio?.description, `${language}: Independent radio description`);
        const webPage = data.page.find(schema => schema['@type'] === 'WebPage');
        assert.equal(webPage?.mainEntity['@id'], radio['@id']);
        assert.equal(data.global.find(schema => schema['@type'] === 'WebSite')?.['@id'], `${DOMAIN}/#website`);
      }
    }
  }
});

test('schema builders cannot silently reintroduce directory-as-network affiliation', () => {
  for (const path of [
    '../src/seo-renderer.ts',
    '../../../lib/seo-shared/src/structured-data.ts',
    '../../megaradio/src/utils/structured-data.ts',
    '../../megaradio/src/pages/RegionStationsPage.tsx',
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /["']?broadcastAffiliateOf["']?\s*:/, path);
  }
});

// ===========================================================================
// 0. Source-scan guard: catch new BreadcrumbList emissions on unexpected
//    surfaces. Mirrors the FAQPage source-scan in
//    faq-schema-visible-content.test.ts. If a new emission appears outside
//    the known guards, this test fails — the new surface needs to be added
//    to BREADCRUMB_EMITTING_SURFACES (or to the SeoHead client guard list)
//    and have visible-content coverage added in section 1 below.
// ===========================================================================

interface SchemaEmissionSurface {
  fileUrl: URL;
  label: string;
  emissionPatterns: ReadonlyArray<RegExp>;
  allowedGuards: ReadonlyArray<string>;
}

const BREADCRUMB_EMISSION_SURFACES: SchemaEmissionSurface[] = [
  {
    fileUrl: new URL('../src/seo-renderer.ts', import.meta.url),
    label: 'api-server SSR (seo-renderer.ts)',
    emissionPatterns: [/["']@type["']\s*:\s*["']BreadcrumbList["']/g],
    // SSR guards BreadcrumbList JSON-LD with `additionalData?.pageType !== 'home'`.
    allowedGuards: [
      `additionalData?.pageType !== 'home'`,
      `additionalData?.pageType !== "home"`,
    ],
  },
  // 2026-07-01: the megaradio client surface (SeoHead.tsx) was REMOVED from
  // this list on purpose — client-side JSON-LD injection was deleted
  // entirely (it duplicated the server-rendered entities and re-advertised
  // all 57 languages via hreflang). The server is the single emission
  // surface now; if a client emission ever reappears, add the surface back
  // here WITH its guard so the visible-content contract keeps holding.
];

test('source-scan: every BreadcrumbList JSON-LD emission lives behind a known pageType guard', () => {
  for (const surface of BREADCRUMB_EMISSION_SURFACES) {
    const src = readFileSync(fileURLToPath(surface.fileUrl), 'utf8');
    let emissionCount = 0;
    for (const pattern of surface.emissionPatterns) {
      pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(src)) !== null) {
        emissionCount += 1;
        const windowStart = Math.max(0, m.index - 1500);
        const ctx = src.slice(windowStart, m.index);
        const guarded = surface.allowedGuards.some((g) => ctx.includes(g));
        assert.ok(
          guarded,
          `${surface.label}: found a BreadcrumbList emission at offset ${m.index} that isn't preceded by a known guard ` +
            `(${surface.allowedGuards.join(' / ')}). New BreadcrumbList surfaces must add a pageType to ` +
            `BREADCRUMB_EMITTING_PAGE_TYPES below and verify the visible body renders matching <a> links — see Task #280.`,
        );
      }
    }
    assert.ok(
      emissionCount > 0,
      `${surface.label}: expected at least one BreadcrumbList emission to scan; found 0. ` +
        `If the emission moved, update BREADCRUMB_EMISSION_SURFACES in this test.`,
    );
  }
});

// ===========================================================================
// 1. BreadcrumbList: every JSON-LD item must appear as a visible breadcrumb
//    link in the rendered body.
// ===========================================================================

interface BreadcrumbCase {
  label: string;
  pageType: string;
  cleanPath: string;
  language: string;
  translations?: Record<string, string>;
  urlTranslations?: Map<string, string>;
  stationData?: any;
  additionalData?: Record<string, unknown>;
}

/**
 * Page types that the SSR renderer emits BreadcrumbList JSON-LD for.
 * Derived from the SSR guard `additionalData?.pageType !== 'home'` —
 * i.e. EVERY non-home page type known to the renderer. Sourced from the
 * `getH1Text` switch in `seo-renderer.ts`. If a new pageType is added
 * upstream, the source-scan above keeps the BreadcrumbList guard intact,
 * and adding the type to this list extends visible-body coverage.
 */
const BREADCRUMB_CASES: BreadcrumbCase[] = [
  // about
  {
    label: 'about page (en)',
    pageType: 'about',
    cleanPath: '/about',
    language: 'en',
  },
  {
    label: 'about page (tr — translated nav label)',
    pageType: 'about',
    cleanPath: '/about',
    language: 'tr',
    translations: { nav_home: 'Ana Sayfa', nav_about: 'Hakkımızda' },
  },
  // contact
  {
    label: 'contact page (en)',
    pageType: 'contact',
    cleanPath: '/contact',
    language: 'en',
  },
  // genres listing + detail
  {
    label: 'genres listing (en)',
    pageType: 'genres',
    cleanPath: '/genres',
    language: 'en',
  },
  {
    label: 'genre detail /genres/pop (en)',
    pageType: 'genres',
    cleanPath: '/genres/pop',
    language: 'en',
    additionalData: { genreName: 'Pop' },
  },
  // regions listing + detail
  {
    label: 'regions listing (en)',
    pageType: 'regions',
    cleanPath: '/regions',
    language: 'en',
  },
  {
    label: 'region detail /regions/germany (en)',
    pageType: 'regions',
    cleanPath: '/regions/germany',
    language: 'en',
    additionalData: { regionName: 'Germany', country: 'Germany' },
  },
  // stations listing
  {
    label: 'stations listing (en)',
    pageType: 'stations',
    cleanPath: '/stations',
    language: 'en',
  },
  // station detail (en + tr with localized segment)
  {
    label: 'station detail (en)',
    pageType: 'station',
    cleanPath: '/station/example-station',
    language: 'en',
    stationData: {
      _id: 's1',
      name: 'Example Station',
      slug: 'example-station',
      country: 'Germany',
      tags: 'pop',
    },
  },
  {
    label: 'station detail (tr — localized station segment)',
    pageType: 'station',
    cleanPath: '/station/example-station',
    language: 'tr',
    translations: { nav_home: 'Ana Sayfa', nav_stations: 'İstasyonlar' },
    urlTranslations: new Map([
      ['tr:station', 'istasyon'],
      ['tr:stations', 'istasyon'],
    ]),
    stationData: {
      _id: 's1',
      name: 'Example Station',
      slug: 'example-station',
      country: 'Germany',
      tags: 'pop',
    },
  },
  // applications / mobile-apps
  {
    label: 'applications page (en)',
    pageType: 'applications',
    cleanPath: '/applications',
    language: 'en',
  },
  // legal
  {
    label: 'terms-and-conditions (en)',
    pageType: 'terms',
    cleanPath: '/terms-and-conditions',
    language: 'en',
  },
  {
    label: 'privacy-policy (en)',
    pageType: 'privacy',
    cleanPath: '/privacy-policy',
    language: 'en',
  },
  // search
  {
    label: 'search page (en)',
    pageType: 'search',
    cleanPath: '/search',
    language: 'en',
  },
  // faq
  {
    label: 'faq page (en)',
    pageType: 'faq',
    cleanPath: '/faq',
    language: 'en',
  },
];

for (const c of BREADCRUMB_CASES) {
  test(`BreadcrumbList: ${c.label} — every JSON-LD item appears as a visible <a> link in body`, () => {
    const renderer = new SeoRenderer();
    const language = c.language;
    const translations = c.translations ?? {};
    const urlTranslations = c.urlTranslations ?? new Map<string, string>();
    const additionalData = { pageType: c.pageType, ...(c.additionalData ?? {}) };
    const seoTags = {
      title: 't',
      description: 'd',
      canonical: `${DOMAIN}/${language}${c.cleanPath}`,
      domain: DOMAIN,
    };

    const head = renderer.generateHtmlHead(
      seoTags,
      language,
      translations,
      c.cleanPath,
      c.stationData,
      urlTranslations,
      additionalData,
    );
    const body = renderer.generateHtmlBody({
      pageType: c.pageType,
      language,
      translations,
      seoTags,
      stationData: c.stationData,
      additionalData,
      urlTranslations,
      cleanPath: c.cleanPath,
    });

    const breadcrumbs = extractSchemasOfType(head, 'BreadcrumbList');
    assert.equal(
      breadcrumbs.length,
      1,
      `${c.label}: expected exactly one BreadcrumbList JSON-LD block, found ${breadcrumbs.length}`,
    );
    const schema = breadcrumbs[0];
    assert.ok(
      Array.isArray(schema.itemListElement) && schema.itemListElement.length >= 2,
      `${c.label}: BreadcrumbList.itemListElement must be a non-empty array with at least Home + 1 crumb`,
    );

    // Visible breadcrumb nav must exist in the body.
    assert.ok(
      /<nav[^>]*class="breadcrumb"|<nav[^>]*aria-label="breadcrumb"/i.test(body),
      `${c.label}: body is missing a <nav class="breadcrumb"> trail — schema/visible-content mismatch`,
    );

    for (const entry of schema.itemListElement) {
      const name: string = entry?.name;
      const item: string = entry?.item;
      assert.equal(typeof name, 'string', `${c.label}: itemListElement entry missing string "name"`);
      assert.equal(typeof item, 'string', `${c.label}: itemListElement entry missing string "item"`);

      // The schema "item" is absolute (https://themegaradio.com/<lang>/...);
      // the body emits a path-only href. Strip the origin so we can match.
      assert.ok(
        item.startsWith(DOMAIN),
        `${c.label}: itemListElement.item "${item}" should be absolute under ${DOMAIN}`,
      );
      const path = item.slice(DOMAIN.length) || '/';

      const expectedHrefAttr = `href="${escapeHtml(path)}"`;
      assert.ok(
        body.includes(expectedHrefAttr),
        `${c.label}: BreadcrumbList item "${name}" → ${path} not rendered as visible <a ${expectedHrefAttr}> in body. ` +
          `Google flags this exact mismatch as deceptive markup — see Task #280.`,
      );
      // The visible link text must include the schema name verbatim
      // (escaped). We allow the surrounding markup to vary, but require
      // `>${name}<` to appear after the matching href to prove the same
      // <a> tag carries both the URL and the label.
      const escName = escapeHtml(name);
      const linkPattern = new RegExp(
        `<a[^>]*${expectedHrefAttr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^>]*>\\s*${escName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*</a>`,
      );
      assert.ok(
        linkPattern.test(body),
        `${c.label}: visible <a href="${path}">${name}</a> not found in body — name in JSON-LD doesn't match visible breadcrumb label.`,
      );
    }
  });
}

// ===========================================================================
// 2. ItemList: homepage popular-stations JSON-LD must match visible cards.
// ===========================================================================

const POPULAR_STATIONS = [
  {
    _id: 'id-rock-1',
    name: 'Classic Rock FM',
    slug: 'classic-rock-fm',
    country: 'United States',
    tags: 'rock,classic',
    favicon: 'https://example.com/rock.png',
    logoAssets: { webp256: 'https://example.com/rock-256.webp' },
  },
  {
    _id: 'id-jazz-1',
    name: 'Smooth Jazz Live',
    slug: 'smooth-jazz-live',
    country: 'France',
    tags: 'jazz',
    favicon: 'https://example.com/jazz.png',
    logoAssets: { webp256: 'https://example.com/jazz-256.webp' },
  },
  {
    _id: 'id-pop-1',
    name: 'Pop Hits Radio',
    slug: 'pop-hits-radio',
    country: 'United Kingdom',
    tags: 'pop',
    favicon: 'https://example.com/pop.png',
    logoAssets: { webp256: 'https://example.com/pop-256.webp' },
  },
];

interface ItemListCase {
  label: string;
  language: string;
  urlTranslations?: Map<string, string>;
  expectedStationSegment: string;
}

const ITEMLIST_CASES: ItemListCase[] = [
  {
    label: 'home (en) — popular stations ItemList',
    language: 'en',
    expectedStationSegment: 'station',
  },
  {
    label: 'home (tr) — popular stations ItemList with localized station segment',
    language: 'tr',
    urlTranslations: new Map([['tr:station', 'istasyon']]),
    expectedStationSegment: 'istasyon',
  },
];

for (const c of ITEMLIST_CASES) {
  test(`ItemList: ${c.label} — every ListItem name+url renders as a visible station card`, () => {
    const renderer = new SeoRenderer();
    const language = c.language;
    const urlTranslations = c.urlTranslations ?? new Map<string, string>();
    const additionalData = {
      pageType: 'home',
      popularStations: POPULAR_STATIONS,
    };
    const seoTags = {
      title: 't',
      description: 'd',
      canonical: `${DOMAIN}/${language}`,
      domain: DOMAIN,
    };

    const head = renderer.generateHtmlHead(
      seoTags,
      language,
      {},
      '/',
      undefined,
      urlTranslations,
      additionalData,
    );
    const body = renderer.generateHtmlBody({
      pageType: 'home',
      language,
      translations: {},
      seoTags,
      additionalData,
      urlTranslations,
      cleanPath: '/',
    });

    const itemLists = extractSchemasOfType(head, 'ItemList');
    assert.equal(
      itemLists.length,
      1,
      `${c.label}: expected exactly one ItemList JSON-LD block, found ${itemLists.length}`,
    );
    const schema = itemLists[0];
    assert.equal(
      schema.itemListElement.length,
      POPULAR_STATIONS.length,
      `${c.label}: ItemList has ${schema.itemListElement.length} entries, expected ${POPULAR_STATIONS.length}`,
    );
    assert.equal(
      schema.numberOfItems,
      POPULAR_STATIONS.length,
      `${c.label}: ItemList.numberOfItems out of sync with itemListElement length`,
    );

    for (const entry of schema.itemListElement) {
      const inner = entry?.item;
      assert.ok(inner && typeof inner === 'object', `${c.label}: ListItem missing inner item`);
      const name: string = inner.name;
      const url: string = inner.url;
      assert.equal(typeof name, 'string', `${c.label}: ListItem.item.name must be a string`);
      assert.equal(typeof url, 'string', `${c.label}: ListItem.item.url must be a string`);

      assert.ok(
        url.startsWith(DOMAIN),
        `${c.label}: ListItem.item.url "${url}" should be absolute under ${DOMAIN}`,
      );
      const path = url.slice(DOMAIN.length);
      assert.ok(
        path.startsWith(`/${language}/${c.expectedStationSegment}/`),
        `${c.label}: ListItem.item.url path "${path}" doesn't use the expected localized station segment "/${c.expectedStationSegment}/"`,
      );

      const escName = escapeHtml(name);
      assert.ok(
        body.includes(`<h3>${escName}</h3>`),
        `${c.label}: ItemList entry "${name}" not rendered as visible <h3>${escName}</h3> in body. ` +
          `Google flags this exact mismatch as deceptive markup — see Task #280.`,
      );
      assert.ok(
        body.includes(`href="${escapeHtml(path)}"`),
        `${c.label}: ItemList entry url "${path}" not rendered as visible <a href="${path}"> in body.`,
      );
    }
  });
}

// ===========================================================================
// 3. Negative control: pages without popular stations must NOT emit ItemList.
// ===========================================================================

test('home without popularStations must NOT emit ItemList JSON-LD', () => {
  const renderer = new SeoRenderer();
  const head = renderer.generateHtmlHead(
    {
      title: 't',
      description: 'd',
      canonical: `${DOMAIN}/en`,
      domain: DOMAIN,
    },
    'en',
    {},
    '/',
    undefined,
    new Map<string, string>(),
    { pageType: 'home' },
  );
  const itemLists = extractSchemasOfType(head, 'ItemList');
  assert.equal(
    itemLists.length,
    0,
    `home without popularStations emitted ${itemLists.length} ItemList block(s) — would be deceptive markup`,
  );
});

test('home page must NOT emit BreadcrumbList JSON-LD', () => {
  const renderer = new SeoRenderer();
  const head = renderer.generateHtmlHead(
    {
      title: 't',
      description: 'd',
      canonical: `${DOMAIN}/en`,
      domain: DOMAIN,
    },
    'en',
    {},
    '/',
    undefined,
    new Map<string, string>(),
    { pageType: 'home' },
  );
  const breadcrumbs = extractSchemasOfType(head, 'BreadcrumbList');
  assert.equal(
    breadcrumbs.length,
    0,
    `home page emitted ${breadcrumbs.length} BreadcrumbList block(s) — homepage has no crumbs to show`,
  );
});

// Paragraph formatting must never discard a station's final sentence or
// punctuation. Compare every escaped non-whitespace character, not a prefix.
for (const fixture of [
  { language: 'tr', full: 'İlk cümle. ' + 'Özgün Türkçe radyo açıklaması ve yayın bilgileri '.repeat(9) + 'son cümle noktasız' },
  { language: 'de', full: 'Der erste Satz. ' + 'Informationen zum Programm und zur Musik '.repeat(10) + 'das vollständige Ende bleibt erhalten' },
  { language: 'ja', full: 'MegaRadio FM. ' + '音楽と地域のニュースを放送しています。'.repeat(22) + '最後の説明も残ります' },
  { language: 'en', full: '...!? First sentence. ' + 'The original station description continues '.repeat(12) + 'unpunctuated ending' },
  { language: 'ar', full: 'وصف المحطة والموسيقى والأخبار المحلية '.repeat(14) },
  { language: 'tr', full: 'İlk cümle.\n' + 'Müzik & haber <program> "canlı" yayın '.repeat(12) + "<script>alert('text only')</script> son bölüm" },
  { language: 'en', full: 'A short description without trailing punctuation' },
]) {
  test(`station SSR preserves the entire description: ${fixture.language} / ${fixture.full.slice(0, 24)}`, () => {
    const renderer = new SeoRenderer();
    const station = { _id: 'lossless-body-fixture', name: 'Test Radio', slug: 'test-radio',
      country: 'Germany', tags: 'music', url: 'https://example.invalid/stream',
      descriptions: { [fixture.language]: { full: fixture.full, meta: 'Test station metadata' } } };
    const body = renderer.generateHtmlBody({ pageType: 'station', language: fixture.language,
      translations: {}, stationData: station, additionalData: { pageType: 'station' },
      urlTranslations: new Map<string, string>(), cleanPath: '/station/test-radio',
      seoTags: { title: station.name, description: 'Test station metadata', domain: DOMAIN,
        canonical: `${DOMAIN}/${fixture.language}/station/test-radio` } });
    const section = body.match(/<p class="station-intro">[\s\S]*?<\/p>([\s\S]*?)<!-- DALGA 4: Station-specific outro/);
    assert.ok(section, 'station description section must be present');
    const paragraphs = [...section[1].matchAll(/<p>([\s\S]*?)<\/p>/g)].map(match => match[1]);
    assert.ok(paragraphs.length > 0);
    assert.equal(paragraphs.join('').replace(/\s+/g, ''), escapeHtml(fixture.full.trim()).replace(/\s+/g, ''));
    assert.doesNotMatch(section[1], /<script>|<program>/, 'description text must remain HTML escaped');
  });
}
