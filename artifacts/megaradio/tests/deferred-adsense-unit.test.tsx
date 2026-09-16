import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const moduleLoaded = vi.hoisted(() => vi.fn());
let premium = { isPremium: false, isLoading: false, error: null as unknown };
vi.mock('@/hooks/usePremiumStatus', () => ({ usePremiumStatus: () => premium }));
vi.mock('@/components/ads/AdSenseUnit', () => {
  moduleLoaded();
  return { default: (props: any) => <aside data-testid="loaded-ad" data-slot={props.adSlot}
    data-format={props.adFormat} data-responsive={String(props.fullWidthResponsive)} className={props.className} /> };
});
import DeferredAdSenseUnit from '../src/components/ads/DeferredAdSenseUnit';

let observers: Array<{ callback: IntersectionObserverCallback; disconnect: ReturnType<typeof vi.fn> }>;
let rect = { width: 320, height: 90, top: 4000, bottom: 4090, left: 0, right: 320 };
const props = { adSlot: '9151849981', adFormat: 'horizontal' as const, fullWidthResponsive: false,
  className: 'col-span-full my-3 py-6 md:hidden' };

beforeEach(() => {
  window.history.replaceState({}, '', '/de/radios');
  premium = { isPremium: false, isLoading: false, error: null };
  rect = { width: 320, height: 90, top: 4000, bottom: 4090, left: 0, right: 320 };
  observers = [];
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => rect as DOMRect);
  vi.stubGlobal('IntersectionObserver', class {
    item: typeof observers[number];
    constructor(callback: IntersectionObserverCallback) {
      this.item = { callback, disconnect: vi.fn() };
      observers.push(this.item);
    }
    observe() {}
    disconnect() { this.item.disconnect(); }
  });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function intersect(visible: boolean) {
  act(() => {
    for (const observer of observers) observer.callback([{ isIntersecting: visible } as IntersectionObserverEntry], {} as IntersectionObserver);
  });
}

it('keeps the ad module deferred behind an identical placeholder until viewport entry', async () => {
  const view = render(<DeferredAdSenseUnit {...props} />);
  const placeholder = view.container.firstElementChild;
  expect(placeholder).toHaveAttribute('data-ad-placement', props.adSlot);
  expect(placeholder).toHaveClass('adsense-container', 'col-span-full', 'md:hidden', 'py-6');
  expect(placeholder).toHaveStyle({ minHeight: '90px' });
  expect(screen.getByText('Werbung')).toBeInTheDocument();
  expect(moduleLoaded).not.toHaveBeenCalled();
  intersect(false);
  expect(moduleLoaded).not.toHaveBeenCalled();

  intersect(true);
  const ad = await screen.findByTestId('loaded-ad');
  expect(moduleLoaded).toHaveBeenCalledTimes(1);
  expect(ad).toHaveAttribute('data-slot', props.adSlot);
  expect(ad).toHaveAttribute('data-format', 'horizontal');
  expect(ad).toHaveAttribute('data-responsive', 'false');
  expect(ad).toHaveClass('md:hidden');
  expect(observers[0].disconnect).toHaveBeenCalled();
  // Leaving the viewport must not replace an initialized placement.
  intersect(false);
  view.rerender(<DeferredAdSenseUnit {...props} />);
  expect(screen.getByTestId('loaded-ad')).toBe(ad);
});

it('does not mount a responsive-hidden placement until it has a visible box', async () => {
  rect.width = 0;
  render(<DeferredAdSenseUnit {...props} />);
  intersect(true);
  expect(screen.queryByTestId('loaded-ad')).toBeNull();
  rect.width = 320;
  fireEvent(window, new Event('resize'));
  expect(await screen.findByTestId('loaded-ad')).toBeInTheDocument();
});

it('waits for the document to become visible', async () => {
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  render(<DeferredAdSenseUnit {...props} />);
  intersect(true);
  expect(screen.queryByTestId('loaded-ad')).toBeNull();
  visibility.mockReturnValue('visible');
  fireEvent(document, new Event('visibilitychange'));
  expect(await screen.findByTestId('loaded-ad')).toBeInTheDocument();
});

it.each([
  { isPremium: true, isLoading: false, error: null },
  { isPremium: false, isLoading: true, error: null },
  { isPremium: false, isLoading: false, error: new Error('auth unavailable') },
])('does not load for unresolved or ineligible premium status: %j', state => {
  premium = state;
  const view = render(<DeferredAdSenseUnit {...props} />);
  intersect(true);
  expect(screen.queryByTestId('loaded-ad')).toBeNull();
  expect(observers).toHaveLength(0);
  if (state.isPremium) expect(view.container).toBeEmptyDOMElement();
});

it('begins observing only after non-premium authentication resolves', async () => {
  premium.isLoading = true;
  const view = render(<DeferredAdSenseUnit {...props} />);
  expect(observers).toHaveLength(0);
  premium.isLoading = false;
  view.rerender(<DeferredAdSenseUnit {...props} />);
  expect(screen.queryByTestId('loaded-ad')).toBeNull();
  intersect(true);
  expect(await screen.findByTestId('loaded-ad')).toBeInTheDocument();
});

it('rechecks the actual URL before loading a placement retained by a deferred router', () => {
  const view = render(<DeferredAdSenseUnit {...props} />);
  window.history.replaceState({}, '', '/de/profile/messages');
  intersect(true);
  expect(screen.queryByTestId('loaded-ad')).toBeNull();
  view.rerender(<DeferredAdSenseUnit {...props} />);
  expect(view.container).toBeEmptyDOMElement();
});

it('uses real viewport bounds without IntersectionObserver and removes its listeners', async () => {
  vi.stubGlobal('IntersectionObserver', undefined);
  const remove = vi.spyOn(window, 'removeEventListener');
  const view = render(<DeferredAdSenseUnit {...props} />);
  expect(screen.queryByTestId('loaded-ad')).toBeNull();
  rect.top = 200;
  rect.bottom = 290;
  fireEvent.scroll(window);
  expect(await screen.findByTestId('loaded-ad')).toBeInTheDocument();
  expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function));
  view.unmount();
  expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
});
