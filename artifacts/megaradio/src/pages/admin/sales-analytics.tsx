import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, TrendingUp, ShoppingCart, Smartphone, Globe, Crown, RefreshCw } from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────

interface SalesData {
  period: { from: string; to: string };
  summary: {
    totalSales: number;
    iapSales: number;
    stripeSales: number;
    stripeRevenue: number;
    stripeCurrency: string;
  };
  byPlan: Array<{ plan: string; iapCount: number; stripeCount: number; stripeAmount: number }>;
  byPlatform: Array<{ platform: string; count: number; source: string }>;
  timeline: Array<{ date: string; iapCount: number; stripeCount: number; stripeAmount: number }>;
  recentSales: Array<{
    source: "iap" | "stripe";
    platform: string;
    plan: string;
    isTrial: boolean;
    isLifetime: boolean;
    amount: number | null;
    currency: string | null;
    tvCode?: string;
    createdAt: string;
  }>;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

const PLAN_LABELS: Record<string, string> = {
  premium_monthly: "Monthly",
  premium_yearly: "Annual",
  premium_lifetime: "Lifetime",
  remove_ads: "Remove Ads",
  none: "None",
  "": "Unknown",
};

const PLATFORM_LABELS: Record<string, string> = {
  ios: "iOS",
  android: "Android",
  stripe: "Stripe (TV/Web)",
  unknown: "Unknown",
};

function fmt(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
  }).format(amount / 100);
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function toInputDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const PLATFORM_COLORS: Record<string, string> = {
  ios: "bg-blue-100 text-blue-700",
  android: "bg-green-100 text-green-700",
  stripe: "bg-purple-100 text-purple-700",
  unknown: "bg-gray-100 text-gray-500",
};

