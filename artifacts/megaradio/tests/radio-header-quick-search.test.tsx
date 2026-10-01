import React, { useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Router, useLocation } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';

const fixture = vi.hoisted(() => ({
  authenticated: false,
  playStation: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  fetchStations: vi.fn(),
  pageMount: vi.fn(),
  pageUnmount: vi.fn(),
}));

vi.mock('@assets/notification1.png', () => ({ default: 'notification1.png' }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({
  user: fixture.authenticated ? { _id: 'listener', fullName: 'Listener' } : null,
  isAuthenticated: fixture.authenticated, isLoading: false,
}) }));
vi.mock('@/hooks/useGlobalPlayer', () => ({ useGlobalPlayer: () => ({
  currentStation: { _id: 'metro', name: 'Metro FM' }, isPlaying: true,
  playStation: fixture.playStation, pause: fixture.pause, resume: fixture.resume,
}) }));
vi.mock('@/hooks/usePremiumStatus', () => ({ usePremiumStatus: () => ({ isPremium: false }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({
  t: (_key: string, fallback?: string) => fallback ?? _key, setLanguage: vi.fn(),
}) }));
vi.mock('@/hooks/useSeoRouting', () => ({ useSeoRouting: () => ({
  getLocalizedUrl: (path: string) => path, cleanPath: '/station/metro-fm',
  navigateTranslated: vi.fn(), currentLanguage: 'en',
}) }));
vi.mock('@/components/ui/UserMenuDropdown', () => ({ UserMenuDropdown: () => null }));
vi.mock('@/components/modals/AddYourStationModal', () => ({ default: () => null }));
vi.mock('@/components/HighlightMatch', () => ({ HighlightMatch: ({ text }: { text: string }) => <>{text}</> }));
vi.mock('@/utils/slugs', () => ({ getStationUrl: (station: { slug: string }) => `/station/${station.slug}` }));
vi.mock('@/lib/station-card-list-request', () => ({ fetchStationCardList: (...args: unknown[]) => fixture.fetchStations(...args) }));

import RadioHeader from '../src/components/layout/radio-header';

const originalRoute = '/de/station/metro-fm';
const jazzStation = { _id: 'jazz', slug: 'jazz-one', name: 'Jazz One', country: 'Germany' };
let client: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  fixture.authenticated = false;
  fixture.fetchStations.mockResolvedValue({ ok: true, json: async () => ({ stations: [jazzStation] }) });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).startsWith('/api/genres?')) return { ok: true, json: async () => ({ genres: [] }) };
    throw new Error(`Unexpected request: ${String(input)}`);
  }));
  client = new QueryClient({ defaultOptions: { queries: {
    retry: false, gcTime: 0, staleTime: Infinity,
    queryFn: ({ queryKey }) => { throw new Error(`Unexpected query: ${JSON.stringify(queryKey)}`); },
  } } });
  client.setQueryData(['/api/filters/countries'], ['Germany']);
  client.setQueryData(['/api/countries', 'rich'], [{ name: 'Germany', stationCount: 100 }]);
  client.setQueryData(['/api/user/notifications', 'listener', 1, 10, 'all'], { notifications: [], unreadCount: 0 });
});

afterEach(() => { cleanup(); document.body.innerHTML = ''; client.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function StationPage() {
  const [location] = useLocation();
  useEffect(() => { fixture.pageMount(); return () => { fixture.pageUnmount(); }; }, []);
  return <main data-testid="station-page">
    <h1>Metro FM</h1>
    <span>Playing Metro FM</span>
    <button>Station details</button>
    <output data-testid="current-route">{location}</output>
  </main>;
}

function mount(props?: React.ComponentProps<typeof RadioHeader>) {
  const { hook } = memoryLocation({ path: originalRoute });
  return render(<QueryClientProvider client={client}><Router hook={hook}>
    <RadioHeader {...props} />
    <StationPage />
  </Router></QueryClientProvider>);
}

function shortcut(target: EventTarget = document.body, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true, composed: true, ...init });
  fireEvent(target, event);
  return event;
}

function expectPlaybackUntouched() {
  expect(fixture.playStation).not.toHaveBeenCalled();
  expect(fixture.pause).not.toHaveBeenCalled();
  expect(fixture.resume).not.toHaveBeenCalled();
}

// The dialog and its styles load on first interaction. Parallel suites can
// spend longer than Testing Library's default second transforming that chunk.
const findSearchDialog = () => screen.findByRole('dialog', { name: 'Search' }, { timeout: 3000 });

it.each([
  ['Ctrl+K', { ctrlKey: true }],
  ['Cmd+K', { ctrlKey: false, metaKey: true }],
  ['/', { key: '/', ctrlKey: false }],
  ['Shift+7 (German /)', { key: '/', ctrlKey: false, shiftKey: true }],
])('opens quick search with %s while preserving the current page and playback', async (_name, keys) => {
  const user = userEvent.setup();
  mount();
  const page = screen.getByTestId('station-page');
  const opener = screen.getByRole('button', { name: 'Station details' });
  opener.focus();

  expect(shortcut(opener, keys).defaultPrevented).toBe(true);
  const dialog = await findSearchDialog();
  expect(within(dialog).getByRole('combobox')).toHaveFocus();
  expect(screen.getByTestId('station-page')).toBe(page);
  expect(screen.getByTestId('current-route')).toHaveTextContent(originalRoute);
  expect(fixture.pageMount).toHaveBeenCalledTimes(1);
  expect(fixture.pageUnmount).not.toHaveBeenCalled();
  expectPlaybackUntouched();

  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() => expect(opener).toHaveFocus());
  expect(screen.getByTestId('station-page')).toBe(page);
  expect(screen.getByTestId('current-route')).toHaveTextContent(originalRoute);
  expectPlaybackUntouched();
});

