import React, { StrictMode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const effects = vi.hoisted(() => ({
  request: vi.fn(), toast: vi.fn(), added: vi.fn(), removed: vi.fn(), analytics: vi.fn(),
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: effects.toast }) }));
vi.mock('@/services/NotificationService', () => ({ useNotificationService: () => ({ addedToFavorites: effects.added, removedFromFavorites: effects.removed }) }));
vi.mock('@/lib/queryClient', () => ({ apiRequest: effects.request }));
vi.mock('@/lib/analytics', () => ({ trackStationFavorite: effects.analytics }));
vi.mock('@/components/auth/auth-modal', () => ({ default: ({ isOpen, onClose }: any) => <div data-testid="favorite-login" hidden={!isOpen}><button onClick={onClose}>Cancel login</button></div> }));
import FavoriteButton from '../src/components/ui/favorite-button';
import { FavoriteStateProvider } from '../src/hooks/useFavoriteState';

let client: QueryClient;
let serverFavorites: Array<{ _id: string }>;
const network = vi.fn();
beforeEach(() => {
  serverFavorites = [];
  for (const effect of Object.values(effects)) effect.mockReset();
  network.mockReset().mockImplementation(async (url: string) => ({
    ok: true,
    json: async () => url === '/api/user/favorites' ? serverFavorites : null,
  }));
  vi.stubGlobal('fetch', network);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 300_000, gcTime: 600_000 } } });
  client.setQueryData(['/api/auth/me'], null);
  client.setQueryData(['/api/user/favorites'], []);
});
afterEach(() => { cleanup(); client.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const buttons = (count: number) => Array.from({ length: count }, (_, index) => <FavoriteButton key={index} stationId={`station-${index}`} />);
const wrap = (count: number) => <QueryClientProvider client={client}><FavoriteStateProvider>{buttons(count)}</FavoriteStateProvider></QueryClientProvider>;
it('100 actual favorite buttons share auth/favorites observers and allocate no metadata queries', () => {
  const timers = vi.spyOn(globalThis, 'setTimeout');
  const view = render(wrap(1));
  const firstTimers = timers.mock.calls.length;
  view.rerender(wrap(100));
  const cache = client.getQueryCache();
  console.info('Favorite lifecycle counts', JSON.stringify({
    auth: cache.find({ queryKey: ['/api/auth/me'], exact: true })?.getObserversCount(),
    favorites: cache.find({ queryKey: ['/api/user/favorites'], exact: true })?.getObserversCount(),
    metadataQueries: cache.getAll().filter(query => query.queryKey[0] === '/api/stations').length,
    firstTimers, allTimers: timers.mock.calls.length,
  }));
  expect(view.getAllByRole('button', { name: 'Add to favorites' })).toHaveLength(100);
  expect(cache.find({ queryKey: ['/api/auth/me'], exact: true })?.getObserversCount()).toBe(1);
  expect(cache.find({ queryKey: ['/api/user/favorites'], exact: true })?.getObserversCount()).toBe(1);
  expect(cache.getAll().filter(query => query.queryKey[0] === '/api/stations')).toHaveLength(0);
  expect(timers.mock.calls.length).toBe(firstTimers);
  expect(network).not.toHaveBeenCalled();
});

it('cleans shared observers through StrictMode unmount and remount', () => {
  const count = () => client.getQueryCache().getAll().reduce((total, query) => total + query.getObserversCount(), 0);
  const view = render(<StrictMode>{wrap(20)}</StrictMode>);
  expect(count()).toBe(2);
  view.unmount(); expect(count()).toBe(0);
  const remounted = render(<StrictMode>{wrap(20)}</StrictMode>);
  expect(count()).toBe(2);
  remounted.unmount(); expect(count()).toBe(0);
});

it('reflects cached favorites updates in all buttons without fetching per-station metadata', async () => {
  client.setQueryData(['/api/auth/me'], { authenticated: true, user: { _id: 'listener' } });
  const view = render(wrap(3));
  await act(async () => { client.setQueryData(['/api/user/favorites'], [{ _id: 'station-1' }]); });
  await waitFor(() => expect(view.getAllByRole('button')[1]).toHaveAttribute('aria-pressed', 'true'));
  expect(view.getAllByRole('button')[0]).toHaveAttribute('aria-pressed', 'false');
  expect(view.getAllByRole('button')[2]).toHaveAttribute('aria-pressed', 'false');
  expect(network).not.toHaveBeenCalled();
});

it('retains add/remove requests, all favorites invalidation and cache-only rich notifications', async () => {
  client.setQueryData(['/api/auth/me'], { authenticated: true, user: { _id: 'listener' } });
  client.setQueryData(['/api/user/favorites', 'profile'], []);
  client.setQueryData(['/api/stations', 'station-0'], { _id: 'station-0', name: 'Old name' });
  effects.request.mockImplementation(async (method: string) => {
    serverFavorites = method === 'POST' ? [{ _id: 'station-0' }] : [];
    return { alreadyFavorited: false };
  });
  const view = render(wrap(1));
  // Data arriving after mount is read at mutation completion, without subscribing.
  client.setQueryData(['/api/stations', 'station-0'], { _id: 'station-0', name: 'Current name', country: 'Austria', favicon: 'logo.webp' });
  expect(client.getQueryCache().find({ queryKey: ['/api/stations', 'station-0'], exact: true })?.getObserversCount()).toBe(0);
  fireEvent.click(view.getByRole('button', { name: 'Add to favorites' }));
  await waitFor(() => expect(view.getByRole('button')).toHaveAttribute('aria-pressed', 'true'));
  expect(effects.request).toHaveBeenNthCalledWith(1, 'POST', '/api/user/favorites', { body: { stationId: 'station-0' } });
  expect(effects.added).toHaveBeenCalledWith('Current name', 'Austria');
  expect(effects.analytics).toHaveBeenCalledWith('Current name', 'Austria', 'add');
  expect(client.getQueryState(['/api/user/favorites', 'profile'])?.isInvalidated).toBe(true);
  expect(network).toHaveBeenCalledWith('/api/push/favorite-added', expect.objectContaining({ method: 'POST', credentials: 'include' }));
  expect(JSON.parse(network.mock.calls.find(([url]) => url === '/api/push/favorite-added')![1].body)).toMatchObject({ stationId: 'station-0', stationName: 'Current name' });
  fireEvent.click(view.getByRole('button', { name: 'Remove from favorites' }));
  await waitFor(() => expect(view.getByRole('button')).toHaveAttribute('aria-pressed', 'false'));
  expect(effects.request).toHaveBeenNthCalledWith(2, 'DELETE', '/api/user/favorites/station-0');
  expect(effects.removed).toHaveBeenCalledWith('Current name');
  expect(network.mock.calls.filter(([url]) => url === '/api/user/favorites')).toHaveLength(2);
  expect(network.mock.calls.some(([url]) => url.startsWith('/api/stations/'))).toBe(false);
});

it('keeps pending click disabled and a rejected mutation does not invent favorite membership', async () => {
  client.setQueryData(['/api/auth/me'], { authenticated: true, user: { _id: 'listener' } });
  let reject!: (error: Error) => void;
  effects.request.mockImplementation(() => new Promise((_resolve, rejectRequest) => { reject = rejectRequest; }));
  const view = render(wrap(1));
  fireEvent.click(view.getByRole('button'));
  await waitFor(() => expect(view.getByRole('button')).toBeDisabled());
  fireEvent.click(view.getByRole('button'));
  expect(effects.request).toHaveBeenCalledTimes(1);
  await act(async () => { reject(new Error('offline')); });
  await waitFor(() => expect(view.getByRole('button')).not.toBeDisabled());
  expect(view.getByRole('button')).toHaveAttribute('aria-pressed', 'false');
  expect(effects.added).not.toHaveBeenCalled();
  expect(effects.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }));
});

