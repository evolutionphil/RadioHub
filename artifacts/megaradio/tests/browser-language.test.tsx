import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getBrowserLanguage, saveBrowserLanguage, syncBrowserLanguageFromUrl } from '../src/lib/browser-language';
import { useTranslation } from '../src/hooks/useTranslation';
import { useSeoRouting } from '../src/hooks/useSeoRouting';

let client: QueryClient;
let translation: ReturnType<typeof useTranslation>;
let routing: ReturnType<typeof useSeoRouting>;
const deviceLanguages = (languages: string[]) => {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(languages);
  vi.spyOn(navigator, 'language', 'get').mockReturnValue(languages[0] || 'zz-ZZ');
};
function Consumer({ route = false }: { route?: boolean }) {
  translation = useTranslation();
  return <>{route && <RoutingConsumer />}<span>{translation.language}</span></>;
}
function RoutingConsumer() { routing = useSeoRouting(); return null; }
function mount(route = false) {
  return render(<QueryClientProvider client={client}><Consumer route={route} /></QueryClientProvider>);
}
beforeEach(async () => {
  await Promise.resolve(); // End the preceding test's automatic-sync task.
  window.history.replaceState({}, '', '/');
  localStorage.clear();
  document.cookie = 'preferredLanguage=; max-age=0; path=/';
  delete window.__INITIAL_LANGUAGE__;
  delete window.__INITIAL_TRANSLATIONS__;
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, queryFn: async () => ({}) } } });
  client.setQueryData(['/api/auth/me'], null);
  for (const language of ['de', 'en', 'tr', 'ar']) {
    client.setQueryData(['/api/translations', language], { hello: language });
    client.setQueryData(['/api/translations', language, 'critical'], { hello: language });
  }
});

describe('same-task automatic URL preference sync', () => {
  it('100 translation consumers synchronously read cookie/storage only once on mount', () => {
    window.history.replaceState({}, '', '/de');
    const storage = vi.spyOn(Storage.prototype, 'getItem');
    const cookie = vi.spyOn(Document.prototype, 'cookie', 'get');
    render(<QueryClientProvider client={client}>
      {Array.from({ length: 100 }, (_, index) => <Consumer key={index} />)}
    </QueryClientProvider>);
    expect(storage.mock.calls.filter(([key]) => key === 'preferredLanguage')).toHaveLength(1);
    expect(cookie).toHaveBeenCalledTimes(1);
    cookie.mockRestore(); storage.mockRestore();
    expect(document.cookie).toContain('preferredLanguage=de');
    expect(localStorage.getItem('preferredLanguage')).toBe('de');
  });

  it('saves immediately, coalesces repeats, and retries after the microtask checkpoint', async () => {
    const storage = vi.spyOn(Storage.prototype, 'getItem');
    const cookie = vi.spyOn(Document.prototype, 'cookie', 'get');
    syncBrowserLanguageFromUrl('de');
    for (let index = 0; index < 100; index++) syncBrowserLanguageFromUrl('de');
    expect(storage).toHaveBeenCalledTimes(1); expect(cookie).toHaveBeenCalledTimes(1);
    document.cookie = 'preferredLanguage=; max-age=0; path=/';
    await Promise.resolve();
    syncBrowserLanguageFromUrl('de');
    expect(storage).toHaveBeenCalledTimes(2); expect(cookie).toHaveBeenCalledTimes(2);
    cookie.mockRestore();
    expect(document.cookie).toContain('preferredLanguage=de');
  });

  it('does not skip a different locale or same-task back navigation', () => {
    const storage = vi.spyOn(Storage.prototype, 'getItem');
    syncBrowserLanguageFromUrl('de'); syncBrowserLanguageFromUrl('ar'); syncBrowserLanguageFromUrl('de');
    expect(storage).toHaveBeenCalledTimes(3);
    expect(document.cookie).toContain('preferredLanguage=de');
  });

  it('explicit saves still repair deleted cookies and invalidate an older automatic marker', () => {
    syncBrowserLanguageFromUrl('de');
    document.cookie = 'preferredLanguage=; max-age=0; path=/';
    saveBrowserLanguage('de');
    expect(document.cookie).toContain('preferredLanguage=de');
    saveBrowserLanguage('ar');
    syncBrowserLanguageFromUrl('de');
    expect(document.cookie).toContain('preferredLanguage=de');
    expect(localStorage.getItem('preferredLanguage')).toBe('de');
  });

  it('coalesces blocked Safari storage safely and retries it on the next task', async () => {
    const storage = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    const cookie = vi.spyOn(Document.prototype, 'cookie', 'get').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    for (let index = 0; index < 100; index++) expect(() => syncBrowserLanguageFromUrl('de')).not.toThrow();
    expect(storage).toHaveBeenCalledTimes(1); expect(cookie).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(() => syncBrowserLanguageFromUrl('de')).not.toThrow();
    expect(storage).toHaveBeenCalledTimes(2); expect(cookie).toHaveBeenCalledTimes(2);
  });

  it('ignores unsupported values without poisoning the next valid automatic sync', () => {
    const storage = vi.spyOn(Storage.prototype, 'getItem');
    syncBrowserLanguageFromUrl('xx-invalid'); syncBrowserLanguageFromUrl('de');
    expect(storage).toHaveBeenCalledTimes(1);
    expect(document.cookie).toContain('preferredLanguage=de');
  });
});
afterEach(() => { cleanup(); client.clear(); vi.restoreAllMocks(); });