it.each([false, true])('uses the same modal for mobile and desktop search buttons (authenticated: %s)', async authenticated => {
  fixture.authenticated = authenticated;
  const user = userEvent.setup();
  mount();
  const mobile = screen.getByTestId(authenticated ? 'button-search-mobile' : 'button-search-mobile-guest');
  const desktop = screen.getAllByRole('button', { name: /^Search:/ }).find(button => button !== mobile)!;
  expect(desktop).toBeDefined();
  for (const trigger of [mobile, desktop]) {
    await user.click(trigger);
    const dialog = await findSearchDialog();
    expect(within(dialog).getByRole('combobox')).toHaveFocus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  }
  expect(screen.getByTestId('current-route')).toHaveTextContent(originalRoute);
  expectPlaybackUntouched();
});

it('dismisses a nonempty search with one Escape and releases scroll lock', async () => {
  const user = userEvent.setup();
  mount();
  shortcut();
  const dialog = await findSearchDialog();
  fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'jazz' } });
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(document.body).not.toHaveAttribute('data-scroll-locked');
  expect(screen.getByTestId('current-route')).toHaveTextContent(originalRoute);
  expectPlaybackUntouched();
});

it('keeps keyboard focus in the modal and closes when its backdrop is clicked', async () => {
  const user = userEvent.setup();
  mount();
  const opener = screen.getByTestId('button-search-mobile-guest');
  await user.click(opener);
  const dialog = await findSearchDialog();
  for (let count = 0; count < 4; count++) {
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
  }
  await user.tab({ shift: true });
  expect(dialog.contains(document.activeElement)).toBe(true);
  await user.click(screen.getByTestId('quick-search-overlay'));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() => expect(opener).toHaveFocus());
  expectPlaybackUntouched();
});

it.each([
  '<input />', '<textarea></textarea>', '<select><option>One</option></select>',
  '<div contenteditable="true"><span>Editor</span></div>',
  '<div contenteditable="plaintext-only"><span>Editor</span></div>',
  '<div role="dialog" aria-modal="true"><span>Another dialog</span></div>',
])('does not intercept typing or another modal: %s', async html => {
  mount();
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  document.body.append(wrapper);
  const target = wrapper.querySelector('span') ?? wrapper.firstElementChild!;
  expect(shortcut(target).defaultPrevented).toBe(false);
  expect(shortcut(target, { key: '/', ctrlKey: false }).defaultPrevented).toBe(false);
  expect(screen.queryByRole('dialog', { name: 'Search' })).not.toBeInTheDocument();
  expect(screen.getByTestId('current-route')).toHaveTextContent(originalRoute);
  expectPlaybackUntouched();
  wrapper.remove();
});

it('ignores composing, prevented, repeated and modified unrelated shortcuts', () => {
  mount();
  for (const init of [
    { isComposing: true }, { repeat: true }, { altKey: true }, { key: 'p' },
    { key: '/', ctrlKey: false, altKey: true },
  ]) shortcut(document.body, init);
  const prevented = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true });
  prevented.preventDefault();
  fireEvent(document.body, prevented);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByTestId('current-route')).toHaveTextContent(originalRoute);
  expectPlaybackUntouched();
});

it('does not register a hidden search shortcut and removes its listener on unmount', () => {
  const hidden = mount({ showSearch: false });
  expect(shortcut().defaultPrevented).toBe(false);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  hidden.unmount();
  const enabled = mount();
  enabled.unmount();
  expect(shortcut().defaultPrevented).toBe(false);
});

it('plays and navigates only when a station result is explicitly selected', async () => {
  const user = userEvent.setup();
  mount();
  shortcut();
  const dialog = await findSearchDialog();
  const input = within(dialog).getByRole('combobox');
  fireEvent.change(input, { target: { value: 'jazz' } });
  await within(dialog).findByRole('option', { name: /Jazz One/ });
  expectPlaybackUntouched();
  await user.keyboard('{ArrowDown}{Enter}');
  expect(fixture.playStation).toHaveBeenCalledTimes(1);
  expect(fixture.playStation).toHaveBeenCalledWith(jazzStation);
  expect(screen.getByTestId('current-route')).toHaveTextContent('/station/jazz-one');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

it('never activates old results while a new query is pending or too short', async () => {
  mount();
  shortcut();
  const dialog = await findSearchDialog();
  const input = within(dialog).getByRole('combobox');
  fireEvent.change(input, { target: { value: 'jazz' } });
  await within(dialog).findByRole('option', { name: /Jazz One/ });

  let finishRequest!: (value: unknown) => void;
  fixture.fetchStations.mockImplementationOnce(() => new Promise(resolve => { finishRequest = resolve; }));
  fireEvent.change(input, { target: { value: 'rock' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expectPlaybackUntouched();
  await waitFor(() => expect(fixture.fetchStations).toHaveBeenCalledTimes(2));
  fireEvent.keyDown(input, { key: 'Enter' });
  expectPlaybackUntouched();
  fireEvent.change(input, { target: { value: 'r' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expectPlaybackUntouched();
  expect(screen.getByTestId('current-route')).toHaveTextContent(originalRoute);
  await act(async () => { finishRequest({ ok: true, json: async () => ({ stations: [] }) }); });
});
