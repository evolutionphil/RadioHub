import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ playStation: vi.fn(), cards: new Map<string, any>() }));
vi.mock('@/hooks/useGlobalPlayer', () => ({ useGlobalPlayer: () => ({ playStation: fixture.playStation }) }));
vi.mock('@/hooks/useRegionDirectory', async () => {
  const { useLocation } = await import('wouter');
  return { useRegionDirectory: () => {
    const [location] = useLocation();
    const [language, , regionSlug, countrySlug, possibleCity] = location.split('/').filter(Boolean);
    return {
      language, regionSlug, countrySlug, citySlug: possibleCity === 'stations' ? undefined : possibleCity,
      copy: { stations: 'Stations', search: 'Search stations', sort: 'Sort', popular: 'Most stations', mostPopular: 'Most popular', alphabetical: 'Alphabetical',
        loading: 'Loading', error: 'Could not load stations', retry: 'Try again', empty: 'No stations', loadMore: 'Load more', back: 'Back' },
      getLocalizedUrl: (path: string) => `/${language}${path.replace('/regions', '/regionen')}`,
      countryName: (name: string) => ({ Germany: 'Deutschland', germany: 'Deutschland', Austria: 'Österreich', austria: 'Österreich' }[name] || name),
      regionName: () => 'Europa',
      formatCount: (count: number) => `Stations · ${count}`,
    };
  } };
});
vi.mock('@/components/regions/region-directory', () => ({
  DirectoryPage: ({ title, description, summary, backHref, backLabel, children }: any) => <main>
    <a href={backHref}>{backLabel}</a><h1>{title}</h1><p>{description}</p><p>{summary}</p>{children}
  </main>,
  DirectoryToolbar: ({ search, onSearch, searchLabel, sort, onSort, sortOptions, sortLabel }: any) => <div>
    <input aria-label={searchLabel} value={search} onChange={event => onSearch(event.target.value)} />
    <select aria-label={sortLabel} value={sort} onChange={event => onSort(event.target.value)}>
      {sortOptions.map(({ value, label }: any) => <option key={value} value={value}>{label}</option>)}
    </select>
  </div>,
  DirectoryStatus: ({ kind, label, onRetry, retryLabel }: any) => <div role={kind === 'error' ? 'alert' : 'status'}>
    {label}{onRetry && <button onClick={onRetry}>{retryLabel}</button>}
  </div>,
}));
vi.mock('@/components/ui/station-card', () => ({ default: ({ station, onPlay, playlistName }: any) => {
  fixture.cards.set(station._id, station);
  return <article data-testid={`station-${station._id}`}>
    <a href={`/de/sender/${station.slug}`}>{station.name}</a>
    <button onClick={onPlay} aria-label={`Play ${station.name}`} data-playlist={playlistName}>Play</button>
  </article>;
} }));

import RegionStationsPage from '../src/pages/RegionStationsPage';

const metro = { _id: 'metro', name: 'Metro FM', slug: 'metro-fm', url: 'https://stream.example/metro',
  urlResolved: 'https://stream.example/metro-live', country: 'Germany', localImagePath: '/station-images/metro.webp',
  logoAssets: { status: 'completed', webp96: 'https://cdn.example/metro.webp' }, codec: 'MP3', bitrate: 128, votes: 45 };
