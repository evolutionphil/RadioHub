import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
vi.mock('@/lib/queryClient', () => ({ apiFetch: (url: string, init?: RequestInit) => fetch(url, init) }));
import { VisitorDetailsDialog } from '../src/pages/admin/VisitorDetailsDialog';
import { automatedActivityId, automatedVisitors, qualifiedActivityId, secondActivityId, visitorActivity } from './fixtures/visitor-activity';
import { visitorDetails } from './fixtures/visitor-details';

let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const parsed = new URL(url, 'https://local.test');
    if (parsed.pathname.includes('/activity/')) {
      const id = parsed.pathname.split('/').pop()!;
      const payload = visitorActivity({ activityId: id, trafficKind: id === automatedActivityId ? 'automated' : 'qualified' });
      if (id === automatedActivityId) payload.events.forEach(event => { event.automationStatus = 'automated'; });
      return Response.json(payload);
    }
    if (parsed.pathname.endsWith('/automated')) return Response.json(automatedVisitors());
    const payload = visitorDetails(); payload.visitors[0].activityId = qualifiedActivityId;
    payload.visitors.push({ ...payload.visitors[0], activityId: secondActivityId, maskedIp: '192.0.2.0/24' });
    return Response.json(payload);
  }));
});
afterEach(() => { client.clear(); vi.unstubAllGlobals(); });
function show() { return render(<QueryClientProvider client={client}><VisitorDetailsDialog initialWindow="active" onClose={vi.fn()} /></QueryClientProvider>); }
async function openFirst() { show(); fireEvent.click(await screen.findByRole('button', { name: 'View activity for 198.51.100.0/24, visitor 1' })); }

it('fetches history only after selection, uses one accessible modal, and renders safe text with sampling caveats', async () => {
  show(); await screen.findByText('198.51.100.0/24'); expect(fetch).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'View activity for 198.51.100.0/24, visitor 1' }));
  expect(await screen.findByText('/de/station/kronehit-radio')).toBeInTheDocument();
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(screen.getByRole('heading', { name: 'Observed activity' })).toHaveFocus();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  expect(screen.getByText(/Only a bounded, best-effort sample/)).toHaveTextContent('last 7 days');
  expect(screen.getByText(/Shared IPs, including NAT/)).toHaveTextContent('purpose or intent');
  expect(screen.getByText(/Automation labels are evidence/)).toHaveTextContent('not proof');
  expect(screen.queryByText(qualifiedActivityId)).not.toBeInTheDocument();
  expect(String(vi.mocked(fetch).mock.lastCall![0])).toContain(`/activity/${qualifiedActivityId}?limit=50`);
});

