import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAdminViewPrefs } from "@/hooks/useAdminViewPrefs";
import { ResetViewButton } from "@/components/admin/ResetViewButton";
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
  Search,
  Edit2,
  Trash2,
  Crown,
  Ban,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Download,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getAvatarUrl } from "@/lib/utils";

interface UserSubscription {
  plan: 'none' | 'remove_ads' | 'premium_monthly' | 'premium_yearly' | 'premium_lifetime';
  platform: 'ios' | 'android' | 'tvos' | 'macos' | 'web' | 'admin';
  productId?: string;
  transactionId?: string;
  originalTransactionId?: string;
  expiresAt?: string | null;
  startedAt?: string;
  lastVerifiedAt?: string;
  isTrial?: boolean;
  isActive: boolean;
  cancelledAt?: string;
}

interface UserProfile {
  _id: string;
  email: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  avatar?: string;
  profilePicture?: string;
  authProvider?: string;
  googleId?: string;
  followers?: number;
  favorites?: number;
  subscription?: UserSubscription | null;
  createdAt?: string;
  updatedAt?: string;
  isActive?: boolean;
}

// Namespaced under `admin-users:` so the same admin preferences endpoint
// can serve other admin pages. The shared hook prefixes with `admin:` for
// localStorage automatically.
const VIEW_PREFS_KEY = "admin-users:view-prefs:v1";

// "all" = no filter applied. Other values map 1:1 to the persisted plan
// strings on IUser.subscription.plan, with "any_premium" as a convenience
// bucket covering all three premium tiers.
type PlanFilter =
  | "all"
  | "none"
  | "remove_ads"
  | "any_premium"
  | "premium_monthly"
  | "premium_yearly"
  | "premium_lifetime";

const PLAN_FILTER_VALUES: readonly PlanFilter[] = [
  "all",
  "none",
  "remove_ads",
  "any_premium",
  "premium_monthly",
  "premium_yearly",
  "premium_lifetime",
] as const;

// "all" = no filter. "email" matches the historical default where
// authProvider is unset (treated as email signups).
type AuthMethodFilter = "all" | "email" | "google" | "facebook" | "apple";

const AUTH_METHOD_FILTER_VALUES: readonly AuthMethodFilter[] = [
  "all",
  "email",
  "google",
  "facebook",
  "apple",
] as const;

// "all" = no filter applied. Other values map 1:1 to the values stored on
// UserSubscription.platform. Matching is independent of `isActive` so
// users who originally signed up on iOS/Android/web/admin still appear
// in the right bucket after their subscription expires or is cancelled.
// Users with no subscription at all don't belong to any platform bucket.
type PlatformFilter =
  | "all"
  | "ios"
  | "android"
  | "tvos"
  | "macos"
  | "web"
  | "admin";

const PLATFORM_FILTER_VALUES: readonly PlatformFilter[] = [
  "all",
  "ios",
  "android",
  "tvos",
  "macos",
  "web",
  "admin",
] as const;

type SortColumn =
  | "createdAt"
  | "updatedAt"
  | "plan"
  | "followers"
  | "name"
  | "email"
  | "favorites";
type SortDirection = "asc" | "desc";

interface UsersViewPrefs {
  searchQuery: string;
  planFilter: PlanFilter;
  authMethodFilter: AuthMethodFilter;
  platformFilter: PlatformFilter;
  sort: { column: SortColumn; direction: SortDirection } | null;
}

const DEFAULT_VIEW_PREFS: UsersViewPrefs = {
  searchQuery: "",
  planFilter: "all",
  authMethodFilter: "all",
  platformFilter: "all",
  sort: null,
};

const SORT_COLUMNS: ReadonlyArray<SortColumn> = [
  "createdAt",
  "updatedAt",
  "plan",
  "followers",
  "name",
  "email",
  "favorites",
];

