import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, type InfiniteData } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  route: 'listener', language: 'de', user: { _id: 'viewer', following: [] } as { _id: string; following: string[] } | null,
  query: vi.fn(), request: vi.fn(), toast: vi.fn(), navigate: vi.fn(), breadcrumb: vi.fn(), authSuccess: undefined as (() => void) | undefined,
}));
vi.mock('wouter', () => ({ useParams: () => ({ id: fixture.route }), useLocation: () => [`/de/users/${fixture.route}`, fixture.navigate] }));
vi.mock('@/hooks/useSeoRouting', () => ({ useSeoRouting: () => ({ cleanPath: `/users/${fixture.route}`, getLocalizedUrl: (path: string) => `/${fixture.language}${path}` }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ language: fixture.language, localeTranslations: {} }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: fixture.user, isAuthenticated: !!fixture.user, isLoading: false }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: fixture.toast }) }));
vi.mock('@/lib/queryClient', () => ({ apiRequest: fixture.request, getQueryFn: () => fixture.query }));
vi.mock('@/components/RouteBreadcrumbs', () => ({ useBreadcrumbLastItemName: fixture.breadcrumb }));
vi.mock('@/components/ui/station-card', () => ({ default: ({ station }: any) => <article data-testid="station">{station.name}</article> }));
vi.mock('@/components/ui/public-profile-avatar', () => ({ PublicProfileAvatar: ({ name }: any) => <span role="img" aria-label={name} /> }));
vi.mock('@/components/auth/auth-modal', () => ({ default: ({ isOpen, onSuccess }: any) => { fixture.authSuccess = onSuccess; return isOpen ? <div role="dialog">Sign in</div> : null; } }));
vi.mock('@/pages/not-found', () => ({ default: () => <p>Missing profile</p> }));

import UserProfile from '@/pages/UserProfile';
import { publicProfileLabels, profileJoinedDate, profileNumber } from '@/lib/public-profile-labels';

const profile = { _id: 'canonical-owner', slug: 'listener', displayName: 'Giovanni Meyer', bio: 'La musica è vita.', isPublic: true,
  favoriteStationsCount: 21, followersCount: 8, isFollowing: false, createdAt: '2026-03-12T12:00:00Z' };
const stations = Array.from({ length: 20 }, (_, i) => ({ _id: `station-${i}`, name: `Radio ${i}` }));
let clients: QueryClient[] = [];
beforeEach(() => {
  fixture.route = 'listener'; fixture.language = 'de'; fixture.user = { _id: 'viewer', following: [] };
  fixture.query.mockReset(); fixture.request.mockReset(); fixture.toast.mockReset(); fixture.navigate.mockReset(); fixture.breadcrumb.mockReset();
  fixture.request.mockResolvedValue({ json: async () => ({ success: true }) });
  fixture.query.mockImplementation(async ({ queryKey }) => queryKey[0].includes('/favorites?')
    ? { favorites: [{ _id: 'station-20', name: 'Radio 20' }], page: 2, total: 21 }
    : { profile, favorites: stations });
  Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => { cleanup(); clients.forEach(client => client.clear()); clients = []; vi.restoreAllMocks(); });
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  return { client, ...render(<UserProfile />, { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }) };
}

it('loads favorites beyond the first twenty and presents the true total once', async () => {
  mount(); await screen.findByRole('heading', { name: 'Giovanni Meyer' });
  expect(screen.getAllByTestId('station')).toHaveLength(20);
  expect(screen.getAllByText('21')).toHaveLength(1);
  expect(screen.getByText('La musica è vita.')).toBeInTheDocument();
  expect(fixture.breadcrumb).toHaveBeenLastCalledWith('Giovanni Meyer');
  fireEvent.click(screen.getByRole('button', { name: 'Weitere Sender laden' }));
  await screen.findByText('Radio 20');
  expect(screen.getAllByTestId('station')).toHaveLength(21);
  expect(screen.queryByRole('button', { name: 'Weitere Sender laden' })).not.toBeInTheDocument();
  expect(fixture.query.mock.calls[1][0].queryKey[0]).toBe('/api/user-engagement/profile/listener/favorites?page=2&limit=20');
});

