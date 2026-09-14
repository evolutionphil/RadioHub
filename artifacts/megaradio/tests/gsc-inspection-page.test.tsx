import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mocks = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/lib/queryClient', async importOriginal => ({
  ...await importOriginal<typeof import('../src/lib/queryClient')>(),
  resolveApiUrl: (path: string) => `https://api.example.test${path}`,
}));
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: any) => <select value={value} onChange={event => onValueChange(event.target.value)}>{children}</select>,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
  SelectTrigger: () => null, SelectValue: () => null,
}));
import GscInspection from '../src/pages/admin/gsc-inspection';

const prefix = '/api/admin/gsc-inspection/';
let qc: QueryClient;
let data: Record<string, any>;
let reportPending: boolean;
let urlRequests: URL[];
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const row = { _id: 'radio-one', url: 'https://themegaradio.com/en/station/radio-one', language: 'en', group: 'station', state: 'indexed', coverageState: 'Old Google coverage', serverNoindex: { noindex: false, reason: null } };

beforeEach(() => {
  mocks.toast.mockClear(); reportPending = false; urlRequests = [];
  sessionStorage.clear();
  window.history.replaceState({}, '', '/admin/gsc-inspection');
  data = {
    status: { configured: true, cronEnabled: true, siteUrl: 'sc-domain:themegaradio.com', discoveryRunning: false, inspectionRunning: false, resubmitRunning: false,
      lastInspectionAt: '2026-09-14T10:00:00Z', lastDiscoveryAt: null, lastResubmitAt: null, totalUrls: 1, stuckUrls: 0, defaultBatchSize: 50, resubmitStuckDays: 14 },
    stats: { total: 4, byState: [{ state: 'indexed', count: 1 }, { state: 'error', count: 1 }, { state: 'unknown', count: 2 }],
      byGroup: [{ group: 'station', total: 4, indexed: 1, crawledNotIndexed: 0, discoveredNotIndexed: 0, excluded: 0, pending: 0, error: 1, unknown: 2 }], byLanguage: [{ language: 'en', total: 4, indexed: 1 }] },
    urls: { rows: [row], pagination: { page: 1, limit: 50, total: 1, pages: 1 } },
    'oauth/status': { hasEnvVars: true, connected: true },
    'noindex-breakdown': { generatedAt: '2026-09-14T10:00:00Z', total: 1, breakdown: { indexable: 1, langRedirected: 0, stationNoIndex: 0, numericSlug: 0, junk: 0 }, qualifiedLanguageCount: 1, qualifiedLanguages: ['en'], byLanguage: [], sampledStationUrls: 1 },
    trends: { rows: [], missingDates: [], todayMissing: false },
  };
  vi.stubGlobal('fetch', vi.fn(async (input: any) => {
    const url = new URL(String(input), 'https://themegaradio.com');
    const suffix = url.pathname.slice(prefix.length);
    if (suffix === 'urls') urlRequests.push(url);
    if (suffix === 'noindex-breakdown' && reportPending) return json({ pending: true }, 202);
    const value = data[suffix];
    if (value instanceof Error) return json({ error: value.message }, 503);
    if (value === undefined) throw new Error(`Unexpected test request: ${url}`);
    return json(typeof value === 'function' ? value(url) : value);
  }));
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: Infinity,
    queryFn: async ({ queryKey }) => { const response = await fetch(String(queryKey[0])); if (!response.ok) throw new Error('Unavailable'); return response.json(); },
  }, mutations: { retry: false } } });
});
afterEach(() => { qc.clear(); vi.unstubAllGlobals(); });
const show = () => render(<QueryClientProvider client={qc}><GscInspection /></QueryClientProvider>);
const selectWith = (value: string) => screen.getAllByRole('combobox').find(el => [...(el as HTMLSelectElement).options].some(option => option.value === value))!;

it('shows report calculation instead of fabricated zero counts and polls pending reports', async () => {
  reportPending = true;
  show();
  expect(await screen.findByText(/Calculating the complete server indexability report/)).toBeInTheDocument();
  const query = qc.getQueryCache().find({ queryKey: [prefix + 'noindex-breakdown'] })!;
  await waitFor(() => expect(query.state.data).toBe(null));
  expect((query.options as any).refetchInterval(query)).toBe(2000);
  expect(screen.queryByText('stationNoIndex')).not.toBeInTheDocument();
  reportPending = false;
  await act(async () => { await qc.invalidateQueries({ queryKey: [prefix + 'noindex-breakdown'] }); });
  expect(await screen.findByText('stationNoIndex')).toBeInTheDocument();
  expect((query.options as any).refetchInterval(query)).toBe(300000);
});

