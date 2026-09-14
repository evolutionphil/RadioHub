import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
vi.mock('wouter', () => ({ Link: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a> }));
vi.mock('@/lib/queryClient', () => ({ apiFetch: (url: string, init?: RequestInit) => fetch(url, init) }));
import Dashboard from '../src/pages/admin/dashboard';

let client: QueryClient;
let values: Record<string, unknown>;
const statsPath = '/api/dashboard/stats';
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
  };
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, queryFn: async ({ queryKey }) => {
    const value = values[String(queryKey[0])]; if (value instanceof Error) throw value; return value;
  } } } });
  vi.stubGlobal('fetch', vi.fn(async () => values[runsPath] instanceof Error
    ? new Response('Unavailable', { status: 503 }) : Response.json(values[runsPath])));
});
afterEach(() => { client.clear(); vi.unstubAllGlobals(); });
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
  expect(fetch).toHaveBeenCalledTimes(2);
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
