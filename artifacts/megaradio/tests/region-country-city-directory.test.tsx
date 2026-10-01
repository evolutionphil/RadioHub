import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router } from 'wouter';
import { translateUrl } from '@workspace/seo-shared/url-translations';
import RegionCountriesPage from '@/pages/RegionCountriesPage';
import CountryCitiesPage from '@/pages/CountryCitiesPage';

vi.mock('@/hooks/useSeoRouting', async () => {
  const { useLocation } = await import('wouter');
  const { translateUrl, reverseTranslateUrl } = await import('@workspace/seo-shared/url-translations');
  return { useSeoRouting: () => {
    const [location] = useLocation();
    const segments = location.split('/').filter(Boolean);
    const language = segments[0] || 'en';
    return {
      currentLanguage: language,
      language,
      englishPath: reverseTranslateUrl(`/${segments.slice(1).join('/')}`, language),
      getLocalizedUrl: (path: string) => `/${language}${translateUrl(path, language)}`,
    };
  } };
});

let client: QueryClient;
let pending: boolean;
let failure: boolean;
let override: unknown;
let requests: Array<{ path: string; signal?: AbortSignal | null }>;

const countries = [
  { name: 'Germany', slug: 'germany', stationCount: 120 },
  { name: 'Austria', slug: 'austria', stationCount: 180 },
  { name: 'France', slug: 'france', stationCount: 40 },
];
const cities = [
  { name: 'Hamburg', slug: 'hamburg', stationCount: 4 },
  { name: 'Berlin', slug: 'berlin', stationCount: 8 },
  { name: 'ALL', slug: 'all', stationCount: 6 },
  { name: 'Cologne', slug: 'cologne', stationCount: 12 },
];
const regionData = { region: { name: 'Europe', slug: 'europe' }, countries };
const countryData = { region: regionData.region, country: { name: 'Germany', slug: 'germany' }, cities };

function visit(path: string) {
  act(() => { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')); });
}
function wrap(page: React.ReactNode) {
  // The application can render a matched page without a wouter Route context.
  return <QueryClientProvider client={client}><Router>{page}</Router></QueryClientProvider>;
}
function cardNames(container: HTMLElement) {
  return Array.from(container.querySelectorAll('.region-directory-grid a')).map(card => card.querySelector('h2,h3')?.textContent);
}

beforeEach(() => {
  pending = false; failure = false; override = undefined; requests = [];
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  vi.stubGlobal('fetch', vi.fn(async (input: string, options?: RequestInit) => {
    const path = new URL(input, window.location.origin).pathname;
    requests.push({ path, signal: options?.signal });
    if (pending) return new Promise(() => {});
    const data = path.split('/').filter(Boolean).length === 3 ? regionData : countryData;
    return {
      ok: !failure, status: failure ? 503 : 200,
      text: async () => 'Unavailable',
      json: async () => override ?? { success: true, data },
    };
  }));
  visit('/en/regions/europe');
});

afterEach(() => { cleanup(); client.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('country and city directory request states', () => {
  it.each([
    ['countries', '/en/regions/europe', <RegionCountriesPage />, 'Europe'],
    ['cities', '/en/regions/europe/germany', <CountryCitiesPage />, 'Germany'],
    ['German cities', '/de/regionen/europe/germany', <CountryCitiesPage />, 'Deutschland'],
  ])('%s keeps a heading during loading and cancels its request on unmount', async (_kind, path, page, heading) => {
    pending = true; visit(path);
    const view = render(wrap(page));
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(heading);
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].path).not.toContain('undefined');
    expect(requests[0].signal).toBeInstanceOf(AbortSignal);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    view.unmount();
    expect(requests[0].signal?.aborted).toBe(true);
  });

  it.each([
    ['countries', '/en/regions/europe', <RegionCountriesPage />, 'Austria'],
    ['cities', '/en/regions/europe/germany', <CountryCitiesPage />, 'Berlin'],
  ])('%s distinguishes a failed request and retries it', async (_kind, path, page, expected) => {
    failure = true; visit(path); render(wrap(page));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    failure = false;
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByRole('link', { name: new RegExp(expected) })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each([
    ['countries', '/en/regions/europe', <RegionCountriesPage />, { success: false, data: regionData }],
    ['countries', '/en/regions/europe', <RegionCountriesPage />, { success: true, data: { ...regionData, countries: null } }],
    ['countries', '/en/regions/europe', <RegionCountriesPage />, { success: true, data: { ...regionData, countries: [{ name: 'Broken' }] } }],
    ['cities', '/en/regions/europe/germany', <CountryCitiesPage />, { success: true, data: { ...countryData, cities: null } }],
    ['cities', '/en/regions/europe/germany', <CountryCitiesPage />, { success: true, data: { ...countryData, country: null } }],
  ])('%s rejects malformed response %#', async (_kind, path, page, payload) => {
    override = payload; visit(path); render(wrap(page));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it.each([<RegionCountriesPage />, <CountryCitiesPage />])('does not request undefined route parameters %#', page => {
    visit('/en/regions'); render(wrap(page));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(requests).toHaveLength(0);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('region countries browsing', () => {
  it('localizes country labels, preserves slugs, and searches original or localized names', async () => {
    const url = `/de${translateUrl('/regions/europe', 'de')}`;
    visit(url); const view = render(wrap(<RegionCountriesPage />));
    const germany = await screen.findByRole('link', { name: /Deutschland/ });
    expect(germany).toHaveAttribute('href', `/de${translateUrl('/regions/europe/germany', 'de')}`);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Europa');
    expect(view.container.querySelector(`a[href="/de${translateUrl('/regions', 'de')}"]`)).not.toBeNull();
    expect(cardNames(view.container)).toEqual(['Österreich', 'Deutschland', 'Frankreich']);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'name' } });
    expect(cardNames(view.container)).toEqual(['Deutschland', 'Frankreich', 'Österreich']);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'deutsch' } });
    expect(cardNames(view.container)).toEqual(['Deutschland']);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'germany' } });
    expect(cardNames(view.container)).toEqual(['Deutschland']);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'missing-country' } });
    expect(cardNames(view.container)).toEqual([]);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a genuine empty directory without an error', async () => {
    override = { success: true, data: { ...regionData, countries: [] } };
    const view = render(wrap(<RegionCountriesPage />));
    await screen.findByRole('searchbox');
    expect(view.container.querySelector('.region-directory-grid')).toBeNull();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('resets a country search when navigating to another region', async () => {
    render(wrap(<RegionCountriesPage />));
    await screen.findByRole('link', { name: /Austria/ });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'missing' } });
    visit('/en/regions/asia');
    await screen.findByRole('link', { name: /Austria/ });
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(requests.at(-1)?.path).toBe('/api/regions/asia');
  });
});

