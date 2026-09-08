import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdCarousel } from '../src/components/ad-carousel';

const premium = vi.hoisted(() => ({ isPremium: false, isLoading: false, error: null as unknown }));
vi.mock('../src/hooks/usePremiumStatus', () => ({ usePremiumStatus: () => premium }));
let intersections: { callback: IntersectionObserverCallback; target?: Element; disconnect: ReturnType<typeof vi.fn> }[];
let width = 320;
let top = 0;

beforeEach(() => {
  vi.useFakeTimers(); vi.resetModules();
  Object.assign(premium, { isPremium: false, isLoading: false, error: null });
  window.history.replaceState({}, '', '/de');
  document.querySelectorAll('script[src*="adsbygoogle.js"]').forEach(script => script.remove());
  window.adsbygoogle = [];
  intersections = []; width = 320; top = 0;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width, height: 90, top, left: 0, bottom: top + 90, right: width, x: 0, y: top, toJSON: () => ({}) }));
  vi.stubGlobal('IntersectionObserver', class {
    item: typeof intersections[number];
    constructor(callback: IntersectionObserverCallback) { this.item = { callback, disconnect: vi.fn() }; intersections.push(this.item); }
    observe(target: Element) { this.item.target = target; }
    disconnect() { this.item.disconnect(); }
  });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestIdleCallback', undefined);
});
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const enter = (visible = true) => act(() => {
  for (const item of intersections) item.callback([{ isIntersecting: visible, target: item.target } as IntersectionObserverEntry], {} as IntersectionObserver);
});
const loadSdk = async () => {
  await act(async () => { vi.advanceTimersByTime(500); });
  const scripts = document.querySelectorAll<HTMLScriptElement>('script[src*="adsbygoogle.js"]');
  expect(scripts).toHaveLength(1);
  await act(async () => { scripts[0].dispatchEvent(new Event('load')); });
};

it('starts one SDK for several placements, waits for SDK and width, and pushes once per visible element', async () => {
  const { default: Unit } = await import('../src/components/ads/AdSenseUnit');
  const view = render(<><Unit adSlot="one" /><Unit adSlot="two" /></>);
  enter(); expect(window.adsbygoogle).toHaveLength(0);
  await loadSdk(); expect(window.adsbygoogle).toHaveLength(2);
  const elements = [...document.querySelectorAll('ins')];
  enter(false); enter(true); fireEvent.resize(window);
  view.rerender(<><Unit adSlot="one" /><Unit adSlot="two" /></>);
  expect([...document.querySelectorAll('ins')]).toEqual(elements);
  expect(window.adsbygoogle).toHaveLength(2);
});

it('never creates a hidden zero-width ins; a later responsive resize enables it', async () => {
  const { default: Unit } = await import('../src/components/ads/AdSenseUnit');
  width = 0; render(<Unit />); enter(); await act(async () => { vi.advanceTimersByTime(5000); });
  expect(document.querySelector('script[src*="adsbygoogle.js"]')).toBeNull();
  expect(document.querySelector('ins')).toBeNull(); expect(window.adsbygoogle).toHaveLength(0);
  width = 320; fireEvent.resize(window);
  await loadSdk();
  expect(window.adsbygoogle).toHaveLength(1);
});

it('does not start a below-fold or hidden-tab SDK; viewport and document visibility jointly enable it', async () => {
  const { default: Unit } = await import('../src/components/ads/AdSenseUnit');
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  render(<Unit />); enter();
  await act(async () => { vi.advanceTimersByTime(5000); window.dispatchEvent(new Event('online')); });
  expect(document.querySelector('script[src*="adsbygoogle.js"]')).toBeNull();
  enter(false); visibility.mockReturnValue('visible'); fireEvent(document, new Event('visibilitychange'));
  await act(async () => { vi.advanceTimersByTime(5000); });
  expect(document.querySelector('script[src*="adsbygoogle.js"]')).toBeNull();
  enter(); await loadSdk(); expect(window.adsbygoogle).toHaveLength(1);
});

