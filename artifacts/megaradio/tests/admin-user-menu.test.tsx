import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const state = vi.hoisted(() => ({ navigate: vi.fn(), logout: vi.fn(), toast: vi.fn() }));
vi.mock('wouter', () => ({ useLocation: () => ['/admin/users', state.navigate] }));
vi.mock('../src/lib/logout', () => ({ logoutAccount: () => state.logout() }));
vi.mock('../src/hooks/use-toast', () => ({ useToast: () => ({ toast: state.toast }) }));
import { AdminUserMenuDropdown } from '../src/components/ui/AdminUserMenuDropdown';
beforeEach(() => { state.navigate.mockReset(); state.logout.mockReset(); state.toast.mockReset(); });
function mount(authenticated = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } } });
  client.setQueryData(['/api/auth/me'], { authenticated: false, user: null });
  client.setQueryData(['/api/admin/auth/me'], { authenticated, user: authenticated ? { username: 'Admin', fullName: 'Admin', role: 'admin', status: 'active', email: 'admin@example.test', avatar: '/broken-avatar' } : null });
  return render(<QueryClientProvider client={client}><AdminUserMenuDropdown /></QueryClientProvider>);
}
it('reads the nested auth response and renders a React avatar fallback', () => {
  mount(); fireEvent.error(screen.getByRole('img')); expect(screen.queryByRole('img')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'User menu' })); expect(screen.getByText('admin@example.test')).toBeTruthy();
});
it('does not show a menu for the unauthenticated envelope', () => {
  mount(false); expect(screen.queryByRole('button', { name: 'User menu' })).toBeNull();
});
it('shows the admin-only identity when no public user or email exists', () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnMount: false } } });
  client.setQueryData(['/api/auth/me'], { authenticated: false, user: null });
  client.setQueryData(['/api/admin/auth/me'], { authenticated: true, user: { username: 'Admin-only', role: 'admin' } });
  render(<QueryClientProvider client={client}><AdminUserMenuDropdown /></QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'User menu' })); expect(screen.getByText('Admin-only')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
});
it('uses central logout and only navigates after success', async () => {
  state.logout.mockRejectedValueOnce(new Error('offline')); mount();
  fireEvent.click(screen.getByRole('button', { name: 'User menu' })); fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  await waitFor(() => expect(state.toast).toHaveBeenCalled()); expect(state.navigate).not.toHaveBeenCalled();
  state.logout.mockResolvedValueOnce(undefined); fireEvent.click(screen.getByRole('button', { name: 'User menu' })); fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  await waitFor(() => expect(state.navigate).toHaveBeenCalledWith('/admin/login'));
});
