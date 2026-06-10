import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";

export interface PremiumStatus {
  isPremium: boolean;
  plan: string;
  isActive: boolean;
  isLifetime: boolean;
}

/**
 * Derives premium status from the authenticated user's subscription.
 * subscription fields are returned by /api/auth/me but not yet typed in
 * the User interface — we cast via `as any` for now.
 *
 * Also keeps a localStorage flag (_mrt_is_premium) in sync so that
 * index.html can skip loading the AdSense script on premium users' page loads.
 */
export function usePremiumStatus(): PremiumStatus {
  const { user } = useAuth();
  const sub = (user as any)?.subscription;
  const plan: string = sub?.plan ?? "none";
  const isActive: boolean = sub?.isActive === true;
  const isPremium = isActive && plan !== "none";
  const isLifetime = plan === "premium_lifetime";

  useEffect(() => {
    try {
      if (isPremium) {
        localStorage.setItem("_mrt_is_premium", "1");
      } else if (user !== undefined) {
        // Only clear when we have a confirmed non-premium user (not during loading).
        localStorage.removeItem("_mrt_is_premium");
      }
    } catch {}
  }, [isPremium, user]);

  return { isPremium, plan, isActive, isLifetime };
}
