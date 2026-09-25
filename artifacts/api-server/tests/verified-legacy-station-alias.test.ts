import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import { verifiedLegacyStationAlias } from '../src/seo/verified-legacy-station-alias';

const reads: string[] = [];
let rows = new Map<string, Record<string, any>>();
let slugRows: any[] = [];
mock.module('../src/postgres-runtime', { namedExports: { getPostgresPool: () => ({
  query: async (_sql: string, values: string[]) => {
    reads.push(values[0]);
    return { rows: rows.has(values[0]) ? [rows.get(values[0])] : [] };
  },
}) } });
mock.module('../src/data/postgres-catalog-store', { namedExports: { pgCatalog: () => ({ groupCount: async () => [] }) } });
mock.module('../src/data/postgres-seo-indexing-store', { namedExports: {
  pgStationSlugRows: async () => slugRows,
  pgSeoGenres: async () => [], pgSlugCountryNames: async () => [], pgSlugCountryStates: async () => [],
} });
mock.module('../src/services/precomputed-cities', { namedExports: { PrecomputedCitiesService: { getSupportedCountries: () => [] } } });
const { getStationByIdentifier } = await import('../src/data/station-read-store');
const { loadSlugExistence, hasStationSlug, getCanonicalStationSlug, getRedirectableStationSlug } = await import('../src/seo/slug-existence');

beforeEach(async () => {
  reads.length = 0;
  rows = new Map();
  slugRows = [];
  await loadSlugExistence();
});

test('only individually reviewed historical spellings are eligible', () => {
  assert.equal(verifiedLegacyStationAlias('kpissfm-2'), 'kpiss-fm-2');
  assert.equal(verifiedLegacyStationAlias('flashbassfm-1'), 'flashbass-fm-1');
  assert.equal(verifiedLegacyStationAlias('radio-onda-rossa-1'), 'onda-rossa');
  assert.equal(verifiedLegacyStationAlias('kiis-1065-sydney-1065-fm-mp3-1'), 'kiis-106-5');
  assert.equal(verifiedLegacyStationAlias('france-bleu-besanon'), 'france-bleu-besancon');
  assert.equal(verifiedLegacyStationAlias('radio-russia'), 'radio-rossii');
  assert.equal(verifiedLegacyStationAlias('1fm-movie-soundtrack'), 'movie-soundtracks-hits-radio-1-fm');
  assert.equal(verifiedLegacyStationAlias('1fm-movie-soundtrack-hits'), 'movie-soundtracks-hits-radio-1-fm');
  for (const slug of ['kpissfm-1', 'kpiss-fm-2', 'randomfm-1', '-2173', '__proto__', 'constructor',
    'radio-onda-rossa-3', 'kiis-1065-sydney-1065-fm-mp3-2',
    'france-bleu-besanon-1', 'radio-russia-1', '1fm-movie-soundtrack-1', '1fm-movie-soundtrack-hits-1']) {
    assert.equal(verifiedLegacyStationAlias(slug), null, slug);
  }
});

