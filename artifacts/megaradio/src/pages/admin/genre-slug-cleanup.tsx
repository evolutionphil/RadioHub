import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// Task #198: surface the weekly genre-slug cleanup history (persisted as
// `GenreSlugCleanupRun` rows by `services/scheduled-genre-slug-cleanup.ts`)
// so admins can confirm the upstream issue is resolved without checking
// webhooks or grepping logs. Mirrors the SEO maintenance "Geçmiş haftalık
// backfill çalışmaları" table — same shape, same status badges, same
// retention-aware "showing X of Y" hint.

interface GenreSlugCleanupRun {
  _id: string;
  trigger: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  scanned: number;
  alreadyValid: number;
  normalized: number;
  markedUndiscoverable: number;
  emptySlugMarked: number;
  collisionMarked: number;
  errorCount: number;
  rewarmed: boolean;
  errorMessage?: string;
}

interface GenreSlugCleanupRunsResponse {
  runs: GenreSlugCleanupRun[];
  total: number;
  oldestStartedAt: string | null;
  alertThreshold: number;
  status: {
    isRunning: boolean;
    lastRunAt: string | null;
    lastRunId: string | null;
  };
}

type RunsTriggerFilter = "" | "cron:weekly" | "manual";

function formatDuration(ms?: number) {
  if (typeof ms !== "number" || !isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}m ${rs}s`;
}

// Mirrors `notifyGenreSlugCleanupResult` — the row "would have alerted"
// when it failed outright OR when normalized + demoted >= threshold.
function wouldHaveAlerted(run: GenreSlugCleanupRun, threshold: number): boolean {
  if (run.status === "failed") return true;
  return run.normalized + run.markedUndiscoverable >= threshold;
}

export default function AdminGenreSlugCleanupPage() {
  const [trigger, setTrigger] = useState<RunsTriggerFilter>("");

  const runsQuery = useQuery<GenreSlugCleanupRunsResponse>({
    queryKey: ["/api/admin/maintenance/genre-slug-cleanup/runs", trigger],
    queryFn: async () => {
      const qs = new URLSearchParams({ limit: "20" });
      if (trigger) qs.set("trigger", trigger);
      const res = await fetch(
        `/api/admin/maintenance/genre-slug-cleanup/runs?${qs.toString()}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    refetchInterval: (q) =>
      q.state.data?.status?.isRunning ? 5000 : false,
  });

  const data = runsQuery.data;
  const threshold = data?.alertThreshold ?? 5;
  const status = data?.status;

  return (
    <div className="p-6 space-y-6 bg-slate-50 min-h-screen">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          Genre-slug cleanup runs
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Weekly cron history (Sundays 05:00 Europe/Berlin). Rows highlighted
          in red either failed outright or changed enough rows to trip the
          on-call alert (threshold:{" "}
          <code className="text-slate-700">{threshold}</code>).
        </p>
      </div>

      <Card className="bg-white">
        <CardHeader>
          <CardTitle className="text-base">Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Badge
              variant={status?.isRunning ? "default" : "secondary"}
              data-testid="badge-cleanup-running"
            >
              {status?.isRunning ? "RUNNING NOW" : "IDLE"}
            </Badge>
            <span className="text-slate-500">
              Last run:{" "}
              {status?.lastRunAt
                ? new Date(status.lastRunAt).toLocaleString()
                : "—"}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-white">
        <CardHeader>
          <CardTitle className="text-base">History</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div>
              <label className="text-xs text-slate-600 mb-1 block">
                Trigger
              </label>
              <select
                value={trigger}
                onChange={(e) =>
                  setTrigger(e.target.value as RunsTriggerFilter)
                }
                className="border border-slate-300 rounded px-2 py-1 text-sm bg-white"
                data-testid="select-cleanup-trigger"
              >
                <option value="">All</option>
                <option value="cron:weekly">cron:weekly</option>
                <option value="manual">manual</option>
              </select>
            </div>
            <Button
              variant="outline"
              onClick={() => runsQuery.refetch()}
              disabled={runsQuery.isFetching}
            >
              {runsQuery.isFetching ? "Loading..." : "Refresh"}
            </Button>
          </div>

          {runsQuery.isLoading && (
            <div className="text-sm text-slate-500">Loading...</div>
          )}
          {runsQuery.error && (
            <div className="text-sm text-rose-600">
              Could not load history.
            </div>
          )}
          {data && data.runs.length === 0 && (
            <div className="text-sm text-slate-500">
              No runs recorded yet for this filter.
            </div>
          )}
          {data && data.runs.length > 0 && (
            <div
              className="text-xs text-slate-500"
              data-testid="text-cleanup-runs-totals"
            >
              {(() => {
                const shown = data.runs.length;
                const oldest = data.oldestStartedAt
                  ? new Date(data.oldestStartedAt).toLocaleDateString()
                  : null;
                const base = `Showing: ${shown} / ${data.total} runs`;
                const tail = oldest ? ` · oldest ${oldest}` : "";
                return `${base}${tail}`;
              })()}
            </div>
          )}
          {data && data.runs.length > 0 && (
            <div className="overflow-x-auto">
              <table
                className="w-full text-sm"
                data-testid="table-cleanup-runs"
              >
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-3">Started</th>
                    <th className="py-2 pr-3">Trigger</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Duration</th>
                    <th className="py-2 pr-3 text-right">Scanned</th>
                    <th className="py-2 pr-3 text-right">Normalized</th>
                    <th className="py-2 pr-3 text-right">Demoted</th>
                    <th className="py-2 pr-3 text-right">Errors</th>
                    <th className="py-2 pr-3">Rewarmed</th>
                    <th className="py-2 pr-3">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {data.runs.map((run) => {
                    const alerted = wouldHaveAlerted(run, threshold);
                    const failed = run.status === "failed";
                    const changed = run.normalized + run.markedUndiscoverable;
                    return (
                      <tr
                        key={run._id}
                        className={`border-b border-slate-100 ${
                          failed
                            ? "bg-rose-50"
                            : alerted
                            ? "bg-amber-50"
                            : "hover:bg-slate-50"
                        }`}
                        data-testid={`row-cleanup-run-${run._id}`}
                      >
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {new Date(run.startedAt).toLocaleString()}
                        </td>
                        <td className="py-2 pr-3">
                          <code className="text-xs">{run.trigger}</code>
                        </td>
                        <td className="py-2 pr-3">
                          <Badge
                            variant={
                              run.status === "running"
                                ? "default"
                                : failed
                                ? "destructive"
                                : "secondary"
                            }
                            data-testid={`badge-cleanup-status-${run._id}`}
                          >
                            {run.status.toUpperCase()}
                            {!failed && alerted && " · ALERTED"}
                          </Badge>
                        </td>
                        <td className="py-2 pr-3">
                          {formatDuration(run.durationMs)}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {run.scanned.toLocaleString()}
                        </td>
                        <td
                          className={`py-2 pr-3 text-right tabular-nums ${
                            run.normalized > 0 ? "font-semibold" : ""
                          }`}
                        >
                          {run.normalized.toLocaleString()}
                        </td>
                        <td
                          className={`py-2 pr-3 text-right tabular-nums ${
                            run.markedUndiscoverable > 0
                              ? "font-semibold text-amber-700"
                              : ""
                          }`}
                          title={
                            run.markedUndiscoverable > 0
                              ? `empty=${run.emptySlugMarked} · collision=${run.collisionMarked}`
                              : undefined
                          }
                        >
                          {run.markedUndiscoverable.toLocaleString()}
                        </td>
                        <td
                          className={`py-2 pr-3 text-right tabular-nums ${
                            run.errorCount > 0
                              ? "font-semibold text-rose-600"
                              : ""
                          }`}
                        >
                          {run.errorCount.toLocaleString()}
                        </td>
                        <td className="py-2 pr-3">
                          {run.rewarmed ? (
                            <span className="text-emerald-600 text-xs font-semibold">
                              yes
                            </span>
                          ) : (
                            <span className="text-slate-400 text-xs">no</span>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-xs">
                          {run.errorMessage ? (
                            <span
                              className="text-rose-600 break-words"
                              title={run.errorMessage}
                              data-testid={`text-cleanup-error-${run._id}`}
                            >
                              {run.errorMessage}
                            </span>
                          ) : alerted ? (
                            <span className="text-amber-700">
                              {changed} changed ≥ {threshold}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
