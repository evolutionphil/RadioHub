import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { usePushNotifications } from '../src/hooks/usePushNotifications';
import { getProfileSettingsNotificationMessages } from '../src/lib/profile-settings-notification-copy';
import { ACTIVE_SITEMAP_LANGUAGES } from '@workspace/seo-shared/seo-config';

const fixture = vi.hoisted(() => ({
  permission: 'default' as NotificationPermission,
  success: vi.fn(), error: vi.fn(), requestPermission: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn(), isSubscribed: vi.fn(),
}));
vi.mock('@/hooks/useNotifications', () => ({ useNotifications: () => ({ success: fixture.success, error: fixture.error }) }));
vi.mock('@/services/pushNotificationManager', () => ({ PushNotificationManager: { getInstance: () => ({
  initialize: async () => true, getPermissionStatus: () => fixture.permission,
  requestPermission: fixture.requestPermission, subscribe: fixture.subscribe, unsubscribe: fixture.unsubscribe, isSubscribed: fixture.isSubscribed,
}) } }));
beforeEach(() => {
  vi.clearAllMocks(); fixture.permission = 'default';
  vi.stubGlobal('Notification', { get permission() { return fixture.permission; } });
  fixture.isSubscribed.mockResolvedValue(false);
  fixture.requestPermission.mockImplementation(async () => { fixture.permission = 'granted'; return true; });
  fixture.subscribe.mockResolvedValue({ endpoint: 'test' }); fixture.unsubscribe.mockResolvedValue(true);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const german = getProfileSettingsNotificationMessages('de');

it('reports one localized success after permission and subscription', async () => {
  const { result } = renderHook(() => usePushNotifications(german));
  await waitFor(() => expect(result.current.isSupported).toBe(true));
  await act(async () => { expect(await result.current.subscribe()).toBe(true); });
  expect(fixture.requestPermission).toHaveBeenCalledOnce();
  expect(fixture.success).toHaveBeenCalledTimes(1);
  expect(fixture.success).toHaveBeenCalledWith('Erfolg', 'Benachrichtigungen: Aktiviert');
  expect(fixture.error).not.toHaveBeenCalled();
});
it('reports a localized failure without a premature permission-success message', async () => {
  fixture.subscribe.mockRejectedValue(new Error('service offline'));
  const { result } = renderHook(() => usePushNotifications(german));
  await waitFor(() => expect(result.current.isSupported).toBe(true));
  await act(async () => { expect(await result.current.subscribe()).toBe(false); });
  expect(fixture.success).not.toHaveBeenCalled();
  expect(fixture.error).toHaveBeenCalledTimes(1);
  expect(fixture.error).toHaveBeenCalledWith('Fehler', german.failed);
});
it('shows the localized blocked instructions and never subscribes after denial', async () => {
  fixture.requestPermission.mockImplementation(async () => { fixture.permission = 'denied'; return false; });
  const { result } = renderHook(() => usePushNotifications(german));
  await waitFor(() => expect(result.current.isSupported).toBe(true));
  await act(async () => { await result.current.subscribe(); });
  expect(fixture.subscribe).not.toHaveBeenCalled();
  expect(fixture.success).not.toHaveBeenCalled();
  expect(fixture.error).toHaveBeenCalledTimes(1);
  expect(fixture.error).toHaveBeenCalledWith('Fehler', german.blocked);
});
it('keeps test-send errors localized and does not show a false success for HTTP errors', async () => {
  fixture.isSubscribed.mockResolvedValue(true);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, message: 'English server message' }), { status: 503 })));
  const { result } = renderHook(() => usePushNotifications(german));
  await waitFor(() => expect(result.current.isSubscribed).toBe(true));
  await act(async () => { await result.current.sendTestNotification(); });
  expect(fixture.error).toHaveBeenCalledTimes(1);
  expect(fixture.error).toHaveBeenCalledWith('Fehler', german.failed);
  expect(fixture.success).not.toHaveBeenCalled();
});
it('keeps legacy consumer outcomes when no localized messages are supplied', async () => {
  const { result } = renderHook(() => usePushNotifications());
  await waitFor(() => expect(result.current.isSupported).toBe(true));
  await act(async () => { await result.current.subscribe(); });
  expect(fixture.success).toHaveBeenCalledTimes(2);
  expect(fixture.success).toHaveBeenLastCalledWith('Subscribed Successfully', 'You will now receive push notifications!');
});
it('provides native notification outcomes for all14 settings languages', () => {
  const english = getProfileSettingsNotificationMessages('en');
  for (const language of ACTIVE_SITEMAP_LANGUAGES) {
    const copy = getProfileSettingsNotificationMessages(language);
    expect(Object.values(copy).every(value => !!value.trim())).toBe(true);
    if (language !== 'en') for (const key of ['failed', 'testSent', 'permissionDismissed', 'notSubscribed'] as const) expect(copy[key]).not.toBe(english[key]);
  }
});
