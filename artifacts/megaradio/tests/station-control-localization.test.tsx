import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ACTIVE_SITEMAP_LANGUAGES } from '@workspace/seo-shared/seo-config';
import { getStationImageAlt } from '@workspace/seo-shared/station-image-alt';
import { getStationControlLabels } from '../src/utils/station-control-labels';
import { getStationStreamUnavailableNotice } from '@workspace/seo-shared/station-page-copy';
import { StationStreamAvailability } from '@/components/StationStreamAvailability';

const state = vi.hoisted(() => ({ isPlaying: false, currentStation: null as any,
  playStation: vi.fn(), pauseStation: vi.fn(), resumeStation: vi.fn(), previousStation: vi.fn(), nextStation: vi.fn(),
  apiRequest: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('@/hooks/useGlobalPlayer', () => ({ useGlobalPlayer: () => state }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => { throw new Error('Controls must reuse their parent translator'); } }));
vi.mock('@/lib/queryClient', () => ({ apiRequest: state.apiRequest }));
vi.mock('@/components/ui/favorite-button', () => ({ default: () => <button aria-label="fixture favorite" /> }));
import StationControlButtonGroup from '../src/components/ui/station-control-button-group';

const station = { _id: 'fixture-radio', name: 'Radio $& <One>' };
let client: QueryClient;
beforeEach(() => {
  state.isPlaying = false; state.currentStation = null; vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
});
afterEach(() => { cleanup(); client.clear(); });
const missing = (_key: string, fallback: string) => fallback;
const wrap = (labels: ReturnType<typeof getStationControlLabels>) =>
  <QueryClientProvider client={client}><StationControlButtonGroup currentPageStation={station} labels={labels} /></QueryClientProvider>;

it.each(ACTIVE_SITEMAP_LANGUAGES)('%s controls and image text have same-language fallbacks without adding translation observers', language => {
  const labels = getStationControlLabels(language);
  const english = getStationControlLabels('en');
  for (const key of Object.keys(labels) as (keyof typeof labels)[]) {
    expect(labels[key].trim()).not.toBe('');
    if (language !== 'en') expect(labels[key]).not.toBe(english[key]);
  }
  render(wrap(labels));
  for (const key of ['play', 'previous', 'next', 'vote'] as const) {
    expect(screen.getByRole('button', { name: labels[key] })).toHaveAttribute('title', labels[key]);
  }
  expect(screen.getByTestId('button-play-stop')).toHaveStyle({ width: '50px', height: '50px' });
  const alt = getStationImageAlt(station, language, missing);
  expect(alt).toContain(station.name);
  expect(alt).not.toContain('Listen ');
});

it('honors existing Turkish dictionary values and retains play/previous/next/vote operations', async () => {
  const dictionary: Record<string, string> = { player_play_station: 'İstasyonu Çal', player_stop: 'Durdur',
    previous: 'Önceki', next: 'İleri', button_share_station: 'İstasyonu Paylaş', general_close: 'Kapat' };
  const labels = getStationControlLabels('tr', dictionary);
  expect(labels.share).toBe('İstasyonu Paylaş'); expect(labels.vote).toBe('Bu istasyona oy ver');
  const view = render(wrap(labels));
  fireEvent.click(screen.getByRole('button', { name: 'İstasyonu Çal' }));
  expect(state.playStation).toHaveBeenCalledWith(station);
  fireEvent.click(screen.getByRole('button', { name: 'Önceki' }));
  fireEvent.click(screen.getByRole('button', { name: 'İleri' }));
  expect(state.previousStation).toHaveBeenCalledTimes(1); expect(state.nextStation).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: labels.vote }));
  await waitFor(() => expect(state.apiRequest).toHaveBeenCalledWith('POST', '/api/stations/fixture-radio/vote'));
  state.isPlaying = true; state.currentStation = station; view.rerender(wrap(labels));
  fireEvent.click(screen.getByRole('button', { name: 'Durdur' }));
  expect(state.pauseStation).toHaveBeenCalledTimes(1);
});

