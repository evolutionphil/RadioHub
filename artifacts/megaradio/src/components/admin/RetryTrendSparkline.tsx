import { useMemo, useState } from "react";

export interface RetryTrendRun {
  _id: string;
  startedAt: string;
  status: "running" | "completed" | "failed";
  attempts?: Array<{ attempt: number; error?: string; failedAt?: string }>;
}

interface RetryTrendSparklineProps {
  runs: RetryTrendRun[];
  width?: number;
  height?: number;
  testId?: string;
}

function statusColor(status: RetryTrendRun["status"], retries: number): string {
  if (status === "failed") return "#e11d48";
  if (status === "running") return "#3b82f6";
  if (retries > 0) return "#d97706";
  return "#10b981";
}

function statusLabel(status: RetryTrendRun["status"], retries: number): string {
  if (status === "failed") return "failed";
  if (status === "running") return "running";
  if (retries > 0) return "recovered";
  return "clean";
}

export function RetryTrendSparkline({
  runs,
  width = 220,
  height = 56,
  testId = "retry-trend-sparkline",
}: RetryTrendSparklineProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const ordered = useMemo(() => {
    return [...runs].sort(
      (a, b) =>
        new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
    );
  }, [runs]);

  if (ordered.length === 0) {
    return (
      <div
        className="text-xs text-slate-500"
        data-testid={`${testId}-empty`}
      >
        No runs yet
      </div>
    );
  }

  const retriesPerRun = ordered.map((r) => (r.attempts ?? []).length);
  const maxRetries = Math.max(1, ...retriesPerRun);
  const padX = 4;
  const padY = 4;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const slot = innerW / ordered.length;
  const barW = Math.max(2, slot - 2);
  const totalRetries = retriesPerRun.reduce((s, n) => s + n, 0);
  const avg = totalRetries / ordered.length;

  const hovered = hoverIdx != null ? ordered[hoverIdx] : null;
  const hoveredRetries = hoverIdx != null ? retriesPerRun[hoverIdx] : 0;

  return (
    <div className="inline-block" data-testid={testId}>
      <div className="relative">
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`Retry counts for last ${ordered.length} runs, max ${maxRetries}, average ${avg.toFixed(1)}`}
        >
          <line
            x1={padX}
            x2={width - padX}
            y1={height - padY}
            y2={height - padY}
            stroke="#e2e8f0"
            strokeWidth={1}
          />
          {ordered.map((run, i) => {
            const retries = retriesPerRun[i];
            const h = retries === 0 ? 2 : Math.max(2, (retries / maxRetries) * innerH);
            const x = padX + slot * i + (slot - barW) / 2;
            const y = height - padY - h;
            const color = statusColor(run.status, retries);
            const isHover = hoverIdx === i;
            return (
              <rect
                key={run._id}
                x={x}
                y={y}
                width={barW}
                height={h}
                fill={color}
                opacity={isHover ? 1 : 0.85}
                rx={1}
                ry={1}
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx(null)}
                data-testid={`${testId}-bar-${i}`}
                style={{ cursor: "pointer" }}
              >
                <title>
                  {`${new Date(run.startedAt).toLocaleString()} · ${statusLabel(run.status, retries)} · ${retries} retr${retries === 1 ? "y" : "ies"}`}
                </title>
              </rect>
            );
          })}
        </svg>
      </div>
      <div
        className="text-[11px] text-slate-500 mt-1 leading-tight"
        data-testid={`${testId}-summary`}
      >
        {hovered ? (
          <span data-testid={`${testId}-hover`}>
            {new Date(hovered.startedAt).toLocaleDateString()} ·{" "}
            <span className="font-medium text-slate-700">
              {statusLabel(hovered.status, hoveredRetries)}
            </span>{" "}
            · {hoveredRetries} retr{hoveredRetries === 1 ? "y" : "ies"}
          </span>
        ) : (
          <span>
            Last {ordered.length} runs · {totalRetries} retr
            {totalRetries === 1 ? "y" : "ies"} total · avg {avg.toFixed(1)}/run
          </span>
        )}
      </div>
    </div>
  );
}
