import React from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn(), toast: vi.fn(), client: null as any }));
vi.mock('@/lib/queryClient', () => ({ apiRequest: (...args: any[]) => mocks.apiRequest(...args), queryClient: {
  invalidateQueries: (...args: any[]) => mocks.client.invalidateQueries(...args),
  setQueryData: (...args: any[]) => mocks.client.setQueryData(...args),
}, resolveApiUrl: (path: string) => path, API_BASE: '' }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }), toast: (...args: any[]) => mocks.toast(...args) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { _id: 'test-admin', role: 'admin' }, isAuthenticated: true, isLoading: false }) }));
vi.mock('@/hooks/useAdminViewPrefs', async () => {
  const React = await import('react');
  return { useAdminViewPrefs: (_key: string, defaults: any) => {
    const [prefs, setPrefs] = React.useState(defaults);
    return { prefs, setPrefs, clearLocal: () => {}, reset: () => setPrefs(defaults), loaded: true };
  } };
});
// Native select test adapter exercises page state without Radix layout/pointer simulation.
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children, ...props }: any) => <select value={value} onChange={event => onValueChange(event.target.value)} data-testid={props['data-testid']}>{children}</select>,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
  SelectTrigger: () => null, SelectValue: () => null,
}));

import AdminTranslations from '../src/pages/admin/translations';
import AdminTranslationLanguages from '../src/pages/admin/translation-languages';
import AdminUrlTranslations from '../src/pages/admin/AdminUrlTranslations';
import AdminCountryLanguageMappings from '../src/pages/admin/AdminCountryLanguageMappings';
import SeoPreview from '../src/pages/admin/seo-preview';
import AdminGenres from '../src/pages/admin/admin-genres';
import GscInspection from '../src/pages/admin/gsc-inspection';
import IndexNowMonitoring from '../src/pages/admin/IndexNowMonitoring';

let data: Record<string, any>;
let qc: QueryClient;
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
function show(component: React.ReactElement) {
  return render(<QueryClientProvider client={qc}><TooltipProvider>{component}</TooltipProvider></QueryClientProvider>);
}
function selectWith(value: string) {
  return screen.getAllByRole('combobox').find(el => [...(el as HTMLSelectElement).options].some(option => option.value === value))!;
}
beforeEach(() => {
  mocks.apiRequest.mockReset(); mocks.toast.mockClear();
  mocks.apiRequest.mockResolvedValue(json({}));
  sessionStorage.clear(); localStorage.clear(); window.history.replaceState({}, '', '/admin/translations');
  data = {
    '/api/admin/auth/me': { authenticated: true, user: { _id: 'test-admin' } },
    '/api/admin/translation-metadata': { languagesVersion: 0 },
    '/api/admin/translation-keys': [{ _id: 'key-a', key: 'hello_key', defaultValue: 'Hello', category: 'general' }],
    '/api/admin/translation-languages': [{ _id: 'de', code: 'de', name: 'German', isEnabled: true, completionPercentage: 100 }, { _id: 'tr', code: 'tr', name: 'Turkish', isEnabled: true, completionPercentage: 0 }],
    '/api/admin/all-translations': [{ _id: 'translation-a', keyId: 'key-a', language: 'de', value: 'Hallo', isCompleted: true }],
    '/api/admin/url-translations/available-paths': ['genres'],
    '/api/admin/url-translations': [{ languageCode: 'de', englishPath: 'genres', translatedPath: 'musik', isActive: true }],
    '/api/admin/available-countries': [{ code: 'AT', name: 'Austria' }],
    '/api/admin/available-languages': [{ code: 'de', name: 'German' }, { code: 'tr', name: 'Turkish' }],
    '/api/admin/country-language-mappings': [{ countryCode: 'AT', countryName: 'Austria', languageCode: 'tr' }],
    '/api/admin/country-language-defaults': [{ countryCode: 'AT', languageCode: 'de' }],
    '/api/admin/country-language-mappings/cleared-overrides-log': { entries: [], total: 0, limit: 25, offset: 0 },
  };
  vi.stubGlobal('fetch', vi.fn(async (input: any) => {
    const value = data[String(input).split('?')[0]];
    if (value instanceof Error) return new Response(value.message, { status: 503 });
    if (value === undefined) throw new Error(`Unexpected test fetch ${input}`);
    return json(value);
  }));
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: 0, queryFn: async ({ queryKey }) => {
    const value = data[String(queryKey[0])];
    if (value instanceof Error) throw value;
    if (value === undefined) throw new Error(`Unexpected query ${queryKey[0]}`);
    return value;
  } }, mutations: { retry: false } } });
  mocks.client = qc;
});
afterEach(() => { qc.clear(); vi.unstubAllGlobals(); });

