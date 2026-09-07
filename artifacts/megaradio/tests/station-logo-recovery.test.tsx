import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }) }));
import { StationLogo, getStationLogoUrl } from '../src/components/ui/station-logo';
import { clearStationLogoFailureCache, hasRecentStationLogoFailure, rememberStationLogoFailure } from '../src/lib/station-logo-failure-cache';

beforeEach(() => clearStationLogoFailureCache());
afterEach(() => vi.restoreAllMocks());

const station = { _id: 'one', name: 'Radio One', logoAssets: { status: 'completed' as const, folder: 'one',
  webp48: 'https://logos.example/one-48.webp', webp96: 'https://logos.example/one-96.webp', webp256: 'https://logos.example/one-256.webp' } };

describe('station logo source recovery', () => {
  it('shared search-thumbnail resolver uses an existing requested S3 size before stale local images', () => {
    expect(getStationLogoUrl({ ...station, localImagePath: 'obsolete.png' }, 48)).toBe(station.logoAssets.webp48);
    expect(getStationLogoUrl({ ...station, logoAssets: { folder: 'one', status: 'completed', webp48: station.logoAssets.webp48 } })).toBe(station.logoAssets.webp48);
    expect(getStationLogoUrl({ ...station, logoAssets: { folder: 'one', status: 'completed', webp256: station.logoAssets.webp256 } }, 48)).toBe(station.logoAssets.webp256);
  });
  it('retries the preferred src when a different high-DPI srcSet candidate failed', () => {
    render(<StationLogo station={station} size="card" />);
    const img = screen.getByRole('img') as HTMLImageElement;
    Object.defineProperty(img, 'currentSrc', { configurable: true, value: station.logoAssets.webp256 });
    fireEvent.error(img);
    expect(img).toHaveAttribute('src', station.logoAssets.webp96);
    expect(img).not.toHaveAttribute('srcset');
    fireEvent.load(img);
    expect(screen.getByRole('img')).toBe(img);
  });
  it('tries every existing resolution before the original favicon and inline no-image fallback', () => {
    render(<StationLogo station={{ ...station, favicon: '/original.png' }} size="hero" />);
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', station.logoAssets.webp256);
    fireEvent.error(img); expect(img).toHaveAttribute('src', station.logoAssets.webp96);
    fireEvent.error(img); expect(img).toHaveAttribute('src', station.logoAssets.webp48);
    fireEvent.error(img); expect(img).toHaveAttribute('src', '/original.png');
    fireEvent.error(img);
    expect(screen.getByRole('img', { name: 'No image' }).tagName).toBe('DIV');
  });
  it('recovers updated logo URLs for the same station after all previous sources failed', () => {
    const old = { ...station, logoAssets: undefined, favicon: '/old.png' };
    const { rerender } = render(<StationLogo station={old} />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'No image');
    rerender(<StationLogo station={{ ...old, favicon: '/repaired.png' }} />);
    expect(screen.getByRole('img')).toHaveAttribute('src', '/repaired.png');
  });
  it('does not restart a known broken URL on same-data replacement or another station identity', () => {
    const old = { ...station, logoAssets: undefined, favicon: '/broken.png' };
    const { rerender } = render(<StationLogo station={old} />);
    fireEvent.error(screen.getByRole('img'));
    rerender(<StationLogo station={{ ...old }} />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'No image');
    rerender(<StationLogo station={{ ...old, _id: 'two' }} />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'No image');
  });
  it('skips a URL that already failed in another card, but retries after the short TTL', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const old = { ...station, logoAssets: undefined, favicon: '/unavailable.png' };
    const first = render(<StationLogo station={old} />);
    fireEvent.error(screen.getByRole('img')); first.unmount();
    const second = render(<StationLogo station={old} />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'No image'); second.unmount();
    now.mockReturnValue(31001);
    render(<StationLogo station={old} />);
    expect(screen.getByRole('img')).toHaveAttribute('src', '/unavailable.png');
  });
  it('bounds the failure cache and only suppresses the exact failed responsive URL', () => {
    rememberStationLogoFailure(station.logoAssets.webp256);
    render(<StationLogo station={station} size="card" />);
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', station.logoAssets.webp96);
    expect(img.getAttribute('srcset')).toContain(station.logoAssets.webp48);
    expect(img.getAttribute('srcset')).not.toContain(station.logoAssets.webp256);
    for (let index = 0; index < 256; index++) rememberStationLogoFailure(`/failed-${index}.png`);
    expect(hasRecentStationLogoFailure(station.logoAssets.webp256)).toBe(false);
    expect(hasRecentStationLogoFailure('/failed-255.png')).toBe(true);
  });
  it('retains dimensions, responsive hints and explicit eager priority', () => {
    render(<StationLogo station={station} size="card" priority className="absolute inset-0 rounded-[9px]" alt="Localized logo" />);
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('width', '90'); expect(img).toHaveAttribute('height', '90');
    expect(img).toHaveAttribute('sizes', '90px'); expect(img).toHaveAttribute('loading', 'eager');
    expect(img).toHaveAttribute('fetchpriority', 'high'); expect(img).toHaveAttribute('alt', 'Localized logo');
    expect(img).toHaveClass('w-full', 'h-full', 'absolute', 'inset-0');
  });
});
