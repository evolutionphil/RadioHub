import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, focusManager, onlineManager } from '@tanstack/react-query';
import { addRecentlyPlayed, hydrateRecentlyPlayed, mergeRecentlyPlayed, readRecentlyPlayed } from '../src/utils/recently-played';
const auth = vi.hoisted(() => ({ isAuthenticated: false }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));
import { useRecentlyPlayed } from '../src/hooks/useRecentlyPlayed';
import { useBatchStations } from '../src/hooks/useBatchStations';
let client: QueryClient;
beforeEach(() => {
  auth.isAuthenticated = false; localStorage.clear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); focusManager.setFocused(undefined); onlineManager.setOnline(true); });
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
const a = { _id: 'a', name: 'Radio A', favicon: '/old-a.png' };
const b = { _id: 'b', name: 'Radio B', favicon: '/old-b.png' };

describe('recent history timestamps and catalogue refresh', () => {
  it('records the new play time and retains other snapshots under the existing twelve-item cap', () => {
    const prior = [a, b, ...Array.from({ length: 11 }, (_, n) => ({ _id: `old-${n}`, name: `Old ${n}` }))];
    const now = new Date('2026-09-07T16:00:00Z');
    const updated = addRecentlyPlayed(JSON.stringify(prior), { ...b, name: 'Current B' }, now);
    expect(updated[0]).toEqual({ ...b, name: 'Current B', playedAt: now.toISOString() });
    expect(updated[1]).toEqual(a); expect(updated).toHaveLength(12);
    expect(updated.filter(row => row._id === 'b')).toHaveLength(1);
    expect(prior[0]).toEqual(a);
  });
  it('keeps newest local/API play time, stable undated order and treats malformed timestamps safely', () => {
    const merged = mergeRecentlyPlayed([{ ...a, playedAt: '2026-09-07T16:00:00Z' }, b, { _id: 'c', playedAt: 'bad' }],
      [{ ...a, playedAt: '2026-09-07T15:00:00Z' }, { ...b, playedAt: '2026-09-07T17:00:00Z' }]);
    expect(merged.map(row => row._id)).toEqual(['b', 'a', 'c']);
    expect(merged[1].playedAt).toBe('2026-09-07T16:00:00Z');
    expect(mergeRecentlyPlayed([b, a], []).map(row => row._id)).toEqual(['b', 'a']);
    expect(readRecentlyPlayed('{bad')).toEqual([]); expect(readRecentlyPlayed('{}')).toEqual([]);
  });
  it('retains missing stations and times while replacing or clearing obsolete logo fields', () => {
    const history = [{ ...a, logoAssets: { folder: 'old' }, localImagePath: 'old.webp', playedAt: '2026-09-07' }, b];
    const result = hydrateRecentlyPlayed(history, { a: { _id: 'a', name: 'Current A', favicon: '/current.png', logoAssets: null } });
    expect(result[0]).toMatchObject({ name: 'Current A', favicon: '/current.png', logoAssets: null, playedAt: '2026-09-07' });
    expect(result[0].localImagePath).toBeUndefined(); expect(result[1]).toBe(b);
    expect(history[0].favicon).toBe('/old-a.png');
  });
  it('hides authoritative batch omissions without deleting anonymous history', async () => {
    const stored = JSON.stringify([b, a]); localStorage.setItem('recentlyPlayed', stored);
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(String(init.body)).stationIds).toEqual(['b', 'a']);
      return { ok: true, json: async () => ({ a: { ...a, favicon: '/fixed.png' } }) };
    });
    vi.stubGlobal('fetch', fetcher);
    const { result } = renderHook(() => useRecentlyPlayed(), { wrapper });
    await waitFor(() => expect(result.current.recentlyPlayed[0]?.favicon).toBe('/fixed.png'));
    expect(result.current.recentlyPlayed.map(row => row._id)).toEqual(['a']);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0][0]).toBe('/api/stations/batch');
    expect(localStorage.getItem('recentlyPlayed')).toBe(stored);
  });
  it('recovers a hidden station after a successful later batch without rewriting storage', async () => {
    const stored = JSON.stringify([{ ...b, lastCheckOk: false }, a]); localStorage.setItem('recentlyPlayed', stored);
    let map: Record<string, any> = { a };
    let fail = false;
    vi.stubGlobal('fetch', vi.fn(async () => fail ? { ok: false } : { ok: true, json: async () => map }));
    const { result } = renderHook(() => useRecentlyPlayed(), { wrapper });
    await waitFor(() => expect(client.getQueryCache().find({ queryKey: ['batch-stations', 'a,b'] })?.state.status).toBe('success'));
    expect(result.current.recentlyPlayed.map(row => row._id)).toEqual(['a']);
    fail = true;
    await act(async () => { await client.invalidateQueries({ queryKey: ['batch-stations'] }); });
    expect(result.current.recentlyPlayed.map(row => row._id)).toEqual(['a']);
    fail = false; map = { a, b: { ...b, lastCheckOk: true } };
    await act(async () => { await client.invalidateQueries({ queryKey: ['batch-stations'] }); });
    await waitFor(() => expect(result.current.recentlyPlayed.map(row => row._id)).toEqual(['b', 'a']));
    expect(localStorage.getItem('recentlyPlayed')).toBe(stored);
  });
  it('does not treat a malformed success body as authoritative empty history', async () => {
    const stored = JSON.stringify([a, b]); localStorage.setItem('recentlyPlayed', stored);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ error: 'unavailable' }) })));
    const { result } = renderHook(() => useRecentlyPlayed(), { wrapper });
    await waitFor(() => expect(client.getQueryCache().find({ queryKey: ['batch-stations', 'a,b'] })?.state.status).toBe('error'));
    expect(result.current.recentlyPlayed.map(row => row._id)).toEqual(['a', 'b']);
    expect(localStorage.getItem('recentlyPlayed')).toBe(stored);
  });
  it('preserves local history during batch errors and handles later play events without stale API ordering', async () => {
    auth.isAuthenticated = true;
    localStorage.setItem('recentlyPlayed', JSON.stringify([{ ...a, playedAt: '2026-09-07T16:00:00Z' }]));
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/recently-played'
      ? { ok: true, json: async () => [{ ...a, playedAt: '2026-09-07T15:00:00Z' }, { ...b, playedAt: '2026-09-07T15:30:00Z' }] }
      : { ok: false }));
    const { result } = renderHook(() => useRecentlyPlayed(), { wrapper });
    await waitFor(() => expect(result.current.recentlyPlayed).toHaveLength(2));
    expect(result.current.recentlyPlayed.map(row => row._id)).toEqual(['a', 'b']);
    act(() => {
      localStorage.setItem('recentlyPlayed', JSON.stringify(addRecentlyPlayed(localStorage.getItem('recentlyPlayed'), b, new Date('2026-09-07T17:00:00Z'))));
      window.dispatchEvent(new Event('recentlyPlayedUpdated'));
    });
    await waitFor(() => expect(result.current.recentlyPlayed[0]._id).toBe('b'));
    expect(result.current.recentlyPlayed[0].playedAt).toBe('2026-09-07T17:00:00.000Z');
  });
  it('does not mutate caller ID order while sharing one batch cache across differently ordered consumers', async () => {
    const ids = ['b', 'a']; Object.freeze(ids);
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ a, b }) })); vi.stubGlobal('fetch', fetcher);
    const { result } = renderHook(() => [useBatchStations(ids), useBatchStations(['a', 'b'])], { wrapper });
    await waitFor(() => expect(result.current[0].stations).toHaveLength(2));
    expect(result.current[0].stations.map(row => row._id)).toEqual(['b', 'a']);
    expect(result.current[1].stations.map(row => row._id)).toEqual(['a', 'b']);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(ids).toEqual(['b', 'a']);
  });
  it('shares one stale batch refresh on focus/reconnect without per-consumer polling', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ a, b }) })); vi.stubGlobal('fetch', fetcher);
    renderHook(() => [useBatchStations(['a', 'b']), useBatchStations(['b', 'a'])], { wrapper });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(client.getQueryData(['batch-stations', 'a,b'])).toEqual({ a, b }));
    act(() => { focusManager.setFocused(false); now.mockReturnValue(1_800_000_300_001); focusManager.setFocused(true); });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(client.isFetching()).toBe(0));
    act(() => { onlineManager.setOnline(false); now.mockReturnValue(1_800_000_600_002); onlineManager.setOnline(true); });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    expect(client.getQueryCache().find({ queryKey: ['batch-stations', 'a,b'] })?.options).not.toHaveProperty('refetchInterval');
  });
});