it('refreshes URL rows when the background inspection completion timestamp changes', async () => {
  show();
  await screen.findByText('Old Google coverage');
  data.urls = { ...data.urls, rows: [{ ...row, coverageState: 'Fresh Google coverage' }] };
  data.status = { ...data.status, lastInspectionAt: '2026-09-14T10:01:00Z' };
  await act(async () => { await qc.invalidateQueries({ queryKey: [prefix + 'status'] }); });
  expect(await screen.findByText('Fresh Google coverage')).toBeInTheDocument();
  expect(urlRequests.length).toBeGreaterThan(1);
});

it('includes unknown verdicts in filters and error/unknown columns in group statistics', async () => {
  show();
  await screen.findByText('Old Google coverage');
  expect(screen.getByRole('columnheader', { name: 'Error' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Unknown' })).toBeInTheDocument();
  fireEvent.change(selectWith('unknown'), { target: { value: 'unknown' } });
  await waitFor(() => expect(urlRequests.at(-1)?.searchParams.get('state')).toBe('unknown'));
});

it('recovers the last page after discovery/pruning shrinks the matching result set', async () => {
  data.urls = (url: URL) => ({ rows: url.searchParams.get('page') === '2' ? [] : [row],
    pagination: { page: Number(url.searchParams.get('page')), limit: 50, total: url.searchParams.get('page') === '2' ? 1 : 51, pages: url.searchParams.get('page') === '2' ? 1 : 2 } });
  show();
  await screen.findByText('Old Google coverage');
  fireEvent.click(screen.getByRole('button', { name: 'Next URL page' }));
  await waitFor(() => expect(urlRequests.some(url => url.searchParams.get('page') === '2')).toBe(true));
  expect(await screen.findByText('Old Google coverage')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Previous URL page' })).toBeDisabled();
});

it('does not describe failed URL reads as empty search results or failed stats as zero percent', async () => {
  data.urls = new Error('Unavailable'); data.stats = new Error('Unavailable'); data['noindex-breakdown'] = new Error('Unavailable');
  show();
  expect(await screen.findByText('URL data unavailable. Retry data to try again.')).toBeInTheDocument();
  expect(screen.queryByText('No URLs match these filters.')).not.toBeInTheDocument();
  expect(screen.queryByText('0%')).not.toBeInTheDocument();
  expect(screen.getByText('URL group statistics unavailable.')).toBeInTheDocument();
  expect(screen.queryByText('stationNoIndex')).not.toBeInTheDocument();
});

it('shows rediscovery errors and accelerates status polling only while a job runs', async () => {
  data.discover = new Error('Discovery failed');
  show();
  await screen.findByText('Old Google coverage');
  fireEvent.click(screen.getByRole('button', { name: 'Re-discover URLs' }));
  expect(await screen.findByText('Discovery failed')).toBeInTheDocument();
  data.status = { ...data.status, inspectionRunning: true };
  await act(async () => { await qc.invalidateQueries({ queryKey: [prefix + 'status'] }); });
  const query = qc.getQueryCache().find({ queryKey: [prefix + 'status'] })!;
  expect((query.options as any).refetchInterval(query)).toBe(2000);
  expect(await screen.findByRole('button', { name: 'Running…' })).toBeDisabled();
});

it('uses the configured API origin and bearer fallback for custom reads, actions and CSV export', async () => {
  sessionStorage.setItem('_mrt_oat', 'fake-admin-token');
  data.refresh = { ok: true, running: true };
  data['history.csv'] = new Error('Export unavailable');
  show();
  await screen.findByText('Old Google coverage');
  for (const suffix of ['urls', 'trends', 'noindex-breakdown']) {
    const call = vi.mocked(fetch).mock.calls.find(([url]) => String(url).startsWith(`https://api.example.test${prefix}${suffix}`));
    expect(call?.[1]).toMatchObject({ credentials: 'include', headers: { Authorization: 'Bearer fake-admin-token' } });
  }
  fireEvent.click(screen.getByRole('button', { name: 'Run inspection batch (50)' }));
  await waitFor(() => {
    const call = vi.mocked(fetch).mock.calls.find(([url]) => String(url) === `https://api.example.test${prefix}refresh`);
    expect(call?.[1]).toMatchObject({ method: 'POST', credentials: 'include', headers: { Authorization: 'Bearer fake-admin-token', 'Content-Type': 'application/json' }, body: '{}' });
  });
  fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Export failed' })));
  const csv = vi.mocked(fetch).mock.calls.find(([url]) => String(url).startsWith(`https://api.example.test${prefix}history.csv?`));
  expect(csv?.[1]).toMatchObject({ credentials: 'include', headers: { Authorization: 'Bearer fake-admin-token' } });
  expect(String(csv?.[0])).toContain('language=all&group=all');
});
