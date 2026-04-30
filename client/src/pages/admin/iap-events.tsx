import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Loader2, RefreshCw, Filter as FilterIcon } from "lucide-react";

// Admin page for browsing the IapEvent audit log + a small 7-day stats
// summary at the top. Lets us answer "what happened to user X's purchase"
// when Apple/Google issue refunds, when fraud is suspected, or when a
// production release breaks IAP for a slice of users.

interface IapEventRow {
  _id: string;
  userId: string | null;
  user?: { email?: string; fullName?: string } | null;
  platform: "ios" | "android" | "unknown";
  productId: string;
  transactionId: string;
  originalTransactionId: string;
  receiptHash: string;
  result: string;
  providerCode: string;
  statusCode: number;
  errorMessage: string;
  plan: string;
  isTrial: boolean;
  expiresAt: string | null;
  isLifetime: boolean;
  ip: string;
  userAgent: string;
  durationMs: number;
  createdAt: string;
}

interface IapEventsResponse {
  items: IapEventRow[];
  total: number;
  page: number;
  limit: number;
}

interface IapStatsResponse {
  days: number;
  since: string;
  total: number;
  byResult: Record<string, number>;
}

const RESULTS = [
  "success",
  "replay_blocked",
  "invalid_receipt",
  "expired",
  "apple_error",
  "google_error",
  "missing_credentials",
  "bad_request",
  "persist_error",
  "fatal_error",
] as const;

const RESULT_BADGES: Record<string, string> = {
  success: "bg-green-100 text-green-800 border-green-300",
  replay_blocked: "bg-orange-100 text-orange-800 border-orange-300",
  invalid_receipt: "bg-red-100 text-red-800 border-red-300",
  expired: "bg-gray-200 text-gray-800 border-gray-300",
  apple_error: "bg-rose-100 text-rose-800 border-rose-300",
  google_error: "bg-rose-100 text-rose-800 border-rose-300",
  missing_credentials: "bg-yellow-100 text-yellow-800 border-yellow-300",
  bad_request: "bg-blue-100 text-blue-800 border-blue-300",
  persist_error: "bg-purple-100 text-purple-800 border-purple-300",
  fatal_error: "bg-red-200 text-red-900 border-red-400",
};

function formatDateTime(s?: string) {
  if (!s) return "-";
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString();
}

function buildQs(params: Record<string, string | number | undefined>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    qs.set(k, String(v));
  }
  return qs.toString();
}

