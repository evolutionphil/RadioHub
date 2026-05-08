import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
  toast: vi.fn(),
}));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
  queryClient: { invalidateQueries: vi.fn() },
  resolveApiUrl: (p: string) => p,
  API_BASE: "",
}));

vi.mock("@/hooks/useAdminViewPrefs", () => ({
  useAdminViewPrefs: <T,>(_key: string, defaults: T) => ({
    prefs: defaults,
    setPrefs: vi.fn(),
    clearLocal: vi.fn(),
    reset: vi.fn(),
    loaded: true,
  }),
}));

// Replace recharts with lightweight stubs that record the props of every
// <Line>. Real recharts requires a non-zero ResponsiveContainer measurement
// to render its <Line> SVG output, which jsdom can't provide; for this test
// we only care about the dataKey / strokeDasharray plumbing, not the actual
// SVG geometry.
vi.mock("recharts", () => {
  const passthrough = (testid: string) =>
    function Stub({ children }: { children?: React.ReactNode }) {
      return <div data-testid={testid}>{children}</div>;
    };
  return {
    ResponsiveContainer: passthrough("rc-responsive"),
    LineChart: passthrough("rc-linechart"),
    CartesianGrid: passthrough("rc-grid"),
    XAxis: passthrough("rc-xaxis"),
    YAxis: passthrough("rc-yaxis"),
    Tooltip: passthrough("rc-tooltip"),
    Legend: passthrough("rc-legend"),
    Line: ({
      dataKey,
      stroke,
      strokeDasharray,
      name,
    }: {
      dataKey: string;
      stroke?: string;
      strokeDasharray?: string;
      name?: string;
    }) => (
      <div
        data-testid={`rc-line-${dataKey}`}
        data-stroke={stroke ?? ""}
        data-dasharray={strokeDasharray ?? ""}
        data-name={name ?? ""}
      />
    ),
  };
});

import AdminCoverageCompare from "../src/pages/admin/coverage-compare";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
    },
  });
}

const SELECTED = ["TR", "DE"] as const;

function seed(qc: QueryClient, opts: { withBackfill: boolean }) {
  qc.setQueryData(["/api/admin/coverage/by-country"], {
    countries: [
      {
        countryCode: "TR",
        countryName: "Turkey",
        total: 100,
        withLogo: 80,
        withTags: 60,
        logoCoveragePct: 80,
        tagCoveragePct: 60,
      },
      {
        countryCode: "DE",
        countryName: "Germany",
        total: 200,
        withLogo: 180,
        withTags: 150,
        logoCoveragePct: 90,
        tagCoveragePct: 75,
      },
    ],
  });

  const days = 90;
  const csv = SELECTED.join(",");
  const trendsKey = `/api/admin/coverage/trends?days=${days}&countryCode=${encodeURIComponent(csv)}`;

  const trTrend = opts.withBackfill
    ? [
        { date: "2026-04-01", logoCoveragePct: 70, tagCoveragePct: 50, total: 100, withLogo: 70, withTags: 50, source: "backfill" as const },
        { date: "2026-04-02", logoCoveragePct: 72, tagCoveragePct: 52, total: 100, withLogo: 72, withTags: 52, source: "backfill" as const },
        { date: "2026-04-03", logoCoveragePct: 75, tagCoveragePct: 55, total: 100, withLogo: 75, withTags: 55, source: "cron" as const },
        { date: "2026-04-04", logoCoveragePct: 78, tagCoveragePct: 58, total: 100, withLogo: 78, withTags: 58, source: "cron" as const },
      ]
    : [
        { date: "2026-04-01", logoCoveragePct: 75, tagCoveragePct: 55, total: 100, withLogo: 75, withTags: 55, source: "cron" as const },
        { date: "2026-04-02", logoCoveragePct: 76, tagCoveragePct: 56, total: 100, withLogo: 76, withTags: 56, source: "cron" as const },
        { date: "2026-04-03", logoCoveragePct: 77, tagCoveragePct: 57, total: 100, withLogo: 77, withTags: 57, source: "cron" as const },
        { date: "2026-04-04", logoCoveragePct: 78, tagCoveragePct: 58, total: 100, withLogo: 78, withTags: 58, source: "cron" as const },
      ];

  const deTrend = opts.withBackfill
    ? [
        { date: "2026-04-01", logoCoveragePct: 85, tagCoveragePct: 70, total: 200, withLogo: 170, withTags: 140, source: "backfill" as const },
        { date: "2026-04-02", logoCoveragePct: 86, tagCoveragePct: 71, total: 200, withLogo: 172, withTags: 142, source: "cron" as const },
        { date: "2026-04-03", logoCoveragePct: 88, tagCoveragePct: 73, total: 200, withLogo: 176, withTags: 146, source: "cron" as const },
        { date: "2026-04-04", logoCoveragePct: 90, tagCoveragePct: 75, total: 200, withLogo: 180, withTags: 150, source: "cron" as const },
      ]
    : [
        { date: "2026-04-01", logoCoveragePct: 85, tagCoveragePct: 70, total: 200, withLogo: 170, withTags: 140, source: "cron" as const },
        { date: "2026-04-02", logoCoveragePct: 86, tagCoveragePct: 71, total: 200, withLogo: 172, withTags: 142, source: "cron" as const },
        { date: "2026-04-03", logoCoveragePct: 88, tagCoveragePct: 73, total: 200, withLogo: 176, withTags: 146, source: "cron" as const },
        { date: "2026-04-04", logoCoveragePct: 90, tagCoveragePct: 75, total: 200, withLogo: 180, withTags: 150, source: "cron" as const },
      ];

  qc.setQueryData([trendsKey], {
    days,
    since: "2026-04-01",
    trends: { TR: trTrend, DE: deTrend },
  });
}

