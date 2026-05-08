import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("wouter", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
  queryClient: { invalidateQueries: vi.fn() },
  resolveApiUrl: (p: string) => p,
  API_BASE: "",
}));

import AdminDashboard from "../src/pages/admin/dashboard";
import SeoMaintenancePage from "../src/pages/admin/seo-maintenance";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
    },
  });
}

const RUN_ID = "run_abc123";

function makeRun(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    _id: RUN_ID,
    trigger: "cron:weekly",
    status: "completed" as const,
    topN: 30,
    startedAt: "2026-05-04T04:00:00.000Z",
    finishedAt: "2026-05-04T04:05:00.000Z",
    durationMs: 5 * 60 * 1000,
    logos: [{ countryCode: "TR", candidates: 10, enqueued: 5 }],
    tags: [
      { countryCode: "TR", processed: 20, hydrated: 18, emptyUpstream: 0, failed: 0 },
    ],
    ...overrides,
  };
}

function seedDashboard(qc: QueryClient, run: ReturnType<typeof makeRun> | null) {
  qc.setQueryData(["/api/dashboard/stats"], {
    totalStations: 0,
    totalCountries: 0,
    totalLanguages: 0,
    totalGenres: 0,
    totalCodecs: 0,
    workingStations: 0,
    offlineStations: 0,
    workingPercentage: 0,
    recentlyUpdated: 0,
    unresolvedErrors: 0,
    totalUsers: 0,
    activeRegisteredUsers: 0,
    openFeedback: 0,
    stationsWithFavicon: 0,
    faviconPercentage: 0,
    stationsWithDesc: 0,
    descriptionPercentage: 0,
    activeVisitors: 0,
    todayVisitors: 0,
    weekVisitors: 0,
    topCountries: [],
    topGenres: [],
    codecDistribution: [],
    syncStatus: {
      isRunning: false,
      lastSync: null,
      lastSyncStatus: "ok",
      isHealthy: true,
    },
  });
  qc.setQueryData(["/api/admin/translation-languages"], []);
  qc.setQueryData(["/api/admin/sync/auto-flagged-report"], {
    last: null,
    lastCompleted: null,
  });
  qc.setQueryData(["/api/admin/maintenance/scheduled-backfill/status"], {
    status: {
      isRunning: false,
      lastRunAt: run?.finishedAt ?? null,
      lastRunId: run?._id ?? null,
    },
    lastRun: run,
  });
}

describe("Admin dashboard → SEO Maintenance run deep link", () => {
  beforeEach(() => {
    // jsdom doesn't implement scrollIntoView (also polyfilled in setup.ts but
    // we re-spy here so we can assert against it in the maintenance test).
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a 'View details' button on the weekly-backfill card with the runId-scoped deep-link href", async () => {
    const qc = makeQueryClient();
    seedDashboard(qc, makeRun());

    render(
      <QueryClientProvider client={qc}>
        <AdminDashboard />
      </QueryClientProvider>,
    );

    const btn = await screen.findByTestId("button-view-backfill-run-details");
    expect(btn).toHaveTextContent(/view details/i);
    const link = btn.closest("a");
    expect(link).not.toBeNull();
    const expected = `/admin/seo-maintenance?runId=${encodeURIComponent(RUN_ID)}#backfill-run-${RUN_ID}`;
    expect(link).toHaveAttribute("href", expected);
  });

  it("renders the prominent 'View failed run details' button when the last run failed, pointing at the same deep link", async () => {
    const qc = makeQueryClient();
    seedDashboard(
      qc,
      makeRun({
        status: "failed",
        errorMessage: "upstream timeout",
        attempts: [
          { attempt: 1, error: "timeout", failedAt: "2026-05-04T04:01:00.000Z" },
        ],
      }),
    );

    render(
      <QueryClientProvider client={qc}>
        <AdminDashboard />
      </QueryClientProvider>,
    );

    const failedBtn = await screen.findByTestId("button-view-failed-backfill-run");
    expect(failedBtn).toHaveTextContent(/view failed run details/i);
    const link = failedBtn.closest("a");
    expect(link).not.toBeNull();
    const expected = `/admin/seo-maintenance?runId=${encodeURIComponent(RUN_ID)}#backfill-run-${RUN_ID}`;
    expect(link).toHaveAttribute("href", expected);
  });

  it("SEO Maintenance page reads ?runId from the URL, expands the matching row, and applies the highlight ring", async () => {
    // Capture as a string so the restore at the end is deterministic even if
    // jsdom's `window.location` reference itself gets swapped between tests.
    const originalHref = window.location.href;
    // jsdom's location.search is read-only on assignment in some setups; use
    // history.replaceState to drive the URLSearchParams read in the SUT.
    window.history.replaceState({}, "", `/admin/seo-maintenance?runId=${RUN_ID}`);

    const qc = makeQueryClient();
    qc.setQueryData(["/api/admin/maintenance/scheduled-backfill/status"], {
      status: { isRunning: false, lastRunAt: null, lastRunId: null },
      lastRun: null,
    });
    qc.setQueryData(["/api/admin/maintenance/tags-backfill/status"], {
      job: null,
    });
    // The stats query is keyed by the country state (defaults to "TR").
    qc.setQueryData(["/api/admin/seo-health-stats", "TR"], {
      country: "TR",
      total: 0,
      noIndex: 0,
      missing: {
        tags: 0,
        languageCodes: 0,
        logoAssets: 0,
        descriptionTr: 0,
        descriptionEn: 0,
      },
      brokenStream: { indexableTotal: 0, deadOver30Days: 0 },
    });
    qc.setQueryData(
      ["/api/admin/maintenance/scheduled-backfill/runs", ""],
      {
        runs: [makeRun()],
        total: 1,
        oldestStartedAt: "2026-05-04T04:00:00.000Z",
        retention: { days: 90, maxRows: 100 },
      },
    );

    render(
      <QueryClientProvider client={qc}>
        <SeoMaintenancePage />
      </QueryClientProvider>,
    );

    const row = await screen.findByTestId(`row-backfill-run-${RUN_ID}`);
    // Row id is what the dashboard's hash anchor (#backfill-run-<id>) targets.
    expect(row).toHaveAttribute("id", `backfill-run-${RUN_ID}`);
    // Highlight styling for the deep-linked row (Task #171 contract).
    expect(row.className).toMatch(/ring-2/);
    expect(row.className).toMatch(/ring-amber-400/);
    expect(row.className).toMatch(/bg-amber-50/);
    // Row chevron flips to ▾ when expanded; ▸ when collapsed.
    expect(row.textContent ?? "").toContain("▾");
    // Effect should have called scrollIntoView for the matched row.
    await waitFor(() => {
      expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    });

    // Reset URL so the test doesn't pollute siblings.
    window.history.replaceState({}, "", originalHref);
  });
});
