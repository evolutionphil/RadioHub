import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, Crown, Sparkles, Zap, Radio, Tv, Smartphone,
  Music, Shield, Star, Check, X, ChevronDown, Wifi, Volume2,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { usePremiumStatus } from "@/hooks/usePremiumStatus";
import { useSubscriptionCheckout } from "@/hooks/useSubscriptionCheckout";
import { useLocation } from "wouter";
import { FALLBACK_PLANS, PLAN_LABEL, fmtPrice, type PlanInfo } from "@/lib/premium";

// ─── Per-plan feature matrix ────────────────────────────────────────────────

const PLAN_FEATURES: Record<string, string[]> = {
  remove_ads: [
    "Ad-free listening",
    "All devices (iOS, Android, Web, TV)",
    "Same stream quality as free tier",
  ],
  premium_monthly: [
    "Ad-free listening",
    "All devices (iOS, Android, Web, TV)",
    "HD quality & highest bitrate",
    "Car Mode for distraction-free driving",
    "Stream recording",
    "Cancel anytime",
  ],
  premium_yearly: [
    "Ad-free listening",
    "All devices (iOS, Android, Web, TV)",
    "HD quality & highest bitrate",
    "Car Mode for distraction-free driving",
    "Stream recording",
    "Save ~37% vs monthly billing",
    "Cancel anytime",
  ],
  premium_lifetime: [
    "Ad-free listening",
    "All devices (iOS, Android, Web, TV)",
    "HD quality & highest bitrate",
    "Car Mode for distraction-free driving",
    "Stream recording",
    "One-time payment",
    "All future updates included",
  ],
};

const PLAN_ORDER = ["premium_yearly", "premium_monthly", "premium_lifetime", "remove_ads"];

const PLAN_RECOMMENDED = "premium_yearly";

// ─── FAQ data ────────────────────────────────────────────────────────────────

const FAQ = [
  {
    q: "Can I cancel my subscription at any time?",
    a: "Yes. Monthly and annual plans can be cancelled anytime from your account settings. You keep access until the end of your billing period.",
  },
  {
    q: "What devices does MegaRadio Premium work on?",
    a: "Premium works across all our apps: iOS, Android, Samsung TV (Tizen), LG TV (webOS), and the web browser. One subscription covers every device.",
  },
  {
    q: "What's the difference between Remove Ads and Premium?",
    a: "Remove Ads removes advertising but keeps the same stream quality as the free tier. Premium adds HD streams, Car Mode, stream recording, and all future premium features.",
  },
  {
    q: "Is the Lifetime plan really a one-time payment?",
    a: "Yes — pay once and you're covered forever, including all future app updates and new premium features we add.",
  },
  {
    q: "What payment methods are accepted?",
    a: "We accept all major credit and debit cards via Stripe. Payments are encrypted and processed securely — we never see your card details.",
  },
];

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatPill({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-xl sm:text-2xl font-extrabold text-white">{value}</span>
      <span className="text-xs text-gray-500 uppercase tracking-widest">{label}</span>
    </div>
  );
}

function DevicePill({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-gray-400 text-sm">
      <Icon className="w-3.5 h-3.5" />
      <span>{label}</span>
    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-white/8 last:border-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between py-4 text-left gap-4 group"
      >
        <span className="text-sm sm:text-base font-medium text-white group-hover:text-[#FF4199] transition-colors">
          {q}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-gray-500 flex-shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div
        className={`overflow-hidden transition-all duration-200 ${open ? "max-h-48 pb-4" : "max-h-0"}`}
      >
        <p className="text-sm text-gray-400 leading-relaxed">{a}</p>
      </div>
    </div>
  );
}

interface PlanCardProps {
  plan: PlanInfo;
  selected: boolean;
  recommended: boolean;
  loading: boolean;
  onSelect: () => void;
  onCheckout: () => void;
}

