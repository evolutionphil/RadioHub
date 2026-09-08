import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/hooks/useAuth';
import { apiRequest } from '@/lib/queryClient';
import { useTranslation } from '@/hooks/useTranslation';
import { openPaddleCheckout, releaseCheckout, reserveCheckout } from '@/lib/paddle-checkout';

interface CheckoutOptions {
  onUnauthenticated?: () => void;
  extraBody?: Record<string, string>;
  returnTo?: string;
}

export function useSubscriptionCheckout(opts: CheckoutOptions = {}) {
  const { user, isLoading: authLoading, error: authError } = useAuth();
  const { language: currentLanguage } = useTranslation();
  const [, setLocation] = useLocation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const owner = useRef(Symbol('checkout'));
  const busy = useRef(false);
  const mounted = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const account = useRef(user?._id);
  account.current = user?._id;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
      releaseCheckout(owner.current, true);
      busy.current = false;
    };
  }, []);
  useEffect(() => {
    setLoading(false);
    setError(null);
    return () => {
      controller.current?.abort();
      releaseCheckout(owner.current, true);
      busy.current = false;
    };
  }, [user?._id]);

  async function checkout(plan: string) {
    if (busy.current || authLoading) return;
    if (authError) { setError('Please reload your account before starting checkout.'); return; }
    if (!user) {
      opts.onUnauthenticated?.();
      const returnTo = opts.returnTo || `/${currentLanguage}/premium`;
      setLocation(`/${currentLanguage}/login?returnTo=${encodeURIComponent(returnTo)}`);
      return;
    }
    const userId = user._id;
    const lease = Symbol('checkout-attempt');
    const request = new AbortController();
    const isCurrent = () => mounted.current && owner.current === lease && account.current === userId && !request.signal.aborted;
    const finish = (message?: string) => {
      releaseCheckout(lease);
      if (owner.current !== lease) return;
      busy.current = false;
      if (mounted.current && account.current === userId) {
        setLoading(false);
        if (message) setError(message);
      }
    };
    let successUrl: string | undefined;
    if (!reserveCheckout(lease, event => {
      if (!isCurrent()) return;
      if (event.name === 'checkout.completed' && successUrl) {
        // Browser events and localStorage never grant premium. The return page
        // waits for the entitlement verified by the server webhook.
        window.location.assign(successUrl);
      } else if (event.name === 'checkout.closed') finish();
      else if (event.name === 'checkout.error') finish('Payment could not be completed. Please try again.');
    })) {
      setError('A payment window is already open. Please finish or close it first.');
      return;
    }
    busy.current = true;
    owner.current = lease;
    controller.current = request;
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest('POST', '/api/subscription/checkout', {
        body: { ...opts.extraBody, plan, locale: currentLanguage },
        signal: request.signal,
      });
      const data = await res.json();
      if (!isCurrent() || request.signal.aborted) return;
      if (data.paddleCheckout) {
        const config = data.paddleCheckout;
        const token = config.clientToken || import.meta.env.VITE_PADDLE_CLIENT_TOKEN;
        if (!token || (!config.priceId && !config.transactionId)) throw new Error('Payment provider is not configured.');
        const target = new URL(config.successUrl, window.location.origin);
        if (target.origin !== window.location.origin || !/^\/(?:[a-z]{2}\/)?(?:premium|activate)\/success\/?$/.test(target.pathname)) {
          throw new Error('Invalid payment return address.');
        }
        target.pathname = `/${currentLanguage}/${target.pathname.includes('/activate/') ? 'activate' : 'premium'}/success`;
        successUrl = target.href;
        await openPaddleCheckout(lease, token, config.environment === 'sandbox' ? 'sandbox' : 'production', {
          ...(config.transactionId ? { transactionId: config.transactionId } : { items: [{ priceId: config.priceId, quantity: 1 }] }),
          customData: config.customData,
          settings: { successUrl, displayMode: 'overlay',
            // Paddle does not support every language offered by MegaRadio.
            locale: currentLanguage === 'zh' ? 'zh-Hans' :
              ['ar', 'da', 'nl', 'en', 'fr', 'de', 'it', 'ja', 'ko', 'no', 'pl', 'pt', 'tr', 'ru', 'es', 'sv'].includes(currentLanguage) ? currentLanguage : 'en' },
        });
        return;
      }
      if (data.checkoutUrl) {
        const target = new URL(data.checkoutUrl);
        if (target.protocol !== 'https:' || target.hostname !== 'checkout.stripe.com') throw new Error('Invalid payment address.');
        window.location.assign(target.href);
        return;
      }
      finish('Checkout is currently unavailable. Please try again later.');
    } catch {
      if (!request.signal.aborted && isCurrent()) finish('Checkout could not be started. Please try again later.');
    }
  }
  return { loading, error, checkout };
}
