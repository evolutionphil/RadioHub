import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useSubscriptionCheckout } from '../src/hooks/useSubscriptionCheckout';
import { loadPaddle, type PaddleEvent } from '../src/lib/paddle-checkout';

const state = vi.hoisted(() => ({ user: { _id: 'user-a' } as { _id: string } | null, navigate: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: state.user, isLoading: false, error: null }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ language: 'de' }) }));
vi.mock('wouter', () => ({ useLocation: () => ['/de/premium', state.navigate] }));
let event: (event: PaddleEvent) => void;
const request = vi.fn();
const payload = () => ({ paddleCheckout: {
  clientToken: 'test_fixture', priceId: 'pri_fixture', environment: 'sandbox',
  customData: { userId: 'user-a', signature: 'signed-by-server' },
  successUrl: `${window.location.origin}/premium/success`,
} });

beforeEach(() => {
  state.user = { _id: 'user-a' };
  state.navigate.mockReset();
  sessionStorage.clear(); localStorage.clear();
  window.Paddle = {
    Environment: { set: vi.fn() },
    Initialize: vi.fn(options => { event = options.eventCallback; }),
    Checkout: { open: vi.fn(), close: vi.fn() },
  };
  request.mockReset().mockImplementation(async () => Response.json(payload()));
  vi.stubGlobal('fetch', request);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('deduplicates rapid clicks and initializes Paddle only once across reopen', async () => {
  const { result } = renderHook(() => useSubscriptionCheckout());
  await act(async () => { await Promise.all([result.current.checkout('premium_yearly'), result.current.checkout('premium_yearly')]); });
  expect(request).toHaveBeenCalledTimes(1);
  expect(window.Paddle!.Initialize).toHaveBeenCalledTimes(1);
  expect(result.current.loading).toBe(true);
  act(() => event({ name: 'checkout.closed' }));
  expect(result.current.loading).toBe(false);
  await act(async () => { await result.current.checkout('premium_monthly'); });
  expect(window.Paddle!.Initialize).toHaveBeenCalledTimes(1);
  expect(window.Paddle!.Checkout.open).toHaveBeenCalledTimes(2);
});
it('preserves signed metadata, locale and the selected plan over extra fields', async () => {
  sessionStorage.setItem('_mrt_oat', 'oauth-fixture');
  const { result } = renderHook(() => useSubscriptionCheckout({ extraBody: { plan: 'evil-plan', tvCode: '123456' } }));
  await act(async () => { await result.current.checkout('premium_yearly'); });
  expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ plan: 'premium_yearly', tvCode: '123456', locale: 'de' });
  expect(request.mock.calls[0][1].headers.Authorization).toBe('Bearer oauth-fixture');
  expect(window.Paddle!.Checkout.open).toHaveBeenCalledWith(expect.objectContaining({
    customData: payload().paddleCheckout.customData,
    settings: expect.objectContaining({ locale: 'de', successUrl: `${window.location.origin}/de/premium/success` }),
  }));
  expect(localStorage.getItem('_mrt_is_premium')).toBeNull();
});
it('does not open a widget from an error response even if it contains a checkout object', async () => {
  request.mockResolvedValue(Response.json(payload(), { status: 503 }));
  const { result } = renderHook(() => useSubscriptionCheckout());
  await act(async () => { await result.current.checkout('premium_yearly'); });
  expect(window.Paddle!.Checkout.open).not.toHaveBeenCalled();
  expect(result.current.error).toBeTruthy(); expect(result.current.loading).toBe(false);
});
it('cancels and ignores a checkout response after changing accounts', async () => {
  let resolve!: (value: Response) => void;
  request.mockReturnValue(new Promise<Response>(r => { resolve = r; }));
  const { result, rerender } = renderHook(() => useSubscriptionCheckout());
  let pending!: Promise<void>;
  act(() => { pending = result.current.checkout('premium_yearly'); });
  state.user = { _id: 'user-b' }; rerender();
  await act(async () => { resolve(Response.json(payload())); await pending; });
  expect(request.mock.calls[0][1].signal.aborted).toBe(true);
  expect(window.Paddle!.Checkout.open).not.toHaveBeenCalled();
  expect(result.current.loading).toBe(false);
});
it('closes an owned overlay on unmount and ignores its late callbacks', async () => {
  const { result, unmount } = renderHook(() => useSubscriptionCheckout());
  await act(async () => { await result.current.checkout('premium_yearly'); });
  unmount();
  expect(window.Paddle!.Checkout.close).toHaveBeenCalledOnce();
  act(() => event({ name: 'checkout.completed' }));
  expect(localStorage.getItem('_mrt_is_premium')).toBeNull();
});
it('keeps TV activation code and locale in the provider return URL', async () => {
  const data = payload(); data.paddleCheckout.successUrl = `${window.location.origin}/activate/success?code=123456`;
  request.mockResolvedValue(Response.json(data));
  const { result } = renderHook(() => useSubscriptionCheckout({ extraBody: { tvCode: '123456' } }));
  await act(async () => { await result.current.checkout('premium_monthly'); });
  expect(window.Paddle!.Checkout.open).toHaveBeenCalledWith(expect.objectContaining({ settings: expect.objectContaining({
    successUrl: `${window.location.origin}/de/activate/success?code=123456`,
  }) }));
});
it('preserves the locale and return destination when login is required', async () => {
  state.user = null;
  const { result } = renderHook(() => useSubscriptionCheckout({ returnTo: '/de/activate?code=123456' }));
  await act(async () => { await result.current.checkout('premium_monthly'); });
  expect(state.navigate).toHaveBeenCalledWith('/de/login?returnTo=%2Fde%2Factivate%3Fcode%3D123456');
  expect(request).not.toHaveBeenCalled();
});
it('rejects a cross-origin return URL', async () => {
  const data = payload(); data.paddleCheckout.successUrl = 'https://untrusted.example/premium/success';
  request.mockResolvedValue(Response.json(data));
  const { result } = renderHook(() => useSubscriptionCheckout());
  await act(async () => { await result.current.checkout('premium_yearly'); });
  expect(window.Paddle!.Checkout.open).not.toHaveBeenCalled(); expect(result.current.error).toBeTruthy();
});
it('times out a blocked Paddle script and permits a later retry', async () => {
  vi.useFakeTimers(); delete window.Paddle;
  const pending = loadPaddle();
  const assertion = expect(pending).rejects.toThrow('could not be loaded');
  await vi.advanceTimersByTimeAsync(20_000); await assertion;
  expect(document.querySelector('script[src*="cdn.paddle.com"]')).toBeNull();
  const next = loadPaddle();
  const nextAssertion = expect(next).rejects.toThrow('could not be loaded');
  document.querySelector<HTMLScriptElement>('script[src*="cdn.paddle.com"]')!.dispatchEvent(new Event('error'));
  await nextAssertion;
});
it('does not open an old account checkout when the SDK finishes loading after a new attempt', async () => {
  const sdk = window.Paddle!; delete window.Paddle;
  const { result, rerender } = renderHook(() => useSubscriptionCheckout());
  let first!: Promise<void>;
  await act(async () => { first = result.current.checkout('premium_yearly'); await Promise.resolve(); });
  state.user = { _id: 'user-b' }; rerender();
  const data = payload(); data.paddleCheckout.customData.userId = 'user-b';
  request.mockResolvedValue(Response.json(data));
  let second!: Promise<void>;
  await act(async () => { second = result.current.checkout('premium_monthly'); await Promise.resolve(); });
  await act(async () => {
    window.Paddle = sdk;
    document.querySelector<HTMLScriptElement>('script[src*="cdn.paddle.com"]')!.dispatchEvent(new Event('load'));
    await Promise.all([first, second]);
  });
  expect(sdk.Checkout.open).toHaveBeenCalledOnce();
  expect(sdk.Checkout.open).toHaveBeenCalledWith(expect.objectContaining({ customData: expect.objectContaining({ userId: 'user-b' }) }));
});
