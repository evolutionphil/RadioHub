import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../src/lib/queryClient';
import { TooltipProvider } from '../src/components/ui/tooltip';
import IndexNowMonitoring from '../src/pages/admin/IndexNowMonitoring';
import SemrushIssues from '../src/pages/admin/semrush-issues';
import AdminCountryLanguageMappings from '../src/pages/admin/AdminCountryLanguageMappings';
import AdminCoverage from '../src/pages/admin/coverage';
import SeoPreview from '../src/pages/admin/seo-preview';

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { _id: 'admin', role: 'admin' } }) }));
vi.mock('@/hooks/useAdminViewPrefs', () => ({
  useAdminViewPrefs: (_key: string, defaults: unknown) => ({ prefs: defaults, setPrefs: vi.fn(), reset: vi.fn(), loaded: true }),
}));

const network = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
const id = '0123456789abcdef01234567';
const date = '2026-09-14';
const run = {
  date, totalUrls: 2, successfulUrls: 2, failedUrls: 0, submissionCount: 1, submitSuccessCount: 1, submitFailedCount: 0,
  languageBreakdown: [{ language: 'en', urls: 2, successful: 2, failed: 0 }],
  submissions: [{ _id: id, timestamp: `${date}T01:00:00Z`, host: 'themegaradio.com', urlCount: 2, status: 'success', language: 'en', sampleUrls: ['https://themegaradio.com/en'] }],
};
const stats = { totalSubmissions: 1, successfulSubmissions: 1, failedSubmissions: 0, successRate: 100, submissionsToday: 1, averageResponseTime: 50 };
const settings = {
  stored: { thresholdPp: 4, minStations: 25, webhookUrl: null },
  defaults: { thresholdPp: 5, minStations: 20 },
  effective: { thresholdPp: 4, minStations: 25, webhookUrl: null, source: { thresholdPp: 'stored', minStations: 'stored', webhookUrl: 'default' } },
};

function page(element: React.ReactElement) {
  return render(<QueryClientProvider client={queryClient}><TooltipProvider>{element}</TooltipProvider></QueryClientProvider>);
}

beforeEach(() => {
  queryClient.clear();
  queryClient.setDefaultOptions({ ...queryClient.getDefaultOptions(), queries: { ...queryClient.getDefaultOptions().queries, retry: false } });
  sessionStorage.setItem('_mrt_oat', 'test-admin-token');
  network.mockReset();
  vi.stubGlobal('fetch', network);
});

afterEach(() => {
  queryClient.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('authenticates IndexNow reads and lets a failed full-URL request recover without reloading the page', async () => {
  let fullUrlRequests = 0;
  network.mockImplementation(async (url, init) => {
    if (new Headers(init?.headers).get('Authorization') !== 'Bearer test-admin-token') return new Response('', { status: 401 });
    if (url.includes('/submissions/')) {
      if (++fullUrlRequests === 1) return new Response('', { status: 503 });
      return Response.json({ logId: id, urls: ['https://themegaradio.com/en', 'https://themegaradio.com/en/stations'], urlCount: 2 });
    }
    if (url.includes('/sitemap-diff-runs')) return Response.json({ runs: [run], days: 14 });
    if (url.includes('/stats')) return Response.json(stats);
    return Response.json([]);
  });
  page(<IndexNowMonitoring />);
  fireEvent.click(await screen.findByTestId(`button-toggle-run-${date}`));
  fireEvent.click(screen.getByTestId(`button-show-all-urls-${id}`));
  fireEvent.click(await screen.findByRole('button', { name: 'Retry URLs' }));
  expect(await screen.findByTestId(`button-download-urls-${id}`)).toBeVisible();
  expect(fullUrlRequests).toBe(2);
  expect(network.mock.calls.every(([, init]) => init?.credentials === 'include')).toBe(true);
  expect(network.mock.calls.some(([url]) => url.includes('/sitemap-diff-runs?days=14'))).toBe(true);
});

it('does not present failed IndexNow reads as empty submission history or zero statistics', async () => {
  network.mockResolvedValue(new Response('', { status: 503 }));
  page(<IndexNowMonitoring />);
  expect(await screen.findByText('Submission logs unavailable. Retry monitoring data above.')).toBeVisible();
  expect(screen.getAllByText('Unavailable')).toHaveLength(4);
  expect(screen.queryByText('No sitemap-diff runs in the last 14 days.')).not.toBeInTheDocument();
});

it('uploads raw SEMrush CSV with the same admin bearer authentication used by other requests', async () => {
  network.mockImplementation(async url => {
    if (url.endsWith('/import')) return Response.json({ count: 1, message: 'Imported' });
    if (url.endsWith('/summary')) return Response.json({ total: 0, byPriority: [], topIssueTypes: [], lastImportedAt: null, expiresAt: null });
    return Response.json({ total: 0, page: 1, limit: 50, items: [] });
  });
  const { container } = page(<SemrushIssues />);
  const csv = 'URL,Issue,Priority\nhttps://themegaradio.com/en,Missing title,High';
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File([csv], 'issues.csv', { type: 'text/csv' })] } });
  await waitFor(() => expect(network.mock.calls.some(([url]) => url.endsWith('/import'))).toBe(true));
  const [, request] = network.mock.calls.find(([url]) => url.endsWith('/import'))!;
  expect(request).toMatchObject({ method: 'POST', body: csv, credentials: 'include' });
  expect(new Headers(request?.headers).get('Authorization')).toBe('Bearer test-admin-token');
  expect(new Headers(request?.headers).get('Content-Type')).toBe('text/csv');
});

