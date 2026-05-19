import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { 
  Radio, 
  Globe, 
  Languages, 
  Music, 
  Settings, 
  BarChart3, 
  Users, 
  FileText,
  Database,
  Activity,
  TrendingUp,
  Clock,
  CheckCircle,
  AlertCircle,
  Image,
  ShieldAlert,
  CalendarClock
} from "lucide-react";
import { Link } from "wouter";
import { RetryTrendSparkline, type RetryTrendRun } from "@/components/admin/RetryTrendSparkline";

interface DashboardStats {
  totalStations: number;
  totalCountries: number;
  totalLanguages: number;
  totalGenres: number;
  totalCodecs: number;
  workingStations: number;
  offlineStations: number;
  workingPercentage: number;
  recentlyUpdated: number;
  unresolvedErrors: number;
  totalUsers: number;
  activeRegisteredUsers: number;
  openFeedback: number;
  stationsWithFavicon: number;
  faviconPercentage: number;
  stationsWithDesc: number;
  descriptionPercentage: number;
  activeVisitors: number;
  todayVisitors: number;
  weekVisitors: number;
  topCountries: Array<{ name: string; count: number }>;
  topGenres: Array<{ name: string; count: number }>;
  codecDistribution: Array<{ name: string; count: number }>;
  syncStatus: {
    isRunning: boolean;
    lastSync: string | null;
    lastSyncStatus: string;
    isHealthy: boolean;
  };
  health?: {
    database: 'online' | 'offline';
    radioBrowser: 'online' | 'stale' | 'offline';
    translations: 'active' | 'empty';
    lastSyncHoursAgo: number | null;
  };
  recentSyncDate?: string | null;
}

