import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@assets/notification1.png', () => ({ default: 'notification1.png' }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null, isAuthenticated: false, isLoading: false }) }));
vi.mock('@/hooks/useGlobalPlayer', () => ({ useGlobalPlayer: () => ({ playStation: vi.fn() }) }));
vi.mock('@/hooks/usePremiumStatus', () => ({ usePremiumStatus: () => ({ isPremium: false }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key, setLanguage: vi.fn() }) }));
vi.mock('@/hooks/useSeoRouting', () => ({ useSeoRouting: () => ({ getLocalizedUrl: (path: string) => `/de${path === '/' ? '' : path}`, cleanPath: '/', navigateTranslated: vi.fn(), currentLanguage: 'de' }) }));
vi.mock('@/components/ui/UserMenuDropdown', () => ({ UserMenuDropdown: () => null }));
vi.mock('@/components/modals/AddYourStationModal', () => ({ default: () => <input aria-label="Station submission" autoFocus /> }));
vi.mock('@/components/HighlightMatch', () => ({ HighlightMatch: ({ text }: { text: string }) => <>{text}</> }));
vi.mock('wouter', () => ({
  Link: ({ children, onClick, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} onClick={event => { event.preventDefault(); onClick?.(event); }}>{children}</a>,
  useLocation: () => ['/de', vi.fn()],
}));

import RadioHeader from '../src/components/layout/radio-header';

function renderHeader(props?: React.ComponentProps<typeof RadioHeader>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: Infinity, queryFn: ({ queryKey }) => { throw new Error(`Unexpected query: ${JSON.stringify(queryKey)}`); } } } });
  client.setQueryData(['/api/filters/countries'], ['Germany', 'Austria']);
  client.setQueryData(['/api/countries', 'rich'], [{ name: 'Austria', stationCount: 100 }]);
  return render(<QueryClientProvider client={client}><RadioHeader {...props} /></QueryClientProvider>);
}

beforeEach(() => { vi.stubGlobal('innerWidth', 390); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('RadioHeader mobile navigation integration', () => {
  it('lazy-opens the real drawer with keyboard and returns focus to the actual header trigger', async () => {
    const user = userEvent.setup();
    renderHeader();
    const trigger = screen.getByTestId('button-mobile-menu');
    expect(trigger).toHaveAttribute('aria-controls', 'mobile-navigation');
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    trigger.focus();
    await user.keyboard('{Enter}');
    const drawer = await screen.findByRole('dialog');
    expect(drawer).toHaveAttribute('id', 'mobile-navigation');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(within(drawer).getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(document.body).not.toHaveAttribute('data-scroll-locked');
  });

  it('opens the internal Add Station modal when no parent modal controller was supplied', async () => {
    const user = userEvent.setup();
    renderHeader();
    const trigger = screen.getByTestId('button-mobile-menu');
    await user.click(trigger);
    const drawer = await screen.findByRole('dialog');
    await user.click(within(drawer).getByRole('button', { name: 'Add your station' }));
    expect(await screen.findByRole('textbox', { name: 'Station submission' })).toHaveFocus();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).not.toHaveFocus();
  });

  it('preserves the parent-controlled Add Station callback', async () => {
    const user = userEvent.setup();
    const setShowAddStationModal = vi.fn();
    renderHeader({ setShowAddStationModal });
    await user.click(screen.getByTestId('button-mobile-menu'));
    const drawer = await screen.findByRole('dialog');
    await user.click(within(drawer).getByRole('button', { name: 'Add your station' }));
    expect(setShowAddStationModal).toHaveBeenCalledTimes(1);
    expect(setShowAddStationModal).toHaveBeenCalledWith(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Station submission' })).not.toBeInTheDocument();
  });
});
