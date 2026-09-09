import React from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, focusManager, onlineManager } from '@tanstack/react-query';
import { useAvailableStationSnapshots } from '@/hooks/useAvailableStationSnapshots';
import { useBatchStations } from '@/hooks/useBatchStations';

const a = { _id: 'a', name: 'Earlier page', lastCheckOk: true, descriptions: { de: 'Existing content' } };
const b = { _id: 'b', name: 'Second page', lastCheckOk: true };
let client: QueryClient;
beforeEach(() => { client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); });
afterEach(() => { cleanup(); client.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); focusManager.setFocused(undefined); onlineManager.setOnline(true); });
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

it('hides earlier-page failures on focus and restores them on recovery without deleting accumulated snapshots or full caches', async () => {
  const snapshots = Object.freeze([Object.freeze(a), Object.freeze(b)]);
  const now = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
  let serverMap: Record<string, any> = { a: { _id: 'a', name: 'Earlier page', lastCheckOk: true }, b };
  const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
    expect(JSON.parse(String(init.body))).toEqual({ stationIds: ['a', 'b'], slim: true });
    return { ok: true, json: async () => serverMap };
  });
  vi.stubGlobal('fetch', fetcher);
  client.setQueryData(['batch-stations', 'a,b'], { a, b });
  const { result } = renderHook(() => useAvailableStationSnapshots(snapshots), { wrapper });
  await waitFor(() => expect(client.getQueryData(['batch-stations', 'a,b', 'cards'])).toEqual(serverMap));
  expect(result.current.map(row => row._id)).toEqual(['a', 'b']);
  expect(result.current[0].descriptions).toEqual(a.descriptions);
  serverMap = { b };
  act(() => { focusManager.setFocused(false); now.mockReturnValue(1_800_000_300_001); focusManager.setFocused(true); });
  await waitFor(() => expect(result.current.map(row => row._id)).toEqual(['b']));
  serverMap = { a: { _id: 'a', name: 'Recovered earlier page', lastCheckOk: true }, b };
  act(() => { onlineManager.setOnline(false); now.mockReturnValue(1_800_000_600_002); onlineManager.setOnline(true); });
  await waitFor(() => expect(result.current.map(row => row._id)).toEqual(['a', 'b']));
  expect(result.current[0].name).toBe('Recovered earlier page');
  expect(result.current[0].descriptions).toEqual(a.descriptions);
  expect(snapshots).toEqual([a, b]);
  expect(client.getQueryData(['batch-stations', 'a,b'])).toEqual({ a, b });
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it('does not resurrect an omitted earlier ID while a newly expanded Load More batch is pending', async () => {
  let complete!: (response: any) => void;
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ b }) })
    .mockImplementationOnce(() => new Promise(resolve => { complete = resolve; })));
  const { result, rerender } = renderHook(({ records }) => useAvailableStationSnapshots(records), { wrapper, initialProps: { records: [a, b] } });
  await waitFor(() => expect(result.current.map(row => row._id)).toEqual(['b']));
  const c = { _id: 'c', name: 'New page', lastCheckOk: true };
  rerender({ records: [a, b, c] });
  expect(result.current.map(row => row._id)).toEqual(['b', 'c']);
  await act(async () => { complete({ ok: true, json: async () => ({ b, c }) }); });
  expect(result.current.map(row => row._id)).toEqual(['b', 'c']);
});

it.each([{ ok: false }, { ok: true, json: async () => ({ error: 'invalid' }) }])('errors/malformed responses do not delete unverified accumulated records', async response => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
  const snapshots = [a, b];
  const { result } = renderHook(() => useAvailableStationSnapshots(snapshots), { wrapper });
  await waitFor(() => expect(client.getQueryCache().find({ queryKey: ['batch-stations', 'a,b', 'cards'] })?.state.status).toBe('error'));
  expect(result.current).toEqual(snapshots);
  expect(snapshots).toEqual([a, b]);
});

it('chunks at fifty IDs sequentially and never treats partial batch failure as authoritative', async () => {
  const ids = Array.from({ length: 120 }, (_, index) => `id-${index}`);
  let failSecond = true;
  const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
    const { stationIds, slim } = JSON.parse(String(init.body));
    expect(stationIds.length).toBeLessThanOrEqual(50); expect(slim).toBe(true);
    if (failSecond && stationIds[0] === 'id-50') return { ok: false };
    return { ok: true, json: async () => Object.fromEntries(stationIds.map((id: string) => [id, { _id: id, lastCheckOk: true }])) };
  });
  vi.stubGlobal('fetch', fetcher);
  const { result } = renderHook(() => useBatchStations([...ids, ids[0]], { compact: true }), { wrapper });
  await waitFor(() => expect(result.current.error).toBeTruthy());
  expect(result.current.hasAuthoritativeData).toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(2);
  failSecond = false;
  await act(async () => { await client.invalidateQueries({ queryKey: ['batch-stations'] }); });
  await waitFor(() => expect(result.current.hasAuthoritativeData).toBe(true));
  expect(Object.keys(result.current.stationsMap)).toHaveLength(120);
  expect(fetcher).toHaveBeenCalledTimes(5);
});

it('uses the authoritative visible view for homepage cards and playback queues without mutating the accumulator', () => {
  const source = readFileSync('src/pages/radio-frontend.tsx', 'utf8');
  expect(source).toContain('useAvailableStationSnapshots(allLoadedStations)');
  expect(source).toContain('availableLoadedStations.map((station: any, i: number)');
  expect(source).toContain('allLoadedStations.length > 0 ? availableLoadedStations :');
  expect(source).not.toContain('setAllLoadedStations(availableLoadedStations)');
});
