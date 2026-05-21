import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Loader2, CheckCircle, XCircle, ExternalLink, CreditCard, Search } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface StripePlan {
  planId: string;
  stripePriceId: string;
  paddlePriceId?: string;
  label: string;
  description: string;
  currency: string;
  amount: number;
  isActive: boolean;
  updatedAt: string;
}

const PLAN_LABELS: Record<string, string> = {
  remove_ads:       "Remove Ads",
  premium_monthly:  "Monthly",
  premium_yearly:   "Annual",
  premium_lifetime: "Lifetime",
};

const PLAN_MODE: Record<string, string> = {
  remove_ads:       "subscription",
  premium_monthly:  "subscription",
  premium_yearly:   "subscription",
  premium_lifetime: "one-time payment",
};

const STRIPE_ENV_VAR: Record<string, string> = {
  remove_ads:       "STRIPE_PRICE_REMOVE_ADS",
  premium_monthly:  "STRIPE_PRICE_MONTHLY",
  premium_yearly:   "STRIPE_PRICE_ANNUAL",
  premium_lifetime: "STRIPE_PRICE_LIFETIME",
};

const PADDLE_ENV_VAR: Record<string, string> = {
  remove_ads:       "PADDLE_PRICE_REMOVE_ADS",
  premium_monthly:  "PADDLE_PRICE_MONTHLY",
  premium_yearly:   "PADDLE_PRICE_ANNUAL",
  premium_lifetime: "PADDLE_PRICE_LIFETIME",
};

function formatAmount(amount: number, currency: string): string {
  if (!amount) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase() || "USD",
    minimumFractionDigits: 2,
  }).format(amount / 100);
}

interface VerifyResult {
  valid: boolean;
  currency?: string;
  unitAmount?: number;
  recurring?: { interval: string; interval_count: number } | null;
  billingCycle?: { interval: string; frequency: number } | null;
  active?: boolean;
  nickname?: string | null;
  name?: string | null;
  error?: string;
}

