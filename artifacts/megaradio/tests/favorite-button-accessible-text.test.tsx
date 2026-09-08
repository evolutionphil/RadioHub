import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
const state = vi.hoisted(() => ({ favorite: false, authenticated: true, mutate: vi.fn(), modalLoaded: vi.fn(), translations: {
  favorites_add_to_favorites: 'Zu Favoriten hinzufügen', favorites_remove_from_favorites: 'Aus Favoriten entfernen',
} as Record<string, string> }));
vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({ mutate: state.mutate, isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('@/hooks/useFavoriteState', () => ({ useFavoriteState: () => ({
  user: state.authenticated ? { _id: 'user' } : null,
  favoriteStationIds: new Set(state.favorite ? ['radio'] : []),
}) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: string, fallback: string) => state.translations[key] ?? fallback }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/services/NotificationService', () => ({ useNotificationService: () => ({}) }));
vi.mock('@/hooks/usePushNotifications', () => ({ usePushNotifications: () => ({}) }));
vi.mock('@/lib/queryClient', () => ({ apiRequest: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ trackStationFavorite: vi.fn() }));
vi.mock('@/components/auth/auth-modal', () => {
  state.modalLoaded();
  return { default: ({ isOpen, onClose }: any) => <div data-testid="auth-modal" hidden={!isOpen}><input aria-label="Email" /><button onClick={onClose}>Cancel auth</button></div> };
});
import FavoriteButton from '../src/components/ui/favorite-button';
beforeEach(() => { state.favorite = false; state.authenticated = true; state.mutate.mockClear(); });

it.each([false, true])('uses the translated action, not decorative English icon alt, when favorited=%s', favorite => {
  state.favorite = favorite;
  render(<FavoriteButton stationId="radio" />);
  const label = favorite ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen';
  const button = screen.getByRole('button', { name: label });
  expect(button).toHaveAttribute('title', label); expect(button).toHaveAttribute('aria-pressed', String(favorite));
  expect(screen.queryByRole('img')).toBeNull();
  fireEvent.click(button); expect(state.mutate).toHaveBeenCalledTimes(1);
});

it('loads auth only on demand, preserves cancelled form state, and favorites after login', async () => {
  state.authenticated = false;
  const { rerender } = render(<FavoriteButton stationId="radio" />);
  expect(state.modalLoaded).not.toHaveBeenCalled();
  expect(screen.queryByTestId('auth-modal')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Zu Favoriten hinzufügen' }));
  const email = await screen.findByRole('textbox', { name: 'Email' });
  expect(state.modalLoaded).toHaveBeenCalledTimes(1);
  expect(state.mutate).not.toHaveBeenCalled();
  fireEvent.change(email, { target: { value: 'listener@example.test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel auth' }));
  expect(screen.getByTestId('auth-modal')).not.toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Zu Favoriten hinzufügen' }));
  expect(screen.getByRole('textbox', { name: 'Email' })).toHaveValue('listener@example.test');
  state.authenticated = true;
  // memoized component still receives a changed prop, as real query updates do.
  rerender(<FavoriteButton stationId="radio" className="rerender" />);
  await waitFor(() => expect(state.mutate).toHaveBeenCalledTimes(1));
  expect(screen.getByTestId('auth-modal')).not.toBeVisible();
});
