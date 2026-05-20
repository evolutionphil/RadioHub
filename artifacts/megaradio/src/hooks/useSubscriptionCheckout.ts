import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";

interface CheckoutOptions {
  /** Called when the user is not logged in, before redirecting to login. */
  onUnauthenticated?: () => void;
  /** Extra body fields forwarded to the checkout endpoint (e.g. tvCode). */
  extraBody?: Record<string, string>;
}

interface CheckoutResult {
  loading: boolean;
  error: string | null;
  checkout: (plan: string) => Promise<void>;
}

/**
 * Handles the POST /api/subscription/checkout → Stripe redirect flow.
 * Used by PaywallModal, /premium, and /activate pages.
 *
 * Uses raw fetch (not apiRequest) so that JSON error bodies on 4xx/5xx
 * responses are always readable. apiRequest throws on non-2xx, which would
 * replace the real server error message with a generic "Network error".
 */
export function useSubscriptionCheckout(opts: CheckoutOptions = {}): CheckoutResult {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function checkout(plan: string) {
    if (!user) {
      opts.onUnauthenticated?.();
      setLocation(`/login?redirect=${encodeURIComponent("/premium")}`);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/subscription/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ plan, ...opts.extraBody }),
      });

      // Always try to parse JSON — the endpoint returns it on both success and error.
      let data: { checkoutUrl?: string; error?: string } = {};
      try {
        data = await res.json();
      } catch {
        // Body is not JSON (e.g. proxy-level 502 with plain text body).
        setError(`Server error (${res.status}). Please try again.`);
        setLoading(false);
        return;
      }

      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        // Don't reset loading — the page is navigating away.
      } else {
        setError(data.error || `Checkout failed (${res.status}). Please try again.`);
        setLoading(false);
      }
    } catch {
      // Only reaches here on a genuine network failure (no connection, DNS, etc.).
      setError("Network error. Please check your connection and try again.");
      setLoading(false);
    }
  }

  return { loading, error, checkout };
}
