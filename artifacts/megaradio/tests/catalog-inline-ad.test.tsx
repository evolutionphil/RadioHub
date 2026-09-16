import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ACTIVE_SITEMAP_LANGUAGES } from '@workspace/seo-shared/seo-config';
import { translateUrl } from '@workspace/seo-shared/url-translations';
import { usesInlineMobileCatalogAd, AD_SLOTS } from '../src/lib/advertising-placements';

vi.mock('@/components/ads/DeferredAdSenseUnit', () => ({ default: (p: any) => <aside data-testid="inline-ad" data-slot={p.adSlot} className={p.className} /> }));
import CatalogStationItems from '../src/components/ads/CatalogStationItems';
afterEach(cleanup);

for (const lang of ACTIVE_SITEMAP_LANGUAGES) {
  it(`${lang}: only supported public station grids claim the mobile footer placement`, () => {
    for (const path of ['/', '/radios', '/stations', '/genres/rock']) {
      const url = `/${lang}${path === '/' ? '' : translateUrl(path, lang)}`;
      expect(usesInlineMobileCatalogAd(url), url).toBe(true);
    }
    for (const path of ['/profile/messages', '/recommendations', '/profile/favorites', '/users', '/premium', '/station/kral-fm', '/genres']) {
      const url = `/${lang}${translateUrl(path, lang)}`;
      expect(usesInlineMobileCatalogAd(url), url).toBe(false);
    }
  });
}

it('places exactly one mobile-only ad after eight cards with four or more following', () => {
  window.history.replaceState({}, '', '/de/radios');
  const stations = Array.from({length: 60}, (_, i) => ({ id: i }));
  const view = render(<CatalogStationItems stations={stations} getKey={s => s.id}>{s => <article>{s.id}</article>}</CatalogStationItems>);
  expect(view.container.querySelectorAll('article')).toHaveLength(60);
  const ad = screen.getByTestId('inline-ad');
  expect(ad).toHaveAttribute('data-slot', AD_SLOTS.catalogFooter);
  expect(ad).toHaveClass('md:hidden', 'col-span-full', 'py-6');
  expect(Array.from(view.container.children).indexOf(ad)).toBe(8);
  view.rerender(<CatalogStationItems stations={[...stations].reverse()} getKey={s => s.id}>{s => <article>{s.id}</article>}</CatalogStationItems>);
  expect(screen.getByTestId('inline-ad')).toBe(ad);
  view.rerender(<CatalogStationItems stations={stations.slice(0, 11)} getKey={s => s.id}>{s => <article>{s.id}</article>}</CatalogStationItems>);
  expect(screen.queryByTestId('inline-ad')).toBeNull();
});

it('never inserts ads into a personal homepage tab, or an invalid/unknown route', () => {
  for (const path of ['/de?tab=favorites', '/de?view=discover', '/de/missing', '//other.test/de', '/de/profile/messages']) expect(usesInlineMobileCatalogAd(path)).toBe(false);
});

it('counts only visible stations for the minimum content threshold and insertion position', () => {
  window.history.replaceState({}, '', '/de/radios');
  const stations = Array.from({ length: 20 }, (_, id) => ({ id, isListVisible: id >= 6 }));
  const view = render(<CatalogStationItems stations={stations} getKey={station => station.id}>{station => <article>{station.id}</article>}</CatalogStationItems>);
  expect(view.container.querySelectorAll('article')).toHaveLength(14);
  expect(Array.from(view.container.children).indexOf(screen.getByTestId('inline-ad'))).toBe(8);
  expect(view.container.querySelector('article')).toHaveTextContent('6');
  // Twelve raw records are not enough when one station is explicitly hidden.
  const twelve = stations.slice(6, 18).map((station, index) => ({ ...station, isListVisible: index !== 0 }));
  view.rerender(<CatalogStationItems stations={twelve} getKey={station => station.id}>{station => <article>{station.id}</article>}</CatalogStationItems>);
  expect(view.container.querySelectorAll('article')).toHaveLength(11);
  expect(screen.queryByTestId('inline-ad')).toBeNull();
  view.rerender(<CatalogStationItems stations={twelve.map(station => ({ ...station, isListVisible: false }))} getKey={station => station.id}>{station => <article>{station.id}</article>}</CatalogStationItems>);
  expect(view.container.children).toHaveLength(0);
});
