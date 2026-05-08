import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Trash2, Plus, Search, AlertCircle, Wrench, CheckCircle2, XCircle, Loader2, MinusCircle, RefreshCw } from "lucide-react";

interface AliasEntry {
  source: string;
  canonical: string;
}

interface OverrideEntry {
  kind: 'slug-add' | 'slug-remove' | 'alias-add' | 'alias-remove';
  slug: string;
  canonical: string | null;
  createdBy: string;
  createdAt: string;
  notes: string;
}

interface StationCountsStatus {
  lastRecomputedAt: string | null;
  lastDurationMs: number | null;
  lastUpdatedSlugs: number;
  lastTotalGenres: number;
  inFlight: boolean;
  lastTrigger: string | null;
}

type PushStepStatus = 'pending' | 'success' | 'failed' | 'skipped';

interface PushStep {
  status: PushStepStatus;
  error?: string;
  urlCount?: number;
}

interface PushStatus {
  triggeredAt: string;
  completedAt: string | null;
  triggeredBy: string | null;
  trigger: string;
  affectedSlugs: string[];
  sitemapRebuild: PushStep;
  indexnowSitemap: PushStep;
  indexnowGenreUrls: PushStep;
}

interface WhitelistResponse {
  slugs: string[];
  slugStationCounts?: Record<string, number>;
  slugsWithoutGenreRow?: string[];
  minStationsThreshold?: number;
  aliases: AliasEntry[];
  reservedSlugs?: string[];
  seed: { slugCount: number; aliasCount: number };
  overrides: OverrideEntry[];
  lastRefreshAt: string | null;
  stationCountsStatus?: StationCountsStatus;
  lastPush: PushStatus | null;
}

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.max(0, Math.round(diffMs / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

function StepBadge({ label, step }: { label: string; step: PushStep }) {
  const cls =
    step.status === 'success'
      ? 'border-green-300 text-green-700 bg-green-50'
      : step.status === 'failed'
        ? 'border-red-300 text-red-700 bg-red-50'
        : step.status === 'skipped'
          ? 'border-gray-300 text-gray-600 bg-gray-50'
          : 'border-blue-300 text-blue-700 bg-blue-50';
  const Icon =
    step.status === 'success'
      ? CheckCircle2
      : step.status === 'failed'
        ? XCircle
        : step.status === 'skipped'
          ? MinusCircle
          : Loader2;
  return (
    <Badge variant="outline" className={`text-xs ${cls}`} data-testid={`badge-push-${label}`}>
      <Icon className={`w-3 h-3 mr-1 ${step.status === 'pending' ? 'animate-spin' : ''}`} />
      {label}: {step.status}
      {step.urlCount != null && step.status !== 'pending' && step.status !== 'skipped'
        ? ` (${step.urlCount} URL${step.urlCount === 1 ? '' : 's'})`
        : ''}
    </Badge>
  );
}

// Task #184: 'missing' = no Genre row at all (likely a typo / never seeded).
// 'empty' = Genre row exists but stationCount=0 (genuinely waiting for tags).
type SlugStatus = 'live' | 'thin' | 'empty' | 'missing';
type SlugStatusFilter = 'all' | SlugStatus;

function statusFor(count: number, threshold: number, hasRow: boolean): SlugStatus {
  if (!hasRow) return 'missing';
  if (count <= 0) return 'empty';
  if (count < threshold) return 'thin';
  return 'live';
}

const SLUG_HINT = 'Lowercase letters/digits with single hyphens (e.g. "lo-fi-hip-hop").';

export default function AdminGenreWhitelist() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [newSlug, setNewSlug] = useState("");
  const [newAliasSource, setNewAliasSource] = useState("");
  const [newAliasCanonical, setNewAliasCanonical] = useState("");
  const [slugFilter, setSlugFilter] = useState("");
  const [slugStatusFilter, setSlugStatusFilter] = useState<SlugStatusFilter>("all");
  const [aliasFilter, setAliasFilter] = useState("");

  const { data, isLoading, error } = useQuery<WhitelistResponse>({
    queryKey: ['/api/admin/genre-whitelist'],
    // Task #185: while a recompute is in flight (e.g. kicked off by a bulk
    // import or country backfill in another tab), poll every few seconds so
    // the "counts updated at" badge and the per-slug numbers refresh as soon
    // as the background job finishes. Task #186: also poll while a search
    // engine push is in flight so step statuses update live.
    refetchInterval: (query) => {
      const d = query.state.data as WhitelistResponse | undefined;
      const pushInFlight = d?.lastPush && !d.lastPush.completedAt;
      if (pushInFlight) return 2000;
      if (d?.stationCountsStatus?.inFlight) return 4000;
      return false;
    },
  });

  // Real Genre tags by stationCount that aren't whitelisted/aliased yet —
  // powers the "add slug" autocomplete so admins pick existing station
  // tags instead of guessing the normalized slug form.
  const { data: suggestionsData } = useQuery<{
    suggestions: Array<{ slug: string; stationCount: number }>;
  }>({
    queryKey: ['/api/admin/genre-whitelist/suggestions'],
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/admin/genre-whitelist'] });
    queryClient.invalidateQueries({ queryKey: ['/api/admin/genre-whitelist/suggestions'] });
  };

  const addSlug = useMutation({
    mutationFn: async (slug: string) => {
      const res = await apiRequest('POST', '/api/admin/genre-whitelist/slugs', {
        body: { slug },
      });
      return res.json() as Promise<{ ok: boolean; slug: string; stationCount: number; warning?: string }>;
    },
    onSuccess: (data) => {
      setNewSlug("");
      // Task #148: surface the server's "no matching stations" warning
      // instead of silently accepting a slug that won't render anything.
      if (data?.warning) {
        toast({
          title: "Slug added (with warning)",
          description: `${data.warning} Sitemap rebuild queued — search engines will be pinged shortly.`,
        });
      } else {
        toast({
          title: "Slug added",
          description: `${data?.stationCount ?? 0} matching stations. Sitemap rebuild queued — search engines will be pinged shortly.`,
        });
      }
      invalidate();
    },
    onError: (err: Error) => {
      toast({ title: "Failed to add slug", description: err.message, variant: "destructive" });
    },
  });

  const createGenreRow = useMutation({
    mutationFn: async (slug: string) => {
      const res = await apiRequest('POST', `/api/admin/genre-whitelist/slugs/${encodeURIComponent(slug)}/genre-row`);
      return res.json() as Promise<{ ok: boolean; slug: string; name: string }>;
    },
    onSuccess: (data) => {
      toast({
        title: "Genre row created",
        description: `Created Genre row "${data?.name}" for "${data?.slug}". Station count will fill in once tags catch up.`,
      });
      invalidate();
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create Genre row", description: err.message, variant: "destructive" });
    },
  });

  const removeSlug = useMutation({
    mutationFn: async (slug: string) => {
      const res = await apiRequest('DELETE', `/api/admin/genre-whitelist/slugs/${encodeURIComponent(slug)}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Slug removed", description: "Sitemap rebuild queued — search engines will be pinged shortly." });
      invalidate();
    },
    onError: (err: Error) => {
      toast({ title: "Failed to remove slug", description: err.message, variant: "destructive" });
    },
  });

  const addAlias = useMutation({
    mutationFn: async (payload: { source: string; canonical: string }) => {
      const res = await apiRequest('POST', '/api/admin/genre-whitelist/aliases', {
        body: payload,
      });
      return res.json();
    },
    onSuccess: () => {
      setNewAliasSource("");
      setNewAliasCanonical("");
      toast({ title: "Alias added", description: "Sitemap rebuild queued — search engines will be pinged shortly." });
      invalidate();
    },
    onError: (err: Error) => {
      toast({ title: "Failed to add alias", description: err.message, variant: "destructive" });
    },
  });

  const recomputeCounts = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/admin/genre-whitelist/recompute-counts');
      return res.json() as Promise<{ ok: boolean; status: StationCountsStatus }>;
    },
    onSuccess: (resp) => {
      const updated = resp?.status?.lastUpdatedSlugs ?? 0;
      const total = resp?.status?.lastTotalGenres ?? 0;
      toast({
        title: 'Station counts refreshed',
        description: `${updated} of ${total} genre rows updated.`,
      });
      invalidate();
    },
    onError: (err: Error) => {
      toast({ title: 'Failed to refresh counts', description: err.message, variant: 'destructive' });
    },
  });

  const removeAlias = useMutation({
    mutationFn: async (source: string) => {
      const res = await apiRequest('DELETE', `/api/admin/genre-whitelist/aliases/${encodeURIComponent(source)}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Alias removed", description: "Sitemap rebuild queued — search engines will be pinged shortly." });
      invalidate();
    },
    onError: (err: Error) => {
      toast({ title: "Failed to remove alias", description: err.message, variant: "destructive" });
    },
  });

  const repush = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/admin/genre-whitelist/repush');
      return res.json() as Promise<{ ok: boolean; affectedSlugs: string[] }>;
    },
    onSuccess: (resp) => {
      toast({
        title: "Re-push queued",
        description:
          resp.affectedSlugs.length > 0
            ? `Retrying sitemap rebuild + IndexNow ping for ${resp.affectedSlugs.length} slug(s).`
            : "Retrying sitemap rebuild + IndexNow ping (sitemap-index only).",
      });
      invalidate();
    },
    onError: (err: Error) => {
      toast({ title: "Failed to queue re-push", description: err.message, variant: "destructive" });
    },
  });

  // Task #148: client-side mirror of the server's reserved set so we can
  // block obviously-bad input before a round trip.
  const reservedSet = useMemo(
    () => new Set((data?.reservedSlugs ?? []).map((s) => s.toLowerCase())),
    [data?.reservedSlugs],
  );

  const overrideBySlug = useMemo(() => {
    const map = new Map<string, OverrideEntry>();
    for (const o of data?.overrides ?? []) {
      map.set(`${o.kind}:${o.slug}`, o);
    }
    return map;
  }, [data?.overrides]);

  const stationCounts = data?.slugStationCounts ?? {};
  const threshold = data?.minStationsThreshold ?? 6;
  const slugsWithoutGenreRow = useMemo(
    () => new Set(data?.slugsWithoutGenreRow ?? []),
    [data?.slugsWithoutGenreRow],
  );

  const slugStatusCounts = useMemo(() => {
    const counts = { live: 0, thin: 0, empty: 0, missing: 0 };
    for (const s of data?.slugs ?? []) {
      counts[statusFor(stationCounts[s] ?? 0, threshold, !slugsWithoutGenreRow.has(s))]++;
    }
    return counts;
  }, [data?.slugs, stationCounts, threshold, slugsWithoutGenreRow]);

  const filteredSlugs = useMemo(() => {
    const q = slugFilter.trim().toLowerCase();
    return (data?.slugs ?? []).filter((s) => {
      if (q && !s.includes(q)) return false;
      if (slugStatusFilter === 'all') return true;
      return statusFor(stationCounts[s] ?? 0, threshold, !slugsWithoutGenreRow.has(s)) === slugStatusFilter;
    });
  }, [data?.slugs, slugFilter, slugStatusFilter, stationCounts, threshold, slugsWithoutGenreRow]);

  const filteredAliases = useMemo(() => {
    const q = aliasFilter.trim().toLowerCase();
    if (!q) return data?.aliases ?? [];
    return (data?.aliases ?? []).filter(
      (a) => a.source.includes(q) || a.canonical.includes(q),
    );
  }, [data?.aliases, aliasFilter]);

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="text-sm text-gray-500">Loading genre whitelist…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertCircle className="w-4 h-4" />
          <AlertDescription>Failed to load whitelist: {(error as Error).message}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold">Genre whitelist</h1>
        <p className="text-sm text-gray-500 mt-1">
          Controls which <code>/genres/:slug</code> URLs MegaRadio publishes to search engines.
          Slugs not on the whitelist (and without an alias) are served as <code>noindex</code> and
          dropped from sitemaps. Changes take effect immediately for SSR; each mutation also
          queues a sitemap rebuild and pings IndexNow so search engines pick it up within minutes.
        </p>
        <div className="flex gap-2 mt-3 text-xs text-gray-600 flex-wrap">
          <Badge variant="outline">Seed slugs: {data.seed.slugCount}</Badge>
          <Badge variant="outline">Seed aliases: {data.seed.aliasCount}</Badge>
          <Badge variant="outline">Merged slugs: {data.slugs.length}</Badge>
          <Badge variant="outline">Merged aliases: {data.aliases.length}</Badge>
          <Badge variant="outline">Admin overrides: {data.overrides.length}</Badge>
          {data.lastRefreshAt && (
            <Badge variant="outline">
              Refreshed: {new Date(data.lastRefreshAt).toLocaleTimeString()}
            </Badge>
          )}
          {/* Task #185: surface when Genre.stationCount was last recomputed
              so admins know whether the per-slug numbers below are fresh
              (esp. after a bulk import / country backfill / tag re-check). */}
          {data.stationCountsStatus?.lastRecomputedAt ? (
            <Badge
              variant="outline"
              data-testid="badge-counts-updated"
            >
              Counts updated:{' '}
              {new Date(data.stationCountsStatus.lastRecomputedAt).toLocaleTimeString()}
            </Badge>
          ) : (
            <Badge variant="outline" data-testid="badge-counts-updated">
              Counts: never recomputed
            </Badge>
          )}
          {data.stationCountsStatus?.inFlight && (
            <Badge variant="secondary" data-testid="badge-counts-recomputing">
              Recomputing counts…
            </Badge>
          )}
        </div>
        <div className="mt-3">
          <Button
            size="sm"
            variant="outline"
            onClick={() => recomputeCounts.mutate()}
            disabled={recomputeCounts.isPending || data.stationCountsStatus?.inFlight}
            data-testid="button-recompute-counts"
          >
            <RefreshCw
              className={`w-4 h-4 mr-1 ${
                recomputeCounts.isPending || data.stationCountsStatus?.inFlight
                  ? 'animate-spin'
                  : ''
              }`}
            />
            Refresh station counts now
          </Button>
          <p className="text-xs text-gray-500 mt-1">
            Re-aggregates <code>Genre.stationCount</code> from the live Station
            collection. Bulk imports, country backfills, and tag re-checks
            already trigger this automatically when they finish.
          </p>
        </div>
      </div>

      {/* === LAST PUSH STATUS === */}
      {(() => {
        const lp = data.lastPush;
        if (!lp) {
          return (
            <Card data-testid="card-push-status">
              <CardHeader>
                <CardTitle className="text-base">Last search-engine push</CardTitle>
                <CardDescription>
                  No push has been triggered since the server started. The sitemap will still
                  rebuild on its normal 6h cycle.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => repush.mutate()}
                  disabled={repush.isPending}
                  data-testid="button-repush"
                >
                  <RefreshCw className={`w-4 h-4 mr-1 ${repush.isPending ? 'animate-spin' : ''}`} />
                  Push now
                </Button>
              </CardContent>
            </Card>
          );
        }
        const inFlight = !lp.completedAt;
        const anyFailed =
          lp.sitemapRebuild.status === 'failed' ||
          lp.indexnowSitemap.status === 'failed' ||
          lp.indexnowGenreUrls.status === 'failed';
        const summary = inFlight
          ? 'In progress…'
          : anyFailed
            ? 'Last push had failures'
            : 'Last push succeeded';
        return (
          <Card
            className={
              anyFailed && !inFlight
                ? 'border-red-300'
                : inFlight
                  ? 'border-blue-300'
                  : 'border-green-300'
            }
            data-testid="card-push-status"
          >
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                Last search-engine push
                <Badge
                  variant="outline"
                  className={
                    anyFailed && !inFlight
                      ? 'text-xs border-red-300 text-red-700 bg-red-50'
                      : inFlight
                        ? 'text-xs border-blue-300 text-blue-700 bg-blue-50'
                        : 'text-xs border-green-300 text-green-700 bg-green-50'
                  }
                  data-testid="badge-push-summary"
                >
                  {summary}
                </Badge>
              </CardTitle>
              <CardDescription>
                Triggered <strong>{formatRelativeTime(lp.triggeredAt)}</strong>
                {lp.triggeredBy ? <> by <code>{lp.triggeredBy}</code></> : null}
                {' '}via <code>{lp.trigger}</code>
                {lp.affectedSlugs.length > 0 && (
                  <>
                    {' '}for {lp.affectedSlugs.length} slug
                    {lp.affectedSlugs.length === 1 ? '' : 's'}:{' '}
                    <code className="text-xs">{lp.affectedSlugs.join(', ')}</code>
                  </>
                )}
                {lp.completedAt && (
                  <> · Finished {formatRelativeTime(lp.completedAt)}</>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <StepBadge label="sitemap-rebuild" step={lp.sitemapRebuild} />
                <StepBadge label="indexnow-sitemap" step={lp.indexnowSitemap} />
                <StepBadge label="indexnow-genre-urls" step={lp.indexnowGenreUrls} />
              </div>
              {[lp.sitemapRebuild, lp.indexnowSitemap, lp.indexnowGenreUrls]
                .filter((s) => s.error)
                .map((s, i) => (
                  <Alert
                    key={i}
                    variant={s.status === 'failed' ? 'destructive' : 'default'}
                    data-testid={`alert-push-error-${i}`}
                  >
                    <AlertCircle className="w-4 h-4" />
                    <AlertDescription className="text-xs break-all">{s.error}</AlertDescription>
                  </Alert>
                ))}
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => repush.mutate()}
                  disabled={repush.isPending || inFlight}
                  data-testid="button-repush"
                >
                  <RefreshCw className={`w-4 h-4 mr-1 ${repush.isPending ? 'animate-spin' : ''}`} />
                  Re-push now
                </Button>
                {inFlight && (
                  <span className="ml-2 text-xs text-gray-500">
                    Wait for the current push to finish before retrying.
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* === SLUGS === */}
      <Card>
        <CardHeader>
          <CardTitle>Whitelisted slugs ({data.slugs.length})</CardTitle>
          <CardDescription>{SLUG_HINT}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const slug = newSlug.trim().toLowerCase();
              if (!slug) return;
              if (reservedSet.has(slug)) {
                toast({
                  title: "Reserved slug",
                  description: `"${slug}" is a reserved system path and can't be used as a genre slug.`,
                  variant: "destructive",
                });
                return;
              }
              addSlug.mutate(slug);
            }}
          >
            <Input
              placeholder="new-genre-slug"
              value={newSlug}
              onChange={(e) => setNewSlug(e.target.value)}
              list="new-slug-suggestions"
              data-testid="input-new-slug"
            />
            {/* Real Genre tags by stationCount, filtered server-side to
                exclude already-whitelisted/aliased/reserved slugs. */}
            <datalist id="new-slug-suggestions">
              {(suggestionsData?.suggestions ?? []).map((s) => (
                <option
                  key={s.slug}
                  value={s.slug}
                  label={`${s.stationCount} ${s.stationCount === 1 ? 'station' : 'stations'}`}
                />
              ))}
            </datalist>
            <Button type="submit" disabled={addSlug.isPending} data-testid="button-add-slug">
              <Plus className="w-4 h-4 mr-1" /> Add
            </Button>
          </form>
          {suggestionsData && suggestionsData.suggestions.length > 0 && (
            <p className="text-xs text-gray-500" data-testid="text-slug-suggestions-hint">
              Suggestions: top {suggestionsData.suggestions.length} station tags not yet on the
              whitelist (start typing to filter).
            </p>
          )}
          {newSlug.trim() && reservedSet.has(newSlug.trim().toLowerCase()) && (
            <Alert variant="destructive">
              <AlertCircle className="w-4 h-4" />
              <AlertDescription>
                "{newSlug.trim().toLowerCase()}" is a reserved system path — pick a different slug.
              </AlertDescription>
            </Alert>
          )}

          <div className="flex gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2 top-2.5 w-4 h-4 text-gray-400" />
              <Input
                className="pl-8"
                placeholder="Filter slugs…"
                value={slugFilter}
                onChange={(e) => setSlugFilter(e.target.value)}
                data-testid="input-slug-filter"
              />
            </div>
            <select
              className="border rounded px-2 text-sm bg-white"
              value={slugStatusFilter}
              onChange={(e) => setSlugStatusFilter(e.target.value as SlugStatusFilter)}
              data-testid="select-slug-status-filter"
            >
              <option value="all">All ({data.slugs.length})</option>
              <option value="live">Live ({slugStatusCounts.live})</option>
              <option value="thin">Thin — noindex ({slugStatusCounts.thin})</option>
              <option value="empty">Empty Genre row ({slugStatusCounts.empty})</option>
              <option value="missing">No Genre row ({slugStatusCounts.missing})</option>
            </select>
          </div>

          <p className="text-xs text-gray-500">
            A slug needs at least <strong>{threshold}</strong> stations to actually appear in
            sitemaps and be served as indexable. Counts come from <code>Genre.stationCount</code>.
          </p>

          <div className="border rounded max-h-96 overflow-y-auto divide-y">
            {filteredSlugs.length === 0 && (
              <div className="p-4 text-sm text-gray-500">No slugs match.</div>
            )}
            {filteredSlugs.map((slug) => {
              const adminAdded = overrideBySlug.get(`slug-add:${slug}`);
              const count = stationCounts[slug] ?? 0;
              const hasRow = !slugsWithoutGenreRow.has(slug);
              const status = statusFor(count, threshold, hasRow);
              return (
                <div
                  key={slug}
                  className="flex items-center justify-between px-3 py-2 hover:bg-gray-50"
                  data-testid={`row-slug-${slug}`}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="text-sm">{slug}</code>
                    <span
                      className="text-xs text-gray-500 tabular-nums"
                      data-testid={`text-slug-count-${slug}`}
                    >
                      {count} {count === 1 ? 'station' : 'stations'}
                    </span>
                    {status === 'live' && (
                      <Badge
                        variant="outline"
                        className="text-xs border-green-300 text-green-700 bg-green-50"
                        data-testid={`badge-slug-status-${slug}`}
                      >
                        live
                      </Badge>
                    )}
                    {status === 'thin' && (
                      <Badge
                        variant="outline"
                        className="text-xs border-amber-300 text-amber-700 bg-amber-50"
                        data-testid={`badge-slug-status-${slug}`}
                      >
                        thin — noindex
                      </Badge>
                    )}
                    {status === 'empty' && (
                      <Badge
                        variant="outline"
                        className="text-xs border-orange-300 text-orange-700 bg-orange-50"
                        data-testid={`badge-slug-status-${slug}`}
                        title="A Genre row exists for this slug but no stations match it yet."
                      >
                        empty Genre row
                      </Badge>
                    )}
                    {status === 'missing' && (
                      <Badge
                        variant="outline"
                        className="text-xs border-red-300 text-red-700 bg-red-50"
                        data-testid={`badge-slug-status-${slug}`}
                        title="No Genre document with this slug exists in the database — usually a typo or a slug that was never seeded."
                      >
                        no Genre row
                      </Badge>
                    )}
                    {adminAdded && (
                      <Badge variant="secondary" className="text-xs">
                        added by {adminAdded.createdBy}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {status === 'missing' && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={createGenreRow.isPending}
                        onClick={() => {
                          if (
                            confirm(
                              `Create a Genre row for "${slug}"?\n\nA new Genre document will be inserted with stationCount=0 and isDiscoverable=false. Use this only if "${slug}" is a real genre and not just a typo — otherwise remove the slug instead.`,
                            )
                          ) {
                            createGenreRow.mutate(slug);
                          }
                        }}
                        data-testid={`button-create-genre-row-${slug}`}
                        title="Create a Genre document for this whitelisted slug"
                      >
                        <Wrench className="w-4 h-4 mr-1" /> Create row
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        const extra = status === 'missing'
                          ? '\n\nThis slug has no Genre row, so removing it is usually the right call if it was a typo.'
                          : '';
                        if (confirm(`Remove "${slug}" from the whitelist?\n\nIt will be served as noindex and dropped from sitemaps on the next rebuild.${extra}`)) {
                          removeSlug.mutate(slug);
                        }
                      }}
                      data-testid={`button-remove-slug-${slug}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* === ALIASES === */}
      <Card>
        <CardHeader>
          <CardTitle>Aliases ({data.aliases.length})</CardTitle>
          <CardDescription>
            Source slugs that 301-redirect to a canonical whitelisted slug. The canonical must be
            on the whitelist above.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="flex gap-2 flex-wrap"
            onSubmit={(e) => {
              e.preventDefault();
              const source = newAliasSource.trim().toLowerCase();
              const canonical = newAliasCanonical.trim().toLowerCase();
              if (!source || !canonical) return;
              // Task #148: mirror server-side reserved + canonical-must-
              // exist checks client-side so admins get instant feedback.
              if (reservedSet.has(source) || reservedSet.has(canonical)) {
                toast({
                  title: "Reserved slug",
                  description: `Reserved system path can't be used in an alias.`,
                  variant: "destructive",
                });
                return;
              }
              if (!data.slugs.includes(canonical)) {
                toast({
                  title: "Unknown canonical",
                  description: `"${canonical}" isn't on the whitelist — add it first.`,
                  variant: "destructive",
                });
                return;
              }
              addAlias.mutate({ source, canonical });
            }}
          >
            <Input
              className="flex-1 min-w-[180px]"
              placeholder="alias-source-slug"
              value={newAliasSource}
              onChange={(e) => setNewAliasSource(e.target.value)}
              data-testid="input-alias-source"
            />
            <span className="self-center text-gray-400">→</span>
            {/* Task #148: autocomplete the canonical input from the merged
                whitelist so admins don't have to remember exact spelling. */}
            <Input
              className="flex-1 min-w-[180px]"
              placeholder="canonical-slug"
              value={newAliasCanonical}
              onChange={(e) => setNewAliasCanonical(e.target.value)}
              list="canonical-slug-options"
              data-testid="input-alias-canonical"
            />
            <datalist id="canonical-slug-options">
              {data.slugs.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <Button type="submit" disabled={addAlias.isPending} data-testid="button-add-alias">
              <Plus className="w-4 h-4 mr-1" /> Add
            </Button>
          </form>

          <div className="relative">
            <Search className="absolute left-2 top-2.5 w-4 h-4 text-gray-400" />
            <Input
              className="pl-8"
              placeholder="Filter aliases…"
              value={aliasFilter}
              onChange={(e) => setAliasFilter(e.target.value)}
              data-testid="input-alias-filter"
            />
          </div>

          <div className="border rounded max-h-96 overflow-y-auto divide-y">
            {filteredAliases.length === 0 && (
              <div className="p-4 text-sm text-gray-500">No aliases match.</div>
            )}
            {filteredAliases.map((a) => {
              const adminAdded = overrideBySlug.get(`alias-add:${a.source}`);
              return (
                <div
                  key={a.source}
                  className="flex items-center justify-between px-3 py-2 hover:bg-gray-50"
                >
                  <div className="flex items-center gap-2 text-sm">
                    <code>{a.source}</code>
                    <span className="text-gray-400">→</span>
                    <code className="text-blue-700">{a.canonical}</code>
                    {adminAdded && (
                      <Badge variant="secondary" className="text-xs">
                        added by {adminAdded.createdBy}
                      </Badge>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (confirm(`Remove alias "${a.source}" → "${a.canonical}"?`)) {
                        removeAlias.mutate(a.source);
                      }
                    }}
                    data-testid={`button-remove-alias-${a.source}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* === OVERRIDES AUDIT === */}
      {data.overrides.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Admin overrides ({data.overrides.length})</CardTitle>
            <CardDescription>
              Raw override rows applied on top of the static seed. Use this to audit who changed
              what.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="border rounded max-h-72 overflow-y-auto divide-y text-sm">
              {data.overrides.map((o) => (
                <div
                  key={`${o.kind}:${o.slug}`}
                  className="flex items-center justify-between px-3 py-2"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge
                      variant={o.kind.endsWith('remove') ? 'destructive' : 'default'}
                      className="text-xs"
                    >
                      {o.kind}
                    </Badge>
                    <code>{o.slug}</code>
                    {o.canonical && (
                      <>
                        <span className="text-gray-400">→</span>
                        <code className="text-blue-700">{o.canonical}</code>
                      </>
                    )}
                  </div>
                  <div className="text-xs text-gray-500">
                    {o.createdBy} · {new Date(o.createdAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
