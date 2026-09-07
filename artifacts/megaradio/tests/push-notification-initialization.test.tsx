import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { PushNotificationManager } from '../src/services/pushNotificationManager';
import { PushNotificationBridge } from '../src/components/PushNotificationBridge';

let worker: EventTarget & { register: ReturnType<typeof vi.fn>; ready: Promise<unknown> };
beforeEach(() => {
  // Each fixture models a new browser page, without network or real workers.
  (PushNotificationManager as any).instance = null;
  worker = Object.assign(new EventTarget(), { register: vi.fn().mockResolvedValue({}), ready: Promise.resolve({}) });
  vi.stubGlobal('PushManager', class {});
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: worker });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); delete (navigator as any).serviceWorker; });

it('coalesces concurrent initialization and forwards each notification action only once', async () => {
  const manager = PushNotificationManager.getInstance();
  const listener = vi.spyOn(worker, 'addEventListener');
  const play = vi.fn(), favorite = vi.fn();
  window.addEventListener('notification-play', play);
  window.addEventListener('notification-favorite', favorite);
  try {
    expect(await Promise.all(Array.from({ length: 30 }, () => manager.initialize()))).toEqual(Array(30).fill(true));
    expect(await manager.initialize()).toBe(true);
    expect(worker.register).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
    worker.dispatchEvent(new MessageEvent('message', { data: { type: 'NOTIFICATION_ACTION', action: 'play', data: { station: 'radio' } } }));
    worker.dispatchEvent(new MessageEvent('message', { data: { type: 'NOTIFICATION_ACTION', action: 'favorite', data: { station: 'radio' } } }));
    expect(play).toHaveBeenCalledTimes(1); expect(favorite).toHaveBeenCalledTimes(1);
    expect(play.mock.calls[0][0].detail).toEqual({ station: 'radio' });
  } finally {
    window.removeEventListener('notification-play', play); window.removeEventListener('notification-favorite', favorite);
  }
});

it('retries transient initialization failures without adding duplicate listeners', async () => {
  worker.register.mockRejectedValueOnce(new Error('offline'));
  const manager = PushNotificationManager.getInstance();
  expect(await manager.initialize()).toBe(false);
  expect(await manager.initialize()).toBe(true);
  expect(worker.register).toHaveBeenCalledTimes(2);
});

it('the application bridge has no permission poll or render-dependent initialization', async () => {
  const manager = PushNotificationManager.getInstance();
  const initialize = vi.spyOn(manager, 'initialize').mockResolvedValue(true);
  const interval = vi.spyOn(window, 'setInterval');
  const { rerender } = render(<PushNotificationBridge />);
  rerender(<PushNotificationBridge />);
  expect(initialize).toHaveBeenCalledTimes(1);
  expect(interval).not.toHaveBeenCalled();
});

it('test notifications use the existing PNG icon without bypassing permission checks', async () => {
  const notification = vi.fn();
  Object.defineProperty(notification, 'permission', { configurable: true, value: 'granted' });
  vi.stubGlobal('Notification', notification);
  const manager = PushNotificationManager.getInstance();
  await manager.testNotification();
  expect(notification).toHaveBeenCalledWith('🎵 Test Notification', expect.objectContaining({
    icon: '/favicon.png', badge: '/favicon.png', tag: 'test',
  }));
  Object.defineProperty(notification, 'permission', { configurable: true, value: 'denied' });
  await manager.testNotification();
  expect(notification).toHaveBeenCalledTimes(1);
});
