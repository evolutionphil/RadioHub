import React, { type ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { COUNTRY_TO_LANGUAGE, SEO_LANGUAGES } from '@workspace/seo-shared/seo-config';
import { URL_TRANSLATIONS } from '@workspace/seo-shared/url-translations';

const routing = vi.hoisted(() => ({
  allCandidates: null as any,
  routes: [] as Array<{ path?: string; component?: any }>,
  selected: undefined as { path?: string; component?: any } | undefined,
}));

vi.mock('../src/lib/seo-route-candidates', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/lib/seo-route-candidates')>();
  return { getSeoRouteCandidates: (path: string) => routing.allCandidates || actual.getSeoRouteCandidates(path) };
});

// Observe the real App JSX and let the installed Wouter Switch/Route do all
// matching/reconciliation. Only the selected page's network-heavy contents
// are replaced by a persistent input, with one probe per real component type.
vi.mock('wouter', async importOriginal => {
  const actual = await importOriginal<typeof import('wouter')>();
  const probes = new Map<any, React.ComponentType>();
  const flatten = (children: ReactNode): React.ReactElement[] => React.Children.toArray(children).flatMap(child =>
    React.isValidElement<{ children?: ReactNode }>(child)
      ? child.type === React.Fragment ? flatten(child.props.children) : [child]
      : []);
  return {
    ...actual,
    Switch: ({ children, ...props }: any) => {
      routing.routes = flatten(children).map(child => child.props as any);
      return <actual.Switch {...props}>{children}</actual.Switch>;
    },
    Route: (props: any) => {
      routing.selected = props;
      const identity = props.component || 'children';
      if (!probes.has(identity)) probes.set(identity, () => <input aria-label="Route state" defaultValue="initial" />);
      return <actual.Route {...props} component={probes.get(identity)} />;
    },
  };
});

import { SeoMainRouter } from '../src/App';

const languages = SEO_LANGUAGES.filter(language => language.enabled && language.code !== 'en');
const countries = Object.entries(COUNTRY_TO_LANGUAGE).filter(([country, language]) =>
  country !== language && SEO_LANGUAGES.some(candidate => candidate.code === language && candidate.enabled));
const prefixes = [...new Set([...languages.map(language => language.code), ...countries.map(([country]) => country)])];

async function navigate(path: string) {
  await act(async () => { window.history.pushState({}, '', path); });
}

beforeEach(() => {
  routing.allCandidates = null;
  routing.routes = [];
  routing.selected = undefined;
  window.history.replaceState({}, '', '/de');
});

it('constructs only the matching prefix group while preserving every locale/country route and its order', async () => {
  // Evaluate the same JSX with the original unfiltered candidate sets once.
  routing.allCandidates = { languages, countries };
  const view = render(<SeoMainRouter />);
  const before = routing.routes.slice();
  const shape = (route: typeof before[number]) => [route.path, route.component?.name || route.component];
  const generatedPrefix = (path?: string) => /^\/([^/:]+)(?:\/|$)/.exec(path || '')?.[1];
  const generated = new Set(prefixes);
  const always = before.filter(route => !generated.has(generatedPrefix(route.path) || ''));
  expect(before.length).toBeGreaterThan(10_000);
  routing.allCandidates = null;
  view.unmount();
  render(<SeoMainRouter />);
  const homeCount = routing.routes.length;

  for (const prefix of [...prefixes, 'en', 'unknown', 'deeper']) {
    await navigate(`/${prefix}`);
    const expected = before.filter(route => {
      const first = generatedPrefix(route.path);
      return !generated.has(first || '') || first === prefix;
    });
    expect(routing.routes.map(shape), prefix).toEqual(expected.map(shape));
    expect(routing.routes.length, prefix).toBeLessThan(300);
    expect(routing.selected?.component?.name, prefix).toBe('PlayerWrapper');
  }
  expect(always.length).toBeGreaterThan(50);
  expect(homeCount / before.length).toBeLessThan(0.02);
  console.info(`SeoMainRouter route elements: ${before.length} before; ${homeCount} at /de; ${always.length} unprefixed/fallback routes`);
});

it('keeps the selected page instance through locale, country, alias, uppercase and back navigation', async () => {
  render(<SeoMainRouter />);
  const input = screen.getByRole('textbox', { name: 'Route state' });
  const component = routing.selected?.component;
  fireEvent.change(input, { target: { value: 'Listening station stays mounted' } });
  for (const path of [
    '/de/sender/test-radio', '/tr/istasyon/test-radio', '/at/sender/test-radio',
    '/en/station/test-radio', '/DE/sender/test-radio', '/ar/station/test-radio',
    '/de/profile/messages/listener', '/de/profil/messages/listener',
    '/de/premium/success', '/de/unknown/deep/path',
  ]) {
    await navigate(path);
    expect(routing.selected?.component, path).toBe(component);
    expect(screen.getByRole('textbox'), path).toBe(input);
    expect(input, path).toHaveValue('Listening station stays mounted');
  }
  await act(async () => {
    window.history.replaceState({}, '', '/de');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  expect(screen.getByRole('textbox')).toBe(input);
});

it('retains specialized translated routes, language-first overlaps and the generic fallback', async () => {
  render(<SeoMainRouter />);
  for (const language of languages) {
    const translations = URL_TRANSLATIONS[language.code];
    await navigate(`/${language.code}/${translations?.applications || 'applications'}`);
    expect(routing.selected?.component?.name, language.code).toBe('ApplicationsWrapper');
    await navigate(`/${language.code}/${translations?.trending || 'trending'}`);
    expect(routing.selected?.path, language.code).toBe(`/${language.code}/${translations?.trending || 'trending'}`);
    expect(routing.selected?.component?.name, language.code).not.toBe('PlayerWrapper');
  }
  await navigate('/ar/trending');
  expect(routing.selected?.component?.name).not.toBe('PlayerWrapper');
  await navigate('/unknown/nested/route');
  expect(routing.selected?.path).toBe('/:countryCode/*');
  await navigate('/api-docs/authentication');
  expect(routing.selected?.path).toBe('/api-docs/:category?');
});
