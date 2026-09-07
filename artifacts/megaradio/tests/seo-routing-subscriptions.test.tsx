import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSeoRouting } from '../src/hooks/useSeoRouting';
import { useTranslation } from '../src/hooks/useTranslation';
import { prefetchNavigationTranslations } from '../src/lib/translation-navigation-prefetch';
import { setDatabaseUrlTranslations } from '@workspace/seo-shared/url-translations';

let client: QueryClient;
let routing: ReturnType<typeof useSeoRouting>;
let renderedLocales: string[];
const fetchDictionary = vi.fn();
function RoutingConsumer({ index }: { index: number }) {
  const value = useSeoRouting(); routing = value;
  renderedLocales[index] = value.currentLanguage;
  return <a href={value.getLocalizedUrl('/radios')}>Radios</a>;
}
function TranslationConsumer() { const { t } = useTranslation(); return <p>{t('hello')}</p>; }
function mount(count = 100, translated = false) {
  return render(<QueryClientProvider client={client}>
    {translated && <TranslationConsumer />}
    {Array.from({ length: count }, (_, index) => <RoutingConsumer index={index} key={index} />)}
  </QueryClientProvider>);
}
const observerCount = () => client.getQueryCache().getAll().reduce((total, query) => total + query.getObserversCount(), 0);

beforeEach(async () => {
  await Promise.resolve();
  window.history.replaceState({}, '', '/de');
  localStorage.clear(); document.cookie = 'preferredLanguage=; max-age=0; path=/';
  window.__INITIAL_LANGUAGE__ = 'de'; window.__INITIAL_TRANSLATIONS__ = { hello: 'Hallo' };
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, queryFn: async () => null } } });
  client.setQueryData(['/api/translations', 'de'], { hello: 'Hallo' });
  client.setQueryData(['/api/translations', 'en'], { hello: 'Hello' });
  client.setQueryData(['/api/auth/me'], null);
  renderedLocales = [];
  setDatabaseUrlTranslations(new Map());
  fetchDictionary.mockReset().mockResolvedValue({ ok: true, json: async () => ({ hello: 'Merhaba' }) });
  vi.stubGlobal('fetch', fetchDictionary);
});
afterEach(() => {
  vi.unstubAllGlobals(); cleanup(); client.clear(); vi.restoreAllMocks();
  delete window.__INITIAL_LANGUAGE__; delete window.__INITIAL_TRANSLATIONS__;
  setDatabaseUrlTranslations(new Map());
});

it('100 URL-only consumers create zero query observers and one same-task preference read', () => {
  const storage = vi.spyOn(Storage.prototype, 'getItem');
  const cookie = vi.spyOn(Document.prototype, 'cookie', 'get');
  const view = mount();
  expect(observerCount()).toBe(0);
  expect(storage.mock.calls.filter(([key]) => key === 'preferredLanguage')).toHaveLength(1);
  expect(cookie).toHaveBeenCalledTimes(1);
  expect(fetchDictionary).not.toHaveBeenCalled();
  expect(view.container.querySelectorAll('a[href="/de/radios"]')).toHaveLength(100);
});

it('100 routing consumers add no subscriptions to a real translated UI consumer', () => {
  const view = mount(100, true);
  expect(view.getByText('Hallo')).toBeInTheDocument();
  expect(observerCount()).toBe(5);
  for (const query of client.getQueryCache().getAll()) expect(query.getObserversCount()).toBeLessThanOrEqual(1);
});

it('SPA locale navigation warms only its missing target dictionary once and cached back navigation stays local', async () => {
  const view = mount();
  await act(async () => {
    window.history.replaceState({}, '', '/tr/istasyon/kral-fm');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await waitFor(() => expect(client.getQueryData(['/api/translations', 'tr'])).toEqual({ hello: 'Merhaba' }));
  expect(fetchDictionary).toHaveBeenCalledTimes(1);
  expect(fetchDictionary).toHaveBeenCalledWith('/api/translations/tr');
  expect(renderedLocales.every(locale => locale === 'tr')).toBe(true);
  expect(routing.englishPath).toBe('/station/kral-fm');
  expect(view.container.querySelectorAll('a[href="/tr/radyo"]')).toHaveLength(100);
  expect(observerCount()).toBe(0);
  expect(client.getQueryData(['/api/translations', 'fr'])).toBeUndefined();
  await act(async () => {
    window.history.replaceState({}, '', '/de');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  expect(renderedLocales.every(locale => locale === 'de')).toBe(true);
  expect(fetchDictionary).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem('preferredLanguage')).toBe('de');
});

it('explicit user choice still saves immediately and reloads the same translated page', () => {
  window.history.replaceState({}, '', '/de/genres/rock');
  mount(1);
  // Observe the navigation assignment without asking jsdom to perform an
  // unsupported real document navigation; the real storage/cookie APIs remain.
  const target = { href: '' }; vi.stubGlobal('window', { location: target });
  routing.changeLanguage('ar');
  expect(target.href).toBe('/ar/anwaa/rock');
  expect(localStorage.getItem('preferredLanguage')).toBe('ar');
  expect(document.cookie).toContain('preferredLanguage=ar');
  expect(fetchDictionary).not.toHaveBeenCalled();
});

it('blocked Safari preferences do not break URLs or cause repeated automatic reads', () => {
  const storage = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
  const cookie = vi.spyOn(Document.prototype, 'cookie', 'get').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
  expect(() => mount()).not.toThrow();
  expect(storage).toHaveBeenCalledTimes(1); expect(cookie).toHaveBeenCalledTimes(1);
  expect(routing.currentLanguage).toBe('de'); expect(observerCount()).toBe(0);
});

it('retains recognition of incoming admin URL overrides without translation-data observers', () => {
  setDatabaseUrlTranslations(new Map([['de:radios', 'alle-sender']]));
  const view = mount(1);
  expect(routing.reverseTranslateUrl('/alle-sender')).toBe('/radios');
  // The existing full-path forward translator uses its static canonical map;
  // this performance change must not alter that unrelated URL policy.
  expect(view.container.querySelector('a')?.getAttribute('href')).toBe('/de/radios');
  expect(observerCount()).toBe(0);
});

it('a failed target warmup remains retryable and never publishes a fabricated dictionary', async () => {
  fetchDictionary.mockResolvedValueOnce({ ok: false });
  await expect(prefetchNavigationTranslations(client, 'tr')).resolves.toBeUndefined();
  expect(client.getQueryData(['/api/translations', 'tr'])).toBeUndefined();
  await prefetchNavigationTranslations(client, 'tr');
  expect(client.getQueryData(['/api/translations', 'tr'])).toEqual({ hello: 'Merhaba' });
  expect(fetchDictionary).toHaveBeenCalledTimes(2);
  await prefetchNavigationTranslations(client, 'tr');
  await prefetchNavigationTranslations(client, 'unsupported-locale');
  expect(fetchDictionary).toHaveBeenCalledTimes(2);
});
