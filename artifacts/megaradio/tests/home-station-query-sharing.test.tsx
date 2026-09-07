import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { homeStationPageOptions, selectPopularHomeStations } from '../src/lib/home-station-query';

const clients: QueryClient[] = [];
afterEach(() => { cleanup(); clients.forEach(client => client.clear()); clients.length = 0; vi.unstubAllGlobals(); });
const rows = (country: string, page = 1, count = 18) => Array.from({ length: count }, (_, i) => ({ _id: `${country}-${page}-${i}`, name: `Radio ${i}`, votes: 100 - i }));
function Lists({ country, page = 1 }: { country: string; page?: number }) {
  const all = useQuery(homeStationPageOptions(country, page));
  const popular = useQuery({ ...homeStationPageOptions(country), select: selectPopularHomeStations });
  return <><output data-testid="all">{JSON.stringify(all.data?.stations.map(station => station._id) || [])}</output>
    <output data-testid="popular">{popular.isPending ? 'pending' : JSON.stringify(popular.data?.map(station => station._id) || [])}</output>
    <output data-testid="status">{popular.status}</output></>;
}
function setup(country = 'all', page = 1) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  clients.push(client);
  const wrap = (nextCountry: string, nextPage: number) => <QueryClientProvider client={client}><Lists country={nextCountry} page={nextPage} /></QueryClientProvider>;
  return { ...render(wrap(country, page)), wrap, client };
}
const read = (id: string): string[] => JSON.parse(screen.getByTestId(id).textContent!);

it('shares one immediate compact18 request and displays the exact first12 without a timer', async () => {
  let resolve!: (response: Response) => void;
  const fetcher = vi.fn(() => new Promise<Response>(done => { resolve = done; }));
  vi.stubGlobal('fetch', fetcher);
  setup();
  expect(fetcher).toHaveBeenCalledTimes(1);
  const requested = new URL(fetcher.mock.calls[0][0] as string, 'https://radio.example');
  expect(Object.fromEntries(requested.searchParams)).toEqual({ countryName: 'global', page: '1', limit: '18', slim: '1' });
  expect(screen.getByTestId('popular')).toHaveTextContent('pending');
  const stations = rows('global');
  await act(async () => resolve(Response.json({ data: stations, pagination: { total: 50, pages: 3 } })));
  await waitFor(() => expect(read('popular')).toEqual(stations.slice(0, 12).map(station => station._id)));
  expect(read('all')).toEqual(stations.map(station => station._id));
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('keeps popular on page1 while All Stations loads page2 and isolates country caches', async () => {
  const fetcher = vi.fn(async (url: string) => {
    const params = new URL(url, 'https://radio.example').searchParams;
    return Response.json({ data: rows(params.get('countryName')!, Number(params.get('page'))), pagination: { total: 50, pages: 3 } });
  });
  vi.stubGlobal('fetch', fetcher);
  const view = setup('Austria');
  await waitFor(() => expect(read('popular')).toHaveLength(12));
  const firstPopular = read('popular');
  view.rerender(view.wrap('Austria', 2));
  await waitFor(() => expect(read('all')[0]).toBe('Austria-2-0'));
  expect(read('popular')).toEqual(firstPopular);
  expect(fetcher).toHaveBeenCalledTimes(2);
  view.rerender(view.wrap('Germany', 1));
  await waitFor(() => expect(read('popular')[0]).toBe('Germany-1-0'));
  expect(fetcher).toHaveBeenCalledTimes(3);
  view.rerender(view.wrap('Austria', 1));
  await waitFor(() => expect(read('popular')).toEqual(firstPopular));
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it('preserves small/empty country results without fabricating stations', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: rows('small', 1, 3), pagination: { total: 3, pages: 1 } })));
  const view = setup('small');
  await waitFor(() => expect(read('popular')).toHaveLength(3));
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [], pagination: { total: 0, pages: 0 } })));
  view.rerender(view.wrap('empty', 1));
  await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('success'));
  expect(read('popular')).toEqual([]);
});

it('exposes request failure as error instead of permanent pending popular skeletons', async () => {
  const fetcher = vi.fn(async () => new Response('', { status: 503 }));
  vi.stubGlobal('fetch', fetcher);
  setup();
  await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'));
  expect(screen.getByTestId('popular')).toHaveTextContent('[]');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
