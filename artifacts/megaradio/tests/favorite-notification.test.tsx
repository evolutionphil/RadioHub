import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireFavoriteMutation, favoriteNotificationText } from '../src/lib/favorite-notification';
import { toast } from '../src/hooks/use-toast';
import { Toaster } from '../src/components/ui/toaster';

describe('favorite notification text', () => {
  it.each(['en', 'de', 'tr', 'fr', 'es', 'it', 'pt', 'ru', 'ko', 'hi', 'he', 'ar', 'zh', 'ja'])('has complete native fallbacks for %s', language => {
    const text = favoriteNotificationText(language);
    expect(Object.values(text).every(value => value.trim().length > 0)).toBe(true);
    if (language !== 'en') expect(text.added).not.toBe(favoriteNotificationText('en').added);
  });
  it('prefers current-language admin translations and uses fallbacks for blank entries', () => {
    expect(favoriteNotificationText('de', { favorites_added_to_favorites: 'Gespeichert', notification_dismiss: ' ' })).toMatchObject({ added: 'Gespeichert', close: 'Benachrichtigung schließen' });
    expect(favoriteNotificationText('not-supported')).toEqual(favoriteNotificationText('en'));
  });
});

it('locks only the same account/station/client and releases without timers', () => {
  const client = {};
  const release = acquireFavoriteMutation(client, 'a', 'station');
  expect(release).toBeTypeOf('function');
  expect(acquireFavoriteMutation(client, 'a', 'station')).toBeNull();
  expect(acquireFavoriteMutation(client, 'b', 'station')).toBeTypeOf('function');
  expect(acquireFavoriteMutation({}, 'a', 'station')).toBeTypeOf('function');
  release!();
  expect(acquireFavoriteMutation(client, 'a', 'station')).toBeTypeOf('function');
});

afterEach(() => { act(() => { toast({ title: 'Reset', open: false }).dismiss(); }); });

it('renders a compact dismissible branded notification without stealing focus', async () => {
  render(<><button>Keep listening</button><Toaster /></>);
  const focus = screen.getByRole('button', { name: 'Keep listening' });
  focus.focus();
  act(() => { toast({ title: 'Zu Favoriten hinzugefügt', description: 'KroneHit Radio', variant: 'favorite', type: 'background', duration: 3200, closeLabel: 'Benachrichtigung schließen' }); });
  const title = await screen.findByText('Zu Favoriten hinzugefügt');
  const root = title.closest('[data-state]');
  expect(root).toHaveClass('bg-[#1b1b1f]', 'rounded-2xl', 'motion-reduce:animate-none');
  expect(screen.getByText('KroneHit Radio')).toBeVisible();
  expect(document.activeElement).toBe(focus);
  const close = screen.getByRole('button', { name: 'Benachrichtigung schließen' });
  expect(close).toHaveClass('h-11', 'w-11', 'opacity-100');
  // Background Radix announcements are polite and do not interrupt speech.
  await waitFor(() => expect(document.querySelector('[aria-live="polite"]')).not.toBeNull());
  expect(document.querySelector('ol')).toHaveClass('top-[calc(env(safe-area-inset-top,0px)+76px)]');
  fireEvent.click(close);
  await waitFor(() => expect(screen.queryByText('Zu Favoriten hinzugefügt')).not.toBeInTheDocument());
});

it('reserves logical-end space for the close control in an RTL document', async () => {
  document.documentElement.dir = 'rtl';
  try {
    render(<Toaster />);
    const text = favoriteNotificationText('ar');
    act(() => { toast({ title: text.added, variant: 'favorite', closeLabel: text.close }); });
    const title = await screen.findByText(text.added);
    expect(title.closest('[data-state]')).toHaveStyle({ paddingInlineStart: '12px', paddingInlineEnd: '56px' });
    expect(screen.getByRole('button', { name: text.close })).toHaveStyle({ right: 'auto', insetInlineEnd: '4px' });
  } finally { document.documentElement.removeAttribute('dir'); }
});
