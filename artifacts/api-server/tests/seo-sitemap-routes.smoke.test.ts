/**
 * Smoke regression suite for the sitemap & robots endpoints (Task #153).
 *
 * Why: api-server has no per-request integration tests, so regressions in
 * /sitemap.xml, /sitemap-index.xml, /sitemap-main-{lang}.xml, /llms.txt
 * and /robots.txt only surface in production via Google Search Console
 * errors. This suite boots the real Express handlers with the
 * MongoDB-backed dependencies stubbed via `node:test` module mocks, then
 * makes real HTTP requests against an ephemeral server.
 *
 * Deviation from task spec: the spec asked for /sitemap.xml -> 301 to
 * /sitemap-index.xml, but Task #128 intentionally changed this — Google
 * Search Console rejected the redirect on its strict "must be a sitemap
 * document" check, so /sitemap.xml now serves the sitemap-index XML
 * directly with a 200. Tests assert the current contract.
 *
 * Runner: requires `--experimental-test-module-mocks` (wired up in
 * artifacts/api-server/package.json#scripts.test).
 */
import { test, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import type { AddressInfo, Server } from 'node:net';
import type { Server as HttpServer } from 'node:http';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

/**
 * Task #194: assert XML well-formedness in addition to regex smoke
 * checks. Without a real parser pass, malformed entities or unclosed
 * tags would still match the regex assertions and slip through.
 */
function assertValidXml(body: string, label: string): unknown {
  const validation = XMLValidator.validate(body, { allowBooleanAttributes: false });
  assert.equal(
    validation,
    true,
    `${label} must be well-formed XML; parser said: ${
      typeof validation === 'object' ? JSON.stringify(validation) : String(validation)
    }`,
  );
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (name) => name === 'url' || name === 'sitemap' || name === 'xhtml:link',
  });
  return parser.parse(body);
}

// ---------------------------------------------------------------------------
// Module mocks — must be installed BEFORE the routes module is imported so
// the mocked exports replace the real DB-backed ones at module-load time.
// Specifiers are absolute file URLs so every internal relative-path import
// of the same module resolves to the same mock.
// ---------------------------------------------------------------------------

interface FakeManifestChunk {
  chunk: number;
  urlCount: number;
  maxUpdatedAt: Date;
  stationIds?: string[];
}
interface FakeManifest {
  type: 'main' | 'genres' | 'stations';
  language: string;
  version: string;
  qualifiedLanguagesHash: string;
  chunks: FakeManifestChunk[];
  totalUrls: number;
  chunkCount: number;
  generatedAt: Date;
  maxUpdatedAt?: Date;
}

const TEST_HASH = 'testhash00000000';
const QUALIFIED_LANGS = ['en', 'de', 'fr', 'es', 'it', 'tr'] as const;
const NOW = new Date('2026-01-01T00:00:00Z');

const FAKE_QUALIFIED_STATE = {
  languages: [...QUALIFIED_LANGS] as string[],
  hash: TEST_HASH,
  source: 'computed' as const,
  computedAt: NOW,
  expiresAt: new Date(NOW.getTime() + 60_000),
};

class FakeQualifiedLanguagesUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QualifiedLanguagesUnavailableError';
  }
}

mock.module(new URL('../src/seo/qualified-languages.ts', import.meta.url).href, {
  namedExports: {
    getQualifiedLanguagesState: async () => FAKE_QUALIFIED_STATE,
    getCachedQualifiedLanguages: async () => [...QUALIFIED_LANGS],
    getCachedQualifiedLanguagesSync: () => [...QUALIFIED_LANGS],
    QualifiedLanguagesUnavailableError: FakeQualifiedLanguagesUnavailableError,
    invalidateQualifiedLanguages: () => {},
    initializeQualifiedLanguages: async () => FAKE_QUALIFIED_STATE,
    EMERGENCY_SEED_QUALIFIED_LANGUAGES: [...QUALIFIED_LANGS],
  },
});

