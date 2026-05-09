import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";

// Task #264: drill-down for a single GenreSlugCleanupRun. Lists the
// Genre rows whose `cleanupDemotion.demotedAt` lands inside the run's
// [startedAt, finishedAt] window so admins can answer "what got hit?"
// without having to query Mongo.

interface GenreCleanupDemotion {
  _id: string;
  name: string;
  currentSlug: string;
  reason: "empty-slug" | "collision" | null;
  originalSlug: string | null;
  normalizedSlug: string | null;
  collisionWinnerId: string | null;
  collisionWinnerSlug: string | null;
  collisionWinnerName: string | null;
  demotedAt: string | null;
}

interface GenreCleanupDemotionsResponse {
  runId: string;
  window: {
    startedAt: string;
    endedAt: string;
    runStatus: string;
    isOpenEnded: boolean;
  };
  demotions: GenreCleanupDemotion[];
  total: number;
  limit: number;
}

export function GenreCleanupRunDemotions({ runId }: { runId: string }) {
  const query = useQuery<GenreCleanupDemotionsResponse>({
    queryKey: [
      "/api/admin/maintenance/genre-slug-cleanup/runs",
      runId,
      "demotions",
    ],
    queryFn: async () => {
      const res = await fetch(
        `/api/admin/maintenance/genre-slug-cleanup/runs/${runId}/demotions`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });

  if (query.isLoading) {
    return (
      <div
        className="text-xs text-slate-500"
        data-testid={`text-demotions-loading-${runId}`}
      >
        Loading demoted genres…
      </div>
    );
  }
  if (query.error) {
    return (
      <div
        className="text-xs text-rose-600"
        data-testid={`text-demotions-error-${runId}`}
      >
        Could not load demoted genres for this run.
      </div>
    );
  }
  const data = query.data;
  if (!data) return null;
  if (data.demotions.length === 0) {
    return (
      <div
        className="text-xs text-slate-500"
        data-testid={`text-demotions-empty-${runId}`}
      >
        No genres recorded a demotion inside this run window
        {data.window.isOpenEnded ? " (run is still in progress)." : "."}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div
        className="text-xs text-slate-500"
        data-testid={`text-demotions-totals-${runId}`}
      >
        {data.total} demoted genre{data.total === 1 ? "" : "s"} in window
        {data.total >= data.limit ? ` (capped at ${data.limit})` : ""}
        {data.window.isOpenEnded ? " · run is still in progress" : ""}
      </div>
      <div className="overflow-x-auto">
        <table
          className="w-full text-xs"
          data-testid={`table-demotions-${runId}`}
        >
          <thead>
            <tr className="border-b border-slate-200 text-left uppercase tracking-wide text-slate-500">
              <th className="py-1 pr-3">Demoted at</th>
              <th className="py-1 pr-3">Genre</th>
              <th className="py-1 pr-3">Reason</th>
              <th className="py-1 pr-3">Original slug</th>
              <th className="py-1 pr-3">Normalized slug</th>
              <th className="py-1 pr-3">Collision winner</th>
            </tr>
          </thead>
          <tbody>
            {data.demotions.map((d) => (
              <tr
                key={d._id}
                className="border-b border-slate-100"
                data-testid={`row-demotion-${d._id}`}
              >
                <td className="py-1 pr-3 whitespace-nowrap">
                  {d.demotedAt
                    ? new Date(d.demotedAt).toLocaleString()
                    : "—"}
                </td>
                <td className="py-1 pr-3">
                  {/* Task #353: deep-link straight into the existing genre
                      admin list, pre-filtered to this genre's name and the
                      "demoted only" view, so admins can jump from the
                      cleanup history to a remediation flow in one click. */}
                  <a
                    href={`/admin/genres?search=${encodeURIComponent(d.name)}&demoted=1`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-blue-600 hover:underline"
                    data-testid={`link-demoted-genre-${d._id}`}
                  >
                    {d.name}
                  </a>
                  <div>
                    <code className="text-[10px] text-slate-500">
                      {d.currentSlug}
                    </code>
                  </div>
                </td>
                <td className="py-1 pr-3">
                  {d.reason ? (
                    <Badge
                      variant={
                        d.reason === "collision" ? "default" : "secondary"
                      }
                      data-testid={`badge-demotion-reason-${d._id}`}
                    >
                      {d.reason}
                    </Badge>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="py-1 pr-3">
                  {d.originalSlug ? (
                    <code className="text-[10px] break-all text-slate-700">
                      {JSON.stringify(d.originalSlug)}
                    </code>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="py-1 pr-3">
                  {d.normalizedSlug ? (
                    <code className="text-[10px] break-all text-slate-700">
                      {d.normalizedSlug}
                    </code>
                  ) : (
                    <span className="text-slate-400">(empty)</span>
                  )}
                </td>
                <td className="py-1 pr-3">
                  {d.reason === "collision" && d.collisionWinnerName ? (
                    <div>
                      {/* Task #353: link the winning genre to the same
                          admin view (no demoted filter — the winner is the
                          live row admins want to inspect/edit). */}
                      <a
                        href={`/admin/genres?search=${encodeURIComponent(d.collisionWinnerName)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline"
                        data-testid={`link-collision-winner-${d._id}`}
                      >
                        {d.collisionWinnerName}
                      </a>
                      {d.collisionWinnerSlug && (
                        <div>
                          <code className="text-[10px] text-slate-500">
                            {d.collisionWinnerSlug}
                          </code>
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
