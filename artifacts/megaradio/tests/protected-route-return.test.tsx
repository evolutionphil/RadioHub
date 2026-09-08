import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ProtectedRoute } from '../src/components/auth/ProtectedRoute';
import { ACTIVE_SITEMAP_LANGUAGES } from '@workspace/seo-shared/seo-config';
const state = vi.hoisted(() => ({ authenticated: false, error: null as Error | null, navigate: vi.fn(), toast: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: state.authenticated, isLoading: false, error: state.error }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (_: string, fallback: string) => fallback }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: state.toast }) }));
vi.mock('wouter', () => ({ useLocation: () => ['', state.navigate] }));
afterEach(() => { cleanup(); state.navigate.mockReset(); state.toast.mockReset(); state.error = null; state.authenticated = false; });
it.each(ACTIVE_SITEMAP_LANGUAGES)('preserves %s and the protected destination', language => {
  const path = `/${language}/profile/settings?tab=privacy#form`;
  window.history.replaceState({}, '', path);
  render(<ProtectedRoute><span>private content</span></ProtectedRoute>);
  expect(state.navigate).toHaveBeenCalledWith(`/${language}/login?returnTo=${encodeURIComponent(path)}`);
});
it('keeps an auth outage distinct from an anonymous user', () => {
  state.error = new Error('503: unavailable');
  const page = render(<ProtectedRoute><span>private content</span></ProtectedRoute>);
  expect(state.navigate).not.toHaveBeenCalled();
  expect(page.getByRole('alert')).toBeTruthy();
  expect(page.queryByText('private content')).toBeNull();
});

it('redirects only once while the previous protected route stays mounted during lazy navigation', () => {
  const path = '/de/profil/einstellungen?tab=privacy#form';
  const expected = `/de/login?returnTo=${encodeURIComponent(path)}`;
  window.history.replaceState({}, '', path);
  state.navigate.mockImplementation(url => window.history.replaceState({}, '', url));
  const view = <React.StrictMode><ProtectedRoute><span>private content</span></ProtectedRoute></React.StrictMode>;
  const page = render(view);
  // The translation/toast observers can rerender the deferred old route
  // several times after location has already changed to /de/login.
  for (let i = 0; i < 4; i++) page.rerender(<React.StrictMode><ProtectedRoute><span>private content {i}</span></ProtectedRoute></React.StrictMode>);
  expect(state.navigate).toHaveBeenCalledTimes(1);
  expect(state.toast).toHaveBeenCalledTimes(1);
  expect(state.navigate).toHaveBeenCalledWith(expected);
  expect(window.location.pathname + window.location.search + window.location.hash).toBe(expected);
});

it('allows a new redirect after authentication changes and after a new route mount', () => {
  const view = <ProtectedRoute><span>private content</span></ProtectedRoute>;
  window.history.replaceState({}, '', '/de/profile/settings');
  const page = render(view);
  state.authenticated = true;
  window.history.replaceState({}, '', '/tr/profile/messages');
  page.rerender(<ProtectedRoute><span>signed in</span></ProtectedRoute>);
  state.authenticated = false;
  page.rerender(view);
  expect(state.navigate).toHaveBeenLastCalledWith('/tr/login?returnTo=%2Ftr%2Fprofile%2Fmessages');
  expect(state.navigate).toHaveBeenCalledTimes(2);
  page.unmount();
  window.history.replaceState({}, '', '/fr/profile/settings');
  render(view);
  expect(state.navigate).toHaveBeenLastCalledWith('/fr/login?returnTo=%2Ffr%2Fprofile%2Fsettings');
  expect(state.navigate).toHaveBeenCalledTimes(3);
});

it('does not re-wrap an existing login destination if a deferred guard remounts', () => {
  window.history.replaceState({}, '', '/de/login?returnTo=%2Fde%2Fprofile%2Fsettings');
  render(<ProtectedRoute><span>private content</span></ProtectedRoute>);
  expect(state.navigate).not.toHaveBeenCalled();
  expect(state.toast).not.toHaveBeenCalled();
  expect(window.location.search).toBe('?returnTo=%2Fde%2Fprofile%2Fsettings');
});
