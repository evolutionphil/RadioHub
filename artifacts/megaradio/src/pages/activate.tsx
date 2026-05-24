import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Tv, CheckCircle, Zap, Crown, AlertCircle } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";

interface PlanInfo {
  planId: string;
  label: string;
  description: string;
  currency: string;
  amount: number;
}

const PLAN_BADGE: Record<string, string | null> = {
  premium_monthly: null,
  premium_yearly: "Best Value",
  premium_lifetime: "One-Time",
};

const FALLBACK_PLANS: PlanInfo[] = [
  { planId: "premium_monthly", label: "Monthly", description: "Billed monthly, cancel anytime", currency: "usd", amount: 0 },
  { planId: "premium_yearly", label: "Annual", description: "Best value — save vs monthly", currency: "usd", amount: 0 },
  { planId: "premium_lifetime", label: "Lifetime", description: "One-time payment, never pay again", currency: "usd", amount: 0 },
];

function fmtPrice(amount: number, currency: string): string {
  if (!amount) return "";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase(), minimumFractionDigits: 2 }).format(amount / 100);
}

export default function ActivatePage() {
  const { user, isLoading: authLoading } = useAuth();

  const params = new URLSearchParams(window.location.search);
  const tvCode = params.get("code") || "";

  const [selectedPlan, setSelectedPlan] = useState<string>("premium_monthly");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: plansData } = useQuery<{ plans: PlanInfo[] }>({
    queryKey: ["/api/subscription/plans"],
    staleTime: 5 * 60 * 1000,
  });

  // Idempotency: check whether this code has already been activated or expired
  // before showing the checkout UI. Avoids a double-charge scenario.
  const { data: codeStatus, isLoading: statusLoading } = useQuery<{
    status: "pending" | "activated" | "expired" | "not_found";
  }>({
    queryKey: [`/api/subscription/tv/code/${tvCode}/status`, tvCode],
    queryFn: async () => {
      if (!tvCode || tvCode.length !== 6) return { status: "not_found" as const };
      const res = await fetch(
        `/api/subscription/tv/code/${tvCode}/status?deviceId=web-activate`,
        { headers: { "Content-Type": "application/json" } }
      );
      // 404 = wrong deviceId — treat as not found
      if (res.status === 404) return { status: "not_found" as const };
      return res.json();
    },
    enabled: !!tvCode && tvCode.length === 6,
    staleTime: 10_000,
    retry: false,
  });

  const plans: PlanInfo[] = plansData?.plans?.length ? plansData.plans : FALLBACK_PLANS;

  async function handleCheckout() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest("POST", "/api/subscription/checkout", {
        body: { plan: selectedPlan, tvCode },
      });
      const data: { success: boolean; checkoutUrl?: string; error?: string } = await res.json();
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else {
        setError(data.error || "Failed to start checkout");
        setLoading(false);
      }
    } catch (err: any) {
      setError(err?.message || "Network error. Please try again.");
      setLoading(false);
    }
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
  if (codeStatus?.status === "expired" || codeStatus?.status === "not_found") {
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
              onClick={() => window.location.href = `/login?redirect=${encodeURIComponent(window.location.href)}`}
            >
              Sign In to Continue
            </Button>
            <p className="text-center text-sm text-gray-500">
              Don't have an account?{" "}
              <a href={`/signup?redirect=${encodeURIComponent(window.location.href)}`} className="text-[#FF6B35] hover:underline">
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
              const badge = PLAN_BADGE[plan.planId];
              const price = fmtPrice(plan.amount, plan.currency);
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
              <span>Premium quality streams</span>
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

          <Button
            className="w-full bg-[#FF6B35] hover:bg-[#e55a24] text-white h-12 text-base font-semibold"
            onClick={handleCheckout}
            disabled={loading}
          >
            {loading ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Redirecting to payment...</>
            ) : (
              "Continue to Payment"
            )}
          </Button>

          <p className="text-center text-xs text-gray-500">
            Cancel anytime — manage your subscription at{" "}
            <a href="/account" className="underline hover:text-gray-300">themegaradio.com/account</a>.
          </p>
          <p className="text-center text-xs text-gray-600">
            By continuing you agree to our{" "}
            <a href="/legal/terms" className="underline hover:text-gray-400">Subscription Terms</a>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
