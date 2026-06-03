import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Loader2,
  RefreshCw,
  Users,
  KeyRound,
  Activity,
  Search,
  ShieldCheck,
  Ban,
  Zap,
} from "lucide-react";

// Admin visibility + management for the public Developer API program.
// Answers: who registered, what plan, and how many requests each key made.

interface StatsResponse {
  totalDevelopers: number;
  totalKeys: number;
  activeKeys: number;
  activeDemoKeys: number;
  byPlan: Record<string, number>;
  requests: { today: number; month: number; total: number };
  planLimits: Record<string, { rateLimitPerMin: number; dailyQuota: number; monthlyQuota: number }>;
}

interface DeveloperRow {
  _id: string;
  email: string;
  name: string;
  company?: string;
  website?: string;
  plan: string;
  status: string;
  createdAt: string;
  lastLoginAt?: string | null;
  keyCount: number;
  activeKeys: number;
  usage: { today: number; month: number; total: number };
  lastUsedAt?: string | null;
}

interface ApiKeyRow {
  _id: string;
  keyPrefix: string;
  name: string;
  email: string;
  appName?: string;
  plan: string;
  status: string;
  rateLimitPerMin: number;
  dailyQuota: number;
  monthlyQuota: number;
  usage: { todayCount: number; monthCount: number; totalCount: number; lastUsedAt?: string | null };
  createdAt: string;
  expiresAt?: string | null;
}

function fmtNum(n?: number) {
  return (n ?? 0).toLocaleString();
}

