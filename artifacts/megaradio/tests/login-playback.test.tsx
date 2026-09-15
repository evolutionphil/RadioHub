import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const request = vi.hoisted(() => vi.fn());
const lazyPlay = vi.hoisted(() => vi.fn());
vi.mock('@/lib/queryClient', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/queryClient')>(), apiRequest: request,
}));
import { useAuth } from '../src/hooks/useAuth';
import { selectLoginStation, useLoginPlayback, type LoginPlaybackUser } from '../src/hooks/useLoginPlayback';
import { GlobalPlayerContext, shellDefaults } from '../src/hooks/useGlobalPlayer.shell';
vi.mock('../src/hooks/useGlobalPlayer', () => ({ GlobalPlayerProvider: ({ children }: { children: React.ReactNode }) => {
  const [currentStation, setCurrentStation] = React.useState<any>(null);
  const playStation = async (station: any) => { lazyPlay(station); setCurrentStation(station); };
  const playAtLogin = useLoginPlayback({ isReady: true, currentStation, playStation });
  return <GlobalPlayerContext.Provider value={{ ...shellDefaults, isHydrated: true, currentStation, playStation, playAtLogin }}>{children}</GlobalPlayerContext.Provider>;
} }));
import { LazyGlobalPlayerProvider } from '../src/hooks/LazyGlobalPlayerProvider';

const station = { _id: 'first', name: 'First station', url: 'https://example.test/live', isListVisible: true };
const second = { ...station, _id: 'second', name: 'Second station' };
const user = (id = 'listener', mode: 'LAST_PLAYED' | 'FAVORITE' | 'RANDOM' = 'LAST_PLAYED'): LoginPlaybackUser => ({
  _id: id, preferences: { autoplay: true, playAtLogin: mode },
});
const response = (body: unknown) => ({ json: async () => body });
let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  request.mockReset().mockResolvedValue(response([station]));
  lazyPlay.mockReset();
  client.setQueryData(['/api/auth/me'], { authenticated: true, user: user() });
});
afterEach(() => { cleanup(); client.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

describe('saved login playback choices', () => {
  it('does not fetch for missing or explicitly disabled autoplay, regardless of a legacy enabled field', async () => {
    expect(await selectLoginStation({ _id: 'listener' })).toBeNull();
    expect(await selectLoginStation({ ...user(), preferences: { autoplay: false, playAtLogin: 'RANDOM' } })).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });
  it('uses account history or favorites and leaves empty collections silent', async () => {
    expect(await selectLoginStation(user())).toEqual(station);
    expect(request).toHaveBeenLastCalledWith('GET', '/api/recently-played', { signal: undefined });
    request.mockResolvedValueOnce(response({ stations: [second], pagination: { total: 1 } }));
    expect(await selectLoginStation(user('listener', 'FAVORITE'))).toEqual(second);
    expect(request).toHaveBeenLastCalledWith('GET', '/api/user/favorites?sort=newest&page=1&limit=20', { signal: undefined });
    request.mockResolvedValueOnce(response({ stations: [] }));
    expect(await selectLoginStation(user('listener', 'FAVORITE'))).toBeNull();
  });
  it('randomly selects only usable visible entries from the public discovery list', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.8);
    request.mockResolvedValueOnce(response({ stations: [null, {}, { ...station, isListVisible: false }, station, second] }));
    expect(await selectLoginStation(user('listener', 'RANDOM'))).toEqual(second);
    expect(request).toHaveBeenCalledWith('GET', '/api/stations?limit=50&excludeBroken=true', { signal: undefined });
  });
});