for (const [legacy, canonical, id] of [
  ['radio-onda-rossa-1', 'onda-rossa', '68a8c482bd66579311ab2f5b'],
  ['kiis-1065-sydney-1065-fm-mp3-1', 'kiis-106-5', '68a8c478bd66579311ab1477'],
  ['france-bleu-besanon', 'france-bleu-besancon', '6a07916dbef34beb9148c147'],
  ['radio-russia', 'radio-rossii', '68a8c4a8bd66579311ab8be1'],
  ['1fm-movie-soundtrack', 'movie-soundtracks-hits-radio-1-fm', '68a8c47fbd66579311ab27d0'],
  ['1fm-movie-soundtrack-hits', 'movie-soundtracks-hits-radio-1-fm', '68a8c47fbd66579311ab27d0'],
]) {
  const target = { id, slug: canonical, name: 'Verified Radio', no_index: false,
    url: 'https://stream.example.invalid/live', slug_aliases: [] };
  const cacheTarget = { _id: id, slug: canonical, name: target.name, noIndex: false,
    url: target.url, slugAliases: [] };

  test(`${legacy}: direct canonical identity resolves through public reads and the redirect cache`, async () => {
    rows.set(canonical, target);
    slugRows = [cacheTarget];
    await loadSlugExistence();
    const station = await getStationByIdentifier(legacy);
    assert.equal(station?._id, id);
    assert.equal(station?.slug, canonical);
    assert.deepEqual(reads, [legacy, canonical], 'one bounded fallback, no name/country search');
    assert.equal(hasStationSlug(legacy), true);
    assert.equal(getCanonicalStationSlug(legacy), canonical);
    assert.equal(getCanonicalStationSlug(legacy.toUpperCase()), canonical);
    assert.equal(getCanonicalStationSlug(canonical), null, 'canonical destination is stable');
    assert.equal(getRedirectableStationSlug(legacy), canonical);
    assert.equal(getRedirectableStationSlug(canonical), canonical);
  });

  for (const reason of ['missing', 'reassigned', 'redirect-cycle', 'redirect-chain']) {
    test(`${legacy}: ${reason} target cannot acquire a historical identity`, async () => {
      if (reason !== 'missing') {
        const redirect = reason.startsWith('redirect') ? (reason === 'redirect-cycle' ? legacy : 'another-station') : undefined;
        rows.set(canonical, { ...target, id: reason === 'reassigned' ? 'unrelated-owner' : id, redirect_to_slug: redirect });
        slugRows = [{ ...cacheTarget, _id: reason === 'reassigned' ? 'unrelated-owner' : id, redirectToSlug: redirect }];
      }
      await loadSlugExistence();
      assert.equal(await getStationByIdentifier(legacy), null);
      assert.deepEqual(reads, [legacy, canonical]);
      assert.equal(hasStationSlug(legacy), false);
      assert.equal(getCanonicalStationSlug(legacy), null);
    });
  }

  for (const reason of ['noindex', 'junk']) {
    test(`${legacy}: ${reason} target remains excluded without changing public data`, async () => {
      const noIndex = reason === 'noindex';
      const url = reason === 'junk' ? '' : target.url;
      rows.set(canonical, { ...target, no_index: noIndex, url });
      slugRows = [{ ...cacheTarget, noIndex, url }];
      await loadSlugExistence();
      const station = await getStationByIdentifier(legacy);
      assert.equal(station?._id, id);
      assert.equal(station?.noIndex, noIndex);
      assert.equal(station?.url, url);
      assert.equal(hasStationSlug(legacy), true, 'SSR must apply its normal exclusion response');
      assert.equal(getCanonicalStationSlug(legacy), null, 'middleware must never promote an excluded target');
    });
  }

  for (const exactSlug of [legacy, 'current-alias-owner']) {
    test(`${legacy}: existing ${exactSlug === legacy ? 'slug' : 'alias'} owner wins over the repair`, async () => {
      rows.set(legacy, { id: 'current-owner', slug: exactSlug, no_index: true });
      rows.set(canonical, target);
      slugRows = [cacheTarget, { ...cacheTarget, _id: 'current-owner', slug: exactSlug,
        slugAliases: exactSlug === legacy ? [] : [legacy], noIndex: true }];
      await loadSlugExistence();
      assert.equal((await getStationByIdentifier(legacy))?._id, 'current-owner');
      assert.deepEqual(reads, [legacy]);
      assert.equal(hasStationSlug(legacy), true);
      assert.equal(getCanonicalStationSlug(legacy), null, 'an excluded actual owner cannot be bypassed');
      slugRows[1].noIndex = false;
      await loadSlugExistence();
      assert.equal(getCanonicalStationSlug(legacy), exactSlug === legacy ? null : exactSlug);
    });
  }
}

for (const [legacy, alias, canonical] of [
  ['kpissfm-2', 'kpiss-fm-2', 'kpiss-fm'],
  ['flashbassfm-1', 'flashbass-fm-1', 'flashbass-fm'],
]) {
  test(`${legacy}: public reads resolve the persisted alias only after an exact miss`, async () => {
    rows.set(alias, { id: 'verified-station', slug: canonical, no_index: false, slug_aliases: [alias] });
    assert.equal((await getStationByIdentifier(legacy))?.slug, canonical);
    assert.deepEqual(reads, [legacy, alias]);
  });

  test(`${legacy}: existence/canonical cache uses the same real alias and junk decision`, async () => {
    assert.equal(hasStationSlug(legacy), false);
    assert.equal(getCanonicalStationSlug(legacy), null);
    slugRows = [{ slug: canonical, slugAliases: [alias], noIndex: false, name: 'Verified FM', lastCheckOk: true, url: 'https://stream.example.invalid/live' }];
    await loadSlugExistence();
    assert.equal(hasStationSlug(legacy), true);
    assert.equal(getCanonicalStationSlug(legacy), canonical);
    slugRows[0].noIndex = true;
    await loadSlugExistence();
    assert.equal(hasStationSlug(legacy), true);
    assert.equal(getCanonicalStationSlug(legacy), null);
  });
}

test('current exact records override repairs in public reads and the redirect cache', async () => {
  rows.set('kpissfm-2', { id: 'exact', slug: 'kpissfm-2' });
  rows.set('kpiss-fm-2', { id: 'other', slug: 'kpiss-fm' });
  assert.equal((await getStationByIdentifier('kpissfm-2'))?._id, 'exact');
  assert.deepEqual(reads, ['kpissfm-2']);
  slugRows = [
    { slug: 'kpiss-fm', slugAliases: ['kpiss-fm-2'], name: 'KPISS.FM', lastCheckOk: true, url: 'https://stream.example.invalid/live' },
    { slug: 'kpissfm-2', slugAliases: [], name: 'Exact owner', lastCheckOk: true, url: 'https://stream.example.invalid/other' },
  ];
  await loadSlugExistence();
  assert.equal(getCanonicalStationSlug('kpissfm-2'), null);
  slugRows[1] = { slug: 'different-exact-owner', slugAliases: ['kpissfm-2'], name: 'Exact alias owner', lastCheckOk: true, url: 'https://stream.example.invalid/other' };
  await loadSlugExistence();
  assert.equal(getCanonicalStationSlug('kpissfm-2'), 'different-exact-owner');
});