function renderPage(qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <AdminCoverageCompare />
    </QueryClientProvider>,
  );
}

describe("AdminCoverageCompare — synthetic days are dashed", () => {
  beforeEach(() => {
    window.history.replaceState(
      {},
      "",
      `/admin/coverage/compare?countries=${SELECTED.join(",")}&days=90`,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/");
  });

  it("renders both a solid cron <Line> and a dashed backfill <Line> for each selected country, on each chart", async () => {
    const qc = makeQueryClient();
    seed(qc, { withBackfill: true });
    renderPage(qc);

    // Sanity: chart actually rendered (i.e. we hit the merged>=2 branch).
    await screen.findByTestId("chart-compare-logo");
    expect(screen.getByTestId("chart-compare-tag")).toBeInTheDocument();

    for (const code of SELECTED) {
      // Logo chart
      const logoCron = screen.getByTestId(`rc-line-${code}_logo_cron`);
      const logoBackfill = screen.getByTestId(`rc-line-${code}_logo_backfill`);
      expect(logoCron.getAttribute("data-dasharray")).toBe("");
      expect(logoBackfill.getAttribute("data-dasharray")).not.toBe("");
      expect(logoBackfill.getAttribute("data-dasharray")).toBe("4 3");
      // Both halves of the same country share the same stroke colour so
      // dashed/solid segments visually belong together.
      expect(logoBackfill.getAttribute("data-stroke")).toBe(
        logoCron.getAttribute("data-stroke"),
      );

      // Tag chart
      const tagCron = screen.getByTestId(`rc-line-${code}_tag_cron`);
      const tagBackfill = screen.getByTestId(`rc-line-${code}_tag_backfill`);
      expect(tagCron.getAttribute("data-dasharray")).toBe("");
      expect(tagBackfill.getAttribute("data-dasharray")).toBe("4 3");
      expect(tagBackfill.getAttribute("data-stroke")).toBe(
        tagCron.getAttribute("data-stroke"),
      );
    }
  });

  it("renders the per-chart backfill caveat when synthetic days are present", async () => {
    const qc = makeQueryClient();
    seed(qc, { withBackfill: true });
    renderPage(qc);

    expect(
      await screen.findByTestId("backfill-caveat-logo"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("backfill-caveat-tag")).toBeInTheDocument();
  });

  it("hides the per-chart backfill caveat when every point is a real cron snapshot", async () => {
    const qc = makeQueryClient();
    seed(qc, { withBackfill: false });
    renderPage(qc);

    // Wait for chart to render so we know the trends data was consumed.
    await screen.findByTestId("chart-compare-logo");
    expect(screen.queryByTestId("backfill-caveat-logo")).toBeNull();
    expect(screen.queryByTestId("backfill-caveat-tag")).toBeNull();
  });
});
