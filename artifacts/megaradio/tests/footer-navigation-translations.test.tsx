import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const state = vi.hoisted(() => ({ values: {} as Record<string, string> }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: string, fallback: string) => state.values[key] ?? fallback, isLoading: false }) }));
vi.mock('@/hooks/useGlobalPlayer', () => ({ useGlobalPlayer: () => ({ currentStation: null }) }));
vi.mock('@/hooks/useSeoRouting', () => ({ useSeoRouting: () => ({ getLocalizedUrl: (path: string) => `/de${path}`, currentLanguage: 'de', changeLanguage: vi.fn() }) }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: [] }) }));
vi.mock('@/components/ads/AdSenseUnit', () => ({ default: () => null }));
vi.mock('wouter', () => ({ Link: ({ children, to, href, ...props }: any) => <a {...props} href={to || href}>{children}</a>, useLocation: () => ['/de', vi.fn()] }));
import Footer from '../src/components/layout/footer';
beforeEach(() => { state.values = { nav_for_you: 'Für Sie', users: 'Nutzer' }; });

it('uses verified existing German navigation translations without changing destinations', () => {
  render(<Footer />);
  expect(screen.getByRole('link', { name: 'Für Sie' })).toHaveAttribute('href', '/de/recommendations');
  expect(screen.getByRole('link', { name: 'Nutzer' })).toHaveAttribute('href', '/de/users');
  expect(screen.queryByRole('link', { name: 'Recommendations' })).toBeNull();
  expect(screen.queryByRole('link', { name: 'Listeners' })).toBeNull();
});
it('preserves custom footer translations over the shared-label fallback', () => {
  state.values.footer_recommendations = 'Eigene Empfehlungen'; state.values.footer_users = 'Unsere Hörergemeinschaft';
  render(<Footer />);
  expect(screen.getByRole('link', { name: 'Eigene Empfehlungen' })).toHaveAttribute('href', '/de/recommendations');
  expect(screen.getByRole('link', { name: 'Unsere Hörergemeinschaft' })).toHaveAttribute('href', '/de/users');
});
