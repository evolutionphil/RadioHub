import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { useQuery, useMutation } from '@tanstack/react-query';
import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Loader2, RefreshCw, Image as ImageIcon, Tag } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';

interface CountryCoverage {
  countryCode: string;
  countryName: string;
  total: number;
  withLogo: number;
  withTags: number;
  missingLogo: number;
  missingTags: number;
  logoCoveragePct: number;
  tagCoveragePct: number;
}

interface CoverageResponse {
  countries: CountryCoverage[];
}

interface TrendPoint {
  date: string;
  logoCoveragePct: number;
  tagCoveragePct: number;
  total: number;
  withLogo: number;
  withTags: number;
}

interface TrendsResponse {
  days: number;
  since: string;
  trends: Record<string, TrendPoint[]>;
}

function deltaClass(delta: number): string {
  if (delta > 0.05) return 'text-green-600';
  if (delta < -0.05) return 'text-red-600';
  return 'text-muted-foreground';
}

function formatDelta(delta: number): string {
  const rounded = Math.round(delta * 10) / 10;
  if (rounded === 0) return '±0.0';
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded.toFixed(1)}`;
}

function Sparkline({
  points,
  dataKey,
  color,
  testId,
}: {
  points: TrendPoint[];
  dataKey: 'logoCoveragePct' | 'tagCoveragePct';
  color: string;
  testId: string;
}) {
  if (!points || points.length < 2) {
    return (
      <span
        className="text-[10px] text-muted-foreground"
        data-testid={`${testId}-empty`}
      >
        —
      </span>
    );
  }
  return (
    <div className="w-[90px] h-[24px]" data-testid={testId}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={points}
          margin={{ top: 2, right: 2, bottom: 2, left: 2 }}
        >
          <YAxis hide domain={[0, 100]} />
          <Line
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

type SortKey =
  | 'logoCoveragePct'
  | 'tagCoveragePct'
  | 'missingLogo'
  | 'missingTags'
  | 'total';

const SORT_LABELS: Record<SortKey, string> = {
  logoCoveragePct: 'Lowest logo coverage',
  tagCoveragePct: 'Lowest tag coverage',
  missingLogo: 'Most missing logos',
  missingTags: 'Most missing tags',
  total: 'Largest catalogue',
};

function coverageBadgeClass(pct: number): string {
  if (pct >= 90) return 'bg-green-100 text-green-700 border-green-200';
  if (pct >= 70) return 'bg-amber-100 text-amber-700 border-amber-200';
  return 'bg-red-100 text-red-700 border-red-200';
}

interface CoverageJobStatus {
  jobId: string;
  countryCode: string;
  scope: 'logos' | 'tags' | 'both';
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: number;
  finishedAt?: number;
  error?: string;
  cancelRequested?: boolean;
  cancellable?: boolean;
  logos?: {
    matched: number;
    enqueued: number;
    completed: number;
    remaining: number;
    done: boolean;
  };
  tags?: {
    total: number;
    processed: number;
    hydrated: number;
    emptyUpstream: number;
    failed: number;
    done: boolean;
  };
}

export default function AdminCoverage() {
  const { toast } = useToast();
  const [sortKey, setSortKey] = useState<SortKey>('logoCoveragePct');
  const [search, setSearch] = useState('');
  const [minStations, setMinStations] = useState(10);
  const [enqueuing, setEnqueuing] = useState<string | null>(null);
  // Per-country active job. Only one job is tracked per country at a time
  // — re-clicking a button while a job runs replaces the handle with the
  // new one (the previous job continues in the background and will TTL
  // out server-side). Keyed by countryCode for O(1) row lookups.
  const [activeJobs, setActiveJobs] = useState<
    Record<string, CoverageJobStatus>
  >({});
  const completedJobsRef = useRef<Set<string>>(new Set());

  const {
    data,
    isLoading,
    refetch,
    isFetching,
  } = useQuery<CoverageResponse>({
    queryKey: ['/api/admin/coverage/by-country'],
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const { data: trendsData } = useQuery<TrendsResponse>({
    queryKey: ['/api/admin/coverage/trends?days=30'],
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const trendsByCountry = trendsData?.trends ?? {};

  const enqueueMutation = useMutation({
    mutationFn: async (vars: {
      countryCode: string;
      scope: 'logos' | 'tags' | 'both';
    }) => {
      setEnqueuing(`${vars.countryCode}:${vars.scope}`);
      const res = await apiRequest(
        'POST',
        `/api/admin/coverage/enqueue/${encodeURIComponent(vars.countryCode)}`,
        { body: { scope: vars.scope } },
      );
      return (await res.json()) as {
        success: boolean;
        jobId?: string;
        countryCode: string;
        scope: 'logos' | 'tags' | 'both';
        logos: { matched: number; enqueued: number } | null;
        tags: { started: boolean } | null;
      };
    },
    onSuccess: (result) => {
      const bits: string[] = [];
      if (result.logos) {
        bits.push(
          `${result.logos.enqueued} logo${
            result.logos.enqueued === 1 ? '' : 's'
          } re-enqueued (${result.logos.matched} matched)`,
        );
      }
      if (result.tags?.started) {
        bits.push('tag re-fetch started in background');
      }
      toast({
        title: `Backfill kicked off for ${result.countryCode}`,
        description: bits.join(' · ') || 'Nothing to enqueue.',
      });
      if (result.jobId) {
        // Seed an initial running job so the row immediately shows a
        // progress indicator while the first poll lands.
        setActiveJobs((prev) => ({
          ...prev,
          [result.countryCode]: {
            jobId: result.jobId!,
            countryCode: result.countryCode,
            scope: result.scope,
            status: 'running',
            startedAt: Date.now(),
            cancellable: true,
            cancelRequested: false,
            logos: result.logos
              ? {
                  matched: result.logos.matched,
                  enqueued: result.logos.enqueued,
                  completed: 0,
                  remaining: result.logos.enqueued,
                  done: result.logos.enqueued === 0,
                }
              : undefined,
            tags: result.tags?.started
              ? {
                  total: 0,
                  processed: 0,
                  hydrated: 0,
                  emptyUpstream: 0,
                  failed: 0,
                  done: false,
                }
              : undefined,
          },
        }));
      } else {
        void refetch();
      }
    },
    onError: (err: any) => {
      toast({
        title: 'Failed to enqueue backfill',
        description: err?.message || String(err),
        variant: 'destructive',
      });
    },
    onSettled: () => setEnqueuing(null),
  });

  // Cancel a running coverage backfill. The server flips a flag the
  // tags hydration loop polls between batches; we optimistically mark
  // the local job as cancel-requested so the button immediately
  // disables and re-labels while we wait for the next status poll to
  // observe the terminal `cancelled` state.
  // Track which job ids have an in-flight cancel request so we can
  // disable just *that* row's Cancel button instead of every running
  // row's button (which is what `cancelMutation.isPending` would do —
  // it's global to the mutation instance).
  const [cancellingJobIds, setCancellingJobIds] = useState<Set<string>>(
    () => new Set(),
  );
  const cancelMutation = useMutation({
    mutationFn: async (vars: { countryCode: string; jobId: string }) => {
      const res = await apiRequest(
        'POST',
        `/api/admin/coverage/enqueue-job-cancel/${encodeURIComponent(
          vars.jobId,
        )}`,
      );
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `Cancel failed (${res.status})`);
      }
      return vars;
    },
    onMutate: (vars) => {
      setCancellingJobIds((prev) => {
        const next = new Set(prev);
        next.add(vars.jobId);
        return next;
      });
      setActiveJobs((prev) => {
        const cur = prev[vars.countryCode];
        if (!cur || cur.jobId !== vars.jobId) return prev;
        return {
          ...prev,
          [vars.countryCode]: { ...cur, cancelRequested: true },
        };
      });
    },
    onError: (err: any, vars) => {
      // Roll back the optimistic cancelRequested flag so the Cancel
      // button comes back instead of being stuck on "Cancelling…".
      setActiveJobs((prev) => {
        const cur = prev[vars.countryCode];
        if (!cur || cur.jobId !== vars.jobId) return prev;
        return {
          ...prev,
          [vars.countryCode]: { ...cur, cancelRequested: false },
        };
      });
      toast({
        title: 'Failed to cancel backfill',
        description: err?.message || String(err),
        variant: 'destructive',
      });
    },
    onSettled: (_data, _err, vars) => {
      setCancellingJobIds((prev) => {
        if (!prev.has(vars.jobId)) return prev;
        const next = new Set(prev);
        next.delete(vars.jobId);
        return next;
      });
    },
  });

  // Poll every running job's status. We keep things simple by sharing one
  // 2s tick across all in-flight jobs rather than spawning a useQuery per
  // country — coverage backfills almost always run one country at a time.
  useEffect(() => {
    const runningCodes = Object.values(activeJobs)
      .filter((j) => j.status === 'running')
      .map((j) => j.countryCode);
    if (runningCodes.length === 0) return;

    let cancelled = false;
    const tick = async () => {
      const snapshot = activeJobs;
      await Promise.all(
        runningCodes.map(async (code) => {
          const job = snapshot[code];
          if (!job || job.status !== 'running') return;
          try {
            const res = await apiRequest(
              'GET',
              `/api/admin/coverage/enqueue-job-status/${encodeURIComponent(
                job.jobId,
              )}`,
            );
            if (!res.ok) return;
            const payload = (await res.json()) as {
              success: boolean;
              job: CoverageJobStatus;
            };
            if (cancelled || !payload?.job) return;
            setActiveJobs((prev) => ({
              ...prev,
              [code]: { ...payload.job, countryCode: code },
            }));
          } catch {
            /* network blip — try again on next tick */
          }
        }),
      );
    };
    const interval = window.setInterval(tick, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
    // We only want to (re)start the timer when the *set* of running jobs
    // changes, not on every counter tick within them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    Object.values(activeJobs)
      .filter((j) => j.status === 'running')
      .map((j) => `${j.countryCode}:${j.jobId}`)
      .sort()
      .join('|'),
  ]);

  // When a job finishes, refresh the coverage table once so the
  // percentages catch up, then drop the row indicator after a short
  // celebratory pause so admins can see the final counts.
  useEffect(() => {
    for (const job of Object.values(activeJobs)) {
      if (job.status === 'running') continue;
      if (completedJobsRef.current.has(job.jobId)) continue;
      completedJobsRef.current.add(job.jobId);
      void queryClient.invalidateQueries({
        queryKey: ['/api/admin/coverage/by-country'],
      });
      const code = job.countryCode;
      const handle = window.setTimeout(() => {
        setActiveJobs((prev) => {
          const next = { ...prev };
          if (next[code]?.jobId === job.jobId) delete next[code];
          return next;
        });
      }, 6000);
      return () => window.clearTimeout(handle);
    }
  }, [activeJobs]);

  const visible = useMemo(() => {
    const rows = data?.countries ?? [];
    const filtered = rows.filter((r) => {
      if (r.total < minStations) return false;
      if (!search.trim()) return true;
      const q = search.trim().toLowerCase();
      return (
        r.countryCode.toLowerCase().includes(q) ||
        r.countryName.toLowerCase().includes(q)
      );
    });
    const sorted = [...filtered].sort((a, b) => {
      switch (sortKey) {
        case 'logoCoveragePct':
        case 'tagCoveragePct':
          return a[sortKey] - b[sortKey];
        case 'missingLogo':
        case 'missingTags':
        case 'total':
          return b[sortKey] - a[sortKey];
      }
    });
    return sorted;
  }, [data, sortKey, search, minStations]);

  const totals = useMemo(() => {
    const rows = data?.countries ?? [];
    let total = 0;
    let withLogo = 0;
    let withTags = 0;
    for (const r of rows) {
      total += r.total;
      withLogo += r.withLogo;
      withTags += r.withTags;
    }
    return {
      total,
      withLogo,
      withTags,
      logoPct: total > 0 ? Math.round((withLogo / total) * 1000) / 10 : 0,
      tagPct: total > 0 ? Math.round((withTags / total) * 1000) / 10 : 0,
      countryCount: rows.length,
    };
  }, [data]);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Coverage by country</h1>
          <p className="text-sm text-muted-foreground">
            Per-country logo and tag completeness. Sort by the worst offenders
            and re-enqueue the same backfill the CLI scripts run.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          data-testid="button-refresh-coverage"
        >
          {isFetching ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4 mr-2" />
          )}
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Countries tracked</CardDescription>
            <CardTitle className="text-2xl">{totals.countryCount}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {totals.total.toLocaleString()} stations indexed
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Logo coverage</CardDescription>
            <CardTitle className="text-2xl">
              {totals.logoPct.toFixed(1)}%
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {totals.withLogo.toLocaleString()} stations have a completed logo
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Tag coverage</CardDescription>
            <CardTitle className="text-2xl">
              {totals.tagPct.toFixed(1)}%
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {totals.withTags.toLocaleString()} stations have non-empty tags
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Country breakdown</CardTitle>
          <CardDescription>
            Sort and filter to find markets that need attention. The
            re-enqueue button mirrors the same logic as the
            <code className="mx-1 px-1 bg-muted rounded">backfill-tr-*</code>
            scripts.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="flex-1 min-w-[200px]">
              <Input
                placeholder="Search by country or ISO code…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="input-coverage-search"
              />
            </div>
            <Select
              value={sortKey}
              onValueChange={(v) => setSortKey(v as SortKey)}
            >
              <SelectTrigger
                className="w-[220px]"
                data-testid="select-coverage-sort"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {SORT_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={String(minStations)}
              onValueChange={(v) => setMinStations(Number(v))}
            >
              <SelectTrigger
                className="w-[180px]"
                data-testid="select-coverage-min"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">All countries</SelectItem>
                <SelectItem value="10">≥ 10 stations</SelectItem>
                <SelectItem value="50">≥ 50 stations</SelectItem>
                <SelectItem value="100">≥ 100 stations</SelectItem>
                <SelectItem value="500">≥ 500 stations</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="flex items-center gap-2 py-12 justify-center text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading coverage…
            </div>
          ) : visible.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No countries match the current filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table data-testid="table-coverage">
                <TableHeader>
                  <TableRow>
                    <TableHead>Country</TableHead>
                    <TableHead className="text-right">Stations</TableHead>
                    <TableHead className="text-right">Logo coverage</TableHead>
                    <TableHead className="text-right">Logo 30d</TableHead>
                    <TableHead className="text-right">Missing logos</TableHead>
                    <TableHead className="text-right">Tag coverage</TableHead>
                    <TableHead className="text-right">Tag 30d</TableHead>
                    <TableHead className="text-right">Missing tags</TableHead>
                    <TableHead className="text-right">Re-enqueue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((row) => {
                    const logoKey = `${row.countryCode}:logos`;
                    const tagsKey = `${row.countryCode}:tags`;
                    const bothKey = `${row.countryCode}:both`;
                    const job = activeJobs[row.countryCode];
                    const trend = trendsByCountry[row.countryCode] ?? [];
                    const oldest = trend[0];
                    const logoDelta = oldest
                      ? row.logoCoveragePct - oldest.logoCoveragePct
                      : 0;
                    const tagDelta = oldest
                      ? row.tagCoveragePct - oldest.tagCoveragePct
                      : 0;
                    // Append today's live coverage to the sparkline so the
                    // rightmost point matches the badge in the same row — but
                    // only if the most recent snapshot isn't already from today
                    // (otherwise the cron-written point and the live point
                    // would visually duplicate at the right edge).
                    const todayUtc = new Date().toISOString().slice(0, 10);
                    const latest = trend[trend.length - 1];
                    const trendWithToday: TrendPoint[] =
                      trend.length === 0
                        ? []
                        : latest && latest.date === todayUtc
                          ? trend
                          : [
                              ...trend,
                              {
                                date: todayUtc,
                                logoCoveragePct: row.logoCoveragePct,
                                tagCoveragePct: row.tagCoveragePct,
                                total: row.total,
                                withLogo: row.withLogo,
                                withTags: row.withTags,
                              },
                            ];
                    return (
                      <Fragment key={row.countryCode}>
                      <TableRow
                        data-testid={`row-coverage-${row.countryCode}`}
                      >
                        <TableCell>
                          <Link
                            href={`/admin/coverage/${row.countryCode}`}
                            className="flex items-center gap-2 hover:underline"
                            data-testid={`link-country-${row.countryCode}`}
                          >
                            <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-muted">
                              {row.countryCode}
                            </span>
                            <span className="font-medium">
                              {row.countryName}
                            </span>
                          </Link>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.total.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge
                            variant="outline"
                            className={coverageBadgeClass(row.logoCoveragePct)}
                          >
                            {row.logoCoveragePct.toFixed(1)}%
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Sparkline
                              points={trendWithToday}
                              dataKey="logoCoveragePct"
                              color="#16a34a"
                              testId={`sparkline-logo-${row.countryCode}`}
                            />
                            <span
                              className={`text-xs tabular-nums ${deltaClass(logoDelta)}`}
                              data-testid={`delta-logo-${row.countryCode}`}
                              title={
                                oldest
                                  ? `vs ${oldest.date} (${oldest.logoCoveragePct.toFixed(1)}%)`
                                  : 'no history yet'
                              }
                            >
                              {oldest ? `${formatDelta(logoDelta)}pp` : '—'}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.missingLogo.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge
                            variant="outline"
                            className={coverageBadgeClass(row.tagCoveragePct)}
                          >
                            {row.tagCoveragePct.toFixed(1)}%
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Sparkline
                              points={trendWithToday}
                              dataKey="tagCoveragePct"
                              color="#2563eb"
                              testId={`sparkline-tags-${row.countryCode}`}
                            />
                            <span
                              className={`text-xs tabular-nums ${deltaClass(tagDelta)}`}
                              data-testid={`delta-tags-${row.countryCode}`}
                              title={
                                oldest
                                  ? `vs ${oldest.date} (${oldest.tagCoveragePct.toFixed(1)}%)`
                                  : 'no history yet'
                              }
                            >
                              {oldest ? `${formatDelta(tagDelta)}pp` : '—'}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.missingTags.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex gap-1 justify-end">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={enqueueMutation.isPending}
                              onClick={() =>
                                enqueueMutation.mutate({
                                  countryCode: row.countryCode,
                                  scope: 'logos',
                                })
                              }
                              data-testid={`button-enqueue-logos-${row.countryCode}`}
                            >
                              {enqueuing === logoKey ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <ImageIcon className="w-3 h-3" />
                              )}
                              <span className="ml-1">Logos</span>
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={enqueueMutation.isPending}
                              onClick={() =>
                                enqueueMutation.mutate({
                                  countryCode: row.countryCode,
                                  scope: 'tags',
                                })
                              }
                              data-testid={`button-enqueue-tags-${row.countryCode}`}
                            >
                              {enqueuing === tagsKey ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Tag className="w-3 h-3" />
                              )}
                              <span className="ml-1">Tags</span>
                            </Button>
                            <Button
                              size="sm"
                              disabled={enqueueMutation.isPending}
                              onClick={() =>
                                enqueueMutation.mutate({
                                  countryCode: row.countryCode,
                                  scope: 'both',
                                })
                              }
                              data-testid={`button-enqueue-both-${row.countryCode}`}
                            >
                              {enqueuing === bothKey ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <RefreshCw className="w-3 h-3" />
                              )}
                              <span className="ml-1">Both</span>
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                      {job ? (
                        <TableRow
                          data-testid={`row-coverage-progress-${row.countryCode}`}
                          className="bg-muted/30"
                        >
                          <TableCell colSpan={7} className="py-3">
                            <CoverageJobProgressRow
                              job={job}
                              cancelPending={cancellingJobIds.has(job.jobId)}
                              onCancel={() =>
                                cancelMutation.mutate({
                                  countryCode: job.countryCode,
                                  jobId: job.jobId,
                                })
                              }
                            />
                          </TableCell>
                        </TableRow>
                      ) : null}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CoverageJobProgressRow({
  job,
  onCancel,
  cancelPending,
}: {
  job: CoverageJobStatus;
  onCancel: () => void;
  cancelPending: boolean;
}) {
  const isRunning = job.status === 'running';
  const cancelRequested = !!job.cancelRequested;
  const statusLabel =
    job.status === 'completed'
      ? 'Backfill complete'
      : job.status === 'failed'
        ? 'Backfill failed'
        : job.status === 'cancelled'
          ? 'Backfill cancelled'
          : cancelRequested
            ? 'Cancelling backfill…'
            : 'Backfill in progress';

  const renderBar = (
    label: string,
    processed: number,
    total: number,
    extra?: string,
  ) => {
    const pct =
      total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
    return (
      <div className="flex-1 min-w-[220px]">
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="font-medium">{label}</span>
          <span className="tabular-nums text-muted-foreground">
            {total > 0
              ? `${processed.toLocaleString()} / ${total.toLocaleString()} (${pct}%)`
              : '0 / 0'}
            {extra ? ` · ${extra}` : ''}
          </span>
        </div>
        <Progress value={pct} className="h-2" />
      </div>
    );
  };

  return (
    <div
      className="flex flex-col gap-2"
      data-testid={`coverage-job-${job.countryCode}`}
    >
      <div className="flex items-center gap-2 text-xs">
        {isRunning ? (
          <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
        ) : null}
        <span
          className={
            job.status === 'failed'
              ? 'text-red-600 font-medium'
              : job.status === 'completed'
                ? 'text-green-700 font-medium'
                : job.status === 'cancelled'
                  ? 'text-amber-700 font-medium'
                  : 'text-muted-foreground font-medium'
          }
          data-testid={`coverage-job-status-${job.countryCode}`}
        >
          {statusLabel}
        </span>
        {job.error ? (
          <span className="text-red-600">— {job.error}</span>
        ) : null}
        {isRunning && job.cancellable ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs ml-auto"
            disabled={cancelRequested || cancelPending}
            onClick={onCancel}
            data-testid={`button-cancel-coverage-${job.countryCode}`}
          >
            {cancelRequested ? 'Cancelling…' : 'Cancel'}
          </Button>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-4">
        {job.logos
          ? renderBar(
              'Logos',
              job.logos.completed,
              job.logos.enqueued,
              `${job.logos.remaining.toLocaleString()} remaining`,
            )
          : null}
        {job.tags
          ? renderBar(
              'Tags',
              job.tags.processed,
              job.tags.total,
              `✅${job.tags.hydrated} ∅${job.tags.emptyUpstream} ❌${job.tags.failed}`,
            )
          : null}
      </div>
    </div>
  );
}
