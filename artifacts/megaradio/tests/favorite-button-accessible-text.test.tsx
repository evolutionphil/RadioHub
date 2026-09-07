import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
const state = vi.hoisted(() => ({ favorite: false, mutate: vi.fn(), translations: {
  favorites_add_to_favorites: 'Zu Favoriten hinzufügen', favorites_remove_from_favorites: 'Aus Favoriten entfernen',
} as Record<string, string> }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: any) => ({ data: queryKey[0] === '/api/auth/me'
    ? { authenticated: true, user: { _id: 'user' } }
    : queryKey[0] === '/api/user/favorites' ? (state.favorite ? [{ _id: 'radio' }] : []) : null }),
  useMutation: () => ({ mutate: state.mutate, isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: string, fallback: string) => state.translations[key] ?? fallback }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/services/NotificationService', () => ({ useNotificationService: () => ({}) }));
vi.mock('@/hooks/usePushNotifications', () => ({ usePushNotifications: () => ({}) }));
vi.mock('@/lib/queryClient', () => ({ apiRequest: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ trackStationFavorite: vi.fn() }));
vi.mock('@/components/auth/auth-modal', () => ({ default: () => null }));
import FavoriteButton from '../src/components/ui/favorite-button';
beforeEach(() => { state.favorite = false; state.mutate.mockClear(); });

it.each([false, true])('uses the translated action, not decorative English icon alt, when favorited=%s', favorite => {
  state.favorite = favorite;
  render(<FavoriteButton stationId="radio" />);
  const label = favorite ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen';
  const button = screen.getByRole('button', { name: label });
  expect(button).toHaveAttribute('title', label); expect(button).toHaveAttribute('aria-pressed', String(favorite));
  expect(screen.queryByRole('img')).toBeNull();
  fireEvent.click(button); expect(state.mutate).toHaveBeenCalledTimes(1);
});
