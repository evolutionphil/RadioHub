import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import { ACTIVE_SITEMAP_LANGUAGES } from '@workspace/seo-shared/seo-config';
import { URL_TRANSLATIONS } from '@workspace/seo-shared/url-translations';

const pageCache = new Map<string, any>();
const fixtures = new Map<string, any>();
let reads: string[] = [];
let idResult: any = null;
const base = {
  _id: 'source-id', name: 'Original Radio', slug: 'duplicate-fm', noIndex: true,
  url: 'https://stream.example.invalid/live', country: 'Germany', tags: 'rock',
  lastCheckOk: true, redirectToSlug: 'canonical-fm',
};
const destination = {
  ...base, _id: 'target-id', slug: 'canonical-fm', noIndex: false, redirectToSlug: null,
  descriptions: Object.fromEntries(ACTIVE_SITEMAP_LANGUAGES.map(lang => [lang,
    { full: `Station information for ${lang}`, meta: `Station summary for ${lang}` }])),
};

mock.module('../src/performance-cache', { namedExports: { performanceCache: {
  getPageData: (key: string) => pageCache.get(key),
  setPageData: (key: string, value: any) => pageCache.set(key, value),
  getTranslations: () => ({}),
  getUrlTranslations: async () => new Map<string, string>(),
} } });
mock.module('../src/data/postgres-seo-read-store', { namedExports: { pgSeoCatalog: () => ({
  findOne: async (query: any) => {
    const key = query.slug ? `slug:${query.slug}` : `alias:${query.slugAliases}`;
    reads.push(key);
    const value = fixtures.get(key);
    return typeof value === 'function' ? value() : value ?? null;
  },
  findById: async (id: string) => { reads.push(`id:${id}`); return idResult; },
  findMergedAlias: async () => null,
  find: async () => [], count: async () => 0, groupCount: async () => [],
}) } });
mock.module('../src/data/postgres-content-store', { namedExports: { pgSeoMetadata: async () => null } });
mock.module('../src/services/precomputed-genres', { namedExports: { PrecomputedGenresService: {} } });
mock.module('../src/seo/qualified-languages', { namedExports: {
  getCachedQualifiedLanguages: async () => [...ACTIVE_SITEMAP_LANGUAGES],
} });
const { SeoRenderer } = await import('../src/seo-renderer');
const renderer = new SeoRenderer();
const sourceUrl = '/en/station/duplicate-fm';

beforeEach(() => {
  pageCache.clear(); fixtures.clear(); reads = []; idResult = null;
  fixtures.set('slug:duplicate-fm', { ...base });
  fixtures.set('slug:canonical-fm', { ...destination });
});

for (const language of ACTIVE_SITEMAP_LANGUAGES) {
  test(`${language}: an exact duplicate redirects once to a verified final localized destination`, async () => {
    const detail = URL_TRANSLATIONS[language]?.station || 'station';
    const input = `/${language}/${detail}/${base.slug}`;
    const result = await renderer.renderStaticPage(input, 'https://themegaradio.com');
    assert.equal(decodeURI(result.pageData.redirectTo), `/${language}/${detail}/${destination.slug}`);
    assert.equal(result.pageData.stationIsJunk, undefined);
    assert.deepEqual(reads, ['slug:duplicate-fm', 'slug:canonical-fm']);
    const final = await renderer.renderStaticPage(result.pageData.redirectTo, 'https://themegaradio.com');
    assert.equal(final.pageData.station?._id, destination._id);
    assert.equal(final.pageData.redirectTo, undefined);
    assert.equal(final.pageData.notFound, false);
    assert.equal(final.pageData.stationIsJunk, false);
    assert.notEqual(final.seoTags.noIndex, true);
  });
}

for (const [reason, targetSlug, patch] of [
  ['missing destination', 'canonical-fm', null],
  ['excluded destination', 'canonical-fm', { noIndex: true }],
  ['legacy offline exclusion', 'canonical-fm', { noIndex: true, lastCheckOk: false }],
  ['unset indexability', 'canonical-fm', { noIndex: undefined }],
  ['null indexability', 'canonical-fm', { noIndex: null }],
  ['missing stream', 'canonical-fm', { url: '' }],
  ['codec duplicate', 'canonical-fm-aac', {}],
  ['test feed', 'canonical-test-stream', {}],
  ['numeric slug', '12345', {}],
  ['negative numeric slug', '-12345', {}],
  ['mismatched exact identity', 'canonical-fm', { slug: 'unrelated-fm' }],
  ['cycle back to source', 'canonical-fm', { redirectToSlug: 'duplicate-fm' }],
  ['destination self-cycle', 'canonical-fm', { redirectToSlug: 'canonical-fm' }],
  ['incoming redirect chain', 'canonical-fm', { redirectToSlug: 'third-fm' }],
] as const) {
  test(`direct redirect rejects ${reason} instead of promoting an invalid target`, async () => {
    fixtures.set('slug:duplicate-fm', { ...base, redirectToSlug: targetSlug });
    fixtures.delete('slug:canonical-fm');
    if (patch) fixtures.set(`slug:${targetSlug}`, { ...destination, slug: targetSlug, ...patch });
    const result = await renderer.renderStaticPage(sourceUrl, 'https://themegaradio.com');
    assert.equal(result.pageData.redirectTo, undefined);
    assert.equal(result.pageData.stationIsJunk, true);
    assert.equal(result.pageData.notFound, undefined, 'use the existing gone response, not missing-station handling');
    assert.equal(result.pageData.stationDbError, undefined);
    assert.equal(result.seoTags.noIndex, true);
    assert.deepEqual(reads, ['slug:duplicate-fm', `slug:${targetSlug}`], 'never chase chains or discover replacement targets');
    assert.equal(pageCache.size, 0);
  });
}

