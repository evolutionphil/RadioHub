import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getQueryFn } from '../src/lib/queryClient';
import { authQueryOptions, isTransientAuthError } from '../src/lib/auth-query';
import { useAuth } from '../src/hooks/useAuth';
import { usePremiumStatus } from '../src/hooks/usePremiumStatus';
import { FavoriteStateProvider } from '../src/hooks/useFavoriteState';
import { TranslationProvider } from '../src/hooks/useTranslation';

const player = vi.hoisted(() => ({ playAtLogin: vi.fn(async () => {}) }));
vi.mock('@/hooks/useGlobalPlayer', () => ({ useGlobalPlayer: () => player }));
let client: QueryClient;
const network = vi.fn();
let response: () => Promise<Response>;
const anonymous = { authenticated: false, user: null };
const premiumUser = { authenticated: true, user: {
  _id: 'premium-listener', subscription: { plan: 'premium_monthly', isActive: true },
} };

function PremiumConsumer() {
  const status = usePremiumStatus();
  return <output>{status.isLoading ? 'loading' : status.error ? 'error' : status.isPremium ? 'premium' : 'public'}</output>;
}
function LoginConsumer() { useAuth(); return null; }
const wrap = (count = 1) => <QueryClientProvider client={client}>
  <TranslationProvider><FavoriteStateProvider>
    {Array.from({ length: count }, (_, index) => <PremiumConsumer key={index} />)}
  </FavoriteStateProvider></TranslationProvider>
</QueryClientProvider>;
const authCalls = () => network.mock.calls.filter(([url]) => url === '/api/auth/me');
const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => {
  vi.useFakeTimers();
  onlineManager.setOnline(true);
  window.history.replaceState({}, '', '/de');
  sessionStorage.clear(); localStorage.clear(); player.playAtLogin.mockClear();
  response = async () => Response.json(anonymous);
  network.mockReset().mockImplementation(async (url: string) => url === '/api/auth/me' ? response() : Response.json([]));
  vi.stubGlobal('fetch', network);
  client = new QueryClient({ defaultOptions: { queries: {
    queryFn: getQueryFn({ on401: 'throw' }), retry: false, staleTime: 300_000,
    gcTime: 600_000, refetchOnWindowFocus: false, refetchOnReconnect: false, refetchOnMount: false,
  } } });
  client.setQueryData(['/api/user/favorites'], []);
  for (const locale of ['de', 'en']) {
    client.setQueryData(['/api/translations', locale, 'critical'], { hello: 'hello' });
    client.setQueryData(['/api/translations', locale], { hello: 'hello' });
  }
});
afterEach(() => {
  cleanup(); client.clear(); onlineManager.setOnline(true);
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  sessionStorage.clear(); localStorage.clear();
});

it('100 consumers and all three auth owners share exactly one delayed network retry', async () => {
  let attempts = 0;
  response = async () => { if (++attempts === 1) throw new TypeError('Failed to fetch'); return Response.json(anonymous); };
  const timers = vi.spyOn(globalThis, 'setTimeout');
  const view = render(wrap(100));
  await flush();
  expect(authCalls()).toHaveLength(1);
  expect(view.getAllByText('loading')).toHaveLength(100);
  expect(timers.mock.calls.filter(([, delay]) => delay === 1000)).toHaveLength(1);
  await flush(999); expect(authCalls()).toHaveLength(1);
  await flush(2);
  expect(authCalls()).toHaveLength(2);
  expect(view.getAllByText('public')).toHaveLength(100);
  expect(client.getQueryCache().getAll().filter(query => query.queryKey[0] === '/api/auth/me')).toHaveLength(1);
});

it('exhausts one 5xx retry, stays closed and does not start another loop on consumer remount', async () => {
  response = async () => new Response('Unavailable', { status: 503 });
  const view = render(wrap());
  await flush(1002);
  expect(authCalls()).toHaveLength(2); expect(view.getByText('error')).toBeVisible();
  view.rerender(wrap(20)); await flush(30_000);
  expect(authCalls()).toHaveLength(2);
  expect(view.getAllByText('error')).toHaveLength(20);
});

it('recovers once on a real browser offline-to-online event after bounded failure, not repeated online events', async () => {
  response = async () => { throw new TypeError('Network unavailable'); };
  const view = render(wrap(10));
  await flush(1002); expect(authCalls()).toHaveLength(2);
  response = async () => Response.json(anonymous);
  await act(async () => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
  await flush(1);
  expect(authCalls()).toHaveLength(3); expect(view.getAllByText('public')).toHaveLength(10);
  await act(async () => { window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('online')); });
  await flush(5000); expect(authCalls()).toHaveLength(3);
});

