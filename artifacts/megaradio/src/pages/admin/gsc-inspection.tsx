import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  RefreshCcw,
  Search as SearchIcon,
  XCircle,
} from 'lucide-react';
import { format } from 'date-fns';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface StatusResponse {
  configured: boolean;
  cronEnabled: boolean;
  siteUrl: string | null;
  discoveryRunning: boolean;
  inspectionRunning: boolean;
  resubmitRunning: boolean;
  lastDiscoveryAt: string | null;
  lastInspectionAt: string | null;
  lastResubmitAt: string | null;
  lastDiscoveryStats: {
    inserted: number;
    refreshed: number;
    pruned: number;
    discovered: number;
  } | null;
  lastInspectionStats: {
    attempted: number;
    succeeded: number;
    failed: number;
  } | null;
  lastResubmitStats: {
    attempted: number;
    succeeded: number;
    failed: number;
    sitemapRebuilt: boolean;
  } | null;
  defaultBatchSize: number;
  stationDiscoveryCapPerLanguage: number;
  resubmitStuckDays: number;
  resubmitCooldownDays: number;
  resubmitBatchLimit: number;
  totalUrls: number;
  stuckUrls: number;
  lastSnapshotAt?: string | null;
  lastSnapshotStats?: { rows: number; date: string } | null;
}

interface TrendRow {
  date: string;
  language: string;
  group: string;
  total: number;
  indexed: number;
  crawledNotIndexed: number;
  discoveredNotIndexed: number;
  excluded: number;
  error: number;
  pending: number;
  unknown: number;
}

interface TrendsResponse {
  days: number;
  language: string;
  group: string;
  rows: TrendRow[];
}

type GscState =
  | 'indexed'
  | 'crawled-not-indexed'
  | 'discovered-not-indexed'
  | 'excluded'
  | 'error'
  | 'unknown'
  | 'pending';

interface ByGroupRow {
  group: 'static' | 'country' | 'station' | 'genre';
  total: number;
  indexed: number;
  crawledNotIndexed: number;
  discoveredNotIndexed: number;
  excluded: number;
  error: number;
  pending: number;
}

interface StatsResponse {
  total: number;
  byState: { state: GscState; count: number }[];
  byGroup: ByGroupRow[];
  byLanguage: { language: string; total: number; indexed: number }[];
}

interface UrlRow {
  _id: string;
  url: string;
  language: string;
  group: ByGroupRow['group'];
  state: GscState;
  coverageState?: string;
  verdict?: string;
  lastCrawlTime?: string;
  lastInspectedAt?: string;
  lastError?: string;
  inspectionResultLink?: string;
  notIndexedSince?: string;
  lastResubmitAt?: string;
  lastResubmitStatus?: 'success' | 'failed';
  lastResubmitError?: string;
  resubmitCount?: number;
}

interface UrlsResponse {
  rows: UrlRow[];
  pagination: { page: number; limit: number; total: number; pages: number };
}

const STATE_LABEL: Record<GscState, string> = {
  indexed: 'Indexed',
  'crawled-not-indexed': 'Crawled — not indexed',
  'discovered-not-indexed': 'Discovered — not indexed',
  excluded: 'Excluded',
  error: 'Error',
  unknown: 'Unknown',
  pending: 'Not yet inspected',
};

function StateBadge({ state }: { state: GscState }) {
  const cls: Record<GscState, string> = {
    indexed: 'bg-green-600 hover:bg-green-700',
    'crawled-not-indexed': 'bg-amber-600 hover:bg-amber-700',
    'discovered-not-indexed': 'bg-orange-600 hover:bg-orange-700',
    excluded: 'bg-zinc-600 hover:bg-zinc-700',
    error: 'bg-red-600 hover:bg-red-700',
    unknown: 'bg-zinc-700 hover:bg-zinc-800',
    pending: 'bg-blue-600 hover:bg-blue-700',
  };
  const Icon =
    state === 'indexed'
      ? CheckCircle2
      : state === 'error'
      ? XCircle
      : state === 'pending'
      ? Clock
      : AlertCircle;
  return (
    <Badge className={`${cls[state]} text-white`}>
      <Icon className="w-3 h-3 mr-1" />
      {STATE_LABEL[state]}
    </Badge>
  );
}