describe('root-only browser language selection', () => {
  for (const tag of ['de-AT', 'de-DE']) {
    it(`selects German device ${tag} without a stored preference`, () => {
      deviceLanguages([tag, 'en-US']);
      mount();
      expect(translation.language).toBe('de');
      expect(localStorage.getItem('preferredLanguage')).toBeNull();
    });
  }
  it('honors legacy localStorage preference on root before device language', () => {
    deviceLanguages(['de-AT']);
    localStorage.setItem('preferredLanguage', 'tr');
    window.__INITIAL_LANGUAGE__ = 'en';
    mount();
    expect(translation.language).toBe('tr');
  });
  it('honors an explicit English cookie before a German device', () => {
    deviceLanguages(['de-AT']);
    document.cookie = 'preferredLanguage=en; path=/';
    expect(getBrowserLanguage()).toBe('en');
  });
  it('skips unsupported device languages and falls back safely', () => {
    deviceLanguages(['zz-ZZ', 'de-DE']);
    expect(getBrowserLanguage()).toBe('de');
    deviceLanguages(['zz-ZZ']);
    expect(getBrowserLanguage()).toBe('en');
  });
  it('survives blocked Safari storage and still uses the device language', () => {
    deviceLanguages(['de-AT']);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    expect(getBrowserLanguage()).toBe('de');
    expect(() => saveBrowserLanguage('de')).not.toThrow();
    expect(document.cookie).toContain('preferredLanguage=de');
  });
  for (const language of ['en', 'tr', 'de', 'ar']) {
    it(`explicit /${language} overrides saved preference and stale SSR immediately`, () => {
      window.history.replaceState({}, '', `/${language}`);
      deviceLanguages(['de-AT']);
      localStorage.setItem('preferredLanguage', 'tr');
      document.cookie = 'preferredLanguage=tr; path=/';
      window.__INITIAL_LANGUAGE__ = 'tr';
      mount();
      expect(translation.language).toBe(language);
      expect(document.cookie).toContain(`preferredLanguage=${language}`);
    });
  }
  it('repairs a missing server-readable cookie even when localStorage already matches', () => {
    window.history.replaceState({}, '', '/de');
    localStorage.setItem('preferredLanguage', 'de');
    mount(true);
    expect(document.cookie).toContain('preferredLanguage=de');
    expect(routing.currentLanguage).toBe('de');
  });
  it('keeps bare content deterministic English without replacing saved German preference', () => {
    window.history.replaceState({}, '', '/station/example');
    localStorage.setItem('preferredLanguage', 'de');
    mount();
    expect(translation.language).toBe('en');
    expect(localStorage.getItem('preferredLanguage')).toBe('de');
  });
  it('replaces SPA root with device locale and preserves query/hash', async () => {
    deviceLanguages(['de-AT']);
    window.history.replaceState({}, '', '/?utm_source=iphone#player');
    mount(true);
    await waitFor(() => expect(window.location.pathname).toBe('/de'));
    expect(window.location.search).toBe('?utm_source=iphone');
    expect(window.location.hash).toBe('#player');
    expect(routing.currentLanguage).toBe('de');
  });
  it('back/forward distinguishes Arabic and English language codes from countries', async () => {
    window.history.replaceState({}, '', '/de');
    mount();
    for (const language of ['ar', 'en', 'tr']) {
      await act(async () => {
        window.history.replaceState({}, '', `/${language}`);
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      expect(translation.language).toBe(language);
    }
  });
});
