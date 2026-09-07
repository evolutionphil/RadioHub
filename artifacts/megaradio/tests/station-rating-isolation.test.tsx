import React from 'react';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useStationRatings, stationRatingKeys } from '../src/hooks/useStationRatings';
import { StarRating } from '../src/components/star-rating';

vi.mock('../src/hooks/useTranslation', () => ({ useTranslation: () => ({ language: 'en', localeTranslations: {}, t: (_key: string, fallback: string) => fallback }) }));

let client: QueryClient;
const stats = (averageRating = 0, totalRatings = 0) => ({ averageRating, totalRatings });
const saved = (stationId: string, rating = 5, comment = 'A comment') => ({
  success: true, rating: { station_id: stationId, rating, comment }, stats: stats(rating, 1),
});
const emptyGet = (url: string) => Response.json(url.includes('/user-rating') ? { rating: null } : { stats: stats() });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
function mount(stationId: string | undefined, userId?: string) {
  return renderHook(({ stationId, userId }) => useStationRatings(stationId, userId), {
    initialProps: { stationId, userId },
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
}
beforeEach(() => {
  localStorage.setItem('radio_session_id', 'session_fixture');
  sessionStorage.clear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('saved stars, comment and totals belong to A, never the next station B', async () => {
  const records = new Map<string, ReturnType<typeof saved>>();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const id = url.split('/')[3];
    if (init?.method === 'POST') {
      const body = JSON.parse(init.body as string);
      const result = saved(id, body.rating, body.comment); records.set(id, result); return Response.json(result);
    }
    const record = records.get(id);
    return Response.json(url.includes('/user-rating') ? { rating: record?.rating ?? null } : { stats: record?.stats ?? stats() });
  }));
  const view = mount('A');
  await waitFor(() => expect(view.result.current.statsStatus).toBe('ready'));
  await act(async () => { await view.result.current.submitRating(5, 'Only A'); });
  await waitFor(() => expect(view.result.current.userRating?.rating).toBe(5));
  view.rerender({ stationId: 'B', userId: undefined });
  expect(view.result.current.userRating).toBeUndefined();
  expect(view.result.current.stats).toBeUndefined();
  await waitFor(() => expect(view.result.current.statsStatus).toBe('ready'));
  expect(view.result.current.userRating).toBeNull();
  expect(view.result.current.stats).toEqual(stats());
  view.rerender({ stationId: 'A', userId: undefined });
  expect(view.result.current.userRating).toMatchObject({ rating: 5, comment: 'Only A' });
  expect(view.result.current.stats).toEqual(stats(5, 1));
});

it('a late A save updates only captured A keys while B stays untouched', async () => {
  const post = deferred<Response>();
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => init?.method === 'POST' ? post.promise : Promise.resolve(emptyGet(url))));
  const view = mount('A');
  await waitFor(() => expect(view.result.current.statsStatus).toBe('ready'));
  client.setQueryData(['/api/station/a-slug'], { _id: 'A', name: 'A', ...stats() });
  client.setQueryData(['/api/station/b-slug'], { _id: 'B', name: 'B', ...stats(2, 3) });
  let submission!: Promise<unknown>;
  act(() => { submission = view.result.current.submitRating(4, 'A while navigating'); });
  view.rerender({ stationId: 'B', userId: undefined });
  await waitFor(() => expect(view.result.current.statsStatus).toBe('ready'));
  await act(async () => { post.resolve(Response.json(saved('A', 4, 'A while navigating'))); await submission; });
  expect(view.result.current.userRating).toBeNull();
  expect(view.result.current.stats).toEqual(stats());
  expect(client.getQueryData(stationRatingKeys('A', undefined, 'session_fixture').user)).toMatchObject({ rating: { rating: 4 } });
  expect(client.getQueryData(['/api/station/a-slug'])).toMatchObject(stats(4, 1));
  expect(client.getQueryData(['/api/station/b-slug'])).toEqual({ _id: 'B', name: 'B', ...stats(2, 3) });
});

it('changing authenticated viewer cannot inherit the previous viewer rating', async () => {
  let viewer = 'one';
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.includes('/user-rating')
    ? { rating: { stationId: 'A', rating: viewer === 'one' ? 5 : 2, comment: viewer } }
    : { stats: stats(3.5, 2) })));
  const view = mount('A', 'one');
  await waitFor(() => expect(view.result.current.userRating?.rating).toBe(5));
  viewer = 'two'; view.rerender({ stationId: 'A', userId: 'two' });
  expect(view.result.current.userRating).toBeUndefined();
  await waitFor(() => expect(view.result.current.userRating?.rating).toBe(2));
  expect(view.result.current.ratingScopeKey).toBe('two:session_fixture');
});