it('keeps anonymous login intent through pending OAuth hydration and adds only after authentication', async () => {
  client.setQueryData(['/api/auth/me'], { authenticated: false, user: null, _pendingTokenExchange: true });
  effects.request.mockResolvedValue({ alreadyFavorited: true });
  const view = render(wrap(1));
  fireEvent.click(view.getByRole('button', { name: 'Add to favorites' }));
  await view.findByTestId('favorite-login');
  expect(effects.request).not.toHaveBeenCalled();
  expect(network).not.toHaveBeenCalled();
  await act(async () => { client.setQueryData(['/api/auth/me'], { authenticated: true, user: { _id: 'listener' } }); });
  await waitFor(() => expect(effects.request).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(view.getByTestId('favorite-login')).not.toBeVisible());
  expect(effects.added).not.toHaveBeenCalled();
  expect(network.mock.calls.some(([url]) => url === '/api/auth/me')).toBe(false);
});

it('cancelled anonymous intent is not replayed on later login, and logout returns to the login flow', async () => {
  const view = render(wrap(1));
  fireEvent.click(view.getByRole('button', { name: 'Add to favorites' }));
  await view.findByTestId('favorite-login');
  fireEvent.click(view.getByRole('button', { name: 'Cancel login' }));
  await act(async () => { client.setQueryData(['/api/auth/me'], { authenticated: true, user: { _id: 'listener' } }); });
  expect(effects.request).not.toHaveBeenCalled();
  await act(async () => { client.setQueryData(['/api/auth/me'], null); });
  fireEvent.click(view.getByRole('button', { name: 'Add to favorites' }));
  await waitFor(() => expect(view.getByTestId('favorite-login')).toBeVisible());
  expect(effects.request).not.toHaveBeenCalled();
});

