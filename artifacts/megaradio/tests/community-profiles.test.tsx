import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { communityAvatarUrl, communityDisplayName, communityFavoriteCount, communityLabels, invalidateCommunityProfiles } from '../src/lib/community-profile';
import { PublicProfileAvatar } from '../src/components/ui/public-profile-avatar';
import { ACTIVE_SITEMAP_LANGUAGES } from '@workspace/seo-shared/seo-config';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({
  language: 'de', localeTranslations: {}, t: (_key: string, fallback: string) => fallback,
}) }));
vi.mock('@/hooks/useSeoRouting', () => ({ useSeoRouting: () => ({ getLocalizedUrl: (path: string) => `/de${path}` }) }));
import UsersIndex from '../src/pages/users/index';

afterEach(() => vi.restoreAllMocks());

describe('public community identity and counts', () => {
  it('prefers public names instead of slug handles and never infers an email name', () => {
    expect(communityDisplayName({ _id: '1', displayName: 'Thomas Wagner', fullName: 'Legacy', username: 'thomas-wagner-37' })).toBe('Thomas Wagner');
    expect(communityDisplayName({ _id: '1', name: ' Thomas Wagner ', username: 'thomas-wagner-37' })).toBe('Thomas Wagner');
    expect(communityDisplayName({ _id: '1', username: 'user_123_abcd' }, 'Anonymous')).toBe('Anonymous');
    expect(communityDisplayName({ _id: '1', slug: 'thomas-wagner-37' }, 'Anonymous')).toBe('Anonymous');
    expect(communityDisplayName({ _id: '1', email: 'private@example.test' } as any)).toBe('User');
  });

  it('supports current and legacy count aliases, including a real zero', () => {
    for (const key of ['favoritesCount', 'favoriteStationsCount', 'favoriteCount', 'favorites_count']) {
      expect(communityFavoriteCount({ _id: '1', [key]: 12 })).toBe(12);
    }
    expect(communityFavoriteCount({ _id: '1', favoritesCount: 0, favorites_count: 99 })).toBe(0);
    expect(communityFavoriteCount({ _id: '1', favoritesCount: NaN, favoriteCount: 4 })).toBe(4);
    expect(communityFavoriteCount({ _id: '1', favoriteCount: -4 })).toBe(0);
  });

  it.each(ACTIVE_SITEMAP_LANGUAGES)('has localized count/order defaults for %s without English fallback leakage', language => {
    const labels = communityLabels(language);
    expect(labels.radios).toBeTruthy();
    expect(labels.recentFavorites).toBeTruthy();
    if (language !== 'en') expect(labels.recentFavorites).not.toBe(communityLabels('en').recentFavorites);
    expect(communityLabels(language, { users_radios: 'CUSTOM', users_recent_favorites: 'ORDER' })).toEqual({ radios: 'CUSTOM', recentFavorites: 'ORDER' });
  });

  it('accepts stored avatars and keeps missing, failed, and newly changed images safe', () => {
    expect(communityAvatarUrl({ profileImageUrl: 'https://images.example.test/profile.webp' })).toBe('https://images.example.test/profile.webp');
    expect(communityAvatarUrl({ avatar: 'javascript:alert(1)', profileImageUrl: '/uploads/avatar.webp' })).toBe('/uploads/avatar.webp');
    expect(communityAvatarUrl({ avatar: 'http://images.example.test/avatar.png' })).toMatch(/^\/api\/image\//);
    const { rerender } = render(<PublicProfileAvatar profile={{ avatar: '/uploads/first.webp' }} name="A Listener" className="h-12 w-12" />);
    const img = screen.getByRole('img', { name: 'A Listener' });
    fireEvent.error(img);
    expect(img).toHaveAttribute('src', '/no-avatar.svg');
    fireEvent.error(img);
    expect(img).toHaveAttribute('src', '/no-avatar.svg');
    rerender(<PublicProfileAvatar profile={{ avatar: '/uploads/second.webp' }} name="A Listener" className="h-12 w-12" />);
    expect(img).toHaveAttribute('src', '/uploads/second.webp');
  });

  it('invalidates home and every discovery variant on a favorite change', () => {
    const client = new QueryClient();
    client.setQueryData(['/api/public-profiles'], { data: [] });
    client.setQueryData(['/api/users/search', { sortBy: 'recent_favorites' }], { users: [] });
    client.setQueryData(['/api/stations'], []);
    invalidateCommunityProfiles(client);
    expect(client.getQueryState(['/api/public-profiles'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['/api/users/search', { sortBy: 'recent_favorites' }])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['/api/stations'])?.isInvalidated).toBe(false);
    client.clear();
  });
});

it('discovers recent favorite activity with actual names/counts and appends pages without duplicate cards', async () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = new URL(String(input), 'https://themegaradio.com');
    expect(url.searchParams.get('sortBy')).toBe('recent_favorites');
    const page = Number(url.searchParams.get('page'));
    const first = { _id: 'first', displayName: 'Thomas Wagner', username: 'thomas-wagner-37', slug: 'thomas-wagner', favoriteCount: 8, profileImageUrl: '/uploads/thomas.webp' };
    return new Response(JSON.stringify({ users: page === 1 ? [first] : [first, { _id: 'second', fullName: 'A New Listener', favoriteStationsCount: 3 }], pagination: { page, pages: 2 } }), { status: 200 });
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><UsersIndex /></QueryClientProvider>);
  expect(await screen.findByText('Thomas Wagner')).toBeInTheDocument();
  expect(screen.getByText('8 Radios')).toBeInTheDocument();
  expect(screen.queryByText('thomas-wagner-37')).toBeNull();
  expect(screen.getByRole('img', { name: 'Thomas Wagner' })).toHaveAttribute('src', '/uploads/thomas.webp');
  expect(screen.getByRole('link', { name: 'Thomas Wagner' })).toHaveAttribute('href', '/de/users/thomas-wagner');
  fireEvent.click(screen.getByRole('button', { name: 'Load More Users' }));
  expect(await screen.findByText('A New Listener')).toBeInTheDocument();
  expect(screen.getAllByText('Thomas Wagner')).toHaveLength(1);
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Load More Users' })).toBeNull());
  expect(fetchMock).toHaveBeenCalledTimes(2);
  client.clear();
});
