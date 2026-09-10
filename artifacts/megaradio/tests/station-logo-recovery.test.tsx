import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }) }));
import { StationLogo, getStationLogoUrl, hasOptimizedLogo } from '../src/components/ui/station-logo';
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
  it('uses concrete absolute S3 assets even when projected folder and status metadata are absent', () => {
    const projected = { ...station, localImagePath: 'obsolete.png', logoAssets: {
      webp96: station.logoAssets.webp96, webp256: station.logoAssets.webp256,
    } };
    expect(getStationLogoUrl(projected)).toBe(station.logoAssets.webp96);
    expect(hasOptimizedLogo(projected)).toBe(true);
    render(<StationLogo station={projected} />);
    expect(screen.getByRole('img')).toHaveAttribute('src', station.logoAssets.webp96);
    expect(screen.getByRole('img').getAttribute('srcset')).toContain(station.logoAssets.webp256);
  });
  it('preserves already rooted asset and legacy paths instead of double-prefixing them', () => {
    expect(getStationLogoUrl({ ...station, logoAssets: { status: 'completed', folder: 'one', webp96: '/station-logos/one/logo-96.webp' } }))
      .toBe('/station-logos/one/logo-96.webp');
    expect(getStationLogoUrl({ ...station, logoAssets: { status: 'completed', webp96: '/preferred.webp' } })).toBe('/preferred.webp');
    expect(getStationLogoUrl({ ...station, logoAssets: { status: 'completed', webp96: ' //logos.example/96.webp ' } })).toBe('https://logos.example/96.webp');
    for (const path of ['old.png', '/station-images/old.png', 'station-images/old.png']) {
      expect(getStationLogoUrl({ ...station, logoAssets: undefined, localImagePath: path })).toBe('/station-images/old.png');
    }
  });
  it('tries the stored original before stale local files without inventing asset filenames', () => {
    const withOriginal = { ...station, localImagePath: 'obsolete.png', logoAssets: {
      folder: 'one', status: 'completed' as const, webp96: station.logoAssets.webp96,
      original: 'https://logos.example/one-original.png',
    } };
    render(<StationLogo station={withOriginal} />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByRole('img')).toHaveAttribute('src', withOriginal.logoAssets.original);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByRole('img')).toHaveAttribute('src', '/station-images/obsolete.png');
    expect(getStationLogoUrl({ name: 'Original only', logoAssets: { folder: 'one', original: 'original.png' } })).toBe('/station-logos/one/original.png');
  });
  it('does not retry a failed S3 variant again through the favicon proxy', () => {
    const mirrored = { ...station, favicon: station.logoAssets.webp256 };
    render(<StationLogo station={mirrored} size="hero" />);
    fireEvent.error(screen.getByRole('img'));
    fireEvent.error(screen.getByRole('img'));
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByRole('img').tagName).toBe('DIV');
    // Search suggestions use the same recent-failure knowledge as cards.
    expect(getStationLogoUrl(mirrored)).toBe('/images/no-image.webp');
  });
  it('ignores incomplete jobs and filenames with no folder but retains their independent favicon fallback', () => {
    for (const assets of [
      { folder: 'one', status: 'processing' as const, webp96: station.logoAssets.webp96 },
      { status: 'completed' as const, webp96: 'logo-96.webp' },
      { folder: 'one', status: 'completed' as const },
      { folder: 'one', status: 'completed' as const, webp96: 'javascript:invalid' },
    ]) {
      const unresolved = { name: 'Unresolved', favicon: '/known-favicon.png', logoAssets: assets };
      expect(getStationLogoUrl(unresolved)).toBe('/known-favicon.png');
      expect(hasOptimizedLogo(unresolved)).toBe(false);
    }
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
    expect(screen.getByRole('img', { name: station.name }).tagName).toBe('DIV');
  });
  it('recovers updated logo URLs for the same station after all previous sources failed', () => {
    const old = { ...station, logoAssets: undefined, favicon: '/old.png' };
    const { rerender } = render(<StationLogo station={old} />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', station.name);
    rerender(<StationLogo station={{ ...old, favicon: '/repaired.png' }} />);
    expect(screen.getByRole('img')).toHaveAttribute('src', '/repaired.png');
  });
  it('does not restart a known broken URL on same-data replacement or another station identity', () => {
    const old = { ...station, logoAssets: undefined, favicon: '/broken.png' };
    const { rerender } = render(<StationLogo station={old} />);
    fireEvent.error(screen.getByRole('img'));
    rerender(<StationLogo station={{ ...old }} />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', station.name);
    rerender(<StationLogo station={{ ...old, _id: 'two' }} />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', station.name);
  });
  it('skips a URL that already failed in another card, but retries after the short TTL', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const old = { ...station, logoAssets: undefined, favicon: '/unavailable.png' };
    const first = render(<StationLogo station={old} />);
    fireEvent.error(screen.getByRole('img')); first.unmount();
    const second = render(<StationLogo station={old} />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', station.name); second.unmount();
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
    render(<StationLogo station={station} size="card" sizes="(min-width: 768px) 90px, 70px" priority className="absolute inset-0 rounded-[9px]" alt="Localized logo" />);
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('width', '90'); expect(img).toHaveAttribute('height', '90');
    expect(img).toHaveAttribute('sizes', '(min-width: 768px) 90px, 70px'); expect(img).toHaveAttribute('loading', 'eager');
    expect(img).toHaveAttribute('fetchpriority', 'high'); expect(img).toHaveAttribute('alt', 'Localized logo');
    expect(img).toHaveClass('w-full', 'h-full', 'absolute', 'inset-0');
  });
  it.each([['xs', 24], ['sm', 32], ['md', 48], ['lg', 64], ['xl', 96], ['card', 90], ['player', 105], ['hero', 200]] as const)(
    'keeps the default %s responsive size unchanged without a caller override', (size, pixels) => {
      render(<StationLogo station={station} size={size} />);
      expect(screen.getByRole('img')).toHaveAttribute('sizes', `${pixels}px`);
    },
  );
  it('does not invent smaller sources or responsive hints for an existing 256-only logo', () => {
    const single = { ...station, logoAssets: { folder: 'one', status: 'completed' as const, webp256: station.logoAssets.webp256 } };
    render(<StationLogo station={single} size="card" sizes="(min-width: 768px) 90px, 70px" />);
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', station.logoAssets.webp256);
    expect(img).not.toHaveAttribute('srcset');
    expect(img).not.toHaveAttribute('sizes');
  });
});