it('without IntersectionObserver loads only after real viewport entry and removes passive scroll/resize listeners', async () => {
  vi.stubGlobal('IntersectionObserver', undefined);
  const added = vi.spyOn(window, 'addEventListener');
  const removed = vi.spyOn(window, 'removeEventListener');
  const { default: Unit } = await import('../src/components/ads/AdSenseUnit');
  top = window.innerHeight + 200;
  const view = render(<Unit />);
  await act(async () => { vi.advanceTimersByTime(5000); });
  expect(document.querySelector('script[src*="adsbygoogle.js"]')).toBeNull();
  expect(document.querySelector('ins')).toBeNull();
  const scroll = added.mock.calls.find(([event]) => event === 'scroll')!;
  expect(scroll[2]).toEqual({ passive: true });
  top = 40; fireEvent.scroll(window); await loadSdk();
  expect(window.adsbygoogle).toHaveLength(1);
  top = -100; fireEvent.scroll(window); top = 40; fireEvent.resize(window);
  await act(async () => { vi.advanceTimersByTime(5000); });
  expect(window.adsbygoogle).toHaveLength(1);
  view.unmount();
  expect(removed).toHaveBeenCalledWith('scroll', scroll[1]);
  expect(removed).toHaveBeenCalledWith('resize', scroll[1]);
});

it('reacts to the actual private SPA pathname while a deferred public component remains mounted', async () => {
  const { default: Unit } = await import('../src/components/ads/AdSenseUnit');
  render(<Unit />); enter(); await loadSdk();
  expect(document.querySelector('ins')).not.toBeNull();
  act(() => { window.history.pushState({}, '', '/de/profil/favoriten'); });
  expect(document.querySelector('.adsense-container')).toBeNull();
  await act(async () => { window.dispatchEvent(new Event('online')); vi.advanceTimersByTime(20000); });
  expect(window.adsbygoogle).toHaveLength(1);
});

it('query-only personal navigation removes a mounted slot without requiring a parent render', async () => {
  const { default: Unit } = await import('../src/components/ads/AdSenseUnit');
  render(<Unit />); enter(); await loadSdk();
  act(() => { window.history.pushState({}, '', '/de?tab=favorites'); });
  expect(document.querySelector('ins')).toBeNull();
  expect(document.querySelector('.adsense-container')).toBeNull();
});

it('late SDK completion cannot push after an eligible URL becomes private, and returning public is safe', async () => {
  const { default: Unit } = await import('../src/components/ads/AdSenseUnit');
  render(<Unit />); enter(); await act(async () => { vi.advanceTimersByTime(500); });
  const script = document.querySelector('script[src*="adsbygoogle.js"]')!;
  act(() => { window.history.pushState({}, '', '/tr/profil/mesajlar'); });
  await act(async () => { script.dispatchEvent(new Event('load')); });
  expect(window.adsbygoogle).toHaveLength(0); expect(document.querySelector('ins')).toBeNull();
  act(() => { window.history.pushState({}, '', '/tr/istasyon/kral-fm'); });
  enter(); await act(async () => { vi.advanceTimersByTime(500); });
  expect(window.adsbygoogle).toHaveLength(1);
  expect(document.querySelectorAll('script[src*="adsbygoogle.js"]')).toHaveLength(1);
  expect(screen.getByText('Reklam')).toBeTruthy();
});

it.each(['loading', 'premium', 'error', 'admin', 'localized-admin', 'payment-confirmation', 'localized-payment-confirmation'])(
  'does not request an SDK or push when %s', async kind => {
    const { default: Unit } = await import('../src/components/ads/AdSenseUnit');
    if (kind === 'loading') premium.isLoading = true;
    if (kind === 'premium') premium.isPremium = true;
    if (kind === 'error') premium.error = new Error('auth unavailable');
    if (kind === 'admin') window.history.replaceState({}, '', '/admin/advertisements');
    if (kind === 'localized-admin') window.history.replaceState({}, '', '/tr/admin/login');
    if (kind === 'payment-confirmation') window.history.replaceState({}, '', '/premium/success');
    if (kind === 'localized-payment-confirmation') window.history.replaceState({}, '', '/de/premium/success');
    render(<Unit />); enter(); await act(async () => { vi.advanceTimersByTime(20000); });
    expect(document.querySelector('script[src*="adsbygoogle.js"]')).toBeNull();
    expect(document.querySelector('ins')).toBeNull(); expect(window.adsbygoogle).toHaveLength(0);
  },
);

it('waits for resolved non-premium auth and recovers an expired remembered premium state', async () => {
  const { default: Unit } = await import('../src/components/ads/AdSenseUnit');
  premium.isLoading = true; localStorage.setItem('_mrt_is_premium', '1');
  const view = render(<Unit />);
  await act(async () => { vi.advanceTimersByTime(500); });
  premium.isLoading = false; view.rerender(<Unit />); enter(); await loadSdk();
  expect(window.adsbygoogle).toHaveLength(1);
  localStorage.removeItem('_mrt_is_premium');
});

