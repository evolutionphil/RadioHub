import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

const state = vi.hoisted(() => ({ location: '/tr', preserveSsr: true }));
vi.mock('wouter', () => ({ useLocation: () => [state.location, vi.fn()], useSearch: () => '' }));
vi.mock('@/utils/ssr-seo-head', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/utils/ssr-seo-head')>(),
  preserveInitialSsrHead: () => state.preserveSsr,
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => ({
    popular_stations_title: 'Popüler Radyolar', popular_genres_title: 'Popüler Türler',
  }[key] || fallback || key) }),
}));

import ListStructuredData from '../src/components/seo/ListStructuredData';
import { SEO_LANGUAGES, SITEMAP_PRIORITY_LANGUAGES } from '@workspace/seo-shared/seo-config';
import { translateUrl } from '@workspace/seo-shared/url-translations';
import { generateStationListData, generateGenreListData } from '../src/utils/structured-data';

const stations = [{ _id: 'abc', slug: 'test-radio', name: 'Test Radio' }];
const genres = [{ name: 'Pop', slug: 'pop' }];
const readClientSchemas = () => [...document.querySelectorAll('script[data-structured-data-owner]')]
  .map(script => JSON.parse(script.textContent || '{}'));

beforeEach(() => {
  state.location = '/tr'; state.preserveSsr = true;
  document.head.innerHTML = '<script type="application/ld+json" id="ssr-schema">{"@type":"ItemList","name":"Server list"}</script>';
});

describe('localized list JSON-LD ownership', () => {
  it('does not duplicate the initial server-rendered lists', () => {
    render(<ListStructuredData type="stations" items={stations} listName="Popular Stations" />);
    expect(document.querySelectorAll('script[type="application/ld+json"]')).toHaveLength(1);
    expect(readClientSchemas()).toHaveLength(0);
  });

  it('keeps sibling station and genre lists on client navigation and cleans up only its own nodes', () => {
    state.preserveSsr = false;
    const stationView = render(<ListStructuredData type="stations" items={stations} listName="Popular Stations" />);
    const genreView = render(<ListStructuredData type="genres" items={genres} listName="Genres" currentCountry="Germany" />);
    expect(readClientSchemas()).toHaveLength(2);
    const [stationList, genreList] = readClientSchemas();
    expect(stationList.inLanguage).toBe('tr');
    expect(stationList.name).toBe('Popüler Radyolar');
    expect(stationList.itemListElement[0].url).toBe(`${window.location.origin}/tr/istasyon/test-radio`);
    expect(genreList.itemListElement[0].url).toBe(`${window.location.origin}/tr/turler/pop`);
    expect(genreList.itemListElement[0].url).not.toContain('/germany/');
    stationView.rerender(<ListStructuredData type="stations" items={[...stations]} listName="Popular Stations" />);
    expect(readClientSchemas()).toHaveLength(2);
    stationView.unmount();
    expect(readClientSchemas()).toHaveLength(1);
    expect(document.getElementById('ssr-schema')).not.toBeNull();
    genreView.unmount();
    expect(readClientSchemas()).toHaveLength(0);
    expect(document.getElementById('ssr-schema')).not.toBeNull();
  });

  it('refreshes URLs after a client-side language change', () => {
    state.preserveSsr = false;
    const view = render(<ListStructuredData type="stations" items={stations} listName="Popular Stations" />);
    state.location = '/de';
    view.rerender(<ListStructuredData type="stations" items={stations} listName="Popular Stations" />);
    expect(readClientSchemas()).toHaveLength(1);
    expect(readClientSchemas()[0].itemListElement[0].url).toBe(`${window.location.origin}/de/sender/test-radio`);
  });

  it('uses locale-prefixed canonical route families across the 14 SEO languages', () => {
    const languages = SITEMAP_PRIORITY_LANGUAGES.universal14;
    expect(languages).toHaveLength(14);
    for (const language of languages) {
      expect(SEO_LANGUAGES.some(entry => entry.code === language)).toBe(true);
      const localizedPath = (path: string) => `/${language}${translateUrl(path, language)}`;
      expect(generateStationListData(stations, 'Stations', undefined, localizedPath).itemListElement[0].url)
        .toBe(`${window.location.origin}${localizedPath('/station/test-radio')}`);
      expect(generateGenreListData(genres, 'Germany', localizedPath).itemListElement[0].url)
        .toBe(`${window.location.origin}${localizedPath('/genres/pop')}`);
    }
  });
});
