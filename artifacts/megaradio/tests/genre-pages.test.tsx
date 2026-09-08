import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Router } from 'wouter';
import { translateUrl } from '@workspace/seo-shared/url-translations';
import GenresPage from '@/pages/genres';
import GenreLanding from '@/pages/genres/genre-landing';
import { parseGenrePage, useGenrePagination } from '@/hooks/useGenrePageState';
import { getGenrePageLabels } from '@/utils/genre-page-labels';

const fixture = vi.hoisted(() => ({ language: 'de', error: false, empty: false, metadataError: false }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({
  language: fixture.language, localeTranslations: {}, t: (key: string) => key,
}) }));
vi.mock('@/hooks/useSeoRouting', async () => {
  const { translateUrl } = await import('@workspace/seo-shared/url-translations');
  return { useSeoRouting: () => ({ getLocalizedUrl: (path: string) => `/${fixture.language}${translateUrl(path, fixture.language)}` }) };
});
vi.mock('@/components/SeoHead', () => ({ SeoHead: () => null }));
vi.mock('@/components/ui/station-card', () => ({ default: ({ station }: any) => <div>{station.name}</div> }));
vi.mock('swiper/react', () => ({ Swiper: ({ children }: any) => <div>{children}</div>, SwiperSlide: ({ children }: any) => <div>{children}</div> }));
vi.mock('swiper/modules', () => ({ FreeMode: {} }));

let client: QueryClient;
let requests: URL[];
function visit(url: string) {
  act(() => { window.history.pushState({}, '', url); window.dispatchEvent(new PopStateEvent('popstate')); });
}
function backTo(url: string) {
  // Browser popstate/query-only navigation, without any component click handler.
  act(() => { window.history.replaceState({}, '', url); window.dispatchEvent(new PopStateEvent('popstate')); });
}
function wrap(children: React.ReactNode) {
  return <QueryClientProvider client={client}><Router>{children}</Router></QueryClientProvider>;
}
function listing(country = 'Austria') { return wrap(<GenresPage selectedCountry={country} />); }
function detail(country = 'Austria') { return wrap(<Route path="/:lang/:section/:slug"><GenreLanding selectedCountry={country} /></Route>); }
const listCalls = () => requests.filter(url => url.pathname === '/api/genres/precomputed' && url.searchParams.get('limit') !== '5');
const detailCalls = () => requests.filter(url => url.pathname.endsWith('/stations'));

beforeEach(() => {
  fixture.language = 'de'; fixture.error = false; fixture.empty = false; fixture.metadataError = false;
  requests = [];
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = new URL(input, window.location.origin); requests.push(url);
    if (fixture.error || (fixture.metadataError && url.pathname.includes('/slug/'))) return { ok: false, status: 503, json: async () => ({}) };
    if (url.pathname.includes('/slug/')) return { ok: true, json: async () => ({ name: 'Jazz', slug: 'jazz' }) };
    const page = Number(url.searchParams.get('page') || 1);
    const country = url.searchParams.get('countryName') || url.searchParams.get('country') || 'global';
    if (url.pathname.endsWith('/stations')) return { ok: true, json: async () => ({
      stations: fixture.empty ? [] : [{ _id: `${country}-${page}`, name: `Station ${country} ${page}` }],
      total: fixture.empty ? 0 : 150, page, pages: fixture.empty ? 0 : 10,
    }) };
    return { ok: true, json: async () => ({ data: fixture.empty ? [] : [{
      _id: `${country}-${page}`, slug: 'jazz', name: `Genre ${country} ${page}`, stationCount: 3,
    }], count: fixture.empty ? 0 : 270, totalPages: fixture.empty ? 0 : 10 }) };
  }));
  client = new QueryClient({ defaultOptions: { queries: {
    retry: false, gcTime: 0,
    queryFn: async ({ queryKey }) => {
      const response = await fetch(String(queryKey[0]));
      if (!response.ok) throw new Error('Failed');
      return response.json();
    },
  } } });
  visit('/de/genres');
});
afterEach(() => { cleanup(); client.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('genre URL pagination', () => {
  it.each(['', '?page=0', '?page=-1', '?page=foo', '?page=1.5', '?page=2&page=3', '?page=999999999999999999'])('bounds invalid page %s to 1', value => {
    expect(parseGenrePage(value)).toBe(1);
  });
  it('accepts a deep positive page', () => expect(parseGenrePage('?page=51')).toBe(51));

  it('keeps initial deep page, click URL, unrelated query/hash, and back/forward state', async () => {
    visit('/de/genres?page=3&source=test#grid');
    render(listing());
    await screen.findByRole('heading', { name: 'Genre Austria 3' });
    expect(listCalls().every(url => url.searchParams.get('page') === '3')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '4' }));
    await screen.findByRole('heading', { name: 'Genre Austria 4' });
    expect(window.location.search).toBe('?page=4&source=test');
    expect(window.location.hash).toBe('#grid');
    backTo('/de/genres');
    await screen.findByRole('heading', { name: 'Genre Austria 1' });
    backTo('/de/genres?page=3');
    await screen.findByRole('heading', { name: 'Genre Austria 3' });
  });

  it('resets country/search filters immediately, without a stale high-page request', async () => {
    visit('/de/genres?page=4');
    const view = render(listing());
    await screen.findByRole('heading', { name: 'Genre Austria 4' });
    view.rerender(listing('Germany'));
    await screen.findByRole('heading', { name: 'Genre Germany 1' });
    expect(listCalls().filter(url => url.searchParams.get('countryName') === 'Germany').every(url => url.searchParams.get('page') === '1')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '3' }));
    await screen.findByRole('heading', { name: 'Genre Germany 3' });
    fireEvent.change(screen.getByPlaceholderText('search_genre'), { target: { value: 'Jazz' } });
    await waitFor(() => expect(listCalls().at(-1)?.searchParams.get('search')).toBe('Jazz'));
    expect(listCalls().at(-1)?.searchParams.get('page')).toBe('1');
    expect(window.location.search).not.toContain('page');
  });

  it('uses distinct 9/27 caches and resets on responsive page-size changes', async () => {
    visit('/de/genres?page=3');
    render(listing());
    await screen.findByRole('heading', { name: 'Genre Austria 3' });
    act(() => { Object.defineProperty(window, 'innerWidth', { value: 375 }); window.dispatchEvent(new Event('resize')); });
    await waitFor(() => expect(listCalls().at(-1)?.searchParams.get('limit')).toBe('9'));
    expect(listCalls().at(-1)?.searchParams.get('page')).toBe('1');
    const keys = client.getQueryCache().findAll({ queryKey: ['/api/genres/precomputed'] }).map(query => query.queryKey.at(-1));
    // The current observer must be attached to the mobile key, never the stale desktop response.
    expect(keys).toContain(9);
    act(() => { Object.defineProperty(window, 'innerWidth', { value: 1024 }); window.dispatchEvent(new Event('resize')); });
    await waitFor(() => expect(listCalls().at(-1)?.searchParams.get('limit')).toBe('27'));
    expect(listCalls().at(-1)?.searchParams.get('page')).toBe('1');
  });

  it('does not reset an explicitly paginated new genre route', () => {
    function Probe() { const state = useGenrePagination(window.location.pathname); return <div>Page {state.currentPage}</div>; }
    visit('/de/genres/rock?page=3');
    render(wrap(<Probe />));
    expect(screen.getByText('Page 3')).toBeInTheDocument();
    visit('/de/genres/jazz?page=2');
    expect(screen.getByText('Page 2')).toBeInTheDocument();
  });
});

