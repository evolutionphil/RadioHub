import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getStationImageAlt } from '@workspace/seo-shared/station-image-alt';
import { LOCALIZED_LOGO_WORD, SITEMAP_PRIORITY_LANGUAGES } from '@workspace/seo-shared/seo-config';

const state = vi.hoisted(() => ({ language: 'en', translations: {} as Record<string, string> }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ language: state.language,
  t: (key: string, fallback?: string) => state.translations[key] ?? fallback ?? key }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/useGlobalPlayer', () => ({ useGlobalPlayer: () => ({ currentStation: null, isPlaying: false,
  stopStation: vi.fn(), playStation: vi.fn() }) }));
vi.mock('@/components/ui/favorite-button', () => ({ default: () => null }));
vi.mock('@/components/ui/station-logo', () => ({ StationLogo: ({ alt }: { alt: string }) => <img src="/logo.png" alt={alt} /> }));
vi.mock('@/utils/slugs', () => ({ getStationUrl: () => '/en/station/test-radio' }));
vi.mock('wouter', () => ({ useLocation: () => ['/en', vi.fn()],
  Link: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));

import StationCard from '../src/components/ui/station-card';
const station = { _id: 'test-radio', name: 'Test Radio', country: 'Germany', genre: 'rock' };
beforeEach(() => { state.language = 'en'; state.translations = {}; });

describe('station card accessible text', () => {
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