it('cancels unmounted placements before loading or accepting late SDK completion', async () => {
  const { default: Unit } = await import('../src/components/ads/AdSenseUnit');
  const first = render(<Unit />); first.unmount();
  await act(async () => { vi.advanceTimersByTime(500); });
  expect(document.querySelector('script[src*="adsbygoogle.js"]')).toBeNull();
  const second = render(<Unit />); enter();
  await act(async () => { vi.advanceTimersByTime(500); });
  second.unmount();
  await act(async () => { document.querySelector('script[src*="adsbygoogle.js"]')?.dispatchEvent(new Event('load')); });
  expect(window.adsbygoogle).toHaveLength(0);
  expect(intersections.every(item => item.disconnect.mock.calls.length > 0)).toBe(true);
});

it('uses a fresh ins when placement identity changes without adding another SDK', async () => {
  const { default: Unit } = await import('../src/components/ads/AdSenseUnit');
  const view = render(<Unit adSlot="one" />); enter(); await loadSdk();
  const old = document.querySelector('ins');
  view.rerender(<Unit adSlot="two" adFormat="rectangle" />); enter();
  await act(async () => { vi.advanceTimersByTime(500); });
  expect(document.querySelector('ins')).not.toBe(old);
  expect(document.querySelector('ins')).toHaveAttribute('data-ad-slot', 'two');
  expect(window.adsbygoogle).toHaveLength(2);
  expect(document.querySelectorAll('script[src*="adsbygoogle.js"]')).toHaveLength(1);
});

it('handles blocked SDKs without retry loops or page failures', async () => {
  const { default: Unit } = await import('../src/components/ads/AdSenseUnit');
  render(<Unit />); enter(); await act(async () => { vi.advanceTimersByTime(500); });
  await act(async () => { document.querySelector('script[src*="adsbygoogle.js"]')?.dispatchEvent(new Event('error')); });
  await act(async () => { vi.advanceTimersByTime(60000); });
  expect(window.adsbygoogle).toHaveLength(0);
  expect(document.querySelectorAll('script[src*="adsbygoogle.js"]')).toHaveLength(1);
});

it('does not repeat a partially handled throwing SDK push on scroll, resize or reconnect', async () => {
  const { default: Unit } = await import('../src/components/ads/AdSenseUnit');
  const push = vi.spyOn(window.adsbygoogle, 'push').mockImplementation(() => { throw new Error('blocked'); });
  render(<Unit />); enter(); await loadSdk(); expect(push).toHaveBeenCalledTimes(1);
  enter(false); enter(true); fireEvent.resize(window);
  await act(async () => { window.dispatchEvent(new Event('online')); vi.advanceTimersByTime(5000); });
  expect(push).toHaveBeenCalledTimes(1);
});

it('accepts a real SDK load after 15 seconds without adding another script or refreshing ads', async () => {
  const { default: Unit } = await import('../src/components/ads/AdSenseUnit');
  const view = render(<Unit />); enter();
  await act(async () => { vi.advanceTimersByTime(20000); });
  expect(window.adsbygoogle).toHaveLength(0);
  const script = document.querySelector('script[src*="adsbygoogle.js"]')!;
  await act(async () => { script.dispatchEvent(new Event('load')); });
  expect(window.adsbygoogle).toHaveLength(1);
  view.rerender(<Unit />); enter(false); enter(true);
  expect(window.adsbygoogle).toHaveLength(1);
  expect(document.querySelectorAll('script[src*="adsbygoogle.js"]')).toHaveLength(1);
});

it('shares one bounded failed-script recovery after reconnect across placements', async () => {
  const { default: Unit } = await import('../src/components/ads/AdSenseUnit');
  render(<><Unit adSlot="one" /><Unit adSlot="two" /></>); enter();
  await act(async () => { vi.advanceTimersByTime(500); });
  const failed = document.querySelector('script[src*="adsbygoogle.js"]')!;
  await act(async () => { failed.dispatchEvent(new Event('error')); });
  await act(async () => { window.dispatchEvent(new Event('online')); });
  const replacement = document.querySelector('script[src*="adsbygoogle.js"]')!;
  expect(replacement).not.toBe(failed);
  expect(failed.isConnected).toBe(false);
  expect(document.querySelectorAll('script[src*="adsbygoogle.js"]')).toHaveLength(1);
  await act(async () => { replacement.dispatchEvent(new Event('load')); });
  expect(window.adsbygoogle).toHaveLength(2);
  const slots = [...document.querySelectorAll('ins')];
  slots.forEach(slot => slot.setAttribute('data-ad-status', 'unfilled'));
  await act(async () => { window.dispatchEvent(new Event('online')); vi.advanceTimersByTime(60000); });
  expect([...document.querySelectorAll('ins')]).toEqual(slots);
  expect(window.adsbygoogle).toHaveLength(2);
  expect(document.querySelector('script[src*="adsbygoogle.js"]')).toBe(replacement);
});

