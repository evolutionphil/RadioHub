/**
 * Task #208: automated guard that every FAQPage JSON-LD on the site
 * matches the visible Q&A in the rendered body.
 *
 * History: we shipped two deceptive-markup bugs in a row (Task #129 on
 * the homepage and Task #164 on the about page) where FAQPage JSON-LD
 * referenced questions that weren't actually rendered. Google flags this
 * as deceptive structured data and tanks rankings. This test:
 *
 *   1. Source-scans the SSR renderer (artifacts/api-server/src/seo-renderer.ts)
 *      and the client SeoHead (artifacts/megaradio/src/components/SeoHead.tsx)
 *      for every place that emits `"@type": "FAQPage"`. Every emission
 *      must be guarded by a `pageType === 'faq'` (or equivalent) check
 *      that we know about — a new branch that emits FAQPage on a
 *      different surface fails CI here.
 *
 *   2. Behaviourally exercises the SSR `SeoRenderer` for every
 *      whitelisted FAQ-emitting page type, parses the FAQPage JSON-LD
 *      out of the head, and asserts each `mainEntity.name` and
 *      `acceptedAnswer.text` appears verbatim in the rendered body as
 *      `<h2>{q}</h2>` and `<p>{a}</p>`. Runs in English plus a
 *      non-English language to catch translation drift.
 *
 * Runner: requires `--experimental-test-module-mocks`, which the
 * api-server `test` script already passes.
 */
