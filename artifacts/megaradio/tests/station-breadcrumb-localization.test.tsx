import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ACTIVE_SITEMAP_LANGUAGES } from '@workspace/seo-shared/seo-config';
import { URL_TRANSLATIONS } from '@workspace/seo-shared/url-translations';
const state = vi.hoisted(() => ({ location: '/tr/istasyon/kral-fm' }));
vi.mock('wouter', () => ({ useLocation: () => [state.location], Link: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a> }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: string, fallback: string) => key === 'nav_stations' ? 'Fixture directory label' : fallback }) }));
import { RouteBreadcrumbs } from '../src/components/RouteBreadcrumbs';
afterEach(cleanup);

it.each(ACTIVE_SITEMAP_LANGUAGES)('%s station breadcrumb uses the plural catalog path, retaining the singular detail URL', language => {
  const translations = URL_TRANSLATIONS[language];
  const segment = translations?.station || 'station';
  state.location = `/${language}/${segment}/kral-fm`;
  render(<RouteBreadcrumbs />);
  expect(screen.getByRole('link', { name: 'Fixture directory label' })).toHaveAttribute('href', `/${language}/${translations?.stations || 'stations'}`);
  expect(screen.getByRole('link', { name: 'Kral Fm' })).toHaveAttribute('href', state.location);
});