describe('genre detail and localized states', () => {
  it('keeps detail deep links/back navigation and resets a country filter', async () => {
    visit('/de/genres/jazz?page=3');
    const view = render(detail());
    await screen.findByText('Station Austria 3');
    expect(detailCalls().every(url => url.searchParams.get('page') === '3')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '4' }));
    await screen.findByText('Station Austria 4');
    expect(window.location.search).toBe('?page=4');
    backTo('/de/genres/jazz');
    await screen.findByText('Station Austria 1');
    backTo('/de/genres/jazz?page=4');
    await screen.findByText('Station Austria 4');
    view.rerender(detail('Germany'));
    await screen.findByText('Station Germany 1');
    expect(detailCalls().filter(url => url.searchParams.get('country') === 'Germany').every(url => url.searchParams.get('page') === '1')).toBe(true);
  });

  it('never sends the global sentinel as a literal station country', async () => {
    visit('/de/genres/jazz'); render(detail('global'));
    await screen.findByText('Station global 1');
    expect(detailCalls()[0].searchParams.has('country')).toBe(false);
  });

  it.each(['en', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'ar', 'zh', 'tr', 'ja', 'ko', 'hi', 'he'])('%s: localized heading and canonical genre breadcrumb', async code => {
    fixture.language = code;
    const genresUrl = `/${code}${translateUrl('/genres', code)}`;
    visit(`${genresUrl}/jazz`); render(detail());
    const labels = getGenrePageLabels(code);
    expect(await screen.findByRole('heading', { name: `Jazz ${labels.stations}` })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: labels.genres })).toHaveAttribute('href', genresUrl);
  });

  it('shows real empty genres instead of an endless popular skeleton', async () => {
    fixture.empty = true; const view = render(listing());
    await waitFor(() => expect(screen.getAllByText('Keine Genres gefunden.')).toHaveLength(2));
    expect(view.container.querySelector('.animate-pulse')).toBeNull();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a localized list error and a functional retry, not a false empty result', async () => {
    fixture.error = true; render(listing());
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
    expect(screen.queryByText('Keine Genres gefunden.')).not.toBeInTheDocument();
    fixture.error = false;
    fireEvent.click(screen.getAllByRole('button', { name: 'Erneut versuchen' })[1]);
    await screen.findByRole('heading', { name: 'Genre Austria 1' });
  });

  it('distinguishes an empty detail result from a metadata/station request failure', async () => {
    visit('/de/genres/jazz'); fixture.empty = true;
    const view = render(detail());
    await screen.findByText('Keine Sender gefunden.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    view.unmount(); client.clear(); fixture.empty = false; fixture.metadataError = true;
    render(detail());
    expect(await screen.findByRole('alert')).toHaveTextContent('Dieser Inhalt konnte nicht geladen werden.');
    expect(screen.queryByText('Keine Sender gefunden.')).not.toBeInTheDocument();
    fixture.metadataError = false;
    fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    await screen.findByText('Station Austria 1');
  });
});
