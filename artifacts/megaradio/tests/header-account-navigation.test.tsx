import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Router, useLocation, useSearch } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { translateUrl } from '@workspace/seo-shared/url-translations';

vi.mock('@assets/notification1.png', () => ({ default: 'notification1.png' }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { _id: 'listener', fullName: 'Listener' }, isAuthenticated: true, isLoading: false }) }));
vi.mock('@/hooks/useGlobalPlayer', () => ({ useGlobalPlayer: () => ({ playStation: vi.fn() }) }));
vi.mock('@/hooks/usePremiumStatus', () => ({ usePremiumStatus: () => ({ isPremium: false }) }));
const fixture = vi.hoisted(() => ({ translations: {} as Record<string, string> }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({
  t: (_key: string, fallback?: string) => fallback ?? _key,
  setLanguage: vi.fn(), localeTranslations: fixture.translations,
}) }));
vi.mock('@/components/HighlightMatch', () => ({ HighlightMatch: ({ text }: { text: string }) => <>{text}</> }));

import RadioHeader from '@/components/layout/radio-header';

let client: QueryClient;
beforeEach(() => {
  fixture.translations = { messages: 'Messages', nav_logout: 'Logout' };
  vi.stubGlobal('innerWidth', 390);
  client = new QueryClient({ defaultOptions: { queries: {
    retry: false, gcTime: 0, staleTime: Infinity,
    queryFn: ({ queryKey }) => { throw new Error(`Unexpected query: ${JSON.stringify(queryKey)}`); },
  } } });
  client.setQueryData(['/api/filters/countries'], ['Germany']);
  client.setQueryData(['/api/countries', 'rich'], [{ name: 'Germany', stationCount: 100 }]);
  client.setQueryData(['/api/user/notifications', 'listener', 1, 10, 'all'], { notifications: [], unreadCount: 0 });
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function CurrentRoute() {
  const [location] = useLocation();
  const search = useSearch();
  return <output data-testid="current-route">{location}{search ? `?${search}` : ''}</output>;
}

function mount(language: string) {
  const path = `/${language}${translateUrl('/profile/settings', language)}`;
  window.history.replaceState({}, '', path);
  const { hook } = memoryLocation({ path });
  return render(<QueryClientProvider client={client}><Router hook={hook}>
    <RadioHeader />
    <CurrentRoute />
  </Router></QueryClientProvider>);
}

it.each([
  ['en', 'Messages', 'Logout'],
  ['de', 'Nachrichten', 'Abmelden'],
  ['tr', 'Mesajlar', 'Çıkış yap'],
  ['ar', 'الرسائل', 'تسجيل الخروج'],
])('opens Messages from the %s account menu with a full pointer click', async (language, messages, logout) => {
  const user = userEvent.setup();
  mount(language);
  const trigger = screen.getByTestId('button-mobile-profile');
  await user.click(trigger);
  const menu = screen.getByTestId('mobile-profile-dropdown');
  const link = within(menu).getByRole('link', { name: messages });
  expect(within(menu).getByRole('button', { name: logout })).toBeInTheDocument();
  const destination = `/${language}${translateUrl('/profile/messages', language)}`;
  expect(link).toHaveAttribute('href', destination);

  // Pointer-down precedes click. The outside-dismiss handler must keep the
  // target mounted until Wouter receives the link's activation event.
  await user.pointer({ target: link, keys: '[MouseLeft>]' });
  expect(menu).toBeInTheDocument();
  await user.pointer({ target: link, keys: '[/MouseLeft]' });

  expect(screen.getByTestId('current-route')).toHaveTextContent(destination);
  expect(screen.queryByTestId('mobile-profile-dropdown')).not.toBeInTheDocument();
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

it('retains custom translations from the current locale in the account menu', async () => {
  fixture.translations = { messages: 'Deine Nachrichten', nav_logout: 'Jetzt abmelden' };
  const user = userEvent.setup();
  mount('de');
  await user.click(screen.getByTestId('button-mobile-profile'));
  const menu = screen.getByTestId('mobile-profile-dropdown');
  expect(within(menu).getByRole('link', { name: 'Deine Nachrichten' })).toBeInTheDocument();
  expect(within(menu).getByRole('button', { name: 'Jetzt abmelden' })).toBeInTheDocument();
});

it('opens the conversation when a message notification is clicked', async () => {
  const senderId = 'bbbbbbbbbbbbbbbbbbbbbbbb';
  client.setQueryData(['/api/user/notifications', 'listener', 1, 10, 'all'], {
    notifications: [{ _id: 'message-notification', type: 'new_message', fromUserId: senderId, title: 'New message', read: true }],
    unreadCount: 0,
  });
  const user = userEvent.setup();
  mount('en');
  await user.click(screen.getByTestId('button-notifications-mobile'));
  const notification = screen.getByTestId('notification-item-0');
  await user.pointer({ target: notification, keys: '[MouseLeft>]' });
  expect(notification).toBeInTheDocument();
  await user.pointer({ target: notification, keys: '[/MouseLeft]' });
  expect(screen.getByTestId('current-route')).toHaveTextContent(`/en/profile/messages?partner=${senderId}`);
  expect(screen.queryByTestId('notification-dropdown')).not.toBeInTheDocument();
});

it('closes an open account menu when the trigger is clicked again or the pointer is outside it', async () => {
  const user = userEvent.setup();
  mount('de');
  const trigger = screen.getByTestId('button-mobile-profile');
  await user.click(trigger);
  await user.click(trigger);
  expect(screen.queryByTestId('mobile-profile-dropdown')).not.toBeInTheDocument();
  await user.click(trigger);
  await user.click(screen.getByTestId('current-route'));
  expect(screen.queryByTestId('mobile-profile-dropdown')).not.toBeInTheDocument();
});
