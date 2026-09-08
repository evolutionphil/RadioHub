import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getStationImageAlt } from '@workspace/seo-shared/station-image-alt';
import { LOCALIZED_LOGO_WORD, SITEMAP_PRIORITY_LANGUAGES } from '@workspace/seo-shared/seo-config';

const state = vi.hoisted(() => ({ language: 'en', translations: {} as Record<string, string>, isPlaying: false }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ language: state.language,
  t: (key: string, fallback?: string) => state.translations[key] ?? fallback ?? key }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/useGlobalPlayer', () => ({ useGlobalPlayer: () => ({ currentStation: { _id: 'test-radio' }, isPlaying: state.isPlaying,
  stopStation: vi.fn(), playStation: vi.fn() }) }));
vi.mock('@/components/ui/favorite-button', () => ({ default: () => null }));
vi.mock('@/components/ui/station-logo', () => ({ StationLogo: ({ alt, sizes }: { alt: string; sizes?: string }) => <img src="/logo.png" alt={alt} sizes={sizes} /> }));
vi.mock('@/utils/slugs', () => ({ getStationUrl: () => '/en/station/test-radio' }));
vi.mock('wouter', () => ({ useLocation: () => ['/en', vi.fn()],
  Link: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));

import StationCard from '../src/components/ui/station-card';
const station = { _id: 'test-radio', name: 'Test Radio', country: 'Germany', genre: 'rock' };
beforeEach(() => { state.language = 'en'; state.translations = {}; state.isPlaying = false; });

describe('station card accessible text', () => {
  it('reports the existing 70px mobile and 90px desktop logo slot without changing its layout', () => {
    render(<StationCard station={station} />);
    const image = screen.getByRole('img');
    expect(image).toHaveAttribute('sizes', '(min-width: 768px) 90px, 70px');
    expect(image.closest('a')).toHaveClass('w-[70px]', 'h-[70px]', 'md:w-[90px]', 'md:h-[90px]');
  });
  it('replaces the exact English legacy default in a German dictionary with its localized play action', () => {
    state.language = 'de'; state.translations = { seo_listen_to_station: 'Listen to ${station.name}', btn_play: 'Play Radio', player_play_station: 'Station abspielen' };
    render(<StationCard station={station} />);
    expect(screen.getByRole('img').closest('a')).toHaveAttribute('aria-label', 'Station abspielen — Test Radio');
    expect(screen.getByRole('button', { name: 'Station abspielen' })).toBeInTheDocument();
  });
  it.each(['Listen to ${station.name}', 'Höre {NAME}', 'Höre ${name}'])('safely interpolates the legacy/full dictionary label %s', template => {
    state.translations.seo_listen_to_station = template;
    render(<StationCard station={{ ...station, name: 'Radio $& <One>' }} />);
    const logoLink = screen.getByRole('img').closest('a')!;
    expect(logoLink.getAttribute('aria-label')).toContain('Radio $& <One>');
    expect(logoLink.getAttribute('aria-label')).not.toMatch(/\$\{|\{NAME\}/);
  });
  it.each(['Höre ${station.name ||', '${station.name.toUpperCase()}', '{missing}', '   '])('falls back to a translated action for invalid template %s', template => {
    state.language = 'de'; state.translations = { seo_listen_to_station: template, btn_play: 'Abspielen' };
    render(<StationCard station={station} />);
    expect(screen.getByRole('img').closest('a')).toHaveAttribute('aria-label', 'Abspielen — Test Radio');
  });
  it('localizes play/stop controls and country display while preserving the state proper name and original station data', () => {
    state.language = 'de'; state.translations = { btn_play: 'Play Radio', btn_stop: 'Stop Radio', player_play_station: 'Station abspielen', player_stop: 'Stoppen' };
    const record = { ...station, country: 'Austria', state: 'Vienna' };
    const { rerender } = render(<StationCard station={record} />);
    expect(screen.getByRole('button', { name: 'Station abspielen' })).toBeInTheDocument();
    expect(screen.getByText('Österreich')).toBeInTheDocument(); expect(screen.getByText(', Vienna')).toBeInTheDocument();
    expect(record.country).toBe('Austria');
    state.isPlaying = true; rerender(<StationCard station={{ ...record }} />);
    expect(screen.getByRole('button', { name: 'Stoppen' })).toBeInTheDocument();
  });
  it('retains btn_* fallbacks when the more specific player translations are absent', () => {
    state.translations = { btn_play: 'Legacy play', btn_stop: 'Legacy stop' };
    const { rerender } = render(<StationCard station={station} />);
    expect(screen.getByRole('button', { name: 'Legacy play' })).toBeInTheDocument();
    state.isPlaying = true; rerender(<StationCard station={{ ...station }} />);
    expect(screen.getByRole('button', { name: 'Legacy stop' })).toBeInTheDocument();
  });
  it('preserves and safely interpolates valid localized alt templates', () => {
    state.language = 'tr';
    state.translations.seo_station_logo_alt_with_country = '{NAME}: {country} ülkesinden {genre} radyosu';
    render(<StationCard station={{ ...station, name: "Test $& Radio" }} />);
    expect(screen.getByRole('img')).toHaveAttribute('alt', 'Test $& Radio: Germany ülkesinden rock radyosu');
  });
  it('falls back to a complete localized image description for the exact corrupted legacy template', () => {
    state.language = 'ja';
    state.translations.seo_station_logo_alt_with_country = 'Listen to ${station.name} live from ${station.country} - ${station.genre ||';
    render(<StationCard station={station} />);
    expect(screen.getByRole('img')).toHaveAttribute('alt', 'Test Radio ロゴ — Germany');
  });
  it.each([null, undefined, NaN, Infinity, -Infinity, -1, '', '1.2', false])('hides invalid distance %s', distance => {
    const { container } = render(<StationCard station={{ ...station, distance }} />);
    expect(container.querySelector('[title$="away from your location"]')).toBeNull();
    expect(container.textContent).not.toMatch(/\bkm\b|nullkm|undefinedkm/);
  });
  it.each([0, 1.2, 100])('retains valid distance %s without changing markup', distance => {
    render(<StationCard station={{ ...station, distance }} />);
    expect(screen.getByText(`${distance}km`)).toBeInTheDocument();
    expect(screen.getByTitle(`${distance}km away from your location`)).toBeInTheDocument();
  });
  it('preserves station navigation and playback callbacks', async () => {
    const onNavigate = vi.fn(), onPlay = vi.fn();
    render(<StationCard station={station} onNavigate={onNavigate} onPlay={onPlay} />);
    fireEvent.click(screen.getByRole('img'));
    await waitFor(() => expect(onPlay).toHaveBeenCalledWith(station, 'random'));
    expect(onNavigate).toHaveBeenCalledWith(station);
  });
});

describe('shared station image alt fallback', () => {
  it('covers every supported locale and missing-country variant', () => {
    for (const language of SITEMAP_PRIORITY_LANGUAGES.universal14) {
      expect(getStationImageAlt({ name: 'Radio', country: ' ' }, language, (_key, fallback) => fallback))
        .toBe(`Radio ${LOCALIZED_LOGO_WORD[language]}`);
    }
  });
  it.each(['${name}', '   ', '${station.genre ||'])('rejects malformed placeholders %s', template => {
    expect(getStationImageAlt(station, 'en', () => template)).toBe('Test Radio logo — Germany');
  });
  it('keeps valid custom text without requiring a placeholder', () => {
    expect(getStationImageAlt(station, 'en', () => 'Official station artwork {HD}')).toBe('Official station artwork {HD}');
  });
});
