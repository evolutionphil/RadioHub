import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdCarousel } from '../src/components/ad-carousel';

const premium = vi.hoisted(() => ({ isPremium: false, isLoading: false, error: null as unknown }));
vi.mock('../src/hooks/usePremiumStatus', () => ({ usePremiumStatus: () => premium }));
let intersections: { callback: IntersectionObserverCallback; target?: Element; disconnect: ReturnType<typeof vi.fn> }[];
let width = 320;

beforeEach(() => {
  vi.useFakeTimers(); vi.resetModules();
  Object.assign(premium, { isPremium: false, isLoading: false, error: null });
  window.history.replaceState({}, '', '/de');
  document.querySelectorAll('script[src*="adsbygoogle.js"]').forEach(script => script.remove());
  window.adsbygoogle = [];
  intersections = []; width = 320;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width, height: 90, top: 0, left: 0, bottom: 90, right: width, x: 0, y: 0, toJSON: () => ({}) }));
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
  width = 0; render(<Unit />); enter(); await loadSdk();
  expect(document.querySelector('ins')).toBeNull(); expect(window.adsbygoogle).toHaveLength(0);
  width = 320; fireEvent.resize(window);
  expect(window.adsbygoogle).toHaveLength(1);
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
