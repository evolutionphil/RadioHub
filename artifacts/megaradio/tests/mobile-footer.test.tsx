import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Footer from '../src/components/layout/footer';
import { ACTIVE_SITEMAP_LANGUAGES } from '@workspace/seo-shared/seo-config';

const state = vi.hoisted(() => ({
  language: 'de', station: null as null | { id: string }, pageType: 'home', changeLanguage: vi.fn(),
}));
vi.mock('../src/hooks/useGlobalPlayer', () => ({ useGlobalPlayer: () => ({ currentStation: state.station }) }));
vi.mock('../src/hooks/useTranslation', () => ({ useTranslation: () => ({
  isLoading: false,
  t: (key: string, fallback: string) => key === 'footer_terms' ? 'Allgemeine Geschäftsbedingungen' : fallback,
}) }));
vi.mock('../src/hooks/useSeoRouting', () => ({ useSeoRouting: () => ({
  currentLanguage: state.language, changeLanguage: state.changeLanguage,
  getLocalizedUrl: (path: string) => `/${state.language}${path === '/' ? '' : path}`,
}) }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: [
  { _id: 'active', platform: 'youtube', url: 'https://youtube.com/megaradio', isActive: true },
  { _id: 'inactive', platform: 'facebook', url: 'https://facebook.com/megaradio', isActive: false },
] }) }));
vi.mock('../src/lib/adsense-runtime', () => ({ getAdSensePageType: () => state.pageType }));
vi.mock('../src/components/ads/DeferredAdSenseUnit', () => ({ default: () => <div data-testid="footer-ad" /> }));
vi.mock('../src/components/ads/PrivacySettingsButton', () => ({ default: ({ language }: { language: string }) => <button>Privacy {language}</button> }));
vi.mock('../src/components/modals/AddYourStationModal', () => ({ default: ({ onClose }: { onClose: () => void }) => <div role="dialog"><button onClick={onClose}>Close station modal</button></div> }));

beforeEach(() => {
  state.language = 'de'; state.station = null; state.pageType = 'home'; state.changeLanguage.mockClear();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('mobile footer', () => {
  it.each(ACTIVE_SITEMAP_LANGUAGES)('retains localized navigation and 14 language choices for %s', language => {
    state.language = language;
    render(<Footer />);
    expect(screen.getByRole('contentinfo')).toHaveAttribute('lang', language);
    for (const path of ['/about', '/applications', '/contact', '/recommendations', '/users', '/terms-and-conditions', '/privacy-policy', '/regions', '/regions/europe/germany', '/regions/europe/turkey', '/regions/europe/austria']) {
      expect(document.querySelector(`footer a[href="/${language}${path}"]`)).not.toBeNull();
    }
    fireEvent.click(screen.getByTestId('footer-language-selector'));
    expect(screen.getAllByTestId(/^language-option-/)).toHaveLength(14);
    expect(screen.getByTestId(`language-option-${language}`)).toHaveAttribute('aria-pressed', 'true');
  });

  it('focuses search on open, filters languages, and closes with Escape while restoring focus', () => {
    render(<Footer />);
    const trigger = screen.getByTestId('footer-language-selector');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const search = screen.getByRole('textbox', { name: 'Search language...' });
    expect(search).toHaveFocus();
    fireEvent.change(search, { target: { value: 'türk' } });
    expect(screen.getAllByTestId(/^language-option-/)).toHaveLength(1);
    expect(screen.getByTestId('language-option-tr')).toBeInTheDocument();
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('changes only to the selected supported language and dismisses the dropdown', () => {
    render(<Footer />);
    fireEvent.click(screen.getByTestId('footer-language-selector'));
    fireEvent.click(screen.getByTestId('language-option-tr'));
    expect(state.changeLanguage).toHaveBeenCalledOnce();
    expect(state.changeLanguage).toHaveBeenCalledWith('tr');
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('closes on touch/outside focus and announces an empty language search', () => {
    render(<Footer />);
    const trigger = screen.getByTestId('footer-language-selector');
    fireEvent.click(trigger);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'not-a-locale' } });
    expect(screen.getByRole('status')).toHaveTextContent('No results');
    fireEvent.pointerDown(document.body, { pointerType: 'touch' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    fireEvent.focusIn(screen.getByRole('link', { name: 'MegaRadio' }));
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps privacy, station submission and ad page restrictions working', async () => {
    const view = render(<Footer />);
    expect(screen.getByRole('button', { name: 'Privacy de' })).toBeInTheDocument();
    expect(screen.getByTestId('footer-ad')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add Your Station' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close station modal' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    state.pageType = 'profile'; view.rerender(<Footer />);
    expect(screen.queryByTestId('footer-ad')).not.toBeInTheDocument();
  });

  it('keeps mobile links and language dropdown fluid and reserves player/safe-area space', () => {
    state.station = { id: 'station' };
    render(<Footer />);
    expect(screen.getByRole('contentinfo').getAttribute('style')).toContain('144px');
    expect(screen.getByRole('contentinfo').getAttribute('style')).toContain('safe-area-inset-bottom');
    expect(screen.getByRole('link', { name: 'Allgemeine Geschäftsbedingungen' }).className).toContain('[overflow-wrap:anywhere]');
    expect(screen.getByRole('link', { name: 'Allgemeine Geschäftsbedingungen' }).className).toContain('min-h-11');
    expect(screen.getAllByRole('link', { name: 'Spain' })[0].className).toContain('lg:hidden');
    fireEvent.click(screen.getByTestId('footer-language-selector'));
    expect(screen.getByRole('region').className).toContain('max-w-[calc(100vw_-_2rem)]');
    expect(screen.getByRole('region').className).toContain('max-h-[min(320px,60dvh)]');
    expect(screen.getByRole('link', { name: 'youtube' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'facebook' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'MXRTOKEN' }).getAttribute('style')).not.toContain('color:');
  });

  it('disconnects the deferred background observer on unmount', () => {
    vi.useFakeTimers();
    const disconnect = vi.fn(); const observe = vi.fn();
    vi.stubGlobal('IntersectionObserver', class { observe = observe; disconnect = disconnect; });
    const view = render(<Footer />);
    act(() => { vi.advanceTimersByTime(101); });
    expect(observe).toHaveBeenCalledOnce();
    view.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