export default function AdminIapEvents() {
  const [filterEmail, setFilterEmail] = useState("");
  const [filterUserId, setFilterUserId] = useState("");
  const [filterResult, setFilterResult] = useState("");
  const [filterPlatform, setFilterPlatform] = useState("");
  const [filterProductId, setFilterProductId] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [page, setPage] = useState(1);
  const limit = 50;

  // Held-applied filters: only commit on "Apply" so typing in the email box
  // doesn't fire one query per keystroke.
  const [applied, setApplied] = useState({
    email: "",
    userId: "",
    result: "",
    platform: "",
    productId: "",
    from: "",
    to: "",
  });

  const qs = buildQs({
    page,
    limit,
    email: applied.email,
    userId: applied.userId,
    result: applied.result,
    platform: applied.platform,
    productId: applied.productId,
    from: applied.from ? new Date(applied.from).toISOString() : "",
    to: applied.to ? new Date(applied.to + "T23:59:59").toISOString() : "",
  });

  const { data, isLoading, isFetching, error, refetch } = useQuery<IapEventsResponse>({
    queryKey: ["/api/admin/iap-events", qs],
    queryFn: async () => {
      const res = await fetch(`/api/admin/iap-events?${qs}`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    staleTime: 15000,
  });

  const { data: stats } = useQuery<IapStatsResponse>({
    queryKey: ["/api/admin/iap-events/stats"],
    queryFn: async () => {
      const res = await fetch(`/api/admin/iap-events/stats?days=7`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    staleTime: 60000,
  });

  const applyFilters = () => {
    setPage(1);
    setApplied({
      email: filterEmail.trim(),
      userId: filterUserId.trim(),
      result: filterResult,
      platform: filterPlatform,
      productId: filterProductId.trim(),
      from: filterFrom,
      to: filterTo,
    });
  };

  const resetFilters = () => {
    setFilterEmail("");
    setFilterUserId("");
    setFilterResult("");
    setFilterPlatform("");
    setFilterProductId("");
    setFilterFrom("");
    setFilterTo("");
    setPage(1);
    setApplied({ email: "", userId: "", result: "", platform: "", productId: "", from: "", to: "" });
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / limit)) : 1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">IAP Events</h1>
        <p className="text-gray-600 mt-2">
          Per-call audit trail for <code className="bg-gray-100 px-1 rounded text-sm">/api/iap/validate</code>. Auto-purges after 365 days.
        </p>
      </div>

      {/* 7-day summary */}
      <Card>
        <CardHeader>
          <CardTitle>Last 7 days</CardTitle>
          <CardDescription>
            {stats ? `${stats.total} events since ${formatDateTime(stats.since)}` : "Loading…"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {RESULTS.map((r) => (
              <Badge key={r} className={`${RESULT_BADGES[r] || ""} border text-xs`}>
                {r}: {stats?.byResult?.[r] || 0}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FilterIcon size={18} /> Filters
          </CardTitle>
          <CardDescription>Filters apply on click. Date range is inclusive.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">User email</label>
              <Input
                placeholder="user@example.com"
                value={filterEmail}
                onChange={(e) => setFilterEmail(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">User ID</label>
              <Input
                placeholder="ObjectId"
                value={filterUserId}
                onChange={(e) => setFilterUserId(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Result</label>
              <select
                value={filterResult}
                onChange={(e) => setFilterResult(e.target.value)}
                className="w-full bg-white text-gray-900 border border-gray-300 rounded px-2 py-2 text-sm h-10"
              >
                <option value="">(any)</option>
                {RESULTS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Platform</label>
              <select
                value={filterPlatform}
                onChange={(e) => setFilterPlatform(e.target.value)}
                className="w-full bg-white text-gray-900 border border-gray-300 rounded px-2 py-2 text-sm h-10"
              >
                <option value="">(any)</option>
                <option value="ios">ios</option>
                <option value="android">android</option>
                <option value="unknown">unknown</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Product ID</label>
              <Input
                placeholder="megaradio_premium_yearly"
                value={filterProductId}
                onChange={(e) => setFilterProductId(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">From</label>
              <Input
                type="date"
                value={filterFrom}
                onChange={(e) => setFilterFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">To</label>
              <Input
                type="date"
                value={filterTo}
                onChange={(e) => setFilterTo(e.target.value)}
              />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <Button onClick={applyFilters} className="bg-blue-600 hover:bg-blue-700 text-white">
              Apply
            </Button>
            <Button variant="outline" onClick={resetFilters}>
              Reset
            </Button>
            <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw size={16} className={`mr-1 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Results table */}
      <Card>
        <CardHeader>
          <CardTitle>
            Events {data ? `(${data.total.toLocaleString()})` : ""}
          </CardTitle>
          <CardDescription>
            {data ? `Page ${data.page} of ${totalPages}` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="animate-spin" size={32} />
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <p className="text-red-600 font-medium">Failed to load events</p>
              <p className="text-gray-500 text-sm">{(error as Error).message}</p>
            </div>
          ) : !data || data.items.length === 0 ? (
            <div className="text-center py-8 text-gray-500">No events match your filters</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50 hover:bg-gray-50">
                    <TableHead className="font-bold whitespace-nowrap">When</TableHead>
                    <TableHead className="font-bold">User</TableHead>
                    <TableHead className="font-bold">Result</TableHead>
                    <TableHead className="font-bold text-center">HTTP</TableHead>
                    <TableHead className="font-bold">Platform</TableHead>
                    <TableHead className="font-bold">Product</TableHead>
                    <TableHead className="font-bold">Provider code</TableHead>
                    <TableHead className="font-bold">Original txn</TableHead>
                    <TableHead className="font-bold">Error</TableHead>
                    <TableHead className="font-bold text-right">ms</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((row) => (
                    <TableRow key={row._id} className="hover:bg-gray-50 align-top">
                      <TableCell className="text-xs whitespace-nowrap">{formatDateTime(row.createdAt)}</TableCell>
                      <TableCell className="text-xs">
                        {row.user ? (
                          <div>
                            <div className="text-gray-900">{row.user.email || "—"}</div>
                            {row.user.fullName && <div className="text-gray-500">{row.user.fullName}</div>}
                          </div>
                        ) : (
                          <span className="text-gray-400">unauthenticated</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge className={`${RESULT_BADGES[row.result] || ""} border text-xs whitespace-nowrap`}>
                          {row.result}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center text-xs font-mono">{row.statusCode}</TableCell>
                      <TableCell className="text-xs">{row.platform}</TableCell>
                      <TableCell className="text-xs font-mono break-all max-w-[180px]">{row.productId || "-"}</TableCell>
                      <TableCell className="text-xs font-mono">{row.providerCode || "-"}</TableCell>
                      <TableCell className="text-xs font-mono break-all max-w-[180px]">{row.originalTransactionId || "-"}</TableCell>
                      <TableCell className="text-xs text-red-600 max-w-[260px] break-words">
                        {row.errorMessage || "-"}
                      </TableCell>
                      <TableCell className="text-right text-xs font-mono">{row.durationMs}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Pagination */}
          {data && data.total > limit && (
            <div className="flex items-center justify-between mt-4">
              <span className="text-sm text-gray-600">
                Showing {(page - 1) * limit + 1}–{Math.min(page * limit, data.total)} of {data.total.toLocaleString()}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
