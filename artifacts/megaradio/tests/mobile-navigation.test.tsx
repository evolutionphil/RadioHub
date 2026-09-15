import React, { useRef, useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const route = { language: 'de', cleanPath: '/genres/rock', location: '/de/genres/rock' };
const localizedSegments: Record<string, Record<string, string>> = {
  de: { '/recommendations': '/empfehlungen', '/users': '/benutzer' },
};
const labels: Record<string, Record<string, string>> = {
  de: { nav_home: 'Startseite', nav_genres: 'Genres', nav_for_you: 'Für Sie', users: 'Gemeinschaft', nav_login: 'Anmelden', nav_signup: 'Registrieren', nav_close: 'Schließen', nav_your_favorites: 'Deine Favoriten', user_menu_profile: 'Profil', nav_add_your_station: 'Deinen Sender hinzufügen' },
  tr: { nav_home: 'Ana sayfa', nav_genres: 'Türler', nav_for_you: 'Sizin için', users: 'Topluluk', nav_login: 'Giriş yap', nav_signup: 'Kaydol', nav_close: 'Kapat', nav_your_favorites: 'Favorileriniz', user_menu_profile: 'Profil', nav_add_your_station: 'Radyonu ekle' },
};
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: string, fallback?: string) => labels[route.language]?.[key] ?? fallback ?? key }) }));
vi.mock('@/hooks/useSeoRouting', () => ({ useSeoRouting: () => ({ cleanPath: route.cleanPath, getLocalizedUrl: (path: string) => `/${route.language}${path === '/' ? '' : localizedSegments[route.language]?.[path] ?? path}` }) }));
vi.mock('wouter', () => ({
  Link: ({ children, onClick, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} onClick={event => { event.preventDefault(); onClick?.(event); }}>{children}</a>,
  useLocation: () => [route.location, vi.fn()],
}));

import MobileNavigation from '../src/components/layout/mobile-navigation';

function Harness({ authenticated = false, loading = false, onAddStation = vi.fn() }: { authenticated?: boolean; loading?: boolean; onAddStation?: () => void }) {
  const [open, setOpen] = useState(false);
  const [stationForm, setStationForm] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return <>
    <button ref={triggerRef} data-testid="open-menu" aria-expanded={open} onClick={() => setOpen(true)}>Open navigation</button>
    <input aria-label="Background search" />
    {open && <MobileNavigation open={open} onOpenChange={setOpen} triggerRef={triggerRef} isAuthenticated={authenticated} authLoading={loading} onAddStation={() => { onAddStation(); setOpen(false); setStationForm(true); }} />}
    {stationForm && <input aria-label="Station name" autoFocus />}
  </>;
}

async function openNavigation(props?: React.ComponentProps<typeof Harness>) {
  const user = userEvent.setup();
  const view = render(<Harness {...props} />);
  const trigger = screen.getByTestId('open-menu');
  await user.click(trigger);
  return { ...view, user, trigger, dialog: screen.getByRole('dialog') };
}

beforeEach(() => {
  Object.assign(route, { language: 'de', cleanPath: '/genres/rock', location: '/de/genres/rock' });
  vi.stubGlobal('innerWidth', 390);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Mobile navigation drawer', () => {
  it('uses an opaque bounded panel and avoids the global selectors that distorted the old menu', async () => {
    const { dialog } = await openNavigation();
    expect(dialog).toHaveClass('bg-[#111113]', 'max-w-sm', 'start-0');
    expect(dialog.className).not.toContain('backdrop-blur');
    expect(dialog.querySelector('.nav-item, .auth-section')).toBeNull();
    expect(dialog.querySelector('.overflow-y-auto')).not.toBeNull();
    expect(screen.getByTestId('mobile-navigation-backdrop')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Startseite' })).toHaveAttribute('href', '/de');
    expect(within(dialog).getByRole('link', { name: 'Gemeinschaft' })).toHaveAttribute('href', '/de/benutzer');
    expect(within(dialog).getByRole('link', { name: 'Anmelden' })).toHaveAttribute('href', '/de/login?returnTo=%2Fde%2Fgenres%2Frock');
    expect(within(dialog).getByRole('link', { name: 'Registrieren' })).toHaveAttribute('href', '/de/signup');
    expect(within(dialog).queryByRole('link', { name: 'Deine Favoriten' })).not.toBeInTheDocument();
  });

  it('shows localized personal destinations for authenticated listeners without guest actions', async () => {
    Object.assign(route, { language: 'tr', cleanPath: '/profile/favorites', location: '/tr/profile/favorites' });
    const { dialog } = await openNavigation({ authenticated: true });
    expect(within(dialog).getByRole('link', { name: 'Favorileriniz' })).toHaveAttribute('href', '/tr/profile/favorites');
    expect(within(dialog).getByRole('link', { name: 'Profil' })).toHaveAttribute('href', '/tr/profile/settings');
    expect(within(dialog).queryByRole('link', { name: 'Giriş yap' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('link', { name: 'Kaydol' })).not.toBeInTheDocument();
  });

  it('does not flash guest actions while authentication is unresolved', async () => {
    const { dialog } = await openNavigation({ loading: true });
    expect(within(dialog).getByRole('status')).toBeInTheDocument();
    expect(within(dialog).queryByRole('link', { name: 'Anmelden' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('link', { name: 'Deine Favoriten' })).not.toBeInTheDocument();
  });

  it.each([
    ['/de', 'Startseite'],
    ['/de/', 'Startseite'],
    ['/de/genres/rock', 'Genres'],
    ['/de/empfehlungen', 'Für Sie'],
    ['/de/empfehlungen/?view=all#top', 'Für Sie'],
    ['/de/benutzer/listener', 'Gemeinschaft'],
    ['/de/profile/favorites', 'Deine Favoriten'],
  ])('marks only the correct active destination at %s', async (path, label) => {
    route.location = path;
    route.cleanPath = path.replace(/^\/de/, '') || '/';
    const { dialog } = await openNavigation({ authenticated: true });
    expect(within(dialog).getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page');
    expect(dialog.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  });

  it('does not mark a prefix collision as an active destination', async () => {
    route.location = '/de/benutzer-guide';
    route.cleanPath = '/benutzer-guide';
    const { dialog } = await openNavigation();
    expect(dialog.querySelector('[aria-current]')).toBeNull();
  });

  it('traps keyboard focus, hides the background and releases its scroll lock on Escape', async () => {
    const { user, dialog, trigger } = await openNavigation();
    const first = within(dialog).getByRole('button', { name: 'Schließen' });
    const last = within(dialog).getByRole('button', { name: 'Deinen Sender hinzufügen' });
    expect(first).toHaveFocus();
    expect(trigger.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(document.body).toHaveAttribute('data-scroll-locked');
    await user.tab({ shift: true });
    expect(last).toHaveFocus();
    await user.tab();
    expect(first).toHaveFocus();
    const background = screen.getByLabelText('Background search');
    act(() => background.focus());
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body).not.toHaveAttribute('data-scroll-locked');
  });

  it('closes via its close button and restores trigger focus', async () => {
    const { user, dialog, trigger } = await openNavigation();
    await user.click(within(dialog).getByRole('button', { name: 'Schließen' }));
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes after choosing a destination', async () => {
    const { user, dialog, trigger } = await openNavigation();
    await user.click(within(dialog).getByRole('link', { name: 'Genres' }));
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps the drawer on tablet but closes at the desktop breakpoint without retaining a body lock', async () => {
    const { trigger } = await openNavigation();
    vi.stubGlobal('innerWidth', 1279);
    fireEvent(window, new Event('resize'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    vi.stubGlobal('innerWidth', 1280);
    fireEvent(window, new Event('resize'));
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body).not.toHaveAttribute('data-scroll-locked');
  });

  it('hands focus to the station form without returning it to the closed menu trigger', async () => {
    const onAddStation = vi.fn();
    const { user, dialog, trigger } = await openNavigation({ onAddStation });
    await user.click(within(dialog).getByRole('button', { name: 'Deinen Sender hinzufügen' }));
    expect(onAddStation).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Station name' })).toHaveFocus());
    expect(trigger).not.toHaveFocus();
  });
});
