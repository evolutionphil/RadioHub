import { useMemo } from 'react';
import { Link, useRoute } from 'wouter';
import { useQuery } from '@tanstack/react-query';
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Download, Loader2 } from 'lucide-react';

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

function coverageBadgeClass(pct: number): string {
  if (pct >= 90) return 'bg-green-100 text-green-700 border-green-200';
  if (pct >= 70) return 'bg-amber-100 text-amber-700 border-amber-200';
  return 'bg-red-100 text-red-700 border-red-200';
}

function formatDelta(delta: number): string {
  const rounded = Math.round(delta * 10) / 10;
  if (rounded === 0) return '±0.0';
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded.toFixed(1)}`;
}

function deltaClass(delta: number): string {
  if (delta > 0.05) return 'text-green-600';
  if (delta < -0.05) return 'text-red-600';
  return 'text-muted-foreground';
}

export default function AdminCoverageCountry() {
  const [, params] = useRoute<{ countryCode: string }>(
    '/admin/coverage/:countryCode',
  );
  const code = (params?.countryCode || '').toUpperCase();

  const { data: trendsData, isLoading: trendsLoading } =
    useQuery<TrendsResponse>({
      queryKey: [
        `/api/admin/coverage/trends?days=90&countryCode=${encodeURIComponent(code)}`,
      ],
      enabled: !!code,
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    });

  const { data: coverageData } = useQuery<CoverageResponse>({
    queryKey: ['/api/admin/coverage/by-country'],
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const country = useMemo(
    () => coverageData?.countries.find((c) => c.countryCode === code),
    [coverageData, code],
  );

  const trend = trendsData?.trends?.[code] ?? [];

  // Append today's live coverage so the rightmost point matches the headline
  // KPIs (the snapshot cron may not have run yet today).
  const series = useMemo<TrendPoint[]>(() => {
    if (!country) return trend;
    const todayUtc = new Date().toISOString().slice(0, 10);
    const last = trend[trend.length - 1];
    if (last && last.date === todayUtc) return trend;
    return [
      ...trend,
      {
        date: todayUtc,
        logoCoveragePct: country.logoCoveragePct,
        tagCoveragePct: country.tagCoveragePct,
        total: country.total,
        withLogo: country.withLogo,
        withTags: country.withTags,
      },
    ];
  }, [trend, country]);

  const oldest = series[0];
  const latest = series[series.length - 1];
  const logoDelta =
    oldest && latest ? latest.logoCoveragePct - oldest.logoCoveragePct : 0;
  const tagDelta =
    oldest && latest ? latest.tagCoveragePct - oldest.tagCoveragePct : 0;

  const handleDownloadCsv = () => {
    if (series.length === 0) return;
    const header = [
      'date',
      'logoCoveragePct',
      'tagCoveragePct',
      'total',
      'withLogo',
      'withTags',
    ];
    const rows = series.map((p) => [
      p.date,
      p.logoCoveragePct.toFixed(2),
      p.tagCoveragePct.toFixed(2),
      String(p.total),
      String(p.withLogo),
      String(p.withTags),
    ]);
    const csv =
      [header, ...rows].map((r) => r.join(',')).join('\n') + '\n';
    const today = new Date().toISOString().slice(0, 10);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `coverage-${code}-${today}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (!code) {
    return (
      <div className="container mx-auto p-6">
        <p className="text-sm text-muted-foreground">No country selected.</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-2">
          <Link href="/admin/coverage">
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2"
              data-testid="link-back-to-coverage"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to coverage
            </Button>
          </Link>
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs px-2 py-1 rounded bg-muted">
              {code}
            </span>
            <h1
              className="text-2xl font-bold"
              data-testid="heading-country-name"
            >
              {country?.countryName ?? code}
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Daily logo and tag coverage over the last 90 days. Use this view to
            inspect a sudden drop or share a screenshot with the team.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleDownloadCsv}
          disabled={series.length === 0}
          data-testid="button-download-csv"
        >
          <Download className="w-4 h-4 mr-1" />
          Download CSV
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total stations</CardDescription>
            <CardTitle
              className="text-2xl tabular-nums"
              data-testid="kpi-total"
            >
              {country ? country.total.toLocaleString() : '—'}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Denominator for both coverage percentages
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Logo coverage</CardDescription>
            <CardTitle className="text-2xl flex items-center gap-2">
              {country ? (
                <Badge
                  variant="outline"
                  className={coverageBadgeClass(country.logoCoveragePct)}
                  data-testid="kpi-logo-pct"
                >
                  {country.logoCoveragePct.toFixed(1)}%
                </Badge>
              ) : (
                '—'
              )}
              {oldest ? (
                <span
                  className={`text-xs tabular-nums ${deltaClass(logoDelta)}`}
                  title={`vs ${oldest.date} (${oldest.logoCoveragePct.toFixed(1)}%)`}
                  data-testid="kpi-logo-delta"
                >
                  {formatDelta(logoDelta)}pp
                </span>
              ) : null}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            <span data-testid="kpi-with-logo">
              {country ? country.withLogo.toLocaleString() : '—'}
            </span>{' '}
            with a completed logo ·{' '}
            {country ? country.missingLogo.toLocaleString() : '—'} missing
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Tag coverage</CardDescription>
            <CardTitle className="text-2xl flex items-center gap-2">
              {country ? (
                <Badge
                  variant="outline"
                  className={coverageBadgeClass(country.tagCoveragePct)}
                  data-testid="kpi-tags-pct"
                >
                  {country.tagCoveragePct.toFixed(1)}%
                </Badge>
              ) : (
                '—'
              )}
              {oldest ? (
                <span
                  className={`text-xs tabular-nums ${deltaClass(tagDelta)}`}
                  title={`vs ${oldest.date} (${oldest.tagCoveragePct.toFixed(1)}%)`}
                  data-testid="kpi-tags-delta"
                >
                  {formatDelta(tagDelta)}pp
                </span>
              ) : null}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            <span data-testid="kpi-with-tags">
              {country ? country.withTags.toLocaleString() : '—'}
            </span>{' '}
            with non-empty tags ·{' '}
            {country ? country.missingTags.toLocaleString() : '—'} missing
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Coverage % over time</CardTitle>
          <CardDescription>
            Logo and tag coverage by day. Snapshots are written nightly by the
            scheduled job; today's point reflects live numbers.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {trendsLoading ? (
            <div className="flex items-center gap-2 py-12 justify-center text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading trend…
            </div>
          ) : series.length < 2 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Not enough snapshots yet to draw a chart for {code}. Come back
              tomorrow.
            </div>
          ) : (
            <div
              className="w-full h-[360px]"
              data-testid="chart-coverage-percent"
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={series}
                  margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11 }}
                    minTickGap={24}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tickFormatter={(v) => `${v}%`}
                    tick={{ fontSize: 11 }}
                    width={48}
                  />
                  <Tooltip
                    formatter={(value: number, name: string) => [
                      `${Number(value).toFixed(1)}%`,
                      name,
                    ]}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="logoCoveragePct"
                    name="Logo coverage"
                    stroke="#16a34a"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="tagCoveragePct"
                    name="Tag coverage"
                    stroke="#2563eb"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Raw counts over time</CardTitle>
          <CardDescription>
            Total stations, with-logo, and with-tags as raw numbers — useful to
            tell whether coverage moved because the numerator changed or
            because the denominator did.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {trendsLoading ? (
            <div className="flex items-center gap-2 py-12 justify-center text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading trend…
            </div>
          ) : series.length < 2 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Not enough snapshots yet to draw a chart for {code}.
            </div>
          ) : (
            <div className="w-full h-[320px]" data-testid="chart-coverage-raw">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={series}
                  margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11 }}
                    minTickGap={24}
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    width={56}
                    tickFormatter={(v) => Number(v).toLocaleString()}
                  />
                  <Tooltip
                    formatter={(value: number, name: string) => [
                      Number(value).toLocaleString(),
                      name,
                    ]}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="total"
                    name="Total stations"
                    stroke="#6b7280"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="withLogo"
                    name="With logo"
                    stroke="#16a34a"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="withTags"
                    name="With tags"
                    stroke="#2563eb"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