it('retains the first page on pagination failure and retries the failed page', async () => {
  fixture.query.mockResolvedValueOnce({ profile, favorites: stations }).mockRejectedValueOnce(new Error('503: unavailable')).mockResolvedValueOnce({ favorites: [{ _id: 'last', name: 'Last radio' }], total: 21 });
  mount(); await screen.findByRole('heading', { name: 'Giovanni Meyer' });
  fireEvent.click(screen.getByRole('button', { name: 'Weitere Sender laden' }));
  await screen.findByRole('alert'); expect(screen.getAllByTestId('station')).toHaveLength(20);
  fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
  await screen.findByText('Last radio'); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('hides previously visible data when the next request reports a private or unavailable profile', async () => {
  fixture.query.mockResolvedValueOnce({ profile, favorites: stations }).mockRejectedValueOnce(new Error('404: Profile not found'));
  mount(); await screen.findByRole('heading', { name: 'Giovanni Meyer' });
  fireEvent.click(screen.getByRole('button', { name: 'Weitere Sender laden' }));
  await screen.findByRole('heading', { name: 'Profil nicht verfügbar' });
  expect(screen.queryByTestId('station')).not.toBeInTheDocument(); expect(screen.queryByText('Giovanni Meyer')).not.toBeInTheDocument();
  expect(fixture.breadcrumb).toHaveBeenLastCalledWith(undefined);
});

it('distinguishes a retryable service failure from an unavailable profile', async () => {
  fixture.query.mockRejectedValueOnce(new Error('503: unavailable')).mockResolvedValueOnce({ profile, favorites: [] });
  mount(); await screen.findByRole('heading', { name: 'Profil konnte nicht geladen werden' });
  fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
  await screen.findByRole('heading', { name: 'Giovanni Meyer' });
});

it('honors favorite and statistics visibility even if a response contains station data', async () => {
  fixture.query.mockResolvedValue({ profile: { ...profile, privacy: { showFavorites: false, showStatistics: false } }, favorites: stations });
  mount(); await screen.findByText('Diese Favoriten sind privat.');
  expect(screen.queryByTestId('station')).not.toBeInTheDocument();
  expect(screen.queryByText('21')).not.toBeInTheDocument(); expect(screen.queryByText('Mitglied seit')).not.toBeInTheDocument();
});

it('uses server follow state and the canonical account ID', async () => {
  fixture.query.mockResolvedValue({ profile: { ...profile, isFollowing: true }, favorites: [] });
  mount(); const unfollow = await screen.findByRole('button', { name: 'Nicht mehr folgen' });
  expect(unfollow).toHaveAttribute('aria-pressed', 'true'); fireEvent.click(unfollow);
  await waitFor(() => expect(fixture.request).toHaveBeenCalledWith('POST', '/api/user-engagement/unfollow/canonical-owner'));
});

it('does not mutate another account when a follow response arrives after account switching', async () => {
  let resolveFollow!: (value: unknown) => void;
  fixture.request.mockReturnValue(new Promise(resolve => { resolveFollow = resolve; }));
  const view = mount(); fireEvent.click(await screen.findByRole('button', { name: 'Folgen' }));
  fixture.user = { _id: 'other-viewer', following: [] }; view.rerender(<UserProfile />);
  await waitFor(() => expect(view.client.getQueryData(['/api/user-engagement/profile/listener/full', { viewer: 'other-viewer' }])).toBeTruthy());
  await act(async () => resolveFollow({}));
  const otherData = view.client.getQueryData<InfiniteData<any>>(['/api/user-engagement/profile/listener/full', { viewer: 'other-viewer' }]);
  expect(otherData?.pages[0].profile.isFollowing).toBe(false);
  expect(fixture.toast).not.toHaveBeenCalled();
});

it('opens authentication for anonymous follows and never allows self-follow', async () => {
  fixture.user = null; const view = mount(); fireEvent.click(await screen.findByRole('button', { name: 'Folgen' }));
  expect(screen.getByRole('dialog')).toBeInTheDocument(); expect(fixture.request).not.toHaveBeenCalled();
  view.client.setQueryData(['/api/auth/me'], { authenticated: true, user: { _id: 'canonical-owner' } });
  await act(async () => fixture.authSuccess?.()); expect(fixture.request).not.toHaveBeenCalled();
  fixture.user = { _id: 'canonical-owner', following: [] }; view.rerender(<UserProfile />);
  expect(await screen.findByRole('link', { name: 'Profil bearbeiten' })).toHaveAttribute('href', '/de/profile/settings');
  expect(screen.queryByRole('button', { name: 'Folgen' })).not.toBeInTheDocument();
});

it('resumes an explicitly requested follow after successful sign in', async () => {
  fixture.user = null; const view = mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Folgen' }));
  view.client.setQueryData(['/api/auth/me'], { authenticated: true, user: { _id: 'new-viewer' } });
  await act(async () => fixture.authSuccess?.());
  await waitFor(() => expect(fixture.request).toHaveBeenCalledTimes(1));
  expect(fixture.request).toHaveBeenCalledWith('POST', '/api/user-engagement/follow/canonical-owner');
});

it('shares a localized canonical URL without query parameters and provides a manual copy fallback', async () => {
  const writeText = vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  mount(); fireEvent.click(await screen.findByRole('button', { name: 'Profil teilen' }));
  const input = await screen.findByRole('textbox', { name: 'Link kopieren' });
  expect(input).toHaveValue(`${window.location.origin}/de/users/listener`);
  expect(fixture.toast).toHaveBeenLastCalledWith(expect.objectContaining({ variant: 'destructive' }));
  fireEvent.click(screen.getByRole('button', { name: 'Profil teilen' }));
  await waitFor(() => expect(fixture.toast).toHaveBeenLastCalledWith({ title: 'Profillink kopiert' }));
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});

it('treats native share cancellation as cancellation rather than copying or reporting an error', async () => {
  Object.defineProperty(navigator, 'share', { configurable: true, value: vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError')) });
  mount(); const share = await screen.findByRole('button', { name: 'Profil teilen' });
  await act(async () => fireEvent.click(share));
  expect(navigator.clipboard.writeText).not.toHaveBeenCalled(); expect(fixture.toast).not.toHaveBeenCalled();
});

describe('localized profile labels', () => {
  it.each(['en', 'de', 'tr', 'es', 'fr', 'pt', 'it', 'ru', 'ar', 'zh', 'ja', 'ko', 'hi', 'he'])('%s has a complete fallback without translation data', language => {
    const labels = publicProfileLabels(language);
    expect(Object.values(labels).every(label => !!label && !label.startsWith('public_profile_'))).toBe(true);
    expect(Object.keys(labels)).toHaveLength(30);
    if (language !== 'en') expect(labels.emptyBody).not.toEqual(publicProfileLabels('en').emptyBody);
  });
  it('uses current-locale overrides and truthful unknown values', () => {
    expect(publicProfileLabels('tr', { public_profile_follow: 'Takibe al', public_profile_share: ' ' }).follow).toBe('Takibe al');
    expect(publicProfileLabels('tr', { public_profile_share: ' ' }).share).toBe('Profili paylaş');
    expect(profileNumber(NaN, 'de')).toBe('—'); expect(profileNumber(null, 'de')).toBe('—');
    expect(profileNumber(1000, 'de')).toBe('1.000'); expect(profileJoinedDate('invalid', 'de')).toBe('—');
  });
});
