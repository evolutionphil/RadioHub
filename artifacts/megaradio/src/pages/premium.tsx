import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence, useInView, MotionConfig } from "framer-motion";
import {
  Crown, Sparkles, Check, ChevronDown, Loader2,
  Volume2, Zap, Radio, Music, Tv, Star, Shield, Wifi, Smartphone,
  Lock, BadgeCheck,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { usePremiumStatus } from "@/hooks/usePremiumStatus";
import { useSubscriptionCheckout } from "@/hooks/useSubscriptionCheckout";
import { useLocation } from "wouter";
import { useTranslation } from "@/hooks/useTranslation";
import { FALLBACK_PLANS, PLAN_LABEL, fmtPrice, type PlanInfo } from "@/lib/premium";

// ── Constants ────────────────────────────────────────────────────────────────

const PLAN_ORDER = ["premium_yearly", "premium_monthly", "premium_lifetime", "remove_ads"];
const RECOMMENDED = "premium_yearly";

const PLAN_PERIOD: Record<string, string> = {
  remove_ads:       "/mo",
  premium_monthly:  "/mo",
  premium_yearly:   "/yr",
  premium_lifetime: "",
};

const PLAN_FEATURES: Record<string, string[]> = {
  remove_ads: [
    "Ad-free on all devices",
    "iOS · Android · Web · TV",
    "Same stream quality as free",
  ],
  premium_monthly: [
    "Ad-free on all devices",
    "HD quality · highest bitrate",
    "Car Mode & stream recording",
    "iOS · Android · Web · TV",
    "Cancel anytime",
  ],
  premium_yearly: [
    "Ad-free on all devices",
    "HD quality · highest bitrate",
    "Car Mode & stream recording",
    "iOS · Android · Web · TV",
    "Save ~37% vs monthly",
    "Cancel anytime",
  ],
  premium_lifetime: [
    "Ad-free on all devices",
    "HD quality · highest bitrate",
    "Car Mode & stream recording",
    "iOS · Android · Web · TV",
    "Pay once, own forever",
    "All future features included",
  ],
};

const FAQ_ITEMS = [
  {
    q: "Can I cancel my subscription at any time?",
    a: "Yes. Monthly and annual plans can be cancelled anytime from your account settings. You keep access until the end of your billing period.",
  },
  {
    q: "What devices are supported?",
    a: "Premium works on iOS, Android, Samsung TV (Tizen), LG TV (webOS), and the web. One subscription covers every device — no separate purchases.",
  },
  {
    q: "What's the difference between Remove Ads and Premium?",
    a: "Remove Ads strips all advertising from your experience. Premium adds HD streams, Car Mode for safe driving, stream recording, and every new premium feature we ship in the future.",
  },
  {
    q: "Is Lifetime really a one-time payment?",
    a: "Yes — pay once and you're covered forever, including all future app updates and premium features we add.",
  },
  {
    q: "What payment methods are accepted?",
    a: "All major credit and debit cards. Payments are encrypted and processed securely by Paddle — we never see your card details.",
  },
];

const FEATURES = [
  { icon: Zap,     title: "Instant Ad-Free",     desc: "No pre-rolls, no banners. Music starts the moment you press play." },
  { icon: Volume2, title: "HD Quality Streams",  desc: "Always the highest available bitrate — crystal clear, zero buffering." },
  { icon: Radio,   title: "Car Mode",            desc: "Large buttons, minimal UI — safe to use while driving." },
  { icon: Music,   title: "Stream Recording",    desc: "Record your favourite stations and listen offline later." },
  { icon: Tv,      title: "All Your Devices",    desc: "Samsung TV, LG TV, iOS, Android, Web — one sub covers everything." },
  { icon: Star,    title: "Future Features",     desc: "Every new premium feature we ship is included automatically." },
];

// ── Animations ────────────────────────────────────────────────────────────────

const fadeUp = {
  hidden: { opacity: 0, y: 18 },
  show:   { opacity: 1, y: 0 },
};

const stagger = {
  show: { transition: { staggerChildren: 0.07 } },
};

// ── Sub-components ────────────────────────────────────────────────────────────

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-white/[0.07] last:border-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between py-4 sm:py-5 text-left gap-4 group"
        aria-expanded={open}
      >
        <span className="text-sm sm:text-base font-medium text-white/90 group-hover:text-white transition-colors">
          {q}
        </span>
        <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown className="w-4 h-4 text-white/30 flex-shrink-0" />
        </motion.div>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="answer"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <p className="pb-5 text-sm text-white/45 leading-relaxed">{a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface PlanCardProps {
  plan: PlanInfo;
  selected: boolean;
  recommended: boolean;
  onSelect: () => void;
}

function PlanCard({ plan, selected, recommended, onSelect }: PlanCardProps) {
  const features = PLAN_FEATURES[plan.planId] ?? [];
  const price = fmtPrice(plan.amount, plan.currency);
  const period = PLAN_PERIOD[plan.planId] ?? "";
  const isLifetime = plan.planId === "premium_lifetime";

  return (
    <motion.button
      type="button"
      onClick={onSelect}
      variants={fadeUp}
      whileHover={{ scale: 1.015 }}
      whileTap={{ scale: 0.985 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      className={[
        "relative flex flex-col text-left w-full rounded-2xl p-5 sm:p-6 border transition-colors duration-200 focus:outline-none",
        selected
          ? recommended
            ? "border-[#FF4199]/60 bg-gradient-to-b from-[#FF4199]/[0.13] to-[#FF4199]/[0.04] shadow-2xl shadow-[#FF4199]/20"
            : "border-[#FF4199]/40 bg-[#FF4199]/[0.07]"
          : "border-white/[0.07] bg-white/[0.025] hover:border-white/[0.14] hover:bg-white/[0.045]",
      ].join(" ")}
    >
      {/* Animated gradient border for recommended */}
      {recommended && (
        <div
          aria-hidden="true"
          className="absolute -inset-px rounded-2xl pointer-events-none"
          style={{
            background: "linear-gradient(135deg,#FF4199,#FF6B35)",
            WebkitMask: "linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0)",
            WebkitMaskComposite: "xor",
            maskComposite: "exclude",
            padding: "1px",
            opacity: selected ? 1 : 0.35,
            transition: "opacity 0.2s",
          }}
        />
      )}

      {/* Header row */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <span className="text-sm font-semibold text-white/60 uppercase tracking-widest">
            {plan.label}
          </span>
          {recommended && (
            <div className="mt-1.5">
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-gradient-to-r from-[#FF4199] to-[#FF6B35] text-white px-2.5 py-0.5 rounded-full">
                ⭐ Best Value
              </span>
            </div>
          )}
          {isLifetime && (
            <div className="mt-1.5">
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-white/10 text-white/70 px-2.5 py-0.5 rounded-full">
                One-Time
              </span>
            </div>
          )}
        </div>
        {/* Selection indicator */}
        <div
          className={[
            "w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-all duration-150",
            selected ? "border-[#FF4199] bg-[#FF4199]" : "border-white/20",
          ].join(" ")}
        >
          {selected && <div className="w-2 h-2 rounded-full bg-white" />}
        </div>
      </div>

      {/* Price */}
      <div className="mb-5">
        {price ? (
          <>
            <div className="flex items-end gap-1">
              <span className="text-4xl sm:text-5xl font-black tracking-tight text-white leading-none tabular-nums">
                {price}
              </span>
              {period && (
                <span className="text-white/35 text-sm mb-1">{period}</span>
              )}
            </div>
            {plan.planId === "premium_yearly" && (
              <p className="text-[#FF4199] text-xs mt-1.5 font-medium">
                ~{fmtPrice(Math.round(plan.amount / 12), plan.currency)}/mo · save 37%
              </p>
            )}
          </>
        ) : (
          <div className="h-12 flex items-center">
            <Loader2 className="w-5 h-5 text-white/20 animate-spin" />
          </div>
        )}
      </div>

      {/* Features */}
      <ul className="space-y-2.5 flex-1">
        {features.map(f => (
          <li key={f} className="flex items-center gap-2 text-sm text-white/55">
            <Check className="w-3.5 h-3.5 text-[#FF4199] flex-shrink-0" />
            {f}
          </li>
        ))}
      </ul>
    </motion.button>
  );
}

// ── Scroll-reveal wrapper ─────────────────────────────────────────────────────

function Reveal({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 24 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

// ── Already-premium screen ────────────────────────────────────────────────────

function AlreadyPremium({ plan }: { plan: string }) {
  const [, setLocation] = useLocation();
  const label = PLAN_LABEL[plan] ?? "Premium";
  return (
    <div className="min-h-screen bg-[#080808] flex items-center justify-center p-6">
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-[#FF4199]/[0.08] blur-[120px]" />
      </div>
      <motion.div
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="relative text-center space-y-6 max-w-xs"
      >
        <div className="w-20 h-20 rounded-[28px] bg-gradient-to-br from-[#FF4199] to-[#FF6B35] flex items-center justify-center mx-auto shadow-2xl shadow-[#FF4199]/40">
          <Crown className="w-10 h-10 text-white" />
        </div>
        <div>
          <h1 className="text-3xl font-extrabold text-white mb-2">You're all set 🎉</h1>
          <p className="text-white/50">
            Active <span className="text-[#FF4199] font-semibold">{label}</span> plan.
            Enjoy ad-free listening!
          </p>
        </div>
        <button
          onClick={() => setLocation("/")}
          className="w-full h-11 rounded-xl bg-white/[0.07] hover:bg-white/[0.12] border border-white/[0.08] text-white text-sm font-medium transition-colors"
        >
          Back to Radio
        </button>
      </motion.div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PremiumPage() {
  const { t } = useTranslation();
  const { user, isLoading: authLoading } = useAuth();
  const { isPremium, plan: currentPlan } = usePremiumStatus();
  const [selectedPlan, setSelectedPlan] = useState(RECOMMENDED);
  const { loading, error, checkout } = useSubscriptionCheckout();

  const { data: plansData } = useQuery<{ plans: PlanInfo[] }>({
    queryKey: ["/api/subscription/plans"],
    staleTime: 5 * 60 * 1000,
    enabled: !isPremium,
  });

  const rawPlans = plansData?.plans?.length
    ? plansData.plans.map(p => {
        if (p.amount > 0) return p;
        const fb = FALLBACK_PLANS.find(f => f.planId === p.planId);
        return fb ? { ...p, amount: fb.amount, currency: p.currency || fb.currency } : p;
      })
    : FALLBACK_PLANS;

  const plans = PLAN_ORDER
    .map(id => rawPlans.find(p => p.planId === id))
    .filter(Boolean) as PlanInfo[];

  const selectedPlanInfo = plans.find(p => p.planId === selectedPlan);

  if (!authLoading && isPremium) return <AlreadyPremium plan={currentPlan} />;
  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#080808] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#FF4199] animate-spin" />
      </div>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
    <div className="min-h-screen bg-[#080808] text-white selection:bg-[#FF4199]/30">

      {/* ── Ambient background ──────────────────────────────────────────────── */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="absolute -top-32 left-[10%] w-[800px] h-[800px] rounded-full bg-[#FF4199]/[0.055] blur-[160px]" />
        <div className="absolute top-[40%] right-[-5%] w-[600px] h-[600px] rounded-full bg-[#9B59B6]/[0.04] blur-[140px]" />
        <div className="absolute bottom-[-10%] left-[30%] w-[700px] h-[400px] rounded-full bg-[#FF6B35]/[0.04] blur-[120px]" />
      </div>

      <div className="relative">

        {/* ─────────────────────────────────────────────────────────────────── */}
        {/*  HERO + PLANS  (everything above the fold)                         */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-10 sm:pt-14 pb-6">

          {/* Badge */}
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="flex justify-center mb-5"
          >
            <span className="inline-flex items-center gap-2 bg-gradient-to-r from-[#FF4199]/15 to-[#FF6B35]/15 border border-[#FF4199]/25 text-[#FF4199] text-xs font-semibold px-4 py-1.5 rounded-full backdrop-blur-sm">
              <Crown className="w-3.5 h-3.5" />
              MegaRadio Premium
            </span>
          </motion.div>

          {/* Headline */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.05 }}
            className="text-center mb-3"
          >
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight leading-[1.1]">
              {t("premium_hero_stations", "60,000+ stations.")}{" "}
              <span
                className="bg-gradient-to-r from-[#FF4199] via-[#FF6B35] to-[#FF4199] bg-clip-text text-transparent"
                style={{ backgroundSize: "200%" }}
              >
                {t("premium_hero_zero_ads", "Zero ads.")}
              </span>
            </h1>
            <p className="text-white/45 text-base sm:text-lg mt-2.5 max-w-lg mx-auto">
              {t("premium_hero_sub", "Pick a plan and start listening ad-free in under a minute.")}
            </p>
          </motion.div>

          {/* Device strip */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="flex items-center justify-center flex-wrap gap-x-4 gap-y-1.5 mb-8 text-white/30 text-xs"
          >
            {[
              { icon: Smartphone, label: "iOS" },
              { icon: Smartphone, label: "Android" },
              { icon: Tv,         label: "Samsung TV" },
              { icon: Tv,         label: "LG TV" },
              { icon: Wifi,       label: "Web" },
            ].map(({ icon: Icon, label }, i) => (
              <span key={label} className="flex items-center gap-1">
                {i > 0 && <span className="mr-2 opacity-30">·</span>}
                <Icon className="w-3 h-3" />
                {label}
              </span>
            ))}
          </motion.div>

          {/* ── Plan cards grid ──────────────────────────────────────────────── */}
          <motion.div
            variants={stagger}
            initial="hidden"
            animate="show"
            className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4"
          >
            {plans.map(plan => (
              <PlanCard
                key={plan.planId}
                plan={plan}
                selected={selectedPlan === plan.planId}
                recommended={plan.planId === RECOMMENDED}
                onSelect={() => setSelectedPlan(plan.planId)}
              />
            ))}
          </motion.div>

          {/* ── Primary CTA ─────────────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.35 }}
            className="mt-5 max-w-md mx-auto"
          >
            <button
              onClick={() => checkout(selectedPlan)}
              disabled={loading}
              className="w-full h-14 rounded-2xl font-bold text-base text-white bg-gradient-to-r from-[#FF4199] to-[#FF6B35] hover:opacity-90 active:opacity-80 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2.5 shadow-2xl shadow-[#FF4199]/30"
            >
              {loading
                ? <><Loader2 className="w-5 h-5 animate-spin" /> Processing…</>
                : user
                  ? <><Sparkles className="w-5 h-5" /> Get {selectedPlanInfo?.label ?? "Premium"}</>
                  : t("premium_cta_signin", "Sign In to Subscribe")
              }
            </button>

            {!user && (
              <p className="text-center text-xs text-white/30 mt-3">
                {t("premium_have_account", "Already have an account?")}{" "}
                <a
                  href={`/login?returnTo=${encodeURIComponent("/premium")}`}
                  className="text-[#FF4199] hover:underline"
                >
                  {t("premium_signin", "Sign in")}
                </a>
              </p>
            )}

            {error && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="mt-3 text-center text-sm text-red-400 bg-red-500/8 border border-red-500/15 rounded-xl px-4 py-2.5"
              >
                {error}
              </motion.p>
            )}

            {/* Payment trust row — a payment page must answer "is this safe?"
                at the exact moment of commitment. All claims are true: Paddle
                is our Merchant of Record and PCI DSS Level 1 certified; card
                data never touches our servers. */}
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              {[
                { icon: Lock,       label: t("premium_trust_ssl", "SSL encrypted") },
                { icon: Shield,     label: t("premium_trust_paddle", "Secured by Paddle") },
                { icon: BadgeCheck, label: t("premium_trust_cancel", "Cancel anytime") },
              ].map(({ icon: Icon, label }) => (
                <div key={label} className="flex flex-col items-center gap-1.5 rounded-xl bg-white/[0.02] border border-white/[0.05] px-2 py-3">
                  <Icon className="w-4 h-4 text-[#FF4199]/80" />
                  <span className="text-[11px] leading-tight text-white/40">{label}</span>
                </div>
              ))}
            </div>
            <p className="text-center text-[11px] text-white/25 mt-3 leading-relaxed">
              {t("premium_legal_processor", "Payments are processed by Paddle.com as Merchant of Record — your card details never reach our servers.")}{" "}
              <a href="/terms-and-conditions" className="underline hover:text-white/50 transition-colors">{t("footer_terms", "Terms")}</a>
              {" · "}
              <a href="/privacy-policy" className="underline hover:text-white/50 transition-colors">{t("footer_privacy", "Privacy")}</a>
            </p>
          </motion.div>
        </section>

        {/* ── Social proof strip ──────────────────────────────────────────────── */}
        <Reveal delay={0.05}>
          <section className="max-w-2xl mx-auto px-4 sm:px-6 py-10">
            <div className="grid grid-cols-3 divide-x divide-white/[0.07] bg-white/[0.025] border border-white/[0.06] rounded-2xl overflow-hidden">
              {[
                { value: "60,000+", label: t("premium_stat_stations", "Stations") },
                { value: "120+",    label: t("premium_stat_countries", "Countries") },
                { value: "14",      label: t("premium_stat_languages", "Languages") },
              ].map(({ value, label }) => (
                <div key={label} className="flex flex-col items-center py-5 px-3">
                  <span className="text-2xl sm:text-3xl font-black text-white">{value}</span>
                  <span className="text-[11px] text-white/30 uppercase tracking-widest mt-1">{label}</span>
                </div>
              ))}
            </div>
          </section>
        </Reveal>

        {/* ── Feature grid ────────────────────────────────────────────────────── */}
        <Reveal>
          <section className="max-w-4xl mx-auto px-4 sm:px-6 pb-16">
            <h2 className="text-xl sm:text-2xl font-bold text-center mb-7">
              {t("premium_features_title", "Everything in")}{" "}
              <span className="bg-gradient-to-r from-[#FF4199] to-[#FF6B35] bg-clip-text text-transparent">
                Premium
              </span>
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {FEATURES.map(({ icon: Icon, title, desc }) => (
                <div
                  key={title}
                  className="flex gap-3.5 bg-white/[0.025] border border-white/[0.06] rounded-xl p-4 hover:bg-white/[0.04] transition-colors"
                >
                  <div className="w-9 h-9 rounded-lg bg-[#FF4199]/10 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-4 h-4 text-[#FF4199]" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white mb-0.5">{title}</p>
                    <p className="text-xs text-white/35 leading-relaxed">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </Reveal>

        {/* ── FAQ ─────────────────────────────────────────────────────────────── */}
        <Reveal>
          <section className="max-w-2xl mx-auto px-4 sm:px-6 pb-16">
            <h2 className="text-xl sm:text-2xl font-bold text-center mb-7">
              {t("premium_faq_title", "Common questions")}
            </h2>
            <div className="bg-white/[0.025] border border-white/[0.06] rounded-2xl px-5 sm:px-7">
              {FAQ_ITEMS.map(item => (
                <FaqItem key={item.q} q={item.q} a={item.a} />
              ))}
            </div>
          </section>
        </Reveal>

        {/* ── Bottom CTA ──────────────────────────────────────────────────────── */}
        <Reveal>
          <section className="max-w-lg mx-auto px-4 sm:px-6 pb-28 sm:pb-20">
            <div className="relative bg-gradient-to-b from-white/[0.05] to-white/[0.02] border border-white/[0.08] rounded-3xl p-8 sm:p-10 text-center overflow-hidden">
              <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
                <div className="absolute -bottom-12 left-1/2 -translate-x-1/2 w-72 h-36 bg-[#FF4199]/15 blur-[70px]" />
              </div>
              <Crown className="w-9 h-9 text-[#FF4199] mx-auto mb-4" />
              <h3 className="text-xl sm:text-2xl font-bold text-white mb-2">{t("premium_bottom_title", "Ready to go ad-free?")}</h3>
              <p className="text-white/40 text-sm mb-6">
                {t("premium_bottom_sub", "Listeners in 120+ countries already switched.")}
              </p>
              <button
                onClick={() => checkout(selectedPlan)}
                disabled={loading}
                className="w-full h-14 rounded-2xl font-bold text-base text-white bg-gradient-to-r from-[#FF4199] to-[#FF6B35] hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2 shadow-xl shadow-[#FF4199]/25"
              >
                {loading
                  ? <><Loader2 className="w-5 h-5 animate-spin" /> Processing…</>
                  : user
                    ? <><Sparkles className="w-5 h-5" /> Get {selectedPlanInfo?.label ?? "Premium"}</>
                    : t("premium_cta_signin", "Sign In to Subscribe")
                }
              </button>
            </div>
          </section>
        </Reveal>

      </div>

      {/* ── Mobile sticky bar ─────────────────────────────────────────────────── */}
      <div
        className="sm:hidden fixed bottom-0 inset-x-0 z-50 bg-[#080808]/95 backdrop-blur-xl border-t border-white/[0.07] px-4 py-3"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
      >
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-bold truncate">
              {selectedPlanInfo?.label ?? "Premium"}
            </p>
            <p className="text-white/40 text-xs">
              {fmtPrice(selectedPlanInfo?.amount ?? 0, selectedPlanInfo?.currency ?? "eur")}
              {PLAN_PERIOD[selectedPlan] ?? ""}
            </p>
          </div>
          <button
            onClick={() => checkout(selectedPlan)}
            disabled={loading}
            className="h-11 px-5 rounded-xl font-bold text-sm text-white bg-gradient-to-r from-[#FF4199] to-[#FF6B35] hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5 flex-shrink-0 transition-opacity"
          >
            {loading
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <><Sparkles className="w-4 h-4" /> Subscribe</>
            }
          </button>
        </div>
      </div>

    </div>
    </MotionConfig>
  );
}