test('missing verified targets and unverified URLs remain missing without catalog scans or guesses', async () => {
  assert.equal(await getStationByIdentifier('kpissfm-2'), null);
  assert.deepEqual(reads, ['kpissfm-2', 'kpiss-fm-2']);
  reads.length = 0;
  assert.equal(await getStationByIdentifier('kpissfm-1'), null);
  assert.deepEqual(reads, ['kpissfm-1']);
});

for (const reversed of [false, true]) {
  for (const noIndex of [false, true]) {
    test(`a real canonical identity beats another record's stale alias (reversed=${reversed}, noIndex=${noIndex})`, async () => {
      const current = {
        slug: 'smooth-1', slugAliases: ['smooth-3'], name: 'smooth', noIndex,
        country: 'The Russian Federation', url: 'http://jfm1.hostingradio.ru:14536/sjstream.mp3',
        redirectToSlug: 'radio-jazz-smooth',
      };
      const staleOwner = {
        slug: 'smooth', slugAliases: ['smooth-1', 'smooth-uganda'], name: 'Smooth',
        noIndex: false, country: 'Uganda', url: 'http://media-the.musicradio.com/SmoothLondonMP3',
      };
      slugRows = reversed ? [current, staleOwner] : [staleOwner, current];
      await loadSlugExistence();
      assert.equal(hasStationSlug('smooth-1'), true);
      assert.equal(getCanonicalStationSlug('smooth-1'), null, 'defer the exact record to SSR and its own redirect');
      assert.equal(getRedirectableStationSlug('smooth-1'), null, 'explicit redirect records remain with SSR');
      assert.equal(getCanonicalStationSlug('SMOOTH-1'), null, 'case normalization preserves exact identity');
      assert.equal(getCanonicalStationSlug('smooth-uganda'), 'smooth', 'unrelated legitimate aliases still work');
      assert.equal(getCanonicalStationSlug('smooth-3'), noIndex ? null : 'smooth-1');
    });
  }
}

test('legacy-locale shortcuts require actual non-excluded exact/alias identities, not just slug existence', async () => {
  const valid = { _id: 'valid-id', name: 'Valid FM', url: 'https://stream.example.invalid/live', noIndex: false, slug: 'valid-fm', slugAliases: ['old-valid-fm'] };
  slugRows = [valid,
    { ...valid, _id: '68a8c4a6bd66579311ab887d', name: 'Джем FM', slug: 'dzhem-fm', slugAliases: ['fm-100'], noIndex: true, lastCheckOk: false },
    { ...valid, slug: 'format-mp3', slugAliases: ['old-format'] },
    { ...valid, slug: '1234', slugAliases: ['numeric-brand'] },
    { ...valid, slug: 'explicit-redirect', slugAliases: ['redirect-alias'], redirectToSlug: 'valid-fm' },
  ];
  await loadSlugExistence();
  for (const identifier of ['valid-fm', 'old-valid-fm', 'OLD-VALID-FM']) assert.equal(getRedirectableStationSlug(identifier), 'valid-fm');
  for (const identifier of ['dzhem-fm', 'fm-100', 'format-mp3', 'old-format', '1234', 'numeric-brand',
    'explicit-redirect', 'redirect-alias', 'missing', '__proto__']) assert.equal(getRedirectableStationSlug(identifier), null, identifier);
  assert.equal(hasStationSlug('fm-100'), true, 'excluded identity remains available to the existing SSR policy');
  slugRows = [{ ...valid, noIndex: true }]; await loadSlugExistence();
  assert.equal(getRedirectableStationSlug('valid-fm'), null, 'refresh removes newly excluded destinations');
  assert.equal(getRedirectableStationSlug('old-valid-fm'), null);
});

test('excluded and numeric exact owners cannot fall through to another station stale alias', async () => {
  const valid = { name: 'Valid FM', url: 'https://stream.example.invalid/live', noIndex: false, slug: 'valid-fm', slugAliases: ['excluded-fm', '1234', 'legitimate-alias'] };
  const owners = [{ ...valid, slug: 'excluded-fm', noIndex: true, slugAliases: [] },
    { ...valid, slug: '1234', slugAliases: [] }];
  for (const candidates of [[valid, ...owners], [...owners, valid]]) {
    slugRows = candidates; await loadSlugExistence();
    for (const identifier of ['excluded-fm', '1234']) {
      assert.equal(getCanonicalStationSlug(identifier), null, 'exact identity wins before aliases');
      assert.equal(getRedirectableStationSlug(identifier), null, 'ineligible exact identity must remain with SSR');
    }
    assert.equal(getRedirectableStationSlug('legitimate-alias'), 'valid-fm');
  }
});