it('does not fetch favorites on a 401 auth response', async () => {
  client.removeQueries({ queryKey: ['/api/auth/me'] });
  network.mockResolvedValue({ ok: false, status: 401 });
  const view = render(wrap(5));
  await waitFor(() => expect(client.getQueryData(['/api/auth/me'])).toBeNull());
  expect(network).toHaveBeenCalledTimes(1);
  expect(network).toHaveBeenCalledWith('/api/auth/me', { credentials: 'include' });
  expect(view.getAllByRole('button', { name: 'Add to favorites' })).toHaveLength(5);
});

it('clears membership on logout, refreshes for another account, and ignores profile-object churn', async () => {
  client.setQueryData(['/api/auth/me'], { authenticated: true, user: { _id: 'listener-A', username: 'A' } });
  client.setQueryData(['/api/user/favorites'], [{ _id: 'station-0' }]);
  client.setQueryData(['/api/user/favorites', 'profile'], [{ _id: 'station-0' }]);
  const view = render(wrap(2));
  expect(view.getAllByRole('button')[0]).toHaveAttribute('aria-pressed', 'true');
  await act(async () => { client.setQueryData(['/api/auth/me'], { authenticated: true, user: { _id: 'listener-A', username: 'Updated A' } }); });
  expect(view.getAllByRole('button')[0]).toHaveAttribute('aria-pressed', 'true');
  expect(network).not.toHaveBeenCalled();
  await act(async () => { client.setQueryData(['/api/auth/me'], { authenticated: false, user: null }); });
  await waitFor(() => expect(view.getAllByRole('button')[0]).toHaveAttribute('aria-pressed', 'false'));
  expect(client.getQueryData(['/api/user/favorites', 'profile'])).toBeUndefined();
  serverFavorites = [{ _id: 'station-1' }];
  await act(async () => { client.setQueryData(['/api/auth/me'], { authenticated: true, user: { _id: 'listener-B' } }); });
  await waitFor(() => expect(view.getAllByRole('button')[1]).toHaveAttribute('aria-pressed', 'true'));
  expect(view.getAllByRole('button')[0]).toHaveAttribute('aria-pressed', 'false');
  expect(network.mock.calls.filter(([url]) => url === '/api/user/favorites')).toHaveLength(1);
});

it('an in-flight former-account response cannot overwrite the new account favorites', async () => {
  client.setQueryData(['/api/auth/me'], { authenticated: true, user: { _id: 'listener-A' } });
  client.removeQueries({ queryKey: ['/api/user/favorites'] });
  let finishA!: (value: unknown) => void;
  network.mockImplementationOnce(() => new Promise(resolve => { finishA = resolve; }));
  const view = render(wrap(2));
  await waitFor(() => expect(network).toHaveBeenCalledTimes(1));
  const oldSignal = network.mock.calls[0][1].signal as AbortSignal;
  serverFavorites = [{ _id: 'station-1' }];
  await act(async () => { client.setQueryData(['/api/auth/me'], { authenticated: true, user: { _id: 'listener-B' } }); });
  await waitFor(() => expect(view.getAllByRole('button')[1]).toHaveAttribute('aria-pressed', 'true'));
  expect(oldSignal.aborted).toBe(true);
  await act(async () => { finishA({ ok: true, json: async () => [{ _id: 'station-0' }] }); });
  expect(view.getAllByRole('button')[0]).toHaveAttribute('aria-pressed', 'false');
  expect(view.getAllByRole('button')[1]).toHaveAttribute('aria-pressed', 'true');
  expect(client.getQueryData(['/api/user/favorites'])).toEqual([{ _id: 'station-1' }]);
  expect(network).toHaveBeenCalledTimes(2);
});
