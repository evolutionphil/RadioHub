import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
vi.mock('wouter', () => ({ Link: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a> }));
vi.mock('@/lib/queryClient', () => ({ apiFetch: (url: string, init?: RequestInit) => fetch(url, init) }));
import Dashboard from '../src/pages/admin/dashboard';
import { visitorDetails } from './fixtures/visitor-details';

let client: QueryClient;
let values: Record<string, unknown>;
const statsPath = '/api/dashboard/stats';
const visitorsPath = '/api/admin/visitor-metrics';
const languagePath = '/api/admin/translation-languages';
const flagPath = '/api/admin/sync/auto-flagged-report';
const statusPath = '/api/admin/maintenance/scheduled-backfill/status';
const runsPath = '/api/admin/maintenance/scheduled-backfill/runs';
beforeEach(() => {
  values = {
    [statsPath]: { totalStations: 20, totalCountries: 3, totalGenres: 4, totalUsers: 2, openFeedback: 3, unresolvedErrors: 7,
      health: { database: 'online', radioBrowser: 'online', translations: 'active' },
      syncStatus: { isRunning: false, lastSync: null, lastSyncStatus: 'completed' } },
    [languagePath]: [{ code: 'en' }], [flagPath]: { last: null, lastCompleted: null },
    [statusPath]: { status: { isRunning: false }, lastRun: null }, [runsPath]: { runs: [] },
    [visitorsPath]: { activeVisitors: 11, todayVisitors: 25, weekVisitors: 73,
      computedAt: '2026-09-21T12:00:00.000Z', collectionStartedAt: '2026-09-21T10:00:00.000Z',
      activeWindowMinutes: 30, timezone: 'Europe/Berlin', identity: 'unique-ip',
      source: 'qualified-http-requests', retentionDays: 30 },
  };
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, queryFn: async ({ queryKey }) => {
    const value = values[String(queryKey[0])]; if (value instanceof Error) throw value; return value;
  } } } });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const value = values[url.split('?')[0]];
    return value instanceof Error ? new Response('Unavailable', { status: 503 }) : Response.json(value ?? null);
  }));
});
afterEach(() => { client.clear(); focusManager.setFocused(undefined); vi.useRealTimers(); vi.unstubAllGlobals(); });
function show() { render(<QueryClientProvider client={client}><Dashboard /></QueryClientProvider>); }

it('exposes real attention queues, last-check information and one keyboard target per quick action', async () => {
  show();
  expect(await screen.findByText('3 open feedback')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /7 unresolved errors/ })).toHaveAttribute('href', '/admin/error-logs');
  expect(screen.getByText(/Last checked/)).toHaveTextContent('cached for up to five minutes');
  const action = screen.getByRole('link', { name: /Manage Stations Add/ });
  expect(action.querySelector('button')).toBeNull();
  const maintenance = screen.getByRole('link', { name: 'Manage', exact: true });
  expect(maintenance.querySelector('button')).toBeNull();
  expect(maintenance.closest('button')).toBeNull();
});

it('refreshes all dashboard panels and recovers partial failures without inventing empty counts', async () => {
  values[languagePath] = new Error('offline'); values[flagPath] = new Error('offline');
  values[statusPath] = new Error('offline'); values[runsPath] = new Error('offline');
  show();
  expect(await screen.findByRole('alert')).toHaveTextContent('language configuration');
  expect(screen.queryByText('No sync runs recorded yet')).not.toBeInTheDocument();
  expect(screen.queryByText('No weekly backfill runs recorded yet.')).not.toBeInTheDocument();
  values[languagePath] = [{ code: 'en' }, { code: 'de' }]; values[flagPath] = { last: null, lastCompleted: null };
  values[statusPath] = { status: { isRunning: false }, lastRun: null }; values[runsPath] = { runs: [] };
  await waitFor(() => expect(screen.getByRole('button', { name: 'Retry panels' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Retry panels' }));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  expect(client.getQueryData([languagePath])).toEqual(values[languagePath]);
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).startsWith(runsPath))).toHaveLength(2);
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === visitorsPath)).toHaveLength(2);
});

it('does not announce a healthy system while the latest sync failed', async () => {
  values[flagPath] = { last: { status: 'failed', autoFlagged: 0 }, lastCompleted: null };
  show(); expect(await screen.findByText('System Degraded')).toBeInTheDocument();
  expect(screen.queryByText('System Online')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Sync needs review/ })).toHaveAttribute('href', '/admin/sync');
});

it('treats unavailable health as unknown rather than falsely offline or healthy', async () => {
  (values[statsPath] as any).health = { database: 'online', radioBrowser: 'online', translations: 'unavailable' };
  show(); expect(await screen.findByText('System status unknown')).toBeInTheDocument();
  expect(screen.queryByText('Empty')).not.toBeInTheDocument();
  expect(screen.getByText('Unknown')).toBeInTheDocument();
});

const visitorLabels = ['Active unique IPs', 'Unique IPs today', 'Unique IPs · last 7 days'];
const cardValue = (label: string) => screen.getByText(label).parentElement!.querySelector('p:nth-child(2)')!;
const visitorRequests = () => vi.mocked(fetch).mock.calls.filter(([url]) => url === visitorsPath).length;

