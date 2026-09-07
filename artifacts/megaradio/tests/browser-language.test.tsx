import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getBrowserLanguage, saveBrowserLanguage } from '../src/lib/browser-language';
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
beforeEach(() => {
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
