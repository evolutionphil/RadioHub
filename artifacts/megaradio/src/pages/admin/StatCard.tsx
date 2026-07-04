import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Admin dashboard stat tile (2026-07-04 redesign).
 *
 * Presentational only — the dashboard passes already-computed values, so no
 * data flow changes. Modern look: label + big value on the left, a tinted
 * rounded icon chip on the right, subtle ring + hover lift. Colour is driven
 * by a small accent map so every tile stays on one system in light AND dark.
 */
export type StatAccent = 'green' | 'blue' | 'purple' | 'indigo' | 'orange' | 'pink' | 'slate';

const ACCENTS: Record<StatAccent, { chip: string; value: string }> = {
  green:  { chip: 'bg-green-500/10 text-green-600 dark:text-green-400',   value: 'text-green-600 dark:text-green-400' },
  blue:   { chip: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',     value: 'text-foreground' },
  purple: { chip: 'bg-purple-500/10 text-purple-600 dark:text-purple-400', value: 'text-foreground' },
  indigo: { chip: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400', value: 'text-foreground' },
  orange: { chip: 'bg-orange-500/10 text-orange-600 dark:text-orange-400', value: 'text-foreground' },
  pink:   { chip: 'bg-pink-500/10 text-pink-600 dark:text-pink-400',     value: 'text-foreground' },
  slate:  { chip: 'bg-slate-500/10 text-slate-600 dark:text-slate-300',  value: 'text-foreground' },
};

interface StatCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  accent?: StatAccent;
  /** Optional caption under the value (e.g. "93% working"). */
  caption?: string;
  /** Optional progress 0..100 rendered as a thin bar. */
  progress?: number;
}

export function StatCard({ label, value, icon: Icon, accent = 'slate', caption, progress }: StatCardProps) {
  const a = ACCENTS[accent];
  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground truncate">{label}</p>
            <p className={cn('mt-1 text-2xl font-bold tabular-nums', a.value)}>{value}</p>
            {caption && <p className="mt-0.5 text-xs text-muted-foreground truncate">{caption}</p>}
          </div>
          <span className={cn('flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl', a.chip)}>
            <Icon className="h-5 w-5" />
          </span>
        </div>
        {typeof progress === 'number' && (
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn('h-full rounded-full', a.chip.replace(/\/10\b/, '').replace('text-', 'bg-').split(' ')[0])}
              style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
