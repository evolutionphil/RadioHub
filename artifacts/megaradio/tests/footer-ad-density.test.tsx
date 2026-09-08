import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ACTIVE_SITEMAP_LANGUAGES } from '@workspace/seo-shared/seo-config';
import { translateUrl } from '@workspace/seo-shared/url-translations';
import { AD_SLOTS } from '../src/lib/advertising-placements';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback, isLoading: false }) }));
vi.mock('@/hooks/useGlobalPlayer', () => ({ useGlobalPlayer: () => ({ currentStation: null }) }));
vi.mock('@/hooks/useSeoRouting', () => ({ useSeoRouting: () => ({ getLocalizedUrl: (path: string) => `/de${path}`, currentLanguage: 'de', changeLanguage: vi.fn() }) }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: [] }) }));
vi.mock('@/components/ads/AdSenseUnit', () => ({ default: ({ adSlot }: { adSlot: string }) => <div data-testid="footer-ad" data-slot={adSlot} /> }));
import Footer from '../src/components/layout/footer';

afterEach(cleanup);
for (const language of ACTIVE_SITEMAP_LANGUAGES) {
  it(`${language}: has no footer ad on any personal, payment or station page`, () => {
    const view = render(<Footer />);
    for (const path of ['/profile', '/profile/favorites', '/profile/discover', '/profile/messages/user-id', '/profile/notifications', '/profile/settings', '/users/test-user', '/login', '/premium', '/activate', '/station/kral-fm']) {
      window.history.replaceState({}, '', `/${language}${translateUrl(path, language)}`);
      view.rerender(<Footer />);
      expect(screen.queryByTestId('footer-ad'), `${language}${path}`).toBeNull();
    }
  });

  it(`${language}: mounts only one controlled footer unit on a public home/catalog`, () => {
    const view = render(<Footer />);
    for (const path of ['', '/genres']) {
      window.history.replaceState({}, '', `/${language}${path ? translateUrl(path, language) : ''}`);
      view.rerender(<Footer />);
      expect(screen.getAllByTestId('footer-ad')).toHaveLength(1);
      expect(screen.getByTestId('footer-ad')).toHaveAttribute('data-slot', AD_SLOTS.catalogFooter);
    }
  });
}

it('blocks personal homepage tab variants and unknown routes without removing the footer navigation', () => {
  const view = render(<Footer />);
  for (const path of ['/de?tab=favorites', '/tr?view=discover', '/de/missing/nested/page']) {
    window.history.replaceState({}, '', path);
    view.rerender(<Footer />);
    expect(screen.queryByTestId('footer-ad')).toBeNull();
    expect(screen.getByRole('link', { name: 'MegaRadio', exact: true })).toBeVisible();
  }
});
