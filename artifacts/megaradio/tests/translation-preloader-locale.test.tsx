import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SEO_LANGUAGES } from '@workspace/seo-shared/seo-config';
import { TranslationPreloader } from '../src/components/translation/TranslationPreloader';

let client: QueryClient;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  client.setQueryData(['/api/location'], { location: { countryCode: 'DE' } });
  vi.stubGlobal('requestIdleCallback', (callback: () => void) => window.setTimeout(callback, 0));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ hello: 'translated' }) }));
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

async function load(pathname: string) {
  window.history.replaceState({}, '', pathname);
  render(<QueryClientProvider client={client}><TranslationPreloader /></QueryClientProvider>);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}

describe('translation preloader URL locale', () => {
  it.each(SEO_LANGUAGES.filter(language => language.enabled).map(language => language.code))(
    'preloads /%s from its URL language, never from visitor IP', async language => {
      await load(`/${language}`);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledWith(`/api/translations/${language}`);
      expect(client.getQueryData(['/api/translations', language])).toEqual({ hello: 'translated' });
    },
  );

  it('keeps unprefixed pages English despite stored preference and IP country', async () => {
    localStorage.setItem('preferredLanguage', 'tr');
    await load('/station/example');
    expect(fetch).toHaveBeenCalledWith('/api/translations/en');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not re-fetch an already cached dictionary', async () => {
    client.setQueryData(['/api/translations', 'tr'], { hello: 'merhaba' });
    await load('/tr/istasyon/example');
    expect(fetch).not.toHaveBeenCalled();
  });
});
