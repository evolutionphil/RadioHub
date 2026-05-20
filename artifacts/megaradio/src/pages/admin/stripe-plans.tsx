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
  label: string;
  description: string;
  currency: string;
  amount: number;
  isActive: boolean;
  updatedAt: string;
}

const PLAN_LABELS: Record<string, string> = {
  premium_monthly: "Monthly",
  premium_yearly: "Annual",
  premium_lifetime: "Lifetime",
};

const PLAN_MODE: Record<string, string> = {
  premium_monthly: "subscription",
  premium_yearly: "subscription",
  premium_lifetime: "one-time payment",
};

const ENV_VAR: Record<string, string> = {
  premium_monthly: "STRIPE_PRICE_MONTHLY",
  premium_yearly: "STRIPE_PRICE_ANNUAL",
  premium_lifetime: "STRIPE_PRICE_LIFETIME",
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
  active?: boolean;
  nickname?: string | null;
  error?: string;
}

function PlanCard({ plan }: { plan: StripePlan }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    stripePriceId: plan.stripePriceId,
    label: plan.label,
    description: plan.description,
    currency: plan.currency,
    amount: plan.amount,
    isActive: plan.isActive,
  });
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
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

  async function handleVerify() {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const res = await apiRequest("POST", "/api/admin/stripe-plans/verify-price", {
        body: { priceId: form.stripePriceId },
      });
      const data: VerifyResult = await res.json();
      setVerifyResult(data);
      if (data.valid && data.unitAmount !== undefined && data.currency) {
        setForm(f => ({
          ...f,
          amount: data.unitAmount ?? f.amount,
          currency: data.currency ?? f.currency,
        }));
      }
    } catch {
      setVerifyResult({ valid: false, error: "Network error" });
    }
    setVerifying(false);
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
            <Button variant="outline" size="sm" onClick={() => { setEditing(!editing); setVerifyResult(null); }}>
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
            </div>
            <div className="col-span-2">
              <p className="text-gray-500 text-xs">Railway env var: <code className="bg-gray-100 px-1 rounded">{ENV_VAR[plan.planId]}</code> (fallback if DB not set)</p>
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

            <div className="space-y-1">
              <Label className="text-xs">Stripe Price ID</Label>
              <div className="flex gap-2">
                <Input
                  value={form.stripePriceId}
                  onChange={e => { setForm(f => ({ ...f, stripePriceId: e.target.value })); setVerifyResult(null); }}
                  placeholder="price_xxx"
                  className="font-mono text-sm"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleVerify}
                  disabled={verifying || !form.stripePriceId}
                  className="flex-shrink-0"
                >
                  {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  Verify
                </Button>
              </div>
              {verifyResult && (
                <div className={`flex items-start gap-2 text-xs mt-1 p-2 rounded ${verifyResult.valid ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                  {verifyResult.valid
                    ? <CheckCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    : <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />}
                  {verifyResult.valid ? (
                    <span>
                      Valid · {formatAmount(verifyResult.unitAmount ?? 0, verifyResult.currency ?? "usd")} {verifyResult.currency?.toUpperCase()}
                      {verifyResult.recurring ? ` / ${verifyResult.recurring.interval}` : " (one-time)"}
                      {verifyResult.nickname ? ` — "${verifyResult.nickname}"` : ""}
                      {" · amount & currency auto-filled"}
                    </span>
                  ) : (
                    <span>{verifyResult.error || "Price ID not found in Stripe"}</span>
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
              <Button variant="outline" size="sm" onClick={() => { setEditing(false); setVerifyResult(null); }}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function StripePlansPage() {
  const { data, isLoading } = useQuery<{ plans: StripePlan[] }>({
    queryKey: ["/api/admin/stripe-plans"],
  });

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold">Stripe Subscription Plans</h1>
        <p className="text-gray-500 mt-2">
          Manage Stripe price IDs and display text for the TV/Web subscription flow.
          These apply to Samsung TV, LG TV, and web — not iOS/Android (those use App Store IAP).
        </p>
      </div>

      <Card className="border-blue-200 bg-blue-50">
        <CardContent className="pt-4 text-sm text-blue-800 space-y-1">
          <p><strong>How it works:</strong></p>
          <p>1. Create prices in your <a href="https://dashboard.stripe.com/prices" target="_blank" rel="noopener noreferrer" className="underline">Stripe dashboard</a></p>
          <p>2. Paste each price ID below and click <strong>Verify</strong> — amount & currency auto-fill</p>
          <p>3. Save · The TV activate page immediately uses the new prices</p>
          <p className="text-blue-600 text-xs mt-2">Tip: Create prices in TRY, EUR, USD etc. matching your App Store pricing</p>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      ) : (
        <div className="space-y-4">
          {(data?.plans || []).map(plan => (
            <PlanCard key={plan.planId} plan={plan} />
          ))}
          {(!data?.plans || data.plans.length === 0) && (
            <p className="text-gray-500 text-center py-8">No plans found. They will be auto-created on next server start.</p>
          )}
        </div>
      )}
    </div>
  );
}
