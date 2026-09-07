import React, { StrictMode, useLayoutEffect } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { notificationManager, useNotifications, type Notification } from '../src/hooks/useNotifications';

const listeners = new Set<ReturnType<typeof vi.fn>>();
const allListeners: ReturnType<typeof vi.fn>[] = [];

beforeEach(() => {
  notificationManager.dismissAll();
  listeners.clear();
  allListeners.length = 0;
  const subscribe = notificationManager.subscribe;
  vi.spyOn(notificationManager, 'subscribe').mockImplementation(listener => {
    const observed = vi.fn((notifications: Notification[]) => listener(notifications));
    listeners.add(observed);
    allListeners.push(observed);
    const unsubscribe = subscribe(observed);
    return () => { listeners.delete(observed); unsubscribe(); };
  });
});

afterEach(() => {
  cleanup();
  notificationManager.dismissAll();
  vi.restoreAllMocks();
});

it('unsubscribes on unmount and remounts without retaining old listeners', () => {
  const first = renderHook(useNotifications);
  expect(listeners.size).toBe(1);
  first.unmount();
  expect(listeners.size).toBe(0);
  act(() => { notificationManager.add({ title: 'While unmounted', duration: 0 }); });
  expect(allListeners[0]).not.toHaveBeenCalled();

  const second = renderHook(useNotifications);
  expect(listeners.size).toBe(1);
  expect(second.result.current.notifications.map(n => n.title)).toEqual(['While unmounted']);
  act(() => { notificationManager.add({ title: 'Live delivery', duration: 0 }); });
  expect(second.result.current.notifications.map(n => n.title)).toEqual(['While unmounted', 'Live delivery']);
  expect(allListeners[0]).not.toHaveBeenCalled();
  expect(allListeners[1]).toHaveBeenCalledTimes(1);
  second.unmount();
  expect(listeners.size).toBe(0);
});

it('StrictMode leaves one live subscription and delivers each update once', () => {
  const view = renderHook(useNotifications, { wrapper: ({ children }) => <StrictMode>{children}</StrictMode> });
  expect(listeners.size).toBe(1);
  act(() => { notificationManager.add({ title: 'Strict delivery', duration: 0 }); });
  expect(view.result.current.notifications).toHaveLength(1);
  expect(allListeners.reduce((count, listener) => count + listener.mock.calls.length, 0)).toBe(1);
  view.unmount();
  expect(listeners.size).toBe(0);
});

it('does not lose an update between render and subscription setup', () => {
  const view = renderHook(() => {
    const state = useNotifications();
    useLayoutEffect(() => {
      notificationManager.add({ title: 'Commit-time update', duration: 0 });
    }, []);
    return state;
  });
  expect(view.result.current.notifications.map(n => n.title)).toEqual(['Commit-time update']);
  expect(listeners.size).toBe(1);
});

it('preserves public notify/update/dismiss delivery to multiple live consumers', () => {
  const first = renderHook(useNotifications);
  const second = renderHook(useNotifications);
  const onDismiss = vi.fn();
  let id = '';
  act(() => { id = first.result.current.success('Saved', 'Original body', { duration: 0, onDismiss }); });
  expect(second.result.current.notifications).toEqual([expect.objectContaining({ id, type: 'success', title: 'Saved' })]);
  act(() => { first.result.current.update(id, { message: 'Updated body' }); });
  expect(second.result.current.notifications[0].message).toBe('Updated body');
  act(() => { second.result.current.dismiss(id); });
  expect(first.result.current.notifications).toEqual([]);
  expect(onDismiss).toHaveBeenCalledTimes(1);
  for (const listener of listeners) expect(listener).toHaveBeenCalledTimes(3);
});