function PlanCard({ plan }: { plan: StripePlan }) {
  // Auto-open in edit mode when neither price ID is set yet so the form is ready to fill.
  const [editing, setEditing] = useState(!plan.stripePriceId && !plan.paddlePriceId);
  const [form, setForm] = useState({
    stripePriceId: plan.stripePriceId,
    paddlePriceId: plan.paddlePriceId ?? "",
    label: plan.label,
    description: plan.description,
    currency: plan.currency,
    amount: plan.amount,
    isActive: plan.isActive,
  });
  const [stripeVerifying, setStripeVerifying] = useState(false);
  const [stripeVerifyResult, setStripeVerifyResult] = useState<VerifyResult | null>(null);
  const [paddleVerifying, setPaddleVerifying] = useState(false);
  const [paddleVerifyResult, setPaddleVerifyResult] = useState<VerifyResult | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", `/api/admin/stripe-plans/${plan.planId}`, {
        body: form,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stripe-plans"] });
      setEditing(false);
      toast({ title: "Saved", description: `${plan.planId} updated successfully` });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save plan", variant: "destructive" });
    },
  });

  async function handleStripeVerify() {
    setStripeVerifying(true);
    setStripeVerifyResult(null);
    try {
      const res = await apiRequest("POST", "/api/admin/stripe-plans/verify-price", {
        body: { priceId: form.stripePriceId },
      });
      const data: VerifyResult = await res.json();
      setStripeVerifyResult(data);
      if (data.valid && data.unitAmount !== undefined && data.currency) {
        setForm(f => ({
          ...f,
          amount: data.unitAmount ?? f.amount,
          currency: data.currency ?? f.currency,
        }));
      }
    } catch {
      setStripeVerifyResult({ valid: false, error: "Network error" });
    }
    setStripeVerifying(false);
  }

  async function handlePaddleVerify() {
    setPaddleVerifying(true);
    setPaddleVerifyResult(null);
    try {
      const res = await apiRequest("POST", "/api/admin/stripe-plans/verify-paddle-price", {
        body: { priceId: form.paddlePriceId },
      });
      const data: VerifyResult = await res.json();
      setPaddleVerifyResult(data);
    } catch {
      setPaddleVerifyResult({ valid: false, error: "Network error" });
    }
    setPaddleVerifying(false);
  }

  return (
    <Card className="border border-gray-200">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CreditCard className="w-5 h-5 text-[#FF6B35]" />
            <div>
              <CardTitle className="text-base">{PLAN_LABELS[plan.planId] || plan.planId}</CardTitle>
              <CardDescription className="text-xs">{plan.planId} · {PLAN_MODE[plan.planId]}</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {plan.isActive ? (
              <Badge className="bg-green-100 text-green-700">Active</Badge>
            ) : (
              <Badge variant="secondary">Inactive</Badge>
            )}
            <Button variant="outline" size="sm" onClick={() => { setEditing(!editing); setStripeVerifyResult(null); setPaddleVerifyResult(null); }}>
              {editing ? "Cancel" : "Edit"}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {!editing ? (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-gray-500 text-xs mb-0.5">Label shown to users</p>
              <p className="font-medium">{plan.label}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs mb-0.5">Price</p>
              <p className="font-medium">{formatAmount(plan.amount, plan.currency)}</p>
            </div>
            <div className="col-span-2">
              <p className="text-gray-500 text-xs mb-0.5">Description</p>
              <p>{plan.description}</p>
            </div>
            <div className="col-span-2">
              <p className="text-gray-500 text-xs mb-0.5">Stripe Price ID</p>
              <div className="flex items-center gap-2">
                <code className="text-xs bg-gray-100 px-2 py-1 rounded font-mono">
                  {plan.stripePriceId || <span className="text-gray-400">not set</span>}
                </code>
                {plan.stripePriceId && (
                  <a
                    href={`https://dashboard.stripe.com/prices/${plan.stripePriceId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-500 hover:text-blue-700"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
              <p className="text-gray-400 text-xs mt-0.5">Railway fallback: <code className="bg-gray-100 px-1 rounded">{STRIPE_ENV_VAR[plan.planId]}</code></p>
            </div>
            <div className="col-span-2">
              <p className="text-gray-500 text-xs mb-0.5">Paddle Price ID</p>
              <div className="flex items-center gap-2">
                <code className="text-xs bg-blue-50 px-2 py-1 rounded font-mono">
                  {plan.paddlePriceId || <span className="text-gray-400">not set</span>}
                </code>
                {plan.paddlePriceId && (
                  <a
                    href={`https://vendors.paddle.com/prices`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-500 hover:text-blue-700"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
              <p className="text-gray-400 text-xs mt-0.5">Railway fallback: <code className="bg-gray-100 px-1 rounded">{PADDLE_ENV_VAR[plan.planId]}</code></p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Label (shown to users)</Label>
                <Input
                  value={form.label}
                  onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                  placeholder="e.g. Monthly"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Currency (3-letter code)</Label>
                <Input
                  value={form.currency}
                  onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}
                  placeholder="usd / try / eur"
                  maxLength={3}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Description</Label>
              <Input
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="e.g. Billed monthly, cancel anytime"
              />
            </div>

            {/* ── Stripe Price ID ── */}
            <div className="space-y-1">
              <Label className="text-xs">Stripe Price ID</Label>
              <div className="flex gap-2">
                <Input
                  value={form.stripePriceId}
                  onChange={e => { setForm(f => ({ ...f, stripePriceId: e.target.value })); setStripeVerifyResult(null); }}
                  placeholder="price_xxx"
                  className="font-mono text-sm"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleStripeVerify}
                  disabled={stripeVerifying || !form.stripePriceId}
                  className="flex-shrink-0"
                >
                  {stripeVerifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  Verify
                </Button>
              </div>
              {stripeVerifyResult && (
                <div className={`flex items-start gap-2 text-xs mt-1 p-2 rounded ${stripeVerifyResult.valid ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                  {stripeVerifyResult.valid
                    ? <CheckCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    : <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />}
                  {stripeVerifyResult.valid ? (
                    <span>
                      Valid · {formatAmount(stripeVerifyResult.unitAmount ?? 0, stripeVerifyResult.currency ?? "usd")} {stripeVerifyResult.currency?.toUpperCase()}
                      {stripeVerifyResult.recurring ? ` / ${stripeVerifyResult.recurring.interval}` : " (one-time)"}
                      {stripeVerifyResult.nickname ? ` — "${stripeVerifyResult.nickname}"` : ""}
                      {" · amount & currency auto-filled"}
                    </span>
                  ) : (
                    <span>{stripeVerifyResult.error || "Price ID not found in Stripe"}</span>
                  )}
                </div>
              )}
            </div>

            {/* ── Paddle Price ID ── */}
            <div className="space-y-1">
              <Label className="text-xs">Paddle Price ID</Label>
              <div className="flex gap-2">
                <Input
                  value={form.paddlePriceId}
                  onChange={e => { setForm(f => ({ ...f, paddlePriceId: e.target.value })); setPaddleVerifyResult(null); }}
                  placeholder="pri_xxx"
                  className="font-mono text-sm"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePaddleVerify}
                  disabled={paddleVerifying || !form.paddlePriceId}
                  className="flex-shrink-0"
                >
                  {paddleVerifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  Verify
                </Button>
              </div>
              {paddleVerifyResult && (
                <div className={`flex items-start gap-2 text-xs mt-1 p-2 rounded ${paddleVerifyResult.valid ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                  {paddleVerifyResult.valid
                    ? <CheckCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    : <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />}
                  {paddleVerifyResult.valid ? (
                    <span>
                      Valid
                      {paddleVerifyResult.unitAmount && paddleVerifyResult.currency
                        ? ` · ${formatAmount(paddleVerifyResult.unitAmount, paddleVerifyResult.currency)} ${paddleVerifyResult.currency.toUpperCase()}`
                        : ""}
                      {paddleVerifyResult.billingCycle
                        ? ` / ${paddleVerifyResult.billingCycle.interval}`
                        : " (one-time)"}
                      {paddleVerifyResult.name ? ` — "${paddleVerifyResult.name}"` : ""}
                    </span>
                  ) : (
                    <span>{paddleVerifyResult.error || "Price ID not found in Paddle"}</span>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Amount (in smallest unit, e.g. cents)</Label>
              <Input
                type="number"
                value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: parseInt(e.target.value) || 0 }))}
                placeholder="499 = $4.99"
              />
              <p className="text-xs text-gray-400">Auto-filled when you verify the Stripe price ID above</p>
            </div>

            <div className="flex items-center gap-3">
              <Switch
                checked={form.isActive}
                onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))}
              />
              <Label className="text-sm">Active (shown to users)</Label>
            </div>

            <div className="flex gap-2 pt-1">
              <Button
                className="bg-[#FF6B35] hover:bg-[#e55a24] text-white"
                size="sm"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
              >
                {saveMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Save
              </Button>
              <Button variant="outline" size="sm" onClick={() => { setEditing(false); setStripeVerifyResult(null); setPaddleVerifyResult(null); }}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Default shape used when the DB hasn't seeded the plan yet.
// The PUT endpoint uses upsert:true so saving any of these creates the record.
const DEFAULT_PLANS: StripePlan[] = [
  { planId: "remove_ads",       label: "Remove Ads", description: "Ad-free listening, no premium extras", currency: "usd", amount: 0, isActive: true, stripePriceId: "", paddlePriceId: "", updatedAt: "" },
  { planId: "premium_monthly",  label: "Monthly",    description: "Billed monthly, cancel anytime",       currency: "usd", amount: 0, isActive: true, stripePriceId: "", paddlePriceId: "", updatedAt: "" },
  { planId: "premium_yearly",   label: "Annual",     description: "Best value — save vs monthly",         currency: "usd", amount: 0, isActive: true, stripePriceId: "", paddlePriceId: "", updatedAt: "" },
  { planId: "premium_lifetime", label: "Lifetime",   description: "One-time payment, never pay again",    currency: "usd", amount: 0, isActive: true, stripePriceId: "", paddlePriceId: "", updatedAt: "" },
];

export default function StripePlansPage() {
  const { data, isLoading } = useQuery<{ plans: StripePlan[] }>({
    queryKey: ["/api/admin/stripe-plans"],
  });

  // Always show all 4 plans. Merge DB data over defaults so missing plans
  // still show an editable card (PUT uses upsert:true — saves create the record).
  const planMap = new Map((data?.plans || []).map(p => [p.planId, p]));
  const plans = DEFAULT_PLANS.map(def => planMap.get(def.planId) ?? def);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold">Subscription Plans</h1>
        <p className="text-gray-500 mt-2">
          Manage Stripe and Paddle price IDs and display text for the TV/Web subscription flow.
          These apply to Samsung TV, LG TV, and web — not iOS/Android (those use App Store IAP).
        </p>
      </div>

      <Card className="border-blue-200 bg-blue-50">
        <CardContent className="pt-4 text-sm text-blue-800 space-y-1">
          <p><strong>How it works:</strong></p>
          <p>1. Create prices in your <a href="https://dashboard.stripe.com/prices" target="_blank" rel="noopener noreferrer" className="underline">Stripe dashboard</a> or <a href="https://vendors.paddle.com/prices" target="_blank" rel="noopener noreferrer" className="underline">Paddle dashboard</a></p>
          <p>2. Paste each price ID below and click <strong>Verify</strong> to confirm it exists</p>
          <p>3. Save · Set <code className="bg-blue-100 px-1 rounded">PAYMENT_PROVIDER=paddle</code> in Railway to switch to Paddle checkout</p>
          <p className="text-blue-600 text-xs mt-2">Tip: Both providers are stored — switching between them requires only changing the <code className="bg-blue-100 px-1 rounded">PAYMENT_PROVIDER</code> env var</p>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      ) : (
        <div className="space-y-4">
          {plans.map(plan => (
            <PlanCard key={plan.planId} plan={plan} />
          ))}
        </div>
      )}
    </div>
  );
}
