import React, { useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdCarousel } from '../src/components/ad-carousel';

const ad = (id: string, url = `https://advertiser.example/${id}`) => ({
  _id: id, title: id, imageUrl: `https://images.example/${id}.webp`, altText: id,
  url, position: 'desktop_sidebar' as const, isActive: true,
});
const ads = [ad('one'), ad('two')];
let intersections: Array<{ callback: IntersectionObserverCallback; target?: Element; disconnect: ReturnType<typeof vi.fn> }>;
let hidden = false;
let reduced = false;
let motionListeners: Set<() => void>;

beforeEach(() => {
  vi.useFakeTimers();
  window.history.replaceState({}, '', '/de');
  hidden = false;
  reduced = false;
  intersections = [];
  motionListeners = new Set();
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => hidden ? 'hidden' : 'visible');
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    get matches() { return reduced; },
    addEventListener: (_event: string, listener: () => void) => motionListeners.add(listener),
    removeEventListener: (_event: string, listener: () => void) => motionListeners.delete(listener),
  })));
  vi.stubGlobal('IntersectionObserver', class {
    item: (typeof intersections)[number];
    constructor(callback: IntersectionObserverCallback) {
      this.item = { callback, disconnect: vi.fn() };
      intersections.push(this.item);
    }
    observe(target: Element) { this.item.target = target; }
    disconnect() { this.item.disconnect(); }
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function enter(visible = true) {
  act(() => {
    const observer = intersections.at(-1)!;
    observer.callback([{ target: observer.target, isIntersecting: visible } as IntersectionObserverEntry], {} as IntersectionObserver);
  });
}
const advance = (milliseconds: number) => act(() => { vi.advanceTimersByTime(milliseconds); });
function visibility(value: boolean) {
  act(() => { hidden = !value; document.dispatchEvent(new Event('visibilitychange')); });
}
function motion(value: boolean) {
  act(() => { reduced = value; motionListeners.forEach(listener => listener()); });
}
const selected = (id: string) => expect(screen.getByRole('img')).toHaveAttribute('alt', id);

it('waits for viewport visibility and uses a 30-second default without changing creative dimensions', () => {
  render(<AdCarousel ads={ads} position="desktop_sidebar" />);
  advance(120_000); selected('one');
  enter(); advance(29_999); selected('one');
  advance(1); selected('two');
  expect(screen.getByRole('group')).toHaveClass('w-[218px]', 'h-[218px]');
  expect(screen.getByRole('img')).toHaveClass('w-[218px]', 'h-[218px]');
});

it('pauses out of view and resumes with a fresh interval, without a catch-up jump', () => {
  render(<AdCarousel ads={ads} position="desktop_sidebar" autoSwitchInterval={1000} />);
  enter(); advance(600); enter(false);
  advance(6000); selected('one');
  enter(); advance(999); selected('one');
  advance(1); selected('two');
});

it('does not start in a background document and pauses again when the tab becomes hidden', () => {
  hidden = true;
  render(<AdCarousel ads={ads} position="desktop_sidebar" autoSwitchInterval={1000} />);
  enter(); advance(3000); selected('one');
  visibility(true); advance(1000); selected('two');
  visibility(false); advance(3000); selected('two');
  visibility(true); advance(999); selected('two');
  advance(1); selected('one');
});

it('honors initial and live reduced-motion preferences while keeping manual navigation available', () => {
  reduced = true;
  render(<AdCarousel ads={ads} position="desktop_sidebar" autoSwitchInterval={1000} />);
  enter(); advance(3000); selected('one');
  fireEvent.click(screen.getByTestId('button-ad-nav-1')); selected('two');
  expect(screen.getByTestId('button-ad-nav-1')).toHaveAttribute('aria-pressed', 'true');
  motion(false); advance(1000); selected('one');
  motion(true); advance(3000); selected('one');
});

it('pauses while hovered or focus remains within any carousel action', () => {
  render(<AdCarousel ads={ads} position="desktop_sidebar" autoSwitchInterval={1000} />);
  enter();
  const group = screen.getByRole('group');
  fireEvent.mouseEnter(group); advance(2000); selected('one');
  fireEvent.mouseLeave(group); advance(1000); selected('two');
  act(() => screen.getByTestId('link-ad').focus());
  advance(2000); selected('two');
  act(() => screen.getByTestId('button-ad-nav-0').focus());
  advance(2000); selected('two');
  act(() => screen.getByTestId('button-ad-nav-0').blur());
  advance(1000); selected('one');
});

it('leaves manual selection available without an observer rather than rotating a potentially hidden placement', () => {
  vi.stubGlobal('IntersectionObserver', undefined);
  render(<AdCarousel ads={ads} position="desktop_sidebar" />);
  advance(120_000); selected('one');
  fireEvent.click(screen.getByTestId('button-ad-nav-1')); selected('two');
  expect(vi.getTimerCount()).toBe(0);
});

it('keeps a Google fallback mounted exactly once with no rotation, refill, or duplicate sponsor label', () => {
  const mount = vi.fn();
  const unmount = vi.fn();
  function GoogleFallback() {
    useEffect(() => { mount(); return unmount; }, []);
    return <ins data-testid="google-placement" />;
  }
  const view = render(<AdCarousel ads={ads} position="desktop_sidebar" fallback={<GoogleFallback />} />);
  enter(); advance(30_000);
  fireEvent.error(screen.getByRole('img'));
  fireEvent.error(screen.getByRole('img'));
  const original = screen.getByTestId('google-placement');
  visibility(false); motion(true); advance(120_000);
  visibility(true); motion(false); advance(120_000);
  view.rerender(<AdCarousel ads={[]} position="desktop_sidebar" fallback={<GoogleFallback />} />);
  expect(screen.getByTestId('google-placement')).toBe(original);
  expect(mount).toHaveBeenCalledTimes(1);
  expect(unmount).not.toHaveBeenCalled();
  expect(screen.queryByText('Werbung')).not.toBeInTheDocument();
  expect(vi.getTimerCount()).toBe(0);
});

it('starts observation if new direct sponsors replace an empty placement and cleans up on unmount', () => {
  const view = render(<AdCarousel ads={[]} position="desktop_sidebar" fallback={<ins />} />);
  expect(intersections).toHaveLength(0);
  view.rerender(<AdCarousel ads={ads} position="desktop_sidebar" fallback={<ins />} />);
  expect(intersections).toHaveLength(1);
  enter(); advance(30_000); selected('two');
  view.unmount();
  expect(intersections[0].disconnect).toHaveBeenCalledTimes(1);
  expect(motionListeners.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['javascript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,bad', 'blob:https://example.com/id', 'mailto:ads@example.com', '', 'http://[invalid'])('does not create an unsafe sponsor link for %j', url => {
  render(<AdCarousel ads={[ad('unsafe', url), ad('safe')]} position="desktop_sidebar" />);
  selected('safe');
  expect(screen.getByTestId('link-ad')).toHaveAttribute('href', 'https://advertiser.example/safe');
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

it.each(['http://advertiser.example', 'https://advertiser.example', '/sponsor'])('preserves ordinary web links without activating them: %s', url => {
  render(<AdCarousel ads={[ad('safe', url)]} position="desktop_sidebar" />);
  expect(screen.getByTestId('link-ad')).toHaveAttribute('href', url);
  expect(screen.getByTestId('link-ad')).toHaveAttribute('rel', 'sponsored noopener noreferrer');
});

it.each([['/de/sender/test', 'Werbung'], ['/tr/istasyon/test', 'Reklam'], ['/en/station/test', 'Advertisement']])('labels sponsors in the page language at %s', (path, label) => {
  window.history.replaceState({}, '', path);
  render(<AdCarousel ads={ads} position="desktop_sidebar" />);
  expect(screen.getByRole('group', { name: label })).toBeInTheDocument();
  expect(screen.getByText(label)).toBeVisible();
  expect(screen.getByTestId('button-ad-nav-0')).toHaveAccessibleName(`${label} 1`);
});

it('accepts an explicit sponsor label without adding it to the placeholder or fallback', () => {
  const view = render(<AdCarousel ads={ads} position="desktop_sidebar" advertisementLabel="Sponsor" />);
  expect(screen.getByRole('group', { name: 'Sponsor' })).toBeInTheDocument();
  view.rerender(<AdCarousel ads={[]} position="desktop_sidebar" advertisementLabel="Sponsor" placeholderText="Placeholder" />);
  expect(screen.queryByText('Sponsor')).not.toBeInTheDocument();
  expect(screen.getByText('Placeholder')).toBeInTheDocument();
});
