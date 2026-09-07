import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const translationHook = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: translationHook }));
import { StationLogo } from '../src/components/ui/station-logo';
import { clearStationLogoFailureCache } from '../src/lib/station-logo-failure-cache';

const station = { _id: 'translation-scope', name: 'Radio Eins', favicon: '/station-fallback.png', logoAssets: {
  status: 'completed' as const, folder: 'translation-scope', webp96: '/preferred.webp', webp48: '/smaller.webp',
} };

beforeEach(() => {
  clearStationLogoFailureCache();
  translationHook.mockReset().mockImplementation(() => {
    // A genuine hook catches conditional-hook ordering mistakes on rerenders.
    React.useState(0);
    return { t: (_key: string, _fallback: string, params: { stationName: string }) => `Logo von ${params.stationName}` };
  });
});

it('uses supplied localized alt without mounting translation subscriptions', () => {
  const { rerender } = render(<StationLogo station={station} alt="Radio Eins hören" />);
  expect(screen.getByRole('img')).toHaveAttribute('alt', 'Radio Eins hören');
  rerender(<StationLogo station={station} alt="Radio Eins live hören" />);
  expect(screen.getByRole('img')).toHaveAttribute('alt', 'Radio Eins live hören');
  expect(translationHook).not.toHaveBeenCalled();
});

it.each([undefined, ''])('keeps the existing localized default when alt is %s', (alt) => {
  render(<StationLogo station={station} alt={alt} />);
  expect(screen.getByRole('img')).toHaveAttribute('alt', 'Logo von Radio Eins');
  expect(translationHook).toHaveBeenCalled();
});

it('can switch alt ownership without resetting image recovery or violating hook order', () => {
  const { rerender } = render(<StationLogo station={station} alt="Supplied text" />);
  fireEvent.error(screen.getByRole('img'));
  const recoveredSource = screen.getByRole('img').getAttribute('src');
  expect(recoveredSource).toContain('smaller.webp');
  rerender(<StationLogo station={station} />);
  expect(screen.getByRole('img')).toHaveAttribute('alt', 'Logo von Radio Eins');
  expect(screen.getByRole('img')).toHaveAttribute('src', recoveredSource);
  translationHook.mockClear();
  rerender(<StationLogo station={station} alt="Supplied again" />);
  expect(screen.getByRole('img')).toHaveAttribute('src', recoveredSource);
  expect(translationHook).not.toHaveBeenCalled();
});

it('substitutes the imported underscore-separated station placeholder', () => {
  translationHook.mockImplementation(() => ({
    t: (_key: string, _fallback: string, params: Record<string, string>) =>
      '{STATION_NAME} Logo'.replace(/\{([^}]+)\}/g, (match, key) => params[key] ?? match),
  }));
  render(<StationLogo station={station} />);
  expect(screen.getByRole('img')).toHaveAttribute('alt', 'Radio Eins Logo');
});
