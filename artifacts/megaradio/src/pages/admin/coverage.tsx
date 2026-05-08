import { useMemo, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
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
import { Loader2, RefreshCw, Image as ImageIcon, Tag } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

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

export default function AdminCoverage() {
  const { toast } = useToast();
  const [sortKey, setSortKey] = useState<SortKey>('logoCoveragePct');
  const [search, setSearch] = useState('');
  const [minStations, setMinStations] = useState(10);
  const [enqueuing, setEnqueuing] = useState<string | null>(null);

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
        countryCode: string;
        scope: string;
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
      void refetch();
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
                    <TableHead className="text-right">Missing logos</TableHead>
                    <TableHead className="text-right">Tag coverage</TableHead>
                    <TableHead className="text-right">Missing tags</TableHead>
                    <TableHead className="text-right">Re-enqueue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((row) => {
                    const logoKey = `${row.countryCode}:logos`;
                    const tagsKey = `${row.countryCode}:tags`;
                    const bothKey = `${row.countryCode}:both`;
                    return (
                      <TableRow
                        key={row.countryCode}
                        data-testid={`row-coverage-${row.countryCode}`}
                      >
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-muted">
                              {row.countryCode}
                            </span>
                            <span className="font-medium">
                              {row.countryName}
                            </span>
                          </div>
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