function fmt(ts?: string | null): string {
  if (!ts) return '—';
  try {
    return format(new Date(ts), 'MMM dd, HH:mm');
  } catch {
    return '—';
  }
}

/**
 * Read the initial filter values from the current URL search params so
 * deep-links from emails (e.g. the Task #355 weekly stuck/resubmit
 * digest) pre-filter the table on mount. Falls back to "all" for any
 * param that isn't present.
 */
function readInitialFiltersFromUrl(): {
  language: string;
  group: string;
  state: string;
  search: string;
} {
  if (typeof window === 'undefined') {
    return { language: 'all', group: 'all', state: 'all', search: '' };
  }
  const params = new URLSearchParams(window.location.search);
  return {
    language: params.get('language') ?? 'all',
    group: params.get('group') ?? 'all',
    state: params.get('state') ?? 'all',
    search: params.get('search') ?? '',
  };
}

export default function GscInspectionPage() {
  const queryClient = useQueryClient();
  const initialFilters = readInitialFiltersFromUrl();
  const [language, setLanguage] = useState(initialFilters.language);
  const [group, setGroup] = useState(initialFilters.group);
  const [state, setState] = useState(initialFilters.state);
  const [search, setSearch] = useState(initialFilters.search);
  const [page, setPage] = useState(1);
  const [trendDays, setTrendDays] = useState<'30' | '90'>('30');
  const [trendLanguage, setTrendLanguage] = useState('all');
  const [trendGroup, setTrendGroup] = useState('all');

  const { data: status, isLoading: statusLoading } = useQuery<StatusResponse>({
    queryKey: ['/api/admin/gsc-inspection/status'],
    refetchInterval: 30_000,
  });

  const { data: stats } = useQuery<StatsResponse>({
    queryKey: ['/api/admin/gsc-inspection/stats'],
    refetchInterval: 30_000,
  });

  const { data: urls, isLoading: urlsLoading } = useQuery<UrlsResponse>({
    queryKey: [
      '/api/admin/gsc-inspection/urls',
      { language, group, state, search, page },
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (language !== 'all') params.set('language', language);
      if (group !== 'all') params.set('group', group);
      if (state !== 'all') params.set('state', state);
      if (search.trim()) params.set('search', search.trim());
      params.set('page', String(page));
      params.set('limit', '50');
      const r = await fetch(
        `/api/admin/gsc-inspection/urls?${params.toString()}`,
      );
      if (!r.ok) throw new Error('Failed to load URLs');
      return r.json();
    },
  });

  const refreshBatch = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/admin/gsc-inspection/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      return r.json();
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: ['/api/admin/gsc-inspection/status'],
      });
      queryClient.invalidateQueries({
        queryKey: ['/api/admin/gsc-inspection/stats'],
      });
      queryClient.invalidateQueries({
        queryKey: ['/api/admin/gsc-inspection/urls'],
      });
    },
  });

  const resubmitStuck = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/admin/gsc-inspection/resubmit-stuck', {
        method: 'POST',
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      return r.json();
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: ['/api/admin/gsc-inspection/status'],
      });
      queryClient.invalidateQueries({
        queryKey: ['/api/admin/gsc-inspection/stats'],
      });
      queryClient.invalidateQueries({
        queryKey: ['/api/admin/gsc-inspection/urls'],
      });
    },
  });

  const { data: trends, isLoading: trendsLoading } = useQuery<TrendsResponse>({
    queryKey: [
      '/api/admin/gsc-inspection/trends',
      { days: trendDays, language: trendLanguage, group: trendGroup },
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('days', trendDays);
      params.set('language', trendLanguage);
      params.set('group', trendGroup);
      const r = await fetch(
        `/api/admin/gsc-inspection/trends?${params.toString()}`,
      );
      if (!r.ok) throw new Error('Failed to load trends');
      return r.json();
    },
    refetchInterval: 60_000,
  });

  const recordSnapshot = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/admin/gsc-inspection/snapshot', {
        method: 'POST',
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      return r.json();
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: ['/api/admin/gsc-inspection/status'],
      });
      queryClient.invalidateQueries({
        queryKey: ['/api/admin/gsc-inspection/trends'],
      });
    },
  });

  const rediscover = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/admin/gsc-inspection/discover', {
        method: 'POST',
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      return r.json();
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: ['/api/admin/gsc-inspection/status'],
      });
      queryClient.invalidateQueries({
        queryKey: ['/api/admin/gsc-inspection/stats'],
      });
      queryClient.invalidateQueries({
        queryKey: ['/api/admin/gsc-inspection/urls'],
      });
    },
  });

  // Collapse the trend rows into a chart-friendly array. The /trends
  // endpoint already filtered by language+group, but if both are 'all'
  // we still get 1 row per day (the cross-cutting overall row); if the
  // admin drills into e.g. language=de + group=all we get 1 row per day
  // for that combination.
  const trendChartData = useMemo(() => {
    if (!trends?.rows.length) return [] as Array<{
      date: string;
      label: string;
      total: number;
      indexed: number;
      crawledNotIndexed: number;
      discoveredNotIndexed: number;
      indexedPct: number;
    }>;
    // Group by date in case multiple rows match (shouldn't happen given
    // the filter, but defensive).
    const byDate = new Map<
      string,
      {
        date: string;
        label: string;
        total: number;
        indexed: number;
        crawledNotIndexed: number;
        discoveredNotIndexed: number;
      }
    >();
    for (const r of trends.rows) {
      const d = new Date(r.date);
      const key = d.toISOString().slice(0, 10);
      const existing = byDate.get(key);
      if (existing) {
        existing.total += r.total;
        existing.indexed += r.indexed;
        existing.crawledNotIndexed += r.crawledNotIndexed;
        existing.discoveredNotIndexed += r.discoveredNotIndexed;
      } else {
        byDate.set(key, {
          date: key,
          label: format(d, 'MMM dd'),
          total: r.total,
          indexed: r.indexed,
          crawledNotIndexed: r.crawledNotIndexed,
          discoveredNotIndexed: r.discoveredNotIndexed,
        });
      }
    }
    return Array.from(byDate.values())
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((d) => ({
        ...d,
        indexedPct: d.total ? Math.round((d.indexed / d.total) * 1000) / 10 : 0,
      }));
  }, [trends]);

  const indexedPct = useMemo(() => {
    if (!stats || !stats.total) return 0;
    const indexed =
      stats.byState.find((s) => s.state === 'indexed')?.count ?? 0;
    return Math.round((indexed / stats.total) * 100);
  }, [stats]);

  const languages = useMemo(
    () => stats?.byLanguage.map((l) => l.language).sort() ?? [],
    [stats],
  );

  return (
    <div className="min-h-screen bg-[#0E0E0E] text-white p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold mb-2">GSC URL Inspection</h1>
          <p className="text-gray-400">
            Cached Google Search Console results for every URL we publish in
            the sitemap. Refreshed automatically on a schedule.
          </p>
        </div>

        {!statusLoading && status && !status.configured && (
          <Card className="bg-amber-950/40 border-amber-700/60">
            <CardHeader>
              <CardTitle className="text-amber-200 flex items-center gap-2">
                <AlertCircle className="w-5 h-5" />
                GSC API not configured
              </CardTitle>
              <CardDescription className="text-amber-100/80">
                Set the <code>GSC_SERVICE_ACCOUNT_JSON</code> and{' '}
                <code>GSC_SITE_URL</code> environment variables to enable
                live URL Inspection. Until then, URLs are still discovered
                from the sitemap and listed below as "Not yet inspected".
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <Card className="bg-[#1A1A1A] border-gray-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-gray-400">
                Total URLs in sitemap cache
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {(status?.totalUrls ?? stats?.total ?? 0).toLocaleString()}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {status?.stationDiscoveryCapPerLanguage
                  ? `Stations capped at ${status.stationDiscoveryCapPerLanguage}/lang`
                  : 'All sitemap URLs tracked'}
              </p>
            </CardContent>
          </Card>
          <Card className="bg-[#1A1A1A] border-gray-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-gray-400">
                Indexed by Google
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-400">
                {indexedPct}%
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {stats?.byState.find((s) => s.state === 'indexed')?.count ?? 0}{' '}
                indexed of {stats?.total ?? 0}
              </p>
            </CardContent>
          </Card>
          <Card className="bg-[#1A1A1A] border-gray-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-gray-400">
                Discovered — not indexed
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-400">
                {(
                  stats?.byState.find(
                    (s) => s.state === 'discovered-not-indexed',
                  )?.count ?? 0
                ).toLocaleString()}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Crawled — not indexed:{' '}
                {(
                  stats?.byState.find(
                    (s) => s.state === 'crawled-not-indexed',
                  )?.count ?? 0
                ).toLocaleString()}
              </p>
            </CardContent>
          </Card>
          <Card className="bg-[#1A1A1A] border-gray-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-gray-400">Last refresh</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-base font-semibold">
                {fmt(status?.lastInspectionAt)}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {status?.lastInspectionStats
                  ? `${status.lastInspectionStats.succeeded}/${status.lastInspectionStats.attempted} succeeded`
                  : 'No batches yet'}
              </p>
            </CardContent>
          </Card>
          <Card className="bg-[#1A1A1A] border-gray-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-gray-400">
                Stuck (&gt; {status?.resubmitStuckDays ?? 14}d)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-400">
                {(status?.stuckUrls ?? 0).toLocaleString()}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {status?.lastResubmitAt
                  ? `Last resubmit ${fmt(status.lastResubmitAt)}${
                      status.lastResubmitStats
                        ? ` — ${status.lastResubmitStats.succeeded}/${status.lastResubmitStats.attempted}`
                        : ''
                    }`
                  : 'No auto-resubmit yet'}
              </p>
            </CardContent>
          </Card>
        </div>

        <Card className="bg-[#1A1A1A] border-gray-800">
          <CardHeader>
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div>
                <CardTitle>Indexing trend</CardTitle>
                <CardDescription className="text-gray-400">
                  Daily snapshots of total / indexed / crawled-not-indexed /
                  discovered-not-indexed counts. Snapshot job runs nightly at
                  23:55 Berlin time.
                  {status?.lastSnapshotAt
                    ? ` Last snapshot: ${fmt(status.lastSnapshotAt)}.`
                    : ' No snapshot recorded yet.'}
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Select
                  value={trendDays}
                  onValueChange={(v) => setTrendDays(v as '30' | '90')}
                >
                  <SelectTrigger className="w-[120px] bg-[#0E0E0E] border-gray-700">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#1A1A1A] border-gray-700">
                    <SelectItem value="30">Last 30 days</SelectItem>
                    <SelectItem value="90">Last 90 days</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={trendLanguage}
                  onValueChange={setTrendLanguage}
                >
                  <SelectTrigger className="w-[140px] bg-[#0E0E0E] border-gray-700">
                    <SelectValue placeholder="Language" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#1A1A1A] border-gray-700">
                    <SelectItem value="all">All languages</SelectItem>
                    {languages.map((l) => (
                      <SelectItem key={l} value={l}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={trendGroup} onValueChange={setTrendGroup}>
                  <SelectTrigger className="w-[140px] bg-[#0E0E0E] border-gray-700">
                    <SelectValue placeholder="Group" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#1A1A1A] border-gray-700">
                    <SelectItem value="all">All groups</SelectItem>
                    <SelectItem value="static">Static</SelectItem>
                    <SelectItem value="country">Country</SelectItem>
                    <SelectItem value="genre">Genre</SelectItem>
                    <SelectItem value="station">Station</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-gray-700"
                  disabled={recordSnapshot.isPending}
                  onClick={() => recordSnapshot.mutate()}
                  title="Force a daily snapshot now (cron also runs nightly)"
                >
                  <RefreshCcw className="w-4 h-4 mr-2" />
                  {recordSnapshot.isPending ? 'Snapshotting…' : 'Snapshot now'}
                </Button>
                <a
                  href={(() => {
                    const p = new URLSearchParams();
                    p.set('days', trendDays);
                    // 'all' is the aggregate bucket (overall row); 'any'
                    // is the wildcard returning every (lang, group) combo.
                    // From the dashboard filter, 'all' means the user
                    // selected the aggregate row, so we honor it as-is.
                    p.set('language', trendLanguage);
                    p.set('group', trendGroup);
                    return `/api/admin/gsc-inspection/history.csv?${p.toString()}`;
                  })()}
                  className="inline-flex items-center text-sm border border-gray-700 rounded-md px-3 py-1.5 hover:bg-gray-800"
                  title="Download the snapshot history as CSV (matches the current filters)"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Export CSV
                </a>
              </div>
            </div>
            {recordSnapshot.error && (
              <p className="text-sm text-red-400 mt-2">
                {(recordSnapshot.error as Error).message}
              </p>
            )}
          </CardHeader>
          <CardContent>
            {trendsLoading ? (
              <div className="text-center text-gray-400 py-12">
                Loading trend…
              </div>
            ) : trendChartData.length === 0 ? (
              <div className="text-center text-gray-400 py-12">
                No snapshots yet for this filter. The first snapshot is
                recorded automatically tonight at 23:55 Berlin time, or you
                can click "Snapshot now" to capture today's numbers
                immediately.
              </div>
            ) : (
              <div className="w-full" style={{ height: 320 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={trendChartData}
                    margin={{ top: 10, right: 24, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                    <XAxis
                      dataKey="label"
                      stroke="#9ca3af"
                      tick={{ fontSize: 12 }}
                      minTickGap={20}
                    />
                    <YAxis
                      yAxisId="left"
                      stroke="#9ca3af"
                      tick={{ fontSize: 12 }}
                      width={60}
                      allowDecimals={false}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      stroke="#9ca3af"
                      tick={{ fontSize: 12 }}
                      width={50}
                      tickFormatter={(v) => `${v}%`}
                      domain={[0, 100]}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0E0E0E',
                        border: '1px solid #374151',
                        color: '#fff',
                      }}
                      labelStyle={{ color: '#9ca3af' }}
                    />
                    <Legend wrapperStyle={{ color: '#9ca3af' }} />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="total"
                      name="Total URLs"
                      stroke="#9ca3af"
                      dot={false}
                      strokeWidth={2}
                    />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="indexed"
                      name="Indexed"
                      stroke="#22c55e"
                      dot={false}
                      strokeWidth={2}
                    />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="crawledNotIndexed"
                      name="Crawled, not indexed"
                      stroke="#f59e0b"
                      dot={false}
                      strokeWidth={2}
                    />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="discoveredNotIndexed"
                      name="Discovered, not indexed"
                      stroke="#fb923c"
                      dot={false}
                      strokeWidth={2}
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="indexedPct"
                      name="Indexed %"
                      stroke="#60a5fa"
                      strokeDasharray="4 4"
                      dot={false}
                      strokeWidth={2}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-[#1A1A1A] border-gray-800">
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <CardTitle>Indexing by URL group</CardTitle>
                <CardDescription className="text-gray-400">
                  Breakdown across static pages, top-30 country pages,
                  genres, and station pages.
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="border-gray-700"
                  disabled={rediscover.isPending}
                  onClick={() => rediscover.mutate()}
                >
                  <RefreshCcw className="w-4 h-4 mr-2" />
                  {rediscover.isPending ? 'Re-discovering…' : 'Re-discover URLs'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-red-700 text-red-200 hover:bg-red-950/40"
                  disabled={
                    resubmitStuck.isPending ||
                    !status?.configured ||
                    (status?.stuckUrls ?? 0) === 0
                  }
                  onClick={() => resubmitStuck.mutate()}
                  title={`Re-pings IndexNow + force-rebuilds the sitemap for URLs stuck > ${status?.resubmitStuckDays ?? 14} days. Cooldown ${status?.resubmitCooldownDays ?? 7}d, max ${status?.resubmitBatchLimit ?? 200}/run.`}
                >
                  <RefreshCcw className="w-4 h-4 mr-2" />
                  {resubmitStuck.isPending
                    ? 'Resubmitting…'
                    : `Resubmit stuck (${status?.stuckUrls ?? 0})`}
                </Button>
                <Button
                  size="sm"
                  className="bg-blue-600 hover:bg-blue-700"
                  disabled={refreshBatch.isPending || !status?.configured}
                  onClick={() => refreshBatch.mutate()}
                >
                  <RefreshCcw className="w-4 h-4 mr-2" />
                  {refreshBatch.isPending
                    ? 'Refreshing…'
                    : `Run inspection batch (${status?.defaultBatchSize ?? 50})`}
                </Button>
              </div>
            </div>
            {refreshBatch.error && (
              <p className="text-sm text-red-400 mt-2">
                {(refreshBatch.error as Error).message}
              </p>
            )}
            {resubmitStuck.error && (
              <p className="text-sm text-red-400 mt-2">
                {(resubmitStuck.error as Error).message}
              </p>
            )}
            {resubmitStuck.data?.stats && (
              <p className="text-sm text-gray-400 mt-2">
                Resubmitted {resubmitStuck.data.stats.succeeded}/
                {resubmitStuck.data.stats.attempted} stuck URL
                {resubmitStuck.data.stats.attempted === 1 ? '' : 's'} via
                IndexNow
                {resubmitStuck.data.stats.sitemapRebuilt
                  ? ' and rebuilt the sitemap'
                  : ''}
                .
              </p>
            )}
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="border-gray-800">
                  <TableHead className="text-gray-400">Group</TableHead>
                  <TableHead className="text-gray-400 text-right">Total</TableHead>
                  <TableHead className="text-gray-400 text-right">Indexed</TableHead>
                  <TableHead className="text-gray-400 text-right">
                    Crawled, not indexed
                  </TableHead>
                  <TableHead className="text-gray-400 text-right">
                    Discovered, not indexed
                  </TableHead>
                  <TableHead className="text-gray-400 text-right">Excluded</TableHead>
                  <TableHead className="text-gray-400 text-right">Pending</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(stats?.byGroup ?? []).map((row) => (
                  <TableRow key={row.group} className="border-gray-800">
                    <TableCell className="capitalize">{row.group}</TableCell>
                    <TableCell className="text-right">
                      {row.total.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right text-green-400">
                      {row.indexed.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right text-amber-300">
                      {row.crawledNotIndexed.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right text-orange-400">
                      {row.discoveredNotIndexed.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right text-zinc-300">
                      {row.excluded.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right text-blue-300">
                      {row.pending.toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
                {(!stats?.byGroup || stats.byGroup.length === 0) && (
                  <TableRow className="border-gray-800">
                    <TableCell colSpan={7} className="text-center text-gray-500 py-6">
                      No data yet — click "Re-discover URLs" to populate.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="bg-[#1A1A1A] border-gray-800">
          <CardHeader>
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div>
                <CardTitle>URLs</CardTitle>
                <CardDescription className="text-gray-400">
                  Filter by language, URL group, and indexing state.
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <div className="relative">
                  <SearchIcon className="absolute left-2 top-2.5 w-4 h-4 text-gray-500" />
                  <Input
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                    placeholder="Search URL"
                    className="pl-8 w-[220px] bg-[#0E0E0E] border-gray-700"
                  />
                </div>
                <Select
                  value={language}
                  onValueChange={(v) => {
                    setLanguage(v);
                    setPage(1);
                  }}
                >
                  <SelectTrigger className="w-[140px] bg-[#0E0E0E] border-gray-700">
                    <SelectValue placeholder="Language" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#1A1A1A] border-gray-700">
                    <SelectItem value="all">All languages</SelectItem>
                    {languages.map((l) => (
                      <SelectItem key={l} value={l}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={group}
                  onValueChange={(v) => {
                    setGroup(v);
                    setPage(1);
                  }}
                >
                  <SelectTrigger className="w-[140px] bg-[#0E0E0E] border-gray-700">
                    <SelectValue placeholder="Group" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#1A1A1A] border-gray-700">
                    <SelectItem value="all">All groups</SelectItem>
                    <SelectItem value="static">Static</SelectItem>
                    <SelectItem value="country">Country</SelectItem>
                    <SelectItem value="genre">Genre</SelectItem>
                    <SelectItem value="station">Station</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={state}
                  onValueChange={(v) => {
                    setState(v);
                    setPage(1);
                  }}
                >
                  <SelectTrigger className="w-[200px] bg-[#0E0E0E] border-gray-700">
                    <SelectValue placeholder="State" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#1A1A1A] border-gray-700">
                    <SelectItem value="all">All states</SelectItem>
                    <SelectItem value="indexed">Indexed</SelectItem>
                    <SelectItem value="crawled-not-indexed">
                      Crawled — not indexed
                    </SelectItem>
                    <SelectItem value="discovered-not-indexed">
                      Discovered — not indexed
                    </SelectItem>
                    <SelectItem value="excluded">Excluded</SelectItem>
                    <SelectItem value="error">Error</SelectItem>
                    <SelectItem value="pending">Not yet inspected</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {urlsLoading ? (
              <div className="text-center text-gray-400 py-6">Loading…</div>
            ) : !urls || urls.rows.length === 0 ? (
              <div className="text-center text-gray-400 py-6">
                No URLs match these filters.
              </div>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow className="border-gray-800">
                      <TableHead className="text-gray-400">URL</TableHead>
                      <TableHead className="text-gray-400">Group</TableHead>
                      <TableHead className="text-gray-400">Lang</TableHead>
                      <TableHead className="text-gray-400">State</TableHead>
                      <TableHead className="text-gray-400">
                        Stuck since
                      </TableHead>
                      <TableHead className="text-gray-400">
                        Last resubmit
                      </TableHead>
                      <TableHead className="text-gray-400">Last crawl</TableHead>
                      <TableHead className="text-gray-400">Last checked</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {urls.rows.map((row) => (
                      <TableRow key={row._id} className="border-gray-800">
                        <TableCell className="max-w-[480px]">
                          <div className="flex items-center gap-2">
                            <a
                              href={row.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-blue-400 hover:underline truncate block"
                              title={row.url}
                            >
                              {row.url}
                            </a>
                            {row.inspectionResultLink && (
                              <a
                                href={row.inspectionResultLink}
                                target="_blank"
                                rel="noreferrer"
                                title="Open in Search Console"
                                className="text-gray-400 hover:text-white"
                              >
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                          {row.lastError && (
                            <p
                              className="text-xs text-red-400 mt-1 truncate"
                              title={row.lastError}
                            >
                              {row.lastError}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="capitalize text-gray-300">
                          {row.group}
                        </TableCell>
                        <TableCell className="text-gray-300">
                          {row.language}
                        </TableCell>
                        <TableCell>
                          <StateBadge state={row.state} />
                          {row.coverageState &&
                            row.coverageState !== STATE_LABEL[row.state] && (
                              <p
                                className="text-xs text-gray-500 mt-1 truncate max-w-[200px]"
                                title={row.coverageState}
                              >
                                {row.coverageState}
                              </p>
                            )}
                        </TableCell>
                        <TableCell className="text-gray-300">
                          {row.notIndexedSince ? (
                            <span className="text-orange-300">
                              {fmt(row.notIndexedSince)}
                            </span>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                        <TableCell className="text-gray-300">
                          {row.lastResubmitAt ? (
                            <div>
                              <div
                                className={
                                  row.lastResubmitStatus === 'failed'
                                    ? 'text-red-400'
                                    : 'text-green-400'
                                }
                              >
                                {fmt(row.lastResubmitAt)}
                              </div>
                              <div
                                className="text-xs text-gray-500 truncate max-w-[160px]"
                                title={
                                  row.lastResubmitError ??
                                  `Resubmitted ${row.resubmitCount ?? 1}×`
                                }
                              >
                                {row.lastResubmitStatus === 'failed'
                                  ? row.lastResubmitError ?? 'failed'
                                  : `×${row.resubmitCount ?? 1}`}
                              </div>
                            </div>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                        <TableCell className="text-gray-300">
                          {fmt(row.lastCrawlTime)}
                        </TableCell>
                        <TableCell className="text-gray-300">
                          {fmt(row.lastInspectedAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="flex items-center justify-between mt-4 text-sm text-gray-400">
                  <div>
                    {urls.pagination.total.toLocaleString()} URL
                    {urls.pagination.total === 1 ? '' : 's'} • page{' '}
                    {urls.pagination.page} of {urls.pagination.pages}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-gray-700"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-gray-700"
                      disabled={page >= urls.pagination.pages}
                      onClick={() =>
                        setPage((p) =>
                          Math.min(urls.pagination.pages, p + 1),
                        )
                      }
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
