import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";

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
      const res = await apiRequest("POST", "/api/subscription/checkout", {
        body: { plan, ...opts.extraBody },
      });
      const data: { checkoutUrl?: string; error?: string } = await res.json();
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        // Don't reset loading — the page is navigating away.
      } else {
        setError(data.error || "Failed to start checkout");
        setLoading(false);
      }
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  }

  return { loading, error, checkout };
}
