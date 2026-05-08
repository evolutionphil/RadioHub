import { useMemo, useState } from 'react';
import { Link } from 'wouter';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ArrowLeft, ChevronDown, Loader2, X } from 'lucide-react';

interface TrendPoint {
  date: string;
  logoCoveragePct: number;
  tagCoveragePct: number;
  total: number;
  withLogo: number;
  withTags: number;
  // 'cron' = real nightly snapshot of live data; 'backfill' = day was
  // reconstructed by the historical seeder (Task #144 / boot backfill in
  // Task #176) from existing station signals. Backfilled days — and tag
  // values for those days in particular — are best-effort reconstructions,
  // not real point-in-time snapshots, so the chart draws them dashed.
  source?: 'cron' | 'backfill';
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
  logoCoveragePct: number;
  tagCoveragePct: number;
}

interface CoverageResponse {
  countries: CountryCoverage[];
}

// Distinguishable line colors for up to 8 simultaneous series. Beyond that we
// recycle — the picker caps selection at 8 anyway so the chart stays readable.
const SERIES_COLORS = [
  '#2563eb',
  '#16a34a',
  '#dc2626',
  '#9333ea',
  '#ea580c',
  '#0891b2',
  '#ca8a04',
  '#db2777',
];

const MAX_SELECTED = 8;

const RANGE_OPTIONS = [7, 14, 30, 90, 180] as const;
type RangeDays = (typeof RANGE_OPTIONS)[number];
const DEFAULT_RANGE: RangeDays = 90;

function colorForIndex(i: number): string {
  return SERIES_COLORS[i % SERIES_COLORS.length];
}

function readSelectedFromUrl(): string[] {
  if (typeof window === 'undefined') return [];
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('countries') || '';
  return Array.from(
    new Set(
      raw
        .split(',')
        .map((c) => c.trim().toUpperCase())
        .filter((c) => /^[A-Z]{2}$/.test(c)),
    ),
  ).slice(0, MAX_SELECTED);
}

function readRangeFromUrl(): RangeDays {
  if (typeof window === 'undefined') return DEFAULT_RANGE;
  const params = new URLSearchParams(window.location.search);
  const raw = Number(params.get('days'));
  return (RANGE_OPTIONS as readonly number[]).includes(raw)
    ? (raw as RangeDays)
    : DEFAULT_RANGE;
}

function writeUrlState(codes: string[], days: RangeDays): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  if (codes.length > 0) {
    params.set('countries', codes.join(','));
  } else {
    params.delete('countries');
  }
  if (days !== DEFAULT_RANGE) {
    params.set('days', String(days));
  } else {
    params.delete('days');
  }
  const next = `${window.location.pathname}${
    params.toString() ? `?${params.toString()}` : ''
  }`;
  window.history.replaceState(null, '', next);
}

