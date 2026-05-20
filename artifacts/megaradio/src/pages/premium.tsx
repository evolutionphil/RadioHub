import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle, Crown, Sparkles, Zap, Radio, Tv, Smartphone } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { usePremiumStatus } from "@/hooks/usePremiumStatus";
import { useSubscriptionCheckout } from "@/hooks/useSubscriptionCheckout";
import { useLocation } from "wouter";
import { FALLBACK_PLANS, PLAN_BADGE, PLAN_LABEL, fmtPrice, type PlanInfo } from "@/lib/premium";

const FEATURES = [
  { icon: Zap,        text: "Ad-free listening across all devices" },
  { icon: Radio,      text: "HD quality streams & highest bitrate" },
  { icon: Smartphone, text: "Car Mode for distraction-free driving" },
  { icon: Sparkles,   text: "Unlimited stream recording" },
  { icon: Tv,         text: "Samsung TV, LG TV, iOS & Android" },
];

export default function PremiumPage() {
  const { user, isLoading: authLoading } = useAuth();
  const { isPremium, plan: currentPlan } = usePremiumStatus();
  const [, setLocation] = useLocation();
  const [selectedPlan, setSelectedPlan] = useState("premium_yearly");

  const { loading, error, checkout } = useSubscriptionCheckout();

  const { data: plansData } = useQuery<{ plans: PlanInfo[] }>({
    queryKey: ["/api/subscription/plans"],
    staleTime: 5 * 60 * 1000,
    // Skip fetch entirely when already premium — result won't be rendered.
    enabled: !isPremium,
  });

  const plans = plansData?.plans?.length ? plansData.plans : FALLBACK_PLANS;

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#FF4199] animate-spin" />
      </div>
    );
  }

  if (isPremium) {
    const label = PLAN_LABEL[currentPlan] ?? "Premium";
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4">
        <div className="text-center space-y-4 max-w-sm">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#FF4199] to-[#FF6B35] flex items-center justify-center mx-auto shadow-lg shadow-[#FF4199]/30">
            <Crown className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">You're Premium 🎉</h1>
          <p className="text-gray-400">
            You have an active <span className="text-[#FF4199] font-semibold">{label}</span> plan. Enjoy ad-free listening!
          </p>
          <Button className="bg-white/10 hover:bg-white/20 text-white border-0" onClick={() => setLocation("/")}>
            Back to Radio
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Hero */}
      <div className="relative overflow-hidden">
        <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-[#FF4199]/20 blur-[100px] pointer-events-none" />
        <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-[#9B59B6]/20 blur-[100px] pointer-events-none" />

        <div className="relative max-w-2xl mx-auto px-4 pt-16 pb-10 text-center">
          <div className="inline-flex items-center gap-2 bg-[#FF4199]/10 border border-[#FF4199]/30 text-[#FF4199] text-sm font-medium px-4 py-1.5 rounded-full mb-6">
            <Sparkles className="w-3.5 h-3.5" />
            MegaRadio Premium
          </div>
          <h1 className="text-4xl sm:text-5xl font-extrabold leading-tight mb-4">
            The best radio experience,{" "}
            <span className="bg-gradient-to-r from-[#FF4199] to-[#FF6B35] bg-clip-text text-transparent">
              ad-free
            </span>
          </h1>
          <p className="text-gray-400 text-lg max-w-md mx-auto">
            Enjoy crystal-clear streams, no interruptions, and all premium features across every device.
          </p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 pb-20 space-y-8">
        {/* Features grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {FEATURES.map(({ icon: Icon, text }) => (
            <div key={text} className="flex items-center gap-3 bg-white/5 rounded-xl px-4 py-3 border border-white/5">
              <div className="w-8 h-8 rounded-lg bg-[#FF4199]/15 flex items-center justify-center flex-shrink-0">
                <Icon className="w-4 h-4 text-[#FF4199]" />
              </div>
              <span className="text-sm text-gray-300">{text}</span>
            </div>
          ))}
        </div>

        {/* Plan cards */}
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-white">Choose your plan</h2>
          {plans.map(plan => {
            const badge = PLAN_BADGE[plan.planId];
            const price = fmtPrice(plan.amount, plan.currency);
            const isSelected = selectedPlan === plan.planId;
            return (
              <button
                key={plan.planId}
                onClick={() => setSelectedPlan(plan.planId)}
                className={`w-full rounded-2xl border p-4 text-left transition-all ${
                  isSelected
                    ? "border-[#FF4199] bg-[#FF4199]/10 shadow-md shadow-[#FF4199]/20"
                    : "border-white/10 bg-white/5 hover:border-white/20"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                      isSelected ? "border-[#FF4199] bg-[#FF4199]" : "border-white/30"
                    }`}>
                      {isSelected && <CheckCircle className="w-3.5 h-3.5 text-white" />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white">{plan.label}</span>
                        {badge && (
                          <Badge className="bg-[#FF4199]/20 text-[#FF4199] border-[#FF4199]/30 text-xs">
                            {badge}
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-gray-400">{plan.description}</p>
                    </div>
                  </div>
                  {price && <span className="text-lg font-bold text-white">{price}</span>}
                </div>
              </button>
            );
          })}
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-red-400 text-sm">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <Button
            className="w-full h-14 text-lg font-bold rounded-2xl bg-gradient-to-r from-[#FF4199] to-[#FF6B35] hover:opacity-90 transition-opacity border-0 text-white shadow-xl shadow-[#FF4199]/30"
            onClick={() => checkout(selectedPlan)}
            disabled={loading}
          >
            {loading
              ? <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Redirecting to payment...</>
              : user
                ? <><Sparkles className="w-5 h-5 mr-2" /> Subscribe Now</>
                : "Sign In to Subscribe"}
          </Button>
          <p className="text-center text-xs text-gray-500">
            Secure payment powered by Stripe · Cancel anytime · No hidden fees
          </p>
        </div>

        {!user && (
          <p className="text-center text-sm text-gray-500">
            Already subscribed?{" "}
            <a href="/login" className="text-[#FF4199] hover:underline">Sign in</a>
          </p>
        )}
      </div>
    </div>
  );
}
