import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Tv, CheckCircle, Zap, Crown, AlertCircle } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import { useSubscriptionCheckout } from '@/hooks/useSubscriptionCheckout';
import { useSubscriptionPlans } from '@/hooks/useSubscriptionPlans';
import { useTranslation } from '@/hooks/useTranslation';
import { subscriptionCopy } from '@/lib/subscription-copy';
import { fmtPrice as formatPrice, isAdFreeSubscription } from '@/lib/premium';
import { ManageSubscriptionButton } from '@/components/ManageSubscriptionButton';

export default function ActivatePage() {
  const { user, isLoading: authLoading } = useAuth();
  const { language } = useTranslation();
  const copy = subscriptionCopy(language);
  const alreadySubscribed = isAdFreeSubscription((user as any)?.subscription);

  const params = new URLSearchParams(window.location.search);
  const tvCode = (params.get("code") || "").trim().toUpperCase();

  const [selectedPlan, setSelectedPlan] = useState<string>("premium_monthly");
  const returnTo = `/${language}/activate?code=${encodeURIComponent(tvCode)}`;
  const { loading, error, checkout } = useSubscriptionCheckout({ extraBody: { tvCode }, returnTo });
  const catalog = useSubscriptionPlans();

  // Idempotency: check whether this code has already been activated or expired
  // before showing the checkout UI. Avoids a double-charge scenario.
  const { data: codeStatus, isLoading: statusLoading, isError: statusError } = useQuery<{
    status: "pending" | "activated" | "expired" | "not_found";
  }>({
    queryKey: ['/api/subscription/tv/code/status', tvCode],
    queryFn: async ({ signal }) => {
      if (!tvCode || tvCode.length !== 6) return { status: "not_found" as const };
      const res = await apiRequest('GET', `/api/subscription/tv/code/${encodeURIComponent(tvCode)}/status?deviceId=web-activate`, { signal });
      return res.json();
    },
    enabled: !!tvCode && tvCode.length === 6,
    staleTime: 10_000,
    retry: false,
  });

  const plans = catalog.plans;
  useEffect(() => {
    if (plans.length && !plans.some(plan => plan.planId === selectedPlan)) setSelectedPlan(plans[0].planId);
  }, [plans, selectedPlan]);

  async function handleCheckout() {
    if (codeStatus?.status === 'pending' && catalog.canCheckout(selectedPlan)) await checkout(selectedPlan);
  }

  if (authLoading || (tvCode && statusLoading)) {
    return (
      <div className="min-h-screen bg-[#0E0E0E] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-white animate-spin" />
      </div>
    );
  }

  // Already activated — don't show checkout again
  if (codeStatus?.status === "activated") {
    return (
      <div className="min-h-screen bg-[#0E0E0E] flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-[#1a1a1a] border-[#333] text-white text-center">
          <CardHeader>
            <div className="flex justify-center mb-4">
              <CheckCircle className="w-12 h-12 text-green-400" />
            </div>
            <CardTitle className="text-xl text-green-400">Already Activated</CardTitle>
            <CardDescription className="text-gray-400">
              This code has already been used to activate a subscription. Your TV should update automatically.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full bg-[#FF6B35] hover:bg-[#e55a24] text-white" onClick={() => window.location.href = "/"}>
              Go to Mega Radio
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Expired — tell them to go back to the TV
  if (!/^[A-Z0-9]{6}$/.test(tvCode) || codeStatus?.status === "expired" || codeStatus?.status === "not_found") {
    return (
      <div className="min-h-screen bg-[#0E0E0E] flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-[#1a1a1a] border-[#333] text-white text-center">
          <CardHeader>
            <div className="flex justify-center mb-4">
              <AlertCircle className="w-12 h-12 text-yellow-400" />
            </div>
            <CardTitle className="text-xl text-yellow-400">Code Expired</CardTitle>
            <CardDescription className="text-gray-400">
              This activation code has expired or is invalid. Open MegaRadio on your TV to get a new code.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full bg-[#FF6B35] hover:bg-[#e55a24] text-white" onClick={() => window.location.href = "/"}>
              Go to Mega Radio
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#0E0E0E] flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-[#1a1a1a] border-[#333] text-white">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <Tv className="w-12 h-12 text-[#FF6B35]" />
            </div>
            <CardTitle className="text-2xl">Activate TV Subscription</CardTitle>
            <CardDescription className="text-gray-400">
              Sign in to link your subscription to your TV
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {tvCode && (
              <div className="bg-[#0E0E0E] rounded-lg p-4 text-center">
                <p className="text-sm text-gray-400 mb-1">Your TV code</p>
                <p className="text-3xl font-mono font-bold tracking-widest text-[#FF6B35]">{tvCode}</p>
              </div>
            )}
            <Button
              className="w-full bg-[#FF6B35] hover:bg-[#e55a24] text-white"
              onClick={() => window.location.href = `/${language}/login?returnTo=${encodeURIComponent(returnTo)}`}
            >
              Sign In to Continue
            </Button>
            <p className="text-center text-sm text-gray-500">
              Don't have an account?{" "}
              <a href={`/${language}/signup?returnTo=${encodeURIComponent(returnTo)}`} className="text-[#FF6B35] hover:underline">
                Sign up free
              </a>
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0E0E0E] flex items-center justify-center p-4">
      <Card className="w-full max-w-lg bg-[#1a1a1a] border-[#333] text-white">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="relative">
              <Tv className="w-12 h-12 text-[#FF6B35]" />
              <Crown className="w-5 h-5 text-yellow-400 absolute -top-1 -right-1" />
            </div>
          </div>
          <CardTitle className="text-2xl">Activate TV Premium</CardTitle>
          <CardDescription className="text-gray-400">
            Choose a plan to unlock premium features on your TV
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {tvCode && (
            <div className="bg-[#0E0E0E] rounded-lg p-4 text-center">
              <p className="text-sm text-gray-400 mb-1">Activating TV code</p>
              <p className="text-3xl font-mono font-bold tracking-widest text-[#FF6B35]">{tvCode}</p>
            </div>
          )}

          <div className="space-y-3">
            {plans.map((plan) => {
              const badge = null;
              const price = formatPrice(plan.amount, plan.currency, language);
              return (
                <button
                  key={plan.planId}
                  onClick={() => setSelectedPlan(plan.planId)}
                  className={`w-full rounded-lg border-2 p-4 text-left transition-colors ${
                    selectedPlan === plan.planId
                      ? "border-[#FF6B35] bg-[#FF6B35]/10"
                      : "border-[#333] bg-[#0E0E0E] hover:border-[#555]"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white">{plan.label}</span>
                        {price && <span className="text-[#FF6B35] font-bold">{price}</span>}
                        {badge && (
                          <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-xs">
                            {badge}
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-gray-400 mt-0.5">{plan.description}</p>
                    </div>
                    <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 ${
                      selectedPlan === plan.planId
                        ? "border-[#FF6B35] bg-[#FF6B35]"
                        : "border-[#555]"
                    }`}>
                      {selectedPlan === plan.planId && (
                        <CheckCircle className="w-4 h-4 text-white m-auto" />
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="space-y-2 text-sm text-gray-400">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-[#FF6B35] flex-shrink-0" />
              <span>Ad-free listening across all devices</span>
            </div>
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-[#FF6B35] flex-shrink-0" />
              <span>{copy.broadcastAds}</span>
            </div>
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-[#FF6B35] flex-shrink-0" />
              <span>Works on Samsung TV, LG TV, iOS & Android</span>
            </div>
            {selectedPlan === "premium_lifetime" && (
              <div className="flex items-center gap-2 text-yellow-400">
                <Zap className="w-4 h-4 flex-shrink-0" />
                <span>One-time payment — no recurring charges ever</span>
              </div>
            )}
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
              {error}
            </div>
          )}
          {(statusError || !catalog.canCheckout(selectedPlan)) && <p role="status" className="text-sm text-amber-400">{copy.unavailable}</p>}

          <Button
            className="w-full bg-[#FF6B35] hover:bg-[#e55a24] text-white h-12 text-base font-semibold"
            onClick={handleCheckout}
            disabled={loading || alreadySubscribed || !catalog.canCheckout(selectedPlan) || codeStatus?.status !== 'pending'}
          >
            {loading ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Redirecting to payment...</>
            ) : (
              "Continue to Payment"
            )}
          </Button>

          {alreadySubscribed && <div className="space-y-2"><p className="text-sm text-green-400">{copy.active}</p><ManageSubscriptionButton /></div>}
          <p className="text-center text-xs text-gray-500">
            Cancel anytime — manage your subscription at{" "}
            <a href={`/${language}/premium`} className="underline hover:text-gray-300">{copy.manage}</a>.
          </p>
          <p className="text-center text-xs text-gray-600">
            By continuing you agree to our{" "}
            <a href={`/${language}/terms-and-conditions`} className="underline hover:text-gray-400">Subscription Terms</a>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
