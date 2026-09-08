import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider as BaseQueryClientProvider } from '@tanstack/react-query';
import { TranslationProvider, useTranslation } from '../src/hooks/useTranslation';
import { SeoHead } from '../src/components/SeoHead';
import { ServerSeoHeadContext } from '../src/utils/ssr-seo-head';
import { ACTIVE_SITEMAP_LANGUAGES } from '@workspace/seo-shared/seo-config';
import { getStationControlLabels } from '../src/utils/station-control-labels';

let client: QueryClient;
let result: ReturnType<typeof useTranslation>;
let requests: string[];

function QueryClientProvider({ children, ...props }: React.ComponentProps<typeof BaseQueryClientProvider>) {
  return <BaseQueryClientProvider {...props}><TranslationProvider>{children}</TranslationProvider></BaseQueryClientProvider>;
}

function Consumer() {
  result = useTranslation();
  return <span>{result.t('hello', 'Hello')}</span>;
}

beforeEach(() => {
  window.history.replaceState({}, '', '/tr');
  localStorage.clear();
  document.cookie = 'preferredLanguage=; max-age=0; path=/';
  delete window.__INITIAL_LANGUAGE__;
  delete window.__INITIAL_TRANSLATIONS__;
  requests = [];
  client = new QueryClient({ defaultOptions: { queries: {
    retry: false,
    staleTime: Infinity,
    queryFn: async ({ queryKey }) => {
      requests.push(queryKey.join('/'));
      return { hello: 'merhaba' };
    },
  } } });
  client.setQueryData(['/api/auth/me'], null);
  client.setQueryData(['/api/location'], { location: { countryCode: 'TR', detected: false } });
  client.setQueryData(['/api/translations', 'en'], { hello: 'hello' });
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/');
});

function renderConsumers(count = 30) {
  return render(<QueryClientProvider client={client}>
    {Array.from({ length: count }, (_, index) => <Consumer key={index} />)}
  </QueryClientProvider>);
}

