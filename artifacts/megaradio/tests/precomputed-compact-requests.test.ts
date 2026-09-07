import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it('coalesces compact requests and preserves station rows, order, country and slices', async () => {
  const rows = Array.from({ length: 200 }, (_, index) => ({ _id: String(index), name: `Station ${index}`, url: 'https://stream.example.test', logoAssets: { webp96: 'existing.webp' } }));
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: rows, pagination: { limit: 200 } }) });
  vi.stubGlobal('fetch', fetch);
  const { getPrecomputedStationsSlice } = await import('../src/lib/precomputed-pool');
  const [small, large] = await Promise.all([getPrecomputedStationsSlice('United Kingdom', 12), getPrecomputedStationsSlice('United Kingdom', 100)]);
  expect(fetch).toHaveBeenCalledTimes(1);
  const request = new URL(fetch.mock.calls[0][0], 'https://example.test');
  expect(Object.fromEntries(request.searchParams)).toEqual({ countryName: 'United Kingdom', page: '1', limit: '200', slim: '1' });
  expect(small).toEqual(rows.slice(0, 12)); expect(large).toEqual(rows.slice(0, 100));
  expect(await getPrecomputedStationsSlice('United Kingdom', 50)).toEqual(rows.slice(0, 50));
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each(['pages/radio-frontend.tsx', 'pages/AustriaRadiosPage.tsx', 'pages/genres/[slug].tsx', 'components/layout/ProfileLayout.tsx', 'pages/profile-discover.tsx', 'pages/recommendations.tsx', 'pages/radios.tsx', 'pages/search.tsx', 'hooks/useStationRelatedStations.ts'])(
  '%s keeps all precomputed card-list requests compact without changing detail requests', file => {
    const source = readFileSync(resolve(process.cwd(), 'src', file), 'utf8');
    const requests = source.match(/\/api\/stations\/(?:precomputed|nearby)\?[^`'"\n]+/g) || [];
    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) expect(request).toContain('slim=1');
  },
);

it('station details delegates compact related-list requests to its scoped hook without adding inline requests', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/stations/[id].tsx'), 'utf8');
  expect(source).toContain("from '@/hooks/useStationRelatedStations'");
  expect(source).toContain('useStationRelatedStations(station, targetCountry, identifier)');
  expect(source).not.toMatch(/\/api\/stations\/(?:precomputed|nearby)\?/);
  const hook = readFileSync(resolve(process.cwd(), 'src/hooks/useStationRelatedStations.ts'), 'utf8');
  const requests = hook.match(/\/api\/stations\/precomputed\?[^`'"\n]+/g) || [];
  expect(requests).toHaveLength(3); // country30, global200, country60
  for (const request of requests) expect(request).toContain('slim=1');
});
