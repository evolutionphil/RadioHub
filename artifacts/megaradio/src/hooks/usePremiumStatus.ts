import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { isAdFreeSubscription } from '@/lib/premium';

export interface PremiumStatus {
  isPremium: boolean;
  plan: string;
  isActive: boolean;
  isLifetime: boolean;
  isLoading: boolean;
  error: unknown;
}

/**
 * Derives premium status from the authenticated user's subscription.
 * subscription fields are returned by /api/auth/me but not yet typed in
 * the User interface — we cast via `as any` for now.
 *
 * Keeps the legacy localStorage premium hint in sync. Advertising decisions
 * use the resolved authentication state, never this potentially stale hint.
 */
export function usePremiumStatus(): PremiumStatus {
  const { user, isLoading, error } = useAuth();
  const sub = (user as any)?.subscription;
  const plan: string = sub?.plan ?? "none";
  const isActive = isAdFreeSubscription(sub);
  const isPremium = isActive;
  const isLifetime = isActive && plan === "premium_lifetime";

  useEffect(() => {
    try {
      if (isPremium) {
        localStorage.setItem("_mrt_is_premium", "1");
      } else if (!isLoading && !error && user !== undefined) {
        // Only clear when we have a confirmed non-premium user (not during loading).
        localStorage.removeItem("_mrt_is_premium");
      }
    } catch {}
  }, [isPremium, user, isLoading, error]);

  return { isPremium, plan, isActive, isLifetime, isLoading, error };
}
