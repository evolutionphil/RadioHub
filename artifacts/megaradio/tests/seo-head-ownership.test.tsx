import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const state = vi.hoisted(() => ({
  location: '/tr/istasyon/test-radio', search: '', language: 'tr',
  data: new Map<string, unknown>(), options: [] as any[],
}));
let initialGuard: (url: string) => boolean;
vi.mock('wouter', () => ({
  useLocation: () => [state.location, vi.fn()],
  useSearch: () => state.search,
}));
vi.mock('@/hooks/useSeoRouting', () => ({
  useSeoRouting: () => ({ currentLanguage: state.language }),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ language: state.language, t: (_key: string, fallback?: string) => fallback || _key }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: any) => {
    state.options.push(options);
    return { data: state.data.get(options.queryKey.join('|')) };
  },
}));
vi.mock('@/utils/ssr-seo-head', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/utils/ssr-seo-head')>(),
  preserveInitialSsrHead: (url: string) => initialGuard(url),
}));

import { createInitialSsrHeadGuard } from '../src/utils/ssr-seo-head';
import { SeoPageWrapper } from '../src/components/SeoPageWrapper';
import { SeoHead as PageSeoHead } from '../src/components/SeoHead';
import ListStructuredData from '../src/components/seo/ListStructuredData';

function seedSsr() {
  document.head.innerHTML = `<title>Test Radyo — Canlı Dinle</title>
    <meta name="description" content="İstasyona özel Türkçe açıklama">
    <meta name="robots" content="index, follow">
    <meta property="og:locale" content="tr_TR">
    <meta property="og:image" content="https://themegaradio.com/api/og-image/test-radio">
    <link rel="canonical" data-managed="seo-head" href="https://themegaradio.com/tr/istasyon/test-radio">
    <link rel="alternate" hreflang="tr" href="https://themegaradio.com/tr/istasyon/test-radio">
    <script type="application/ld+json" data-managed="seo-structured-data" data-schema-scope="global" id="global-website">{"@id":"https://themegaradio.com/#website","@type":"WebSite","name":"Mega Radio","inLanguage":"tr"}</script>
    <script type="application/ld+json" data-managed="seo-structured-data" data-schema-scope="page">{"@type":"RadioBroadcastService","name":"Test Radyo"}</script>
    <script type="application/ld+json" id="third-party-schema">{"@type":"Organization","name":"Third party"}</script>`;
  window.__INITIAL_TRANSLATIONS__ = { meta_title: 'Ana Sayfa', meta_description: 'Ana sayfa açıklaması' };
  window.__INITIAL_LANGUAGE__ = 'tr';
}

beforeEach(() => {
  state.location = '/tr/istasyon/test-radio';
  state.search = '';
  state.language = 'tr';
  state.data.clear();
  state.options = [];
  seedSsr();
  initialGuard = createInitialSsrHeadGuard(state.location);
  vi.unstubAllGlobals();
});