// Simple bar chart using divs
function MiniBarChart({ data, maxVal }: { data: Array<{ label: string; iap: number; stripe: number }>; maxVal: number }) {
  if (!data.length || maxVal === 0) return <p className="text-sm text-gray-400 py-4 text-center">No data for this period</p>;
  return (
    <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
      {data.map((d) => (
        <div key={d.label} className="flex items-center gap-2 text-xs">
          <span className="w-20 flex-shrink-0 text-gray-500 truncate">{d.label}</span>
          <div className="flex-1 flex gap-0.5 h-5 items-center">
            {d.iap > 0 && (
              <div
                className="h-4 bg-blue-400 rounded-sm flex items-center justify-end pr-1 text-white font-medium"
                style={{ width: `${Math.max(4, (d.iap / maxVal) * 100)}%` }}
              >
                {d.iap > 2 ? d.iap : ""}
              </div>
            )}
            {d.stripe > 0 && (
              <div
                className="h-4 bg-purple-400 rounded-sm flex items-center justify-end pr-1 text-white font-medium"
                style={{ width: `${Math.max(4, (d.stripe / maxVal) * 100)}%` }}
              >
                {d.stripe > 2 ? d.stripe : ""}
              </div>
            )}
            {d.iap === 0 && d.stripe === 0 && <div className="h-1 bg-gray-200 w-full rounded" />}
          </div>
          <span className="w-8 text-right text-gray-600 font-medium">{d.iap + d.stripe}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────

export default function SalesAnalyticsPage() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [from, setFrom] = useState(toInputDate(thirtyDaysAgo));
  const [to, setTo] = useState(toInputDate(new Date()));
  const [platform, setPlatform] = useState("all");
  const [plan, setPlan] = useState("all");
  const [groupBy, setGroupBy] = useState("day");

  const params = new URLSearchParams({ from, to, platform, plan, groupBy }).toString();

  const { data, isLoading, isFetching, refetch } = useQuery<SalesData>({
    queryKey: ["/api/admin/sales", params],
    queryFn: async () => {
      const res = await fetch(`/api/admin/sales?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch sales data");
      return res.json();
    },
    staleTime: 60_000,
  });

  function quickRange(days: number) {
    setFrom(toInputDate(new Date(Date.now() - days * 24 * 60 * 60 * 1000)));
    setTo(toInputDate(new Date()));
  }

  const totalSales = data?.summary.totalSales ?? 0;
  const iapSales = data?.summary.iapSales ?? 0;
  const stripeSales = data?.summary.stripeSales ?? 0;
  const stripeRevenue = data?.summary.stripeRevenue ?? 0;
  const stripeCurrency = data?.summary.stripeCurrency ?? "usd";

  const timelineMax = Math.max(1, ...((data?.timeline ?? []).map(d => d.iapCount + d.stripeCount)));
  const timelineChartData = (data?.timeline ?? []).map(d => ({
    label: d.date,
    iap: d.iapCount,
    stripe: d.stripeCount,
  }));

  const planMax = Math.max(1, ...((data?.byPlan ?? []).map(p => p.iapCount + p.stripeCount)));
  const planChartData = (data?.byPlan ?? []).map(p => ({
    label: PLAN_LABELS[p.plan] || p.plan,
    iap: p.iapCount,
    stripe: p.stripeCount,
  }));

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold">Sales Analytics</h1>
          <p className="text-gray-500 mt-1">iOS, Android IAP + Stripe (TV/Web) combined</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <RefreshCw className="w-4 h-4 mr-1" />}
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 items-end">
            <div className="space-y-1">
              <Label className="text-xs">From</Label>
              <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">To</Label>
              <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Platform</Label>
              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All platforms</SelectItem>
                  <SelectItem value="ios">iOS</SelectItem>
                  <SelectItem value="android">Android</SelectItem>
                  <SelectItem value="stripe">Stripe (TV/Web)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Plan</Label>
              <Select value={plan} onValueChange={setPlan}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All plans</SelectItem>
                  <SelectItem value="premium_monthly">Monthly</SelectItem>
                  <SelectItem value="premium_yearly">Annual</SelectItem>
                  <SelectItem value="premium_lifetime">Lifetime</SelectItem>
                  <SelectItem value="remove_ads">Remove Ads</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Group by</Label>
              <Select value={groupBy} onValueChange={setGroupBy}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">Day</SelectItem>
                  <SelectItem value="week">Week</SelectItem>
                  <SelectItem value="month">Month</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" onClick={() => quickRange(7)} className="flex-1 text-xs">7d</Button>
              <Button variant="outline" size="sm" onClick={() => quickRange(30)} className="flex-1 text-xs">30d</Button>
              <Button variant="outline" size="sm" onClick={() => quickRange(90)} className="flex-1 text-xs">90d</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1"><ShoppingCart className="w-4 h-4" /> Total Sales</CardDescription>
                <CardTitle className="text-3xl">{totalSales}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-gray-500">iOS + Android + Stripe</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1"><Smartphone className="w-4 h-4" /> IAP Sales</CardDescription>
                <CardTitle className="text-3xl">{iapSales}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-gray-500">via App Store / Play Store</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1"><Globe className="w-4 h-4" /> Stripe Sales</CardDescription>
                <CardTitle className="text-3xl">{stripeSales}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-gray-500">via TV/Web Stripe Checkout</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1"><TrendingUp className="w-4 h-4" /> Stripe Revenue</CardDescription>
                <CardTitle className="text-2xl">{stripeRevenue > 0 ? fmt(stripeRevenue, stripeCurrency) : "—"}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-gray-500">Gross (before Stripe fees)</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Timeline chart */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Sales over time</CardTitle>
                <CardDescription>
                  <span className="inline-block w-3 h-3 bg-blue-400 rounded-sm mr-1" />iOS/Android IAP
                  <span className="inline-block w-3 h-3 bg-purple-400 rounded-sm ml-3 mr-1" />Stripe
                </CardDescription>
              </CardHeader>
              <CardContent>
                <MiniBarChart data={timelineChartData} maxVal={timelineMax} />
              </CardContent>
            </Card>

            {/* By plan */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">By plan</CardTitle>
                <CardDescription>
                  <span className="inline-block w-3 h-3 bg-blue-400 rounded-sm mr-1" />IAP
                  <span className="inline-block w-3 h-3 bg-purple-400 rounded-sm ml-3 mr-1" />Stripe
                </CardDescription>
              </CardHeader>
              <CardContent>
                <MiniBarChart data={planChartData} maxVal={planMax} />
                {data?.byPlan && data.byPlan.length > 0 && (
                  <div className="mt-3 border-t pt-3 space-y-1">
                    {data.byPlan.map(p => (
                      <div key={p.plan} className="flex items-center justify-between text-xs">
                        <span className="text-gray-600">{PLAN_LABELS[p.plan] || p.plan}</span>
                        <div className="flex items-center gap-3">
                          {p.stripeAmount > 0 && (
                            <span className="text-purple-600 font-medium">{fmt(p.stripeAmount, stripeCurrency)}</span>
                          )}
                          <span className="font-medium">{p.iapCount + p.stripeCount} sales</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* By platform */}
          {data?.byPlatform && data.byPlatform.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">By platform</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-3">
                  {data.byPlatform.map(p => (
                    <div key={p.platform} className="flex items-center gap-2 border rounded-lg px-4 py-3">
                      <Badge className={PLATFORM_COLORS[p.platform] || "bg-gray-100 text-gray-600"}>
                        {PLATFORM_LABELS[p.platform] || p.platform}
                      </Badge>
                      <span className="text-2xl font-bold">{p.count}</span>
                      <span className="text-sm text-gray-500">sales</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Recent transactions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent Transactions</CardTitle>
              <CardDescription>Last 50 successful sales across all platforms</CardDescription>
            </CardHeader>
            <CardContent>
              {(!data?.recentSales || data.recentSales.length === 0) ? (
                <p className="text-gray-400 text-sm text-center py-6">No sales in this period</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-gray-500">
                        <th className="pb-2 pr-4">Date</th>
                        <th className="pb-2 pr-4">Platform</th>
                        <th className="pb-2 pr-4">Plan</th>
                        <th className="pb-2 pr-4">Amount</th>
                        <th className="pb-2">Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recentSales.map((s, i) => (
                        <tr key={i} className="border-b last:border-0 hover:bg-gray-50">
                          <td className="py-2 pr-4 text-xs text-gray-500 whitespace-nowrap">{fmtDate(s.createdAt)}</td>
                          <td className="py-2 pr-4">
                            <Badge className={`text-xs ${PLATFORM_COLORS[s.platform] || "bg-gray-100 text-gray-600"}`}>
                              {PLATFORM_LABELS[s.platform] || s.platform}
                            </Badge>
                          </td>
                          <td className="py-2 pr-4">
                            <div className="flex items-center gap-1">
                              {(s.isLifetime || s.plan === "premium_lifetime") && <Crown className="w-3 h-3 text-yellow-500" />}
                              <span>{PLAN_LABELS[s.plan] || s.plan}</span>
                              {s.isTrial && <Badge variant="secondary" className="text-xs ml-1">Trial</Badge>}
                            </div>
                          </td>
                          <td className="py-2 pr-4 font-medium">
                            {s.amount !== null && s.currency
                              ? fmt(s.amount, s.currency)
                              : <span className="text-gray-400 text-xs">IAP</span>}
                          </td>
                          <td className="py-2 text-xs text-gray-400">
                            {s.tvCode ? `TV code: ${s.tvCode}` : ""}
                            {s.source === "iap" ? `${s.platform}` : ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