function buildFakeManifest(
  type: 'main' | 'genres' | 'stations',
  language: string,
): FakeManifest {
  const chunks: FakeManifestChunk[] = type === 'stations'
    ? [{ chunk: 0, urlCount: 50, maxUpdatedAt: NOW, stationIds: ['s1', 's2'] }]
    : [{ chunk: 0, urlCount: 1, maxUpdatedAt: NOW }];
  return {
    type,
    language,
    version: 'v1-test',
    qualifiedLanguagesHash: TEST_HASH,
    chunks,
    totalUrls: chunks.reduce((acc, c) => acc + c.urlCount, 0),
    chunkCount: chunks.length,
    generatedAt: NOW,
    maxUpdatedAt: NOW,
  };
}

mock.module(new URL('../src/seo/sitemap-manifest-builder.ts', import.meta.url).href, {
  namedExports: {
    buildAllSitemapManifests: async () => ({}),
    getActiveManifest: async (
      type: 'main' | 'genres' | 'stations',
      language: string,
    ) => buildFakeManifest(type, language),
    getActiveStationChunk: async () => ({
      stationIds: ['s1', 's2'],
      maxUpdatedAt: NOW,
      qualifiedLanguagesHash: TEST_HASH,
      version: 'v1-test',
    }),
    startManifestRefreshLoop: () => {},
    encodeTopCountryEntry: (regionSlug: string, countrySlug: string) =>
      `__topcountry__:${regionSlug}/${countrySlug}`,
    extractTopCountriesFromChunk: (
      _ids: ReadonlyArray<string | { toString(): string }>,
    ): Array<{ regionSlug: string; countrySlug: string }> => [],
    RESERVED_GENRE_SLUGS: new Set<string>(),
  },
});

// SitemapManifest mongoose-model stub — used by /sitemap-index.xml via
// `await import('@workspace/db-shared/mongo-schemas')`. The real handler does:
//   SitemapManifest.find(...).select(...).lean()
// so the chain returns a thenable / awaitable that resolves to fake docs.
const FAKE_INDEX_MANIFESTS: FakeManifest[] = QUALIFIED_LANGS.flatMap((lang) => [
  buildFakeManifest('main', lang),
  buildFakeManifest('genres', lang),
  buildFakeManifest('stations', lang),
]);

interface FakeQuery<T> extends PromiseLike<T> {
  select: (..._args: unknown[]) => FakeQuery<T>;
  sort: (..._args: unknown[]) => FakeQuery<T>;
  lean: () => Promise<T>;
}
function fakeQuery<T>(value: T): FakeQuery<T> {
  const q: FakeQuery<T> = {
    select: () => q,
    sort: () => q,
    lean: async () => value,
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject),
  };
  return q;
}

const FAKE_SITEMAP_MANIFEST_MODEL = {
  find: () => fakeQuery(FAKE_INDEX_MANIFESTS),
  findOne: () => fakeQuery(null),
};

const EMPTY_AGGREGATE = {
  allowDiskUse: () => Promise.resolve([]),
  exec: async () => [],
  then: <T>(resolve: (v: unknown[]) => T) => Promise.resolve([]).then(resolve),
};

const FAKE_STATION_MODEL = {
  find: () => fakeQuery([]),
  aggregate: () => EMPTY_AGGREGATE,
  countDocuments: async () => 0,
};

// Generic empty-collection stub for every other Mongoose model the
// transitive import graph might pull in.
const NULL_MODEL = {
  find: () => fakeQuery([]),
  findOne: () => fakeQuery(null),
  findById: () => fakeQuery(null),
  create: async () => ({}),
  updateOne: async () => ({ matchedCount: 0 }),
  updateMany: async () => ({ matchedCount: 0 }),
  deleteOne: async () => ({ deletedCount: 0 }),
  deleteMany: async () => ({ deletedCount: 0 }),
  countDocuments: async () => 0,
  aggregate: () => EMPTY_AGGREGATE,
  insertMany: async () => [],
  distinct: async () => [],
};