function PlanCard({ plan, selected, recommended, loading, onSelect, onCheckout }: PlanCardProps) {
  const features = PLAN_FEATURES[plan.planId] ?? [];
  const price = fmtPrice(plan.amount, plan.currency);
  const isLifetime = plan.planId === "premium_lifetime";
  const isRemoveAds = plan.planId === "remove_ads";
  const period = isLifetime ? "one-time" : isRemoveAds ? "/month" : plan.planId === "premium_yearly" ? "/year" : "/month";

  return (
    <div
      onClick={onSelect}
      className={`relative flex flex-col rounded-2xl border p-5 cursor-pointer transition-all duration-200 ${
        selected
          ? recommended
            ? "border-[#FF4199] bg-gradient-to-b from-[#FF4199]/12 to-[#FF4199]/4 shadow-xl shadow-[#FF4199]/20"
            : "border-[#FF4199]/70 bg-[#FF4199]/8"
          : "border-white/8 bg-white/[0.03] hover:border-white/16 hover:bg-white/[0.05]"
      }`}
    >
      {/* Recommended glow ring */}
      {recommended && (
        <div className="absolute -inset-px rounded-2xl pointer-events-none" style={{
          background: "linear-gradient(135deg, #FF4199, #FF6B35)",
          WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
          WebkitMaskComposite: "xor",
          maskComposite: "exclude",
          padding: "1px",
          opacity: selected ? 1 : 0.4,
        }} />
      )}

      {/* Badge row */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <span className="text-base font-bold text-white">{plan.label}</span>
          {recommended && (
            <div className="mt-1">
              <Badge className="bg-gradient-to-r from-[#FF4199] to-[#FF6B35] text-white border-0 text-[10px] font-semibold px-2 py-0.5">
                ⭐ Best Value
              </Badge>
            </div>
          )}
        </div>
        {/* Radio button */}
        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors ${
          selected ? "border-[#FF4199] bg-[#FF4199]" : "border-white/20"
        }`}>
          {selected && <div className="w-2 h-2 rounded-full bg-white" />}
        </div>
      </div>

      {/* Price */}
      {price ? (
        <div className="mb-3">
          <span className={`text-3xl font-extrabold ${
            recommended ? "text-white" : "text-white"
          }`}>
            {price}
          </span>
          <span className="text-gray-500 text-sm ml-1">{period}</span>
          {plan.planId === "premium_yearly" && (
            <p className="text-[#FF4199] text-xs mt-0.5 font-medium">
              ~{fmtPrice(Math.round(plan.amount / 12), plan.currency)}/mo — save 37%
            </p>
          )}
        </div>
      ) : (
        <div className="mb-3 h-9 flex items-center">
          <Loader2 className="w-4 h-4 text-gray-600 animate-spin" />
        </div>
      )}

      {/* Description */}
      <p className="text-xs text-gray-500 mb-4 leading-relaxed">{plan.description}</p>

      {/* Feature list */}
      <ul className="space-y-2 flex-1">
        {features.map(f => (
          <li key={f} className="flex items-start gap-2 text-sm text-gray-300">
            <Check className="w-3.5 h-3.5 text-[#FF4199] flex-shrink-0 mt-0.5" />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      {/* CTA */}
      {selected && (
        <button
          onClick={e => { e.stopPropagation(); onCheckout(); }}
          disabled={loading}
          className="mt-5 w-full h-11 rounded-xl font-bold text-sm text-white bg-gradient-to-r from-[#FF4199] to-[#FF6B35] hover:opacity-90 transition-opacity disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {loading
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Redirecting...</>
            : <><Sparkles className="w-4 h-4" /> Get {plan.label}</>
          }
        </button>
      )}
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function PremiumPage() {
  const { user, isLoading: authLoading } = useAuth();
  const { isPremium, plan: currentPlan } = usePremiumStatus();
  const [, setLocation] = useLocation();
  const [selectedPlan, setSelectedPlan] = useState(PLAN_RECOMMENDED);

  const { loading, error, checkout } = useSubscriptionCheckout();

  const { data: plansData } = useQuery<{ plans: PlanInfo[] }>({
    queryKey: ["/api/subscription/plans"],
    staleTime: 5 * 60 * 1000,
    enabled: !isPremium,
  });

  const rawPlans = plansData?.plans?.length ? plansData.plans : FALLBACK_PLANS;
  // Sort plans into our preferred display order
  const plans = PLAN_ORDER
    .map(id => rawPlans.find(p => p.planId === id))
    .filter(Boolean) as PlanInfo[];

  // ── Already premium ──
  if (!authLoading && isPremium) {
    const label = PLAN_LABEL[currentPlan] ?? "Premium";
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4">
        {/* Background glow */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[500px] h-[500px] rounded-full bg-[#FF4199]/10 blur-[120px]" />
        </div>
        <div className="relative text-center space-y-5 max-w-sm">
          <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-[#FF4199] to-[#FF6B35] flex items-center justify-center mx-auto shadow-2xl shadow-[#FF4199]/40">
            <Crown className="w-10 h-10 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold text-white mb-2">You're all set 🎉</h1>
            <p className="text-gray-400">
              Active <span className="text-[#FF4199] font-semibold">{label}</span> plan.{" "}
              Enjoy ad-free listening!
            </p>
          </div>
          <Button
            className="bg-white/8 hover:bg-white/14 text-white border border-white/10 rounded-xl"
            onClick={() => setLocation("/")}
          >
            Back to Radio
          </Button>
        </div>
      </div>
    );
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#FF4199] animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white selection:bg-[#FF4199]/30">

      {/* ── Ambient background (depth 0-1) ──────────────────────────────────── */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="absolute -top-40 -left-40 w-[700px] h-[700px] rounded-full bg-[#FF4199]/[0.07] blur-[140px]" />
        <div className="absolute top-1/3 -right-40 w-[500px] h-[500px] rounded-full bg-[#9B59B6]/[0.06] blur-[120px]" />
        <div className="absolute bottom-0 left-1/3 w-[600px] h-[400px] rounded-full bg-[#FF6B35]/[0.05] blur-[100px]" />
      </div>

      <div className="relative">

        {/* ── Hero ────────────────────────────────────────────────────────────── */}
        <section className="max-w-3xl mx-auto px-4 pt-16 pb-10 text-center">

          {/* Pill badge */}
          <div className="inline-flex items-center gap-2 bg-gradient-to-r from-[#FF4199]/15 to-[#FF6B35]/15 border border-[#FF4199]/25 text-[#FF4199] text-xs font-semibold px-4 py-1.5 rounded-full mb-7 backdrop-blur-sm">
            <Crown className="w-3.5 h-3.5" />
            MegaRadio Premium
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold leading-[1.08] mb-5 tracking-tight">
            25,000+ stations.{" "}
            <br className="hidden sm:block" />
            <span className="bg-gradient-to-r from-[#FF4199] via-[#FF6B35] to-[#FF4199] bg-clip-text text-transparent bg-[length:200%] animate-[shimmer_4s_linear_infinite]">
              Zero ads.
            </span>
          </h1>

          <p className="text-gray-400 text-lg sm:text-xl max-w-xl mx-auto leading-relaxed mb-8">
            Crystal-clear streams, every device, all the features you actually want.
            One subscription, no compromises.
          </p>

          {/* Device strip */}
          <div className="flex items-center justify-center flex-wrap gap-x-5 gap-y-2">
            <DevicePill icon={Smartphone} label="iOS" />
            <span className="text-white/10 text-sm">·</span>
            <DevicePill icon={Smartphone} label="Android" />
            <span className="text-white/10 text-sm">·</span>
            <DevicePill icon={Tv} label="Samsung TV" />
            <span className="text-white/10 text-sm">·</span>
            <DevicePill icon={Tv} label="LG TV" />
            <span className="text-white/10 text-sm">·</span>
            <DevicePill icon={Wifi} label="Web" />
          </div>
        </section>

        {/* ── Trust stats ─────────────────────────────────────────────────────── */}
        <section className="max-w-2xl mx-auto px-4 mb-12">
          <div className="flex items-center justify-center gap-8 sm:gap-12 bg-white/[0.03] border border-white/6 rounded-2xl py-5 px-6 backdrop-blur-sm">
            <StatPill value="500K+" label="Listeners" />
            <div className="w-px h-8 bg-white/8" aria-hidden="true" />
            <StatPill value="25K+" label="Stations" />
            <div className="w-px h-8 bg-white/8" aria-hidden="true" />
            <StatPill value="4.8★" label="App Rating" />
            <div className="w-px h-8 bg-white/8 hidden sm:block" aria-hidden="true" />
            <div className="hidden sm:block">
              <StatPill value="100%" label="Legal" />
            </div>
          </div>
        </section>

        {/* ── Plan cards ──────────────────────────────────────────────────────── */}
        <section className="max-w-5xl mx-auto px-4 mb-14">
          <div className="text-center mb-8">
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-2">
              Pick your plan
            </h2>
            <p className="text-gray-500 text-sm">Start listening ad-free in seconds</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {plans.map(plan => (
              <PlanCard
                key={plan.planId}
                plan={plan}
                selected={selectedPlan === plan.planId}
                recommended={plan.planId === PLAN_RECOMMENDED}
                loading={loading && selectedPlan === plan.planId}
                onSelect={() => setSelectedPlan(plan.planId)}
                onCheckout={() => checkout(plan.planId)}
              />
            ))}
          </div>

          {/* Error */}
          {error && (
            <div className="mt-4 bg-red-500/8 border border-red-500/20 rounded-xl p-3 text-red-400 text-sm text-center">
              {error}
            </div>
          )}

          {/* Trust footnote */}
          <p className="text-center text-xs text-gray-600 mt-5">
            <Shield className="w-3 h-3 inline mr-1 opacity-60" />
            Secure payment powered by Stripe · SSL encrypted · Cancel anytime
          </p>
        </section>

        {/* ── Feature highlights ──────────────────────────────────────────────── */}
        <section className="max-w-3xl mx-auto px-4 mb-14">
          <h2 className="text-xl sm:text-2xl font-bold text-center mb-7">
            Everything in{" "}
            <span className="bg-gradient-to-r from-[#FF4199] to-[#FF6B35] bg-clip-text text-transparent">
              Premium
            </span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[
              { icon: Volume2,   title: "HD Quality Streams",        desc: "Always the highest available bitrate, no buffering or quality drops." },
              { icon: Zap,       title: "Instant Ad-Free Listening", desc: "No pre-rolls, no mid-rolls, no banners. Music starts immediately." },
              { icon: Radio,     title: "Car Mode",                  desc: "Large buttons, simple UI — safe to use while driving." },
              { icon: Music,     title: "Stream Recording",          desc: "Record your favourite stations and listen offline later." },
              { icon: Tv,        title: "TV & Mobile Apps",          desc: "Samsung TV, LG TV, iOS, Android — one sub covers everything." },
              { icon: Star,      title: "Future Features",           desc: "Every new premium feature we ship is included, automatically." },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex gap-3 bg-white/[0.03] border border-white/6 rounded-xl p-4 hover:bg-white/[0.05] transition-colors">
                <div className="w-9 h-9 rounded-lg bg-[#FF4199]/12 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-4 h-4 text-[#FF4199]" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white mb-0.5">{title}</p>
                  <p className="text-xs text-gray-500 leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── FAQ ─────────────────────────────────────────────────────────────── */}
        <section className="max-w-2xl mx-auto px-4 mb-14">
          <h2 className="text-xl sm:text-2xl font-bold text-center mb-7">
            Common questions
          </h2>
          <div className="bg-white/[0.03] border border-white/6 rounded-2xl px-5">
            {FAQ.map(item => (
              <FaqItem key={item.q} q={item.q} a={item.a} />
            ))}
          </div>
        </section>

        {/* ── Bottom CTA ──────────────────────────────────────────────────────── */}
        <section className="max-w-xl mx-auto px-4 pb-24 text-center">
          <div className="relative bg-gradient-to-b from-white/[0.05] to-white/[0.02] border border-white/8 rounded-3xl p-8">
            {/* Glow */}
            <div className="absolute inset-0 rounded-3xl overflow-hidden pointer-events-none" aria-hidden="true">
              <div className="absolute -bottom-16 left-1/2 -translate-x-1/2 w-64 h-32 bg-[#FF4199]/15 blur-[60px]" />
            </div>
            <Crown className="w-8 h-8 text-[#FF4199] mx-auto mb-3" />
            <h3 className="text-xl font-bold text-white mb-2">Ready to go ad-free?</h3>
            <p className="text-gray-500 text-sm mb-5">
              Join 500,000+ listeners who already switched.
            </p>
            <button
              onClick={() => checkout(selectedPlan)}
              disabled={loading}
              className="w-full h-13 rounded-2xl font-bold text-base text-white bg-gradient-to-r from-[#FF4199] to-[#FF6B35] hover:opacity-90 transition-opacity disabled:opacity-60 flex items-center justify-center gap-2 shadow-xl shadow-[#FF4199]/25"
            >
              {loading
                ? <><Loader2 className="w-5 h-5 animate-spin" /> Redirecting to payment...</>
                : user
                  ? <><Sparkles className="w-5 h-5" /> Get {PLAN_LABEL[selectedPlan] ?? "Premium"}</>
                  : "Sign In to Subscribe"
              }
            </button>
            {!user && (
              <p className="mt-4 text-xs text-gray-600">
                Already have an account?{" "}
                <a href="/login" className="text-[#FF4199] hover:underline">Sign in</a>
              </p>
            )}
          </div>
        </section>

      </div>

      {/* ── Mobile sticky bottom bar ─────────────────────────────────────────── */}
      <div className="sm:hidden fixed bottom-0 inset-x-0 z-50 bg-[#0a0a0a]/95 backdrop-blur-md border-t border-white/8 p-3 pb-[calc(env(safe-area-inset-bottom)+12px)]">
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-semibold truncate">
              {plans.find(p => p.planId === selectedPlan)?.label ?? "Premium"}
            </p>
            <p className="text-gray-500 text-xs">
              {fmtPrice(
                plans.find(p => p.planId === selectedPlan)?.amount ?? 0,
                plans.find(p => p.planId === selectedPlan)?.currency ?? "eur",
              )}
              {selectedPlan === "premium_yearly" ? "/year" : selectedPlan === "premium_lifetime" ? " one-time" : "/mo"}
            </p>
          </div>
          <button
            onClick={() => checkout(selectedPlan)}
            disabled={loading}
            className="h-11 px-5 rounded-xl font-bold text-sm text-white bg-gradient-to-r from-[#FF4199] to-[#FF6B35] hover:opacity-90 transition-opacity disabled:opacity-60 flex items-center gap-1.5 flex-shrink-0"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Sparkles className="w-4 h-4" /> Subscribe</>}
          </button>
        </div>
      </div>

    </div>
  );
}
