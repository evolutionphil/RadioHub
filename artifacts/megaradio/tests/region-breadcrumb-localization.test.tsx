import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ACTIVE_SITEMAP_LANGUAGES } from '@workspace/seo-shared/seo-config';
import { URL_TRANSLATIONS } from '@workspace/seo-shared/url-translations';
import { getLocalizedCountryName, getLocalizedRegionName } from '@workspace/seo-shared/country-name-translations';

const state = vi.hoisted(() => ({ location: '/en/regions', translations: {} as Record<string, string> }));
vi.mock('wouter', () => ({
  useLocation: () => [state.location],
  Link: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({
  localeTranslations: state.translations,
  t: (key: string, fallback: string) => ({ nav_home: 'Home', nav_regions: 'Radio by Country', nav_stations: 'All Stations' }[key] || fallback),
}) }));
import { RouteBreadcrumbs } from '../src/components/RouteBreadcrumbs';

afterEach(() => { cleanup(); state.translations = {}; });

it.each(ACTIVE_SITEMAP_LANGUAGES)('%s region station breadcrumbs retain the location hierarchy and full final route', language => {
  const routes = URL_TRANSLATIONS[language] || {};
  const root = `/${language}/${routes.regions || 'regions'}`;
  const stations = routes.stations || 'stations';
  const region = getLocalizedRegionName('Europe', language);
  const country = getLocalizedCountryName('Germany', language);
  for (const [suffix, names, paths] of [
    [`/europe/germany/${stations}`, ['Home', 'Radio by Country', region, country], [`/${language}`, root, `${root}/europe`, `${root}/europe/germany/${stations}`]],
    [`/europe/germany/berlin/${stations}`, ['Home', 'Radio by Country', region, country, 'Berlin'], [`/${language}`, root, `${root}/europe`, `${root}/europe/germany`, `${root}/europe/germany/berlin/${stations}`]],
    [`/europe/germany/all/${stations}`, ['Home', 'Radio by Country', region, country, 'All'], [`/${language}`, root, `${root}/europe`, `${root}/europe/germany`, `${root}/europe/germany/all/${stations}`]],
  ] as const) {
    state.location = `${root}${suffix}`;
    const view = render(<RouteBreadcrumbs />);
    const links = screen.getAllByRole('link');
    expect(links.map(link => link.textContent)).toEqual(names);
    expect(links.map(link => link.getAttribute('href'))).toEqual(paths);
    expect(links.at(-1)).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('link', { name: 'All Stations' })).not.toBeInTheDocument();
    view.unmount();
  }
});

it.each([['de', 'Europa', 'Deutschland'], ['tr', 'Avrupa', 'Almanya'], ['he', 'אירופה', 'גרמניה']])('%s localizes continent and country labels without changing their slugs', (language, region, country) => {
  state.location = `/${language}/regions/europe/germany/berlin/stations`;
  render(<RouteBreadcrumbs />);
  expect(screen.getByRole('link', { name: region })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: country })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Berlin' })).toBeInTheDocument();
});

it('keeps current-locale custom names ahead of the standard localized names', () => {
  state.location = '/de/regions/europe/germany/stations';
  state.translations = { nav_europe: 'Europa entdecken', nav_germany: 'Deutsche Radios' };
  render(<RouteBreadcrumbs />);
  expect(screen.getByRole('link', { name: 'Europa entdecken' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Deutsche Radios' })).toBeInTheDocument();
});

it.each(['/regions', '/regions/europe', '/regions/europe/germany'])('keeps the existing directory ancestry for %s', path => {
  state.location = `/en${path}`;
  render(<RouteBreadcrumbs />);
  const segments = path.split('/').filter(Boolean);
  const expectedPaths = ['/en', ...segments.map((_, index) => `/en/${segments.slice(0, index + 1).join('/')}`)];
  expect(screen.getAllByRole('link').map(link => link.getAttribute('href'))).toEqual(expectedPaths);
});
