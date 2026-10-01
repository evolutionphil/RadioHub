import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router } from 'wouter';
import { translateUrl } from '@workspace/seo-shared/url-translations';
import RegionsPage from '@/pages/RegionsPage';
import { parseRegionDirectoryPath, parseRegionsResponse } from '@/utils/region-directory';
import { getRegionDirectoryCopy, REGION_DIRECTORY_COPY } from '@/utils/region-directory-copy';

vi.mock('@/hooks/useSeoRouting', async () => {
  const { useLocation } = await import('wouter');
  const { translateUrl, reverseTranslateUrl } = await import('@workspace/seo-shared/url-translations');
  return { useSeoRouting: () => {
    const [location] = useLocation();
    const segments = location.split('/').filter(Boolean);
    const language = segments[0] || 'en';
    return {
      currentLanguage: language,
      englishPath: reverseTranslateUrl(`/${segments.slice(1).join('/')}`, language),
      getLocalizedUrl: (path: string) => `/${language}${translateUrl(path, language)}`,
    };
  } };
});

const regions = [
  { slug: 'europe', name: 'Europe', countryCount: 44 },
  { slug: 'africa', name: 'Africa', countryCount: 54 },
  { slug: 'asia', name: 'Asia', countryCount: 49 },
  { slug: 'north-america', name: 'North America', countryCount: 23 },
  { slug: 'south-america', name: 'South America', countryCount: 12 },
  { slug: 'oceania', name: 'Oceania', countryCount: 14 },
];
const localeCases = [
  ['en', 'Europe'], ['de', 'Europa'], ['tr', 'Avrupa'], ['es', 'Europa'],
  ['fr', 'Europe'], ['pt', 'Europa'], ['it', 'Europa'], ['ru', 'Европа'],
  ['ar', 'أوروبا'], ['zh', '欧洲'], ['ja', 'ヨーロッパ'], ['ko', '유럽'],
  ['hi', 'यूरोप'], ['he', 'אירופה'],
] as const;
let client: QueryClient;
let reply: unknown;
let pending: boolean;
let failed: boolean;
let requests: Array<{ path: string; signal?: AbortSignal | null }>;