it('uses only unique-IP counts and exposes collection provenance separately from cached catalogue data', async () => {
  Object.assign(values[statsPath] as any, {activeVisitors: 9001, todayVisitors: 9002, weekVisitors: 9003});
  show(); await screen.findByText('11');
  expect(visitorLabels.map(label => cardValue(label).textContent)).toEqual(['11', '25', '73']);
  for (const legacy of ['9001', '9002', '9003']) expect(screen.queryByText(legacy)).not.toBeInTheDocument();
  const section = screen.getByRole('region', {name: 'Visitor and account metrics'});
  expect(within(section).getByText('Last 30 minutes')).toBeInTheDocument();
  expect(within(section).getByText('Today · Europe/Berlin')).toBeInTheDocument();
  expect(section.querySelector('time[datetime="2026-09-21T12:00:00.000Z"]')).toBeInTheDocument();
  expect(section.querySelector('time[datetime="2026-09-21T10:00:00.000Z"]')).toBeInTheDocument();
  expect(section).toHaveTextContent('Source: qualified HTTP requests');
  expect(section).toHaveTextContent('new clean series, without historical backfill');
  expect(section).toHaveTextContent('People sharing an IP count as one');
  expect(section).toHaveTextContent('not verified human counts');
  expect(section).toHaveTextContent('Known bots and admin traffic are excluded');
  expect(cardValue('Registered accounts')).toHaveTextContent('2');
  expect(screen.getByText(/Last checked/)).toHaveTextContent('catalogue statistics may be cached for up to five minutes');
});

it('renders genuine zero counts as zero, not loading or unavailable', async () => {
  Object.assign(values[visitorsPath] as any, {activeVisitors: 0, todayVisitors: 0, weekVisitors: 0});
  show(); await screen.findByText(/Collection started/);
  await waitFor(() => expect(visitorLabels.map(label => cardValue(label).textContent)).toEqual(['0', '0', '0']));
  expect(screen.queryByRole('button', {name: 'Retry visitor metrics'})).not.toBeInTheDocument();
});

it.each([null, {}, {activeVisitors: 5, todayVisitors: 9}, {activeVisitors: -1}, {identity: 'legacy-session'}])(
  'missing or invalid metrics show unavailable dashes, not legacy numbers: %j', async invalid => {
    values[visitorsPath] = invalid && 'identity' in invalid ? {...values[visitorsPath] as any, ...invalid} : invalid;
    Object.assign(values[statsPath] as any, {activeVisitors: 9001, todayVisitors: 9002, weekVisitors: 9003});
    show();
    expect(await screen.findByRole('alert')).toHaveTextContent('Unique-IP metrics are unavailable');
    expect(visitorLabels.map(label => cardValue(label).textContent)).toEqual(['—', '—', '—']);
    expect(screen.getByRole('button', {name: 'Retry visitor metrics'})).toBeEnabled();
    expect(visitorRequests()).toBe(1);
  },
);

it('hides formerly successful values after refresh failure and recovers through a visitor-only retry', async () => {
  const valid = values[visitorsPath];
  show(); await screen.findByText('11');
  values[visitorsPath] = new Error('offline');
  await act(async () => { await client.refetchQueries({queryKey: [visitorsPath]}); });
  expect(await screen.findByRole('alert')).toHaveTextContent('Automatic polling is paused');
  expect(visitorLabels.map(label => cardValue(label).textContent)).toEqual(['—', '—', '—']);
  const historyCalls = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).startsWith(runsPath)).length;
  values[visitorsPath] = valid;
  fireEvent.click(screen.getByRole('button', {name: 'Retry visitor metrics'}));
  await waitFor(() => expect(cardValue('Active unique IPs')).toHaveTextContent('11'));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(visitorRequests()).toBe(3);
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).startsWith(runsPath))).toHaveLength(historyCalls);
});

it('configures a dedicated visible-only 30-second poll, error pause, focus refresh and always-fresh mount', async () => {
  show(); await screen.findByText('11');
  const query = client.getQueryCache().find({queryKey: [visitorsPath]})!;
  const options = query.options as any;
  expect(options.refetchInterval({state: {error: null}})).toBe(30_000);
  expect(options.refetchInterval({state: {error: new Error('offline')}})).toBe(false);
  expect(options.refetchIntervalInBackground).toBe(false);
  expect(options.retry).toBe(false);
  expect(options.refetchOnMount).toBe('always');
  expect(options.refetchOnWindowFocus).toBe(true);
  expect(options.staleTime).toBe(30_000);
});

it('refresh-all includes the unique-IP endpoint without changing the other metric sources', async () => {
  show(); await screen.findByText('11');
  await waitFor(() => expect(screen.getByRole('button', {name: 'Refresh dashboard'})).toBeEnabled());
  values[visitorsPath] = {...values[visitorsPath] as any, activeVisitors: 12};
  fireEvent.click(screen.getByRole('button', {name: 'Refresh dashboard'}));
  await waitFor(() => expect(cardValue('Active unique IPs')).toHaveTextContent('12'));
  expect(visitorRequests()).toBe(2);
  expect(cardValue('Total Stations')).toHaveTextContent('20');
});

it.each([['Active unique IPs', 'active'], ['Unique IPs today', 'today'], ['Unique IPs · last 7 days', 'week']] as const)(
  'opens %s details only on activation and restores keyboard focus after closing', async (label, window) => {
    const user = userEvent.setup();
    const path = '/api/admin/visitor-metrics/details';
    values[path] = visitorDetails({ window });
    show(); await screen.findByText('11');
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).startsWith(path))).toHaveLength(0);
    const trigger = screen.getByRole('button', { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`) });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    trigger.focus(); await user.keyboard('{Enter}');
    await screen.findByText('198.51.100.0/24');
    expect(fetch).toHaveBeenCalledWith(`${path}?window=${window}&page=1&limit=25`, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).startsWith(path))).toHaveLength(1);
  },
);
