import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mocks = vi.hoisted(() => ({ request: vi.fn(), fetch: vi.fn(), toast: vi.fn() }));
vi.mock('@/lib/queryClient', () => ({ apiRequest: mocks.request, apiFetch: mocks.fetch }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));

import AdminStationSlugs from '../src/pages/admin-station-slugs';
import AdminGenres from '../src/pages/admin/admin-genres';
import LogoManagement from '../src/pages/admin/logo-management';

let client: QueryClient;
let values: Record<string, unknown>;
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const slugJob = { jobId: 'slug-job', status: 'running', progress: { current: 2, total: 8 }, startedAt: '2026-09-15T10:00:00Z' };
function mount(element: React.ReactElement) {
  return render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  window.history.replaceState({}, '', '/admin/station-slugs');
  values = {
    '/api/admin/station-slugs/status': { totalStations: 10, stationsWithSlugs: 5, stationsWithoutSlugs: 5, completionPercentage: 50 },
    '/api/admin/station-slugs/job-status': null,
    '/api/admin/logos/stats': { totalStations: 50, stationsWithFavicon: 50, stationsWithSlug: 50, stationsWithLogoAssets: 50, stationsFailed: 0, stationsNeedingProcessing: 0, stationsWithoutLogo: 0, stationsNoFavicon: 0, processingComplete: true, s3Configured: false },
    '/api/admin/logos/storage-health': null,
    '/api/admin/logos/active-job': { hasActiveJob: false },
    '/api/admin/logos/optimized': { total: 0, stations: [] },
  };
  client = new QueryClient({ defaultOptions: { queries: { retry: false, queryFn: async ({ queryKey }) => {
    const value = values[String(queryKey[0])];
    if (value instanceof Error) throw value;
    if (value === undefined) throw new Error(`Unexpected query ${queryKey[0]}`);
    return value;
  } }, mutations: { retry: false } } });
  mocks.request.mockImplementation(async (_method: string, url: string) => {
    if (url.endsWith('/failed')) return json({ totalFailed: 0, countsByType: {}, rows: [] });
    if (url.includes('/logos/failed?')) return json({ totalFailed: 0, countsByType: {}, rows: [] });
    if (url === '/api/generate-all-slugs') return json(slugJob);
    throw new Error(`Unexpected request ${url}`);
  });
});
afterEach(() => { client.clear(); vi.unstubAllGlobals(); });

describe('slug maintenance job lifecycle', () => {
  it('parses the start Response and displays subsequent progress and completion for the same job id', async () => {
    mount(<AdminStationSlugs />);
    const start = await screen.findByTestId('button-generate-slugs');
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);
    expect(await screen.findByText('Running')).toBeInTheDocument();
    expect(screen.getByText(/2 \/ 8/)).toBeInTheDocument();
    await act(async () => client.setQueryData(['/api/admin/station-slugs/job-status'], { ...slugJob, progress: { current: 6, total: 8 } }));
    expect(await screen.findByText(/6 \/ 8/)).toBeInTheDocument();
    await act(async () => client.setQueryData(['/api/admin/station-slugs/job-status'], { ...slugJob, status: 'completed', progress: { current: 8, total: 8 } }));
    expect(await screen.findByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('Entities Processed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop Generation' })).not.toBeInTheDocument();
    expect(mocks.request).toHaveBeenCalledOnce();
    expect(mocks.request).toHaveBeenCalledWith('POST', '/api/generate-all-slugs');
  });

  it('recovers a running job on entry, surfaces stop failures and allows restarting a stopped job', async () => {
    values['/api/admin/station-slugs/job-status'] = slugJob;
    mocks.request.mockRejectedValue(new Error('503: stop unavailable'));
    mount(<AdminStationSlugs />);
    fireEvent.click(await screen.findByRole('button', { name: 'Stop Generation' }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Could not stop generation', description: '503: stop unavailable' })));
    expect(screen.getByText('Running')).toBeInTheDocument();
    await act(async () => client.setQueryData(['/api/admin/station-slugs/job-status'], { ...slugJob, status: 'stopped' }));
    expect(await screen.findByText('Stopped')).toBeInTheDocument();
    expect(screen.getByTestId('button-generate-slugs')).toBeEnabled();
    expect(screen.queryByText('Regenerate All Slugs')).not.toBeInTheDocument();
  });

  it('blocks generation when job status cannot be verified and retries the failed read', async () => {
    values['/api/admin/station-slugs/job-status'] = new Error('503');
    mount(<AdminStationSlugs />);
    expect(await screen.findByText('Unable to load slug statistics or generation status.')).toBeInTheDocument();
    expect(screen.queryByTestId('button-generate-slugs')).not.toBeInTheDocument();
    const query = client.getQueryCache().find({ queryKey: ['/api/admin/station-slugs/job-status'] })!;
    expect((query.options as any).refetchInterval(query)).toBe(false);
    values['/api/admin/station-slugs/job-status'] = null;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId('button-generate-slugs')).toBeEnabled();
    expect(mocks.request).not.toHaveBeenCalled();
  });
});

