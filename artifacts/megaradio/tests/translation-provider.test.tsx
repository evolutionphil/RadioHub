import React, { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TranslationProvider, useTranslation } from '../src/hooks/useTranslation';

let client: QueryClient;
let latest: ReturnType<typeof useTranslation>;
const requests = vi.fn();
function Consumer() {
  latest = useTranslation();
  return <span>{latest.t('hello')}</span>;
}
const consumers = (count: number) => Array.from({ length: count }, (_, index) => <Consumer key={index} />);
const wrap = (count = 100) => <QueryClientProvider client={client}>
  <TranslationProvider>{consumers(count)}</TranslationProvider>
</QueryClientProvider>;
const observers = () => client.getQueryCache().getAll().reduce((count, query) => count + query.getObserversCount(), 0);

beforeEach(() => {
  window.history.replaceState({}, '', '/de');
  delete window.__INITIAL_LANGUAGE__; delete window.__INITIAL_TRANSLATIONS__;
  requests.mockReset().mockImplementation(async ({ queryKey }: { queryKey: unknown[] }) =>
    queryKey[0] === '/api/admin/translation-keys' ? [{ key: 'admin_only', defaultValue: 'Admin default' }] : { hello: 'Refreshed' });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, queryFn: requests } } });
  client.setQueryData(['/api/auth/me'], null);
  for (const [locale, hello] of [['de', 'Hallo'], ['tr', 'Merhaba'], ['en', 'Hello']]) {
    client.setQueryData(['/api/translations', locale, 'critical'], { hello });
    client.setQueryData(['/api/translations', locale], { hello });
  }
});
afterEach(() => {
  cleanup(); client.clear(); vi.restoreAllMocks();
  delete window.__INITIAL_LANGUAGE__; delete window.__INITIAL_TRANSLATIONS__;
});

describe('single translation query owner', () => {
  it('100 consumers have five total observers and adding consumers creates no stale timers', () => {
    const timers = vi.spyOn(globalThis, 'setTimeout');
    const view = render(wrap(1));
    const initialTimerCount = timers.mock.calls.length;
    expect(initialTimerCount).toBeLessThan(15);
    expect(observers()).toBe(5);
    view.rerender(wrap(100));
    expect(view.getAllByText('Hallo')).toHaveLength(100);
    expect(observers()).toBe(5);
    expect(timers.mock.calls.length).toBe(initialTimerCount);
    for (const query of client.getQueryCache().getAll()) expect(query.getObserversCount()).toBeLessThanOrEqual(1);
    expect(requests).not.toHaveBeenCalled();
  });

  it('cleans all observers on unmount and does not duplicate them under StrictMode/remount', () => {
    const first = render(<StrictMode>{wrap()}</StrictMode>);
    expect(observers()).toBe(5);
    first.unmount(); expect(observers()).toBe(0);
    const second = render(<StrictMode>{wrap()}</StrictMode>);
    expect(observers()).toBe(5);
    second.unmount(); expect(observers()).toBe(0);
  });

  it('navigation and back update all consumers without a child route hook', async () => {
    const view = render(wrap());
    await act(async () => { window.history.pushState({}, '', '/tr/istasyon/kral-fm'); });
    await waitFor(() => expect(view.getAllByText('Merhaba')).toHaveLength(100));
    expect(latest.language).toBe('tr'); expect(observers()).toBe(5);
    await act(async () => {
      window.history.replaceState({}, '', '/de');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await waitFor(() => expect(view.getAllByText('Hallo')).toHaveLength(100));
    expect(latest.language).toBe('de'); expect(requests).not.toHaveBeenCalled();
  });

  it('one explicit invalidation refreshes every consumer and retains current-locale dictionary ownership', async () => {
    const view = render(wrap());
    await act(async () => { latest.refetch(); });
    await waitFor(() => expect(view.getAllByText('Refreshed')).toHaveLength(100));
    expect(requests.mock.calls.map(([options]) => options.queryKey)).toEqual([
      ['/api/translations', 'de', 'critical'], ['/api/translations', 'de'],
    ]);
    expect(latest.localeTranslations.hello).toBe('Refreshed');
    expect(observers()).toBe(5);
  });

  it('explicit language selection keeps instant cached text, persisted choice and the existing refresh API', async () => {
    vi.useFakeTimers();
    try {
      for (const locale of ['es', 'fr', 'it', 'pt']) client.setQueryData(['/api/translations', locale], { hello: locale });
      const view = render(wrap());
      const callback = latest.setLanguage;
      await act(async () => {
        window.history.pushState({}, '', '/tr');
        await callback('tr');
      });
      expect(view.getAllByText('Merhaba')).toHaveLength(100);
      expect(localStorage.getItem('preferredLanguage')).toBe('tr');
      expect(document.cookie).toContain('preferredLanguage=tr');
      expect(latest.setLanguage).toBe(callback);
      await act(async () => { await latest.setLanguage('unsupported'); });
      expect(latest.language).toBe('tr');
      await act(async () => { await vi.advanceTimersByTimeAsync(101); });
      expect(observers()).toBe(5);
      expect(requests).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it('retains SSR text through a failed full load and recovers through explicit refresh', async () => {
    window.__INITIAL_LANGUAGE__ = 'de'; window.__INITIAL_TRANSLATIONS__ = { hello: 'SSR Hallo' };
    client.removeQueries({ queryKey: ['/api/translations', 'de'] });
    requests.mockRejectedValueOnce(new Error('offline'));
    const view = render(wrap());
    await waitFor(() => expect(client.getQueryState(['/api/translations', 'de'])?.status).toBe('error'));
    expect(view.getAllByText('SSR Hallo')).toHaveLength(100);
    expect(latest.isLoading).toBe(false);
    expect(client.getQueryData(['/api/translations', 'de'])).toBeUndefined();
    await act(async () => { latest.refetch(); });
    await waitFor(() => expect(view.getAllByText('Refreshed')).toHaveLength(100));
    expect(requests).toHaveBeenCalledTimes(2);
  });

  it('loads admin defaults only after authenticated admin data arrives and updates the shared translator', async () => {
    render(wrap());
    expect(requests).not.toHaveBeenCalled();
    await act(async () => { client.setQueryData(['/api/auth/me'], { user: { isAdmin: true }, authenticated: true }); });
    await waitFor(() => expect(latest.t('admin_only')).toBe('Admin default'));
    expect(requests).toHaveBeenCalledTimes(1);
    expect(requests.mock.calls[0][0].queryKey).toEqual(['/api/admin/translation-keys']);
    expect(observers()).toBe(5);
    await act(async () => { client.setQueryData(['/api/translations', 'de'], { hello: 'Custom', admin_only: 'Lokaler Vorrang' }); });
    await waitFor(() => expect(latest.t('admin_only')).toBe('Lokaler Vorrang'));
  });

  it('fails explicitly outside its owner instead of silently creating per-consumer queries', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<QueryClientProvider client={client}><Consumer /></QueryClientProvider>))
      .toThrow('useTranslation must be used within TranslationProvider');
    expect(observers()).toBe(0);
    error.mockRestore();
  });
});
