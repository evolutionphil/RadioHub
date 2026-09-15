import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RecommendationsPage from '../src/pages/recommendations';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback || _key }) }));
vi.mock('@/hooks/useSeoRouting', () => ({ useSeoRouting: () => ({ getLocalizedUrl: (url: string) => '/de' + url }) }));
vi.mock('@/hooks/useMLRecommendations', () => ({ useMLRecommendations: () => ({ userProfile: null }) }));
vi.mock('@/hooks/useGlobalPlayer', () => ({ useGlobalPlayer: () => ({ playStation: vi.fn(), stopStation: vi.fn() }) }));
vi.mock('@/components/ui/station-card', () => ({ default: ({ station }: any) => <div data-testid="station-card">{station.name}</div> }));
beforeEach(() => vi.stubGlobal('scrollTo', vi.fn()));
afterEach(() => vi.unstubAllGlobals());
const stations = (country: string) => Array.from({ length: 24 }, (_, index) => ({ _id: country + index, name: country + ' ' + index, country, isListVisible: true }));
function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

it('country changes replace all visible recommendations and selected moods keep that country', async () => {
  const fetcher = vi.fn(async (url: string) => {
    const params = new URL(url, 'https://example.invalid').searchParams;
    return { ok: true, json: async () => ({ stations: stations(params.get('country') || '') }) };
  });
  vi.stubGlobal('fetch', fetcher);
  const view = render(<RecommendationsPage selectedCountry="Austria" />, { wrapper: wrapper() });
  await waitFor(() => expect(screen.getAllByTestId('station-card')).toHaveLength(12));
  expect(screen.getAllByTestId('station-card').every(card => card.textContent?.startsWith('Austria'))).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(1);
  view.rerender(<RecommendationsPage selectedCountry="Germany" />);
  await waitFor(() => expect(screen.getAllByTestId('station-card').every(card => card.textContent?.startsWith('Germany'))).toBe(true));
  fireEvent.click(screen.getByRole('button', { name: 'Focused' }));
  await waitFor(() => expect(screen.getAllByTestId('station-card')).toHaveLength(21));
  const request = new URL(fetcher.mock.calls.at(-1)![0], 'https://example.invalid');
  expect(request.searchParams.get('country')).toBe('Germany');
  expect(request.searchParams.get('genres')).toContain('classical');
  expect(request.searchParams.get('genres')).not.toContain('rock');
  view.unmount();
});

it('shows loading then genuine empty state, never global stations when a chosen country/mood is empty', async () => {
  let resolve: (value: any) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise(result => { resolve = result; })));
  const view = render(<RecommendationsPage selectedCountry="Austria" />, { wrapper: wrapper() });
  expect(screen.getByRole('status')).toBeTruthy();
  expect(screen.queryByText('No Recommendations Yet')).toBeNull();
  resolve!({ ok: true, json: async () => ({ stations: [] }) });
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  expect(screen.queryByTestId('station-card')).toBeNull();
  expect(screen.getByText('No Recommendations Yet')).toBeTruthy();
  view.unmount();
});
