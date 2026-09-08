import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PremiumSuccessPage from '../src/pages/premium-success';
import PremiumPage from '../src/pages/premium';
import SignupPage from '../src/pages/signup';
import { getQueryFn } from '../src/lib/queryClient';

const state = vi.hoisted(() => ({ user: { _id: 'user-a', subscription: { plan: 'remove_ads', isActive: false } } as any, checkout: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: state.user, isLoading: false, error: null }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ language: 'de', t: (_: string, fallback: string) => fallback }) }));
vi.mock('@/hooks/usePremiumStatus', () => ({ usePremiumStatus: () => ({ isPremium: false }) }));
vi.mock('@/hooks/useSubscriptionCheckout', () => ({ useSubscriptionCheckout: () => ({ loading: false, error: null, checkout: state.checkout }) }));
vi.mock('wouter', () => ({ useLocation: () => ['/de/premium', vi.fn()], Link: ({ children, ...props }: any) => <a {...props}>{children}</a> }));
vi.mock('@/hooks/useSeoRouting', () => ({ useSeoRouting: () => ({ getLocalizedUrl: (path: string) => `/de${path}` }) }));
let client: QueryClient;
const network = vi.fn();
const mount = (page: React.ReactNode) => render(<QueryClientProvider client={client}>{page}</QueryClientProvider>);
beforeEach(() => {
  vi.useFakeTimers(); state.user = { _id: 'user-a', subscription: { plan: 'remove_ads', isActive: false } };
  client = new QueryClient({ defaultOptions: { queries: { retry: false, queryFn: getQueryFn({ on401: 'throw' }) } } });
  network.mockReset().mockImplementation(async () => Response.json({ authenticated: true, user: state.user }));
  vi.stubGlobal('fetch', network);
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); client.clear(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it('never claims payment was received for an unconfirmed account and bounds polling', async () => {
  mount(<PremiumSuccessPage />);
  await act(async () => { await vi.advanceTimersByTimeAsync(35_000); });
  expect(screen.queryByText(/Payment received|Welcome to Premium|HD streams/)).toBeNull();
  expect(screen.getByText(/Bezahle nicht erneut/)).toBeTruthy();
  expect(network).toHaveBeenCalledTimes(20);
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(network).toHaveBeenCalledTimes(20);
});
it('does not poll anonymous visitors or expose a false successful payment', async () => {
  state.user = null; mount(<PremiumSuccessPage />);
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(network).not.toHaveBeenCalled(); expect(screen.queryByText('Payment received')).toBeNull();
});
it('stops polling after the page unmounts', async () => {
  const { unmount } = mount(<PremiumSuccessPage />);
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  const count = network.mock.calls.length; unmount();
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(network).toHaveBeenCalledTimes(count);
});
it('requires a verified server response before displaying active status', async () => {
  state.user.subscription.isActive = true;
  mount(<PremiumSuccessPage />);
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(screen.getByText('Dein Abonnement ist aktiv')).toBeTruthy();
  expect(screen.queryByText(/HD streams unlocked/)).toBeNull();
});
it('does not substitute fictional prices or allow checkout when the provider is unavailable', async () => {
  network.mockImplementation(async () => Response.json({ providerAvailable: false, plans: [
    { planId: 'premium_yearly', label: 'Annual', amount: 0, currency: 'eur', checkoutAvailable: false },
  ] }));
  mount(<PremiumPage />);
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(screen.queryByText(/29\.99|29,99|37%/)).toBeNull();
  expect(screen.getAllByText('Zahlungen sind vorübergehend nicht verfügbar.').length).toBeGreaterThan(0);
  const purchase = screen.getAllByRole('button').filter(button => /Get |Subscribe/.test(button.textContent || ''));
  expect(purchase.length).toBe(3);
  for (const button of purchase) expect((button as HTMLButtonElement).disabled).toBe(true);
});
it('keeps the billing return path on the signup login link and disables unimplemented OAuth', () => {
  window.history.replaceState({}, '', '/de/signup?returnTo=%2Fde%2Factivate%3Fcode%3D123456');
  mount(<SignupPage />);
  expect(screen.getByRole('link', { name: 'Already have an account?' }).getAttribute('href')).toBe('/de/login?returnTo=%2Fde%2Factivate%3Fcode%3D123456');
  expect((screen.getByRole('button', { name: 'GitHub sign-in is not available' }) as HTMLButtonElement).disabled).toBe(true);
});
