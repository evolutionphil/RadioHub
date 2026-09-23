import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
vi.mock('@/lib/queryClient', () => ({ apiFetch: (url: string, init?: RequestInit) => fetch(url, init) }));
import { VisitorDetailsDialog } from '../src/pages/admin/VisitorDetailsDialog';
import type { VisitorWindow } from '../src/lib/admin-visitor-details';
import { visitorDetails } from './fixtures/visitor-details';

let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const params = new URL(url, 'https://local.test').searchParams;
    const payload = visitorDetails({ window: params.get('window') as VisitorWindow });
    payload.pagination.page = Number(params.get('page'));
    if (payload.pagination.page === 2) payload.visitors[0].maskedIp = '203.0.113.0/24';
    return Response.json(payload);
  }));
});
afterEach(() => { client.clear(); vi.unstubAllGlobals(); });
function show(initialWindow: VisitorWindow = 'active') {
  return render(<QueryClientProvider client={client}><VisitorDetailsDialog initialWindow={initialWindow} onClose={vi.fn()} /></QueryClientProvider>);
}
const lastParams = () => new URL(String(vi.mocked(fetch).mock.lastCall![0]), 'https://local.test').searchParams;

it('shows masked records, unfiltered breakdowns, Berlin provenance and careful attribution', async () => {
  show();
  expect(await screen.findByText('198.51.100.0/24')).toBeInTheDocument();
  expect(screen.getByRole('dialog', { name: 'Visitor details' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Countries breakdown' })).toHaveTextContent('Unknown country');
  expect(screen.getByText(/Breakdowns cover the entire selected window/)).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Visitor records' })).toHaveTextContent('Desktop browser');
  expect(screen.getByText(/Unique IPs, not verified people/)).toBeInTheDocument();
  expect(screen.getByText(/Country and client metadata started/)).toHaveTextContent('23 Sept 2026');
  expect(screen.getByText(/Client headers are self-reported/)).toHaveTextContent('do not distinguish a built-in TV browser');
  expect(screen.getByRole('option', { name: 'Samsung Tizen' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'LG webOS' })).toBeInTheDocument();
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  const options = client.getQueryCache().findAll()[0].options as any;
  expect(options.refetchInterval).toBeUndefined(); expect(options.retry).toBe(false);
  expect(options.refetchOnWindowFocus).toBe(false);
});

it('resets pagination on filters, keeps breakdowns unfiltered and resets all filters on a new window', async () => {
  show(); await screen.findByText('198.51.100.0/24');
  fireEvent.click(screen.getByRole('button', { name: 'Next', exact: true }));
  await screen.findByText('203.0.113.0/24'); expect(lastParams().get('page')).toBe('2');
  fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'DE' } });
  await screen.findByText('198.51.100.0/24'); expect(lastParams().get('page')).toBe('1'); expect(lastParams().get('country')).toBe('DE');
  expect(screen.getByRole('region', { name: 'Countries breakdown' })).toHaveTextContent('Unknown country');
  fireEvent.change(screen.getByLabelText('Platform'), { target: { value: 'tizen' } });
  await screen.findByText('198.51.100.0/24'); expect(lastParams().get('platform')).toBe('tizen');
  fireEvent.change(screen.getByLabelText('Device type'), { target: { value: 'tv' } });
  await screen.findByText('198.51.100.0/24'); expect(lastParams().get('deviceType')).toBe('tv');
  fireEvent.click(screen.getByRole('button', { name: 'Last 7 days', exact: true }));
  await screen.findByText('198.51.100.0/24'); expect(Object.fromEntries(lastParams())).toEqual({ window: 'week', page: '1', limit: '25' });
  expect(screen.getByLabelText('Country')).toHaveValue('all'); expect(screen.getByLabelText('Platform')).toHaveValue('all'); expect(screen.getByLabelText('Device type')).toHaveValue('all');
});

it('removes prior records while a new filter loads and on failure, then supports manual retry', async () => {
  show(); await screen.findByText('198.51.100.0/24');
  let resolve!: (response: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
  fireEvent.change(screen.getByLabelText('Platform'), { target: { value: 'ios' } });
  expect(await screen.findByRole('status')).toHaveTextContent('Loading visitor details');
  expect(screen.queryByText('198.51.100.0/24')).not.toBeInTheDocument();
  await act(async () => resolve(new Response('Unavailable', { status: 503 })));
  expect(await screen.findByRole('alert')).toHaveTextContent('No previous visitor rows are displayed');
  expect(screen.queryByRole('list', { name: 'Masked visitors' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry visitor details' }));
  await screen.findByText('198.51.100.0/24'); expect(lastParams().get('platform')).toBe('ios');
});

it('hides cached successful rows on refresh failure and never prints incomplete/raw identifiers', async () => {
  show(); await screen.findByText('198.51.100.0/24');
  vi.mocked(fetch).mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh details' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('An administrator session is required');
  expect(screen.queryByText('198.51.100.0/24')).not.toBeInTheDocument();
  const payload = visitorDetails(); payload.visitors[0].maskedIp = '198.51.100.123';
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(payload));
  fireEvent.click(screen.getByRole('button', { name: 'Retry visitor details' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('incomplete data');
  expect(screen.queryByText('198.51.100.123')).not.toBeInTheDocument();
});

it('renders genuine empty filters without inventing visitors and keeps navigation bounded', async () => {
  show(); await screen.findByText('198.51.100.0/24');
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(visitorDetails({ matchedVisitors: 0, visitors: [], pagination: { page: 1, limit: 25, total: 0, totalPages: 0 } })));
  fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'unknown' } });
  expect(await screen.findByText('No unique IPs match these filters.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Previous', exact: true })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Clear visitor filters' }));
  await screen.findByText('198.51.100.0/24');
  expect(screen.getByLabelText('Country')).toHaveValue('all');
  expect(screen.queryByRole('button', { name: 'Clear visitor filters' })).not.toBeInTheDocument();
  // The matching, still-fresh 15-second cache can be reused without another request.
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('preserves separate IP rows when privacy masking produces the same network', async () => {
  const payload = visitorDetails(); payload.visitors.push({ ...payload.visitors[0], platform: 'desktop', channel: 'app', contextSource: 'client-header' });
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(payload));
  show(); await screen.findByText('Desktop browser');
  const rows = screen.getByRole('list', { name: 'Masked visitors' });
  expect(within(rows).getAllByRole('listitem')).toHaveLength(2);
  expect(within(rows).getByText('Desktop app')).toBeInTheDocument();
  expect(within(rows).getByText('Self-reported client header')).toBeInTheDocument();
});

it('allows returning to page one when activity expires after advancing a page', async () => {
  show(); await screen.findByText('198.51.100.0/24');
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(visitorDetails({ visitors: [], matchedVisitors: 1, pagination: { page: 2, limit: 25, total: 1, totalPages: 1 } })));
  fireEvent.click(screen.getByRole('button', { name: 'Next', exact: true }));
  expect(await screen.findByText('No visitor rows on this page. Return to the first page.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'First page' }));
  await screen.findByText('198.51.100.0/24'); expect(screen.getByText('Page 1 of 2 · 25 IPs per page')).toBeInTheDocument();
});

it('aborts an in-flight details request when the dialog unmounts', async () => {
  vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
  const view = show(); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  const signal = vi.mocked(fetch).mock.lastCall![1]?.signal as AbortSignal;
  expect(signal.aborted).toBe(false); view.unmount(); expect(signal.aborted).toBe(true);
});
