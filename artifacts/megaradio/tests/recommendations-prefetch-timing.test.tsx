import React from 'react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
const state = vi.hoisted(() => ({ prefetch: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ prefetchQuery: state.prefetch }) }));
vi.mock('@/lib/precomputed-pool', () => ({ getPrecomputedStationsSlice: vi.fn() }));
import { RecommendationsPrefetcher } from '../src/components/recommendations/RecommendationsPrefetcher';
beforeEach(() => {
  vi.useFakeTimers(); state.prefetch.mockClear();
  Object.defineProperty(document, 'readyState', { configurable: true, value: 'complete' });
  vi.stubGlobal('requestIdleCallback', undefined);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); delete (document as any).readyState; });

it('does not compete with initial content; still warms all four recommendation queries after grace and idle', () => {
  const { unmount } = render(<RecommendationsPrefetcher />);
  act(() => vi.advanceTimersByTime(7999)); expect(state.prefetch).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1501)); expect(state.prefetch).toHaveBeenCalledTimes(4);
  expect(state.prefetch.mock.calls[0][0].queryKey).toEqual(['/api/stations/precomputed', 'global', 200, 'mood-pool']);
  unmount();
});

it('interaction warms sooner but only once, and unmount cancels pending speculative work', () => {
  const view = render(<RecommendationsPrefetcher />);
  act(() => { window.dispatchEvent(new Event('pointerdown')); vi.advanceTimersByTime(1500); });
  expect(state.prefetch).toHaveBeenCalledTimes(4);
  act(() => { window.dispatchEvent(new Event('keydown')); vi.advanceTimersByTime(20000); });
  expect(state.prefetch).toHaveBeenCalledTimes(4);
  view.unmount(); state.prefetch.mockClear();
  const second = render(<RecommendationsPrefetcher />); second.unmount();
  act(() => vi.runAllTimers()); expect(state.prefetch).not.toHaveBeenCalled();
});