describe('one login attempt in the player runtime', () => {
  it('hydrates the lazy runtime and starts the saved login choice without a play gesture', async () => {
    let runIdle!: IdleRequestCallback;
    const schedule = vi.fn((callback: IdleRequestCallback) => { runIdle = callback; return 17; });
    vi.stubGlobal('requestIdleCallback', schedule);
    vi.stubGlobal('cancelIdleCallback', vi.fn());
    render(<QueryClientProvider client={client}><LazyGlobalPlayerProvider><span>Signed-in page</span></LazyGlobalPlayerProvider></QueryClientProvider>);
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), { timeout: 500 });
    expect(request).not.toHaveBeenCalled();
    await act(async () => { runIdle({ didTimeout: true, timeRemaining: () => 0 }); });
    await waitFor(() => expect(lazyPlay.mock.calls).toEqual([[station]]));
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('waits for audio readiness and plays once despite multiple auth observers and ordinary renders', async () => {
    const play = vi.fn(async () => {});
    const { rerender } = renderHook(({ ready }) => {
      useAuth(); useAuth(); useAuth();
      return useLoginPlayback({ isReady: ready, currentStation: null, playStation: play });
    }, { wrapper, initialProps: { ready: false } });
    expect(request).not.toHaveBeenCalled();
    rerender({ ready: true });
    await waitFor(() => expect(play.mock.calls).toEqual([[station]]));
    rerender({ ready: true });
    await act(async () => { client.setQueryData(['/api/auth/me'], { authenticated: true, user: { ...user(), fullName: 'New name' } }); });
    expect(request).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledTimes(1);
  });
  it('keeps disabled intent for the current login and applies saved preferences after logging in again', async () => {
    client.setQueryData(['/api/auth/me'], { authenticated: true, user: { ...user(), playAtLogin: 'random', preferences: { autoplay: false } } });
    const play = vi.fn(async () => {});
    const { result } = renderHook(() => {
      const auth = useAuth();
      useLoginPlayback({ isReady: true, currentStation: null, playStation: play });
      return auth;
    }, { wrapper });
    await act(async () => { client.setQueryData(['/api/auth/me'], { authenticated: true, user: user() }); });
    expect(request).not.toHaveBeenCalled();
    await act(async () => { client.setQueryData(['/api/auth/me'], { authenticated: false, user: null }); });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(false));
    await act(async () => { client.setQueryData(['/api/auth/me'], { authenticated: true, user: user() }); });
    await waitFor(() => expect(play.mock.calls).toEqual([[station]]));
  });
  it('discards a pending result after an account switch and plays only the new account selection', async () => {
    let resolveFirst!: (value: any) => void;
    request.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }));
    const play = vi.fn(async () => {});
    renderHook(() => useLoginPlayback({ isReady: true, currentStation: null, playStation: play }), { wrapper });
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    request.mockResolvedValueOnce(response({ stations: [second] }));
    await act(async () => { client.setQueryData(['/api/auth/me'], { authenticated: true, user: user('new-listener', 'FAVORITE') }); });
    await waitFor(() => expect(play.mock.calls).toEqual([[second]]));
    await act(async () => { resolveFirst(response([station])); });
    expect(play).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(request.mock.calls[0][2].signal.aborted).toBe(true));
  });
  it('does not restart an already selected station or retry a failed request on rerender', async () => {
    const play = vi.fn(async () => {});
    const { rerender } = renderHook(({ current }) => useLoginPlayback({ isReady: true, currentStation: current, playStation: play }),
      { wrapper, initialProps: { current: station as any } });
    expect(request).not.toHaveBeenCalled();
    rerender({ current: null });
    expect(request).not.toHaveBeenCalled();
    request.mockRejectedValueOnce(new Error('Service unavailable'));
    await act(async () => { client.setQueryData(['/api/auth/me'], { authenticated: true, user: user('new-listener') }); });
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    rerender({ current: null });
    expect(play).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('cancels a pending selection when autoplay is disabled or the user logs out', async () => {
    let resolveFirst!: (value: any) => void;
    request.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }));
    const play = vi.fn(async () => {});
    renderHook(() => useLoginPlayback({ isReady: true, currentStation: null, playStation: play }), { wrapper });
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    await act(async () => { client.setQueryData(['/api/auth/me'], { authenticated: true, user: { ...user(), preferences: { autoplay: false } } }); });
    await act(async () => { resolveFirst(response([station])); });
    expect(play).not.toHaveBeenCalled();
    await act(async () => { client.setQueryData(['/api/auth/me'], { authenticated: false, user: null }); });
    await waitFor(() => expect(request.mock.calls[0][2].signal.aborted).toBe(true));
  });
  it('discards a station selected under a playback mode that changed while loading', async () => {
    let finish!: (value: any) => void;
    request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const play = vi.fn(async () => {});
    renderHook(() => useLoginPlayback({ isReady: true, currentStation: null, playStation: play }), { wrapper });
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    await act(async () => {
      client.setQueryData(['/api/auth/me'], { authenticated: true, user: user('listener', 'FAVORITE') });
      finish(response([station]));
    });
    expect(play).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
  });
});