describe('one owner for the initial SSR head and subsequent navigation', () => {
  it('preserves station-specific SSR tags with homepage translations and a loading child', async () => {
    const before = document.head.innerHTML;
    render(<SeoPageWrapper><PageSeoHead pageType="station" stationData={null} /><span>Station page</span></SeoPageWrapper>);
    await waitFor(() => expect(document.title).toBe('Test Radyo — Canlı Dinle'));
    expect(document.head.innerHTML).toBe(before);
    expect(state.options.find(option => option.queryKey[0] === '/api/seo/page-data').enabled).toBe(false);
  });

  it('uses current-route server tags after navigation and keeps pagination in the request', () => {
    const view = render(<SeoPageWrapper><span>Page</span></SeoPageWrapper>);
    state.location = '/de/regionen/europe/germany/stations';
    state.language = 'de';
    state.search = 'page=2';
    view.rerender(<SeoPageWrapper><span>Page two loading</span></SeoPageWrapper>);
    expect(document.title).toBe('Test Radyo — Canlı Dinle');
    const fullUrl = `${state.location}?page=2`;
    state.data.set(`/api/seo/page-data|${fullUrl}|de`, { seoTags: {
      title: 'Deutsche Radios — Seite 2', description: 'Deutsche Sender live hören.',
      canonical: `https://themegaradio.com${fullUrl}`, robots: 'index, follow',
      hreflangs: [{ hreflang: 'de', url: `https://themegaradio.com${fullUrl}` }],
    } });
    view.rerender(<SeoPageWrapper><span>Page two ready</span></SeoPageWrapper>);
    expect(document.title).toBe('Deutsche Radios — Seite 2');
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toContain('?page=2');
    expect(document.querySelectorAll('link[hreflang]')).toHaveLength(1);
    expect(state.options.at(-1).queryKey[1]).toBe(fullUrl);
    // Returning to the original URL must refresh its head, not reactivate the
    // initial-response skip after a different route changed the document.
    state.location = '/tr/istasyon/test-radio'; state.search = ''; state.language = 'tr';
    view.rerender(<SeoPageWrapper><span>Back</span></SeoPageWrapper>);
    expect(state.options.at(-1).enabled).toBe(true);
  });

  it('fetches the homepage head when no SSR marker existed; no invented homepage placeholder', () => {
    initialGuard = createInitialSsrHeadGuard(null);
    state.location = '/fr'; state.language = 'fr';
    render(<SeoPageWrapper><span>Homepage</span></SeoPageWrapper>);
    expect(state.options.at(-1).enabled).toBe(true);
    expect(document.title).toBe('Test Radyo — Canlı Dinle');
  });

  it('rejects failed page-data HTTP responses without applying an error payload', async () => {
    initialGuard = createInitialSsrHeadGuard(null);
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal('fetch', fetchMock);
    render(<SeoPageWrapper><span>Page</span></SeoPageWrapper>);
    const signal = new AbortController().signal;
    await expect(state.options.at(-1).queryFn({ signal })).rejects.toThrow('503');
    expect(fetchMock.mock.calls[0][1].signal).toBe(signal);
    expect(document.title).toBe('Test Radyo — Canlı Dinle');
  });

  it('updates robots on navigation to a noindex page', () => {
    initialGuard = createInitialSsrHeadGuard(null);
    state.location = '/tr/search';
    state.data.set('/api/seo/page-data|/tr/search|tr', { seoTags: {
      title: 'Radyo Ara', description: 'Arama', robots: 'noindex, follow',
    } });
    render(<SeoPageWrapper><span>Search</span></SeoPageWrapper>);
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex, follow');
  });

  it('replaces station A with station B schema and then a listing, preserving global and third-party nodes', () => {
    const globalNode = document.getElementById('global-website');
    const thirdParty = document.getElementById('third-party-schema');
    const content = <><PageSeoHead pageType="station" stationData={null} /><ListStructuredData type="stations" items={[{ _id: 'ignored', slug: 'ignored', name: 'Ignored client list' }]} listName="Client list" /></>;
    const view = render(<SeoPageWrapper>{content}</SeoPageWrapper>);
    state.location = '/de/sender/station-b'; state.language = 'de';
    state.data.set('/api/seo/page-data|/de/sender/station-b|de', {
      seoTags: { title: 'Admin station B title', description: 'Deutsche Senderbeschreibung', canonical: 'https://themegaradio.com/de/sender/station-b' },
      structuredData: {
        global: [{ '@id': 'https://themegaradio.com/#website', '@type': 'WebSite', name: 'Mega Radio', inLanguage: 'de' }],
        page: [{ '@type': 'RadioBroadcastService', name: 'Station B', inLanguage: 'de' }],
      },
    });
    view.rerender(<SeoPageWrapper>{content}</SeoPageWrapper>);
    const pageNodes = () => [...document.querySelectorAll('script[data-schema-scope="page"]')].map(script => JSON.parse(script.textContent || '{}'));
    expect(pageNodes()).toEqual([{ '@type': 'RadioBroadcastService', name: 'Station B', inLanguage: 'de' }]);
    expect(document.getElementById('global-website')).toBe(globalNode);
    expect(JSON.parse(globalNode?.textContent || '{}').inLanguage).toBe('de');
    expect(document.getElementById('third-party-schema')).toBe(thirdParty);
    // A later translation response must not let the child fallback component
    // overwrite authoritative admin metadata or install another JSON-LD list.
    state.data.set('/api/translations|de', { meta_title: 'Wrong homepage title' });
    view.rerender(<SeoPageWrapper>{<><PageSeoHead pageType="station" stationData={null} /><span>Data loaded</span></>}</SeoPageWrapper>);
    expect(document.title).toBe('Admin station B title');
    expect(pageNodes()).toHaveLength(1);
    state.location = '/de/genres';
    state.data.set('/api/seo/page-data|/de/genres|de', {
      seoTags: { title: 'Musikgenres', description: 'Sender nach Genre' },
      structuredData: { global: [], page: [{ '@type': 'CollectionPage', name: 'Musikgenres' }] },
    });
    view.rerender(<SeoPageWrapper><span>Genres</span></SeoPageWrapper>);
    expect(pageNodes()).toEqual([{ '@type': 'CollectionPage', name: 'Musikgenres' }]);
    expect(document.getElementById('global-website')).toBe(globalNode);
  });

  it('does not leave the previous station schema on a failed or aborted navigation', async () => {
    const view = render(<SeoPageWrapper><span>Station A</span></SeoPageWrapper>);
    state.location = '/tr/istasyon/station-b';
    view.rerender(<SeoPageWrapper><span>Station B loading</span></SeoPageWrapper>);
    expect(document.querySelectorAll('script[data-schema-scope="page"]')).toHaveLength(0);
    expect(document.getElementById('global-website')).not.toBeNull();
    const controller = new AbortController(); controller.abort();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError')));
    await expect(state.options.at(-1).queryFn({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(document.querySelectorAll('script[data-schema-scope="page"]')).toHaveLength(0);
  });

  it('country and region pages no longer race the centralized head with English metadata', () => {
    for (const file of ['CountryCitiesPage.tsx', 'RegionStationsPage.tsx']) {
      const source = readFileSync(path.resolve('src/pages', file), 'utf8');
      expect(source).not.toContain('document.title =');
      expect(source).not.toContain("window.location.href.split('?')[0]");
    }
  });

  it('the initial guard does not reactivate on back navigation or ignore query changes', () => {
    const guard = createInitialSsrHeadGuard('/en/stations?page=2');
    expect(guard('/en/stations?page=2')).toBe(true);
    expect(guard('/en/stations?page=3')).toBe(false);
    expect(guard('/en/stations?page=2')).toBe(false);
  });
});
