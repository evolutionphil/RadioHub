import { useMemo } from "react";
import type { RetryTrendRun } from "./RetryTrendSparkline";

export interface RetryCauseBreakdownProps {
  runs: RetryTrendRun[];
  testId?: string;
  maxBuckets?: number;
}

interface BucketRule {
  key: string;
  label: string;
  color: string;
  match: RegExp;
}

const BUCKET_RULES: BucketRule[] = [
  {
    key: "radio-browser",
    label: "Radio-Browser",
    color: "#6366f1",
    match: /radio[\s-]?browser|all\.api\.radio-browser|de1\.api\.radio-browser/i,
  },
  {
    key: "s3",
    label: "S3 / object storage",
    color: "#0ea5e9",
    match: /\bs3\b|amazonaws|object[\s-]?storage|noSuchKey|slowDown|putObject|getObject/i,
  },
  {
    key: "mongo",
    label: "MongoDB",
    color: "#10b981",
    match: /mongo|mongoose|write conflict|writeconflict|e11000|duplicate key|wiredtiger/i,
  },
  {
    key: "logo-fetch",
    label: "Logo fetch",
    color: "#f59e0b",
    match: /favicon|logo[\s-]?(fetch|download|processor)|sharp|image fetch/i,
  },
  {
    key: "timeout",
    label: "Timeout",
    color: "#d97706",
    match: /timeout|etimedout|esockettimedout|timed out/i,
  },
  {
    key: "network",
    label: "Network",
    color: "#ef4444",
    match: /enotfound|econnreset|econnrefused|econnaborted|fetch failed|network|socket hang up|getaddrinfo|dns/i,
  },
  {
    key: "http-5xx",
    label: "Upstream 5xx",
    color: "#a855f7",
    match: /\b5\d{2}\b|bad gateway|gateway timeout|service unavailable|internal server error/i,
  },
  {
    key: "http-4xx",
    label: "Upstream 4xx",
    color: "#f97316",
    match: /\b4\d{2}\b|forbidden|unauthorized|not found|too many requests|rate limit/i,
  },
];

const OTHER_BUCKET = {
  key: "other",
  label: "Other",
  color: "#64748b",
} as const;

export function bucketRetryError(error: string): {
  key: string;
  label: string;
  color: string;
} {
  const trimmed = error.trim();
  if (!trimmed) return { ...OTHER_BUCKET };
  for (const rule of BUCKET_RULES) {
    if (rule.match.test(trimmed)) {
      return { key: rule.key, label: rule.label, color: rule.color };
    }
  }
  return { ...OTHER_BUCKET };
}

interface BucketSummary {
  key: string;
  label: string;
  color: string;
  count: number;
  sample: string;
}

export function summarizeRetryCauses(runs: RetryTrendRun[]): BucketSummary[] {
  const map = new Map<string, BucketSummary>();
  for (const run of runs) {
    for (const attempt of run.attempts ?? []) {
      const err = (attempt.error ?? "").trim();
      if (!err) continue;
      const bucket = bucketRetryError(err);
      const existing = map.get(bucket.key);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(bucket.key, {
          key: bucket.key,
          label: bucket.label,
          color: bucket.color,
          count: 1,
          sample: err.length > 140 ? `${err.slice(0, 137)}…` : err,
        });
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

export function RetryCauseBreakdown({
  runs,
  testId = "retry-cause-breakdown",
  maxBuckets = 4,
}: RetryCauseBreakdownProps) {
  const buckets = useMemo(() => summarizeRetryCauses(runs), [runs]);

  if (buckets.length === 0) {
    return (
      <div
        className="text-[11px] text-slate-500"
        data-testid={`${testId}-empty`}
      >
        No retry causes recorded
      </div>
    );
  }

  const total = buckets.reduce((s, b) => s + b.count, 0);
  const visible = buckets.slice(0, maxBuckets);
  const hidden = buckets.slice(maxBuckets);
  const hiddenCount = hidden.reduce((s, b) => s + b.count, 0);
  const top = visible[0];

  return (
    <div
      className="text-[11px] text-slate-600 leading-tight"
      data-testid={testId}
    >
      <div
        className="uppercase tracking-wide text-slate-500 mb-1"
        data-testid={`${testId}-header`}
      >
        Retry causes · top: {top.label} ({top.count})
      </div>
      <ul className="space-y-0.5">
        {visible.map((b) => {
          const pct = Math.round((b.count / total) * 100);
          return (
            <li
              key={b.key}
              className="flex items-center gap-1.5"
              data-testid={`${testId}-row-${b.key}`}
              title={b.sample}
            >
              <span
                aria-hidden="true"
                className="inline-block w-2 h-2 rounded-sm flex-shrink-0"
                style={{ background: b.color }}
              />
              <span className="font-medium text-slate-700">{b.label}</span>
              <span className="text-slate-500">
                {b.count} ({pct}%)
              </span>
            </li>
          );
        })}
        {hidden.length > 0 && (
          <li
            className="text-slate-500"
            data-testid={`${testId}-row-more`}
          >
            +{hidden.length} more · {hiddenCount} retr
            {hiddenCount === 1 ? "y" : "ies"}
          </li>
        )}
      </ul>
    </div>
  );
}