it.each([401, 403, 429])('does not retry or online-refetch HTTP %s, and does not fetch favorites', async status => {
  response = async () => new Response('Denied', { status });
  const view = render(wrap(5));
  await flush(5000);
  expect(authCalls()).toHaveLength(1); expect(view.getAllByText('error')).toHaveLength(5);
  await act(async () => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
  await flush(5000); expect(authCalls()).toHaveLength(1);
  expect(network.mock.calls.some(([url]) => url === '/api/user/favorites')).toBe(false);
});

it('retains known premium state while an auth refresh fails and after recovering', async () => {
  client.setQueryData(['/api/auth/me'], premiumUser);
  response = async () => new Response('Unavailable', { status: 502 });
  const view = render(wrap());
  expect(view.getByText('premium')).toBeVisible();
  let refresh!: Promise<void>;
  await act(async () => { refresh = client.invalidateQueries({ queryKey: ['/api/auth/me'] }); });
  await flush(1002); await refresh;
  expect(view.getByText('error')).toBeVisible();
  expect(client.getQueryData(['/api/auth/me'])).toEqual(premiumUser);
  expect(localStorage.getItem('_mrt_is_premium')).toBe('1');
  response = async () => Response.json(premiumUser);
  await act(async () => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
  await flush(1); expect(view.getByText('premium')).toBeVisible();
  expect(view.queryByText('public')).toBeNull();
});

it('all observers block pending OAuth despite stale cache, invalidation and reconnect, then consume hydration', async () => {
  const pending = { ...anonymous, _pendingTokenExchange: true };
  client.setQueryData(['/api/auth/me'], pending, { updatedAt: Date.now() - 600_000 });
  const view = render(wrap(10));
  await act(async () => { await client.invalidateQueries({ queryKey: ['/api/auth/me'] }); });
  await act(async () => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
  await flush(5000);
  expect(authCalls()).toHaveLength(0); expect(view.getAllByText('loading')).toHaveLength(10);
  expect(client.getQueryData(['/api/auth/me'])).toEqual(pending);
  await act(async () => { client.setQueryData(['/api/auth/me'], premiumUser); });
  await flush(1); expect(view.getAllByText('premium')).toHaveLength(10);
  expect(authCalls()).toHaveLength(0);
});

it('forwards AbortSignal and Bearer and cancels a pending request before OAuth hydration', async () => {
  sessionStorage.setItem('_mrt_oat', 'test-bearer');
  let finish!: (value: Response) => void;
  response = () => new Promise(resolve => { finish = resolve; });
  const view = render(wrap()); await flush();
  const init = authCalls()[0][1] as RequestInit;
  expect(init).toMatchObject({ credentials: 'include', headers: { Authorization: 'Bearer test-bearer' } });
  expect(init.signal).toBeInstanceOf(AbortSignal);
  await act(async () => { await client.cancelQueries({ queryKey: ['/api/auth/me'] }); client.setQueryData(['/api/auth/me'], premiumUser); });
  expect(init.signal?.aborted).toBe(true);
  await act(async () => { finish(Response.json(anonymous)); }); await flush(1002);
  expect(client.getQueryData(['/api/auth/me'])).toEqual(premiumUser);
  expect(view.getByText('premium')).toBeVisible(); expect(authCalls()).toHaveLength(1);
});

it('does not replay play-at-login when the same authenticated user recovers from a transient error', async () => {
  const user = { ...premiumUser, user: { ...premiumUser.user, playAtLogin: 'last-played' } };
  client.setQueryData(['/api/auth/me'], user);
  render(<QueryClientProvider client={client}><LoginConsumer /></QueryClientProvider>);
  expect(player.playAtLogin).toHaveBeenCalledTimes(1);
  response = async () => new Response('Unavailable', { status: 503 });
  let refresh!: Promise<void>;
  await act(async () => { refresh = client.invalidateQueries({ queryKey: ['/api/auth/me'] }); });
  await flush(1002); await refresh;
  response = async () => Response.json(user);
  await act(async () => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
  await flush(1); expect(player.playAtLogin).toHaveBeenCalledTimes(1);
});

it('classifies only network and 5xx failures as transient', () => {
  for (const error of [new Error('500: error'), new Error('599: error'), new TypeError('Failed to fetch')]) expect(isTransientAuthError(error)).toBe(true);
  for (const error of [new Error('401: denied'), new Error('403: denied'), new Error('429: limit'), new SyntaxError('JSON'), new DOMException('Cancelled', 'AbortError'), new Error('programming error')]) expect(isTransientAuthError(error)).toBe(false);
  expect(authQueryOptions.retry).not.toBe(false);
});