describe('content administration regressions', () => {
  it('calculates key completion across all translations and saves the original draft language even after switching to all', async () => {
    show(<AdminTranslations />);
    await screen.findByText('hello_key');
    await screen.findByText('50%');
    fireEvent.change(selectWith('de'), { target: { value: 'de' } });
    fireEvent.click(await screen.findByText('Hallo'));
    fireEvent.change(screen.getByPlaceholderText('Enter translation...'), { target: { value: 'Guten Tag' } });
    fireEvent.change(selectWith('tr'), { target: { value: 'tr' } });
    fireEvent.click(await screen.findByText('Click to add translation'));
    fireEvent.change(screen.getByPlaceholderText('Enter translation...'), { target: { value: 'Merhaba' } });
    fireEvent.change(selectWith('de'), { target: { value: 'all' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save All Changes' }));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith('POST', '/api/admin/translations/bulk-upsert', { body: { translations: [
      { keyId: 'key-a', language: 'de', value: 'Guten Tag', isCompleted: true },
      { keyId: 'key-a', language: 'tr', value: 'Merhaba', isCompleted: true },
    ] } }));
  });

  it('parses language sync response statistics instead of treating Response as data', async () => {
    mocks.apiRequest.mockResolvedValue(json({ stats: { created: 3, skipped: 11 } }));
    show(<AdminTranslationLanguages />);
    fireEvent.click(screen.getByRole('button', { name: /Sync All 55 Languages/i }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Success', description: 'Synced 3 new languages (11 already existed)' })));
  });

  it('does not navigate to page zero for an empty translation search', async () => {
    show(<AdminTranslations />);
    await screen.findByText('hello_key');
    fireEvent.change(screen.getByPlaceholderText('Search keys or values...'), { target: { value: 'nothing-matches' } });
    expect(screen.getByRole('button', { name: 'Next translation page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous translation page' })).toBeDisabled();
  });

  it('counts enabled English source values without requiring generated English rows', async () => {
    data['/api/admin/translation-languages'].push({ _id: 'en', code: 'en', name: 'English', isEnabled: true, completionPercentage: 100 });
    show(<AdminTranslations />);
    await screen.findByText('67%');
  });

  it('uses the actual frontend scan and FAQ response count fields', async () => {
    mocks.apiRequest.mockImplementation(async (_method: string, path: string) => json(path.includes('scan-frontend') ? { added: 7, existing: 10 } : { added: 4, existing: 8 }));
    show(<AdminTranslations />);
    await screen.findByText('hello_key');
    fireEvent.click(screen.getByRole('button', { name: 'Check New Parameters' }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ description: 'Found 7 new translation keys' })));
    fireEvent.click(screen.getByRole('button', { name: /Add FAQ Keys/ }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ description: 'Added 4 new FAQ translation keys. You can now translate them!' })));
  });

  it('parses language translation result and prevents requests for disabled/source languages', async () => {
    data['/api/admin/translation-languages'].push({ _id: 'en', code: 'en', name: 'English', isEnabled: true }, { _id: 'fr', code: 'fr', name: 'French', isEnabled: false });
    mocks.apiRequest.mockResolvedValue(json({ stats: { translated: 4, failed: 0 }, message: 'German' }));
    show(<AdminTranslationLanguages />);
    expect(await screen.findByRole('button', { name: 'Translate English' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Translate French' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Translate German' }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Translation Complete', description: 'Translated 4 keys for German. Failed: 0' })));
  });

  it('shows an empty URL draft faithfully and rejects saving it instead of restoring an old value', async () => {
    show(<AdminUrlTranslations />);
    fireEvent.change(await screen.findByTestId('select-language'), { target: { value: 'de' } });
    expect(screen.getByRole('heading', { level: 1, name: 'URL Translations Manager' })).toBeInTheDocument();
    const input = await screen.findByDisplayValue('musik');
    fireEvent.change(input, { target: { value: '' } });
    expect(input).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'A translated path is required' }));
    expect(mocks.apiRequest).not.toHaveBeenCalled();
  });

  it('preserves a newer URL edit when an earlier save finishes', async () => {
    let finish!: (value: Response) => void;
    mocks.apiRequest.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    show(<AdminUrlTranslations />);
    fireEvent.change(await screen.findByTestId('select-language'), { target: { value: 'de' } });
    const input = await screen.findByDisplayValue('musik');
    fireEvent.change(input, { target: { value: 'saved-path' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalled());
    fireEvent.change(input, { target: { value: 'newer-path' } });
    await act(async () => finish(json({ modified: 1 })));
    await waitFor(() => expect(screen.getByRole('button', { name: /Save Changes \(1\)/ })).toBeEnabled());
    expect(input).toHaveValue('newer-path');
  });

  it('applies parsed URL suggestions as drafts without saving or overwriting later manual edits', async () => {
    data['/api/admin/url-translations/available-paths'] = ['new-audit-path'];
    data['/api/admin/url-translations'] = [];
    let finish!: (value: Response) => void;
    mocks.apiRequest.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    show(<AdminUrlTranslations />);
    fireEvent.change(await screen.findByTestId('select-language'), { target: { value: 'de' } });
    fireEvent.click(screen.getByRole('button', { name: /Auto-Translate/ }));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith('POST', '/api/admin/url-translations/auto-translate', { body: { languageCode: 'de', paths: ['new-audit-path'] } }));
    const input = screen.getByPlaceholderText('Enter translation for "new-audit-path"');
    fireEvent.change(input, { target: { value: 'manual-path' } });
    await act(async () => finish(json({ languageCode: 'de', language: 'German', translations: { 'new-audit-path': 'generated-path' } })));
    await waitFor(() => expect(screen.getByRole('button', { name: /Save Changes \(1\)/ })).toBeEnabled());
    expect(input).toHaveValue('manual-path');
    expect(mocks.apiRequest).toHaveBeenCalledTimes(1);
  });

  it('lets a mapping clear stay visible and keeps a newer selection during its save', async () => {
    let finish!: (value: Response) => void;
    mocks.apiRequest.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    show(<AdminCountryLanguageMappings />);
    const row = await screen.findByTestId('row-country-AT');
    expect(screen.getByRole('heading', { level: 1, name: 'Country-Language Mappings' })).toBeInTheDocument();
    const select = within(row).getByRole('combobox');
    fireEvent.change(select, { target: { value: '__none__' } });
    expect(select).toHaveValue('__none__');
    fireEvent.click(screen.getAllByRole('button', { name: /Save Changes/ })[0]);
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith('DELETE', '/api/admin/country-language-mappings/AT'));
    fireEvent.change(select, { target: { value: 'de' } });
    await act(async () => finish(json({ success: true })));
    await waitFor(() => expect(select).toHaveValue('de'));
    expect(within(row).getByText('Pending')).toBeInTheDocument();
  });

  it('blocks mapping controls when required defaults fail to load', async () => {
    data['/api/admin/country-language-defaults'] = new Error('Defaults unavailable');
    show(<AdminCountryLanguageMappings />);
    expect(await screen.findByRole('alert')).toHaveTextContent('configuration could not be loaded');
    expect(screen.queryByTestId('row-country-AT')).not.toBeInTheDocument();
    expect(mocks.apiRequest).not.toHaveBeenCalled();
  });

  it('previews explicit English URL and reports a failed lookup without claiming absent SEO', async () => {
    data['/api/seo/page-data'] = new Error('Unavailable');
    show(<SeoPreview />);
    await screen.findByText(/could not.*load|Failed to load/i);
    expect(qc.getQueryCache().find({ queryKey: ['/api/seo/page-data', { url: '/en' }] })?.state.status).toBe('error');
    expect(screen.queryByText('No SEO data available')).not.toBeInTheDocument();
  });

  it('uses the canonical hidden genre flag and sends discoverable filtering to the server', async () => {
    data['/api/admin/genres'] = { data: [{ _id: 'rock', name: 'Audit Rock', slug: 'rock', stationCount: 2, isDiscoverable: false, discoverable: true }], total: 1, totalPages: 1, currentPage: 1 };
    show(<AdminGenres />);
    await screen.findByText('Audit Rock');
    expect(screen.getByText('Regular Only')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: /Show only discoverable/i }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('discoverable=true'))).toBe(true));
    expect(mocks.apiRequest).not.toHaveBeenCalled();
  });

  it('does not double-decode OAuth errors or poll failed GSC status requests indefinitely', async () => {
    window.history.replaceState({}, '', '/admin/gsc-inspection?oauth_error=Quota%20100%25');
    for (const suffix of ['oauth/status', 'status', 'stats', 'urls', 'noindex-breakdown', 'trends']) data[`/api/admin/gsc-inspection/${suffix}`] = new Error('Unavailable');
    show(<GscInspection />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Search Console data could not load');
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ description: 'Quota 100%' }));
    const query = qc.getQueryCache().find({ queryKey: ['/api/admin/gsc-inspection/status'] })!;
    await waitFor(() => expect(query.state.status).toBe('error'));
    expect((query.options as any).refetchInterval(query)).toBe(false);
    expect(mocks.apiRequest).not.toHaveBeenCalled();
  });

  it('shows failed IndexNow reads explicitly and stops status polling without submitting URLs', async () => {
    for (const suffix of ['sitemap-diff-runs', 'stats', 'logs']) data[`/api/admin/indexnow/${suffix}`] = new Error('Unavailable');
    show(<IndexNowMonitoring />);
    expect(await screen.findByRole('alert')).toHaveTextContent('IndexNow monitoring data could not load');
    const query = qc.getQueryCache().find({ queryKey: ['/api/admin/indexnow/stats'] })!;
    await waitFor(() => expect(query.state.status).toBe('error'));
    expect((query.options as any).refetchInterval(query)).toBe(false);
    expect(mocks.apiRequest).not.toHaveBeenCalled();
  });
});
