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
  ExternalLink,
  RefreshCcw,
  Search as SearchIcon,
  XCircle,
} from 'lucide-react';
import { format } from 'date-fns';

interface StatusResponse {
  configured: boolean;
  cronEnabled: boolean;
  siteUrl: string | null;
  discoveryRunning: boolean;
  inspectionRunning: boolean;
  lastDiscoveryAt: string | null;
  lastInspectionAt: string | null;
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
  defaultBatchSize: number;
  stationDiscoveryCapPerLanguage: number;
  totalUrls: number;
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

export default function GscInspectionPage() {
  const queryClient = useQueryClient();
  const [language, setLanguage] = useState('all');
  const [group, setGroup] = useState('all');
  const [state, setState] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

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

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
        </div>

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
              <div className="flex gap-2">
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