function fmtDate(s?: string | null) {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

function fmtDateTime(s?: string | null) {
  if (!s) return "Never";
  const d = new Date(s);
  return isNaN(d.getTime()) ? "Never" : d.toLocaleString();
}

const PLAN_BADGE: Record<string, string> = {
  demo: "bg-gray-100 text-gray-700 border-gray-300",
  free: "bg-emerald-100 text-emerald-800 border-emerald-300",
  pro: "bg-blue-100 text-blue-800 border-blue-300",
};

const STATUS_BADGE: Record<string, string> = {
  active: "bg-green-100 text-green-800 border-green-300",
  revoked: "bg-red-100 text-red-800 border-red-300",
  suspended: "bg-amber-100 text-amber-800 border-amber-300",
  expired: "bg-gray-200 text-gray-700 border-gray-300",
};

function StatCard({ icon: Icon, label, value, sub }: { icon: any; label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-pink-50 flex items-center justify-center shrink-0">
          <Icon className="w-5 h-5 text-pink-600" />
        </div>
        <div className="min-w-0">
          <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
          <div className="text-xl font-bold text-gray-900 leading-tight">{value}</div>
          {sub && <div className="text-[11px] text-gray-400">{sub}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminApiKeys() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"developers" | "keys">("developers");

  // Developers tab
  const [devSearch, setDevSearch] = useState("");
  const [devApplied, setDevApplied] = useState("");
  const [devPage, setDevPage] = useState(1);

  // Keys tab
  const [keySearch, setKeySearch] = useState("");
  const [keyApplied, setKeyApplied] = useState("");
  const [keyPlan, setKeyPlan] = useState("");
  const [keyStatus, setKeyStatus] = useState("");
  const [keyPage, setKeyPage] = useState(1);

  const { data: stats } = useQuery<StatsResponse>({
    queryKey: ["/api/admin/api-keys/stats"],
    queryFn: async () => {
      const res = await fetch("/api/admin/api-keys/stats", { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });

  const devQs = new URLSearchParams({ page: String(devPage), limit: "25", search: devApplied }).toString();
  const { data: devData, isLoading: devLoading, isFetching: devFetching, refetch: refetchDevs } = useQuery<{
    users: DeveloperRow[];
    totalCount: number;
    pages: number;
  }>({
    queryKey: ["/api/admin/api-keys/users", devQs],
    queryFn: async () => {
      const res = await fetch(`/api/admin/api-keys/users?${devQs}`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    enabled: tab === "developers",
  });

  const keyQs = new URLSearchParams({
    page: String(keyPage),
    limit: "25",
    search: keyApplied,
    plan: keyPlan,
    status: keyStatus,
  }).toString();
  const { data: keyData, isLoading: keyLoading, isFetching: keyFetching, refetch: refetchKeys } = useQuery<{
    keys: ApiKeyRow[];
    totalCount: number;
    pages: number;
  }>({
    queryKey: ["/api/admin/api-keys/keys", keyQs],
    queryFn: async () => {
      const res = await fetch(`/api/admin/api-keys/keys?${keyQs}`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    enabled: tab === "keys",
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await fetch(`/api/admin/api-keys/keys/${id}/status`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/api-keys/keys", keyQs] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/api-keys/stats"] });
    },
  });

  const planMutation = useMutation({
    mutationFn: async ({ id, plan }: { id: string; plan: string }) => {
      const res = await fetch(`/api/admin/api-keys/keys/${id}/plan`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/api-keys/keys", keyQs] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/api-keys/stats"] });
    },
  });

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Developer API</h1>
          <p className="text-sm text-gray-500">Registered developers, issued keys, and live usage.</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => (tab === "developers" ? refetchDevs() : refetchKeys())}
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={Users} label="Developers" value={fmtNum(stats?.totalDevelopers)} sub="registered accounts" />
        <StatCard
          icon={KeyRound}
          label="Active Keys"
          value={fmtNum(stats?.activeKeys)}
          sub={`${fmtNum(stats?.totalKeys)} total · ${fmtNum(stats?.activeDemoKeys)} demo`}
        />
        <StatCard icon={Activity} label="Requests Today" value={fmtNum(stats?.requests.today)} sub={`${fmtNum(stats?.requests.month)} this month`} />
        <StatCard icon={Zap} label="All-Time Requests" value={fmtNum(stats?.requests.total)} sub={`Free ${fmtNum(stats?.byPlan.free)} · Pro ${fmtNum(stats?.byPlan.pro)}`} />
      </div>

      {/* Plan limits reference */}
      {stats?.planLimits && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-700">Rate Limit Tiers</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {(["demo", "free", "pro"] as const).map((p) => {
                const l = stats.planLimits[p];
                if (!l) return null;
                return (
                  <div key={p} className="rounded-lg border border-gray-200 p-3">
                    <Badge variant="outline" className={PLAN_BADGE[p]}>{p.toUpperCase()}</Badge>
                    <div className="mt-2 text-sm text-gray-700 space-y-0.5">
                      <div>{l.rateLimitPerMin.toLocaleString()} req / min</div>
                      <div>{l.dailyQuota.toLocaleString()} / day</div>
                      <div>{l.monthlyQuota.toLocaleString()} / month</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-200">
        <button
          onClick={() => setTab("developers")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === "developers" ? "border-pink-600 text-pink-600" : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Developers
        </button>
        <button
          onClick={() => setTab("keys")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === "keys" ? "border-pink-600 text-pink-600" : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          API Keys
        </button>
      </div>

      {/* Developers tab */}
      {tab === "developers" && (
        <Card>
          <CardContent className="p-4 space-y-4">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setDevPage(1);
                setDevApplied(devSearch.trim());
              }}
            >
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  value={devSearch}
                  onChange={(e) => setDevSearch(e.target.value)}
                  placeholder="Search email, name, company…"
                  className="pl-9"
                />
              </div>
              <Button type="submit" size="sm">Search</Button>
            </form>

            {devLoading ? (
              <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Developer</TableHead>
                      <TableHead>Plan</TableHead>
                      <TableHead>Keys</TableHead>
                      <TableHead className="text-right">Today</TableHead>
                      <TableHead className="text-right">Month</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Last Used</TableHead>
                      <TableHead>Joined</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(devData?.users || []).map((u) => (
                      <TableRow key={u._id}>
                        <TableCell>
                          <div className="font-medium text-gray-900">{u.name || "—"}</div>
                          <div className="text-xs text-gray-500">{u.email}</div>
                          {u.company && <div className="text-[11px] text-gray-400">{u.company}</div>}
                        </TableCell>
                        <TableCell><Badge variant="outline" className={PLAN_BADGE[u.plan]}>{u.plan?.toUpperCase()}</Badge></TableCell>
                        <TableCell><span className="text-gray-700">{u.activeKeys}</span><span className="text-gray-400"> / {u.keyCount}</span></TableCell>
                        <TableCell className="text-right font-mono text-sm">{fmtNum(u.usage.today)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{fmtNum(u.usage.month)}</TableCell>
                        <TableCell className="text-right font-mono text-sm font-semibold">{fmtNum(u.usage.total)}</TableCell>
                        <TableCell className="text-xs text-gray-500">{fmtDateTime(u.lastUsedAt)}</TableCell>
                        <TableCell className="text-xs text-gray-500">{fmtDate(u.createdAt)}</TableCell>
                      </TableRow>
                    ))}
                    {devData && devData.users.length === 0 && (
                      <TableRow><TableCell colSpan={8} className="text-center text-gray-400 py-8">No developers found.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}

            {devData && devData.pages > 1 && (
              <div className="flex items-center justify-between text-sm text-gray-500">
                <span>{fmtNum(devData.totalCount)} developers</span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={devPage <= 1 || devFetching} onClick={() => setDevPage((p) => p - 1)}>Prev</Button>
                  <span>Page {devPage} / {devData.pages}</span>
                  <Button variant="outline" size="sm" disabled={devPage >= devData.pages || devFetching} onClick={() => setDevPage((p) => p + 1)}>Next</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Keys tab */}
      {tab === "keys" && (
        <Card>
          <CardContent className="p-4 space-y-4">
            <form
              className="flex gap-2 flex-wrap"
              onSubmit={(e) => {
                e.preventDefault();
                setKeyPage(1);
                setKeyApplied(keySearch.trim());
              }}
            >
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  value={keySearch}
                  onChange={(e) => setKeySearch(e.target.value)}
                  placeholder="Search email, app, key prefix…"
                  className="pl-9"
                />
              </div>
              <select
                value={keyPlan}
                onChange={(e) => { setKeyPlan(e.target.value); setKeyPage(1); }}
                className="border border-gray-300 rounded-md px-3 text-sm h-10"
              >
                <option value="">All plans</option>
                <option value="demo">Demo</option>
                <option value="free">Free</option>
                <option value="pro">Pro</option>
              </select>
              <select
                value={keyStatus}
                onChange={(e) => { setKeyStatus(e.target.value); setKeyPage(1); }}
                className="border border-gray-300 rounded-md px-3 text-sm h-10"
              >
                <option value="">All statuses</option>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
                <option value="revoked">Revoked</option>
                <option value="expired">Expired</option>
              </select>
              <Button type="submit" size="sm">Search</Button>
            </form>

            {keyLoading ? (
              <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Key / Owner</TableHead>
                      <TableHead>Plan</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Today</TableHead>
                      <TableHead className="text-right">Month</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Last Used</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(keyData?.keys || []).map((k) => {
                      const busy = (statusMutation.isPending || planMutation.isPending) &&
                        (statusMutation.variables?.id === k._id || planMutation.variables?.id === k._id);
                      return (
                        <TableRow key={k._id}>
                          <TableCell>
                            <div className="font-mono text-sm text-gray-900">{k.keyPrefix}…</div>
                            <div className="text-xs text-gray-500">{k.email}</div>
                            {k.appName && <div className="text-[11px] text-gray-400">{k.appName}</div>}
                          </TableCell>
                          <TableCell><Badge variant="outline" className={PLAN_BADGE[k.plan]}>{k.plan?.toUpperCase()}</Badge></TableCell>
                          <TableCell><Badge variant="outline" className={STATUS_BADGE[k.status]}>{k.status?.toUpperCase()}</Badge></TableCell>
                          <TableCell className="text-right font-mono text-sm">{fmtNum(k.usage.todayCount)}<span className="text-gray-400 text-xs">/{fmtNum(k.dailyQuota)}</span></TableCell>
                          <TableCell className="text-right font-mono text-sm">{fmtNum(k.usage.monthCount)}</TableCell>
                          <TableCell className="text-right font-mono text-sm font-semibold">{fmtNum(k.usage.totalCount)}</TableCell>
                          <TableCell className="text-xs text-gray-500">{fmtDateTime(k.usage.lastUsedAt)}</TableCell>
                          <TableCell className="text-right">
                            {k.plan !== "demo" && (
                              <div className="flex items-center gap-1 justify-end">
                                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />}
                                {k.plan === "free" ? (
                                  <Button variant="outline" size="sm" className="h-7 px-2 text-xs" title="Upgrade to Pro"
                                    onClick={() => planMutation.mutate({ id: k._id, plan: "pro" })}>
                                    <Zap className="w-3 h-3 mr-1" />Pro
                                  </Button>
                                ) : (
                                  <Button variant="outline" size="sm" className="h-7 px-2 text-xs" title="Downgrade to Free"
                                    onClick={() => planMutation.mutate({ id: k._id, plan: "free" })}>
                                    Free
                                  </Button>
                                )}
                                {k.status === "active" ? (
                                  <>
                                    <Button variant="outline" size="sm" className="h-7 px-2 text-xs text-amber-700 border-amber-300" title="Suspend"
                                      onClick={() => statusMutation.mutate({ id: k._id, status: "suspended" })}>
                                      <Ban className="w-3 h-3" />
                                    </Button>
                                    <Button variant="outline" size="sm" className="h-7 px-2 text-xs text-red-700 border-red-300" title="Revoke"
                                      onClick={() => statusMutation.mutate({ id: k._id, status: "revoked" })}>
                                      Revoke
                                    </Button>
                                  </>
                                ) : (
                                  <Button variant="outline" size="sm" className="h-7 px-2 text-xs text-green-700 border-green-300" title="Reactivate"
                                    onClick={() => statusMutation.mutate({ id: k._id, status: "active" })}>
                                    <ShieldCheck className="w-3 h-3 mr-1" />Activate
                                  </Button>
                                )}
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {keyData && keyData.keys.length === 0 && (
                      <TableRow><TableCell colSpan={8} className="text-center text-gray-400 py-8">No keys found.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}

            {keyData && keyData.pages > 1 && (
              <div className="flex items-center justify-between text-sm text-gray-500">
                <span>{fmtNum(keyData.totalCount)} keys</span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={keyPage <= 1 || keyFetching} onClick={() => setKeyPage((p) => p - 1)}>Prev</Button>
                  <span>Page {keyPage} / {keyData.pages}</span>
                  <Button variant="outline" size="sm" disabled={keyPage >= keyData.pages || keyFetching} onClick={() => setKeyPage((p) => p + 1)}>Next</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