test('a self-redirect cannot fall through into another redirect to the same URL', async () => {
  fixtures.set('slug:duplicate-fm', { ...base, noIndex: false, redirectToSlug: base.slug });
  const result = await renderer.renderStaticPage(sourceUrl, 'https://themegaradio.com');
  assert.equal(result.pageData.redirectTo, undefined);
  assert.equal(result.pageData.stationIsJunk, true);
  assert.equal(result.seoTags.noIndex, true);
  assert.equal(pageCache.size, 0);
});

test('an ID-resolved source cannot redirect back to the incoming identifier', async () => {
  const id = '0123456789abcdef01234567';
  idResult = { ...base, _id: id, redirectToSlug: id };
  const result = await renderer.renderStaticPage(`/en/station/${id}`, 'https://themegaradio.com');
  assert.equal(result.pageData.redirectTo, undefined);
  assert.equal(result.pageData.stationIsJunk, true);
  assert.equal(result.seoTags.noIndex, true);
  assert.deepEqual(reads, [`slug:${id}`, `alias:${id}`, `id:${id}`]);
});

for (const value of [true, {}, 123]) {
  test(`a malformed ${typeof value} redirect value is rejected without a database query`, async () => {
    fixtures.set('slug:duplicate-fm', { ...base, redirectToSlug: value });
    const result = await renderer.renderStaticPage(sourceUrl, 'https://themegaradio.com');
    assert.equal(result.pageData.redirectTo, undefined);
    assert.equal(result.pageData.stationIsJunk, true);
    assert.equal(result.pageData.stationDbError, undefined);
    assert.deepEqual(reads, ['slug:duplicate-fm']);
  });
}

for (const slug of ['station', 'sta']) {
  test(`source slug ${slug} never replaces the station route prefix`, async () => {
    fixtures.set(`slug:${slug}`, { ...base, slug });
    const result = await renderer.renderStaticPage(`/de/sender/${slug}`, 'https://themegaradio.com');
    assert.equal(result.pageData.redirectTo, '/de/sender/canonical-fm');
  });
}

test('a retained offline destination remains valid when it is explicitly indexable', async () => {
  fixtures.set('slug:canonical-fm', { ...destination, lastCheckOk: false });
  const result = await renderer.renderStaticPage(sourceUrl, 'https://themegaradio.com');
  assert.equal(result.pageData.redirectTo, '/en/station/canonical-fm');
  assert.deepEqual(reads, ['slug:duplicate-fm', 'slug:canonical-fm']);
});

test('a target database outage is uncached and retryable, then recovers to a validated redirect', async () => {
  fixtures.set('slug:canonical-fm', () => { throw new Error('temporary target read outage'); });
  const failed = await renderer.renderStaticPage(sourceUrl, 'https://themegaradio.com');
  assert.equal(failed.pageData.stationDbError, true, 'HTTP adapter turns this into 503/no-store/Retry-After');
  assert.equal(failed.pageData.stationIsJunk, false);
  assert.equal(failed.pageData.notFound, false);
  assert.equal(failed.pageData.redirectTo, undefined);
  assert.equal(pageCache.size, 0);
  fixtures.set('slug:canonical-fm', { ...destination });
  const recovered = await renderer.renderStaticPage(sourceUrl, 'https://themegaradio.com');
  assert.equal(recovered.pageData.redirectTo, '/en/station/canonical-fm');
  assert.deepEqual(reads, ['slug:duplicate-fm', 'slug:canonical-fm', 'slug:duplicate-fm', 'slug:canonical-fm']);
});

test('an aborted target read propagates as a retryable render timeout without a cached redirect', async () => {
  fixtures.set('slug:canonical-fm', () => { throw new DOMException('Cancelled', 'AbortError'); });
  await assert.rejects(renderer.renderStaticPage(sourceUrl, 'https://themegaradio.com'), /SEO_RENDER_TIMEOUT/);
  assert.equal(pageCache.size, 0);
});
