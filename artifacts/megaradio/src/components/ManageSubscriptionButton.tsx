import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { apiRequest } from '@/lib/queryClient';
import { useTranslation } from '@/hooks/useTranslation';
import { subscriptionCopy } from '@/lib/subscription-copy';

export function ManageSubscriptionButton() {
  const { language } = useTranslation();
  const copy = subscriptionCopy(language);
  const busy = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  async function manage() {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    setError(false);
    try {
      const result = await apiRequest('POST', '/api/subscription/portal', { body: { locale: language } });
      const data = await result.json();
      const url = new URL(data.portalUrl);
      if (url.protocol !== 'https:' || !['customer-portal.paddle.com', 'sandbox-customer-portal.paddle.com', 'billing.stripe.com'].includes(url.hostname)) throw new Error('Invalid portal');
      window.location.assign(url.href);
    } catch { setError(true); }
    finally { busy.current = false; setLoading(false); }
  }
  return <div className="space-y-2">
    <Button variant="outline" onClick={manage} disabled={loading}>{copy.manage}</Button>
    {error && <p role="alert" className="text-sm text-amber-400">{copy.unavailable}</p>}
  </div>;
}
