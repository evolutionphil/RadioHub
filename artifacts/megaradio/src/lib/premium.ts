// Shared types and constants for the web premium subscription flow.
// Consumed by PaywallModal, /premium page, and /activate page.

export interface PlanInfo {
  planId: string;
  label: string;
  description: string;
  currency: string;
  amount: number;
}

export const FALLBACK_PLANS: PlanInfo[] = [
  { planId: "premium_yearly",   label: "Annual",   description: "Best value — save vs monthly",     currency: "eur", amount: 2999 },
  { planId: "premium_lifetime", label: "Lifetime", description: "One-time payment, never pay again", currency: "eur", amount: 5999 },
  { planId: "premium_monthly",  label: "Monthly",  description: "Billed monthly, cancel anytime",   currency: "eur", amount: 399  },
];

export const PLAN_BADGE: Record<string, string | null> = {
  premium_yearly:   "Best Value",
  premium_lifetime: "One-Time",
  premium_monthly:  null,
};

export const PLAN_LABEL: Record<string, string> = {
  premium_monthly:  "Monthly",
  premium_yearly:   "Annual",
  premium_lifetime: "Lifetime",
};

export function fmtPrice(amount: number, currency: string): string {
  if (!amount) return "";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
  }).format(amount / 100);
}