it('uses authenticated API requests for country mapping audit CSV downloads', async () => {
  const createObjectURL = vi.fn(() => 'blob:test-download');
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = createObjectURL;
    static revokeObjectURL = vi.fn();
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  network.mockImplementation(async url => {
    if (url.includes('/all/csv')) return new Response('country,action\nTR,edit', { headers: { 'Content-Type': 'text/csv' } });
    if (url.includes('/cleared-overrides-log')) return Response.json({ entries: [{ id: 'audit-entry', action: 'edit', actorEmail: 'admin@example.com', deletedCount: 0, changes: [], createdAt: `${date}T01:00:00Z` }], total: 1, limit: 25, offset: 0 });
    return Response.json([]);
  });
  page(<AdminCountryLanguageMappings />);
  const download = await screen.findByTestId('button-download-all-audit-csv');
  await waitFor(() => expect(download).toBeEnabled());
  fireEvent.click(download);
  await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
  const [, request] = network.mock.calls.find(([url]) => url.includes('/all/csv'))!;
  expect(new Headers(request?.headers).get('Authorization')).toBe('Bearer test-admin-token');
  expect(request?.credentials).toBe('include');
});

it('recovers coverage settings from an API failure and distinguishes failed audit history from empty history', async () => {
  let settingsReady = false;
  network.mockImplementation(async url => {
    if (url.endsWith('/settings/coverage-drop-alert')) return settingsReady ? Response.json(settings) : new Response('', { status: 503 });
    if (url.includes('/history')) return new Response('', { status: 503 });
    if (url.includes('/by-country')) return Response.json({ countries: [] });
    if (url.includes('/trends')) return Response.json({ trends: {} });
    if (url.includes('/backfill-status')) return Response.json({ status: null, history: [] });
    return Response.json({ alert: null });
  });
  page(<AdminCoverage />);
  const card = await screen.findByTestId('card-coverage-drop-settings');
  expect(await within(card).findByRole('button', { name: 'Retry settings' })).toBeVisible();
  expect(within(card).queryByText('Loading settings…')).not.toBeInTheDocument();
  settingsReady = true;
  fireEvent.click(within(card).getByRole('button', { name: 'Retry settings' }));
  expect(await within(card).findByTestId('input-coverage-drop-threshold')).toHaveValue(4);
  fireEvent.click(within(card).getByRole('button', { name: 'Recent changes' }));
  expect(await within(card).findByText('Settings history could not load.')).toBeVisible();
  fireEvent.click(screen.getByTestId('button-coverage-drop-ack-history-toggle'));
  expect(await screen.findByText('Acknowledgement history could not load.')).toBeVisible();
});

it('shows the rendered Twitter card default and counts x-default separately from language variants', async () => {
  network.mockResolvedValue(Response.json({ seoTags: {
    title: 'Mega Radio', description: 'Listen live', keywords: 'radio', canonical: 'https://themegaradio.com/en',
    ogTitle: 'Mega Radio', ogDescription: 'Listen live', ogType: 'website', ogUrl: 'https://themegaradio.com/en',
    twitterTitle: 'Mega Radio', twitterDescription: 'Listen live',
    hreflangs: [{ hreflang: 'en', url: 'https://themegaradio.com/en' }, { hreflang: 'tr', url: 'https://themegaradio.com/tr' }, { hreflang: 'x-default', url: 'https://themegaradio.com/en' }],
  } }));
  page(<SeoPreview />);
  expect(await screen.findByText('summary_large_image')).toBeVisible();
  expect(screen.getByText('2 Language Versions')).toBeVisible();
  expect(screen.getByText('+ x-default fallback')).toBeVisible();
});
