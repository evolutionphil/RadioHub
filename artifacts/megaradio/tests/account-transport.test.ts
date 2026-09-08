import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiRequest, apiAuthHeaders, getQueryFn, queryClient } from '../src/lib/queryClient';
import { logoutAccount } from '../src/lib/logout';
import { fmtPrice, isAdFreeSubscription } from '../src/lib/premium';
import { subscriptionCopy } from '../src/lib/subscription-copy';
import { ACTIVE_SITEMAP_LANGUAGES } from '@workspace/seo-shared/seo-config';
const network = vi.fn();
beforeEach(() => { sessionStorage.clear(); localStorage.clear(); queryClient.clear(); network.mockReset().mockResolvedValue(Response.json({ ok: true })); vi.stubGlobal('fetch', network); });
afterEach(() => { queryClient.clear(); vi.unstubAllGlobals(); });
it('includes OAuth bearer for writes and preserves false JSON bodies', async () => {
  sessionStorage.setItem('_mrt_oat', 'fixture');
  await apiRequest('PATCH', '/api/user/notification-settings', { body: false });
  expect(network.mock.calls[0][1]).toMatchObject({ headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json' }, body: 'false', credentials: 'include' });
});
it('does not leak a session bearer to third-party or non-API URLs', async () => {
  sessionStorage.setItem('_mrt_oat', 'fixture');
  for (const url of ['https://other.example/api/private', '//other.example/api/private', '/api-not-ours', '/images/a']) expect(apiAuthHeaders(url)).toEqual({});
  expect(apiAuthHeaders('/api/user')).toEqual({ Authorization: 'Bearer fixture' });
});
it('does not automatically retry mutations', () => { expect(queryClient.getDefaultOptions().mutations?.retry).toBe(0); });
it('deduplicates logout, removes OAuth fallback and clears private cache only after success', async () => {
  sessionStorage.setItem('_mrt_oat', 'fixture'); localStorage.setItem('_mrt_is_premium', '1');
  queryClient.setQueryData(['/api/messages/conversations', 'a'], ['private']);
  await Promise.all([logoutAccount(), logoutAccount()]);
  expect(network).toHaveBeenCalledOnce();
  expect(sessionStorage.getItem('_mrt_oat')).toBeNull();
  expect(queryClient.getQueryData(['/api/messages/conversations', 'a'])).toBeUndefined();
  expect(queryClient.getQueryData(['/api/auth/me'])).toEqual({ authenticated: false, user: null });
});
it('does not pretend to log out when revocation fails', async () => {
  sessionStorage.setItem('_mrt_oat', 'fixture'); network.mockResolvedValue(Response.json({}, { status: 500 }));
  await expect(logoutAccount()).rejects.toThrow('500');
  expect(sessionStorage.getItem('_mrt_oat')).toBe('fixture');
});
it('rejects stale and unknown entitlements without treating remove_ads as full feature access', () => {
  expect(isAdFreeSubscription({ isActive: true, plan: 'unknown' })).toBe(false);
  expect(isAdFreeSubscription({ isActive: true, plan: 'premium_monthly', expiresAt: '2000-01-01' })).toBe(false);
  expect(isAdFreeSubscription({ isActive: true, plan: 'premium_yearly', expiresAt: 'bad-date' })).toBe(false);
  expect(isAdFreeSubscription({ isActive: true, plan: 'remove_ads' })).toBe(true);
});
it('does not invent prices and safely formats currencies using the current locale', () => {
  expect(fmtPrice(0, 'eur', 'de')).toBe(''); expect(fmtPrice(100, 'invalid', 'de')).toBe('');
  expect(fmtPrice(399, 'eur', 'de')).toMatch(/3,99/); expect(fmtPrice(500, 'jpy', 'ja')).toContain('500');
});
it('provides translated critical payment states for every enabled site language', () => {
  for (const locale of ACTIVE_SITEMAP_LANGUAGES) {
    const text = subscriptionCopy(locale);
    expect(Object.values(text).every(value => typeof value === 'string' && !!value)).toBe(true);
    if (locale !== 'en') expect(text.unavailable).not.toEqual(subscriptionCopy('en').unavailable);
  }
});
