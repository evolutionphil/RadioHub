import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { queryClient, getQueryFn } from '../src/lib/queryClient';
import Performance from '../src/pages/admin/performance';

vi.mock('../src/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
const empty = { p50: null, p75: null, p95: null, status: 'no_data' };
const vitals = { status: 'configuration_required', message: 'Verify the account ID and Account Analytics Read access.', hosts: ['themegaradio.com', 'www.themegaradio.com'], period: { start: '2026-09-04T12:00:00Z', end: '2026-09-11T12:00:00Z' }, lcp: empty, inp: empty, cls: empty, estimatedPageViews: null, lastUpdated: '2026-09-11T12:00:00Z' };
const metrics = { databaseStats: { totalStations: 100, totalCountries: 3, totalGenres: 10, indexesCount: 4, dbSize: '10 MB' }, systemHealth: { memoryUsage: 20, cpuUsage: null, connectionPool: 2 }, optimizationSuggestions: [] };
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  queryClient.clear(); queryClient.setDefaultOptions({ queries: { retry: false, staleTime: Infinity, gcTime: Infinity, queryFn: getQueryFn({ on401: 'throw' }) } });
  queryClient.setQueryData(['/api/admin/performance/metrics'], metrics);
  fetchMock = vi.fn(async () => Response.json(vitals)); vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); queryClient.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function mount() { render(<QueryClientProvider client={queryClient}><Performance /></QueryClientProvider>); }
it('shows actionable configuration without a false site outage or invented zero measurements', async () => {
  mount(); const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Analytics configuration required'); expect(alert).toHaveTextContent('Account Analytics Read');
  expect(alert).toHaveTextContent('does not mean the radio website is down');
  expect(screen.queryByText('Web Vitals could not be loaded.')).toBeNull(); expect(screen.queryByText('0ms')).toBeNull();
  expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(9);
  expect(screen.getByText(/Scope: themegaradio.com/)).toBeInTheDocument();
  expect(fetchMock.mock.calls.every(call => call[1]?.method === 'GET')).toBe(true);
});
it('renders real percentiles without painting P50 as always good or P95 as always bad, and locks refresh while pending', async () => {
  fetchMock.mockResolvedValue(Response.json({ ...vitals, status: 'available', lcp: { p50: 4000, p75: 5000, p95: 6000, status: 'poor' }, estimatedPageViews: 100 }));
  mount(); expect(await screen.findByText('5000ms')).toBeInTheDocument(); expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByText('P50 (Good)')).toBeNull(); expect(screen.queryByText('P95 (Check)')).toBeNull();
  expect(screen.getByText('4000ms')).not.toHaveClass('text-green-600'); expect(screen.getByText('6000ms')).not.toHaveClass('text-red-600');
  fetchMock.mockImplementation((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted')))));
  const refresh = screen.getByRole('button', { name: 'Refresh Web Vitals' }); fireEvent.click(refresh);
  await waitFor(() => expect(refresh).toBeDisabled());
});
