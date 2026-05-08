import { Link, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface RunCountryLogos {
  countryCode: string;
  candidates: number;
  enqueued: number;
  durationMs?: number;
}
interface RunCountryTags {
  countryCode: string;
  processed: number;
  hydrated: number;
  emptyUpstream: number;
  failed: number;
  durationMs?: number;
}
interface RunAttempt {
  attempt: number;
  error: string;
  failedAt: string;
}
interface BackfillRun {
  _id: string;
  trigger: string;
  status: "running" | "completed" | "failed";
  topN: number;
  overrideCountry?: string | null;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  logos: RunCountryLogos[];
  tags: RunCountryTags[];
  errorMessage?: string;
  attempts?: RunAttempt[];
}
interface RunDetailResponse {
  run: BackfillRun;
}

function formatDuration(ms?: number) {
  if (typeof ms !== "number" || !isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}m ${rs}s`;
}

function statusVariant(status: BackfillRun["status"]) {
  if (status === "running") return "default" as const;
  if (status === "failed") return "destructive" as const;
  return "secondary" as const;
}

export default function AdminSeoMaintenanceRunPage() {
  const [, params] = useRoute<{ id: string }>(
    "/admin/seo-maintenance/runs/:id",
  );
  const id = params?.id || "";

  const runQuery = useQuery<RunDetailResponse>({
    queryKey: [`/api/admin/maintenance/scheduled-backfill/runs/${id}`],
    enabled: !!id,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const run = runQuery.data?.run;
  const totals = run
    ? {
        logosEnqueued: run.logos.reduce((a, c) => a + (c.enqueued || 0), 0),
        logosCandidates: run.logos.reduce((a, c) => a + (c.candidates || 0), 0),
        tagsHydrated: run.tags.reduce((a, c) => a + (c.hydrated || 0), 0),
        tagsProcessed: run.tags.reduce((a, c) => a + (c.processed || 0), 0),
        tagsFailed: run.tags.reduce((a, c) => a + (c.failed || 0), 0),
        tagsEmptyUpstream: run.tags.reduce(
          (a, c) => a + (c.emptyUpstream || 0),
          0,
        ),
      }
    : null;

  return (
    <div className="p-6 space-y-6 bg-slate-50 min-h-screen">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/admin/seo-maintenance">
            <Button
              variant="ghost"
              size="sm"
              className="mb-2 -ml-2 text-slate-600"
              data-testid="link-back-to-seo-maintenance"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              SEO Maintenance
            </Button>
          </Link>
          <h1 className="text-2xl font-bold text-slate-900">
            Backfill çalışması
          </h1>
          <p className="text-sm text-slate-600 mt-1 font-mono">{id}</p>
        </div>
      </div>

      {runQuery.isLoading && (
        <Card className="bg-white">
          <CardContent className="py-8 text-sm text-slate-500">
            Yükleniyor...
          </CardContent>
        </Card>
      )}
      {runQuery.error && (
        <Card className="bg-white">
          <CardContent className="py-8 text-sm text-rose-600">
            Bu çalışma kaydı bulunamadı veya yüklenemedi. Eski çalışmalar
            saklama süresi dolduğunda silinmiş olabilir.
          </CardContent>
        </Card>
      )}

      {run && totals && (
        <>
          <Card className="bg-white">
            <CardHeader>
              <CardTitle className="text-base">Özet</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant={statusVariant(run.status)}>
                  {run.status.toUpperCase()}
                </Badge>
                <span className="text-xs text-slate-500">
                  Trigger: <code>{run.trigger}</code>
                </span>
                <span className="text-xs text-slate-500">
                  ·{" "}
                  {run.overrideCountry
                    ? `ülke=${run.overrideCountry}`
                    : `top-${run.topN}`}
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                <div className="border border-slate-200 rounded p-3 bg-slate-50">
                  <div className="text-xs uppercase tracking-wide text-slate-500">
                    Başlangıç
                  </div>
                  <div className="mt-1">
                    {new Date(run.startedAt).toLocaleString()}
                  </div>
                </div>
                <div className="border border-slate-200 rounded p-3 bg-slate-50">
                  <div className="text-xs uppercase tracking-wide text-slate-500">
                    Bitiş
                  </div>
                  <div className="mt-1">
                    {run.finishedAt
                      ? new Date(run.finishedAt).toLocaleString()
                      : "—"}
                  </div>
                </div>
                <div className="border border-slate-200 rounded p-3 bg-slate-50">
                  <div className="text-xs uppercase tracking-wide text-slate-500">
                    Süre
                  </div>
                  <div className="mt-1">{formatDuration(run.durationMs)}</div>
                </div>
              </div>
              {run.errorMessage && (
                <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-3">
                  <div className="text-xs uppercase tracking-wide text-rose-600 mb-1">
                    Hata
                  </div>
                  <pre className="whitespace-pre-wrap break-words text-xs font-mono">
                    {run.errorMessage}
                  </pre>
                </div>
              )}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div className="border border-slate-200 rounded p-3 bg-white">
                  <div className="text-xs uppercase tracking-wide text-slate-500">
                    Logos enqueued
                  </div>
                  <div className="mt-1 text-emerald-600 font-semibold">
                    {totals.logosEnqueued}
                  </div>
                  <div className="text-xs text-slate-400">
                    / {totals.logosCandidates} aday
                  </div>
                </div>
                <div className="border border-slate-200 rounded p-3 bg-white">
                  <div className="text-xs uppercase tracking-wide text-slate-500">
                    Tags hydrated
                  </div>
                  <div className="mt-1 text-emerald-600 font-semibold">
                    {totals.tagsHydrated}
                  </div>
                  <div className="text-xs text-slate-400">
                    / {totals.tagsProcessed} işlenen
                  </div>
                </div>
                <div className="border border-slate-200 rounded p-3 bg-white">
                  <div className="text-xs uppercase tracking-wide text-slate-500">
                    Upstream'de boş
                  </div>
                  <div className="mt-1 text-slate-700 font-semibold">
                    {totals.tagsEmptyUpstream}
                  </div>
                </div>
                <div className="border border-slate-200 rounded p-3 bg-white">
                  <div className="text-xs uppercase tracking-wide text-slate-500">
                    Tag fail
                  </div>
                  <div
                    className={`mt-1 font-semibold ${
                      totals.tagsFailed > 0
                        ? "text-rose-600"
                        : "text-slate-400"
                    }`}
                  >
                    {totals.tagsFailed}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white">
            <CardHeader>
              <CardTitle className="text-base">Logo backfill (ülke bazında)</CardTitle>
            </CardHeader>
            <CardContent>
              {run.logos.length === 0 ? (
                <div className="text-sm text-slate-500">Yok</div>
              ) : (
                <div className="overflow-x-auto">
                  <table
                    className="w-full text-sm"
                    data-testid="table-run-logos"
                  >
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                        <th className="py-2 pr-3">Ülke</th>
                        <th className="py-2 pr-3">Aday</th>
                        <th className="py-2 pr-3">Enqueued</th>
                        <th className="py-2 pr-3">Süre</th>
                      </tr>
                    </thead>
                    <tbody>
                      {run.logos.map((c) => (
                        <tr
                          key={`logos-${c.countryCode}`}
                          className="border-b border-slate-100"
                        >
                          <td className="py-2 pr-3 font-mono">
                            {c.countryCode}
                          </td>
                          <td className="py-2 pr-3">{c.candidates}</td>
                          <td className="py-2 pr-3 text-emerald-600 font-semibold">
                            {c.enqueued}
                          </td>
                          <td
                            className="py-2 pr-3 text-slate-500 font-mono text-xs"
                            data-testid={`cell-logo-duration-${c.countryCode}`}
                          >
                            {formatDuration(c.durationMs)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-white">
            <CardHeader>
              <CardTitle className="text-base">Tags backfill (ülke bazında)</CardTitle>
            </CardHeader>
            <CardContent>
              {run.tags.length === 0 ? (
                <div className="text-sm text-slate-500">Yok</div>
              ) : (
                <div className="overflow-x-auto">
                  <table
                    className="w-full text-sm"
                    data-testid="table-run-tags"
                  >
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                        <th className="py-2 pr-3">Ülke</th>
                        <th className="py-2 pr-3">İşlenen</th>
                        <th className="py-2 pr-3">Hydrated</th>
                        <th className="py-2 pr-3">Upstream boş</th>
                        <th className="py-2 pr-3">Fail</th>
                        <th className="py-2 pr-3">Süre</th>
                      </tr>
                    </thead>
                    <tbody>
                      {run.tags.map((c) => (
                        <tr
                          key={`tags-${c.countryCode}`}
                          className="border-b border-slate-100"
                        >
                          <td className="py-2 pr-3 font-mono">
                            {c.countryCode}
                          </td>
                          <td className="py-2 pr-3">{c.processed}</td>
                          <td className="py-2 pr-3 text-emerald-600 font-semibold">
                            {c.hydrated}
                          </td>
                          <td className="py-2 pr-3 text-slate-500">
                            {c.emptyUpstream}
                          </td>
                          <td
                            className={`py-2 pr-3 ${
                              c.failed > 0
                                ? "text-rose-600 font-semibold"
                                : "text-slate-400"
                            }`}
                          >
                            {c.failed}
                          </td>
                          <td
                            className="py-2 pr-3 text-slate-500 font-mono text-xs"
                            data-testid={`cell-tag-duration-${c.countryCode}`}
                          >
                            {formatDuration(c.durationMs)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {run.attempts && run.attempts.length > 0 && (
            <Card className="bg-white">
              <CardHeader>
                <CardTitle className="text-base">
                  Başarısız denemeler ({run.attempts.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {run.attempts.map((a) => (
                  <div
                    key={`attempt-${a.attempt}`}
                    className="border border-rose-200 bg-rose-50 rounded p-3"
                  >
                    <div className="flex items-center justify-between text-xs text-slate-600 mb-1">
                      <span>Deneme #{a.attempt}</span>
                      <span>{new Date(a.failedAt).toLocaleString()}</span>
                    </div>
                    <pre className="whitespace-pre-wrap break-words text-xs font-mono text-rose-700">
                      {a.error}
                    </pre>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
