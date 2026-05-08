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
  {
    fileUrl: new URL(
      '../../megaradio/src/components/SeoHead.tsx',
      import.meta.url,
    ),
    label: 'megaradio client (SeoHead.tsx)',
    // Client doesn't write the `"@type": "BreadcrumbList"` literal — it
    // calls the shared `generateBreadcrumbSchema(...)` builder. So the call
    // site IS the emission point we must guard.
    emissionPatterns: [/\bgenerateBreadcrumbSchema\s*\(/g],
    // Client only emits BreadcrumbList for station detail pages today.
    allowedGuards: [
      `pageType === 'station'`,
      `pageType === "station"`,
    ],
  },
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