function visit(path: string) {
  act(() => { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')); });
}
function showPage() {
  return render(<QueryClientProvider client={client}><Router><RegionsPage /></Router></QueryClientProvider>);
}
function cards(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLAnchorElement>('.region-directory-grid a'));
}
function names(container: HTMLElement) {
  return cards(container).map(card => within(card).getByRole('heading').textContent);
}

beforeEach(() => {
  pending = false; failed = false; reply = { success: true, data: regions }; requests = [];
  // Keep the page's one automatic retry, but remove the delay from the test.
  client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0, gcTime: 0 } } });
  vi.stubGlobal('fetch', vi.fn(async (input: string, options?: RequestInit) => {
    requests.push({ path: new URL(input, window.location.origin).pathname, signal: options?.signal });
    if (pending) return new Promise(() => {});
    return { ok: !failed, status: failed ? 503 : 200, text: async () => 'Unavailable', json: async () => reply };
  }));
  visit('/en/regions');
});
afterEach(() => { cleanup(); client.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('regions index states and navigation', () => {
  it('keeps its localized heading during loading and aborts the request on unmount', async () => {
    pending = true; visit(`/de${translateUrl('/regions', 'de')}`);
    const view = showPage();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Entdecke die Welt');
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].path).toBe('/api/regions');
    expect(requests[0].signal).toBeInstanceOf(AbortSignal);
    view.unmount();
    expect(requests[0].signal?.aborted).toBe(true);
  });

  it('retries request failures and recovers through the visible retry action', async () => {
    failed = true; showPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t load this page.');
    expect(requests).toHaveLength(2);
    expect(screen.queryByText('No results found. Try another search.')).not.toBeInTheDocument();
    failed = false; fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: /Europe/ })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each([
    { payload: null },
    { payload: { success: false, data: [] } },
    { payload: { success: true, data: null } },
    { payload: { success: true, data: [{ slug: 'europe', name: 'Europe', countryCount: '44' }] } },
  ])('shows an error for malformed payload %#', async ({ payload }) => {
    reply = payload; showPage();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('renders a true empty result without leaving loading placeholders', async () => {
    reply = { success: true, data: [] };
    const view = showPage();
    expect(await screen.findByText('No results found. Try another search.')).toBeInTheDocument();
    expect(view.container.querySelector('.region-directory-skeleton')).toBeNull();
    expect(view.container.querySelector('.region-directory-summary')).toBeNull();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('uses API numeric country counts and keeps the total independent of a search filter', async () => {
    const view = showPage();
    const europe = await screen.findByRole('link', { name: /Europe/ });
    expect(within(europe).getByText('Countries · 44')).toBeInTheDocument();
    expect(view.container.querySelector('.region-directory-summary')).toHaveTextContent('Countries · 196');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'europe' } });
    expect(names(view.container)).toEqual(['Europe']);
    expect(view.container.querySelector('.region-directory-summary')).toHaveTextContent('Countries · 196');
  });

  it('searches German and original names, sorts real counts, and preserves localized links', async () => {
    visit(`/de${translateUrl('/regions', 'de')}`);
    const view = showPage();
    expect(await screen.findByRole('link', { name: /Nordamerika/ })).toHaveAttribute('href', `/de${translateUrl('/regions/north-america', 'de')}`);
    expect(names(view.container)).toEqual(['Afrika', 'Asien', 'Europa', 'Nordamerika', 'Ozeanien', 'Südamerika']);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'count' } });
    expect(names(view.container)).toEqual(['Afrika', 'Asien', 'Europa', 'Nordamerika', 'Ozeanien', 'Südamerika']);
    // Change the count order through real response data, without renaming regions.
    reply = { success: true, data: regions.map(region => ({ ...region, countryCount: region.slug === 'oceania' ? 100 : region.countryCount })) };
    await act(async () => { await client.invalidateQueries({ queryKey: ['/api/regions', 'directory-v2'] }); });
    await waitFor(() => expect(names(view.container)[0]).toBe('Ozeanien'));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'name' } });
    expect(names(view.container)[0]).toBe('Afrika');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: ' nord ' } });
    expect(names(view.container)).toEqual(['Nordamerika']);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'north' } });
    expect(names(view.container)).toEqual(['Nordamerika']);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'no-such-region' } });
    expect(names(view.container)).toEqual([]);
    expect(screen.getByRole('status')).toHaveTextContent('Keine Ergebnisse.');
  });
});

describe('all supported directory languages', () => {
  it.each(localeCases)('%s provides complete copy and readable region names with the country-only DisplayNames polyfill', async (language, europeName) => {
    // Production's small polyfill returns unsupported macroregion codes unchanged.
    vi.spyOn(Intl, 'DisplayNames').mockImplementation(function () {
      return { of: (code: string) => code } as Intl.DisplayNames;
    });
    visit(`/${language}${translateUrl('/regions', language)}`);
    const copy = getRegionDirectoryCopy(language);
    const fields = ['title', 'subtitle', 'search', 'sort', 'popular', 'alphabetical', 'countries', 'cities', 'stations', 'loading', 'error', 'retry', 'empty', 'viewAll', 'loadMore', 'back', 'noCities'] as const;
    expect(REGION_DIRECTORY_COPY[language]).toBeDefined();
    for (const field of fields) {
      expect(REGION_DIRECTORY_COPY[language][field].trim()).not.toBe('');
      expect(copy[field]).not.toMatch(/^regions\./);
    }
    expect(copy.viewAllStations).toBe(copy.viewAll);
    expect(copy.mostPopular.trim()).not.toBe('');
    if (language !== 'en') expect(copy.title).not.toBe(getRegionDirectoryCopy('en').title);
    const view = showPage();
    expect(await screen.findByRole('link', { name: new RegExp(europeName) })).toHaveAttribute('href', `/${language}${translateUrl('/regions/europe', language)}`);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(copy.title);
    expect(names(view.container)).toHaveLength(6);
    expect(names(view.container).every(name => name && !/^\d+$/.test(name))).toBe(true);
    expect(screen.getByRole('searchbox')).toHaveAccessibleName(copy.search);
    expect(screen.getByRole('combobox')).toHaveAccessibleName(copy.sort);
  });
});

