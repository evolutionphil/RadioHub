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

// Minimal Paddle.js v2 global type — only the fields we use.
declare global {
  interface Window {
    Paddle?: {
      Initialize: (opts: {
        token: string;
        eventCallback?: (event: { name: string; data?: unknown }) => void;
      }) => void;
      Checkout: {
        open: (opts: {
          items?: Array<{ priceId: string; quantity: number }>;
          transactionId?: string;
          customData?: Record<string, string>;
          settings?: { successUrl?: string; displayMode?: string };
        }) => void;
      };
    };
  }
}

// Module-level dedup so multiple rapid calls share the same script load.
let paddleScriptLoading: Promise<void> | null = null;

function loadPaddleJs(): Promise<void> {
  if (window.Paddle) return Promise.resolve();
  if (paddleScriptLoading) return paddleScriptLoading;
  paddleScriptLoading = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.paddle.com/paddle/v2/paddle.js";
    script.onload = () => resolve();
    script.onerror = () => {
      paddleScriptLoading = null;
      reject(new Error("Failed to load Paddle.js"));
    };
    document.head.appendChild(script);
  });
  return paddleScriptLoading;
}

/**
 * Handles checkout for both Stripe (redirect) and Paddle (Paddle.js overlay).
 * Used by PaywallModal, /premium, and /activate pages.
 *
 * - Stripe: server returns { checkoutUrl } → window.location redirect
 * - Paddle: server returns { paddleCheckout: { priceId, customData, successUrl } }
 *           → Paddle.js opens overlay using items[] (no pre-created transaction needed)
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

      let data: {
        checkoutUrl?: string;
        paddleCheckout?: {
          priceId: string;
          customData: Record<string, string>;
          successUrl: string;
        };
        error?: string;
      } = {};
      try {
        data = await res.json();
      } catch {
        setError(`Server error (${res.status}). Please try again.`);
        setLoading(false);
        return;
      }

      // ── Paddle.js items-based overlay checkout ──────────────────────────────
      // The backend returns priceId + customData instead of pre-creating a
      // transaction. Pre-created transactions are in "draft" status which
      // Paddle's checkout page rejects with 404.
      if (data.paddleCheckout) {
        const paddleToken = (import.meta.env as Record<string, string | undefined>).VITE_PADDLE_CLIENT_TOKEN;
        if (!paddleToken) {
          setError("Payment provider not configured. Please contact support.");
          setLoading(false);
          return;
        }
        try {
          await loadPaddleJs();
        } catch {
          setError("Failed to load payment widget. Please refresh and try again.");
          setLoading(false);
          return;
        }
        const { priceId, customData, successUrl } = data.paddleCheckout;
        window.Paddle!.Initialize({
          token: paddleToken,
          eventCallback: (event) => {
            if (event.name === "checkout.closed") {
              // User dismissed the overlay without completing payment
              setLoading(false);
            }
            if (event.name === "checkout.completed") {
              window.location.href = successUrl;
              // Don't reset loading — page is navigating away
            }
          },
        });
        window.Paddle!.Checkout.open({
          items: [{ priceId, quantity: 1 }],
          customData,
          settings: { successUrl, displayMode: "overlay" },
        });
        // Keep loading=true while the overlay is open; reset via eventCallback
        return;
      }

      // ── Stripe redirect checkout ────────────────────────────────────────────
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        // Don't reset loading — the page is navigating away.
        return;
      }

      setError(data.error || `Checkout failed (${res.status}). Please try again.`);
      setLoading(false);
    } catch {
      // Only reaches here on a genuine network failure (no connection, DNS, etc.).
      setError("Network error. Please check your connection and try again.");
      setLoading(false);
    }
  }

  return { loading, error, checkout };
}
