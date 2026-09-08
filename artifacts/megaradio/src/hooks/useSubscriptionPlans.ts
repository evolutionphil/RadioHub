import { useQuery } from '@tanstack/react-query';
import { PAID_PLANS, type PlanInfo } from '@/lib/premium';

export function useSubscriptionPlans(enabled = true) {
  const query = useQuery<{ plans: PlanInfo[]; providerAvailable?: boolean }>({
    queryKey: ['/api/subscription/plans'], staleTime: 60_000, enabled,
  });
  const plans = Array.isArray(query.data?.plans) ? query.data.plans.filter(plan =>
    PAID_PLANS.includes(plan.planId as typeof PAID_PLANS[number])) : [];
  const canCheckout = (id: string) => !query.isError && !query.isPending && query.data?.providerAvailable !== false &&
    plans.some(plan => plan.planId === id && plan.checkoutAvailable !== false);
  return { ...query, plans, canCheckout };
}
