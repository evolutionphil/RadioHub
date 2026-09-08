import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle, Crown, Sparkles, X } from "lucide-react";
import { useSubscriptionCheckout } from "@/hooks/useSubscriptionCheckout";
import { fmtPrice } from "@/lib/premium";
import { useSubscriptionPlans } from '@/hooks/useSubscriptionPlans';
import { useTranslation } from '@/hooks/useTranslation';
import { subscriptionCopy } from '@/lib/subscription-copy';

const FEATURES = [
  "MegaRadio website ads removed",
  "Linked to your MegaRadio account",
  "Stream quality depends on the station",
];

interface PaywallModalProps {
  open: boolean;
  onClose: () => void;
  /** Optional title override, e.g. "Remove Ads" */
  title?: string;
  /** Premium feature that triggered the gate, e.g. "HD streams" */
  feature?: string;
}

export function PaywallModal({ open, onClose, title = "Go Premium", feature }: PaywallModalProps) {
  const [selectedPlan, setSelectedPlan] = useState("premium_yearly");
  const { language, t } = useTranslation();
  const copy = subscriptionCopy(language);

  const { loading, error, checkout } = useSubscriptionCheckout({
    onUnauthenticated: onClose,
  });

  const catalog = useSubscriptionPlans(open);
  const plans = catalog.plans;
  useEffect(() => {
    if (plans.length && !plans.some(plan => plan.planId === selectedPlan)) setSelectedPlan(plans[0].planId);
  }, [plans, selectedPlan]);

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="p-0 max-w-md w-full border-0 bg-transparent shadow-none overflow-visible">
        <div className="relative bg-[#0a0a0a] rounded-2xl overflow-hidden border border-white/10">

          {/* Gradient header */}
          <div className="relative h-28 bg-gradient-to-br from-[#FF4199]/30 via-[#9B59B6]/20 to-transparent flex items-center justify-center">
            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#0a0a0a]" />
            <div className="relative w-12 h-12 rounded-2xl bg-gradient-to-br from-[#FF4199] to-[#FF6B35] flex items-center justify-center shadow-lg shadow-[#FF4199]/30">
              <Crown className="w-6 h-6 text-white" />
            </div>
            <button
              onClick={onClose}
              aria-label={t('close', 'Close')}
              className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
            >
              <X className="w-4 h-4 text-white" />
            </button>
          </div>

          <div className="px-5 pb-6 space-y-5 -mt-1">
            <div className="text-center">
              <DialogTitle className="text-xl font-bold text-white">{title}</DialogTitle>
              <DialogDescription className="text-sm text-gray-400 mt-1">{copy.broadcastAds}</DialogDescription>
              {feature && (
                <p className="text-sm text-gray-400 mt-1">
                  <span className="text-[#FF4199]">{feature}</span>
                </p>
              )}
            </div>

            <ul className="space-y-2">
              {FEATURES.map(f => (
                <li key={f} className="flex items-center gap-2.5 text-sm text-gray-300">
                  <CheckCircle className="w-4 h-4 text-[#FF4199] flex-shrink-0" />
                  {f}
                </li>
              ))}
            </ul>

            <div className="space-y-2">
              {plans.map(plan => {
                const badge = null;
                const price = fmtPrice(plan.amount, plan.currency, language);
                const isSelected = selectedPlan === plan.planId;
                return (
                  <button
                    key={plan.planId}
                    onClick={() => setSelectedPlan(plan.planId)}
                    className={`w-full rounded-xl border p-3.5 text-left transition-all ${
                      isSelected
                        ? "border-[#FF4199] bg-[#FF4199]/10 shadow-sm shadow-[#FF4199]/20"
                        : "border-white/10 bg-white/5 hover:border-white/20"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 transition-colors ${
                          isSelected ? "border-[#FF4199] bg-[#FF4199]" : "border-white/30"
                        }`} />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-white text-sm">{plan.label}</span>
                            {badge && (
                              <Badge className="bg-[#FF4199]/20 text-[#FF4199] border-[#FF4199]/30 text-[10px] px-1.5 py-0">
                                {badge}
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-gray-400">{plan.description}</p>
                        </div>
                      </div>
                      <span className="text-sm font-bold text-white">{price || copy.price}</span>
                    </div>
                  </button>
                );
              })}
            </div>

            {error && <p className="text-red-400 text-xs text-center">{error}</p>}
            {!catalog.isPending && !catalog.canCheckout(selectedPlan) && <p role="status" className="text-amber-400 text-sm">{copy.unavailable}</p>}

            <Button
              className="w-full h-12 text-base font-bold rounded-xl bg-gradient-to-r from-[#FF4199] to-[#FF6B35] hover:opacity-90 border-0 text-white shadow-lg shadow-[#FF4199]/30"
              onClick={() => checkout(selectedPlan)}
              disabled={loading || !catalog.canCheckout(selectedPlan)}
            >
              {loading
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Redirecting...</>
                : <><Sparkles className="w-4 h-4 mr-2" /> {copy.continuePayment}</>}
            </Button>

            <p className="text-center text-[11px] text-gray-500">
              {t('premium_secure_checkout', 'Secure checkout. Review the final price and billing terms before paying.')}
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
