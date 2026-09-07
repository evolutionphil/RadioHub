import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { fetchStationCardList } from '../src/lib/station-card-list-request';

afterEach(() => vi.unstubAllGlobals());

it.each([
  { search: 'Wien & Radio', limit: '20' },
  { search: 'Viyana FM', limit: '20', sort: 'votes' },
  { country: 'Germany', state: 'Wien', page: '3', limit: '33', sort: 'az' },
])('adds only the compact contract to card/search params %j', async values => {
  const params = new URLSearchParams(values);
  const before = params.toString();
  const response = Response.json({ stations: [{ _id: 'a' }], pagination: { page: 3, total: 90 } });
  const fetcher = vi.fn().mockResolvedValue(response); vi.stubGlobal('fetch', fetcher);
  expect(await fetchStationCardList(params)).toBe(response);
  const requested = new URL(fetcher.mock.calls[0][0], 'https://radio.example');
  expect(requested.pathname).toBe('/api/stations');
  expect(Object.fromEntries(requested.searchParams)).toEqual({ ...values, slim: '1' });
  expect(params.toString()).toBe(before);
});

it('preserves AbortSignal and request options without adding retries', async () => {
  const controller = new AbortController();
  const error = new DOMException('Aborted', 'AbortError');
  const fetcher = vi.fn().mockRejectedValue(error); vi.stubGlobal('fetch', fetcher);
  const init = { signal: controller.signal };
  await expect(fetchStationCardList(new URLSearchParams({ search: 'Radio' }), init)).rejects.toBe(error);
  expect(fetcher.mock.calls[0][1]).toBe(init);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('returns error responses unchanged for the existing caller error handling', async () => {
  const response = new Response('Unavailable', { status: 503 });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
  expect(await fetchStationCardList(new URLSearchParams())).toBe(response);
  expect(response.bodyUsed).toBe(false);
});

it('connects only audited card-only callers and leaves the general API default unchanged', () => {
  const readSource = (file: string) => readFileSync(new URL('../src/' + file, import.meta.url), 'utf8');
  for (const file of ['pages/radio-frontend.tsx', 'components/layout/radio-header.tsx', 'pages/radios.tsx']) {
    const source = readSource(file);
    expect(source).toContain("import { fetchStationCardList } from '@/lib/station-card-list-request'");
    expect(source).toMatch(/fetchStationCardList\(params(?:,|\))/);
    expect(source).not.toContain('fetch(`/api/stations?${params}`');
  }
  const api = readSource('lib/api.ts');
  expect(api).not.toContain('fetchStationCardList');
  expect(api).not.toContain("set('slim'");
});