type HealthLevel = 'good' | 'degraded' | 'issue';
function deriveOverallHealth(h: DashboardStats['health']): HealthLevel {
  if (!h) return 'good';
  if (h.database === 'offline' || h.translations === 'empty') return 'issue';
  if (h.radioBrowser === 'offline') return 'issue';
  if (h.radioBrowser === 'stale') return 'degraded';
  return 'good';
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

export default function AdminDashboard() {
  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
    staleTime: 30000, // Cache for 30 seconds
    refetchOnWindowFocus: false,
  });

  const { data: languages } = useQuery({
    queryKey: ["/api/admin/translation-languages"],
    staleTime: 60000, // Cache for 1 minute
    refetchOnWindowFocus: false,
  });

  const { data: autoFlaggedReport, isLoading: isLoadingAutoFlagged } = useQuery<{
    last: { syncType: string; status: string; startedAt: string; completedAt: string | null; autoFlagged: number } | null;
    lastCompleted: { startedAt: string; completedAt: string | null; autoFlagged: number } | null;
  }>({
    queryKey: ["/api/admin/sync/auto-flagged-report"],
    staleTime: 30000,
    refetchOnWindowFocus: false,
  });

  const { data: backfillStatus, isLoading: isLoadingBackfill } = useQuery<{
    status: { isRunning: boolean; lastRunAt: string | null; lastRunId: string | null };
    lastRun: {
      _id: string;
      trigger: string;
      status: "running" | "completed" | "failed";
      topN: number;
      startedAt: string;
      finishedAt?: string;
      durationMs?: number;
      logos: Array<{ countryCode: string; candidates: number; enqueued: number }>;
      tags: Array<{ countryCode: string; processed: number; hydrated: number; emptyUpstream: number; failed: number }>;
      errorMessage?: string;
      attempts?: Array<{ attempt: number; error: string; failedAt: string }>;
    } | null;
  }>({
    queryKey: ["/api/admin/maintenance/scheduled-backfill/status"],
    staleTime: 30000,
    refetchInterval: (q) => (q.state.data?.status?.isRunning ? 5000 : false),
    refetchOnWindowFocus: false,
  });

  const { data: backfillRunsData } = useQuery<{ runs: RetryTrendRun[] }>({
    queryKey: ["/api/admin/maintenance/scheduled-backfill/runs", "trend"],
    queryFn: async () => {
      const res = await fetch(
        "/api/admin/maintenance/scheduled-backfill/runs?limit=10",
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    staleTime: 30000,
    refetchInterval: () =>
      backfillStatus?.status?.isRunning ? 5000 : false,
    refetchOnWindowFocus: false,
  });

  const quickActions = [
    {
      title: "Manage Stations",
      description: "Add, edit, and organize radio stations",
      icon: Radio,
      href: "/admin/stations",
      color: "bg-blue-500"
    },
    {
      title: "Logo Management",
      description: "Scan station logos and mirror them to S3",
      icon: Image,
      href: "/admin/logos",
      color: "bg-amber-500"
    },
    {
      title: "Coverage by Country",
      description: "Spot markets with missing logos or tags",
      icon: Globe,
      href: "/admin/coverage",
      color: "bg-teal-500"
    },
    {
      title: "Translation Management",
      description: "Manage translation keys and strings",
      icon: Languages,
      href: "/admin/translations",
      color: "bg-green-500"
    },
    {
      title: "URL Translations",
      description: "Manage multilingual URL paths (SEO)",
      icon: Languages,
      href: "/admin/url-translations",
      color: "bg-indigo-500"
    },
    {
      title: "Language Configuration", 
      description: "Configure supported languages",
      icon: Globe,
      href: "/admin/translation-languages",
      color: "bg-purple-500"
    },
    {
      title: "Database Languages", 
      description: "View real languages from station data",
      icon: Database,
      href: "/admin/real-languages",
      color: "bg-indigo-500"
    },
    {
      title: "Advertisement Management",
      description: "Manage ads displayed on station pages",
      icon: Music,
      href: "/admin/advertisements",
      color: "bg-cyan-500"
    },
    {
      title: "Sync Status",
      description: "Monitor Radio-Browser API sync",
      icon: Activity,
      href: "/admin/sync",
      color: "bg-orange-500"
    },
    {
      title: "Users Management",
      description: "Manage all registered users and their profiles",
      icon: Users,
      href: "/admin/users",
      color: "bg-green-600"
    },
    {
      title: "Analytics",
      description: "View usage statistics and reports",
      icon: BarChart3,
      href: "/admin/analytics",
      color: "bg-pink-500"
    },
    {
      title: "System Settings",
      description: "Configure system preferences",
      icon: Settings,
      href: "/admin/settings",
      color: "bg-gray-500"
    },
    {
      title: "Database",
      description: "Monitor storage & cleanup collections",
      icon: Database,
      href: "/admin/db-management",
      color: "bg-red-600"
    }
  ];

  const recentActivity = [
    { 
      action: "Station Sync Completed", 
      time: "5 minutes ago",
      status: "success",
      details: `${stats?.totalStations || 0} stations synchronized`
    },
    { 
      action: "Translation Update", 
      time: "1 hour ago",
      status: "info",
      details: `${Array.isArray(languages) ? languages.length : 0} languages configured`
    },
    { 
      action: "Performance Check", 
      time: "2 hours ago",
      status: "success",
      details: "All systems operational"
    }
  ];

  if (isLoading) {
    return (
      <div className="container mx-auto p-6">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-300 rounded w-1/4"></div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-32 bg-gray-300 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold">Admin Dashboard</h1>
          <p className="text-muted-foreground">
            Manage your radio station platform
          </p>
        </div>
        {(() => {
          const level = deriveOverallHealth(stats?.health);
          if (level === 'good') {
            return (
              <div className="flex items-center gap-2 px-3 py-1 border border-green-300 bg-green-50 rounded-md text-sm text-green-800">
                <CheckCircle className="w-4 h-4 text-green-600" />
                System Online
              </div>
            );
          }
          if (level === 'degraded') {
            return (
              <div className="flex items-center gap-2 px-3 py-1 border border-yellow-300 bg-yellow-50 rounded-md text-sm text-yellow-800">
                <AlertCircle className="w-4 h-4 text-yellow-600" />
                System Degraded
              </div>
            );
          }
          return (
            <div className="flex items-center gap-2 px-3 py-1 border border-red-300 bg-red-50 rounded-md text-sm text-red-800">
              <ShieldAlert className="w-4 h-4 text-red-600" />
              System Issue
            </div>
          );
        })()}
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Active Users (Now)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-2xl font-bold text-green-600">{stats?.activeVisitors || 0}</div>
              <Users className="w-6 h-6 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Visitors Today
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-2xl font-bold">{stats?.todayVisitors || 0}</div>
              <Activity className="w-6 h-6 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Visitors This Week
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-2xl font-bold">{stats?.weekVisitors || 0}</div>
              <TrendingUp className="w-6 h-6 text-purple-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Registered Users
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-2xl font-bold">{stats?.totalUsers || 0}</div>
              <Users className="w-6 h-6 text-indigo-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Secondary Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Stations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-2xl font-bold">{stats?.totalStations?.toLocaleString() || 0}</div>
              <Radio className="w-6 h-6 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Countries
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-2xl font-bold">{stats?.totalCountries || 0}</div>
              <Globe className="w-6 h-6 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Languages
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-2xl font-bold">{Array.isArray(languages) ? languages.length : 0}</div>
              <Languages className="w-6 h-6 text-purple-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Genres
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-2xl font-bold">{stats?.totalGenres || 0}</div>
              <Music className="w-6 h-6 text-orange-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Station Quality Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Stations Online
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-3xl font-bold text-green-600">{stats?.workingStations || 0}</span>
                <CheckCircle className="w-6 h-6 text-green-500" />
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-green-500 h-2 rounded-full transition-all"
                  style={{ width: `${stats?.workingPercentage || 0}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">{stats?.workingPercentage || 0}% working</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              With Favicons
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-3xl font-bold text-blue-600">{stats?.stationsWithFavicon || 0}</span>
                <Image className="w-6 h-6 text-blue-500" />
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-blue-500 h-2 rounded-full transition-all"
                  style={{ width: `${stats?.faviconPercentage || 0}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">{stats?.faviconPercentage || 0}% have logos</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              With Descriptions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-3xl font-bold text-purple-600">{stats?.stationsWithDesc || 0}</span>
                <FileText className="w-6 h-6 text-purple-500" />
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-purple-500 h-2 rounded-full transition-all"
                  style={{ width: `${stats?.descriptionPercentage || 0}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">{stats?.descriptionPercentage || 0}% with AI descriptions</p>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-auto-flagged">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Auto-flagged this run
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoadingAutoFlagged ? (
              <div className="space-y-2 animate-pulse">
                <div className="h-8 bg-gray-200 rounded w-1/2" />
                <div className="h-3 bg-gray-200 rounded w-3/4" />
                <div className="h-3 bg-gray-200 rounded w-2/3" />
              </div>
            ) : autoFlaggedReport?.last || autoFlaggedReport?.lastCompleted ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span
                    className="text-3xl font-bold text-amber-600"
                    data-testid="text-auto-flagged-current"
                  >
                    {autoFlaggedReport.last?.autoFlagged ?? 0}
                  </span>
                  <ShieldAlert className="w-6 h-6 text-amber-500" />
                </div>
                {autoFlaggedReport.last && (
                  <p className="text-xs text-muted-foreground">
                    Current run: {autoFlaggedReport.last.status}
                    {autoFlaggedReport.last.syncType ? ` · ${autoFlaggedReport.last.syncType}` : ''}
                  </p>
                )}
                {autoFlaggedReport.lastCompleted ? (
                  <p
                    className="text-xs text-muted-foreground"
                    data-testid="text-auto-flagged-last-completed"
                  >
                    Last completed:{' '}
                    {new Date(
                      autoFlaggedReport.lastCompleted.completedAt ??
                        autoFlaggedReport.lastCompleted.startedAt,
                    ).toLocaleString()}{' '}
                    · {autoFlaggedReport.lastCompleted.autoFlagged} flagged
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">No completed sync yet</p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-3xl font-bold text-muted-foreground">0</span>
                  <ShieldAlert className="w-6 h-6 text-muted-foreground" />
                </div>
                <p className="text-xs text-muted-foreground">No sync runs recorded yet</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Retry trend warning banner */}
      {(() => {
        const runs = backfillRunsData?.runs ?? [];
        if (runs.length < 6) return null;
        const sorted = [...runs].sort(
          (a, b) =>
            new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
        );
        const last3 = sorted.slice(0, 3);
        const prior3 = sorted.slice(3, 6);
        const retryCount = (r: RetryTrendRun) => (r.attempts ?? []).length;
        const last3Avg =
          last3.reduce((s, r) => s + retryCount(r), 0) / last3.length;
        const prior3Avg =
          prior3.reduce((s, r) => s + retryCount(r), 0) / prior3.length;
        const delta = last3Avg - prior3Avg;
        const meaningful = last3Avg > prior3Avg && delta >= 1;
        if (!meaningful) return null;
        return (
          <div
            className="rounded-md border border-amber-300 bg-amber-50 p-3 flex items-start gap-3"
            data-testid="banner-retry-trend-warning"
          >
            <AlertCircle className="w-5 h-5 text-amber-700 mt-0.5 shrink-0" />
            <div className="flex-1 text-sm text-amber-900">
              <div className="font-semibold">Retries are climbing</div>
              <div
                className="text-xs text-amber-800"
                data-testid="text-retry-trend-warning-detail"
              >
                Last 3 runs averaged {last3Avg.toFixed(1)} retr
                {last3Avg === 1 ? "y" : "ies"}/run vs {prior3Avg.toFixed(1)} the
                prior 3.
              </div>
            </div>
            <Link href="/admin/seo-maintenance">
              <Button
                variant="outline"
                size="sm"
                data-testid="button-retry-trend-warning-view"
              >
                View history
              </Button>
            </Link>
          </div>
        );
      })()}

      {/* Last weekly backfill health card */}
      <Card data-testid="card-last-weekly-backfill">
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="w-4 h-4" />
              Last weekly backfill
            </CardTitle>
            <CardDescription>
              Sunday 04:00 (Europe/Berlin) cross-country logo + tag sweep
            </CardDescription>
          </div>
          <div className="flex items-center gap-3">
            {backfillRunsData && backfillRunsData.runs.length > 0 && (
              <div className="hidden md:block">
                <RetryTrendSparkline
                  runs={backfillRunsData.runs}
                  width={180}
                  height={40}
                  testId="dashboard-retry-trend"
                />
              </div>
            )}
            {backfillStatus?.lastRun?._id && (
              <Link
                href={`/admin/seo-maintenance?runId=${encodeURIComponent(backfillStatus.lastRun._id)}#backfill-run-${backfillStatus.lastRun._id}`}
              >
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="button-view-backfill-run-details"
                >
                  View details
                </Button>
              </Link>
            )}
            <Link href="/admin/seo-maintenance">
              <Button variant="outline" size="sm" data-testid="button-open-seo-maintenance">
                Manage
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {isLoadingBackfill ? (
            <div className="space-y-2 animate-pulse">
              <div className="h-5 bg-gray-200 rounded w-1/3" />
              <div className="h-3 bg-gray-200 rounded w-2/3" />
              <div className="h-3 bg-gray-200 rounded w-1/2" />
            </div>
          ) : !backfillStatus?.lastRun ? (
            <div className="text-sm text-muted-foreground" data-testid="text-no-backfill-runs">
              No weekly backfill runs recorded yet.
            </div>
          ) : (() => {
            const run = backfillStatus.lastRun;
            const finishedAtRaw = run.finishedAt ?? run.startedAt;
            const finishedAt = new Date(finishedAtRaw);
            const now = Date.now();
            const diffMs = Math.max(0, now - finishedAt.getTime());
            const fmtAgo = (ms: number) => {
              const sec = Math.round(ms / 1000);
              if (sec < 60) return `${sec}s ago`;
              const min = Math.round(sec / 60);
              if (min < 60) return `${min}m ago`;
              const hr = Math.round(min / 60);
              if (hr < 48) return `${hr}h ago`;
              return `${Math.round(hr / 24)}d ago`;
            };
            const failedTagCountries = run.tags.filter((t) => t.failed > 0);
            const isFailed = run.status === "failed";
            const isRunning = run.status === "running";
            const attempts = run.attempts ?? [];
            const retryCount = attempts.length;
            const recovered = !isFailed && !isRunning && retryCount > 0;
            const containerClass = isFailed
              ? "border-rose-200 bg-rose-50"
              : isRunning
              ? "border-blue-200 bg-blue-50"
              : recovered
              ? "border-amber-200 bg-amber-50"
              : "border-emerald-200 bg-emerald-50";
            const StatusIcon = isFailed
              ? AlertCircle
              : isRunning
              ? Activity
              : recovered
              ? AlertCircle
              : CheckCircle;
            const statusIconClass = isFailed
              ? "text-rose-600"
              : isRunning
              ? "text-blue-600"
              : recovered
              ? "text-amber-700"
              : "text-emerald-600";
            const statusText = isFailed
              ? retryCount > 0
                ? `Failed after ${retryCount + 1} attempts`
                : "Failed"
              : isRunning
              ? "Running…"
              : recovered
              ? `Recovered after ${retryCount} failed attempt${retryCount === 1 ? "" : "s"}, finished ${fmtAgo(diffMs)}`
              : `Clean, finished ${fmtAgo(diffMs)}`;
            const totalLogosEnqueued = run.logos.reduce((s, c) => s + c.enqueued, 0);
            const totalTagsHydrated = run.tags.reduce((s, c) => s + c.hydrated, 0);
            return (
              <div className={`rounded-md border p-3 space-y-2 ${containerClass}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <StatusIcon className={`w-4 h-4 ${statusIconClass}`} />
                  <span
                    className={`text-sm font-semibold ${statusIconClass}`}
                    data-testid="text-backfill-status"
                  >
                    {statusText}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    · trigger <code>{run.trigger}</code>
                    {` · top-${run.topN}`}
                    {typeof run.durationMs === "number" &&
                      ` · ${Math.round(run.durationMs / 1000)}s`}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Started {new Date(run.startedAt).toLocaleString()}
                  {run.finishedAt && ` · finished ${new Date(run.finishedAt).toLocaleString()}`}
                </div>
                {isFailed && run.errorMessage && (
                  <div
                    className="text-xs text-rose-700 bg-white border border-rose-200 rounded px-2 py-1"
                    data-testid="text-backfill-error"
                  >
                    Error: {run.errorMessage}
                  </div>
                )}
                {attempts.length > 0 && (
                  <details
                    className="text-xs"
                    data-testid="details-backfill-attempts"
                  >
                    <summary
                      className={`cursor-pointer ${
                        recovered ? "text-amber-700" : "text-rose-700"
                      }`}
                    >
                      {retryCount} failed attempt{retryCount === 1 ? "" : "s"} before final outcome
                    </summary>
                    <ul className="mt-1 space-y-1 pl-4">
                      {attempts.map((a) => (
                        <li
                          key={`attempt-${a.attempt}-${a.failedAt}`}
                          className="bg-white border border-slate-200 rounded px-2 py-1"
                          data-testid={`backfill-attempt-${a.attempt}`}
                        >
                          <span className="font-mono text-slate-600">
                            #{a.attempt}
                          </span>{" "}
                          <span className="text-slate-500">
                            {new Date(a.failedAt).toLocaleString()}
                          </span>
                          <div className="text-rose-700 break-words">
                            {a.error || "(no error message)"}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {isFailed && (
                  <div>
                    <Link
                      href={`/admin/seo-maintenance?runId=${encodeURIComponent(run._id)}#backfill-run-${run._id}`}
                    >
                      <Button
                        size="sm"
                        variant="destructive"
                        data-testid="button-view-failed-backfill-run"
                      >
                        View failed run details →
                      </Button>
                    </Link>
                  </div>
                )}
                {isFailed && (run.logos.length > 0 || run.tags.length > 0) && (
                  <div className="text-xs text-rose-700">
                    Countries attempted:{" "}
                    <span className="font-mono">
                      {Array.from(
                        new Set([
                          ...run.logos.map((c) => c.countryCode),
                          ...run.tags.map((c) => c.countryCode),
                        ]),
                      ).join(", ") || "—"}
                    </span>
                  </div>
                )}
                {!isFailed && failedTagCountries.length > 0 && (
                  <div className="text-xs text-amber-700">
                    Tag failures in:{" "}
                    <span className="font-mono">
                      {failedTagCountries
                        .map((c) => `${c.countryCode} (${c.failed})`)
                        .join(", ")}
                    </span>
                  </div>
                )}
                {!isFailed && (
                  <div className="text-xs text-muted-foreground">
                    {run.logos.length} logo countr{run.logos.length === 1 ? "y" : "ies"} ·{" "}
                    <strong className="text-emerald-700">{totalLogosEnqueued}</strong> logos enqueued ·{" "}
                    {run.tags.length} tag countr{run.tags.length === 1 ? "y" : "ies"} ·{" "}
                    <strong className="text-emerald-700">{totalTagsHydrated}</strong> tags hydrated
                  </div>
                )}
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
          <CardDescription>
            Common administrative tasks
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {quickActions.map((action, index) => (
              <Link key={index} href={action.href}>
                <Button
                  variant="outline"
                  className="h-auto p-4 flex flex-col items-start gap-3 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-3 w-full">
                    <div className={`p-2 rounded-lg ${action.color}`}>
                      <action.icon className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1 text-left">
                      <div className="font-medium">{action.title}</div>
                      <div className="text-sm text-muted-foreground">
                        {action.description}
                      </div>
                    </div>
                  </div>
                </Button>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentActivity.map((activity, index) => (
                <div key={index} className="flex items-start gap-3 p-3 rounded-lg bg-gray-50">
                  <div className={`p-1 rounded-full ${
                    activity.status === 'success' ? 'bg-green-100' : 'bg-blue-100'
                  }`}>
                    <CheckCircle className={`w-3 h-3 ${
                      activity.status === 'success' ? 'text-green-600' : 'text-blue-600'
                    }`} />
                  </div>
                  <div className="flex-1">
                    <div className="font-medium text-sm">{activity.action}</div>
                    <div className="text-xs text-muted-foreground">{activity.details}</div>
                    <div className="text-xs text-muted-foreground mt-1">{activity.time}</div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5" />
              System Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {(() => {
                const greenChip = (text: string) => (
                  <div className="px-2 py-1 border rounded text-xs text-green-700 border-green-500 bg-green-50">{text}</div>
                );
                const yellowChip = (text: string) => (
                  <div className="px-2 py-1 border rounded text-xs text-yellow-700 border-yellow-500 bg-yellow-50">{text}</div>
                );
                const redChip = (text: string) => (
                  <div className="px-2 py-1 border rounded text-xs text-red-700 border-red-500 bg-red-50">{text}</div>
                );
                const h = stats?.health;
                return (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-sm">Database Connection</span>
                      {h?.database === 'online' ? greenChip('Online') : redChip('Offline')}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm">Radio-Browser API</span>
                      {h?.radioBrowser === 'online'
                        ? greenChip('Online')
                        : h?.radioBrowser === 'stale'
                        ? yellowChip(`Stale (${h.lastSyncHoursAgo}h ago)`)
                        : redChip('Offline (no sync)')}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm">Translation System</span>
                      {h?.translations === 'active' ? greenChip('Active') : redChip('Empty')}
                    </div>
                  </>
                );
              })()}
              <div className="flex items-center justify-between">
                <span className="text-sm">Last Sync</span>
                <span className="text-sm text-muted-foreground">
                  {stats?.syncStatus?.lastSync ? new Date(stats.syncStatus.lastSync).toLocaleString() : 'Never'}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}