import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTranslation } from '../src/hooks/useTranslation';

let client: QueryClient;
let result: ReturnType<typeof useTranslation>;
let requests: string[];

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
});