it('preserves custom dictionary labels and repairs only missing/empty/key-echo values', () => {
  expect(getStationControlLabels('de', { player_play_station: 'Custom action' }).play).toBe('Custom action');
  for (const value of ['', 'player_play_station', 'Homepage corrupted', 'Title']) {
    expect(getStationControlLabels('tr', { player_play_station: value })).toEqual(getStationControlLabels('tr'));
  }
});

it.each(ACTIVE_SITEMAP_LANGUAGES)('%s: confirmed-unavailable notice retains manual retry and all other controls', language => {
  const labels = getStationControlLabels(language), failed = { ...station, lastCheckOk: false,isListVisible:false };
  const content = (record: any) => <QueryClientProvider client={client}>
    <article>Preserved station article</article>
    <StationControlButtonGroup currentPageStation={record} labels={labels} />
    <StationStreamAvailability station={record} language={language} />
  </QueryClientProvider>;
  const view = render(content(failed));
  expect(screen.getByRole('status')).toHaveTextContent(getStationStreamUnavailableNotice(language));
  expect(screen.getByTestId('button-play-stop')).toBeEnabled();
  expect(screen.getByTestId('button-play-stop')).toHaveAttribute('aria-describedby', 'station-stream-unavailable');
  fireEvent.click(screen.getByTestId('button-play-stop'));
  expect(state.playStation).toHaveBeenCalledWith(failed);
  expect(screen.getByRole('article')).toHaveTextContent('Preserved station article');
  expect(screen.getByTestId('button-next-station')).toBeEnabled();
  expect(screen.getByRole('button', { name: 'fixture favorite' })).toBeEnabled();
  view.rerender(content({ ...station, lastCheckOk: false,isListVisible:true }));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByTestId('button-play-stop')).toBeEnabled();
  fireEvent.click(screen.getByTestId('button-play-stop'));
  expect(state.playStation).toHaveBeenCalledWith({ ...station, lastCheckOk: false,isListVisible:true });
});

it('keeps Stop enabled for an already playing failed station and normalizes notice locale variants', () => {
  state.isPlaying = true; state.currentStation = station;
  render(<QueryClientProvider client={client}><StationControlButtonGroup currentPageStation={{ ...station, lastCheckOk: false }} labels={getStationControlLabels('de')} /></QueryClientProvider>);
  expect(screen.getByTestId('button-play-stop')).toBeEnabled();
  fireEvent.click(screen.getByTestId('button-play-stop'));
  expect(state.pauseStation).toHaveBeenCalledTimes(1);
  expect(getStationStreamUnavailableNotice('DE_at')).toBe(getStationStreamUnavailableNotice('de'));
});

it('station details wires localized share/play/alt values while all existing player callers pass parent labels', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/pages/stations/[id].tsx'), 'utf8');
  expect(source.match(/alt=\{controlLabels.share\}/g)).toHaveLength(2);
  expect(source.match(/aria-label=\{controlLabels.share\}/g)).toHaveLength(2);
  expect(source.match(/<span className="sr-only">\{controlLabels.play\}<\/span>/g)).toHaveLength(2);
  expect(source).toContain('getStationImageAlt(similarStation, language, t)');
  expect(source).toContain('getStationImageAlt(countryStation, language, t)');
  expect(source).toContain('getStationImageAlt(linkedStation, language, t)');
  expect(source).toContain('<StationStreamAvailability station={station} language={language} />');
  expect(/alt="Share"|aria-label="Share station"|alt=\{`Listen \$\{|>Play Radio</.test(source)).toBe(false);
  for (const filename of ['src/components/global-player.tsx', 'src/components/ui/bottom-player.tsx', 'src/pages/stations/[id].tsx']) {
    const caller = readFileSync(path.resolve(process.cwd(), filename), 'utf8');
    const uses = caller.match(/<StationControlButtonGroup\b[^>]*>/g) || [];
    expect(uses.length).toBeGreaterThan(0);
    for (const use of uses) expect(use).toContain('labels=');
  }
});
