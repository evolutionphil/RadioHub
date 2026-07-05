import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Shared admin page shell (2026-07-04 admin redesign).
 *
 * Gives every admin page one consistent header rhythm — title, optional
 * description, and a right-aligned actions slot — plus a max-width, padded
 * container that is responsive by default (comfortable on phones, roomy on
 * desktop). Presentational only; wrap existing page bodies in it without
 * touching their logic.
 *
 *   <AdminPage title="Sync Status" description="..." actions={<Button/>}>
 *     ...existing content...
 *   </AdminPage>
 */
interface AdminPageProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function AdminPage({ title, description, actions, children, className }: AdminPageProps) {
  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
      <header className="mb-5 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className={cn("space-y-5 sm:space-y-6", className)}>{children}</div>
    </div>
  );
}

/**
 * Section card — a titled panel for grouping content inside AdminPage.
 * Consistent border/rounding/padding so tables, forms and stat groups all
 * share one surface treatment.
 */
interface AdminSectionProps {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

export function AdminSection({ title, description, actions, children, className, bodyClassName }: AdminSectionProps) {
  return (
    <section className={cn("rounded-xl border border-border bg-card shadow-sm", className)}>
      {(title || actions) && (
        <div className="flex flex-col gap-2 border-b border-border px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="min-w-0">
            {title && <h2 className="text-base font-semibold text-foreground">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cn("p-4 sm:p-5", bodyClassName)}>{children}</div>
    </section>
  );
}
