import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import FooterSocialMediaAdmin from '../src/pages/admin/footer-social-media';
import Settings from '../src/pages/settings';
import AnalyticsPage from '../src/pages/analytics';
import { analyticsParams, analyticsTimestamp } from '../src/lib/admin-analytics';

const toast = vi.hoisted(() => vi.fn());
vi.mock('../src/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
let client: QueryClient;
let request: ReturnType<typeof vi.fn>;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, queryFn: async ({ queryKey }) => {
    const response = await fetch(String(queryKey[0])); if (!response.ok) throw new Error('Unavailable'); return response.json();
  } }, mutations: { retry: false } } });
  request = vi.fn(async () => Response.json([])); vi.stubGlobal('fetch', request); toast.mockReset();
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); });
function mount(page: React.ReactElement) { return render(<QueryClientProvider client={client}>{page}</QueryClientProvider>); }
const social = { _id: 'facebook1', platform: 'facebook', url: 'https://facebook.com/example', isActive: true, position: 3 };
describe('general admin pages', () => {
  it('shows failed social reads as errors, blocks writes and supports retry', async () => {
    request.mockResolvedValueOnce(Response.json({}, { status: 503 })); mount(<FooterSocialMediaAdmin />);
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
    expect(screen.getByRole('button', { name: 'Add Social Media Link' })).toBeDisabled();
    expect(screen.queryByText(/No social media links configured/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(/No social media links configured/)).toBeTruthy();
  });
  it('discarded edits never leak into new links and delete requires explicit confirmation', async () => {
    client.setQueryData(['/api/admin/footer-social-media'], [social]); mount(<FooterSocialMediaAdmin />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit facebook' }));
    expect(screen.getByLabelText('URL')).toHaveValue(social.url);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Social Media Link' }));
    expect(screen.getByLabelText('URL')).toHaveValue(''); expect(screen.getByLabelText('Position (Order)')).toHaveValue(0);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    request.mockClear(); fireEvent.click(screen.getByRole('button', { name: 'Delete facebook' }));
    expect(screen.getByRole('alertdialog')).toBeTruthy(); expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete facebook' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('/api/admin/footer-social-media/facebook1', expect.objectContaining({ method: 'DELETE' })));
  });
  it('keeps failed social edits, blocks duplicate submits and sends the captured ID', async () => {
    client.setQueryData(['/api/admin/footer-social-media'], [social]);
    let resolve!: (response: Response) => void;
    request.mockImplementation((_: unknown, options?: RequestInit) => options?.method === 'PATCH' ? new Promise<Response>(done => { resolve = done; }) : Promise.resolve(Response.json([social])));
    mount(<FooterSocialMediaAdmin />); fireEvent.click(screen.getByRole('button', { name: 'Edit facebook' }));
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://facebook.com/new' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Add Social Media Link' })).toBeDisabled();
    await act(async () => resolve(Response.json({}, { status: 503 })));
    expect(screen.getByLabelText('URL')).toHaveValue('https://facebook.com/new');
    expect(request.mock.calls.filter(call => call[1]?.method === 'PATCH')).toHaveLength(1);
  });
  it('runtime settings use actual routes, never fabricated configuration defaults', async () => {
    request.mockResolvedValue(Response.json({}, { status: 503 })); mount(<Settings />);
    expect(await screen.findByRole('alert')).toHaveTextContent('No settings have been changed');
    expect(screen.queryByRole('button', { name: 'Save Changes' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Manage database' })).toHaveAttribute('href', '/admin/db-management');
    expect(request.mock.calls.every(call => call[0] === '/api/dashboard/stats')).toBe(true);
  });
  it('analytics covers the entire selected day and removes the all filter', () => {
    const day = new Date(2026, 8, 11, 16, 30);
    const params = analyticsParams({ from: day, to: day }, 'all');
    expect(params.has('event')).toBe(false);
    expect(new Date(params.get('startDate')!).getHours()).toBe(0);
    expect(new Date(params.get('endDate')!).getHours()).toBe(23);
    expect(new Date(params.get('endDate')!).getMilliseconds()).toBe(999);
    expect(analyticsParams({ from: day, to: day }, 'play').get('event')).toBe('play');
    expect(analyticsTimestamp('corrupt-import-date')).toBe('Unknown time');
  });
  it('unknown analytics event types and invalid timestamps do not crash the page', async () => {
    request.mockImplementation(async (url: string) => Response.json(url.includes('/summary') ? { totalStations: 3, topCountries: [], topGenres: [] } : [{ _id: 'e1', event: 'new_event_type', timestamp: 'bad', stationId: 'station1' }]));
    mount(<AnalyticsPage />); expect(await screen.findByText('new_event_type')).toBeTruthy(); expect(screen.getByText('Unknown time')).toBeTruthy();
    expect(request.mock.calls.find(call => String(call[0]).includes('/api/analytics?'))?.[0]).not.toContain('event=all');
  });
});
