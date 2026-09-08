import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ id: 'listener-slug' as string | undefined, user: { _id: 'viewer', following: [] as string[] },
  toast: vi.fn(), request: vi.fn(), query: vi.fn() }));
vi.mock('wouter', () => ({ useParams: () => ({ id: fixture.id, idOrSlug: fixture.id }), useLocation: () => [fixture.id ? `/de/users/${fixture.id}` : '/de/users', vi.fn()] }));
vi.mock('@/hooks/useSeoRouting', () => ({ useSeoRouting: () => ({ cleanPath: fixture.id ? `/users/${fixture.id}` : '/users', getLocalizedUrl: (path: string) => `/de${path}`, navigateWithLanguage: vi.fn() }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: fixture.user, isAuthenticated: !!fixture.user }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ language: 'de', t: (key: string, fallback?: string) => fallback || key }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: fixture.toast }) }));
vi.mock('@/lib/queryClient', () => ({ apiRequest: fixture.request, getQueryFn: () => fixture.query }));
vi.mock('@/pages/not-found', () => ({ default: () => <p>Missing profile</p> }));
vi.mock('@/components/ui/station-card', () => ({ default: ({ station }: any) => <div>{station.name}</div> }));
vi.mock('@/components/ui/user-avatar', () => ({ default: ({ name }: any) => <span>{name}</span> }));
vi.mock('@/components/auth/auth-modal', () => ({ default: () => null }));
import UserProfile from '@/pages/users/profile';
import ActiveUserProfile from '@/pages/UserProfile';
let clients: QueryClient[] = [];
const profile = { _id: 'canonical-user-id', displayName: 'Listener', isPublic: true, followersCount: 0 };
beforeEach(() => {
  fixture.id = 'listener-slug'; fixture.user = { _id: 'viewer', following: [] };
  fixture.toast.mockReset(); fixture.request.mockReset(); fixture.query.mockReset();
  fixture.request.mockResolvedValue({ json: async () => ({ success: true }) });
  fixture.query.mockImplementation(async ({ queryKey }: any) => {
    const path = queryKey[0];
    return path.endsWith('/favorites') ? { favorites: [] } : path.endsWith('/recently-played') ? [] : profile;
  });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => { cleanup(); for (const client of clients) client.clear(); clients = []; vi.restoreAllMocks(); });
function mount(Component = UserProfile) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, queryFn: fixture.query }, mutations: { retry: false } } });
  clients.push(client);
  return { client, ...render(<Component />, { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }) };
}
it('missing-to-valid route transition retains hook order and fetches the real profile', async () => {
  fixture.id = undefined; const view = mount(); expect(screen.getByText('Missing profile')).toBeInTheDocument();
  fixture.id = 'listener-slug'; view.rerender(<UserProfile />);
  await screen.findAllByText('Listener');
  expect(fixture.query.mock.calls.some(([context]) => context.queryKey[0] === '/api/user-engagement/profile/listener-slug')).toBe(true);
});
it('slug profile follows canonical owner ID and invalidates the real profile query', async () => {
  const view = mount(); await screen.findAllByText('Listener');
  const invalidate = vi.spyOn(view.client, 'invalidateQueries');
  fireEvent.click(screen.getAllByRole('button', { name: 'Follow' })[0]);
  await waitFor(() => expect(fixture.request).toHaveBeenCalledWith('POST', '/api/user/follow/canonical-user-id'));
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['/api/user-engagement/profile/listener-slug'] }));
});
it('canonical current user cannot follow self while navigating a slug', async () => {
  fixture.user = { _id: 'canonical-user-id', following: [] }; mount(); await screen.findAllByText('Listener');
  expect(screen.queryByRole('button', { name: 'Follow' })).not.toBeInTheDocument();
});
it('viewer change creates a separate profile query identity without changing endpoint', async () => {
  const view = mount(); await screen.findAllByText('Listener');
  fixture.user = { _id: 'other-viewer', following: [] }; view.rerender(<UserProfile />);
  await waitFor(() => expect(view.client.getQueryData(['/api/user-engagement/profile/listener-slug', { viewer: 'other-viewer' }])).toEqual(profile));
  expect(view.client.getQueryData(['/api/user-engagement/profile/listener-slug', { viewer: 'viewer' }])).toEqual(profile);
});
it('clipboard failure does not report success and successful share preserves localized route', async () => {
  const writeText = vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  mount(); await screen.findAllByText('Listener');
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Share' })));
  expect(fixture.toast).toHaveBeenLastCalledWith(expect.objectContaining({ variant: 'destructive' }));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Share profile' })));
  expect(writeText).toHaveBeenLastCalledWith(`${window.location.origin}/de/users/listener-slug`);
  expect(fixture.toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'profile_copied' }));
});
it('shows actual localized creation date and unknown unmeasured analytics without fabricated defaults', async () => {
  fixture.query.mockImplementation(async ({ queryKey }: any) => queryKey[0].endsWith('/favorites') ? { favorites: [] } :
    { ...profile, createdAt: '2026-03-12T12:00:00Z', favoriteStationsCount: 37, listeningStats: { totalListenHours: null, peakListeningHours: [] } });
  mount(); await screen.findAllByText('Listener');
  expect(screen.getByText('12. März 2026')).toBeInTheDocument(); expect(screen.getByText('37')).toBeInTheDocument();
  expect(screen.getAllByText('—')).toHaveLength(2);
  expect(screen.queryByText('10.0h')).not.toBeInTheDocument(); expect(screen.queryByText('August 15, 2025')).not.toBeInTheDocument();
});
it('active profile route preserves hooks, uses canonical identity and exposes unknown dates truthfully', async () => {
  fixture.id = undefined;
  fixture.query.mockResolvedValue({ profile, favorites: [], recentlyPlayed: [] });
  const view = mount(ActiveUserProfile); expect(screen.getByText('Missing profile')).toBeInTheDocument();
  fixture.id = 'listener-slug'; view.rerender(<ActiveUserProfile />); await screen.findAllByText('Listener');
  expect(screen.getByText('—')).toBeInTheDocument(); expect(screen.queryByText('Invalid Date')).not.toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('button', { name: 'Follow' })[0]);
  await waitFor(() => expect(fixture.request).toHaveBeenCalledWith('POST', '/api/user-engagement/follow/canonical-user-id'));
  fixture.user = { _id: 'canonical-user-id', following: [] }; view.rerender(<ActiveUserProfile />);
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Follow' })).not.toBeInTheDocument());
});
it('active profile stats use real total and localized registration date, not truncated favorites or fake activity', async () => {
  fixture.query.mockResolvedValue({ profile: { ...profile, createdAt: '2026-03-12T12:00:00Z', favoriteStationsCount: 37 }, favorites: [], recentlyPlayed: [] });
  mount(ActiveUserProfile); await screen.findAllByText('Listener');
  expect(screen.getByText(new Date('2026-03-12T12:00:00Z').toLocaleDateString('de', { month: 'short', day: 'numeric', year: 'numeric' }))).toBeInTheDocument();
  expect(screen.getAllByText('37')).toHaveLength(2);
});
