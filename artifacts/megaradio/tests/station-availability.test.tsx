import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { isExplicitlyFailedStation, availableStations, adjacentAvailableStation } from '@/utils/station-availability';
import { stationQueryFreshness } from '@/lib/station-query-policy';
import { homeStationPageOptions } from '@/lib/home-station-query';
import { getPrecomputedStationsSlice } from '@/lib/precomputed-pool';
import { GlobalPlayerProvider } from '@/hooks/useGlobalPlayer';
import { useGlobalPlayer } from '@/hooks/useGlobalPlayer.shell';

vi.mock('@/services/metadata-client', () => ({ createMetadataClient: () => ({subscribe:vi.fn(),trackStream:vi.fn(),connect:vi.fn(),disconnect:vi.fn(),stop:vi.fn(),destroy:vi.fn()}) }));
vi.mock('@/lib/analytics', () => ({ trackStationPlay: vi.fn(), trackListeningTime: vi.fn(), trackStationFavorite: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('only hides confirmed list exclusions; historical provider failure remains playable', () => {
  expect(isExplicitlyFailedStation({ isListVisible: false, lastCheckOk: false })).toBe(true);
  for (const station of [null, {}, { lastCheckOk: false }, { lastCheckOk: true }, { lastCheckOk: null }, { lastcheckok: 0 }, {isListVisible:true,lastCheckOk:false}]) expect(isExplicitlyFailedStation(station)).toBe(false);
  const rows = [{ _id: 'ok', lastCheckOk: true }, { _id: 'failed', isListVisible: false }, { _id: 'legacy',lastCheckOk:false }];
  expect(availableStations(rows).map(row => row._id)).toEqual(['ok', 'legacy']);
  expect(rows).toHaveLength(3);
});

it('skips failed queue entries in both directions, wraps, and tolerates a failed current station', () => {
  const rows = [{ _id: 'a' }, { _id: 'b', isListVisible: false }, { _id: 'c' }];
  expect(adjacentAvailableStation(rows, 'a', 1)?._id).toBe('c');
  expect(adjacentAvailableStation(rows, 'c', -1)?._id).toBe('a');
  expect(adjacentAvailableStation(rows, 'c', 1)?._id).toBe('a');
  expect(adjacentAvailableStation(rows, 'b', 1)?._id).toBe('a');
  expect(adjacentAvailableStation(rows, 'b', -1)?._id).toBe('c');
  expect(adjacentAvailableStation([{ _id: 'b', isListVisible: false }], 'b', 1)).toBeUndefined();
});

it('allows an explicit retry even for a station excluded from discovery lists', async () => {
  const network = vi.fn(async () => ({ok:true,json:async()=>({}),text:async()=>''})); vi.stubGlobal('fetch', network);
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  localStorage.setItem('recentlyPlayed', '[{"_id":"retained"}]');
  const { result } = renderHook(() => useGlobalPlayer(), { wrapper: ({ children }) => <GlobalPlayerProvider>{children}</GlobalPlayerProvider> });
  await act(async () => { await result.current.playStation({ _id: 'failed', name: 'Retry', url: 'https://example.invalid/live.mp3', lastCheckOk: false,isListVisible:false } as any); });
  expect(result.current.currentStation?._id).toBe('failed');
  await waitFor(()=>expect(play).toHaveBeenCalled());
  expect(JSON.parse(localStorage.getItem('recentlyPlayed') || '[]').some((s:any)=>s._id==='retained')).toBe(true);
});

it('keeps station refresh bounded and opt-in without a per-card polling interval', () => {
  expect(stationQueryFreshness.staleTime).toBe(300_000);
  expect(stationQueryFreshness).toMatchObject({ refetchOnMount: true, refetchOnWindowFocus: true, refetchOnReconnect: true });
  expect(stationQueryFreshness).not.toHaveProperty('refetchInterval');
  expect(homeStationPageOptions('global')).toMatchObject(stationQueryFreshness);
});

it('expires the shared station pool after five minutes and coalesces concurrent recovery requests', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
  let rows = [{ _id: 'a', isListVisible: true }, { _id: 'b', isListVisible: false }];
  const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ data: rows }) }));
  vi.stubGlobal('fetch', fetcher);
  const country = 'freshness-fixture';
  expect(await getPrecomputedStationsSlice(country, 12)).toEqual([rows[0]]);
  now.mockReturnValue(300_999);
  await getPrecomputedStationsSlice(country, 12);
  expect(fetcher).toHaveBeenCalledTimes(1);
  rows = rows.map(row => ({ ...row, isListVisible: true })); now.mockReturnValue(301_001);
  const result = await Promise.all([getPrecomputedStationsSlice(country, 12), getPrecomputedStationsSlice(country, 20)]);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(result.every(list => list.length === 2)).toBe(true);
});