describe('country cities browsing', () => {
  it('sorts and filters real cities while retaining localized city and all-country links', async () => {
    visit(`/tr${translateUrl('/regions/europe/germany', 'tr')}`);
    const view = render(wrap(<CountryCitiesPage />));
    const berlin = await screen.findByRole('link', { name: /Berlin/ });
    expect(berlin).toHaveAttribute('href', `/tr${translateUrl('/regions/europe/germany/berlin/stations', 'tr')}`);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Almanya');
    expect(view.container.querySelector(`a[href="/tr${translateUrl('/regions/europe', 'tr')}"]`)).not.toBeNull();
    expect(cardNames(view.container)).toEqual(['Cologne', 'Berlin', 'Hamburg']);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'name' } });
    expect(cardNames(view.container)).toEqual(['Berlin', 'Cologne', 'Hamburg']);
    expect(screen.queryByText('ALL')).not.toBeInTheDocument();
    expect(screen.getByTestId('explore-all-country-stations')).toHaveAttribute('href', `/tr${translateUrl('/regions/europe/germany/stations', 'tr')}`);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'hamb' } });
    expect(cardNames(view.container)).toEqual(['Hamburg']);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'unknown city' } });
    expect(cardNames(view.container)).toEqual([]);
    expect(screen.getByTestId('explore-all-country-stations')).toBeInTheDocument();
    visit(`/tr${translateUrl('/regions/europe/austria', 'tr')}`);
    await screen.findByRole('link', { name: /Berlin/ });
    expect(screen.getByRole('searchbox')).toHaveValue('');
  });

  it.each([{ entries: [] }, { entries: [cities[2]] }])('offers country stations when no actual cities are available %#', async ({ entries }) => {
    override = { success: true, data: { ...countryData, cities: entries } };
    visit('/en/regions/europe/germany');
    const view = render(wrap(<CountryCitiesPage />));
    expect(await screen.findByTestId('explore-all-country-stations')).toHaveAttribute('href', '/en/regions/europe/germany/stations');
    expect(screen.getByText(/No cities/i)).toBeInTheDocument();
    expect(view.container.querySelector('.region-directory-grid')).toBeNull();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