describe('regions response validation', () => {
  it('accepts empty and zero-count data, preserving numeric counts', () => {
    expect(parseRegionsResponse({ success: true, data: [] })).toEqual([]);
    expect(parseRegionsResponse({ success: true, data: [{ ...regions[0], countryCount: 0 }] })).toEqual([{ ...regions[0], countryCount: 0 }]);
    expect(parseRegionsResponse({ success: true, data: regions })).toEqual(regions);
  });

  it.each([
    null, undefined, [], {}, { success: false, data: regions }, { success: true, data: {} },
    { success: true, data: [null] },
    ...[-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '44', undefined].map(countryCount => ({ success: true, data: [{ ...regions[0], countryCount }] })),
    { success: true, data: [{ ...regions[0], name: '' }] },
    { success: true, data: [{ ...regions[0], slug: '../europe' }] },
  ].map(payload => ({ payload })))('rejects malformed regions response %#', ({ payload }) => {
    expect(() => parseRegionsResponse(payload)).toThrow();
  });
});

describe('safe directory route parsing', () => {
  it.each([
    ['/regions', {}],
    ['/regions/europe', { regionSlug: 'europe' }],
    ['/regions/europe/germany', { regionSlug: 'europe', countrySlug: 'germany' }],
    ['/regions/europe/germany/stations', { regionSlug: 'europe', countrySlug: 'germany' }],
    ['/regions/europe/germany/berlin/stations?search=rock#results', { regionSlug: 'europe', countrySlug: 'germany', citySlug: 'berlin' }],
    ['/regions/europe/germany/all/stations', { regionSlug: 'europe', countrySlug: 'germany', citySlug: 'all' }],
    ['/regions/north%2Damerica/united-states', { regionSlug: 'north-america', countrySlug: 'united-states' }],
    ['/regions/europe/germany/m%C3%BCnchen/stations', { regionSlug: 'europe', countrySlug: 'germany', citySlug: 'münchen' }],
  ])('parses %s', (path, expected) => {
    const parsed = parseRegionDirectoryPath(path as string);
    expect(Object.fromEntries(Object.entries(parsed).filter(([, value]) => value !== undefined))).toEqual(expected);
  });

  it.each(['%', '%ZZ', '%E0%A4%A', '%2F', '%5C', '..', '%2e%2e', '%252F', '%00', '%0A', 'has%20space', '-europe'])('rejects unsafe slug %s in each position', slug => {
    expect(parseRegionDirectoryPath(`/regions/${slug}`).regionSlug).toBeUndefined();
    expect(parseRegionDirectoryPath(`/regions/europe/${slug}`).countrySlug).toBeUndefined();
    expect(parseRegionDirectoryPath(`/regions/europe/germany/${slug}/stations`).citySlug).toBeUndefined();
  });

  it('does not treat reserved station segments or unrelated routes as slugs', () => {
    expect(parseRegionDirectoryPath('/regions/stations').regionSlug).toBeUndefined();
    expect(parseRegionDirectoryPath('/regions/europe/stations').countrySlug).toBeUndefined();
    expect(parseRegionDirectoryPath('/genres/europe')).toEqual({});
    expect(parseRegionDirectoryPath('/regions/europe/germany/berlin/stations/extra')).toEqual({});
    expect(parseRegionDirectoryPath('/regions/europe/germany/berlin')).toEqual({});
    expect(parseRegionDirectoryPath('/regions/europe/germany/berlin/other')).toEqual({});
  });
});