it('failed and unavailable ratings do not become a successful zero-ratings response', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('unavailable', { status: 503 })));
  const view = mount('A');
  expect(view.result.current.statsStatus).toBe('loading');
  await waitFor(() => expect(view.result.current.statsStatus).toBe('error'));
  expect(view.result.current.stats).toBeUndefined();
  await expect(view.result.current.submitRating(3)).rejects.toThrow('503');
  expect(client.getQueryData(stationRatingKeys('A', undefined, 'session_fixture').user)).toBeUndefined();
});

it('the accepted write cancels older GETs so a stale response cannot restore zero ratings', async () => {
  const oldUser = deferred<Response>(), oldStats = deferred<Response>();
  let submitted = false;
  const signals: AbortSignal[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') { submitted = true; return Response.json(saved('A')); }
    if (submitted) return Response.json(url.includes('/user-rating') ? { rating: saved('A').rating } : { stats: stats(5, 1) });
    signals.push(init?.signal as AbortSignal);
    return url.includes('/user-rating') ? oldUser.promise : oldStats.promise;
  }));
  const view = mount('A');
  await act(async () => { await view.result.current.submitRating(5); });
  expect(signals.every(signal => signal.aborted)).toBe(true);
  await act(async () => { oldUser.resolve(Response.json({ rating: null })); oldStats.resolve(Response.json({ stats: stats() })); });
  await waitFor(() => expect(view.result.current.stats).toEqual(stats(5, 1)));
  expect(view.result.current.userRating?.rating).toBe(5);
});

it('uses cookie/bearer auth consistently and never treats a supplied userId as authentication', async () => {
  sessionStorage.setItem('_mrt_oat', 'test-only-bearer');
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => init?.method === 'POST' ? Response.json(saved('A')) : emptyGet(url));
  vi.stubGlobal('fetch', fetcher);
  const view = mount('A', 'user-fixture');
  await waitFor(() => expect(view.result.current.statsStatus).toBe('ready'));
  await act(async () => { await view.result.current.submitRating(5); });
  for (const [url, init] of fetcher.mock.calls) {
    expect(init?.credentials).toBe('include');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer test-only-bearer' });
    expect(url).not.toContain('userId=');
    if (init?.body) expect(JSON.parse(init.body as string)).not.toHaveProperty('userId');
  }
});

it('rejects a mismatched station response instead of contaminating the requested cache', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => init?.method === 'POST' ? Response.json(saved('B')) : emptyGet(url)));
  const view = mount('A');
  await waitFor(() => expect(view.result.current.statsStatus).toBe('ready'));
  await expect(view.result.current.submitRating(5)).rejects.toThrow('another station');
  expect(view.result.current.stats).toEqual(stats());
});

it('does not fetch ratings until the current station ID is known', () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  const view = mount(undefined);
  expect(view.result.current.statsStatus).toBe('loading');
  expect(fetcher).not.toHaveBeenCalled();
});

it('the real widget and query hook together keep another station empty after a quick rating', async () => {
  const records = new Map<string, ReturnType<typeof saved>>();
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const id = url.split('/')[3];
    if (init?.method === 'POST') {
      const body = JSON.parse(init.body as string);
      const result = saved(id, body.rating, body.comment); records.set(id, result); return Response.json(result);
    }
    const record = records.get(id);
    return Response.json(url.includes('/user-rating') ? { rating: record?.rating ?? null } : { stats: record?.stats ?? stats() });
  });
  vi.stubGlobal('fetch', fetcher);
  function Widget({ id }: { id: string }) {
    const state = useStationRatings(id);
    return <StarRating stationId={id} ratingScopeKey={state.ratingScopeKey}
      initialRating={state.userRating?.rating} initialComment={state.userRating?.comment}
      averageRating={state.stats?.averageRating} totalRatings={state.stats?.totalRatings}
      statsStatus={state.statsStatus} onRatingSubmit={async (rating, comment) => { await state.submitRating(rating, comment); }} />;
  }
  const tree = (id: string) => <QueryClientProvider client={client}><Widget id={id} /></QueryClientProvider>;
  const view = render(tree('A'));
  await screen.findByText('No ratings yet');
  await userEvent.click(screen.getByRole('button', { name: 'Rate 5 out of 5' }));
  await screen.findByText('5.0');
  view.rerender(tree('B'));
  expect(screen.queryByText('5.0')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Rate 5 out of 5' })).toHaveAttribute('aria-pressed', 'false');
  await screen.findByText('No ratings yet');
  expect(screen.getByRole('button', { name: 'Add Review' })).toBeInTheDocument();
  expect(fetcher.mock.calls.filter(([url, init]) => init?.method === 'POST').map(([url]) => url)).toEqual(['/api/stations/A/rate']);
  view.rerender(tree('A'));
  await screen.findByText('5.0');
  expect(screen.getByRole('button', { name: 'Update Review' })).toBeInTheDocument();
});
