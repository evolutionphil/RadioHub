import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const RUN_ID = "run_xyz789";

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
  useRoute: (pattern: string) => {
    if (pattern === "/admin/seo-maintenance/runs/:id") {
      return [true, { id: RUN_ID }] as const;
    }
    return [false, null] as const;
  },
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

import AdminSeoMaintenanceRunPage from "../src/pages/admin/seo-maintenance-run";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
    },
  });
}

describe("Admin /admin/seo-maintenance/runs/:id deep link", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads the runId from the route, fetches the matching run, and renders the run summary + per-country tables", async () => {
    const qc = makeQueryClient();
    qc.setQueryData(
      [`/api/admin/maintenance/scheduled-backfill/runs/${RUN_ID}`],
      {
        run: {
          _id: RUN_ID,
          trigger: "cron:weekly",
          status: "completed" as const,
          topN: 30,
          startedAt: "2026-05-04T04:00:00.000Z",
          finishedAt: "2026-05-04T04:05:00.000Z",
          durationMs: 5 * 60 * 1000,
          logos: [
            {
              countryCode: "TR",
              candidates: 10,
              enqueued: 7,
              durationMs: 1234,
            },
            {
              countryCode: "DE",
              candidates: 4,
              enqueued: 3,
              durationMs: 567,
            },
          ],
          tags: [
            {
              countryCode: "TR",
              processed: 20,
              hydrated: 18,
              emptyUpstream: 1,
              failed: 1,
              durationMs: 2500,
            },
          ],
          attempts: [
            {
              attempt: 1,
              error: "upstream timeout",
              failedAt: "2026-05-04T04:01:00.000Z",
            },
          ],
        },
      },
    );

    render(
      <QueryClientProvider client={qc}>
        <AdminSeoMaintenanceRunPage />
      </QueryClientProvider>,
    );

    // Header echoes the route id (so we know useRoute was wired up).
    expect(await screen.findByText(RUN_ID)).toBeInTheDocument();

    // Status badge from the fetched run.
    expect(screen.getByText("COMPLETED")).toBeInTheDocument();

    // Per-country logos table with the seeded countries + summed enqueued.
    const logos = screen.getByTestId("table-run-logos");
    expect(within(logos).getByText("TR")).toBeInTheDocument();
    expect(within(logos).getByText("DE")).toBeInTheDocument();
    expect(within(logos).getByText("7")).toBeInTheDocument();

    // Per-country tags table with the seeded row.
    const tags = screen.getByTestId("table-run-tags");
    expect(within(tags).getByText("18")).toBeInTheDocument();

    // Failed attempts section is rendered when attempts are present.
    expect(screen.getByText(/Başarısız denemeler \(1\)/)).toBeInTheDocument();
    expect(screen.getByText("upstream timeout")).toBeInTheDocument();
  });
});