it('paginates older events with opaque cursors and resets the cursor for a different visitor', async () => {
  await openFirst(); await screen.findByText('/de/station/kronehit-radio');
  const payload = visitorActivity({ nextCursor: null }); payload.events[0].path = '/de/genres/rock';
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(payload));
  fireEvent.click(screen.getByRole('button', { name: 'Older activity' }));
  await screen.findByText('/de/genres/rock'); expect(String(vi.mocked(fetch).mock.lastCall![0])).toContain('before=older-cursor');
  expect(screen.getByRole('button', { name: 'Older activity' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Back to visitors' }));
  fireEvent.click(await screen.findByRole('button', { name: 'View activity for 192.0.2.0/24, visitor 2' }));
  await screen.findByText('/de/station/kronehit-radio');
  expect(String(vi.mocked(fetch).mock.lastCall![0])).toBe(`/api/admin/visitor-metrics/activity/${secondActivityId}?limit=50`);
  expect(screen.queryByText('/de/genres/rock')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Newer activity' })).toBeDisabled();
});

it('clears events while another page loads or fails, retries without showing a different subject', async () => {
  await openFirst(); await screen.findByText('/de/station/kronehit-radio');
  let resolve!: (response: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
  fireEvent.click(screen.getByRole('button', { name: 'Older activity' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Loading visitor activity');
  expect(screen.queryByText('/de/station/kronehit-radio')).not.toBeInTheDocument();
  await act(async () => resolve(Response.json(visitorActivity({ activityId: secondActivityId }))));
  expect(await screen.findByRole('alert')).toHaveTextContent('mismatched data');
  fireEvent.click(screen.getByRole('button', { name: 'Retry visitor activity' }));
  await screen.findByText('/de/station/kronehit-radio');
  vi.mocked(fetch).mockResolvedValueOnce(new Response('Expired', { status: 404 }));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh activity' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('may have expired');
  expect(screen.queryByRole('list', { name: 'Observed events' })).not.toBeInTheDocument();
});

it('shows genuine empty history and does not offer history for uncollected legacy rows', async () => {
  const payload = visitorDetails(); payload.visitors[0].activityId = null;
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(payload));
  const view = show(); await screen.findByText(/Activity history has not been collected/);
  expect(screen.queryByRole('button', { name: /View activity/ })).not.toBeInTheDocument(); view.unmount(); client.clear();
  await openFirst(); await screen.findByText('/de/station/kronehit-radio');
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(visitorActivity({ events: [], nextCursor: null })));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh activity' }));
  expect(await screen.findByRole('status')).toHaveTextContent('No retained activity');
  expect(screen.getByRole('button', { name: 'Older activity' })).toBeDisabled();
});

it('loads automated diagnostics separately, opens its own activity identity, and preserves qualified filters', async () => {
  show(); await screen.findByText('198.51.100.0/24');
  fireEvent.click(screen.getByRole('button', { name: 'Automated traffic', exact: true }));
  const list = await screen.findByRole('list', { name: 'Sampled automated visitors' });
  expect(list).toHaveTextContent('203.0.113.0/24'); expect(screen.queryByText('198.51.100.0/24')).not.toBeInTheDocument();
  expect(screen.getByText(/Separate diagnostics/)).toHaveTextContent('not the qualified visitor list');
  expect(String(vi.mocked(fetch).mock.lastCall![0])).toBe('/api/admin/visitor-metrics/automated?limit=25');
  fireEvent.click(within(list).getByRole('button', { name: /View activity/ }));
  await screen.findByText('/de/station/kronehit-radio');
  expect(screen.getByText(/Automated traffic sample/)).toBeInTheDocument();
  expect(String(vi.mocked(fetch).mock.lastCall![0])).toContain(automatedActivityId);
  fireEvent.click(screen.getByRole('button', { name: 'Back to automated traffic' }));
  await screen.findByRole('list', { name: 'Sampled automated visitors' });
  fireEvent.click(screen.getByRole('button', { name: 'Qualified visitors', exact: true }));
  await screen.findByText('198.51.100.0/24');
});

it('handles automated failures, retry, and empty diagnostics without implying zero bots', async () => {
  show(); await screen.findByText('198.51.100.0/24');
  vi.mocked(fetch).mockResolvedValueOnce(new Response('No', { status: 403 }));
  fireEvent.click(screen.getByRole('button', { name: 'Automated traffic', exact: true }));
  expect(await screen.findByRole('alert')).toHaveTextContent('administrator session');
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(automatedVisitors({ visitors: [] })));
  fireEvent.click(screen.getByRole('button', { name: 'Retry automated traffic' }));
  expect(await screen.findByRole('status')).toHaveTextContent('does not establish that no bots visited');
});

it('aborts selected-history requests on back navigation, so a late response cannot leak across visitors', async () => {
  show(); await screen.findByText('198.51.100.0/24');
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(() => {}));
  fireEvent.click(screen.getByRole('button', { name: 'View activity for 198.51.100.0/24, visitor 1' }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  const signal = vi.mocked(fetch).mock.lastCall![1]?.signal as AbortSignal;
  expect(signal.aborted).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Back to visitors' }));
  expect(signal.aborted).toBe(true);
  expect(await screen.findByText('198.51.100.0/24')).toBeInTheDocument();
});