export default function AdminCoverageCompare() {
  const [selected, setSelected] = useState<string[]>(() =>
    readSelectedFromUrl(),
  );
  const [days, setDays] = useState<RangeDays>(() => readRangeFromUrl());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');

  const { data: coverageData } = useQuery<CoverageResponse>({
    queryKey: ['/api/admin/coverage/by-country'],
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const countries = coverageData?.countries ?? [];

  const csvSelected = selected.join(',');
  const trendsKey = csvSelected
    ? `/api/admin/coverage/trends?days=${days}&countryCode=${encodeURIComponent(csvSelected)}`
    : '';

  const { data: trendsData, isLoading: trendsLoading } =
    useQuery<TrendsResponse>({
      queryKey: [trendsKey],
      enabled: selected.length > 0,
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    });

  // Combine each country's trend into a single row per date so Recharts can
  // render multiple Lines off the same dataset. For each country we emit
  // two parallel value columns per metric — `<CC>_logo_cron` / `<CC>_logo_backfill`
  // (and the equivalent `_tag` pair) — so reconstructed (synthetic) days
  // are drawn dashed and real cron days drawn solid. The first cron point
  // following a run of backfill days is duplicated into the backfill series
  // so the dashed segment connects continuously to the solid one (no
  // visual gap at the handover).
  //
  // `hasBackfill` is true if any selected country has at least one
  // synthetic day in the visible window; the page uses it to show the
  // legend entry + caveat note explaining the dashed segments.
  const { merged, hasBackfill } = useMemo(() => {
    const trendsByCountry = trendsData?.trends ?? {};
    const todayUtc = new Date().toISOString().slice(0, 10);
    const liveByCountry = new Map<string, CountryCoverage>();
    for (const c of countries) liveByCountry.set(c.countryCode, c);

    const dateMap = new Map<string, Record<string, number | string | null>>();
    let anyBackfill = false;
    for (const code of selected) {
      const series = [...(trendsByCountry[code] ?? [])];
      const live = liveByCountry.get(code);
      const last = series[series.length - 1];
      if (live && (!last || last.date !== todayUtc)) {
        series.push({
          date: todayUtc,
          logoCoveragePct: live.logoCoveragePct,
          tagCoveragePct: live.tagCoveragePct,
          total: live.total,
          withLogo: live.withLogo,
          withTags: live.withTags,
          // Today's live point is straight from the by-country
          // aggregation, never a backfill — render it solid.
          source: 'cron',
        });
      }
      for (let i = 0; i < series.length; i++) {
        const point = series[i];
        const isBackfill = point.source === 'backfill';
        const prevWasBackfill =
          i > 0 && series[i - 1].source === 'backfill';
        const inBackfill = isBackfill || prevWasBackfill;
        if (isBackfill) anyBackfill = true;
        const row = dateMap.get(point.date) ?? { date: point.date };
        row[`${code}_logo_cron`] = isBackfill ? null : point.logoCoveragePct;
        row[`${code}_logo_backfill`] = inBackfill
          ? point.logoCoveragePct
          : null;
        row[`${code}_tag_cron`] = isBackfill ? null : point.tagCoveragePct;
        row[`${code}_tag_backfill`] = inBackfill
          ? point.tagCoveragePct
          : null;
        dateMap.set(point.date, row);
      }
    }
    return {
      merged: Array.from(dateMap.values()).sort((a, b) =>
        String(a.date).localeCompare(String(b.date)),
      ),
      hasBackfill: anyBackfill,
    };
  }, [trendsData, countries, selected]);

  const filteredCountries = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return countries;
    return countries.filter(
      (c) =>
        c.countryCode.toLowerCase().includes(q) ||
        c.countryName.toLowerCase().includes(q),
    );
  }, [countries, pickerSearch]);

  const updateSelected = (next: string[]) => {
    const capped = next.slice(0, MAX_SELECTED);
    setSelected(capped);
    writeUrlState(capped, days);
  };

  const updateDays = (next: RangeDays) => {
    setDays(next);
    writeUrlState(selected, next);
  };

  const toggleCountry = (code: string) => {
    if (selected.includes(code)) {
      updateSelected(selected.filter((c) => c !== code));
    } else if (selected.length < MAX_SELECTED) {
      updateSelected([...selected, code]);
    }
  };

  const clearAll = () => updateSelected([]);

  const nameFor = (code: string): string => {
    const c = countries.find((x) => x.countryCode === code);
    return c ? c.countryName : code;
  };

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
          <h1 className="text-2xl font-bold" data-testid="heading-compare">
            Compare coverage across countries
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Pick up to {MAX_SELECTED} countries to overlay their daily logo and
            tag coverage on a single chart. Use this to tell whether a sudden
            drop is happening in just one market or across several.
          </p>
        </div>
        <div
          className="flex items-center gap-1 rounded-md border bg-muted/30 p-0.5"
          role="group"
          aria-label="Date range"
          data-testid="range-selector"
        >
          {RANGE_OPTIONS.map((opt) => {
            const active = opt === days;
            return (
              <Button
                key={opt}
                size="sm"
                variant={active ? 'default' : 'ghost'}
                className="h-7 px-2 text-xs"
                onClick={() => updateDays(opt)}
                aria-pressed={active}
                data-testid={`button-range-${opt}d`}
              >
                {opt}d
              </Button>
            );
          })}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Countries</CardTitle>
          <CardDescription>
            {selected.length === 0
              ? 'Pick at least one country to start.'
              : `${selected.length} of ${MAX_SELECTED} selected.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="button-open-country-picker"
                >
                  Add country
                  <ChevronDown className="w-4 h-4 ml-1" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="p-0 w-72" align="start">
                <div className="p-2 border-b">
                  <Input
                    autoFocus
                    placeholder="Search by name or code…"
                    value={pickerSearch}
                    onChange={(e) => setPickerSearch(e.target.value)}
                    className="h-8"
                    data-testid="input-country-search"
                  />
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {filteredCountries.length === 0 ? (
                    <div className="p-4 text-xs text-muted-foreground text-center">
                      No matches.
                    </div>
                  ) : (
                    filteredCountries.map((c) => {
                      const checked = selected.includes(c.countryCode);
                      const disabled =
                        !checked && selected.length >= MAX_SELECTED;
                      return (
                        <label
                          key={c.countryCode}
                          className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-muted ${
                            disabled ? 'opacity-50 cursor-not-allowed' : ''
                          }`}
                          data-testid={`row-country-${c.countryCode}`}
                        >
                          <Checkbox
                            checked={checked}
                            disabled={disabled}
                            onCheckedChange={() => toggleCountry(c.countryCode)}
                            data-testid={`checkbox-country-${c.countryCode}`}
                          />
                          <span className="font-mono text-xs w-6 text-muted-foreground">
                            {c.countryCode}
                          </span>
                          <span className="flex-1 truncate">
                            {c.countryName}
                          </span>
                          <span className="text-[10px] text-muted-foreground tabular-nums">
                            {c.total.toLocaleString()}
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
              </PopoverContent>
            </Popover>
            {selected.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAll}
                data-testid="button-clear-selected"
              >
                Clear all
              </Button>
            )}
          </div>
          {selected.length > 0 && (
            <div className="flex flex-wrap gap-2" data-testid="list-selected">
              {selected.map((code, i) => (
                <Badge
                  key={code}
                  variant="outline"
                  className="flex items-center gap-1 pl-2 pr-1 py-1"
                  data-testid={`chip-selected-${code}`}
                >
                  <span
                    className="inline-block w-2 h-2 rounded-full"
                    style={{ backgroundColor: colorForIndex(i) }}
                  />
                  <span className="font-mono text-xs">{code}</span>
                  <span className="text-xs text-muted-foreground truncate max-w-[140px]">
                    {nameFor(code)}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleCountry(code)}
                    className="ml-1 p-0.5 rounded hover:bg-muted"
                    aria-label={`Remove ${code}`}
                    data-testid={`button-remove-${code}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Logo coverage % over time</CardTitle>
          <CardDescription>
            One line per selected country. Today's point reflects live numbers;
            prior days come from the nightly snapshot.
            {hasBackfill ? (
              <>
                {' '}
                <span data-testid="backfill-caveat-logo">
                  <span className="font-medium">Dashed segments</span> are
                  reconstructed by the historical backfill from existing
                  station data — they are best-effort, not real nightly
                  snapshots.
                </span>
              </>
            ) : null}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {selected.length === 0 ? (
            <div
              className="py-12 text-center text-sm text-muted-foreground"
              data-testid="empty-logo-chart"
            >
              Pick a country to draw the chart.
            </div>
          ) : trendsLoading ? (
            <div className="flex items-center gap-2 py-12 justify-center text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading trends…
            </div>
          ) : merged.length < 2 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Not enough snapshots yet to draw a chart for the selected
              countries.
            </div>
          ) : (
            <div
              className="w-full h-[360px]"
              data-testid="chart-compare-logo"
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={merged}
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
                  {selected.flatMap((code, i) => [
                    <Line
                      key={`${code}-logo-cron`}
                      type="monotone"
                      dataKey={`${code}_logo_cron`}
                      name={code}
                      stroke={colorForIndex(i)}
                      strokeWidth={2}
                      dot={false}
                      connectNulls={false}
                      isAnimationActive={false}
                    />,
                    <Line
                      key={`${code}-logo-backfill`}
                      type="monotone"
                      dataKey={`${code}_logo_backfill`}
                      // Hide from legend so each country appears once.
                      legendType="none"
                      name={`${code} (backfilled)`}
                      stroke={colorForIndex(i)}
                      strokeWidth={2}
                      strokeDasharray="4 3"
                      strokeOpacity={0.7}
                      dot={false}
                      connectNulls={false}
                      isAnimationActive={false}
                    />,
                  ])}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tag coverage % over time</CardTitle>
          <CardDescription>
            Same selection, comparing tag (genre) coverage instead of logos.
            {hasBackfill ? (
              <>
                {' '}
                <span data-testid="backfill-caveat-tag">
                  <span className="font-medium">Dashed segments</span> are
                  reconstructed by the historical backfill from existing
                  station data. Tag values for those days are particularly
                  approximate — the backfill uses each station's
                  <code className="mx-1 px-1 bg-muted rounded">createdAt</code>
                  date as a proxy because we don't track when a station first
                  received tags.
                </span>
              </>
            ) : null}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {selected.length === 0 ? (
            <div
              className="py-12 text-center text-sm text-muted-foreground"
              data-testid="empty-tag-chart"
            >
              Pick a country to draw the chart.
            </div>
          ) : trendsLoading ? (
            <div className="flex items-center gap-2 py-12 justify-center text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading trends…
            </div>
          ) : merged.length < 2 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Not enough snapshots yet to draw a chart for the selected
              countries.
            </div>
          ) : (
            <div
              className="w-full h-[360px]"
              data-testid="chart-compare-tag"
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={merged}
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
                  {selected.flatMap((code, i) => [
                    <Line
                      key={`${code}-tag-cron`}
                      type="monotone"
                      dataKey={`${code}_tag_cron`}
                      name={code}
                      stroke={colorForIndex(i)}
                      strokeWidth={2}
                      dot={false}
                      connectNulls={false}
                      isAnimationActive={false}
                    />,
                    <Line
                      key={`${code}-tag-backfill`}
                      type="monotone"
                      dataKey={`${code}_tag_backfill`}
                      // Hide from legend so each country appears once.
                      legendType="none"
                      name={`${code} (backfilled)`}
                      stroke={colorForIndex(i)}
                      strokeWidth={2}
                      strokeDasharray="4 3"
                      strokeOpacity={0.7}
                      dot={false}
                      connectNulls={false}
                      isAnimationActive={false}
                    />,
                  ])}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