describe('shared Turkish translation query lifecycle', () => {
  it.each(ACTIVE_SITEMAP_LANGUAGES)('%s control defaults remain in the current locale with the real English fallback cache loaded', async language => {
    window.history.replaceState({}, '', `/${language}`);
    const english = {
      player_play_station: 'Play station', player_stop: 'Stop station', previous: 'Previous station', next: 'Next station',
      button_share_station: 'Share station', station_vote: 'Vote for this station', general_close: 'Close',
    };
    client.setQueryData(['/api/translations', 'en'], english);
    client.setQueryData(['/api/translations', language, 'critical'], { hello: 'fixture' });
    if (language !== 'en') client.setQueryData(['/api/translations', language], { hello: 'fixture' });
    renderConsumers(1);
    await act(async () => {});
    expect(result.language).toBe(language);
    // Global t semantics deliberately remain unchanged; only controls bypass
    // English fallback precedence when a current-locale key is missing.
    expect(result.t('station_vote', getStationControlLabels(language).vote)).toBe(english.station_vote);
    expect(getStationControlLabels(language, result.localeTranslations)).toEqual(getStationControlLabels(language));
    if (language !== 'en') expect(result.localeTranslations.station_vote).toBeUndefined();
    expect(requests).toEqual([]);
  });

  it('exposes stable current-locale data and preserves full/admin overrides without another query', async () => {
    window.__INITIAL_LANGUAGE__ = 'tr';
    window.__INITIAL_TRANSLATIONS__ = { player_play_station: 'SSR oynat', button_share_station: 'SSR paylaş' };
    client.setQueryData(['/api/translations', 'en'], { player_play_station: 'English play', station_vote: 'English vote' });
    client.setQueryData(['/api/translations', 'tr'], { player_play_station: 'Özel oynatma', station_vote: 'Özel oy' });
    const view = renderConsumers(1);
    const dictionary = result.localeTranslations;
    expect(getStationControlLabels('tr', dictionary)).toMatchObject({ play: 'Özel oynatma', share: 'SSR paylaş', vote: 'Özel oy' });
    view.rerender(<QueryClientProvider client={client}><Consumer /></QueryClientProvider>);
    expect(result.localeTranslations).toBe(dictionary);
    await act(async () => { client.setQueryData(['/api/translations', 'tr'], { player_play_station: 'Güncel oynatma' }); });
    await waitFor(() => expect(getStationControlLabels('tr', result.localeTranslations).play).toBe('Güncel oynatma'));
    expect(getStationControlLabels('tr', result.localeTranslations).vote).toBe('Bu istasyona oy ver');
    expect(requests).toEqual([]);
  });

  it('SEO and 30 UI consumers cannot cache the SSR subset as a complete dictionary', async () => {
    window.__INITIAL_LANGUAGE__ = 'tr';
    window.__INITIAL_TRANSLATIONS__ = { hello: 'SSR merhaba' };
    let finish!: (value: Record<string, string>) => void;
    const response = new Promise<Record<string, string>>(resolve => { finish = resolve; });
    client.setQueryDefaults(['/api/translations', 'tr'], { queryFn: async () => {
      requests.push('/api/translations/tr');
      return response;
    } });
    render(<QueryClientProvider client={client}><ServerSeoHeadContext.Provider value={true}>
      <SeoHead pageType="home" />
      {Array.from({ length: 30 }, (_, index) => <Consumer key={index} />)}
    </ServerSeoHeadContext.Provider></QueryClientProvider>);
    expect(result.t('hello')).toBe('SSR merhaba');
    expect(client.getQueryData(['/api/translations', 'tr'])).toBeUndefined();
    await waitFor(() => expect(requests).toEqual(['/api/translations/tr']));
    await act(async () => { finish({ hello: 'Tam sözlük', footer_company: 'Şirket' }); });
    await waitFor(() => expect(result.t('footer_company')).toBe('Şirket'));
    expect(client.getQueryData(['/api/translations', 'tr'])).toEqual({ hello: 'Tam sözlük', footer_company: 'Şirket' });
    expect(requests).toEqual(['/api/translations/tr']);
  });
  it('partial SSR dictionary renders immediately, then fetches and merges the full dictionary once', async () => {
    window.__INITIAL_LANGUAGE__ = 'tr';
    window.__INITIAL_TRANSLATIONS__ = { hello: 'SSR merhaba', ssr_only: 'Korunan metin' };
    let finish!: (value: Record<string, string>) => void;
    const response = new Promise<Record<string, string>>(resolve => { finish = resolve; });
    client.setQueryDefaults(['/api/translations', 'tr'], { queryFn: async () => {
      requests.push('/api/translations/tr');
      return response;
    } });
    renderConsumers();
    expect(result.t('hello')).toBe('SSR merhaba');
    expect(result.isLoading).toBe(false);
    await waitFor(() => expect(requests).toEqual(['/api/translations/tr']));
    await act(async () => { finish({ hello: 'Yönetici metni', homepage_community_favorites: 'Topluluk favorileri' }); });
    await waitFor(() => expect(result.t('hello')).toBe('Yönetici metni'));
    expect(result.t('homepage_community_favorites')).toBe('Topluluk favorileri');
    expect(result.t('ssr_only')).toBe('Korunan metin');
    expect(requests).toEqual(['/api/translations/tr']);
  });

  it('mounting cards/logos does not invalidate a fresh shared dictionary', async () => {
    client.setQueryData(['/api/translations', 'tr', 'critical'], { hello: 'merhaba' });
    client.setQueryData(['/api/translations', 'tr'], { hello: 'merhaba' });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    renderConsumers();
    await act(async () => {});
    expect(invalidate).not.toHaveBeenCalled();
    expect(requests).toEqual([]);
  });

  it('a cold dictionary still loads critical then full translations once for all consumers', async () => {
    renderConsumers();
    await waitFor(() => expect(client.getQueryData(['/api/translations', 'tr'])).toEqual({ hello: 'merhaba' }));
    expect(requests).toEqual(['/api/translations/tr/critical', '/api/translations/tr']);
  });

  it('retains the explicit refresh API', async () => {
    client.setQueryData(['/api/translations', 'tr', 'critical'], { hello: 'merhaba' });
    client.setQueryData(['/api/translations', 'tr'], { hello: 'merhaba' });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    renderConsumers(1);
    await act(async () => { result.refetch(); });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['/api/translations', 'tr'] });
  });

  it('keeps the translator stable across unrelated rerenders and updates on dictionary refresh', async () => {
    client.setQueryData(['/api/translations', 'tr', 'critical'], { hello: 'merhaba' });
    client.setQueryData(['/api/translations', 'tr'], { hello: 'merhaba' });
    const { rerender } = renderConsumers(1);
    const firstTranslate = result.t;
    rerender(<QueryClientProvider client={client}>{[<Consumer key={0} />]}</QueryClientProvider>);
    expect(result.t).toBe(firstTranslate);
    await act(async () => { client.setQueryData(['/api/translations', 'tr'], { hello: 'Güncel metin' }); });
    await waitFor(() => expect(result.t('hello')).toBe('Güncel metin'));
    expect(result.t).not.toBe(firstTranslate);
  });
});
