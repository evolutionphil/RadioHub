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
 */
export function usePremiumStatus(): PremiumStatus {
  const { user } = useAuth();
  const sub = (user as any)?.subscription;
  const plan: string = sub?.plan ?? "none";
  const isActive: boolean = sub?.isActive === true;
  const isPremium = isActive && plan !== "none";
  const isLifetime = plan === "premium_lifetime";
  return { isPremium, plan, isActive, isLifetime };
}
