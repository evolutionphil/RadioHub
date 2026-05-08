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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Loader2,
  RefreshCw,
  Image as ImageIcon,
  Tag,
  AlertTriangle,
  Download,
  ChevronDown,
  ChevronRight,
  Undo2,
  History,
  CheckCircle2,
} from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { useToast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';
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
  // 'cron' = real nightly snapshot of live data;
  // 'backfill' = reconstructed by the one-shot historical seeder
  // (Task #144) from existing station signals. Tag values for
  // backfilled days in particular are best-effort because we don't
  // track when each station first received tags.
  source?: 'cron' | 'backfill';
}

// Builds two parallel series so we can render reconstructed (backfill)
// days dashed and real cron-written days solid in the same chart. The
// first cron point that follows a run of backfill days is duplicated
// into the backfill series so the dashed line connects continuously to
// the start of the solid line (no visual gap at the handover).
function splitBySourceForKey(
  points: TrendPoint[],
  key: 'logoCoveragePct' | 'tagCoveragePct',
): Array<TrendPoint & { backfilled: number | null; cron: number | null }> {
  return points.map((p, i) => {
    const isBackfill = p.source === 'backfill';
    const prevWasBackfill = i > 0 && points[i - 1].source === 'backfill';
    const value = p[key];
    return {
      ...p,
      backfilled: isBackfill || prevWasBackfill ? value : null,
      cron: isBackfill ? null : value,
    };
  });
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
  const split = splitBySourceForKey(points, dataKey);
  const hasBackfill = points.some((p) => p.source === 'backfill');
  const title = hasBackfill
    ? 'Dashed segment is reconstructed from existing station data (backfill); solid segment is real nightly snapshots.'
    : undefined;
  return (
    <div
      className="w-[90px] h-[24px]"
      data-testid={testId}
      data-has-backfill={hasBackfill ? 'true' : 'false'}
      title={title}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={split}
          margin={{ top: 2, right: 2, bottom: 2, left: 2 }}
        >
          <YAxis hide domain={[0, 100]} />
          <Line
            type="monotone"
            dataKey="backfilled"
            stroke={color}
            strokeWidth={1.5}
            strokeDasharray="3 2"
            strokeOpacity={0.6}
            dot={false}
            isAnimationActive={false}
            connectNulls={false}
          />
          <Line
            type="monotone"
            dataKey="cron"
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
            connectNulls={false}
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

interface CoverageDropAlertEntry {
  countryCode: string;
  metric: 'logo' | 'tag';
  todayPct: number;
  weekAgoPct: number;
  deltaPp: number;
  total: number;
}

interface CoverageDropAlert {
  createdAt: string;
  snapshotDate: string | null;
  thresholdPp: number | null;
  message: string;
  drops: CoverageDropAlertEntry[];
  acknowledged?: boolean;
  acknowledgedAt?: string | null;
  acknowledgedBy?: string | null;
}

interface CoverageDropAlertResponse {
  alert: CoverageDropAlert | null;
}

// Mirrors the GET /api/admin/coverage/backfill-status response. Every
// numeric field is nullable because the boot service only fills in the
// fields that apply to a given outcome (e.g. a "skipped-env" status
// has none of the seed counters).
interface CoverageBackfillBootStatus {
  outcome:
    | 'skipped-env'
    | 'skipped-already-seeded'
    | 'skipped-count-error'
    | 'running'
    | 'done'
    | 'done-no-stations'
    | 'failed';
  message: string;
  observedAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  durationMs?: number | null;
  thresholdDays?: number | null;
  historicalDayCount?: number | null;
  seedDays?: number | null;
  daysSeeded?: number | null;
  inserted?: number | null;
  preserved?: number | null;
  error?: string | null;
}

interface CoverageBackfillBootStatusResponse {
  status: CoverageBackfillBootStatus | null;
}

interface CoverageDropAlertHistoryResponse {
  alert: CoverageDropAlert | null;
  history: CoverageDropAlert[];
  hasMore: boolean;
  nextBefore: string | null;
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
    // Counters carried over from a recently-cancelled run for the same
    // country (Task #252). Present only when the server seeded this job
    // from a previous cancelled run's progress so an Undo doesn't restart
    // the displayed bar at 0/total.
    resumedFrom?: {
      processed: number;
      hydrated: number;
      emptyUpstream: number;
      failed: number;
      total: number;
    };
  };
}

export default function AdminCoverage() {
  const { toast } = useToast();
  const [sortKey, setSortKey] = useState<SortKey>('logoCoveragePct');
  const [search, setSearch] = useState('');
  const [minStations, setMinStations] = useState(10);
  const [enqueuing, setEnqueuing] = useState<string | null>(null);
  // Window (in days) used by the "Download all (CSV)" export. Defaults to
  // 30 to match the on-page sparkline window so the button keeps behaving
  // the same out of the box; admins can flip to 7/90 for weekly/quarterly
  // reports without editing the URL or opening a per-country page.
  const [downloadDays, setDownloadDays] = useState<7 | 30 | 90>(30);
  const [downloadingCsv, setDownloadingCsv] = useState(false);
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

  const { data: dropAlertData } = useQuery<CoverageDropAlertResponse>({
    queryKey: ['/api/admin/coverage/drop-alerts'],
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  // Recent-alerts history. We default to 10 alerts but let admins page
  // back further with the "Load older" button. Wrapped in a separate
  // query so the latest-alert banner above keeps its existing cache key
  // and refresh cadence untouched.
  const [historyLimit, setHistoryLimit] = useState(10);
  const [historyOpen, setHistoryOpen] = useState(false);
  const { data: dropAlertHistoryData, isFetching: historyFetching } =
    useQuery<CoverageDropAlertHistoryResponse>({
      queryKey: [
        '/api/admin/coverage/drop-alerts',
        { history: 1, limit: historyLimit },
      ],
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      enabled: historyOpen,
    });

  const trendsByCountry = trendsData?.trends ?? {};
  const latestAlert = dropAlertData?.alert ?? null;
  const isAlertAcknowledged = latestAlert?.acknowledged === true;
  const alertHistory = dropAlertHistoryData?.history ?? [];
  const alertHistoryHasMore = !!dropAlertHistoryData?.hasMore;

  // Index the latest alert's drops by country code so each row can show a
  // badge — and remember which metrics dropped so we can colour the badge
  // distinctly. A single country may show up twice (logo + tag); merge them.
  // When the alert has been acknowledged we deliberately return an empty
  // map so neither the banner nor the per-row badges render until a newer
  // alert (different snapshotDate) arrives.
  const alertedByCountry = useMemo(() => {
    const map: Record<
      string,
      { metrics: Set<'logo' | 'tag'>; entries: CoverageDropAlertEntry[] }
    > = {};
    if (!latestAlert || isAlertAcknowledged) return map;
    for (const drop of latestAlert.drops) {
      const code = drop.countryCode.toUpperCase();
      if (!map[code]) map[code] = { metrics: new Set(), entries: [] };
      map[code].metrics.add(drop.metric);
      map[code].entries.push(drop);
    }
    return map;
  }, [latestAlert, isAlertAcknowledged]);

  const unacknowledgeAlertMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        'DELETE',
        '/api/admin/coverage/drop-alerts/acknowledge',
      );
      return (await res.json()) as {
        acknowledged: boolean;
        cleared: boolean;
      };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['/api/admin/coverage/drop-alerts'],
      });
      toast({
        title: 'Coverage drop alert reopened',
        description:
          'The banner and per-country badges are visible again for everyone.',
      });
    },
    onError: (err: any) => {
      toast({
        title: 'Could not reopen alert',
        description: err?.message ?? 'Please refresh and try again.',
        variant: 'destructive',
      });
    },
  });

  const acknowledgeAlertMutation = useMutation({
    mutationFn: async (snapshotDate: string) => {
      const res = await apiRequest(
        'POST',
        '/api/admin/coverage/drop-alerts/acknowledge',
        { body: { snapshotDate } },
      );
      return (await res.json()) as {
        acknowledged: boolean;
        snapshotDate: string;
        acknowledgedAt: string;
        acknowledgedBy: string | null;
      };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['/api/admin/coverage/drop-alerts'],
      });
      const t = toast({
        title: 'Coverage drop alert acknowledged',
        description:
          'The banner is hidden until a newer alert arrives. Earlier alerts remain in your notifications.',
        duration: 10_000,
        action: (
          <ToastAction
            altText="Undo acknowledge and reopen the coverage drop alert"
            data-testid="button-undo-acknowledge-coverage-drop"
            onClick={() => {
              unacknowledgeAlertMutation.mutate();
              t.dismiss();
            }}
          >
            Undo
          </ToastAction>
        ),
      });
    },
    onError: (err: any) => {
      toast({
        title: 'Could not acknowledge alert',
        description: err?.message ?? 'Please refresh and try again.',
        variant: 'destructive',
      });
    },
  });

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
        tags: {
          started: boolean;
          resumedFrom: {
            processed: number;
            hydrated: number;
            emptyUpstream: number;
            failed: number;
            total: number;
          } | null;
        } | null;
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
        if (result.tags.resumedFrom) {
          // Task #252: tell the admin we picked up where the cancelled
          // run left off instead of restarting the whole country.
          bits.push(
            `tag re-fetch resumed from ${result.tags.resumedFrom.processed.toLocaleString()}/${result.tags.resumedFrom.total.toLocaleString()} processed`,
          );
        } else {
          bits.push('tag re-fetch started in background');
        }
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
                  // Task #252: if the server carried counters over from a
                  // recently-cancelled run, seed the local job from those
                  // so the row immediately shows continuous progress
                  // (e.g. "234/1000 ✅180") instead of flashing 0/0 until
                  // the next 2s status poll lands.
                  total: result.tags.resumedFrom?.total ?? 0,
                  processed: result.tags.resumedFrom?.processed ?? 0,
                  hydrated: result.tags.resumedFrom?.hydrated ?? 0,
                  emptyUpstream: result.tags.resumedFrom?.emptyUpstream ?? 0,
                  failed: result.tags.resumedFrom?.failed ?? 0,
                  done: false,
                  resumedFrom: result.tags.resumedFrom ?? undefined,
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
    mutationFn: async (vars: {
      countryCode: string;
      jobId: string;
      scope: 'logos' | 'tags' | 'both';
    }) => {
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
    onSuccess: (vars) => {
      // Show a short-lived "Undo" toast so an accidental cancel can
      // re-fire the same backfill scope without losing more progress
      // than the in-flight batch. Doing nothing leaves the cancelled
      // state as it is — the toast just times out.
      const { countryCode, scope } = vars;
      const t = toast({
        title: `Backfill cancelled for ${countryCode}`,
        description: 'Cancelled by accident? Undo within 10 seconds.',
        duration: 10_000,
        action: (
          <ToastAction
            altText="Undo cancel and re-run the backfill"
            data-testid={`button-undo-cancel-${countryCode}`}
            onClick={() => {
              enqueueMutation.mutate({ countryCode, scope });
              t.dismiss();
            }}
          >
            Undo
          </ToastAction>
        ),
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
  //
  // Exception: `cancelled` jobs stay pinned until the admin hits
  // "Dismiss" so they can read what actually got hydrated before they
  // pulled the plug (otherwise the bars vanish 6s later and the cancel
  // feels like a black hole). We also fire a toast summary on the
  // transition. `completed` and `failed` keep their old auto-clear.
  useEffect((): void | (() => void) => {
    for (const job of Object.values(activeJobs)) {
      if (job.status === 'running') continue;
      if (completedJobsRef.current.has(job.jobId)) continue;
      completedJobsRef.current.add(job.jobId);
      void queryClient.invalidateQueries({
        queryKey: ['/api/admin/coverage/by-country'],
      });
      if (job.status === 'cancelled') {
        const bits: string[] = [];
        if (job.logos) {
          bits.push(
            `${job.logos.completed.toLocaleString()}/${job.logos.enqueued.toLocaleString()} logos completed`,
          );
        }
        if (job.tags) {
          bits.push(
            `${job.tags.processed.toLocaleString()}/${job.tags.total.toLocaleString()} stations processed · ✅${job.tags.hydrated.toLocaleString()} hydrated · ∅${job.tags.emptyUpstream.toLocaleString()} empty · ❌${job.tags.failed.toLocaleString()} failed`,
          );
        }
        toast({
          title: `Cancelled backfill for ${job.countryCode}`,
          description: bits.join(' · ') || 'No work completed before cancel.',
        });
        continue;
      }
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

  const dismissJob = (countryCode: string, jobId: string) => {
    setActiveJobs((prev) => {
      if (prev[countryCode]?.jobId !== jobId) return prev;
      const next = { ...prev };
      delete next[countryCode];
      return next;
    });
  };

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

  const handleDownloadAllCsv = async () => {
    // For the default 30-day window we can reuse the trends already
    // cached for the on-page sparklines; for 7/90 we fetch fresh so the
    // CSV honours the admin's chosen window without re-shaping the
    // sparkline query (which the rest of the page depends on).
    setDownloadingCsv(true);
    try {
      let trends: Record<string, TrendPoint[]>;
      if (downloadDays === 30 && trendsData?.trends) {
        trends = trendsData.trends;
      } else {
        const res = await apiRequest(
          'GET',
          `/api/admin/coverage/trends?days=${downloadDays}`,
        );
        if (!res.ok) {
          toast({
            title: 'Could not load coverage trends',
            description: `Server returned ${res.status}. Please try again.`,
            variant: 'destructive',
          });
          return;
        }
        const payload = (await res.json()) as TrendsResponse;
        trends = payload.trends ?? {};
      }
      const codes = Object.keys(trends).sort();
      if (codes.length === 0) {
        toast({
          title: 'No coverage data to download',
          description: `No trend snapshots were returned for the last ${downloadDays} days.`,
        });
        return;
      }
      const header = [
        'countryCode',
        'date',
        'logoCoveragePct',
        'tagCoveragePct',
        'total',
        'withLogo',
        'withTags',
      ];
      const rows: string[][] = [];
      for (const code of codes) {
        const points = trends[code] ?? [];
        for (const p of points) {
          rows.push([
            code,
            p.date,
            p.logoCoveragePct.toFixed(2),
            p.tagCoveragePct.toFixed(2),
            String(p.total),
            String(p.withLogo),
            String(p.withTags),
          ]);
        }
      }
      if (rows.length === 0) {
        toast({
          title: 'No coverage data to download',
          description: `No trend snapshots were returned for the last ${downloadDays} days.`,
        });
        return;
      }
      const csv =
        [header, ...rows].map((r) => r.join(',')).join('\n') + '\n';
      const today = new Date().toISOString().slice(0, 10);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `coverage-all-${downloadDays}d-${today}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast({
        title: 'Failed to download coverage CSV',
        description: err?.message || String(err),
        variant: 'destructive',
      });
    } finally {
      setDownloadingCsv(false);
    }
  };

  const trendsCountryCount = Object.keys(trendsData?.trends ?? {}).length;

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
        <div className="flex items-center gap-2">
        <Link href="/admin/coverage/compare">
          <Button
            variant="outline"
            size="sm"
            data-testid="link-compare-countries"
          >
            Compare countries
          </Button>
        </Link>
        <ReconstructHistoryButton />
        <Select
          value={String(downloadDays)}
          onValueChange={(v) =>
            setDownloadDays(Number(v) as 7 | 30 | 90)
          }
        >
          <SelectTrigger
            className="h-9 w-[120px]"
            data-testid="select-download-range"
            aria-label="CSV download date range"
            title="Date range used by the Download all (CSV) export"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          onClick={handleDownloadAllCsv}
          disabled={
            downloadingCsv ||
            (downloadDays === 30 && trendsCountryCount === 0)
          }
          title={
            downloadDays === 30 && trendsCountryCount === 0
              ? 'Trend snapshots are still loading…'
              : `Download ${
                  downloadDays === 30 && trendsCountryCount > 0
                    ? `${trendsCountryCount} countries × `
                    : ''
                }${downloadDays} days as a single CSV`
          }
          data-testid="button-download-all-csv"
        >
          {downloadingCsv ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Download className="w-4 h-4 mr-2" />
          )}
          Download all ({downloadDays}d CSV)
        </Button>
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
      </div>

      <CoverageBackfillBootStatusCard />

      <CoverageDropAlertSettingsCard />

      {latestAlert && latestAlert.drops.length > 0 && isAlertAcknowledged ? (
        <div
          className="flex flex-wrap items-center gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
          data-testid="notice-coverage-drop-acknowledged"
        >
          <AlertTriangle className="w-3.5 h-3.5 text-amber-700" />
          <span>
            Coverage drop alert for snapshot {latestAlert.snapshotDate ?? '—'} was
            acknowledged
            {latestAlert.acknowledgedBy
              ? ` by ${latestAlert.acknowledgedBy}`
              : ''}
            {latestAlert.acknowledgedAt
              ? ` on ${new Date(latestAlert.acknowledgedAt).toLocaleString()}`
              : ''}
            . The banner and per-row badges are hidden until a newer alert
            arrives.
          </span>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto h-7 border-amber-300 bg-white/70 px-2 text-xs text-amber-900 hover:bg-white"
            onClick={() => unacknowledgeAlertMutation.mutate()}
            disabled={unacknowledgeAlertMutation.isPending}
            data-testid="button-reopen-coverage-drop"
            title="Bring the banner and per-country badges back for everyone"
          >
            {unacknowledgeAlertMutation.isPending ? (
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            ) : null}
            Reopen alert
          </Button>
        </div>
      ) : null}

      {latestAlert && latestAlert.drops.length > 0 && !isAlertAcknowledged ? (
        <Alert
          variant="destructive"
          data-testid="alert-coverage-drop"
          className="border-red-300 bg-red-50 text-red-900 [&>svg]:text-red-700"
        >
          <AlertTriangle className="w-4 h-4" />
          <AlertTitle className="flex items-center gap-2 flex-wrap">
            <span>Coverage drop alert</span>
            {latestAlert.snapshotDate ? (
              <span className="text-xs font-normal text-red-800/80">
                snapshot {latestAlert.snapshotDate}
                {latestAlert.thresholdPp != null
                  ? ` · threshold ${latestAlert.thresholdPp}pp`
                  : null}
              </span>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              className="ml-auto h-7 border-red-300 bg-white/70 px-2 text-xs text-red-800 hover:bg-white"
              onClick={() => {
                if (!latestAlert.snapshotDate) return;
                acknowledgeAlertMutation.mutate(latestAlert.snapshotDate);
              }}
              disabled={
                !latestAlert.snapshotDate || acknowledgeAlertMutation.isPending
              }
              data-testid="button-acknowledge-coverage-drop"
              title="Hide this banner for everyone until a newer alert arrives"
            >
              {acknowledgeAlertMutation.isPending ? (
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              ) : null}
              Acknowledge
            </Button>
          </AlertTitle>
          <AlertDescription>
            <div className="mt-1 text-sm">
              {latestAlert.drops.length === 1
                ? '1 country/metric'
                : `${latestAlert.drops.length} country/metric pairs`}{' '}
              dropped beyond the threshold vs 7 days ago. Click a country to
              jump to its detail view.
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {latestAlert.drops.slice(0, 25).map((d, i) => (
                <Link
                  key={`${d.countryCode}:${d.metric}:${i}`}
                  href={`/admin/coverage/${d.countryCode}`}
                  className="inline-flex items-center gap-1.5 rounded border border-red-300 bg-white/60 px-2 py-1 text-xs hover:bg-white"
                  data-testid={`alert-drop-${d.countryCode}-${d.metric}`}
                >
                  <span className="font-mono font-semibold">
                    {d.countryCode}
                  </span>
                  <span className="text-red-800/80">
                    {d.metric === 'logo' ? 'logo' : 'tags'}
                  </span>
                  <span className="tabular-nums">
                    {d.weekAgoPct.toFixed(1)}% → {d.todayPct.toFixed(1)}%
                  </span>
                  <span className="font-semibold tabular-nums">
                    ({d.deltaPp.toFixed(1)}pp)
                  </span>
                </Link>
              ))}
              {latestAlert.drops.length > 25 ? (
                <span className="text-xs text-red-800/80 self-center">
                  …and {latestAlert.drops.length - 25} more
                </span>
              ) : null}
            </div>
          </AlertDescription>
        </Alert>
      ) : latestAlert &&
        latestAlert.drops.length > 0 &&
        isAlertAcknowledged ? (
        <Alert
          data-testid="alert-coverage-drop-acknowledged"
          className="border-green-200 bg-green-50 text-green-900 [&>svg]:text-green-700"
        >
          <CheckCircle2 className="w-4 h-4" />
          <AlertTitle className="flex items-center gap-2 flex-wrap text-sm">
            <span>Coverage drop alert acknowledged</span>
            {latestAlert.snapshotDate ? (
              <span
                className="text-xs font-normal text-green-800/80"
                data-testid="text-acknowledged-snapshot-date"
              >
                snapshot {latestAlert.snapshotDate}
              </span>
            ) : null}
          </AlertTitle>
          <AlertDescription>
            <div className="mt-1 text-sm flex flex-wrap items-center gap-x-1.5">
              <span>
                Acknowledged by{' '}
                <span
                  className="font-medium"
                  data-testid="text-acknowledged-by"
                >
                  {latestAlert.acknowledgedBy ?? 'an admin'}
                </span>
                {latestAlert.acknowledgedAt ? (
                  <>
                    {' '}on{' '}
                    <time
                      dateTime={latestAlert.acknowledgedAt}
                      title={new Date(
                        latestAlert.acknowledgedAt,
                      ).toLocaleString()}
                      data-testid="text-acknowledged-at"
                    >
                      {new Date(
                        latestAlert.acknowledgedAt,
                      ).toLocaleString()}
                    </time>
                  </>
                ) : null}
                .
              </span>
              <Link
                href="/profile/notifications"
                className="underline underline-offset-2 hover:text-green-950"
                data-testid="link-acknowledged-notifications"
              >
                View in notifications
              </Link>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      <CoverageDropAlertHistorySection
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        history={alertHistory}
        hasMore={alertHistoryHasMore}
        isFetching={historyFetching}
        onLoadMore={() => setHistoryLimit((n) => n + 10)}
        latestSnapshotDate={latestAlert?.snapshotDate ?? null}
      />


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
          <div
            className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground"
            data-testid="coverage-sparkline-legend"
          >
            <span className="inline-flex items-center gap-1.5">
              <svg width="22" height="6" aria-hidden="true">
                <line x1="0" y1="3" x2="22" y2="3" stroke="currentColor" strokeWidth="1.5" />
              </svg>
              Real nightly snapshot
            </span>
            <span className="inline-flex items-center gap-1.5">
              <svg width="22" height="6" aria-hidden="true">
                <line
                  x1="0"
                  y1="3"
                  x2="22"
                  y2="3"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeDasharray="3 2"
                  strokeOpacity="0.6"
                />
              </svg>
              Reconstructed (backfilled from existing station data)
            </span>
            <span>
              Tag values for backfilled days are best-effort — we don't track
              when each station first received tags, so a station's
              <code className="mx-1 px-1 bg-muted rounded">createdAt</code>
              date is used as a proxy.
            </span>
          </div>
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
                                // Today's live point comes straight
                                // from the by-country aggregation, not
                                // a backfill — render it as solid.
                                source: 'cron',
                              },
                            ];
                    const alertEntry = alertedByCountry[row.countryCode];
                    const isAlerted = !!alertEntry;
                    const alertedMetrics = alertEntry
                      ? Array.from(alertEntry.metrics).sort()
                      : [];
                    return (
                      <Fragment key={row.countryCode}>
                      <TableRow
                        data-testid={`row-coverage-${row.countryCode}`}
                        className={
                          isAlerted ? 'bg-red-50/60 hover:bg-red-50' : undefined
                        }
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
                            {isAlerted ? (
                              <Badge
                                variant="outline"
                                className="border-red-300 bg-red-100 text-red-700 text-[10px] px-1.5 py-0 gap-1"
                                data-testid={`badge-coverage-drop-${row.countryCode}`}
                                title={alertEntry.entries
                                  .map(
                                    (e) =>
                                      `${e.metric}: ${e.weekAgoPct.toFixed(1)}% → ${e.todayPct.toFixed(1)}% (${e.deltaPp.toFixed(1)}pp)`,
                                  )
                                  .join('\n')}
                              >
                                <AlertTriangle className="w-3 h-3" />
                                {alertedMetrics
                                  .map((m) => (m === 'logo' ? 'logo' : 'tags'))
                                  .join(' + ')}{' '}
                                drop
                              </Badge>
                            ) : null}
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
                              resumePending={
                                enqueueMutation.isPending &&
                                enqueuing ===
                                  `${job.countryCode}:${job.scope}`
                              }
                              onCancel={() =>
                                cancelMutation.mutate({
                                  countryCode: job.countryCode,
                                  jobId: job.jobId,
                                  scope: job.scope,
                                })
                              }
                              onResume={() =>
                                enqueueMutation.mutate({
                                  countryCode: job.countryCode,
                                  scope: job.scope,
                                })
                              }
                              onDismiss={() =>
                                dismissJob(job.countryCode, job.jobId)
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
  onResume,
  resumePending,
  onDismiss,
}: {
  job: CoverageJobStatus;
  onCancel: () => void;
  cancelPending: boolean;
  onResume: () => void;
  resumePending: boolean;
  onDismiss: () => void;
}) {
  const isRunning = job.status === 'running';
  const cancelRequested = !!job.cancelRequested;
  const isCancelled = job.status === 'cancelled';
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
        {isCancelled ? (
          <div className="flex items-center gap-1 ml-auto">
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-xs"
              disabled={resumePending}
              onClick={onResume}
              data-testid={`button-resume-coverage-${job.countryCode}`}
            >
              {resumePending ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <RefreshCw className="w-3 h-3" />
              )}
              <span className="ml-1">Resume</span>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              onClick={onDismiss}
              data-testid={`button-dismiss-coverage-${job.countryCode}`}
            >
              Dismiss
            </Button>
          </div>
        ) : null}
      </div>
      {isCancelled ? (
        <div
          className="text-xs text-amber-700"
          data-testid={`coverage-job-cancelled-summary-${job.countryCode}`}
        >
          {(() => {
            const bits: string[] = [];
            if (job.tags) {
              bits.push(
                `Cancelled after ${job.tags.processed.toLocaleString()}/${job.tags.total.toLocaleString()} processed · ✅${job.tags.hydrated.toLocaleString()} hydrated · ∅${job.tags.emptyUpstream.toLocaleString()} empty · ❌${job.tags.failed.toLocaleString()} failed`,
              );
            }
            if (job.logos) {
              bits.push(
                `${job.logos.completed.toLocaleString()}/${job.logos.enqueued.toLocaleString()} logos completed`,
              );
            }
            return bits.length > 0
              ? bits.join(' · ')
              : 'Cancelled before any work was completed.';
          })()}
        </div>
      ) : null}
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

interface CoverageDropAlertSettingsResponse {
  stored: {
    thresholdPp: number | null;
    minStations: number | null;
    webhookUrl: string | null;
  };
  env: {
    thresholdPp: number | null;
    minStations: number | null;
    webhookUrl: string | null;
  };
  defaults: {
    thresholdPp: number;
    minStations: number;
  };
  effective: {
    thresholdPp: number;
    minStations: number;
    webhookUrl: string | null;
    source: {
      thresholdPp: 'db' | 'env' | 'default';
      minStations: 'db' | 'env' | 'default';
      webhookUrl: 'db' | 'env' | 'none';
    };
  };
  updatedAt: string | null;
  updatedBy: string | null;
}

function sourceLabel(source: 'db' | 'env' | 'default' | 'none'): string {
  switch (source) {
    case 'db':
      return 'set in UI';
    case 'env':
      return 'from env var';
    case 'default':
      return 'default';
    case 'none':
      return 'not set';
  }
}

interface CoverageDropAlertHistoryEntry {
  id: string;
  action: 'update' | 'clear';
  previousValue: {
    thresholdPp: number | null;
    minStations: number | null;
    webhookUrl: string | null;
  } | null;
  newValue: {
    thresholdPp: number | null;
    minStations: number | null;
    webhookUrl: string | null;
  } | null;
  changedBy: string | null;
  changedAt: string;
}

interface CoverageDropAlertHistoryResponse {
  entries: CoverageDropAlertHistoryEntry[];
}

function describeSettingValue(
  value: CoverageDropAlertHistoryEntry['previousValue'],
): string {
  if (!value) return 'cleared (env / defaults)';
  const parts: string[] = [];
  parts.push(
    `threshold ${value.thresholdPp != null ? `${value.thresholdPp}pp` : '—'}`,
  );
  parts.push(
    `min stations ${value.minStations != null ? `n≥${value.minStations}` : '—'}`,
  );
  parts.push(`webhook ${value.webhookUrl ? 'set' : 'none'}`);
  return parts.join(', ');
}

function CoverageDropAlertSettingsCard() {
  const { toast } = useToast();
  const { data, isLoading, refetch } = useQuery<CoverageDropAlertSettingsResponse>({
    queryKey: ['/api/admin/settings/coverage-drop-alert'],
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const [historyOpen, setHistoryOpen] = useState(false);
  const {
    data: historyData,
    isLoading: historyLoading,
    refetch: refetchHistory,
  } = useQuery<CoverageDropAlertHistoryResponse>({
    queryKey: ['/api/admin/settings/coverage-drop-alert/history'],
    enabled: historyOpen,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const [thresholdPp, setThresholdPp] = useState<string>('');
  const [minStations, setMinStations] = useState<string>('');
  const [webhookUrl, setWebhookUrl] = useState<string>('');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!data || hydrated) return;
    setThresholdPp(
      data.stored.thresholdPp != null ? String(data.stored.thresholdPp) : '',
    );
    setMinStations(
      data.stored.minStations != null ? String(data.stored.minStations) : '',
    );
    setWebhookUrl(data.stored.webhookUrl ?? '');
    setHydrated(true);
  }, [data, hydrated]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {};
      body.thresholdPp = thresholdPp.trim() === '' ? null : Number(thresholdPp);
      body.minStations = minStations.trim() === '' ? null : Number(minStations);
      body.webhookUrl = webhookUrl.trim() === '' ? null : webhookUrl.trim();
      const res = await apiRequest(
        'PUT',
        '/api/admin/settings/coverage-drop-alert',
        { body },
      );
      return (await res.json()) as CoverageDropAlertSettingsResponse;
    },
    onSuccess: (next) => {
      toast({
        title: 'Coverage drop alert saved',
        description: `Effective: >${next.effective.thresholdPp}pp drop, n≥${next.effective.minStations}.`,
      });
      queryClient.setQueryData(
        ['/api/admin/settings/coverage-drop-alert'],
        next,
      );
      void queryClient.invalidateQueries({
        queryKey: ['/api/admin/settings/coverage-drop-alert/history'],
      });
      setHydrated(false);
    },
    onError: (err: any) => {
      toast({
        title: 'Failed to save settings',
        description: err?.message || String(err),
        variant: 'destructive',
      });
    },
  });

  // Fires a synthetic webhook payload through the api-server so admins
  // can verify Slack/Discord wiring without waiting for a real coverage
  // drop. Sends whatever URL is currently typed in the field (so they
  // can validate before saving); falls back to the effective URL when
  // the field is empty.
  const testWebhookMutation = useMutation({
    mutationFn: async () => {
      const trimmed = webhookUrl.trim();
      const res = await apiRequest(
        'POST',
        '/api/admin/settings/coverage-drop-alert/test',
        { body: trimmed === '' ? {} : { webhookUrl: trimmed } },
      );
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        status?: number | null;
        statusText?: string | null;
        responseBody?: string | null;
        error?: string | null;
        durationMs?: number;
        urlSource?: 'request' | 'effective';
      };
      if (!res.ok) {
        throw new Error(
          json?.error || `Request failed (${res.status} ${res.statusText})`,
        );
      }
      return json;
    },
    onSuccess: (result) => {
      const sourceNote =
        result.urlSource === 'request'
          ? ' (using URL typed in the field)'
          : ' (using currently-effective webhook URL — saved override or env var)';
      const httpLine =
        result.status != null
          ? `HTTP ${result.status}${
              result.statusText ? ` ${result.statusText}` : ''
            }`
          : 'No HTTP response';
      const bodyPreview = (result.responseBody ?? '').trim();
      const bodyLine = bodyPreview
        ? `Response: ${
            bodyPreview.length > 240
              ? bodyPreview.slice(0, 240) + '…'
              : bodyPreview
          }`
        : 'Response body: (empty)';
      const errLine = result.error ? `Error: ${result.error}` : null;
      const description = [
        httpLine + ` · ${result.durationMs ?? 0}ms` + sourceNote,
        bodyLine,
        errLine,
      ]
        .filter(Boolean)
        .join('\n');
      toast({
        title: result.ok
          ? 'Test webhook delivered'
          : 'Test webhook returned a non-2xx response',
        description,
        variant: result.ok ? undefined : 'destructive',
        duration: result.ok ? 6_000 : 12_000,
      });
    },
    onError: (err: any) => {
      toast({
        title: 'Failed to send test webhook',
        description: err?.message || String(err),
        variant: 'destructive',
        duration: 12_000,
      });
    },
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        'DELETE',
        '/api/admin/settings/coverage-drop-alert',
      );
      return (await res.json()) as CoverageDropAlertSettingsResponse;
    },
    onSuccess: (next) => {
      toast({
        title: 'Reverted to env / defaults',
        description: `Effective: >${next.effective.thresholdPp}pp drop, n≥${next.effective.minStations}.`,
      });
      queryClient.setQueryData(
        ['/api/admin/settings/coverage-drop-alert'],
        next,
      );
      void queryClient.invalidateQueries({
        queryKey: ['/api/admin/settings/coverage-drop-alert/history'],
      });
      setHydrated(false);
    },
    onError: (err: any) => {
      toast({
        title: 'Failed to clear settings',
        description: err?.message || String(err),
        variant: 'destructive',
      });
    },
  });

  const revertToHistoryMutation = useMutation({
    mutationFn: async (entry: CoverageDropAlertHistoryEntry) => {
      const target = entry.newValue;
      if (target === null) {
        const res = await apiRequest(
          'DELETE',
          '/api/admin/settings/coverage-drop-alert',
        );
        return (await res.json()) as CoverageDropAlertSettingsResponse;
      }
      const res = await apiRequest(
        'PUT',
        '/api/admin/settings/coverage-drop-alert',
        {
          body: {
            thresholdPp: target.thresholdPp,
            minStations: target.minStations,
            webhookUrl: target.webhookUrl,
          },
        },
      );
      return (await res.json()) as CoverageDropAlertSettingsResponse;
    },
    onSuccess: (next) => {
      toast({
        title: 'Reverted to previous value',
        description: `Effective: >${next.effective.thresholdPp}pp drop, n≥${next.effective.minStations}.`,
      });
      queryClient.setQueryData(
        ['/api/admin/settings/coverage-drop-alert'],
        next,
      );
      void queryClient.invalidateQueries({
        queryKey: ['/api/admin/settings/coverage-drop-alert/history'],
      });
      setHydrated(false);
    },
    onError: (err: any) => {
      toast({
        title: 'Failed to revert',
        description: err?.message || String(err),
        variant: 'destructive',
      });
    },
  });

  const anyMutationPending =
    saveMutation.isPending ||
    resetMutation.isPending ||
    revertToHistoryMutation.isPending;

  return (
    <Card data-testid="card-coverage-drop-settings">
      <CardHeader>
        <CardTitle>Coverage drop alert</CardTitle>
        <CardDescription>
          Tune when the nightly snapshot warns the team about a country
          whose logo or tag coverage has dropped vs 7 days ago. Leave a
          field blank to fall back to the env var or built-in default.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading || !data ? (
          <div className="flex items-center gap-2 py-6 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading settings…
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <label
                  htmlFor="coverage-drop-threshold"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Drop threshold (percentage points)
                </label>
                <Input
                  id="coverage-drop-threshold"
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  inputMode="decimal"
                  placeholder={`e.g. ${data.defaults.thresholdPp}`}
                  value={thresholdPp}
                  onChange={(e) => setThresholdPp(e.target.value)}
                  data-testid="input-coverage-drop-threshold"
                />
                <p className="text-[11px] text-muted-foreground">
                  Effective: <strong>{data.effective.thresholdPp}pp</strong>{' '}
                  ({sourceLabel(data.effective.source.thresholdPp)})
                </p>
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="coverage-drop-min-stations"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Minimum stations per country
                </label>
                <Input
                  id="coverage-drop-min-stations"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  placeholder={`e.g. ${data.defaults.minStations}`}
                  value={minStations}
                  onChange={(e) => setMinStations(e.target.value)}
                  data-testid="input-coverage-drop-min-stations"
                />
                <p className="text-[11px] text-muted-foreground">
                  Effective: <strong>n≥{data.effective.minStations}</strong>{' '}
                  ({sourceLabel(data.effective.source.minStations)})
                </p>
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="coverage-drop-webhook"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Webhook URL (optional)
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    id="coverage-drop-webhook"
                    type="url"
                    placeholder="https://hooks.slack.com/…"
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    data-testid="input-coverage-drop-webhook"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => testWebhookMutation.mutate()}
                    disabled={
                      testWebhookMutation.isPending ||
                      saveMutation.isPending ||
                      resetMutation.isPending ||
                      // No URL anywhere — typed-but-empty AND no saved/env URL
                      (webhookUrl.trim() === '' &&
                        !data.effective.webhookUrl)
                    }
                    title={
                      webhookUrl.trim() !== ''
                        ? 'POST a test payload to the URL in the field above (does not save).'
                        : 'POST a test payload to the currently-effective webhook URL.'
                    }
                    data-testid="button-coverage-drop-test-webhook"
                  >
                    {testWebhookMutation.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : null}
                    Send test
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Effective:{' '}
                  <strong>
                    {data.effective.webhookUrl ? 'configured' : 'none'}
                  </strong>{' '}
                  ({sourceLabel(data.effective.source.webhookUrl)})
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <p className="text-[11px] text-muted-foreground">
                {data.updatedAt
                  ? `Last updated ${new Date(data.updatedAt).toLocaleString()}${
                      data.updatedBy ? ` by ${data.updatedBy}` : ''
                    }.`
                  : 'No UI override saved yet — using env vars or defaults.'}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setHydrated(false);
                    void refetch();
                  }}
                  disabled={anyMutationPending}
                  data-testid="button-coverage-drop-revert"
                >
                  Revert
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => resetMutation.mutate()}
                  disabled={
                    anyMutationPending ||
                    (data.stored.thresholdPp == null &&
                      data.stored.minStations == null &&
                      data.stored.webhookUrl == null)
                  }
                  data-testid="button-coverage-drop-clear"
                >
                  {resetMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : null}
                  Use env / defaults
                </Button>
                <Button
                  size="sm"
                  onClick={() => saveMutation.mutate()}
                  disabled={anyMutationPending}
                  data-testid="button-coverage-drop-save"
                >
                  {saveMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : null}
                  Save
                </Button>
              </div>
            </div>

            <div className="border-t pt-3">
              <button
                type="button"
                onClick={() => {
                  const next = !historyOpen;
                  setHistoryOpen(next);
                  if (next) void refetchHistory();
                }}
                className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                aria-expanded={historyOpen}
                data-testid="button-coverage-drop-history-toggle"
              >
                {historyOpen ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
                Recent changes
                {historyData?.entries?.length
                  ? ` (${historyData.entries.length})`
                  : ''}
              </button>

              {historyOpen ? (
                <div
                  className="mt-3"
                  data-testid="panel-coverage-drop-history"
                >
                  {historyLoading ? (
                    <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />{' '}
                      Loading history…
                    </div>
                  ) : !historyData || historyData.entries.length === 0 ? (
                    <p className="py-3 text-xs text-muted-foreground">
                      No changes recorded yet. Saving or clearing the
                      settings above will start the audit log.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {historyData.entries.map((entry) => {
                        const when = new Date(entry.changedAt);
                        const who = entry.changedBy ?? 'unknown admin';
                        const actionLabel =
                          entry.action === 'clear'
                            ? 'Cleared override'
                            : 'Updated';
                        return (
                          <li
                            key={entry.id}
                            className="rounded-md border bg-muted/30 px-3 py-2 text-xs"
                            data-testid={`history-row-${entry.id}`}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="space-y-1">
                                <div>
                                  <strong>{actionLabel}</strong> by{' '}
                                  {who} ·{' '}
                                  <span title={when.toISOString()}>
                                    {when.toLocaleString()}
                                  </span>
                                </div>
                                <div className="text-muted-foreground">
                                  From: {describeSettingValue(entry.previousValue)}
                                </div>
                                <div className="text-muted-foreground">
                                  To: {describeSettingValue(entry.newValue)}
                                </div>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                disabled={anyMutationPending}
                                onClick={() =>
                                  revertToHistoryMutation.mutate(entry)
                                }
                                data-testid={`button-coverage-drop-history-revert-${entry.id}`}
                                title="Re-apply the value from this history row"
                              >
                                <Undo2 className="w-3.5 h-3.5 mr-1" />
                                Revert to this value
                              </Button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              ) : null}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface ReconstructHistoryResponse {
  success: boolean;
  days: number;
  dryRun: boolean;
  daysSeeded: number;
  inserted: number;
  preserved: number;
  wouldWrite: number;
  skippedReason?: 'no-stations';
}

// Admin-only "Reconstruct sparkline history" button (Task #237). Runs
// the same one-shot historical seeder as
// `scripts/backfill-coverage-snapshots.ts`, but from the UI so admins
// can re-seed history after a bulk import without shell access. Days
// window defaults to 30 (the sparkline's range) and can be tuned in
// the prompt. Idempotent — real cron-written rows are preserved.
function ReconstructHistoryButton() {
  const { toast } = useToast();
  const mutation = useMutation({
    mutationFn: async (vars: { days: number; dryRun: boolean }) => {
      const res = await apiRequest(
        'POST',
        '/api/admin/coverage/reconstruct-history',
        { body: { days: vars.days, dryRun: vars.dryRun } },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `Request failed (${res.status})`);
      }
      const json = (await res.json()) as ReconstructHistoryResponse;
      return { ...json, dryRun: vars.dryRun };
    },
    onSuccess: (result) => {
      if (result.skippedReason === 'no-stations') {
        toast({
          title: 'Nothing to reconstruct',
          description: 'Stations collection is empty.',
        });
      } else if (result.dryRun) {
        toast({
          title: `Preview: would seed ${result.daysSeeded} day${
            result.daysSeeded === 1 ? '' : 's'
          } of history`,
          description: `${result.wouldWrite.toLocaleString()} row${
            result.wouldWrite === 1 ? '' : 's'
          } would be written · ${result.preserved.toLocaleString()} already present (preserved). No rows written.`,
        });
      } else {
        toast({
          title: `Reconstructed ${result.daysSeeded} day${
            result.daysSeeded === 1 ? '' : 's'
          } of history`,
          description: `${result.inserted.toLocaleString()} inserted · ${result.preserved.toLocaleString()} preserved (already present).`,
        });
      }
      if (!result.dryRun) {
        void queryClient.invalidateQueries({
          queryKey: ['/api/admin/coverage/trends?days=30'],
        });
      }
    },
    onError: (err: any) => {
      toast({
        title: 'Failed to reconstruct sparkline history',
        description: err?.message || String(err),
        variant: 'destructive',
      });
    },
  });

  const promptDays = (): number | null => {
    const raw = window.prompt(
      'How many days of history to reconstruct? (1–365)',
      '30',
    );
    if (raw === null) return null;
    const days = Number(raw.trim());
    if (!Number.isFinite(days) || !Number.isInteger(days) || days < 1 || days > 365) {
      toast({
        title: 'Invalid days value',
        description: 'Enter an integer between 1 and 365.',
        variant: 'destructive',
      });
      return null;
    }
    return days;
  };

  const handleRun = () => {
    const days = promptDays();
    if (days === null) return;
    mutation.mutate({ days, dryRun: false });
  };

  const handleDryRun = () => {
    const days = promptDays();
    if (days === null) return;
    mutation.mutate({ days, dryRun: true });
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={handleDryRun}
        disabled={mutation.isPending}
        data-testid="button-reconstruct-history-dry-run"
        title="Preview how many rows would be seeded without writing anything to the database."
      >
        {mutation.isPending && mutation.variables?.dryRun ? (
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        ) : (
          <RefreshCw className="w-4 h-4 mr-2" />
        )}
        Preview (dry run)
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={handleRun}
        disabled={mutation.isPending}
        data-testid="button-reconstruct-history"
        title="Re-run the one-shot historical sparkline reconstruction. Idempotent — real nightly snapshots are preserved."
      >
        {mutation.isPending && !mutation.variables?.dryRun ? (
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        ) : (
          <RefreshCw className="w-4 h-4 mr-2" />
        )}
        Reconstruct sparkline history
      </Button>
    </div>
  );
}

// Task #232: read-only status card showing the outcome of the
// first-deploy historical backfill (`services/coverage-backfill-on-boot.ts`).
// The boot service writes a singleton status doc on every boot decision
// (skipped/started/done/failed) and we just render whatever we find.
function CoverageBackfillBootStatusCard() {
  // Task #310: country pages link to this card via
  // `?backfillRange=START..END#card-coverage-backfill-boot-status` so an
  // admin who clicks a "Reconstructed: 2026-04-08 → 2026-04-22" caption
  // lands here. We parse the param on mount and then, once the status
  // doc has loaded, check whether the focused range actually overlaps
  // the run's seed window (computed from `startedAt` + `daysSeeded`).
  // The card is only highlighted when it matches — otherwise we render
  // a "no matching run" notice so admins aren't fooled into thinking an
  // unrelated run produced those days. The param is stripped after we
  // have a verdict so a refresh doesn't re-trigger the highlight.
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [focusedRange, setFocusedRange] = useState<{
    start: string;
    end: string;
  } | null>(null);
  const [highlight, setHighlight] = useState(false);
  const [matchVerdict, setMatchVerdict] = useState<
    'pending' | 'matched' | 'unmatched'
  >('pending');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('backfillRange');
    if (!raw) return;
    const m = raw.match(/^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/);
    if (!m) return;
    setFocusedRange({ start: m[1], end: m[2] });
  }, []);

  const { data, isLoading } = useQuery<CoverageBackfillBootStatusResponse>({
    queryKey: ['/api/admin/coverage/backfill-status'],
    // While a seeder is still running we want the card to flip to "done"
    // promptly without forcing a manual refresh; otherwise an admin who
    // opens the page right after deploy can sit on a stale "running"
    // banner. Refetch every 5s only while the latest known outcome is
    // 'running'; the result of this query feeds the interval below.
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });

  // While the latest known outcome is 'running', keep polling so the
  // card flips to its terminal state without a manual refresh.
  const outcome = data?.status?.outcome ?? null;
  useEffect(() => {
    if (outcome !== 'running') return;
    const interval = window.setInterval(() => {
      void queryClient.invalidateQueries({
        queryKey: ['/api/admin/coverage/backfill-status'],
      });
    }, 5000);
    return () => window.clearInterval(interval);
  }, [outcome]);

  const status = data?.status ?? null;

  // Compute the date window the recorded run actually wrote: the seeder
  // backfills `daysSeeded` (or the requested `seedDays`) days ending the
  // day before the run's startedAt timestamp. Returns null when we don't
  // have enough info to draw the window (e.g. skipped runs).
  const runWindow = useMemo<{ start: string; end: string } | null>(() => {
    if (!status?.startedAt) return null;
    const days = status.daysSeeded ?? status.seedDays;
    if (!days || days <= 0) return null;
    const startedMs = Date.parse(status.startedAt);
    if (!Number.isFinite(startedMs)) return null;
    const endMs = startedMs - 24 * 60 * 60 * 1000;
    const startMs = endMs - (days - 1) * 24 * 60 * 60 * 1000;
    const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    return { start: toIso(startMs), end: toIso(endMs) };
  }, [status]);

  // Once both the focused range and the run window are known, decide
  // whether the run actually covers the requested days (overlap test),
  // then apply the highlight + scroll once and clean up the URL.
  useEffect(() => {
    if (!focusedRange) return;
    if (matchVerdict !== 'pending') return;
    if (isLoading) return;
    // Strict containment: the run must have written every day in the
    // clicked range, otherwise we'd claim a match for a partially-
    // overlapping older run that didn't actually produce all of those
    // days.
    const contains =
      !!runWindow &&
      focusedRange.start >= runWindow.start &&
      focusedRange.end <= runWindow.end;
    setMatchVerdict(contains ? 'matched' : 'unmatched');
    const scroll = window.setTimeout(() => {
      cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
    let fade: number | null = null;
    if (contains) {
      setHighlight(true);
      fade = window.setTimeout(() => setHighlight(false), 4000);
    }
    const params = new URLSearchParams(window.location.search);
    params.delete('backfillRange');
    const next = `${window.location.pathname}${
      params.toString() ? `?${params.toString()}` : ''
    }${window.location.hash}`;
    window.history.replaceState(null, '', next);
    return () => {
      window.clearTimeout(scroll);
      if (fade != null) window.clearTimeout(fade);
    };
  }, [focusedRange, runWindow, isLoading, matchVerdict]);

  const meta = (() => {
    switch (status?.outcome) {
      case 'done':
        return {
          label: 'Backfill ran',
          tone: 'bg-green-100 text-green-800 border-green-200',
        };
      case 'done-no-stations':
        return {
          label: 'Backfill ran (no stations)',
          tone: 'bg-amber-100 text-amber-800 border-amber-200',
        };
      case 'running':
        return {
          label: 'Backfill running…',
          tone: 'bg-blue-100 text-blue-800 border-blue-200',
        };
      case 'failed':
        return {
          label: 'Backfill failed',
          tone: 'bg-red-100 text-red-800 border-red-200',
        };
      case 'skipped-env':
        return {
          label: 'Skipped (env)',
          tone: 'bg-muted text-muted-foreground border-border',
        };
      case 'skipped-already-seeded':
        return {
          label: 'Skipped (not needed)',
          tone: 'bg-muted text-muted-foreground border-border',
        };
      case 'skipped-count-error':
        return {
          label: 'Skipped (DB error)',
          tone: 'bg-amber-100 text-amber-800 border-amber-200',
        };
      default:
        return {
          label: 'Unknown',
          tone: 'bg-muted text-muted-foreground border-border',
        };
    }
  })();

  function fmtDate(iso?: string | null) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }

  function fmtDuration(ms?: number | null) {
    if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
    if (ms < 1000) return `${ms} ms`;
    const s = Math.round(ms / 100) / 10;
    if (s < 60) return `${s.toFixed(1)} s`;
    const m = Math.floor(s / 60);
    const rem = Math.round(s - m * 60);
    return `${m}m ${rem}s`;
  }

  return (
    <Card
      ref={cardRef}
      id="card-coverage-backfill-boot-status"
      data-testid="card-coverage-backfill-boot-status"
      data-focused-range={
        focusedRange ? `${focusedRange.start}..${focusedRange.end}` : undefined
      }
      data-focused-range-match={
        focusedRange ? matchVerdict : undefined
      }
      className={
        highlight
          ? 'ring-2 ring-amber-400 ring-offset-2 transition-shadow scroll-mt-4'
          : 'transition-shadow scroll-mt-4'
      }
    >
      <CardHeader>
        <CardTitle>Sparkline data — first-deploy backfill</CardTitle>
        {focusedRange && matchVerdict === 'matched' ? (
          <div
            className="mt-1 text-xs text-amber-700"
            data-testid="text-backfill-boot-focused-range"
          >
            This run wrote the{' '}
            <span className="font-mono">
              {focusedRange.start === focusedRange.end
                ? focusedRange.start
                : `${focusedRange.start} → ${focusedRange.end}`}
            </span>{' '}
            range you clicked
            {runWindow ? (
              <>
                {' '}(seed window{' '}
                <span className="font-mono">
                  {runWindow.start} → {runWindow.end}
                </span>
                )
              </>
            ) : null}
            .
          </div>
        ) : null}
        {focusedRange && matchVerdict === 'unmatched' ? (
          <div
            className="mt-1 text-xs text-muted-foreground"
            data-testid="text-backfill-boot-focused-range-unmatched"
          >
            No recorded backfill run covers{' '}
            <span className="font-mono">
              {focusedRange.start === focusedRange.end
                ? focusedRange.start
                : `${focusedRange.start} → ${focusedRange.end}`}
            </span>
            {runWindow ? (
              <>
                {' '}— the latest run's seed window was{' '}
                <span className="font-mono">
                  {runWindow.start} → {runWindow.end}
                </span>
              </>
            ) : null}
            . Those days may have come from an older run that isn't in the
            single-row history yet.
          </div>
        ) : null}
        <CardDescription>
          Whether the historical coverage seeder ran on the most recent
          boot, and what it did. Updated automatically by the API on
          startup; restart the API to re-evaluate.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 py-6 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading status…
          </div>
        ) : !status ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid="text-backfill-boot-status-none"
          >
            No boot run recorded yet. The API hasn't evaluated the
            historical backfill on this database since the status doc
            was added.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className={meta.tone}
                data-testid="badge-backfill-boot-outcome"
              >
                {meta.label}
              </Badge>
              <span
                className="text-xs text-muted-foreground"
                data-testid="text-backfill-boot-observed-at"
              >
                last evaluated {fmtDate(status.observedAt)}
              </span>
            </div>
            <p
              className="text-sm"
              data-testid="text-backfill-boot-message"
            >
              {status.message}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
              <div>
                <div className="text-xs uppercase text-muted-foreground">
                  Started
                </div>
                <div data-testid="text-backfill-boot-started-at">
                  {fmtDate(status.startedAt)}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">
                  Finished
                </div>
                <div data-testid="text-backfill-boot-finished-at">
                  {fmtDate(status.finishedAt)}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">
                  Duration
                </div>
                <div data-testid="text-backfill-boot-duration">
                  {fmtDuration(status.durationMs)}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">
                  Days seeded
                </div>
                <div data-testid="text-backfill-boot-days-seeded">
                  {status.daysSeeded ?? '—'}
                  {status.seedDays != null ? (
                    <span className="text-muted-foreground">
                      {' '}
                      / {status.seedDays} requested
                    </span>
                  ) : null}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">
                  Rows inserted
                </div>
                <div data-testid="text-backfill-boot-inserted">
                  {status.inserted ?? '—'}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">
                  Rows preserved
                </div>
                <div data-testid="text-backfill-boot-preserved">
                  {status.preserved ?? '—'}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">
                  Existing days
                </div>
                <div data-testid="text-backfill-boot-historical-days">
                  {status.historicalDayCount ?? '—'}
                  {status.thresholdDays != null ? (
                    <span className="text-muted-foreground">
                      {' '}
                      / threshold {status.thresholdDays}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
            {status.error ? (
              <Alert
                variant="destructive"
                data-testid="alert-backfill-boot-error"
              >
                <AlertTriangle className="w-4 h-4" />
                <AlertTitle>Last seeder error</AlertTitle>
                <AlertDescription>
                  <code className="text-xs break-all">{status.error}</code>
                </AlertDescription>
              </Alert>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// Collapsible "Recent coverage drop alerts" panel. Sits under the
// latest-alert banner and gives admins a quick way to spot countries
// that have been flaky over time without leaving the coverage page.
// Each row is independently expandable to reveal the full set of
// country/metric chips (same deep-link target as the live banner).
function CoverageDropAlertHistorySection(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  history: CoverageDropAlert[];
  hasMore: boolean;
  isFetching: boolean;
  onLoadMore: () => void;
  // The latest alert is already shown in its own banner — surface a hint
  // when the topmost history row matches it so admins aren't surprised
  // to see it again.
  latestSnapshotDate: string | null;
}) {
  const {
    open,
    onOpenChange,
    history,
    hasMore,
    isFetching,
    onLoadMore,
    latestSnapshotDate,
  } = props;

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <Card data-testid="card-coverage-drop-history">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="w-full text-left"
            data-testid="button-coverage-drop-history-toggle"
          >
            <CardHeader className="flex-row items-center gap-2 space-y-0">
              <History className="w-4 h-4 text-muted-foreground" />
              <div className="flex-1">
                <CardTitle className="text-base">
                  Recent coverage drop alerts
                </CardTitle>
                <CardDescription>
                  History of nightly alerts so you can spot chronically flaky
                  countries at a glance.
                </CardDescription>
              </div>
              {open ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              )}
            </CardHeader>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent
            className="space-y-2"
            data-testid="content-coverage-drop-history"
          >
            {isFetching && history.length === 0 ? (
              <div className="flex items-center gap-2 py-6 justify-center text-muted-foreground text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading alert history…
              </div>
            ) : history.length === 0 ? (
              <div
                className="py-6 text-center text-sm text-muted-foreground"
                data-testid="empty-coverage-drop-history"
              >
                No coverage drop alerts have been recorded yet.
              </div>
            ) : (
              <>
                <ul className="space-y-2">
                  {history.map((alert, idx) => (
                    <CoverageDropAlertHistoryRow
                      key={`${alert.snapshotDate ?? alert.createdAt}:${idx}`}
                      alert={alert}
                      isLatest={
                        !!latestSnapshotDate &&
                        alert.snapshotDate === latestSnapshotDate &&
                        idx === 0
                      }
                    />
                  ))}
                </ul>
                <div className="flex items-center justify-between pt-2 text-xs text-muted-foreground">
                  <span>
                    Showing {history.length} alert
                    {history.length === 1 ? '' : 's'}
                    {hasMore ? ' (more available)' : ''}.
                  </span>
                  {hasMore ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onLoadMore}
                      disabled={isFetching}
                      data-testid="button-coverage-drop-history-load-more"
                    >
                      {isFetching ? (
                        <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                      ) : null}
                      Load older
                    </Button>
                  ) : null}
                </div>
              </>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

function CoverageDropAlertHistoryRow(props: {
  alert: CoverageDropAlert;
  isLatest: boolean;
}) {
  const { alert, isLatest } = props;
  const [open, setOpen] = useState(false);
  // Group drops by country so the collapsed summary can show a useful
  // top-offenders preview ("US +2, DE +1") instead of just a raw count.
  const byCountry = useMemo(() => {
    const map = new Map<string, CoverageDropAlertEntry[]>();
    for (const d of alert.drops) {
      const code = d.countryCode.toUpperCase();
      const list = map.get(code) ?? [];
      list.push(d);
      map.set(code, list);
    }
    return Array.from(map.entries())
      .map(([code, entries]) => ({
        code,
        entries,
        // Worst (most negative) deltaPp drives ranking so the loudest
        // regressions float to the top of the preview.
        worstDeltaPp: entries.reduce(
          (acc, e) => Math.min(acc, e.deltaPp),
          0,
        ),
      }))
      .sort((a, b) => a.worstDeltaPp - b.worstDeltaPp);
  }, [alert.drops]);

  const topOffenders = byCountry.slice(0, 3);
  const dateLabel = alert.snapshotDate ?? alert.createdAt.slice(0, 10);

  return (
    <li
      className="rounded-md border border-border bg-card"
      data-testid={`coverage-drop-history-row-${dateLabel}`}
    >
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="w-full flex flex-wrap items-center gap-3 p-3 text-left hover:bg-muted/40 rounded-md"
            data-testid={`button-coverage-drop-history-row-toggle-${dateLabel}`}
          >
            {open ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
            )}
            <div className="flex flex-col min-w-[140px]">
              <span className="text-sm font-medium tabular-nums">
                {dateLabel}
              </span>
              <span className="text-xs text-muted-foreground">
                {alert.thresholdPp != null
                  ? `threshold ${alert.thresholdPp}pp`
                  : 'threshold —'}
                {isLatest ? ' · latest' : ''}
              </span>
            </div>
            <Badge
              variant="outline"
              className="border-red-300 text-red-800"
              data-testid={`badge-coverage-drop-history-count-${dateLabel}`}
            >
              {alert.drops.length}{' '}
              {alert.drops.length === 1 ? 'drop' : 'drops'} ·{' '}
              {byCountry.length}{' '}
              {byCountry.length === 1 ? 'country' : 'countries'}
            </Badge>
            <div className="flex flex-wrap gap-1 ml-auto">
              {topOffenders.map((c) => (
                <span
                  key={c.code}
                  className="inline-flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-xs"
                >
                  <span className="font-mono font-semibold">{c.code}</span>
                  <span className="tabular-nums text-red-700">
                    {c.worstDeltaPp.toFixed(1)}pp
                  </span>
                </span>
              ))}
              {byCountry.length > topOffenders.length ? (
                <span className="text-xs text-muted-foreground self-center">
                  +{byCountry.length - topOffenders.length} more
                </span>
              ) : null}
            </div>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div
            className="px-3 pb-3 pt-0 flex flex-wrap gap-2"
            data-testid={`coverage-drop-history-chips-${dateLabel}`}
          >
            {alert.drops.map((d, i) => (
              <Link
                key={`${d.countryCode}:${d.metric}:${i}`}
                href={`/admin/coverage/${d.countryCode}`}
                className="inline-flex items-center gap-1.5 rounded border border-red-300 bg-red-50/60 px-2 py-1 text-xs hover:bg-red-50"
                data-testid={`history-drop-${dateLabel}-${d.countryCode}-${d.metric}`}
              >
                <span className="font-mono font-semibold">
                  {d.countryCode}
                </span>
                <span className="text-red-800/80">
                  {d.metric === 'logo' ? 'logo' : 'tags'}
                </span>
                <span className="tabular-nums">
                  {d.weekAgoPct.toFixed(1)}% → {d.todayPct.toFixed(1)}%
                </span>
                <span className="font-semibold tabular-nums">
                  ({d.deltaPp.toFixed(1)}pp)
                </span>
              </Link>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}