function getNameKey(user: UserProfile): string {
  const name =
    user.fullName ||
    `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
  return name.toLowerCase();
}

function sanitizeViewPrefs(raw: unknown): UsersViewPrefs {
  if (!raw || typeof raw !== "object") return DEFAULT_VIEW_PREFS;
  const obj = raw as Record<string, unknown>;
  const planRaw = obj.planFilter;
  const authRaw = obj.authMethodFilter;
  const platformRaw = obj.platformFilter;
  let sort: UsersViewPrefs["sort"] = null;
  const sortRaw = obj.sort as Record<string, unknown> | undefined;
  if (
    sortRaw &&
    typeof sortRaw === "object" &&
    SORT_COLUMNS.includes(sortRaw.column as SortColumn) &&
    (sortRaw.direction === "asc" || sortRaw.direction === "desc")
  ) {
    sort = {
      column: sortRaw.column as SortColumn,
      direction: sortRaw.direction as SortDirection,
    };
  }
  return {
    searchQuery: typeof obj.searchQuery === "string" ? obj.searchQuery : "",
    planFilter:
      typeof planRaw === "string" &&
      (PLAN_FILTER_VALUES as readonly string[]).includes(planRaw)
        ? (planRaw as PlanFilter)
        : "all",
    authMethodFilter:
      typeof authRaw === "string" &&
      (AUTH_METHOD_FILTER_VALUES as readonly string[]).includes(authRaw)
        ? (authRaw as AuthMethodFilter)
        : "all",
    platformFilter:
      typeof platformRaw === "string" &&
      (PLATFORM_FILTER_VALUES as readonly string[]).includes(platformRaw)
        ? (platformRaw as PlatformFilter)
        : "all",
    sort,
  };
}

function matchesPlatformFilter(
  sub: UserSubscription | null | undefined,
  filter: PlatformFilter,
): boolean {
  if (filter === "all") return true;
  // Match purely on the stored platform value so users who originally
  // signed up on iOS/Android/web/admin still show up after their
  // subscription lapses or is cancelled. Users with no subscription
  // (and therefore no platform value) are excluded from every bucket.
  if (!sub) return false;
  return sub.platform === filter;
}

function matchesPlanFilter(
  sub: UserSubscription | null | undefined,
  filter: PlanFilter,
): boolean {
  if (filter === "all") return true;
  const plan = sub?.plan ?? "none";
  const isActive = sub?.isActive === true;
  if (filter === "none") {
    // Treat inactive/cancelled subs as "no plan" too — matches the table's
    // own rendering, which only shows a badge when sub.isActive && plan!=='none'.
    return !isActive || plan === "none";
  }
  if (!isActive) return false;
  if (filter === "any_premium") {
    return (
      plan === "premium_monthly" ||
      plan === "premium_yearly" ||
      plan === "premium_lifetime"
    );
  }
  return plan === filter;
}

function matchesAuthMethodFilter(
  authProvider: string | undefined,
  filter: AuthMethodFilter,
): boolean {
  if (filter === "all") return true;
  // Legacy users (and email/password signups) often have no authProvider set.
  const provider = (authProvider || "email").toLowerCase();
  return provider === filter;
}

// Ordering for the Plan column. Higher rank = more valuable plan, so
// 'desc' surfaces lifetime/premium users first which is what admins
// usually want when scanning. Inactive subscriptions are treated as
// 'none' regardless of the stored plan value.
const PLAN_RANK: Record<string, number> = {
  none: 0,
  remove_ads: 1,
  premium_monthly: 2,
  premium_yearly: 3,
  premium_lifetime: 4,
};

function getPlanRank(user: UserProfile): number {
  const sub = user.subscription;
  if (!sub || !sub.isActive || sub.plan === "none") return 0;
  return PLAN_RANK[sub.plan] ?? 0;
}

export default function AdminUsers() {
  const {
    prefs,
    setPrefs,
    reset: resetViewPrefs,
  } = useAdminViewPrefs<UsersViewPrefs>(
    VIEW_PREFS_KEY,
    DEFAULT_VIEW_PREFS,
    sanitizeViewPrefs,
  );
  const searchQuery = prefs.searchQuery;
  const planFilter = prefs.planFilter;
  const authMethodFilter = prefs.authMethodFilter;
  const platformFilter = prefs.platformFilter;
  const sort = prefs.sort;
  const setSearchQuery = (value: string) =>
    setPrefs((p) => ({ ...p, searchQuery: value }));
  const setPlanFilter = (value: PlanFilter) =>
    setPrefs((p) => ({ ...p, planFilter: value }));
  const setAuthMethodFilter = (value: AuthMethodFilter) =>
    setPrefs((p) => ({ ...p, authMethodFilter: value }));
  const setPlatformFilter = (value: PlatformFilter) =>
    setPrefs((p) => ({ ...p, platformFilter: value }));
  const setSort = (next: UsersViewPrefs["sort"]) =>
    setPrefs((p) => ({ ...p, sort: next }));
  const handleToggleSort = (column: SortColumn) => {
    setSort(
      !sort || sort.column !== column
        ? { column, direction: "desc" }
        : { column, direction: sort.direction === "desc" ? "asc" : "desc" },
    );
  };
  const hasActiveFilters =
    planFilter !== "all" ||
    authMethodFilter !== "all" ||
    platformFilter !== "all";
  const hasNonDefaultViewPrefs =
    searchQuery.trim() !== "" || hasActiveFilters || sort !== null;
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<UserProfile>>({});
  // Local form state for the "Admin Overrides" section in the edit modal.
  // Reset every time the user opens a new edit dialog.
  const [subPlanDraft, setSubPlanDraft] = useState<string>("none");
  const [subExpiresDraft, setSubExpiresDraft] = useState<string>("");
  const { toast } = useToast();

  const { data: usersResponse, isLoading: isLoadingUsers, error: usersError } = useQuery<{ users: UserProfile[]; total: number }>({
    queryKey: ["/api/admin/users"],
    staleTime: 30000,
    queryFn: async () => {
      const res = await fetch("/api/admin/users", { credentials: "include" });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status}: ${text}`);
      }
      return res.json();
    },
    retry: 2,
  });
  const users = usersResponse?.users || [];

  const filteredUsers = useMemo(() => {
    const normalizedSearch = searchQuery.toLowerCase();
    const matches = users.filter((user) => {
      const matchesSearch =
        normalizedSearch === "" ||
        user.email.toLowerCase().includes(normalizedSearch) ||
        user.firstName?.toLowerCase().includes(normalizedSearch) ||
        user.lastName?.toLowerCase().includes(normalizedSearch);
      return (
        matchesSearch &&
        matchesPlanFilter(user.subscription, planFilter) &&
        matchesAuthMethodFilter(user.authProvider, authMethodFilter) &&
        matchesPlatformFilter(user.subscription, platformFilter)
      );
    });
    if (!sort) return matches;
    const dir = sort.direction === "asc" ? 1 : -1;
    // Returns a finite epoch ms or null for missing/invalid dates so the
    // comparator can push them to the bottom in either direction.
    const dateKey = (s?: string): number | null => {
      if (!s) return null;
      const t = new Date(s).getTime();
      return Number.isFinite(t) ? t : null;
    };
    const sorted = [...matches].sort((a, b) => {
      let av: number | string | null;
      let bv: number | string | null;
      switch (sort.column) {
        case "createdAt":
          av = dateKey(a.createdAt);
          bv = dateKey(b.createdAt);
          break;
        case "updatedAt":
          av = dateKey(a.updatedAt);
          bv = dateKey(b.updatedAt);
          break;
        case "plan":
          av = getPlanRank(a);
          bv = getPlanRank(b);
          break;
        case "followers":
          av = a.followers || 0;
          bv = b.followers || 0;
          break;
        case "favorites":
          av = a.favorites || 0;
          bv = b.favorites || 0;
          break;
        case "name": {
          const an = getNameKey(a);
          const bn = getNameKey(b);
          av = an === "" ? null : an;
          bv = bn === "" ? null : bn;
          break;
        }
        case "email":
          av = a.email ? a.email.toLowerCase() : null;
          bv = b.email ? b.email.toLowerCase() : null;
          break;
      }
      // Missing values always sort to the bottom regardless of direction
      // so admins always see real data first.
      if (av === null && bv === null) return a.email.localeCompare(b.email);
      if (av === null) return 1;
      if (bv === null) return -1;
      const cmp =
        typeof av === "string" && typeof bv === "string"
          ? av.localeCompare(bv)
          : av < bv
            ? -1
            : av > bv
              ? 1
              : 0;
      if (cmp === 0) {
        // Stable secondary sort by email for predictable grouping.
        return a.email.localeCompare(b.email);
      }
      return cmp * dir;
    });
    return sorted;
  }, [users, searchQuery, planFilter, authMethodFilter, platformFilter, sort]);

  // Counts per filter option computed from the currently loaded users so
  // each dropdown doubles as a lightweight breakdown. We deliberately use
  // `users` (the full loaded set) rather than `filteredUsers` so the
  // numbers don't collapse to zero as soon as one filter is applied —
  // admins want to see "where could I jump to next?".
  const planCounts = useMemo(() => {
    const counts: Record<PlanFilter, number> = {
      all: users.length,
      none: 0,
      remove_ads: 0,
      any_premium: 0,
      premium_monthly: 0,
      premium_yearly: 0,
      premium_lifetime: 0,
    };
    for (const user of users) {
      for (const value of PLAN_FILTER_VALUES) {
        if (value === "all") continue;
        if (matchesPlanFilter(user.subscription, value)) counts[value]++;
      }
    }
    return counts;
  }, [users]);

  const platformCounts = useMemo(() => {
    const counts: Record<PlatformFilter, number> = {
      all: users.length,
      ios: 0,
      android: 0,
      tvos: 0,
      macos: 0,
      web: 0,
      admin: 0,
    };
    for (const user of users) {
      for (const value of PLATFORM_FILTER_VALUES) {
        if (value === "all") continue;
        if (matchesPlatformFilter(user.subscription, value)) counts[value]++;
      }
    }
    return counts;
  }, [users]);

  const authMethodCounts = useMemo(() => {
    const counts: Record<AuthMethodFilter, number> = {
      all: users.length,
      email: 0,
      google: 0,
      facebook: 0,
      apple: 0,
    };
    for (const user of users) {
      for (const value of AUTH_METHOD_FILTER_VALUES) {
        if (value === "all") continue;
        if (matchesAuthMethodFilter(user.authProvider, value)) counts[value]++;
      }
    }
    return counts;
  }, [users]);

  const formatCount = (n: number) => n.toLocaleString();

  const renderSortIcon = (column: SortColumn) => {
    if (!sort || sort.column !== column) {
      return (
        <ChevronsUpDown
          className="h-4 w-4 opacity-50 inline-block ml-1"
          data-testid={`icon-sort-${column}-none`}
          aria-hidden="true"
        />
      );
    }
    if (sort.direction === "desc") {
      return (
        <ChevronDown
          className="h-4 w-4 inline-block ml-1"
          data-testid={`icon-sort-${column}-desc`}
          aria-hidden="true"
        />
      );
    }
    return (
      <ChevronUp
        className="h-4 w-4 inline-block ml-1"
        data-testid={`icon-sort-${column}-asc`}
        aria-hidden="true"
      />
    );
  };

  const ariaSortFor = (
    column: SortColumn,
  ): "ascending" | "descending" | "none" => {
    if (!sort || sort.column !== column) return "none";
    return sort.direction === "asc" ? "ascending" : "descending";
  };

  // Quote a single CSV field per RFC 4180: wrap in double quotes and escape
  // any embedded double quotes by doubling them. We always quote so commas,
  // newlines, and leading "=" (Excel formula injection) are safe.
  const csvField = (value: unknown): string => {
    if (value === null || value === undefined) return '""';
    let str = String(value);
    // Defuse spreadsheet formula injection by prefixing risky leading chars.
    if (/^[=+\-@\t\r]/.test(str)) str = "'" + str;
    return `"${str.replace(/"/g, '""')}"`;
  };

  const csvDate = (s?: string): string => {
    if (!s) return "";
    const d = new Date(s);
    return Number.isFinite(d.getTime()) ? d.toISOString() : "";
  };

  // Shared row builder so CSV and XLSX always export the same columns in
  // the same order. Returns typed values (number | Date | string | null)
  // so XLSX can write real number/date cells; CSV stringifies as needed.
  type ExportRow = {
    id: string;
    name: string;
    email: string;
    auth_method: string;
    plan: string;
    plan_active: boolean;
    expires_at: Date | null;
    followers: number;
    favorites: number;
    created_at: Date | null;
    updated_at: Date | null;
  };

  const parseDate = (s?: string | null): Date | null => {
    if (!s) return null;
    const d = new Date(s);
    return Number.isFinite(d.getTime()) ? d : null;
  };

  const buildExportRows = (): ExportRow[] =>
    filteredUsers.map((u) => {
      const name =
        u.fullName ||
        [u.firstName, u.lastName].filter(Boolean).join(" ") ||
        "";
      const sub = u.subscription;
      return {
        id: u._id,
        name,
        email: u.email,
        auth_method: (u.authProvider || "email").toLowerCase(),
        plan: sub?.plan ?? "none",
        plan_active: sub?.isActive === true,
        expires_at: parseDate(sub?.expiresAt ?? undefined),
        followers: u.followers ?? 0,
        favorites: u.favorites ?? 0,
        created_at: parseDate(u.createdAt),
        updated_at: parseDate(u.updatedAt),
      };
    });

  // Same naming convention as the CSV export so admins can pair files
  // together when archiving.
  const exportTimestamp = (): string =>
    new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace("T", "_")
      .replace("Z", "");

  const handleDownloadXlsx = async () => {
    // exceljs is ~900KB pre-gzip; lazy-load so the rest of the admin UI
    // stays snappy and only admins who actually click "Download Excel"
    // pay the cost.
    let ExcelJS: typeof import("exceljs");
    try {
      ExcelJS = await import("exceljs");
    } catch {
      toast({
        title: "Excel export unavailable",
        description: "Could not load the Excel exporter. Please try CSV instead.",
        variant: "destructive",
      });
      return;
    }
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "MegaRadio Admin";
    workbook.created = new Date();
    const sheet = workbook.addWorksheet("Users");
    sheet.columns = [
      { header: "id", key: "id", width: 26 },
      { header: "name", key: "name", width: 24 },
      { header: "email", key: "email", width: 32 },
      { header: "auth_method", key: "auth_method", width: 14 },
      { header: "plan", key: "plan", width: 18 },
      { header: "plan_active", key: "plan_active", width: 12 },
      // Real Excel date cells so admins can sort/filter by date in Excel.
      { header: "expires_at", key: "expires_at", width: 20, style: { numFmt: "yyyy-mm-dd hh:mm:ss" } },
      { header: "followers", key: "followers", width: 12, style: { numFmt: "0" } },
      { header: "favorites", key: "favorites", width: 12, style: { numFmt: "0" } },
      { header: "created_at", key: "created_at", width: 20, style: { numFmt: "yyyy-mm-dd hh:mm:ss" } },
      { header: "updated_at", key: "updated_at", width: 20, style: { numFmt: "yyyy-mm-dd hh:mm:ss" } },
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    for (const row of buildExportRows()) {
      sheet.addRow(row);
    }
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `megaradio-users-${exportTimestamp()}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadCsv = () => {
    const headers = [
      "id",
      "name",
      "email",
      "auth_method",
      "plan",
      "plan_active",
      "expires_at",
      "followers",
      "favorites",
      "created_at",
      "updated_at",
    ];
    const rows = buildExportRows().map((r) => [
      r.id,
      r.name,
      r.email,
      r.auth_method,
      r.plan,
      r.plan_active ? "true" : "false",
      r.expires_at ? r.expires_at.toISOString() : "",
      r.followers,
      r.favorites,
      r.created_at ? r.created_at.toISOString() : "",
      r.updated_at ? r.updated_at.toISOString() : "",
    ]);
    const csv =
      [headers, ...rows].map((r) => r.map(csvField).join(",")).join("\r\n") +
      "\r\n";
    // Prepend BOM so Excel opens UTF-8 names/emails correctly.
    const blob = new Blob(["\uFEFF" + csv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `megaradio-users-${exportTimestamp()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const sortableHeaderClass =
    "inline-flex items-center gap-1 px-0 py-1 text-sm font-bold hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm";

  const updateUserMutation = useMutation({
    mutationFn: (data: { userId: string; updates: Partial<UserProfile> }) =>
      apiRequest("PATCH", `/api/admin/users/${data.userId}`, {
        body: data.updates,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Success", description: "User updated successfully" });
      setEditingUserId(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update user", variant: "destructive" });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: (userId: string) =>
      apiRequest("DELETE", `/api/admin/users/${userId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Success", description: "User deleted successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete user", variant: "destructive" });
    },
  });

  // Admin override: revoke active subscription. Stamps cancelledAt + flips
  // isActive=false but keeps the historical product/txn fields for audit.
  const cancelSubMutation = useMutation({
    mutationFn: (userId: string) =>
      apiRequest("POST", `/api/admin/users/${userId}/subscription/cancel`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Subscription cancelled", description: "User's subscription marked inactive." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to cancel subscription", variant: "destructive" });
    },
  });

  // Admin override: grant lifetime premium (platform='admin', expiresAt=null,
  // isActive=true). Used for promo codes, support compensation, etc.
  const grantLifetimeMutation = useMutation({
    mutationFn: (userId: string) =>
      apiRequest("POST", `/api/admin/users/${userId}/subscription/grant-lifetime`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Lifetime granted", description: "User now has premium_lifetime via admin override." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to grant lifetime", variant: "destructive" });
    },
  });

  // Free-form plan/expiry override (existing endpoint). Lets admin pick a
  // plan from the dropdown and (optionally) set a custom expiresAt.
  const updateSubMutation = useMutation({
    mutationFn: (data: { userId: string; plan: string; expiresAt?: string | null }) =>
      apiRequest("PATCH", `/api/admin/users/${data.userId}/subscription`, {
        body: {
          plan: data.plan,
          isActive: data.plan !== "none",
          ...(data.expiresAt !== undefined ? { expiresAt: data.expiresAt } : {}),
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Subscription updated", description: "Plan saved successfully." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update subscription", variant: "destructive" });
    },
  });

  const handleSaveEdit = (userId: string) => {
    updateUserMutation.mutate({ userId, updates: editData });
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleDateString();
  };

  const getSubscriptionBadge = (sub?: UserSubscription | null) => {
    if (!sub || !sub.isActive || sub.plan === 'none') return null;
    const colors: Record<string, string> = {
      remove_ads: "bg-blue-100 text-blue-800 border-blue-300",
      premium_monthly: "bg-yellow-100 text-yellow-800 border-yellow-300",
      premium_yearly: "bg-orange-100 text-orange-800 border-orange-300",
      premium_lifetime: "bg-purple-100 text-purple-800 border-purple-300",
    };
    const labels: Record<string, string> = {
      remove_ads: "No Ads",
      premium_monthly: "Premium (M)",
      premium_yearly: "Premium (Y)",
      premium_lifetime: "Lifetime",
    };
    const icons: Record<string, string> = {
      remove_ads: "🚫",
      premium_monthly: "⭐",
      premium_yearly: "⭐",
      premium_lifetime: "💎",
    };
    return (
      <Badge className={`${colors[sub.plan] || ''} border text-xs`}>
        {icons[sub.plan] || ''} {labels[sub.plan] || sub.plan}
        {sub.isTrial && " (Trial)"}
      </Badge>
    );
  };

  const getAuthMethodBadge = (authProvider?: string) => {
    const provider = authProvider || "Email";
    const variants: Record<string, string> = {
      "google": "bg-blue-100 text-blue-800",
      "facebook": "bg-purple-100 text-purple-800",
      "apple": "bg-gray-100 text-gray-800",
      "email": "bg-green-100 text-green-800",
    };
    return variants[provider.toLowerCase()] || "bg-gray-100 text-gray-800";
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Users Management</h1>
        <p className="text-gray-600 mt-2">View and manage all registered users</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Search Users</CardTitle>
          <CardDescription>
            Search by email or name, and narrow down by subscription plan, sign-in method, or platform
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-64">
              <Search className="absolute left-3 top-3 text-gray-400" size={20} />
              <Input
                data-testid="input-search-users"
                placeholder="Search users..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select
              value={planFilter}
              onValueChange={(value) => setPlanFilter(value as PlanFilter)}
            >
              <SelectTrigger
                className="w-48"
                data-testid="select-plan-filter"
                aria-label="Filter by plan"
              >
                <SelectValue placeholder="Filter by plan" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All plans ({formatCount(planCounts.all)})</SelectItem>
                <SelectItem value="none">No plan ({formatCount(planCounts.none)})</SelectItem>
                <SelectItem value="remove_ads">Remove Ads ({formatCount(planCounts.remove_ads)})</SelectItem>
                <SelectItem value="any_premium">Any Premium ({formatCount(planCounts.any_premium)})</SelectItem>
                <SelectItem value="premium_monthly">Premium · Monthly ({formatCount(planCounts.premium_monthly)})</SelectItem>
                <SelectItem value="premium_yearly">Premium · Yearly ({formatCount(planCounts.premium_yearly)})</SelectItem>
                <SelectItem value="premium_lifetime">Premium · Lifetime ({formatCount(planCounts.premium_lifetime)})</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={authMethodFilter}
              onValueChange={(value) =>
                setAuthMethodFilter(value as AuthMethodFilter)
              }
            >
              <SelectTrigger
                className="w-48"
                data-testid="select-auth-method-filter"
                aria-label="Filter by auth method"
              >
                <SelectValue placeholder="Filter by auth method" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sign-in methods ({formatCount(authMethodCounts.all)})</SelectItem>
                <SelectItem value="email">Email ({formatCount(authMethodCounts.email)})</SelectItem>
                <SelectItem value="google">Google ({formatCount(authMethodCounts.google)})</SelectItem>
                <SelectItem value="facebook">Facebook ({formatCount(authMethodCounts.facebook)})</SelectItem>
                <SelectItem value="apple">Apple ({formatCount(authMethodCounts.apple)})</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={platformFilter}
              onValueChange={(value) =>
                setPlatformFilter(value as PlatformFilter)
              }
            >
              <SelectTrigger
                className="w-48"
                data-testid="select-platform-filter"
                aria-label="Filter by subscription platform"
              >
                <SelectValue placeholder="Filter by platform" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All platforms ({formatCount(platformCounts.all)})</SelectItem>
                <SelectItem value="ios">iOS ({formatCount(platformCounts.ios)})</SelectItem>
                <SelectItem value="android">Android ({formatCount(platformCounts.android)})</SelectItem>
                <SelectItem value="tvos">tvOS ({formatCount(platformCounts.tvos)})</SelectItem>
                <SelectItem value="macos">macOS ({formatCount(platformCounts.macos)})</SelectItem>
                <SelectItem value="web">Web ({formatCount(platformCounts.web)})</SelectItem>
                <SelectItem value="admin">Admin-granted ({formatCount(platformCounts.admin)})</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              onClick={handleDownloadCsv}
              disabled={filteredUsers.length === 0}
              data-testid="button-download-users-csv"
              aria-label="Download filtered users as CSV"
              title="Download the currently filtered user list as a CSV file"
              className="bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
            >
              <Download size={16} className="mr-2" />
              Download CSV
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleDownloadXlsx}
              disabled={filteredUsers.length === 0}
              data-testid="button-download-users-xlsx"
              aria-label="Download filtered users as Excel"
              title="Download the currently filtered user list as an Excel (.xlsx) file"
              className="bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
            >
              <Download size={16} className="mr-2" />
              Download Excel
            </Button>
            <ResetViewButton
              hasNonDefaultPrefs={hasNonDefaultViewPrefs}
              reset={resetViewPrefs}
              toastDescription="Search, filters, and sort restored to defaults on this device and your account."
              title="Clear search, filters, and sort on this device and your account"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All Users ({filteredUsers.length})</CardTitle>
          <CardDescription>Manage user profiles, data, and permissions</CardDescription>
        </CardHeader>
        <CardContent>
          {!isLoadingUsers && !usersError && users.length > 0 && (
            <p
              className="text-sm text-gray-600 mb-4"
              data-testid="text-users-filter-summary"
            >
              {hasActiveFilters || searchQuery.trim() !== "" ? (
                <>
                  Showing <span className="font-medium text-gray-900">{formatCount(filteredUsers.length)}</span>{" "}
                  of <span className="font-medium text-gray-900">{formatCount(users.length)}</span> users matching the current filters.
                </>
              ) : (
                <>
                  Showing all <span className="font-medium text-gray-900">{formatCount(users.length)}</span> users.
                </>
              )}
            </p>
          )}
          {isLoadingUsers ? (
            <div className="flex justify-center py-8">
              <Loader2 className="animate-spin" size={32} />
            </div>
          ) : usersError ? (
            <div className="text-center py-8">
              <p className="text-red-600 font-medium mb-2">Failed to load users</p>
              <p className="text-gray-500 text-sm">{(usersError as Error).message}</p>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="text-center py-8 text-gray-500" data-testid="text-empty-users">
              {users.length === 0
                ? "No users found"
                : hasActiveFilters && searchQuery.trim() !== ""
                  ? "No users match your search and filters. Try clearing a filter or adjusting your search."
                  : hasActiveFilters
                    ? "No users match the selected filters. Try a different plan, sign-in method, or platform."
                    : "No users match your search."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50 hover:bg-gray-50">
                    <TableHead
                      className="font-bold"
                      aria-sort={ariaSortFor("name")}
                    >
                      <button
                        type="button"
                        data-testid="button-sort-name"
                        onClick={() => handleToggleSort("name")}
                        aria-label={
                          sort?.column === "name" && sort.direction === "desc"
                            ? "Sorted by name, Z to A. Click to sort A to Z."
                            : sort?.column === "name" && sort.direction === "asc"
                              ? "Sorted by name, A to Z. Click to sort Z to A."
                              : "Sort by name"
                        }
                        className={sortableHeaderClass}
                      >
                        <span>Name</span>
                        {renderSortIcon("name")}
                      </button>
                    </TableHead>
                    <TableHead
                      className="font-bold"
                      aria-sort={ariaSortFor("email")}
                    >
                      <button
                        type="button"
                        data-testid="button-sort-email"
                        onClick={() => handleToggleSort("email")}
                        aria-label={
                          sort?.column === "email" && sort.direction === "desc"
                            ? "Sorted by email, Z to A. Click to sort A to Z."
                            : sort?.column === "email" && sort.direction === "asc"
                              ? "Sorted by email, A to Z. Click to sort Z to A."
                              : "Sort by email"
                        }
                        className={sortableHeaderClass}
                      >
                        <span>Email</span>
                        {renderSortIcon("email")}
                      </button>
                    </TableHead>
                    <TableHead
                      className="font-bold text-center"
                      aria-sort={ariaSortFor("followers")}
                    >
                      <button
                        type="button"
                        data-testid="button-sort-followers"
                        onClick={() => handleToggleSort("followers")}
                        aria-label={
                          sort?.column === "followers" && sort.direction === "desc"
                            ? "Sorted by followers, highest first. Click to sort lowest first."
                            : sort?.column === "followers" && sort.direction === "asc"
                              ? "Sorted by followers, lowest first. Click to sort highest first."
                              : "Sort by followers"
                        }
                        className={sortableHeaderClass}
                      >
                        <span>Followers</span>
                        {renderSortIcon("followers")}
                      </button>
                    </TableHead>
                    <TableHead className="font-bold">Auth Method</TableHead>
                    <TableHead
                      className="font-bold text-center"
                      aria-sort={ariaSortFor("plan")}
                    >
                      <button
                        type="button"
                        data-testid="button-sort-plan"
                        onClick={() => handleToggleSort("plan")}
                        aria-label={
                          sort?.column === "plan" && sort.direction === "desc"
                            ? "Sorted by plan, highest tier first. Click to sort lowest tier first."
                            : sort?.column === "plan" && sort.direction === "asc"
                              ? "Sorted by plan, lowest tier first. Click to sort highest tier first."
                              : "Sort by plan"
                        }
                        className={sortableHeaderClass}
                      >
                        <span>Plan</span>
                        {renderSortIcon("plan")}
                      </button>
                    </TableHead>
                    <TableHead
                      className="font-bold text-center"
                      aria-sort={ariaSortFor("favorites")}
                    >
                      <button
                        type="button"
                        data-testid="button-sort-favorites"
                        onClick={() => handleToggleSort("favorites")}
                        aria-label={
                          sort?.column === "favorites" && sort.direction === "desc"
                            ? "Sorted by favorites, highest first. Click to sort lowest first."
                            : sort?.column === "favorites" && sort.direction === "asc"
                              ? "Sorted by favorites, lowest first. Click to sort highest first."
                              : "Sort by favorites"
                        }
                        className={sortableHeaderClass}
                      >
                        <span>Favorites</span>
                        {renderSortIcon("favorites")}
                      </button>
                    </TableHead>
                    <TableHead
                      className="font-bold"
                      aria-sort={ariaSortFor("createdAt")}
                    >
                      <button
                        type="button"
                        data-testid="button-sort-created-at"
                        onClick={() => handleToggleSort("createdAt")}
                        aria-label={
                          sort?.column === "createdAt" && sort.direction === "desc"
                            ? "Sorted by joined date, newest first. Click to sort oldest first."
                            : sort?.column === "createdAt" && sort.direction === "asc"
                              ? "Sorted by joined date, oldest first. Click to sort newest first."
                              : "Sort by joined date"
                        }
                        className={sortableHeaderClass}
                      >
                        <span>Created</span>
                        {renderSortIcon("createdAt")}
                      </button>
                    </TableHead>
                    <TableHead
                      className="font-bold"
                      aria-sort={ariaSortFor("updatedAt")}
                    >
                      <button
                        type="button"
                        data-testid="button-sort-updated-at"
                        onClick={() => handleToggleSort("updatedAt")}
                        aria-label={
                          sort?.column === "updatedAt" && sort.direction === "desc"
                            ? "Sorted by last update, newest first. Click to sort oldest first."
                            : sort?.column === "updatedAt" && sort.direction === "asc"
                              ? "Sorted by last update, oldest first. Click to sort newest first."
                              : "Sort by last update"
                        }
                        className={sortableHeaderClass}
                      >
                        <span>Last Update</span>
                        {renderSortIcon("updatedAt")}
                      </button>
                    </TableHead>
                    <TableHead className="font-bold">User ID</TableHead>
                    <TableHead className="font-bold text-center">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((user) => (
                    <TableRow key={user._id} className="hover:bg-gray-50">
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <img
                            src={getAvatarUrl(user)}
                            alt={user.fullName || `${user.firstName} ${user.lastName}`}
                            className="w-8 h-8 rounded-full object-cover"
                          />
                          <span className="font-medium">
                            {user.fullName || `${user.firstName} ${user.lastName}`}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{user.email}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant="secondary">{user.followers || 0}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={getAuthMethodBadge(user.authProvider)}>
                          {user.authProvider || "Email"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        {getSubscriptionBadge(user.subscription) || (
                          <span className="text-gray-400 text-xs">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline">{user.favorites || 0}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">{formatDate(user.createdAt)}</TableCell>
                      <TableCell className="text-sm">{formatDate(user.updatedAt)}</TableCell>
                      <TableCell className="text-xs text-gray-500 font-mono">
                        {user._id.slice(0, 8)}...
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex gap-2 justify-center">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setEditingUserId(user._id);
                              setEditData(user);
                              setSubPlanDraft(user.subscription?.plan || "none");
                              setSubExpiresDraft(
                                user.subscription?.expiresAt
                                  ? new Date(user.subscription.expiresAt).toISOString().slice(0, 10)
                                  : "",
                              );
                            }}
                            title="Edit user"
                          >
                            <Edit2 size={16} />
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Are you sure you want to delete ${user.firstName} ${user.lastName}?`
                                )
                              ) {
                                deleteUserMutation.mutate(user._id);
                              }
                            }}
                            title="Delete user"
                          >
                            <Trash2 size={16} />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {editingUserId && (() => {
        const editUser = users.find(u => u._id === editingUserId);
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setEditingUserId(null)}>
            <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="bg-white border-b px-6 py-4 rounded-t-lg">
                <h2 className="text-xl font-bold text-gray-900">Edit User Information</h2>
                <p className="text-sm text-gray-500 mt-1">User ID: {editingUserId}</p>
              </div>
              <div className="bg-white px-6 py-5 space-y-5">
                <div className="flex items-center gap-4 pb-4 border-b border-gray-200">
                  <img
                    src={getAvatarUrl(editUser || editData as UserProfile)}
                    alt="Avatar"
                    className="w-16 h-16 rounded-full object-cover border-2 border-gray-200"
                  />
                  <div>
                    <p className="font-semibold text-gray-900">{editData.fullName || "No name"}</p>
                    <p className="text-sm text-gray-500">{editData.email}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                    <Input
                      value={editData.fullName || ""}
                      onChange={(e) => setEditData({ ...editData, fullName: e.target.value })}
                      placeholder="Full name"
                      className="bg-white text-gray-900 border-gray-300"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                    <Input
                      value={editData.email || ""}
                      onChange={(e) => setEditData({ ...editData, email: e.target.value })}
                      placeholder="Email"
                      type="email"
                      className="bg-white text-gray-900 border-gray-300"
                    />
                  </div>
                </div>

                <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">User Details</h3>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-gray-500">Auth Method</span>
                      <p className="font-medium text-gray-900">{editUser?.authProvider || "email"}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Status</span>
                      <p className="font-medium">
                        <span className={editUser?.isActive !== false ? "text-green-600" : "text-red-600"}>
                          {editUser?.isActive !== false ? "Active" : "Inactive"}
                        </span>
                      </p>
                    </div>
                    <div>
                      <span className="text-gray-500">Followers</span>
                      <p className="font-medium text-gray-900">{editUser?.followers || 0}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Favorites</span>
                      <p className="font-medium text-gray-900">{editUser?.favorites || 0}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Created</span>
                      <p className="font-medium text-gray-900">{formatDate(editUser?.createdAt)}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Last Update</span>
                      <p className="font-medium text-gray-900">{formatDate(editUser?.updatedAt)}</p>
                    </div>
                    {editUser?.googleId && (
                      <div className="col-span-2">
                        <span className="text-gray-500">Google ID</span>
                        <p className="font-medium text-gray-900 font-mono text-xs">{editUser.googleId}</p>
                      </div>
                    )}
                    <div className="col-span-2">
                      <span className="text-gray-500">User ID</span>
                      <p className="font-medium text-gray-900 font-mono text-xs">{editingUserId}</p>
                    </div>
                  </div>
                </div>

                {/* Subscription Details — full read-only view of every IUser.subscription field */}
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide flex items-center justify-between">
                    <span>Subscription Details</span>
                    {getSubscriptionBadge(editUser?.subscription) || (
                      <span className="text-xs text-gray-400 normal-case font-normal">No active plan</span>
                    )}
                  </h3>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-gray-500">Plan</span>
                      <p className="font-medium text-gray-900">{editUser?.subscription?.plan || "none"}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Active</span>
                      <p className={`font-medium ${editUser?.subscription?.isActive ? "text-green-700" : "text-red-700"}`}>
                        {editUser?.subscription?.isActive ? "Yes" : "No"}
                      </p>
                    </div>
                    <div>
                      <span className="text-gray-500">Platform</span>
                      <p className="font-medium text-gray-900">{editUser?.subscription?.platform || "-"}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Trial</span>
                      <p className="font-medium text-gray-900">{editUser?.subscription?.isTrial ? "Yes" : "No"}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Started</span>
                      <p className="font-medium text-gray-900">{formatDate(editUser?.subscription?.startedAt)}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Expires</span>
                      <p className="font-medium text-gray-900">
                        {editUser?.subscription?.expiresAt
                          ? formatDate(editUser.subscription.expiresAt)
                          : editUser?.subscription?.plan === "premium_lifetime"
                            ? "Never (lifetime)"
                            : "-"}
                      </p>
                    </div>
                    <div>
                      <span className="text-gray-500">Last verified</span>
                      <p className="font-medium text-gray-900">{formatDate(editUser?.subscription?.lastVerifiedAt)}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Cancelled</span>
                      <p className="font-medium text-gray-900">
                        {editUser?.subscription?.cancelledAt ? formatDate(editUser.subscription.cancelledAt) : "-"}
                      </p>
                    </div>
                    {editUser?.subscription?.productId && (
                      <div className="col-span-2">
                        <span className="text-gray-500">Product ID</span>
                        <p className="font-medium text-gray-900 font-mono text-xs break-all">{editUser.subscription.productId}</p>
                      </div>
                    )}
                    {editUser?.subscription?.originalTransactionId && (
                      <div className="col-span-2">
                        <span className="text-gray-500">Original transaction ID</span>
                        <p className="font-medium text-gray-900 font-mono text-xs break-all">{editUser.subscription.originalTransactionId}</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Admin Overrides — bypass Apple/Google. Sets platform='admin' on the server. */}
                <div className="bg-rose-50 border border-rose-200 rounded-lg p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Admin Overrides</h3>
                  <p className="text-xs text-gray-600">
                    These actions bypass Apple/Google verification. The server stamps <code className="bg-white px-1 rounded">platform=admin</code> so the override is auditable.
                  </p>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Plan</label>
                      <select
                        value={subPlanDraft}
                        onChange={(e) => setSubPlanDraft(e.target.value)}
                        className="w-full bg-white text-gray-900 border border-gray-300 rounded px-2 py-1.5 text-sm"
                      >
                        <option value="none">none (no plan)</option>
                        <option value="remove_ads">remove_ads</option>
                        <option value="premium_monthly">premium_monthly</option>
                        <option value="premium_yearly">premium_yearly</option>
                        <option value="premium_lifetime">premium_lifetime</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Expires (optional)</label>
                      <Input
                        type="date"
                        value={subExpiresDraft}
                        onChange={(e) => setSubExpiresDraft(e.target.value)}
                        className="bg-white text-gray-900 border-gray-300 text-sm"
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button
                      size="sm"
                      onClick={() =>
                        updateSubMutation.mutate({
                          userId: editingUserId,
                          plan: subPlanDraft,
                          expiresAt: subExpiresDraft ? new Date(subExpiresDraft).toISOString() : null,
                        })
                      }
                      disabled={updateSubMutation.isPending}
                      className="bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      {updateSubMutation.isPending ? <Loader2 className="mr-1 animate-spin" size={14} /> : null}
                      Save plan
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        if (window.confirm("Grant lifetime premium to this user (admin override)?")) {
                          grantLifetimeMutation.mutate(editingUserId);
                        }
                      }}
                      disabled={grantLifetimeMutation.isPending}
                      className="bg-white text-purple-700 border-purple-300 hover:bg-purple-50"
                    >
                      <Crown size={14} className="mr-1" />
                      Grant lifetime
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        if (window.confirm("Cancel this user's subscription? They will lose premium access immediately.")) {
                          cancelSubMutation.mutate(editingUserId);
                        }
                      }}
                      disabled={cancelSubMutation.isPending || !editUser?.subscription?.isActive}
                      className="bg-white text-red-700 border-red-300 hover:bg-red-50 disabled:opacity-50"
                    >
                      <Ban size={14} className="mr-1" />
                      Cancel subscription
                    </Button>
                  </div>
                </div>

                <div className="flex gap-2 justify-end pt-4 border-t border-gray-200">
                  <Button
                    variant="outline"
                    onClick={() => setEditingUserId(null)}
                    disabled={updateUserMutation.isPending}
                    className="bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => handleSaveEdit(editingUserId)}
                    disabled={updateUserMutation.isPending}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    {updateUserMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 animate-spin" size={16} />
                        Saving...
                      </>
                    ) : (
                      "Save Changes"
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
