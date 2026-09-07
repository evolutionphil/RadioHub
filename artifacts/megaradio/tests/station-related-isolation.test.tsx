import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { useStationRelatedStations, useStationDetailExpansion } from '../src/hooks/useStationRelatedStations';

type Request = { url: URL; signal: AbortSignal; resolve: (response: any) => void; reject: (error: Error) => void };
let requests: Request[];
beforeEach(() => {
  requests = [];
  vi.stubGlobal('fetch', vi.fn((url: string, options: RequestInit) => new Promise((resolve, reject) => {
    requests.push({ url: new URL(url, 'https://fixture.test'), signal: options.signal!, resolve, reject });
  })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const a = { _id: 'A', country: 'Austria', tags: 'rock' };
const b = { _id: 'B', country: 'Germany', tags: 'jazz' };
const rows = (prefix: string, count: number, tags = 'rock') => Array.from({ length: count }, (_, n) => ({ _id: `${prefix}${n}`, tags, name: `${prefix} station ${n}` }));
const request = (country: string, limit: number) => requests.find(r => r.url.searchParams.get('countryName') === country && r.url.searchParams.get('limit') === String(limit))!;
const respond = async (r: Request, data: any[], total = data.length) => {
  await act(async () => { r.resolve({ ok: true, json: async () => ({ data, pagination: { total } }) }); });
};

it('aborts both old requests and ignores late A results without launching an obsolete global fallback', async () => {
  const view = renderHook(({ station }) => useStationRelatedStations(station, station.country, station._id), { initialProps: { station: a } });
  const aRequests = [...requests];
  view.rerender({ station: b });
  expect(aRequests.every(r => r.signal.aborted)).toBe(true);
  expect(view.result.current).toMatchObject({ allSimilarStations: [], allCountryStations: [], countryStationsTotal: 0, loadingSimilar: true, loadingCountry: true });
  await respond(request('Germany', 30), rows('B-similar-', 15, 'jazz'));
  await respond(request('Germany', 60), rows('B-country-', 30), 800);
  await respond(aRequests[0], rows('A-late-', 2));
  await respond(aRequests[1], rows('A-late-country-', 20), 900);
  expect(requests).toHaveLength(4); // Stale A must not start global limit=200.
  expect(view.result.current.allSimilarStations.map(s => s._id)).toEqual(rows('B-similar-', 12).map(s => s._id));
  expect(view.result.current.allCountryStations).toHaveLength(30);
  expect(view.result.current.countryStationsTotal).toBe(800);
  expect(view.result.current.loadingSimilar || view.result.current.loadingCountry).toBe(false);
});

it('never exposes completed A lists during B first render, pending fetch, or failed fetch', async () => {
  const renders: Array<{ id: string; similar: string[]; country: string[]; total: number }> = [];
  const view = renderHook(({ station }) => {
    const state = useStationRelatedStations(station, station.country, station._id);
    renders.push({ id: station._id, similar: state.allSimilarStations.map(s => s._id), country: state.allCountryStations.map(s => s._id), total: state.countryStationsTotal });
    return state;
  }, { initialProps: { station: a } });
  await respond(request('Austria', 30), rows('A-', 12));
  await respond(request('Austria', 60), rows('A-country-', 20), 900);
  view.rerender({ station: b });
  expect(view.result.current.allCountryStations).toEqual([]);
  await act(async () => {
    request('Germany', 30).reject(new Error('network failure'));
    request('Germany', 60).resolve({ ok: false });
  });
  expect(view.result.current).toMatchObject({ allSimilarStations: [], allCountryStations: [], countryStationsTotal: 0, loadingSimilar: false, loadingCountry: false });
  expect(renders.filter(render => render.id === 'B').every(render => render.similar.length === 0 && render.country.length === 0 && render.total === 0)).toBe(true);
});

it('clears lists/count for missing station or missing country instead of retaining the prior page', async () => {
  const view = renderHook(({ station }: { station: typeof a | undefined }) => useStationRelatedStations(station, station?.country), { initialProps: { station: a as typeof a | undefined } });
  await respond(request('Austria', 30), rows('A-', 12));
  await respond(request('Austria', 60), rows('A-country-', 20), 900);
  view.rerender({ station: { _id: 'B', country: '', tags: '' } });
  expect(view.result.current).toMatchObject({ allSimilarStations: [], allCountryStations: [], countryStationsTotal: 0, loadingSimilar: false, loadingCountry: false });
  view.rerender({ station: undefined });
  expect(view.result.current).toMatchObject({ allSimilarStations: [], allCountryStations: [], loadingSimilar: false, loadingCountry: false });
  expect(requests).toHaveLength(2);
});

it('checks identity again after an already-started response body resolves', async () => {
  let finishBody!: (body: any) => void;
  const body = new Promise(resolve => { finishBody = resolve; });
  const view = renderHook(({ station }) => useStationRelatedStations(station, station.country), { initialProps: { station: a } });
  await act(async () => { request('Austria', 30).resolve({ ok: true, json: () => body }); });
  view.rerender({ station: b });
  await act(async () => { finishBody({ data: rows('A-', 2) }); });
  expect(requests).toHaveLength(4);
  expect(view.result.current.allSimilarStations).toEqual([]);
  expect(view.result.current.loadingSimilar).toBe(true);
});

it('retains country-first ranking, <6 tag-match fallback, global tag dedup and max12 with exact slim URLs', async () => {
  const view = renderHook(() => useStationRelatedStations(a, 'Austria'));
  const local = [a, { _id: 'local-first', tags: 'news' }, { _id: 'local-second', tags: 'ROCK' }];
  await respond(request('Austria', 30), local);
  expect(request('global', 200)).toBeDefined();
  await respond(request('global', 200), [a, local[2], { _id: 'wrong-tag', tags: 'jazz' }, ...rows('global-', 20)]);
  const country = [a, ...rows('country-', 40)];
  await respond(request('Austria', 60), country, 5410);
  expect(view.result.current.allSimilarStations.map(s => s._id)).toEqual(['local-first', 'local-second', ...rows('global-', 10).map(s => s._id)]);
  expect(view.result.current.allCountryStations.map(s => s._id)).toEqual(country.slice(1).map(s => s._id));
  expect(view.result.current.countryStationsTotal).toBe(5410);
  for (const r of requests) {
    expect(r.url.pathname).toBe('/api/stations/precomputed');
    expect(r.url.searchParams.get('page')).toBe('1');
    expect(r.url.searchParams.get('slim')).toBe('1');
  }
});

it('uses matching tags when at least six local matches exist and keeps the all→global country alias', async () => {
  const station = { ...a, country: undefined };
  const view = renderHook(() => useStationRelatedStations(station, 'all'));
  await respond(request('global', 30), [{ _id: 'wrong-local', tags: 'news' }, ...rows('tagged-', 8)]);
  await respond(request('global', 200), rows('additional-', 10));
  expect(view.result.current.allSimilarStations.map(s => s._id)).toEqual([...rows('tagged-', 8), ...rows('additional-', 4)].map(s => s._id));
  expect(view.result.current.loadingCountry).toBe(false);
});

it('aborts on unmount and never starts a late request or changes another mounted consumer', async () => {
  const view = renderHook(() => useStationRelatedStations(a, 'Austria'));
  view.unmount();
  expect(requests.every(r => r.signal.aborted)).toBe(true);
  await respond(requests[0], rows('late-', 2));
  await act(async () => { requests[1].reject(new Error('late failure')); });
  expect(requests).toHaveLength(2);
});

it('resets about/12→24 expansion immediately for a new station or pending route', () => {
  const snapshots: Array<{ route: string; about: boolean; more: number }> = [];
  const view = renderHook(({ route, id }: { route: string; id?: string }) => {
    const state = useStationDetailExpansion(route, id);
    snapshots.push({ route, about: state.isAboutExpanded, more: state.showMoreCountryCount });
    return state;
  }, { initialProps: { route: 'station-a', id: 'A' as string | undefined } });
  act(() => { view.result.current.setIsAboutExpanded(true); view.result.current.setShowMoreCountryCount(count => count + 1); });
  expect(view.result.current.isAboutExpanded).toBe(true);
  expect(view.result.current.showMoreCountryCount).toBe(1);
  view.rerender({ route: 'station-b', id: undefined });
  expect(view.result.current.isAboutExpanded).toBe(false);
  expect(view.result.current.showMoreCountryCount).toBe(0);
  expect(snapshots.filter(s => s.route === 'station-b').every(s => !s.about && s.more === 0)).toBe(true);
  view.rerender({ route: 'station-b', id: 'B' });
  act(() => { view.result.current.setShowMoreCountryCount(1); });
  view.rerender({ route: 'station-a', id: 'A' });
  expect(view.result.current.showMoreCountryCount).toBe(0);
});

it('keeps the page-level name deduplication and 12/24 display behavior unchanged', () => {
  const source = readFileSync('src/pages/stations/[id].tsx', 'utf8');
  expect(source).toContain('useStationRelatedStations(station, targetCountry, identifier)');
  expect(source).toContain('useStationDetailExpansion(identifier, station?._id)');
  expect(source).toContain('filterSimilarNames(allSimilarStations, currentStationBaseName)');
  expect(source).toContain('filterSimilarNames(filtered, similarBaseNames)');
  expect(source).toContain('showMoreCountryCount === 0 ? 12 : 24');
});
