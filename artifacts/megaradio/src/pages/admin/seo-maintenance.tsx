import { Fragment, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { RetryTrendSparkline } from "@/components/admin/RetryTrendSparkline";
import { RetryCauseBreakdown } from "@/components/admin/RetryCauseBreakdown";

interface HealthStats {
  country: string | null;
  total: number;
  noIndex: number;
  missing: {
    tags: number;
    languageCodes: number;
    logoAssets: number;
    descriptionTr: number;
    descriptionEn: number;
  };
  brokenStream: {
    indexableTotal: number;
    deadOver30Days: number;
  };
}

interface BackfillJob {
  jobId: string;
  startedAt: string;
  finishedAt: string | null;
  countryCode: string | null;
  scanned: number;
  updated: number;
  failed: number;
  skipped: number;
  isRunning: boolean;
  lastError: string | null;
}

interface ScheduledBackfillRunCountryLogos {
  countryCode: string;
  candidates: number;
  enqueued: number;
}
interface ScheduledBackfillRunCountryTags {
  countryCode: string;
  processed: number;
  hydrated: number;
  emptyUpstream: number;
  failed: number;
}
interface ScheduledBackfillRun {
  _id: string;
  trigger: string;
  status: "running" | "completed" | "failed";
  topN: number;
  overrideCountry?: string | null;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  logos: ScheduledBackfillRunCountryLogos[];
  tags: ScheduledBackfillRunCountryTags[];
  errorMessage?: string;
  attempts?: Array<{ attempt: number; error: string; failedAt: string }>;
}
interface ScheduledBackfillStatusResponse {
  status: {
    isRunning: boolean;
    lastRunAt: string | null;
    lastRunId: string | null;
  };
  lastRun: ScheduledBackfillRun | null;
}
interface ScheduledBackfillRunsResponse {
  runs: ScheduledBackfillRun[];
  // Collection-wide totals so admins can see how far back the retained
  // history actually goes (Task #180 — retention is enforced by
  // `pruneOldBackfillRuns` in the API after every sweep).
  total?: number;
  oldestStartedAt?: string | null;
  retention?: {
    days: number;
    maxRows: number;
  };
}

// Task #233: admin-tunable retention thresholds. Resolution order is
// DB override → env var → built-in default; the API echoes all three
// so the form can show what's currently effective and where it came
// from.
interface BackfillRetentionResponse {
  stored: { days: number | null; maxRows: number | null };
  env: { days: number | null; maxRows: number | null };
  defaults: { days: number; maxRows: number };
  effective: {
    days: number;
    maxRows: number;
    source: {
      days: "db" | "env" | "default";
      maxRows: "db" | "env" | "default";
    };
  };
  bounds: {
    daysMin: number;
    daysMax: number;
    maxRowsMin: number;
    maxRowsMax: number;
  };
  updatedAt: string | null;
  updatedBy: string | null;
}

// Task #320: append-only audit log of who changed the retention
// thresholds and when. The same `AdminSettingHistory` collection
// powers the coverage-drop alert audit trail.
interface BackfillRetentionHistoryEntry {
  id: string;
  action: "update" | "clear";
  previousValue: { days: number | null; maxRows: number | null } | null;
  newValue: { days: number | null; maxRows: number | null } | null;
  changedBy: string | null;
  changedAt: string;
}
interface BackfillRetentionHistoryResponse {
  entries: BackfillRetentionHistoryEntry[];
}

function describeRetentionValue(
  value: { days: number | null; maxRows: number | null } | null,
): string {
  if (!value) return "varsayılan";
  const parts: string[] = [];
  parts.push(value.days != null ? `${value.days}g` : "—g");
  parts.push(value.maxRows != null ? `${value.maxRows} satır` : "— satır");
  return parts.join(" · ");
}

type RunsTriggerFilter =
  | ""
  | "cron:weekly"
  | "admin:manual"
  | "admin:manual:tags";

function formatDuration(ms?: number) {
  if (typeof ms !== "number" || !isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}m ${rs}s`;
}

function summarizeRunTotals(run: ScheduledBackfillRun) {
  const logosEnqueued = run.logos.reduce((a, c) => a + (c.enqueued || 0), 0);
  const logosCandidates = run.logos.reduce((a, c) => a + (c.candidates || 0), 0);
  const tagsHydrated = run.tags.reduce((a, c) => a + (c.hydrated || 0), 0);
  const tagsProcessed = run.tags.reduce((a, c) => a + (c.processed || 0), 0);
  const tagsFailed = run.tags.reduce((a, c) => a + (c.failed || 0), 0);
  return { logosEnqueued, logosCandidates, tagsHydrated, tagsProcessed, tagsFailed };
}

function pct(n: number, total: number) {
  if (!total) return "0%";
  return `${((n / total) * 100).toFixed(1)}%`;
}

function StatRow({ label, value, total, danger }: { label: string; value: number; total: number; danger?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
      <span className="text-sm text-slate-700">{label}</span>
      <span className={`text-sm font-semibold ${danger && value > 0 ? "text-rose-600" : "text-slate-900"}`}>
        {value.toLocaleString()} <span className="text-xs text-slate-500 font-normal">({pct(value, total)})</span>
      </span>
    </div>
  );
}

export default function SeoMaintenancePage() {
  const { toast } = useToast();
  const [country, setCountry] = useState("TR");
  const [tagsLimit, setTagsLimit] = useState(500);
  const [tagsCountry, setTagsCountry] = useState("TR");
  const [scheduledCountry, setScheduledCountry] = useState("");

  const statsQuery = useQuery<HealthStats>({
    queryKey: ["/api/admin/seo-health-stats", country],
    queryFn: async () => {
      const res = await fetch(`/api/admin/seo-health-stats?country=${encodeURIComponent(country)}`, { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });

  const tagsJobQuery = useQuery<{ job: BackfillJob | null }>({
    queryKey: ["/api/admin/maintenance/tags-backfill/status"],
    refetchInterval: (q) => (q.state.data?.job?.isRunning ? 2000 : false),
  });

  const startTags = useMutation({
    mutationFn: async () => {
      const trimmed = tagsCountry.trim();
      return apiRequest("POST", "/api/admin/maintenance/tags-backfill", {
        body: {
          country: trimmed || undefined,
          limit: tagsLimit,
        },
      });
    },
    onSuccess: () => {
      const trimmed = tagsCountry.trim();
      toast({
        title: trimmed
          ? `Tags backfill başlatıldı (${trimmed})`
          : "Tags backfill başlatıldı",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/maintenance/tags-backfill/status"] });
      // Refresh history table so the new BackfillRun audit row shows up.
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/maintenance/scheduled-backfill/runs"],
      });
    },
    onError: (e: any) => {
      const msg = e?.message || "";
      if (msg.includes("invalid_country_code") || msg.includes("400")) {
        toast({
          title: "Geçersiz ülke kodu",
          description: "İki harfli ISO kodu girin (örn. TR) veya boş bırakın.",
          variant: "destructive",
        });
      } else if (msg.includes("already_running") || msg.includes("409")) {
        toast({ title: "Zaten çalışıyor", description: "Bir tags backfill hâlihazırda devam ediyor." });
      } else {
        toast({ title: "Başlatılamadı", description: msg, variant: "destructive" });
      }
    },
  });

  const startLogos = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/admin/logos/process-all", {}),
    onSuccess: () => toast({ title: "Logo backfill başlatıldı" }),
    onError: (e: any) => toast({ title: "Başlatılamadı", description: e?.message || "", variant: "destructive" }),
  });

  const scheduledStatusQuery = useQuery<ScheduledBackfillStatusResponse>({
    queryKey: ["/api/admin/maintenance/scheduled-backfill/status"],
    refetchInterval: (q) => (q.state.data?.status?.isRunning ? 3000 : false),
  });

  const initialDeepLinkRunId =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("runId")
      : null;
  const [runsTrigger, setRunsTrigger] = useState<RunsTriggerFilter>("");
  // Task #312: per-country quick filter for the runs table. Stored as a
  // 2-char upper-case ISO code; empty string means "all countries". Sent
  // to the runs endpoint as `?country=` and combines with the trigger
  // filter so e.g. admin:manual:tags + TR shows only the TR tags sweeps.
  const [runsCountry, setRunsCountry] = useState<string>("");
  const [expandedRunId, setExpandedRunId] = useState<string | null>(
    initialDeepLinkRunId,
  );
  const runRowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  const deepLinkScrolledRef = useRef(false);
  const runsQuery = useQuery<ScheduledBackfillRunsResponse>({
    queryKey: [
      "/api/admin/maintenance/scheduled-backfill/runs",
      runsTrigger,
      runsCountry.length === 2 ? runsCountry : "",
    ],
    queryFn: async () => {
      const qs = new URLSearchParams({ limit: "10" });
      if (runsTrigger) qs.set("trigger", runsTrigger);
      // Only send `country` once the admin has typed both letters —
      // the API requires exactly 2 chars, so sending a single letter
      // would produce transient 400s + "history fetch failed" noise.
      if (runsCountry.length === 2) qs.set("country", runsCountry);
      const res = await fetch(
        `/api/admin/maintenance/scheduled-backfill/runs?${qs.toString()}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    // Auto-refresh while a sweep is in flight so a freshly-finished run
    // appears in the table without a manual reload.
    refetchInterval: () =>
      scheduledStatusQuery.data?.status?.isRunning ? 5000 : false,
  });

  // Task #222: a deep link like ?runId=<id> can point to a run older
  // than the first page of `runsQuery` (which only fetches the latest
  // 10). When that happens, fall back to the single-run endpoint so the
  // page can either render the missing row inline or show a clear
  // "not found" notice instead of staying silent.
  const runsList = runsQuery.data?.runs;
  const deepLinkInFirstPage = initialDeepLinkRunId
    ? !!runsList?.some((r) => r._id === initialDeepLinkRunId)
    : false;
  const deepLinkLookupEnabled =
    !!initialDeepLinkRunId && !!runsList && !deepLinkInFirstPage;
  const deepLinkRunQuery = useQuery<
    { run: ScheduledBackfillRun },
    Error
  >({
    queryKey: [
      "/api/admin/maintenance/scheduled-backfill/runs",
      "deep-link",
      initialDeepLinkRunId,
    ],
    enabled: deepLinkLookupEnabled,
    retry: false,
    queryFn: async () => {
      const res = await fetch(
        `/api/admin/maintenance/scheduled-backfill/runs/${encodeURIComponent(
          initialDeepLinkRunId!,
        )}`,
        { credentials: "include" },
      );
      if (res.status === 404) throw new Error("not_found");
      if (res.status === 400) throw new Error("invalid_id");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });
  const deepLinkExtraRun =
    deepLinkLookupEnabled && deepLinkRunQuery.data?.run
      ? deepLinkRunQuery.data.run
      : null;

  // Task #233: retention thresholds form state. Inputs stay as strings so
  // an empty box clears the override (falls back to env/default). The
  // query result is the source of truth — `useEffect` below seeds the
  // inputs from `stored` whenever the response changes.
  const [retentionDays, setRetentionDays] = useState<string>("");
  const [retentionMaxRows, setRetentionMaxRows] = useState<string>("");
  const retentionQuery = useQuery<BackfillRetentionResponse>({
    queryKey: ["/api/admin/settings/backfill-retention"],
    queryFn: async () => {
      const res = await fetch("/api/admin/settings/backfill-retention", {
        credentials: "include",
      });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });
  // Task #320: pull the last N rows from the AdminSettingHistory audit
  // log so the form can render "who changed what, when" inline. Capped
  // server-side at 100; we ask for 10 by default which matches the
  // dense rendering below.
  const retentionHistoryQuery = useQuery<BackfillRetentionHistoryResponse>({
    queryKey: ["/api/admin/settings/backfill-retention/history"],
    queryFn: async () => {
      const res = await fetch(
        "/api/admin/settings/backfill-retention/history?limit=10",
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });
  useEffect(() => {
    const data = retentionQuery.data;
    if (!data) return;
    setRetentionDays(
      data.stored.days != null ? String(data.stored.days) : "",
    );
    setRetentionMaxRows(
      data.stored.maxRows != null ? String(data.stored.maxRows) : "",
    );
  }, [retentionQuery.data]);
  const saveRetention = useMutation({
    mutationFn: async () => {
      const body: { days?: number | null; maxRows?: number | null } = {
        days: retentionDays.trim() === "" ? null : Number(retentionDays),
        maxRows:
          retentionMaxRows.trim() === "" ? null : Number(retentionMaxRows),
      };
      return apiRequest(
        "PUT",
        "/api/admin/settings/backfill-retention",
        { body },
      );
    },
    onSuccess: () => {
      toast({ title: "Saklama ayarları güncellendi" });
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/settings/backfill-retention"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/settings/backfill-retention/history"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/maintenance/scheduled-backfill/runs"],
      });
    },
    onError: (e: any) => {
      toast({
        title: "Kaydedilemedi",
        description: e?.message || "",
        variant: "destructive",
      });
    },
  });
  const resetRetention = useMutation({
    mutationFn: async () =>
      apiRequest("DELETE", "/api/admin/settings/backfill-retention"),
    onSuccess: () => {
      toast({ title: "Saklama ayarları sıfırlandı" });
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/settings/backfill-retention"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/settings/backfill-retention/history"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/maintenance/scheduled-backfill/runs"],
      });
    },
    onError: (e: any) => {
      toast({
        title: "Sıfırlanamadı",
        description: e?.message || "",
        variant: "destructive",
      });
    },
  });

  const startScheduled = useMutation({
    mutationFn: async (countryCode: string) =>
      apiRequest("POST", "/api/admin/maintenance/scheduled-backfill/run", {
        body: { countryCode: countryCode || undefined },
      }),
    onSuccess: (_data, countryCode) => {
      toast({
        title: countryCode
          ? `Backfill başlatıldı (${countryCode})`
          : "Haftalık backfill başlatıldı",
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/maintenance/scheduled-backfill/status"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/maintenance/scheduled-backfill/runs"],
      });
    },
    onError: (e: any) => {
      const msg = e?.message || "";
      if (msg.includes("already_running") || msg.includes("409")) {
        toast({ title: "Zaten çalışıyor", description: "Bir backfill hâlihazırda devam ediyor." });
      } else if (msg.includes("invalid_country_code") || msg.includes("400")) {
        toast({
          title: "Geçersiz ülke kodu",
          description: "İki harfli ISO kodu girin (örn. TR) veya boş bırakın.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Başlatılamadı", description: msg, variant: "destructive" });
      }
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/maintenance/scheduled-backfill/status"],
      });
    },
  });

  const stats = statsQuery.data;
  const job = tagsJobQuery.data?.job;
  const scheduled = scheduledStatusQuery.data;
  const scheduledRunning = scheduled?.status?.isRunning ?? false;
  const lastRun = scheduled?.lastRun ?? null;

  useEffect(() => {
    if (!initialDeepLinkRunId || deepLinkScrolledRef.current) return;
    const runs = runsQuery.data?.runs;
    if (!runs) return;
    const inFirstPage = runs.some((r) => r._id === initialDeepLinkRunId);
    // Wait until either the row is on the first page, or the fallback
    // single-run lookup has resolved (success or 404). Otherwise we'd
    // try to scroll before the row exists in the DOM.
    if (!inFirstPage && !deepLinkExtraRun) return;
    setExpandedRunId(initialDeepLinkRunId);
    const row = runRowRefs.current[initialDeepLinkRunId];
    if (row) {
      row.scrollIntoView({ behavior: "smooth", block: "center" });
      deepLinkScrolledRef.current = true;
    }
  }, [initialDeepLinkRunId, runsQuery.data, deepLinkExtraRun]);

  return (
    <div className="p-6 space-y-6 bg-slate-50 min-h-screen">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">SEO Maintenance</h1>
        <p className="text-sm text-slate-600 mt-1">İçerik eksiklikleri, bozuk stream'ler ve indexability kuralları için kontrol paneli.</p>
      </div>

      {/* Country filter */}
      <Card className="bg-white">
        <CardContent className="pt-4 flex items-end gap-3">
          <div>
            <label className="text-xs text-slate-600 mb-1 block">Ülke kodu (boş = global)</label>
            <Input value={country} onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))} className="w-24" />
          </div>
          <Button variant="outline" onClick={() => statsQuery.refetch()} disabled={statsQuery.isFetching}>
            {statsQuery.isFetching ? "Yükleniyor..." : "Yenile"}
          </Button>
        </CardContent>
      </Card>

      {/* Health stats */}
      <Card className="bg-white">
        <CardHeader>
          <CardTitle className="text-base">
            SEO sağlık özeti{stats?.country ? ` — ${stats.country}` : " (global)"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {statsQuery.isLoading && <div className="text-sm text-slate-500">Yükleniyor...</div>}
          {statsQuery.error && <div className="text-sm text-rose-600">İstatistikler alınamadı.</div>}
          {stats && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Genel</div>
                <StatRow label="Toplam radyo" value={stats.total} total={stats.total} />
                <StatRow label="noIndex=true (junk)" value={stats.noIndex} total={stats.total} />
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">İçerik eksikliği</div>
                <StatRow label="TR description (full) eksik" value={stats.missing.descriptionTr} total={stats.total} danger />
                <StatRow label="EN description (full) eksik" value={stats.missing.descriptionEn} total={stats.total} danger />
                <StatRow label="tags eksik" value={stats.missing.tags} total={stats.total} danger />
                <StatRow label="languageCodes eksik" value={stats.missing.languageCodes} total={stats.total} />
                <StatRow label="logoAssets eksik" value={stats.missing.logoAssets} total={stats.total} danger />
              </div>
              <div className="md:col-span-2 mt-4 pt-4 border-t border-slate-200">
                <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Bozuk stream durumu</div>
                <StatRow label="lastCheckOk=false ama indexable" value={stats.brokenStream.indexableTotal} total={stats.total} danger />
                <StatRow label="↳ Son 30 gün içinde recover etmemiş (junk gate yakalar)" value={stats.brokenStream.deadOver30Days} total={stats.total} danger />
                {stats.brokenStream.deadOver30Days > 0 && (
                  <div className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                    Junk-station-rules güncellemesi yayına alındıktan sonra bu {stats.brokenStream.deadOver30Days} kayıt
                    SSR'da otomatik 410 Gone dönecek.
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Scheduled (weekly) backfill — manual trigger */}
      <Card className="bg-white">
        <CardHeader>
          <CardTitle className="text-base">
            Haftalık otomatik backfill (logo + tags, top-5 ülke)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-slate-600">
            Pazar 04:00 (Europe/Berlin) tarifesinde otomatik çalışan haftalık
            cross-country sweep'i manuel olarak tetikler. En kötü 5 ülke için
            logo kuyruğunu doldurur ve eksik tag'leri Radio-Browser'dan
            yeniden çeker. Single-instance kilidi sayesinde çift tıklama
            yeni bir sweep başlatmaz.
          </p>
          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <label className="text-xs text-slate-600 mb-1 block">
                Ülke kodu (boş = top-5)
              </label>
              <Input
                value={scheduledCountry}
                onChange={(e) =>
                  setScheduledCountry(e.target.value.toUpperCase().slice(0, 2))
                }
                placeholder="örn. TR"
                className="w-24"
                data-testid="input-scheduled-backfill-country"
              />
            </div>
            <Button
              onClick={() => startScheduled.mutate(scheduledCountry.trim())}
              disabled={startScheduled.isPending || scheduledRunning}
              data-testid="button-run-scheduled-backfill"
            >
              {scheduledRunning
                ? "Çalışıyor..."
                : startScheduled.isPending
                ? "Başlatılıyor..."
                : "Şimdi çalıştır"}
            </Button>
            {scheduled?.status?.lastRunAt && (
              <span className="text-xs text-slate-500">
                Son çalışma: {new Date(scheduled.status.lastRunAt).toLocaleString()}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500">
            Ülke kodu girilirse top-N taraması atlanır ve sadece o pazar için
            logo + tag backfill çalıştırılır (Search Console'da uyarı gelen
            uzun-kuyruk ülkeler için).
          </p>
          {lastRun && (
            <div className="border border-slate-200 rounded p-3 bg-slate-50 text-sm space-y-2 mt-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge
                  variant={
                    lastRun.status === "running"
                      ? "default"
                      : lastRun.status === "failed"
                      ? "destructive"
                      : "secondary"
                  }
                >
                  {lastRun.status.toUpperCase()}
                </Badge>
                <span className="text-xs text-slate-500">
                  Trigger: <code>{lastRun.trigger}</code> ·{" "}
                  {lastRun.overrideCountry
                    ? `ülke=${lastRun.overrideCountry}`
                    : `top-${lastRun.topN}`}{" "}
                  · başlangıç {new Date(lastRun.startedAt).toLocaleString()}
                  {typeof lastRun.durationMs === "number" &&
                    ` · ${Math.round(lastRun.durationMs / 1000)}s`}
                </span>
              </div>
              {lastRun.errorMessage && (
                <div className="text-xs text-rose-600">
                  Hata: {lastRun.errorMessage}
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">
                    Logos
                  </div>
                  {lastRun.logos.length === 0 ? (
                    <div className="text-xs text-slate-500">Yok</div>
                  ) : (
                    lastRun.logos.map((c) => (
                      <div key={`logos-${c.countryCode}`} className="text-xs flex justify-between">
                        <span className="font-mono">{c.countryCode}</span>
                        <span>
                          enqueued{" "}
                          <strong className="text-emerald-600">{c.enqueued}</strong>
                          {" / "}
                          {c.candidates}
                        </span>
                      </div>
                    ))
                  )}
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">
                    Tags
                  </div>
                  {lastRun.tags.length === 0 ? (
                    <div className="text-xs text-slate-500">Yok</div>
                  ) : (
                    lastRun.tags.map((c) => (
                      <div key={`tags-${c.countryCode}`} className="text-xs flex justify-between">
                        <span className="font-mono">{c.countryCode}</span>
                        <span>
                          hydrated{" "}
                          <strong className="text-emerald-600">{c.hydrated}</strong>
                          {" / "}
                          {c.processed}
                          {c.failed > 0 && (
                            <span className="text-rose-600"> · {c.failed} fail</span>
                          )}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Scheduled backfill — history of past runs */}
      <Card className="bg-white">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <CardTitle className="text-base">
            Geçmiş haftalık backfill çalışmaları
          </CardTitle>
          {runsQuery.data && runsQuery.data.runs.length > 0 && (
            <div className="text-right">
              <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
                Retry trend (son {Math.min(10, runsQuery.data.runs.length)} çalışma)
              </div>
              <RetryTrendSparkline
                runs={runsQuery.data.runs}
                width={220}
                height={48}
                testId="seo-maintenance-retry-trend"
              />
              <div className="mt-2">
                <RetryCauseBreakdown
                  runs={runsQuery.data.runs}
                  testId="seo-maintenance-retry-causes"
                />
              </div>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Task #233: admin-tunable retention thresholds. Empty input
              clears the DB override and falls back to the env/default
              shown next to the field. */}
          {retentionQuery.data && (
            <div
              className="border border-slate-200 rounded p-3 bg-slate-50 space-y-2"
              data-testid="card-backfill-retention-settings"
            >
              <div className="text-xs uppercase tracking-wide text-slate-500">
                Saklama eşikleri
              </div>
              <p className="text-xs text-slate-600">
                Backfill geçmişi her sweep'in sonunda buradaki eşiklere göre
                temizlenir. Boş bırakırsanız ortam değişkeni veya yerleşik
                varsayılan ({retentionQuery.data.defaults.days}g /{" "}
                {retentionQuery.data.defaults.maxRows} satır) geçerli olur.
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="text-xs text-slate-600 mb-1 block">
                    Gün ({retentionQuery.data.bounds.daysMin}–
                    {retentionQuery.data.bounds.daysMax})
                  </label>
                  <Input
                    type="number"
                    min={retentionQuery.data.bounds.daysMin}
                    max={retentionQuery.data.bounds.daysMax}
                    value={retentionDays}
                    onChange={(e) => setRetentionDays(e.target.value)}
                    placeholder={String(retentionQuery.data.effective.days)}
                    className="w-28"
                    data-testid="input-backfill-retention-days"
                  />
                  <div className="text-[11px] text-slate-500 mt-1">
                    Etkin: {retentionQuery.data.effective.days}g (
                    {retentionQuery.data.effective.source.days})
                  </div>
                </div>
                <div>
                  <label className="text-xs text-slate-600 mb-1 block">
                    Maks. satır ({retentionQuery.data.bounds.maxRowsMin}–
                    {retentionQuery.data.bounds.maxRowsMax})
                  </label>
                  <Input
                    type="number"
                    min={retentionQuery.data.bounds.maxRowsMin}
                    max={retentionQuery.data.bounds.maxRowsMax}
                    value={retentionMaxRows}
                    onChange={(e) => setRetentionMaxRows(e.target.value)}
                    placeholder={String(retentionQuery.data.effective.maxRows)}
                    className="w-32"
                    data-testid="input-backfill-retention-max-rows"
                  />
                  <div className="text-[11px] text-slate-500 mt-1">
                    Etkin: {retentionQuery.data.effective.maxRows} satır (
                    {retentionQuery.data.effective.source.maxRows})
                  </div>
                </div>
                <Button
                  onClick={() => saveRetention.mutate()}
                  disabled={saveRetention.isPending}
                  data-testid="button-save-backfill-retention"
                >
                  {saveRetention.isPending ? "Kaydediliyor..." : "Kaydet"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => resetRetention.mutate()}
                  disabled={
                    resetRetention.isPending ||
                    (retentionQuery.data.stored.days == null &&
                      retentionQuery.data.stored.maxRows == null)
                  }
                  data-testid="button-reset-backfill-retention"
                >
                  {resetRetention.isPending ? "Sıfırlanıyor..." : "Sıfırla"}
                </Button>
              </div>
              {retentionQuery.data.updatedAt && (
                <div
                  className="text-[11px] text-slate-500"
                  data-testid="text-backfill-retention-meta"
                >
                  Son güncelleme:{" "}
                  {new Date(retentionQuery.data.updatedAt).toLocaleString()}
                  {retentionQuery.data.updatedBy
                    ? ` · ${retentionQuery.data.updatedBy}`
                    : ""}
                </div>
              )}
              {(retentionQuery.data.env.days != null ||
                retentionQuery.data.env.maxRows != null) && (
                <div className="text-[11px] text-slate-500">
                  Ortam değişkeni:{" "}
                  {retentionQuery.data.env.days != null
                    ? `${retentionQuery.data.env.days}g`
                    : "—"}{" "}
                  /{" "}
                  {retentionQuery.data.env.maxRows != null
                    ? `${retentionQuery.data.env.maxRows} satır`
                    : "—"}
                </div>
              )}
              {/* Task #320: inline audit log of recent changes to the
                  retention thresholds so admins can see who tightened or
                  loosened pruning behavior without going to the DB. */}
              <div
                className="border-t border-slate-200 pt-2 mt-2"
                data-testid="panel-backfill-retention-history"
              >
                <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
                  Son değişiklikler
                </div>
                {retentionHistoryQuery.isLoading ? (
                  <div className="text-[11px] text-slate-500">
                    Yükleniyor…
                  </div>
                ) : retentionHistoryQuery.isError ? (
                  <div className="text-[11px] text-red-600">
                    Geçmiş okunamadı.
                  </div>
                ) : !retentionHistoryQuery.data ||
                  retentionHistoryQuery.data.entries.length === 0 ? (
                  <div className="text-[11px] text-slate-500">
                    Henüz değişiklik kaydı yok. Kaydet veya Sıfırla
                    yaptığınızda denetim günlüğü başlar.
                  </div>
                ) : (
                  <ul className="space-y-1">
                    {retentionHistoryQuery.data.entries.map((entry) => {
                      const when = new Date(entry.changedAt);
                      const who = entry.changedBy ?? "bilinmeyen yönetici";
                      const actionLabel =
                        entry.action === "clear" ? "Sıfırlandı" : "Güncellendi";
                      return (
                        <li
                          key={entry.id}
                          className="text-[11px] text-slate-600 leading-snug"
                          data-testid={`row-backfill-retention-history-${entry.id}`}
                        >
                          <div>
                            <strong>{actionLabel}</strong> · {who} ·{" "}
                            <span title={when.toISOString()}>
                              {when.toLocaleString()}
                            </span>
                          </div>
                          <div className="text-slate-500">
                            {describeRetentionValue(entry.previousValue)} →{" "}
                            {describeRetentionValue(entry.newValue)}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 flex-wrap">
            <div>
              <label className="text-xs text-slate-600 mb-1 block">
                Tetikleyici
              </label>
              <select
                value={runsTrigger}
                onChange={(e) =>
                  setRunsTrigger(e.target.value as RunsTriggerFilter)
                }
                className="border border-slate-300 rounded px-2 py-1 text-sm bg-white"
                data-testid="select-runs-trigger"
              >
                <option value="">Tümü</option>
                <option value="cron:weekly">cron:weekly</option>
                <option value="admin:manual">admin:manual</option>
                <option value="admin:manual:tags">admin:manual:tags</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-600 mb-1 block">
                Ülke (ISO)
              </label>
              <Input
                value={runsCountry}
                onChange={(e) =>
                  setRunsCountry(
                    e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2),
                  )
                }
                placeholder="TR"
                className="w-24"
                data-testid="input-runs-country"
              />
            </div>
            {runsCountry && (
              <Button
                variant="ghost"
                onClick={() => setRunsCountry("")}
                data-testid="button-clear-runs-country"
              >
                Ülkeyi temizle
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => runsQuery.refetch()}
              disabled={runsQuery.isFetching}
            >
              {runsQuery.isFetching ? "Yükleniyor..." : "Yenile"}
            </Button>
          </div>

          {runsQuery.isLoading && (
            <div className="text-sm text-slate-500">Yükleniyor...</div>
          )}
          {runsQuery.error && (
            <div className="text-sm text-rose-600">
              Geçmiş alınamadı.
            </div>
          )}
          {runsQuery.data && runsQuery.data.runs.length === 0 && !deepLinkExtraRun && !deepLinkLookupEnabled && (
            <div className="text-sm text-slate-500">
              Bu filtreyle henüz bir çalışma kaydı yok.
            </div>
          )}
          {/* Task #222: deep-link fallback states. The runs table only
              fetches the latest 10 rows, so a ?runId=… that points to
              an older run is fetched separately via the single-run
              endpoint and either prepended to the table or surfaced
              as an inline notice. */}
          {deepLinkLookupEnabled && deepLinkRunQuery.isFetching && (
            <div
              className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded px-3 py-2"
              data-testid="text-deep-link-fetching"
            >
              Bu çalışma ({initialDeepLinkRunId}) ilk 10 sonuç içinde
              değil, ayrıca getiriliyor…
            </div>
          )}
          {deepLinkLookupEnabled && deepLinkRunQuery.isError && (
            <div
              className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2"
              data-testid="text-deep-link-not-found"
            >
              {deepLinkRunQuery.error?.message === "invalid_id"
                ? `Geçersiz çalışma kimliği: ${initialDeepLinkRunId}`
                : deepLinkRunQuery.error?.message === "not_found"
                ? `Çalışma bulunamadı: ${initialDeepLinkRunId} (silinmiş veya saklama süresi dolmuş olabilir).`
                : `Çalışma getirilemedi: ${initialDeepLinkRunId}`}
            </div>
          )}
          {deepLinkExtraRun && (
            <div
              className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2"
              data-testid="text-deep-link-extra"
            >
              Bağlantıdaki çalışma ilk 10 sonuçta yok; en üste ayrıca
              eklendi.
            </div>
          )}
          {runsQuery.data && runsQuery.data.runs.length > 0 && (
            <div
              className="text-xs text-slate-500"
              data-testid="text-backfill-runs-retention"
            >
              {(() => {
                const shown = runsQuery.data.runs.length;
                const total = runsQuery.data.total ?? shown;
                const oldest = runsQuery.data.oldestStartedAt
                  ? new Date(runsQuery.data.oldestStartedAt).toLocaleDateString()
                  : null;
                const retention = runsQuery.data.retention;
                const base = `Gösterilen: ${shown} / toplam ${total} çalışma`;
                const tail = oldest ? ` · en eski ${oldest}` : "";
                const policy = retention
                  ? ` · ${retention.days} gün veya ${retention.maxRows} satır saklanır`
                  : "";
                return `${base}${tail}${policy}`;
              })()}
            </div>
          )}
          {runsQuery.data && (runsQuery.data.runs.length > 0 || deepLinkExtraRun) && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="table-backfill-runs">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-3"></th>
                    <th className="py-2 pr-3">Başlangıç</th>
                    <th className="py-2 pr-3">Tetikleyici</th>
                    <th className="py-2 pr-3">Süre</th>
                    <th className="py-2 pr-3">Durum</th>
                    <th className="py-2 pr-3">Denemeler</th>
                    <th className="py-2 pr-3">Logos (enq/cand)</th>
                    <th className="py-2 pr-3">Tags (hyd/proc)</th>
                    <th className="py-2 pr-3">Fail</th>
                    <th className="py-2 pr-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {(deepLinkExtraRun
                    ? [deepLinkExtraRun, ...runsQuery.data.runs]
                    : runsQuery.data.runs
                  ).map((run) => {
                    const totals = summarizeRunTotals(run);
                    const isExpanded = expandedRunId === run._id;
                    const isDeepLinked =
                      initialDeepLinkRunId === run._id;
                    const retryCount = (run.attempts ?? []).length;
                    const recovered =
                      run.status === "completed" && retryCount > 0;
                    return (
                      <Fragment key={run._id}>
                        <tr
                          id={`backfill-run-${run._id}`}
                          ref={(el) => {
                            runRowRefs.current[run._id] = el;
                          }}
                          className={`border-b border-slate-100 hover:bg-slate-50 cursor-pointer ${
                            isDeepLinked
                              ? "ring-2 ring-amber-400 bg-amber-50"
                              : ""
                          }`}
                          onClick={() =>
                            setExpandedRunId(isExpanded ? null : run._id)
                          }
                          data-testid={`row-backfill-run-${run._id}`}
                        >
                          <td className="py-2 pr-3 text-slate-400 w-6">
                            {isExpanded ? "▾" : "▸"}
                          </td>
                          <td className="py-2 pr-3 whitespace-nowrap">
                            {new Date(run.startedAt).toLocaleString()}
                          </td>
                          <td className="py-2 pr-3">
                            <code className="text-xs">{run.trigger}</code>
                          </td>
                          <td className="py-2 pr-3">
                            {formatDuration(run.durationMs)}
                          </td>
                          <td className="py-2 pr-3">
                            <Badge
                              variant={
                                run.status === "running"
                                  ? "default"
                                  : run.status === "failed"
                                  ? "destructive"
                                  : "secondary"
                              }
                              data-testid={`badge-run-status-${run._id}`}
                            >
                              {run.status.toUpperCase()}
                              {recovered && " · RECOVERED"}
                            </Badge>
                          </td>
                          <td className="py-2 pr-3">
                            {retryCount === 0 ? (
                              <span className="text-slate-400">—</span>
                            ) : (
                              <span
                                className={
                                  recovered
                                    ? "text-amber-700 font-semibold"
                                    : "text-rose-600 font-semibold"
                                }
                                title={
                                  recovered
                                    ? `Recovered after ${retryCount} failed attempt${retryCount === 1 ? "" : "s"}`
                                    : `Failed after ${retryCount + 1} attempts`
                                }
                                data-testid={`text-run-retries-${run._id}`}
                              >
                                {retryCount}× retry
                              </span>
                            )}
                          </td>
                          <td className="py-2 pr-3">
                            <span className="text-emerald-600 font-semibold">
                              {totals.logosEnqueued}
                            </span>
                            <span className="text-slate-400">
                              {" "}/ {totals.logosCandidates}
                            </span>
                          </td>
                          <td className="py-2 pr-3">
                            <span className="text-emerald-600 font-semibold">
                              {totals.tagsHydrated}
                            </span>
                            <span className="text-slate-400">
                              {" "}/ {totals.tagsProcessed}
                            </span>
                          </td>
                          <td className="py-2 pr-3">
                            {totals.tagsFailed > 0 ? (
                              <span className="text-rose-600">
                                {totals.tagsFailed}
                              </span>
                            ) : (
                              <span className="text-slate-400">0</span>
                            )}
                          </td>
                          <td className="py-2 pr-3">
                            <Link href={`/admin/seo-maintenance/runs/${run._id}`}>
                              <a
                                className="text-xs text-blue-600 hover:underline"
                                onClick={(e) => e.stopPropagation()}
                                data-testid={`link-backfill-run-${run._id}`}
                              >
                                Detay →
                              </a>
                            </Link>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="bg-slate-50">
                            <td colSpan={9} className="px-3 py-3">
                              {run.errorMessage && (
                                <div className="text-xs text-rose-600 mb-2">
                                  Hata: {run.errorMessage}
                                </div>
                              )}
                              {retryCount > 0 && (
                                <div
                                  className="mb-3"
                                  data-testid={`attempts-list-${run._id}`}
                                >
                                  <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">
                                    Başarısız denemeler ({retryCount})
                                    {recovered && (
                                      <span className="ml-2 text-amber-700 normal-case">
                                        · sonra başarıyla tamamlandı
                                      </span>
                                    )}
                                  </div>
                                  <ul className="space-y-1">
                                    {(run.attempts ?? []).map((a) => (
                                      <li
                                        key={`${run._id}-att-${a.attempt}`}
                                        className="text-xs bg-white border border-slate-200 rounded px-2 py-1"
                                        data-testid={`attempt-${run._id}-${a.attempt}`}
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
                                </div>
                              )}
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                  <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">
                                    Logos (top-{run.topN})
                                  </div>
                                  {run.logos.length === 0 ? (
                                    <div className="text-xs text-slate-500">
                                      Yok
                                    </div>
                                  ) : (
                                    run.logos.map((c) => (
                                      <div
                                        key={`logos-${run._id}-${c.countryCode}`}
                                        className="text-xs flex justify-between"
                                      >
                                        <span className="font-mono">
                                          {c.countryCode}
                                        </span>
                                        <span>
                                          enqueued{" "}
                                          <strong className="text-emerald-600">
                                            {c.enqueued}
                                          </strong>
                                          {" / "}
                                          {c.candidates}
                                        </span>
                                      </div>
                                    ))
                                  )}
                                </div>
                                <div>
                                  <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">
                                    Tags
                                  </div>
                                  {run.tags.length === 0 ? (
                                    <div className="text-xs text-slate-500">
                                      Yok
                                    </div>
                                  ) : (
                                    run.tags.map((c) => (
                                      <div
                                        key={`tags-${run._id}-${c.countryCode}`}
                                        className="text-xs flex justify-between"
                                      >
                                        <span className="font-mono">
                                          {c.countryCode}
                                        </span>
                                        <span>
                                          hydrated{" "}
                                          <strong className="text-emerald-600">
                                            {c.hydrated}
                                          </strong>
                                          {" / "}
                                          {c.processed}
                                          {c.failed > 0 && (
                                            <span className="text-rose-600">
                                              {" "}· {c.failed} fail
                                            </span>
                                          )}
                                        </span>
                                      </div>
                                    ))
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Logo backfill */}
      <Card className="bg-white">
        <CardHeader>
          <CardTitle className="text-base">Logo backfill (S3)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-slate-600">
            <code>logoAssets</code> eksik olan radyolar için S3 logo pipeline'ını manuel tetikler. Aynı endpoint <code>/api/admin/logos</code> sayfasında da var.
          </p>
          <Button onClick={() => startLogos.mutate()} disabled={startLogos.isPending}>
            {startLogos.isPending ? "Başlatılıyor..." : "Logo işlemeyi başlat"}
          </Button>
        </CardContent>
      </Card>

      {/* Tags backfill */}
      <Card className="bg-white">
        <CardHeader>
          <CardTitle className="text-base">Tags + languageCodes backfill (Radio-Browser)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-slate-600">
            <code>tags</code> alanı boş olan radyolar için Radio-Browser API'den <code>tags</code> ve <code>languageCodes</code> alanlarını yeniden çeker. Outro şablonundaki <code>{"{GENRES}"}</code> interpolation'ı için kritik.
          </p>
          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <label className="text-xs text-slate-600 mb-1 block">
                Ülke kodu (boş = global)
              </label>
              <Input
                value={tagsCountry}
                onChange={(e) =>
                  setTagsCountry(e.target.value.toUpperCase().slice(0, 2))
                }
                placeholder="örn. TR"
                className="w-24"
                data-testid="input-tags-backfill-country"
              />
            </div>
            <div>
              <label className="text-xs text-slate-600 mb-1 block">Limit (max 5000)</label>
              <Input
                type="number"
                value={tagsLimit}
                onChange={(e) => setTagsLimit(Math.max(1, Math.min(5000, parseInt(e.target.value) || 500)))}
                className="w-32"
              />
            </div>
            <Button
              onClick={() => startTags.mutate()}
              disabled={startTags.isPending || job?.isRunning}
              data-testid="button-run-tags-backfill"
            >
              {job?.isRunning ? "Çalışıyor..." : startTags.isPending ? "Başlatılıyor..." : "Tags backfill başlat"}
            </Button>
          </div>
          <p className="text-xs text-slate-500">
            Ülke kodu girilirse sadece o pazardaki radyolar taranır (Search
            Console'da uyarı gelen uzun-kuyruk ülkeler için). Her çalışma
            "Geçmiş haftalık backfill çalışmaları" tablosunda
            <code className="mx-1">admin:manual:tags</code>
            tetikleyicisiyle audit kaydı bırakır.
          </p>
          {job && (
            <div className="border border-slate-200 rounded p-3 bg-slate-50 text-sm space-y-1 mt-3">
              <div className="flex items-center gap-2">
                <Badge variant={job.isRunning ? "default" : "secondary"}>
                  {job.isRunning ? "ÇALIŞIYOR" : "TAMAMLANDI"}
                </Badge>
                <span className="text-xs text-slate-500">
                  Job: {job.jobId} {job.countryCode ? `· ${job.countryCode}` : ""}
                </span>
              </div>
              <div>Taranan: <strong>{job.scanned}</strong></div>
              <div>Güncellenen: <strong className="text-emerald-600">{job.updated}</strong></div>
              <div>Atlanan (Radio-Browser'da da boş): {job.skipped}</div>
              <div>Başarısız: <span className="text-rose-600">{job.failed}</span></div>
              {job.lastError && (
                <div className="text-xs text-rose-600 mt-1">Son hata: {job.lastError}</div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
