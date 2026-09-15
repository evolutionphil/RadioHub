import React, { useEffect, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router, Route, Switch } from 'wouter';
import { ACTIVE_SITEMAP_LANGUAGES } from '@workspace/seo-shared/seo-config';
import { translateUrl, setDatabaseUrlTranslations } from '@workspace/seo-shared/url-translations';
import { GlobalPlayerContext, shellDefaults, useGlobalPlayer } from '../src/hooks/useGlobalPlayer.shell';
import { TranslationProvider, useTranslation } from '../src/hooks/useTranslation';
import { useSeoRouting } from '../src/hooks/useSeoRouting';
import { syncDocumentLocale } from '../src/lib/document-locale';

const events = vi.hoisted(() => ({ mount: vi.fn(), unmount: vi.fn() }));
// Only the network/audio-engine implementation is substituted. The real lazy
// provider, context bridge, router and translation runtime remain integrated.
vi.mock('../src/hooks/useGlobalPlayer', () => ({ GlobalPlayerProvider: ({ children }: { children: React.ReactNode }) => {
  const [audio] = useState(() => document.createElement('audio'));
  const [station, setStation] = useState<any>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    events.mount();
    return () => { events.unmount(); audio.pause(); };
  }, [audio]);
  return <GlobalPlayerContext.Provider value={{ ...shellDefaults, isHydrated: true,
    currentStation: station, isPlaying: playing, audioElement: audio,
    playStation: async value => {
      audio.src = 'https://stream.example.test/kral-fm';
      await audio.play();
      setStation(value); setPlaying(true);
    },
    pause: () => { audio.pause(); setPlaying(false); },
    stop: () => { audio.pause(); setPlaying(false); setStation(null); },
  }}>{children}</GlobalPlayerContext.Provider>;
} }));
import { LazyGlobalPlayerProvider } from '../src/hooks/LazyGlobalPlayerProvider';

let client: QueryClient;
let routing: ReturnType<typeof useSeoRouting>;
let player: ReturnType<typeof useGlobalPlayer>;
let runIdle: IdleRequestCallback;
let play: ReturnType<typeof vi.spyOn>;
let pause: ReturnType<typeof vi.spyOn>;
const network = vi.fn();

function Page() {
  routing = useSeoRouting();
  player = useGlobalPlayer();
  const { t, language } = useTranslation();
  useEffect(() => { syncDocumentLocale(language); }, [language]);
  return <>
    <p data-testid="locale">{language}</p>
    <p>{t('page_greeting', 'Loading dictionary')}</p>
    <p>{player.isHydrated ? 'Player ready' : 'Player waiting'}</p>
    <p>{player.currentStation?.name}</p>
    <button onClick={() => void player.playStation({ _id: 'kral-fm', name: 'Kral FM' } as any)}>Play Kral FM</button>
    <select aria-label="Footer language" value={routing.currentLanguage} onChange={event => routing.changeLanguage(event.target.value)}>
      {ACTIVE_SITEMAP_LANGUAGES.map(language => <option key={language}>{language}</option>)}
    </select>
  </>;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/en/station/kral-fm?country=Austria#listen');
  localStorage.clear();
  document.cookie = 'preferredLanguage=; max-age=0; path=/';
  delete window.__INITIAL_LANGUAGE__; delete window.__INITIAL_TRANSLATIONS__;
  setDatabaseUrlTranslations(new Map());
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, queryFn: async () => null } } });
  client.setQueryData(['/api/auth/me'], null);
  for (const language of ACTIVE_SITEMAP_LANGUAGES) {
    const dictionary = { page_greeting: `Dictionary-${language}` };
    client.setQueryData(['/api/translations', language], dictionary);
    client.setQueryData(['/api/translations', language, 'critical'], dictionary);
  }
  vi.stubGlobal('requestIdleCallback', vi.fn(callback => { runIdle = callback; return 91; }));
  vi.stubGlobal('cancelIdleCallback', vi.fn());
  network.mockReset().mockRejectedValue(new Error('Unexpected network request'));
  vi.stubGlobal('fetch', network);
  play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});

afterEach(() => {
  cleanup(); client.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  setDatabaseUrlTranslations(new Map());
  window.history.replaceState({}, '', '/');
  document.documentElement.removeAttribute('lang'); document.documentElement.removeAttribute('dir');
});

it('keeps the same active audio/station through all 14 footer locale switches while translating the page and preserving query/hash', async () => {
  const view = render(<QueryClientProvider client={client}><Router><TranslationProvider>
    <LazyGlobalPlayerProvider><Switch><Route path="/:language/*" component={Page} /></Switch></LazyGlobalPlayerProvider>
  </TranslationProvider></Router></QueryClientProvider>);
  await act(async () => { runIdle({ didTimeout: false, timeRemaining: () => 50 }); });
  await screen.findByText('Player ready');
  fireEvent.click(screen.getByRole('button', { name: 'Play Kral FM' }));
  await screen.findByText('Kral FM');
  const audio = player.audioElement;
  const documentRoot = document.documentElement;
  const switcher = screen.getByRole('combobox', { name: 'Footer language' });
  expect(audio).not.toBeNull();
  expect(play).toHaveBeenCalledTimes(1);
  expect(player.isPlaying).toBe(true);

  const languages = [...ACTIVE_SITEMAP_LANGUAGES.filter(language => language !== 'en'), 'en'];
  expect(languages).toHaveLength(14);
  for (const language of languages) {
    await act(async () => { fireEvent.change(switcher, { target: { value: language } }); });
    await waitFor(() => expect(screen.getByTestId('locale')).toHaveTextContent(language));
    expect(screen.getByText(`Dictionary-${language}`)).toBeVisible();
    // `/station` and `/stations` share localized segments in several locales;
    // both are supported detail-page aliases, but the station identity is fixed.
    expect(['/station/kral-fm', '/stations/kral-fm'].map(path => `/${language}${translateUrl(path, language)}`)).toContain(decodeURI(window.location.pathname));
    expect(routing.englishPath).toMatch(/^\/stations?\/kral-fm$/);
    expect(window.location.search).toBe('?country=Austria');
    expect(window.location.hash).toBe('#listen');
    expect(document.documentElement).toBe(documentRoot);
    expect(documentRoot.lang).toBe(language);
    expect(documentRoot.dir).toBe(language === 'ar' || language === 'he' ? 'rtl' : 'ltr');
    expect(screen.getByRole('combobox', { name: 'Footer language' })).toBe(switcher);
    expect(player.audioElement).toBe(audio);
    expect(audio?.src).toBe('https://stream.example.test/kral-fm');
    expect(player.currentStation?._id).toBe('kral-fm');
    expect(player.isPlaying).toBe(true);
    expect(events.mount).toHaveBeenCalledTimes(1);
    expect(events.unmount).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
    expect(play).toHaveBeenCalledTimes(1);
  }
  expect(network).not.toHaveBeenCalled();
  view.unmount();
  expect(events.unmount).toHaveBeenCalledTimes(1);
  expect(pause).toHaveBeenCalledTimes(1);
});