describe('genre editing and loading', () => {
  it('preserves the existing poster when editing unrelated genre fields', async () => {
    const genre = { _id: 'rock', name: 'Rock', slug: 'rock', stationCount: 2, posterImage: 'https://images.example/rock.webp' };
    mocks.fetch.mockImplementation(async (_url: string, init?: RequestInit) => json(init?.method === 'PUT' ? genre : { data: [genre], total: 1, totalPages: 1 }));
    mount(<AdminGenres />);
    fireEvent.click(await screen.findByTitle('Edit genre'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Rock Radio' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Update Genre' }));
    await waitFor(() => {
      const call = mocks.fetch.mock.calls.find(([, init]) => init?.method === 'PUT');
      expect(call).toBeDefined();
      expect(JSON.parse(call![1].body)).toMatchObject({ name: 'Rock Radio', posterImage: genre.posterImage });
    });
  });

  it('reports failed genre requests without presenting a zero-row catalog', async () => {
    mocks.fetch.mockResolvedValue(new Response('Service unavailable', { status: 503 }));
    mount(<AdminGenres />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load genres');
    expect(screen.queryByText(/Showing 0 of 0/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry genres' })).toBeInTheDocument();
  });

  it('waits for an uploaded image before saving the genre', async () => {
    const genre = { _id: 'rock', name: 'Rock', slug: 'rock', stationCount: 2, isDiscoverable: true };
    let finishUpload!: (value: Response) => void;
    mocks.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/upload/')) return new Promise<Response>(resolve => { finishUpload = resolve; });
      return json(init?.method === 'PUT' ? genre : { data: [genre], total: 1, totalPages: 1 });
    });
    mount(<AdminGenres />);
    fireEvent.click(await screen.findByTitle('Edit genre'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Discoverable Genre Image'), { target: { files: [new File(['image'], 'rock.png', { type: 'image/png' })] } });
    expect(await within(dialog).findByRole('button', { name: 'Uploading image...' })).toBeDisabled();
    expect(mocks.fetch.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
    await act(async () => finishUpload(json({ url: 'https://images.example/uploaded.webp' })));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Update Genre' }));
    await waitFor(() => {
      const call = mocks.fetch.mock.calls.find(([, init]) => init?.method === 'PUT');
      expect(JSON.parse(call![1].body)).toMatchObject({ discoverableImage: 'https://images.example/uploaded.webp' });
    });
  });
});

describe('logo list drill-downs', () => {
  it('stops optimized pagination at an exactly full final page', async () => {
    values['/api/admin/logos/optimized'] = { total: 50, stations: Array.from({ length: 50 }, (_, i) => ({ _id: `station-${i}`, name: `Station ${i}`, slug: `station-${i}` })) };
    mount(<LogoManagement />);
    fireEvent.click(await screen.findByTestId('card-optimized-logos'));
    await screen.findByText('Station 0');
    expect(screen.getByRole('button', { name: 'Next optimized logos page' })).toBeDisabled();
    expect(screen.getByText('Page 1 of 1')).toBeInTheDocument();
  });

  it('distinguishes failed optimized and missing-logo reads from empty results', async () => {
    values['/api/admin/logos/optimized'] = new Error('503');
    const view = mount(<LogoManagement />);
    fireEvent.click(await screen.findByTestId('card-optimized-logos'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load optimized station logos');
    expect(screen.queryByText('No optimized stations found')).not.toBeInTheDocument();
    view.unmount();
    mount(<LogoManagement />);
    fireEvent.click(await screen.findByTestId('card-missing-logos'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load stations with missing logos');
    expect(screen.getByRole('button', { name: 'Retry missing logos' })).toBeInTheDocument();
    expect(screen.queryByText('Bu filtreyle eşleşen istasyon yok.')).not.toBeInTheDocument();
  });
});
