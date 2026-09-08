import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ProtectedRoute } from '../src/components/auth/ProtectedRoute';
import { ACTIVE_SITEMAP_LANGUAGES } from '@workspace/seo-shared/seo-config';
const state = vi.hoisted(() => ({ error: null as Error | null, navigate: vi.fn(), toast: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: false, isLoading: false, error: state.error }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (_: string, fallback: string) => fallback }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: state.toast }) }));
vi.mock('wouter', () => ({ useLocation: () => ['', state.navigate] }));
afterEach(() => { cleanup(); state.navigate.mockReset(); state.toast.mockReset(); state.error = null; });
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