const jazz = { ...metro, _id: 'jazz', name: 'Jazz FM', slug: 'jazz-fm' };
const austrian = { ...metro, _id: 'orf', name: 'ORF Wien', slug: 'orf-wien', country: 'Austria' };
const success = (data: any) => ({ ok: true, status: 200, json: async () => ({ success: true, data }) }) as Response;
const legacy = (stations = [metro], total = stations.length, offset = 0) => success({ stations, total, limit: 60, offset, countryName: 'Germany' });
let client: QueryClient;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fixture.playStation.mockReset(); fixture.playStation.mockResolvedValue(undefined); fixture.cards.clear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  fetchMock = vi.fn().mockResolvedValue(legacy());
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function mount(path = '/de/regionen/europe/germany/stations') {
  const route = memoryLocation({ path });
  render(<QueryClientProvider client={client}><Router hook={route.hook}><RegionStationsPage /></Router></QueryClientProvider>);
  return route;
}
function request(index = 0) { return new URL(String(fetchMock.mock.calls[index][0]), 'https://themegaradio.com'); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe('region stations directory', () => {
  it('reads the deployed flat contract, preserves all fields, and plays only on explicit action', async () => {
    mount();
    expect(await screen.findByRole('link', { name: 'Metro FM' })).toHaveAttribute('href', '/de/sender/metro-fm');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Deutschland');
    expect(screen.getByText('Stations · 1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/de/regionen/europe/germany');
    expect(fixture.cards.get('metro')).toEqual(metro);
    expect(fixture.playStation).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Play Metro FM' }));
    expect(fixture.playStation).toHaveBeenCalledWith(metro, [metro]);
    expect(request().pathname).toBe('/api/regions/europe/germany/stations');
    expect(request().searchParams.get('limit')).toBe('60');
    expect(request().searchParams.get('sortBy')).toBe('votes');
    expect(request().searchParams.get('order')).toBe('desc');
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'GET', credentials: 'include' });
    expect(screen.getByRole('option', { name: 'Most popular' })).toHaveValue('votes');
  });

  it('reads new metadata and pagination while keeping a localized country back link', async () => {
    fetchMock.mockResolvedValue(success({ stations: [metro], region: { name: 'Europe', slug: 'europe' },
      country: { name: 'Germany', slug: 'germany' }, city: { name: 'Berlin', slug: 'berlin' },
      pagination: { total: 1, offset: 0, limit: 60, hasMore: false } }));
    mount('/de/regionen/europe/germany/berlin/stations');
    expect(await screen.findByText('Stations · 1')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Berlin');
    expect(screen.getByText('Deutschland · Europa · Stations')).toBeInTheDocument();
    expect(request().pathname).toBe('/api/regions/europe/germany/berlin/stations');
    expect(screen.queryByTestId('load-more-stations')).not.toBeInTheDocument();
  });

  it('honors the initial page and a later page query change without retaining earlier stations', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const offset = Number(new URL(url, 'https://example.com').searchParams.get('offset'));
      return legacy(offset === 60 ? [metro] : [jazz], 200, offset);
    });
    const route = mount('/de/regionen/europe/germany/stations?page=2');
    await screen.findByText('Metro FM');
    expect(request().searchParams.get('offset')).toBe('60');
    act(() => route.navigate('/de/regionen/europe/germany/stations?page=3'));
    await screen.findByText('Jazz FM');
    expect(request(1).searchParams.get('offset')).toBe('120');
    expect(screen.queryByText('Metro FM')).not.toBeInTheDocument();
    expect(fixture.playStation).not.toHaveBeenCalled();
  });

  it.each(['0', '-1', '2abc', '1.5', '16668', '999999999999999999999'])('uses page one for invalid page=%s', async page => {
    mount(`/de/regionen/europe/germany/stations?page=${page}`);
    await screen.findByText('Metro FM');
    expect(request().searchParams.get('offset')).toBe('0');
  });

  it('respects the server offset ceiling and never loads its clamped last page repeatedly', async () => {
    fetchMock.mockResolvedValue(legacy([metro], 2_000_000, 999_960));
    mount('/de/regionen/europe/germany/stations?page=16667');
    await screen.findByText('Metro FM');
    expect(request().searchParams.get('offset')).toBe('999960');
    expect(screen.queryByTestId('load-more-stations')).not.toBeInTheDocument();
  });

  it('keeps loaded cards after a load-more failure, retries the same offset and deduplicates IDs', async () => {
    fetchMock.mockResolvedValueOnce(legacy([metro], 61))
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'Unavailable' })
      .mockResolvedValueOnce(success({ stations: [metro, jazz], countryName: 'Germany', total: 62, limit: 60, offset: 60 }));
    mount();
    fireEvent.click(await screen.findByTestId('load-more-stations'));
    await screen.findByRole('alert');
    expect(screen.getByText('Metro FM')).toBeInTheDocument();
    expect(request(1).searchParams.get('offset')).toBe('60');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('Jazz FM');
    expect(request(2).searchParams.get('offset')).toBe('60');
    expect(screen.getAllByTestId('station-metro')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Play Jazz FM' }));
    expect(fixture.playStation).toHaveBeenCalledWith(jazz, [metro, jazz]);
    expect(screen.queryByTestId('load-more-stations')).not.toBeInTheDocument();
  });

  it('debounces server-wide search, resets a page-two offset, and does not re-filter server results locally', async () => {
    fetchMock.mockResolvedValueOnce(legacy([metro], 61, 60)).mockResolvedValue(legacy([jazz]));
    mount('/de/regionen/europe/germany/stations?page=2');
    await screen.findByText('Metro FM');
    fireEvent.change(screen.getByRole('textbox', { name: 'Search stations' }), { target: { value: ' saxophone ' } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Metro FM')).not.toBeInTheDocument();
    await screen.findByText('Jazz FM');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(request(1).searchParams.get('search')).toBe('saxophone');
    expect(request(1).searchParams.get('offset')).toBe('0');
  });

  it('resets pagination for alphabetical sorting and sends the correct server ordering', async () => {
    fetchMock.mockResolvedValueOnce(legacy([metro], 61, 60)).mockResolvedValue(legacy([jazz]));
    mount('/de/regionen/europe/germany/stations?page=2');
    await screen.findByText('Metro FM');
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort' }), { target: { value: 'name' } });
    await screen.findByText('Jazz FM');
    expect(request(1).searchParams.get('offset')).toBe('0');
    expect(request(1).searchParams.get('sortBy')).toBe('name');
    expect(request(1).searchParams.get('order')).toBe('asc');
    expect(screen.queryByText('Metro FM')).not.toBeInTheDocument();
  });

  it('aborts an old country request and ignores its late result after navigation', async () => {
    const old = deferred<Response>();
    fetchMock.mockReturnValueOnce(old.promise).mockResolvedValue(success({ stations: [austrian], countryName: 'Austria', total: 1 }));
    const route = mount();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const oldSignal = fetchMock.mock.calls[0][1].signal;
    act(() => route.navigate('/de/regionen/europe/austria/stations'));
    await screen.findByText('ORF Wien');
    expect(oldSignal.aborted).toBe(true);
    await act(async () => old.resolve(legacy()));
    expect(screen.queryByText('Metro FM')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Österreich');
  });

  it('starts a city list from zero instead of appending the previously loaded country pages', async () => {
    fetchMock.mockResolvedValueOnce(legacy([metro], 61)).mockResolvedValueOnce(legacy([jazz], 61, 60))
      .mockResolvedValueOnce(success({ stations: [austrian], countryName: 'Germany', cityName: 'Berlin', total: 1 }));
    const route = mount();
    fireEvent.click(await screen.findByTestId('load-more-stations'));
    await screen.findByText('Jazz FM');
    act(() => route.navigate('/de/regionen/europe/germany/berlin/stations'));
    await screen.findByText('ORF Wien');
    expect(screen.queryByText('Metro FM')).not.toBeInTheDocument();
    expect(screen.queryByText('Jazz FM')).not.toBeInTheDocument();
    expect(request(2).searchParams.get('offset')).toBe('0');
  });

  it('aborts an obsolete search so a slower result cannot replace the current search', async () => {
    const old = deferred<Response>();
    fetchMock.mockResolvedValueOnce(legacy()).mockReturnValueOnce(old.promise).mockResolvedValue(legacy([jazz]));
    mount();
    await screen.findByText('Metro FM');
    const input = screen.getByRole('textbox', { name: 'Search stations' });
    fireEvent.change(input, { target: { value: 'old' } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const oldSignal = fetchMock.mock.calls[1][1].signal;
    fireEvent.change(input, { target: { value: 'jazz' } });
    await screen.findByText('Jazz FM');
    expect(oldSignal.aborted).toBe(true);
    await act(async () => old.resolve(legacy()));
    expect(screen.queryByText('Metro FM')).not.toBeInTheDocument();
    expect(request(2).searchParams.get('search')).toBe('jazz');
  });

  it('distinguishes a malformed response from an empty list and retries initial failures', async () => {
    fetchMock.mockResolvedValueOnce(success({ total: 0 })).mockResolvedValue(legacy());
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load stations');
    expect(screen.queryByText('No stations')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('Metro FM');
    expect(request(1).searchParams.get('offset')).toBe('0');
  });

  it('renders an empty response without an endless load-more button', async () => {
    fetchMock.mockResolvedValue(legacy([], 0));
    mount();
    expect(await screen.findByText('No stations')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByTestId('load-more-stations')).not.toBeInTheDocument();
  });

  it('never requests undefined route parameters or leaves an invalid route spinning forever', () => {
    mount('/de/regionen');
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load stations');
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/de/regionen');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