const ALL_MONGO_MODEL_NAMES = [
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
for (const name of ALL_MONGO_MODEL_NAMES) {
  mongoMockExports[name] = NULL_MODEL;
}
// Routes / handlers under test depend on these specific behaviours.
mongoMockExports.SitemapManifest = FAKE_SITEMAP_MANIFEST_MODEL;
mongoMockExports.Station = FAKE_STATION_MODEL;
// Constants & types re-exported as runtime values must also be present.
mongoMockExports.SAFE_GENRE_SLUG_RE = /^[a-z0-9-]+$/;

mock.module('@workspace/db-shared/mongo-schemas', {
  namedExports: mongoMockExports,
});

mock.module(new URL('../src/performance-cache.ts', import.meta.url).href, {
  namedExports: {
    performanceCache: {
      getUrlTranslations: async () => new Map<string, string>(),
      getStats: () => ({ hits: 0, misses: 0 }),
    },
    PerformanceCache: class {},
    deepFreeze: <T,>(v: T) => v,
  },
});

const fakeCacheStore = new Map<string, unknown>();
const FAKE_CACHE_MANAGER = {
  get: async (k: string) => fakeCacheStore.get(k) ?? null,
  set: async (k: string, v: unknown) => {
    fakeCacheStore.set(k, v);
  },
  del: async () => {},
  delPattern: async () => {},
};

mock.module(new URL('../src/cache.ts', import.meta.url).href, {
  defaultExport: FAKE_CACHE_MANAGER,
  namedExports: {
    CacheManager: FAKE_CACHE_MANAGER,
    CacheKeys: {},
    invalidateSocialCacheForUser: async () => {},
  },
});

// ---------------------------------------------------------------------------
// Boot Express app with mocked deps + dynamic-import the routes module so
// it picks up the mocks installed above.
// ---------------------------------------------------------------------------

interface SeoSitemapDeps {
  requireAdmin: (req: Request, res: Response, next: NextFunction) => void;
}
type RegisterFn = (
  app: Express,
  deps: SeoSitemapDeps,
  options?: { apiOnly?: boolean },
) => Promise<void>;

let server: HttpServer;
let baseUrl: string;
let app: Express;
let spaCalls: number;

before(async () => {
  // Force `getBaseUrl` to use the request host (not the production override).
  process.env.NODE_ENV = 'test';

  const mod = (await import('../src/routes/seo-sitemap-routes.ts')) as {
    registerSeoSitemapRoutes: RegisterFn;
  };

  app = express();
  await mod.registerSeoSitemapRoutes(app, {
    requireAdmin: (_req, res) => {
      res.status(403).end();
    },
  });

  // SPA tracer catch-all — mirrors the index-web.ts ordering. Any request
  // that falls through to here would be served the React HTML shell to
  // Googlebot in production, which is the regression we are guarding.
  spaCalls = 0;
  app.use((_req: Request, res: Response) => {
    spaCalls += 1;
    res.setHeader('X-Spa-Catchall', '1');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send('<html><body>spa shell</body></html>');
  });

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  // Guard: if `before` failed (e.g. a missing mock export crashed the
  // dynamic import), `server` will be undefined. Don't shadow the real
  // setup error with a "Cannot read properties of undefined" from close().
  if (!server) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function countLocs(xml: string): number {
  return (xml.match(/<loc>/g) || []).length;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('/llms.txt returns text/plain 200 advertising the sitemap-index', async () => {
  const callsBefore = spaCalls;
  const res = await fetch(`${baseUrl}/llms.txt`);
  assert.equal(res.status, 200, '/llms.txt must be 200');
  assert.match(
    res.headers.get('content-type') || '',
    /^text\/plain/,
    '/llms.txt must be served as text/plain (Task #128 contract)',
  );
  assert.equal(res.headers.get('x-spa-catchall'), null);
  assert.equal(spaCalls, callsBefore, '/llms.txt must NOT fall through to the SPA catch-all');
  const body = await res.text();
  assert.match(body, /\/sitemap-index\.xml/);
  assert.match(body, /\/robots\.txt/);
});

test('/robots.txt returns text/plain 200 with Sitemap directive', async () => {
  const callsBefore = spaCalls;
  const res = await fetch(`${baseUrl}/robots.txt`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /^text\/plain/);
  assert.equal(res.headers.get('x-spa-catchall'), null);
  assert.equal(spaCalls, callsBefore, '/robots.txt must NOT fall through to the SPA catch-all');
  const body = await res.text();
  assert.match(
    body,
    /Sitemap: https?:\/\/[^\s]+\/sitemap-index\.xml/,
    'robots.txt must end with the Sitemap: directive pointing to sitemap-index.xml',
  );
  assert.match(body, /User-agent: \*/);
});

test('/sitemap.xml returns the sitemap-index XML directly (Task #128 contract)', async () => {
  const callsBefore = spaCalls;
  const res = await fetch(`${baseUrl}/sitemap.xml`);
  assert.equal(spaCalls, callsBefore, '/sitemap.xml must NOT fall through to the SPA catch-all');
  assert.equal(res.status, 200, '/sitemap.xml must serve the sitemap-index document directly');
  assert.match(res.headers.get('content-type') || '', /^application\/xml/);
  const body = await res.text();
  // Task #194: parser-validated XML (catches unclosed tags / bad entities
  // that regex-only assertions would miss).
  const parsed = assertValidXml(body, '/sitemap.xml') as {
    sitemapindex?: { '@_xmlns'?: string; sitemap?: Array<{ loc?: string }> };
  };
  assert.ok(parsed.sitemapindex, '/sitemap.xml root must be <sitemapindex>');
  assert.equal(
    parsed.sitemapindex['@_xmlns'],
    'http://www.sitemaps.org/schemas/sitemap/0.9',
    '/sitemap.xml must declare the sitemaps.org 0.9 namespace',
  );
  assert.match(body, /\/sitemap-main-en\.xml/);
});

test('/sitemap-index.xml returns application/xml 200 with one entry per qualified lang', async () => {
  const callsBefore = spaCalls;
  const res = await fetch(`${baseUrl}/sitemap-index.xml`);
  assert.equal(spaCalls, callsBefore);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /^application\/xml/);
  const body = await res.text();
  // Task #194: parse the response and assert structurally rather than
  // by regex. Each qualified language must contribute exactly a main +
  // genres + stations entry (6 langs × 3 types = 18 child sitemaps).
  const parsed = assertValidXml(body, '/sitemap-index.xml') as {
    sitemapindex?: { sitemap?: Array<{ loc?: string; lastmod?: string }> };
  };
  assert.ok(parsed.sitemapindex, 'root must be <sitemapindex>');
  const entries = parsed.sitemapindex.sitemap ?? [];
  assert.ok(
    entries.length >= QUALIFIED_LANGS.length * 3,
    `expected >=${QUALIFIED_LANGS.length * 3} child sitemap entries, found ${entries.length}`,
  );
  const locs = new Set(entries.map((e) => e.loc ?? ''));
  for (const lang of QUALIFIED_LANGS) {
    const hasMain = [...locs].some((l) => l.endsWith(`/sitemap-main-${lang}.xml`));
    const hasGenres = [...locs].some((l) => l.endsWith(`/sitemap-genres-${lang}.xml`));
    const hasStations = [...locs].some((l) => l.endsWith(`/sitemap-stations-${lang}-0.xml`));
    assert.ok(hasMain, `index must contain /sitemap-main-${lang}.xml`);
    assert.ok(hasGenres, `index must contain /sitemap-genres-${lang}.xml`);
    assert.ok(hasStations, `index must contain /sitemap-stations-${lang}-0.xml`);
  }
});

test('/sitemap-main-en.xml returns application/xml 200 with >15 <loc> entries', async () => {
  const callsBefore = spaCalls;
  const res = await fetch(`${baseUrl}/sitemap-main-en.xml`);
  assert.equal(
    spaCalls,
    callsBefore,
    '/sitemap-main-:lang.xml param route must NOT fall through to the SPA catch-all',
  );
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /^application\/xml/);
  const body = await res.text();
  // Task #194: parser-validated XML structure.
  const parsed = assertValidXml(body, '/sitemap-main-en.xml') as {
    urlset?: {
      '@_xmlns'?: string;
      '@_xmlns:xhtml'?: string;
      url?: Array<{ loc?: string; 'xhtml:link'?: Array<{ '@_hreflang'?: string }> }>;
    };
  };
  assert.ok(parsed.urlset, 'root must be <urlset>');
  assert.equal(
    parsed.urlset['@_xmlns'],
    'http://www.sitemaps.org/schemas/sitemap/0.9',
    'urlset must declare the sitemaps.org 0.9 namespace',
  );
  const urls = parsed.urlset.url ?? [];
  assert.ok(
    urls.length > 15,
    `expected >15 <url> entries in /sitemap-main-en.xml, found ${urls.length}`,
  );
  // Cross-check the regex count to catch parser-quirk regressions.
  assert.equal(countLocs(body), urls.length, '<loc> count must equal parsed <url> count');
  // Smoke: a few canonical pages must be present.
  const locs = urls.map((u) => u.loc ?? '');
  assert.ok(locs.some((l) => /\/en$/.test(l) || /\/en\/?$/.test(l)), 'must include /en home');
  assert.ok(locs.some((l) => l.includes('/en/stations')), 'must include /en/stations');
  assert.ok(locs.some((l) => l.includes('/en/genres')), 'must include /en/genres');
});

test('/sitemap-main-en.xml emits hreflang alternates for every qualified language', async () => {
  const res = await fetch(`${baseUrl}/sitemap-main-en.xml`);
  const body = await res.text();
  // Task #194: parse and assert that EVERY <url> emits an alternate
  // for EVERY qualified language plus x-default — not just that the
  // hreflang token appears somewhere in the doc.
  const parsed = assertValidXml(body, '/sitemap-main-en.xml hreflang') as {
    urlset?: {
      url?: Array<{
        loc?: string;
        'xhtml:link'?: Array<{ '@_hreflang'?: string; '@_href'?: string }>;
      }>;
    };
  };
  const urls = parsed.urlset?.url ?? [];
  assert.ok(urls.length > 0, 'expected at least one <url> entry');
  for (const url of urls) {
    const langs = new Set(
      (url['xhtml:link'] ?? [])
        .map((link) => link['@_hreflang'])
        .filter((v): v is string => typeof v === 'string'),
    );
    for (const lang of QUALIFIED_LANGS) {
      assert.ok(
        langs.has(lang),
        `<url loc="${url.loc}"> missing hreflang="${lang}" alternate`,
      );
    }
    assert.ok(
      langs.has('x-default'),
      `<url loc="${url.loc}"> missing hreflang="x-default" alternate`,
    );
  }
});

test('SPA catch-all does NOT shadow any of the sitemap/robots routes', async () => {
  const callsBefore = spaCalls;
  const targets = [
    '/llms.txt',
    '/robots.txt',
    '/sitemap.xml',
    '/sitemap-index.xml',
    '/sitemap-main-en.xml',
  ];
  for (const target of targets) {
    const res = await fetch(`${baseUrl}${target}`);
    assert.equal(
      res.headers.get('x-spa-catchall'),
      null,
      `${target} must not be served by the SPA catch-all`,
    );
    assert.doesNotMatch(
      res.headers.get('content-type') || '',
      /text\/html/,
      `${target} must not return text/html (would serve React shell to crawlers)`,
    );
  }
  assert.equal(
    spaCalls,
    callsBefore,
    'none of the sitemap/robots routes may invoke the SPA catch-all',
  );
});

test('A clearly-unmatched path DOES fall through to the SPA catch-all (negative control)', async () => {
  // Sanity check that the SPA tracer is actually wired and would catch a
  // regression — without this, an always-true assertion above would lie.
  const callsBefore = spaCalls;
  const res = await fetch(`${baseUrl}/__definitely-not-a-real-route__`);
  assert.equal(res.headers.get('x-spa-catchall'), '1');
  assert.equal(spaCalls, callsBefore + 1);
});