it('does not turn blocked scripts into retries on every reconnect', async () => {
  const { default: Unit } = await import('../src/components/ads/AdSenseUnit');
  render(<Unit />); enter(); await act(async () => { vi.advanceTimersByTime(500); });
  await act(async () => { document.querySelector('script[src*="adsbygoogle.js"]')!.dispatchEvent(new Event('error')); });
  await act(async () => { window.dispatchEvent(new Event('online')); });
  const second = document.querySelector('script[src*="adsbygoogle.js"]')!;
  await act(async () => { second.dispatchEvent(new Event('error')); });
  for (let i = 0; i < 4; i++) await act(async () => { window.dispatchEvent(new Event('online')); });
  expect(document.querySelector('script[src*="adsbygoogle.js"]')).toBe(second);
  expect(window.adsbygoogle).toHaveLength(0);
});

it('never replaces an externally supplied failed SDK on reconnect', async () => {
  const external = document.createElement('script');
  external.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-8771434485570434';
  document.head.appendChild(external);
  const { default: Unit } = await import('../src/components/ads/AdSenseUnit');
  render(<Unit />); enter(); await act(async () => { vi.advanceTimersByTime(500); });
  await act(async () => { external.dispatchEvent(new Event('error')); window.dispatchEvent(new Event('online')); });
  expect(document.querySelector('script[src*="adsbygoogle.js"]')).toBe(external);
  expect(window.adsbygoogle).toHaveLength(0);
});

it.each(['premium', 'unmounted', 'admin'])('does not reconnect an ad SDK after the placement becomes %s', async kind => {
  const { default: Unit } = await import('../src/components/ads/AdSenseUnit');
  const view = render(<Unit />); enter(); await act(async () => { vi.advanceTimersByTime(500); });
  const failed = document.querySelector('script[src*="adsbygoogle.js"]')!;
  await act(async () => { failed.dispatchEvent(new Event('error')); });
  if (kind === 'unmounted') view.unmount();
  if (kind === 'premium') { premium.isPremium = true; view.rerender(<Unit />); }
  if (kind === 'admin') { window.history.replaceState({}, '', '/admin'); view.rerender(<Unit />); }
  await act(async () => { window.dispatchEvent(new Event('online')); });
  expect(document.querySelector('script[src*="adsbygoogle.js"]')).toBe(failed);
  expect(window.adsbygoogle).toHaveLength(0);
});

const ad = (id: string, isActive = true) => ({ _id: id, title: id, imageUrl: `https://images.example/${id}.webp`, altText: id, url: 'https://advertiser.example', position: 'desktop_sidebar' as const, isActive });
it('keeps carousel safe when its selected item is deactivated or removed', () => {
  const view = render(<AdCarousel ads={[ad('one'), ad('two'), ad('three')]} position="desktop_sidebar" />);
  fireEvent.click(screen.getByTestId('button-ad-nav-2'));
  view.rerender(<AdCarousel ads={[ad('one'), ad('two', false)]} position="desktop_sidebar" />);
  expect(screen.getByRole('img')).toHaveAttribute('alt', 'one');
  expect(screen.getByTestId('link-ad')).toHaveAttribute('rel', 'sponsored noopener noreferrer');
  expect(screen.getByRole('img')).not.toHaveAttribute('crossorigin');
});
it('skips broken creatives, uses the fallback, and recovers a repaired URL for the same ad', () => {
  const view = render(<AdCarousel ads={[ad('one'), ad('two')]} position="desktop_sidebar" fallback={<div>Google placement</div>} />);
  fireEvent.error(screen.getByRole('img')); expect(screen.getByRole('img')).toHaveAttribute('alt', 'two');
  fireEvent.error(screen.getByRole('img')); expect(screen.getByText('Google placement')).toBeTruthy();
  view.rerender(<AdCarousel ads={[{ ...ad('one'), imageUrl: '/repaired.webp' }]} position="desktop_sidebar" fallback={<div>Google placement</div>} />);
  expect(screen.getByRole('img')).toHaveAttribute('src', '/repaired.webp');
});
