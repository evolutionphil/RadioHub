import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFile } from 'node:fs/promises';
import { adminStationDescriptionCount, adminStationHealth, adminStationPageWindow } from '../src/lib/admin-station-list';
import StationTable from '../src/components/stations/station-table';
import Filters from '../src/components/stations/filters';
import AdminStationPagination from '../src/components/stations/admin-station-pagination';

const mocks = vi.hoisted(() => ({
  options: vi.fn(), stations: vi.fn(), request: vi.fn(), toast: vi.fn(), play: vi.fn(), pause: vi.fn(),
  player: { currentStation: null as any, isPlaying: false, isLoading: false },
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/hooks/useGlobalPlayer', () => ({ useGlobalPlayer: () => ({ ...mocks.player, playStation: mocks.play, pause: mocks.pause }) }));
vi.mock('@/lib/api', () => ({ api: { getAdminStationFilterOptions: mocks.options, getAdminStations: mocks.stations, getStationsTagsStatusSummary: async () => ({ neverChecked: 0, emptyCooldown: 0 }) } }));
vi.mock('@/lib/queryClient', async () => {
  const { QueryClient } = await import('@tanstack/react-query');
  return { queryClient: new QueryClient(), apiRequest: mocks.request };
});
vi.mock('@/components/stations/station-form', () => ({ default: ({ open }: { open: boolean }) => open ? <div role="dialog">Station editor</div> : null }));
import Stations from '../src/pages/stations';

const station = { _id: 'one', name: 'Example Radio', country: 'Austria', url: 'https://stream.example/live', availabilityStatus: 'unverified', lastCheckOk: false, isListVisible: true, descriptions: { en: { full: 'Article' }, de: { full: '' } } };
const tableProps = { stations: [station], onEdit: vi.fn(), onDelete: vi.fn(), onSort: vi.fn(), onPlay: vi.fn(), sortBy: 'name', sortOrder: 'asc' as const };
function wrapper(children: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  mocks.player.currentStation = null; mocks.player.isPlaying = false; mocks.player.isLoading = false;
  mocks.options.mockResolvedValue({ countries: [{ name: 'Austria', code: 'AT' }], languages: ['German'], genres: Array.from({ length: 70 }, (_, index) => 'Genre ' + index), codecs: ['AAC', 'MP3'] });
  mocks.stations.mockImplementation(async filters => ({ stations: [station], total: filters.healthStatus === 'unavailable' ? 1 : 1000 }));
  mocks.request.mockResolvedValue({ json: async () => ({ duplicates: [], stations: [], pagination: { page: 1, total: 0, totalPages: 0 } }) });
});

describe('truthful health and content labels', () => {
  it('does not label source false, old true, or missing evidence as a confirmed outage', () => {
    expect(adminStationHealth({ lastCheckOk: false }).label).toBe('Needs verification');
    expect(adminStationHealth({ lastCheckOk: true }).label).toBe('Needs verification');
    expect(adminStationHealth({ availabilityStatus: 'unavailable', isListVisible: true }).tone).toBe('unverified');
    expect(adminStationHealth({ availabilityStatus: 'unavailable', isListVisible: false }).label).toBe('Confirmed offline');
    expect(adminStationHealth({ availabilityStatus: 'working', lastCheckOk: false }).tone).toBe('working');
  });
  it('counts only supported nonempty full descriptions, not empty objects or metadata keys', () => {
    expect(adminStationDescriptionCount({ en: { full: 'x' }, de: { meta: 'meta only' }, tr: {}, es: { full: '   ' }, xx: { full: 'unsupported' }, fr: 'legacy' })).toBe(1);
    expect(adminStationDescriptionCount(null)).toBe(0);
  });
  it('renders source warnings with a working preview rather than disabling the station', () => {
    render(<StationTable {...tableProps} />);
    expect(screen.getAllByText('Needs verification')).toHaveLength(2);
    expect(screen.queryByText(/^Offline$/)).not.toBeInTheDocument();
    expect(screen.getAllByText('1 / 14 languages')).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: 'Play Example Radio' })[0]);
    expect(tableProps.onPlay).toHaveBeenCalledOnce(); expect(tableProps.onPlay).toHaveBeenCalledWith(station);
  });
  it('does not create a second audio instance and observes global player state', () => {
    const audio = vi.spyOn(window, 'Audio');
    render(<StationTable {...tableProps} playingStationId="one" />);
    expect(screen.getAllByRole('button', { name: 'Pause Example Radio' })).toHaveLength(2);
    expect(audio).not.toHaveBeenCalled(); audio.mockRestore();
  });
  it('preserves selections outside the current page when selecting or deselecting a page', () => {
    const change = vi.fn();
    const { rerender } = render(<StationTable {...tableProps} selectedStations={new Set(['other'])} onSelectedStationsChange={change} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all stations on this page' }));
    expect(change).toHaveBeenLastCalledWith(new Set(['other', 'one']));
    rerender(<StationTable {...tableProps} selectedStations={new Set(['other', 'one'])} onSelectedStationsChange={change} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all stations on this page' }));
    expect(change).toHaveBeenLastCalledWith(new Set(['other']));
  });
  it('keeps full stream, genre, and timestamp details available on demand', () => {
    render(<StationTable {...tableProps} stations={[{ ...station, tags: 'jazz, soul', urlResolved: 'https://stream.example/final', tagsCheckedAt: '2026-09-10T10:00:00Z' }]} />);
    expect(screen.queryByText(station.url)).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Details for Example Radio' })[0]);
    expect(screen.getAllByText(station.url)).toHaveLength(2);
    expect(screen.getAllByText('jazz, soul')).toHaveLength(2);
    expect(screen.getAllByText(/Source-local check:/)).toHaveLength(2);
  });
});

describe('scannable, scoped filters and page navigation', () => {
  const filterProps = { search: '', country: '', language: '', genre: '', healthStatus: 'all' as const, onSearchChange: vi.fn(), onCountryChange: vi.fn(), onLanguageChange: vi.fn(), onGenreChange: vi.fn(), onHealthStatusChange: vi.fn(), onCodecChange: vi.fn() };
  it('shows health at the top and keeps advanced filters closed without losing any genres', async () => {
    wrapper(<Filters {...filterProps} />);
    expect(screen.getByRole('combobox', { name: 'Broadcast health' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Genres')).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.options).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Advanced filters' }));
    const genres = screen.getByLabelText('Genres');
    expect(document.getElementById(genres.getAttribute('list')!)?.querySelectorAll('option')).toHaveLength(70);
    fireEvent.change(genres, { target: { value: 'Genre 69' } });
    expect(filterProps.onGenreChange).toHaveBeenCalledWith('Genre 69');
  });
  it('does not show ineffective health/country filters in the deleted view', () => {
    wrapper(<Filters {...filterProps} mode="blacklist" />);
    expect(screen.queryByLabelText('Broadcast health')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Countries')).not.toBeInTheDocument();
    expect(mocks.options).not.toHaveBeenCalled();
  });
  it('exposes active advanced filter counts and a one-click reset', () => {
    const reset = vi.fn(); wrapper(<Filters {...filterProps} genre="Jazz" healthStatus="source-offline" onReset={reset} />);
    expect(screen.getByRole('button', { name: 'Advanced filters (1 active)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters (2)' })); expect(reset).toHaveBeenCalledOnce();
    expect(screen.getByText(/A source warning is not proof/)).toBeInTheDocument();
  });
  it.each([[1, 20, [1, 2, 3, 4, 5]], [12, 20, [10, 11, 12, 13, 14]], [20, 20, [16, 17, 18, 19, 20]], [1, 0, []]])('keeps page %s in its pagination window', (page, total, expected) => {
    expect(adminStationPageWindow(page as number, total as number)).toEqual(expected);
  });
  it('uses real keyboard-accessible buttons, disables edges and never reports 1–0 for an empty result', () => {
    const change = vi.fn(); const { rerender } = render(<AdminStationPagination page={12} limit={50} total={1000} onPageChange={change} onLimitChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Page 12' })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(screen.getByRole('button', { name: 'Next' })); expect(change).toHaveBeenCalledWith(13);
    rerender(<AdminStationPagination page={20} limit={50} total={1000} onPageChange={change} onLimitChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    rerender(<AdminStationPagination page={1} limit={50} total={0} onPageChange={change} onLimitChange={vi.fn()} />);
    expect(screen.getByText('0 results')).toBeInTheDocument(); expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });
});

describe('station management integration', () => {
  it('collapses maintenance tools, keeps primary actions available and resets page on view changes', async () => {
    wrapper(<Stations />);
    await screen.findAllByText('Example Radio');
    expect(screen.getByTestId('station-maintenance-tools')).not.toHaveAttribute('open');
    expect(screen.getByRole('button', { name: 'Add station' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(mocks.stations.mock.lastCall?.[0].page).toBe(2));
    fireEvent.click(screen.getByRole('button', { name: 'Duplicates' }));
    await screen.findByText(/No Duplicate Stations|No Duplicates Found|No duplicates/i);
    expect(screen.queryByRole('navigation', { name: 'Station pages' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Catalogue' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page'));
  });
  it('uses one shared play/pause path for a station, including a flagged one', async () => {
    wrapper(<Stations />); await screen.findAllByText('Example Radio');
    fireEvent.click(screen.getAllByRole('button', { name: 'Play Example Radio' })[0]);
    expect(mocks.play).toHaveBeenCalledOnce(); expect(mocks.play).toHaveBeenCalledWith(station, [station]);
  });
  it('shows failed deleted-station requests as errors instead of an empty success', async () => {
    mocks.request.mockRejectedValue(new Error('403: Admin session required'));
    wrapper(<Stations />); await screen.findAllByText('Example Radio');
    fireEvent.click(screen.getByRole('button', { name: 'Deleted' }));
    expect(await screen.findByText('Failed to load stations')).toBeInTheDocument();
    expect(screen.queryByText('No Deleted Stations')).not.toBeInTheDocument();
  });
  it('opens a functional single-station generation preflight without starting a paid job', async () => {
    wrapper(<Stations />); await screen.findAllByText('Example Radio');
    fireEvent.keyDown(screen.getAllByRole('button', { name: 'More actions for Example Radio' })[0], { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Generate AI description' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/No generation has started/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Review and start generation' })).toBeEnabled();
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it('retains existing mutation paths and does not silently strip functional actions', async () => {
    const page = await readFile('src/pages/stations.tsx', 'utf8');
    const table = await readFile('src/components/stations/station-table.tsx', 'utf8');
    for (const callback of ['onGenerateAi', 'onTranslate', 'onRecheckTags', 'onEdit', 'onDelete', 'onPlay']) expect(table).toContain(callback);
    expect(table).not.toContain('new Audio'); expect(table).toContain('StationLogo');
    expect(page).toContain('No generation has started.'); expect(page).toContain('Review and start generation');
    expect(page).toContain('skipExisting: true'); expect(page).not.toContain('staleTime: 86400000');
  });
});