import { test, mock, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Module mocks: the SeoRenderer module pulls in mongoose models and the
// in-memory perf cache at import time. We don't need the DB for the
// pure HTML-generation methods exercised here, so stub the few imports
// that would otherwise crash module load.
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

mock.module(new URL('../src/shared/mongo-schemas.ts', import.meta.url).href, {
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
let FAQ_PAGE_ITEMS: ReadonlyArray<{
  qKey: string;
  qFallback: string;
  aKey: string;
  aFallback: string;
}>;

before(async () => {
  const rendererMod = (await import('../src/seo-renderer.ts')) as {
    SeoRenderer: typeof SeoRenderer;
  };
  SeoRenderer = rendererMod.SeoRenderer;
  const faqMod = (await import('@workspace/seo-shared/faq-schema')) as {
    FAQ_PAGE_ITEMS: typeof FAQ_PAGE_ITEMS;
  };
  FAQ_PAGE_ITEMS = faqMod.FAQ_PAGE_ITEMS;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Mirrors SeoRenderer.escapeHtml — kept in sync intentionally. */
function escapeHtml(input: string): string {
  if (!input) return '';
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Extract every JSON-LD <script type="application/ld+json"> block from
 * the rendered head, JSON.parse each one, and return the FAQPage(s).
 */
function extractFaqPageSchemas(head: string): Array<{
  mainEntity: Array<{ name: string; acceptedAnswer: { text: string } }>;
}> {
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
      throw new Error(`Failed to JSON.parse a JSON-LD block: ${(err as Error).message}\n---\n${raw.slice(0, 200)}`);
    }
    const blocks = Array.isArray(parsed) ? parsed : [parsed];
    for (const b of blocks) {
      if (b && b['@type'] === 'FAQPage') out.push(b);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. Source-scan guard: catch new FAQPage emissions on unexpected surfaces.
// ---------------------------------------------------------------------------

interface FaqEmissionSurface {
  /** Absolute URL to the source file. */
  fileUrl: URL;
  /** Human label used in failure messages. */
  label: string;
  /**
   * Patterns that indicate a FAQPage JSON-LD emission. Either a literal
   * `"@type": "FAQPage"` (SSR case) or a call to `generateFAQSchema(`
   * (client case — the helper in lib/seo-shared/src/faq-schema.ts is the
   * sole FAQPage builder used by the React app).
   */
  emissionPatterns: ReadonlyArray<RegExp>;
  /**
   * The page-type guard literals we expect to find above the FAQPage
   * emission. If a new emission appears outside any guard in this list,
   * the test fails — that's a new surface that needs visible-content
   * coverage in section 2 below.
   */
  allowedGuards: ReadonlyArray<string>;
}

const FAQ_EMISSION_SURFACES: FaqEmissionSurface[] = [
  {
    fileUrl: new URL('../src/seo-renderer.ts', import.meta.url),
    label: 'api-server SSR (seo-renderer.ts)',
    emissionPatterns: [/["']@type["']\s*:\s*["']FAQPage["']/g],
    // SSR guards FAQ JSON-LD with `additionalData?.pageType === 'faq'`.
    allowedGuards: [`pageType === 'faq'`, `pageType === "faq"`],
  },
  {
    fileUrl: new URL(
      '../../megaradio/src/components/SeoHead.tsx',
      import.meta.url,
    ),
    label: 'megaradio client (SeoHead.tsx)',
    // Client doesn't write `"@type": "FAQPage"` literally — it calls the
    // shared `generateFAQSchema(...)` builder which emits the FAQPage
    // node. So the call site IS the emission point we must guard.
    emissionPatterns: [/\bgenerateFAQSchema\s*\(/g],
    // Client guards FAQ JSON-LD with `pageType === 'faq'`.
    allowedGuards: [`pageType === 'faq'`, `pageType === "faq"`],
  },
];

test('source-scan: every FAQPage JSON-LD emission lives behind a known pageType guard', () => {
  for (const surface of FAQ_EMISSION_SURFACES) {
    const src = readFileSync(fileURLToPath(surface.fileUrl), 'utf8');
    let emissionCount = 0;
    for (const pattern of surface.emissionPatterns) {
      // Reset the global regex's state between surfaces.
      pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(src)) !== null) {
        emissionCount += 1;
        // Look back ~1500 chars for the nearest pageType === 'faq' guard.
        // 1500 chars is enough to span a typical `if (...) { ... schema = {`
        // block including comments.
        const windowStart = Math.max(0, m.index - 1500);
        const ctx = src.slice(windowStart, m.index);
        const guarded = surface.allowedGuards.some((g) => ctx.includes(g));
        assert.ok(
          guarded,
          `${surface.label}: found a FAQPage JSON-LD emission at offset ${m.index} that isn't preceded by a known pageType guard ` +
            `(${surface.allowedGuards.join(' / ')}). New FAQ surfaces must add a pageType to FAQ_EMITTING_PAGE_TYPES below ` +
            `and verify the visible body renders matching <h2>/<p> Q&A — see Task #208.`,
        );
      }
    }
    assert.ok(
      emissionCount > 0,
      `${surface.label}: expected at least one FAQPage emission to scan; found 0. ` +
        `If the emission moved, update FAQ_EMISSION_SURFACES in this test.`,
    );
  }
});

// ---------------------------------------------------------------------------
// 2. Behavioural guard: every FAQ-emitting page type must render visible
//    <h2>/<p> for every Q/A in its FAQPage JSON-LD.
// ---------------------------------------------------------------------------

interface FaqEmittingPage {
  pageType: string;
  cleanPath: string;
  /**
   * Optional translation overrides used to verify non-English pages
   * also keep schema and visible body in lockstep.
   */
  translations?: Record<string, string>;
  language?: string;
}

const FAQ_EMITTING_PAGE_TYPES: FaqEmittingPage[] = [
  {
    pageType: 'faq',
    cleanPath: '/faq',
    language: 'en',
  },
  {
    pageType: 'faq',
    cleanPath: '/faq',
    language: 'tr',
    // A handful of Turkish overrides — enough to prove the renderer
    // funnels translated strings through to BOTH the body and the
    // JSON-LD via the same source list.
    translations: {
      faq_what_is_radio: 'Radyo nedir?',
      faq_what_is_radio_answer:
        'Radyo, ses içeriğini elektromanyetik dalgalar yoluyla ileten kablosuz bir teknolojidir.',
      faq_listen_on_phone: 'Telefonumda radyo dinleyebilir miyim?',
      faq_listen_on_phone_answer:
        'Evet! Mega Radio, herhangi bir akıllı telefonda çalışır — uygulama gerekmez.',
    },
  },
];

for (const surface of FAQ_EMITTING_PAGE_TYPES) {
  const label = `pageType="${surface.pageType}" lang=${surface.language ?? 'en'}`;

  test(`${label}: FAQPage JSON-LD matches visible <h2>/<p> Q&A in rendered body`, () => {
    const renderer = new SeoRenderer();
    const language = surface.language ?? 'en';
    const translations = surface.translations ?? {};
    const seoTags = {
      title: 'FAQ — Mega Radio',
      description: 'FAQ',
      canonical: `https://themegaradio.com/${language}/faq`,
      domain: `https://themegaradio.com`,
    };
    const additionalData = { pageType: surface.pageType };

    const body = renderer.generateHtmlBody({
      pageType: surface.pageType,
      language,
      translations,
      seoTags,
      additionalData,
    });
    const head = renderer.generateHtmlHead(
      seoTags,
      language,
      translations,
      surface.cleanPath,
      undefined,
      new Map<string, string>(),
      additionalData,
    );

    const faqSchemas = extractFaqPageSchemas(head);
    assert.equal(
      faqSchemas.length,
      1,
      `${label}: expected exactly one FAQPage JSON-LD block in <head>, found ${faqSchemas.length}`,
    );
    const schema = faqSchemas[0];
    assert.ok(
      Array.isArray(schema.mainEntity) && schema.mainEntity.length > 0,
      `${label}: FAQPage.mainEntity must be a non-empty array`,
    );

    // Must equal FAQ_PAGE_ITEMS in count — guards against a slimmed-
    // down JSON-LD that wouldn't trip the per-item check below.
    assert.equal(
      schema.mainEntity.length,
      FAQ_PAGE_ITEMS.length,
      `${label}: FAQPage.mainEntity has ${schema.mainEntity.length} entries but FAQ_PAGE_ITEMS has ${FAQ_PAGE_ITEMS.length}; ` +
        `JSON-LD and the shared source list must stay 1:1.`,
    );

    for (const entity of schema.mainEntity) {
      const q = entity?.name;
      const a = entity?.acceptedAnswer?.text;
      assert.equal(typeof q, 'string', `${label}: mainEntity entry missing string "name"`);
      assert.equal(typeof a, 'string', `${label}: mainEntity entry missing string "acceptedAnswer.text"`);

      const escapedQ = escapeHtml(q);
      const escapedA = escapeHtml(a);

      assert.ok(
        body.includes(`<h2>${escapedQ}</h2>`),
        `${label}: question "${q}" appears in FAQPage JSON-LD but not as a visible <h2>${escapedQ}</h2> in the body. ` +
          `Google flags this exact mismatch as deceptive markup — see Task #129/#164/#208.`,
      );
      assert.ok(
        body.includes(`<p>${escapedA}</p>`),
        `${label}: answer for "${q}" appears in FAQPage JSON-LD but not as a visible <p>${escapedA}</p> in the body. ` +
          `Google flags this exact mismatch as deceptive markup — see Task #129/#164/#208.`,
      );
    }

    // If a translation override was provided, prove it actually flowed
    // through to BOTH surfaces (not just the body fallback). This
    // prevents the renderer from silently falling back to the English
    // qFallback in the JSON-LD while the body shows the translation
    // (or vice-versa).
    if (surface.translations) {
      for (const [key, value] of Object.entries(surface.translations)) {
        const isQuestion = key.endsWith('_answer') === false;
        const tag = isQuestion ? 'h2' : 'p';
        assert.ok(
          body.includes(`<${tag}>${escapeHtml(value)}</${tag}>`),
          `${label}: translation for "${key}" not rendered as <${tag}> in body — translation pipeline drifted.`,
        );
        const inSchema = schema.mainEntity.some(
          (e) => e.name === value || e.acceptedAnswer?.text === value,
        );
        assert.ok(
          inSchema,
          `${label}: translation for "${key}" not present in FAQPage JSON-LD — translation pipeline drifted.`,
        );
      }
    }
  });
}

// ---------------------------------------------------------------------------
// 3. Negative control: a non-FAQ page type must NOT emit FAQPage JSON-LD.
//    Catches regressions like Task #129 (FAQPage on home) and Task #164
//    (FAQPage on /about) where the schema leaked onto pages with no Q&A.
// ---------------------------------------------------------------------------

const NON_FAQ_PAGE_TYPES = ['home', 'about', 'contact', 'genres', 'regions', 'stations', 'search'];

for (const pageType of NON_FAQ_PAGE_TYPES) {
  test(`pageType="${pageType}" must NOT emit FAQPage JSON-LD (regression guard for Tasks #129/#164)`, () => {
    const renderer = new SeoRenderer();
    const head = renderer.generateHtmlHead(
      {
        title: 't',
        description: 'd',
        canonical: 'https://themegaradio.com/en',
        domain: 'https://themegaradio.com',
      },
      'en',
      {},
      pageType === 'home' ? '/' : `/${pageType}`,
      undefined,
      new Map<string, string>(),
      { pageType },
    );
    const faqSchemas = extractFaqPageSchemas(head);
    assert.equal(
      faqSchemas.length,
      0,
      `pageType="${pageType}" emitted ${faqSchemas.length} FAQPage JSON-LD block(s) — this surface has no visible Q&A ` +
        `and Google flags the mismatch as deceptive markup. If you intentionally added FAQ Q&A here, also add the ` +
        `pageType to FAQ_EMITTING_PAGE_TYPES in this test.`,
    );
  });
}
