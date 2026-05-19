import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Tv, CheckCircle, Zap, Crown } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";

const PLANS = [
  {
    id: "premium_monthly",
    label: "Monthly",
    description: "Billed monthly, cancel anytime",
    badge: null,
  },
  {
    id: "premium_yearly",
    label: "Annual",
    description: "Best value — save vs monthly",
    badge: "Best Value",
  },
];

export default function ActivatePage() {
  const [location] = useLocation();
  const { user, isLoading: authLoading } = useAuth();

  const params = new URLSearchParams(window.location.search);
  const tvCode = params.get("code") || "";

  const [selectedPlan, setSelectedPlan] = useState<string>("premium_monthly");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codeValid, setCodeValid] = useState<boolean | null>(null);

  // Validate the TV code exists and is pending
  useEffect(() => {
    if (!tvCode) { setCodeValid(false); return; }
    // We don't expose deviceId validation from the web side — just show the
    // plan selector. The actual code is validated during checkout creation.
    setCodeValid(true);
  }, [tvCode]);

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

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#0E0E0E] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-white animate-spin" />
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

  if (codeValid === false) {
    return (
      <div className="min-h-screen bg-[#0E0E0E] flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-[#1a1a1a] border-[#333] text-white">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl text-red-400">Invalid Code</CardTitle>
            <CardDescription className="text-gray-400">
              No activation code found. Please go to your TV and request a new code.
            </CardDescription>
          </CardHeader>
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
            {PLANS.map((plan) => (
              <button
                key={plan.id}
                onClick={() => setSelectedPlan(plan.id)}
                className={`w-full rounded-lg border-2 p-4 text-left transition-colors ${
                  selectedPlan === plan.id
                    ? "border-[#FF6B35] bg-[#FF6B35]/10"
                    : "border-[#333] bg-[#0E0E0E] hover:border-[#555]"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-white">{plan.label}</span>
                      {plan.badge && (
                        <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-xs">
                          {plan.badge}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-gray-400 mt-0.5">{plan.description}</p>
                  </div>
                  <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 ${
                    selectedPlan === plan.id
                      ? "border-[#FF6B35] bg-[#FF6B35]"
                      : "border-[#555]"
                  }`}>
                    {selectedPlan === plan.id && (
                      <CheckCircle className="w-4 h-4 text-white m-auto" />
                    )}
                  </div>
                </div>
              </button>
            ))}
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
            Secure payment powered by Stripe. Cancel anytime.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
