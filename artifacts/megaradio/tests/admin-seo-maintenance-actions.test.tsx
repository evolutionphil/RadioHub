import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("wouter", () => ({
  Link: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a>,
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
  queryClient: { invalidateQueries: vi.fn() },
}));

import SeoMaintenancePage from "../src/pages/admin/seo-maintenance";
import { apiRequest, queryClient } from "../src/lib/queryClient";

const health = {
  country: "TR", total: 123, noIndex: 0,
  missing: { tags: 0, languageCodes: 0, logoAssets: 0, descriptionTr: 0, descriptionEn: 0 },
  brokenStream: { indexableTotal: 0, deadOver30Days: 0 },
};
const gscKey = ["/api/admin/gsc-inspection/status"];
const syncKey = ["/api/admin/sync/status"];
const tagsKey = ["/api/admin/maintenance/tags-backfill/status"];
const gscStatus = { configured: true, cronEnabled: true, inspectionRunning: false, discoveryRunning: false,
  lastInspectionAt: null, lastDiscoveryAt: null, lastInspectionStats: null, totalUrls: 123, defaultBatchSize: 50 };
const clients: QueryClient[] = [];

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { queryFn: async () => { throw new Error("Unexpected unseeded query"); }, retry: false, staleTime: Infinity, gcTime: 0, refetchOnMount: false } } });
  clients.push(client);
  client.setQueryData(["/api/admin/seo-health-stats", "TR"], health);
  client.setQueryData(tagsKey, { job: null });
  client.setQueryData(["/api/admin/maintenance/scheduled-backfill/status"], { status: { isRunning: false, lastRunAt: null, lastRunId: null }, lastRun: null });
  client.setQueryData(["/api/admin/maintenance/scheduled-backfill/runs", "", ""], { runs: [] });
  for (const action of ["strip-suffix", "fill-templates"]) client.setQueryData([`/api/admin/maintenance/descriptions/${action}/status`], { job: null });
  client.setQueryData(["/api/admin/settings/backfill-retention"], {
    stored: { days: null, maxRows: null }, env: { days: null, maxRows: null }, defaults: { days: 30, maxRows: 100 },
    effective: { days: 30, maxRows: 100, source: { days: "default", maxRows: "default" } },
    bounds: { daysMin: 1, daysMax: 365, maxRowsMin: 1, maxRowsMax: 10000 }, updatedAt: null, updatedBy: null,
  });
  client.setQueryData(["/api/admin/settings/backfill-retention/history"], { entries: [] });
  client.setQueryData(["/api/admin/sitemap/manifest-stats"], {
    qualifiedLanguages: [], zombieLanguages: [], qualifiedLanguagesHash: "empty", stats: [], totalActive: 0,
    oldestGeneratedAt: null, newestGeneratedAt: null,
  });
  client.setQueryData(gscKey, gscStatus);
  client.setQueryData(syncKey, { ok: true, status: { isRunning: false, lastRunAt: null, lastResult: null } });
  return client;
}

function show(client: QueryClient) {
  return render(<QueryClientProvider client={client}><SeoMaintenancePage /></QueryClientProvider>);
}

describe("SEO Maintenance actions", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => { for (const client of clients.splice(0)) client.clear(); });

  it("acknowledges asynchronous inspection and refreshes status without inventing completion counts", async () => {
    vi.mocked(apiRequest).mockResolvedValue(new Response(JSON.stringify({ ok: true, running: true })));
    show(setup());
    fireEvent.click(screen.getByRole("button", { name: /Inspection Batch'i Şimdi/ }));
    expect(await screen.findByText(/Inspection isteği alındı/)).toBeInTheDocument();
    expect(screen.queryByText(/Inspection batch tamamlandı/)).not.toBeInTheDocument();
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: gscKey });
  });

  it("renders the discovery totals returned by the API", async () => {
    vi.mocked(apiRequest).mockResolvedValue(new Response(JSON.stringify({ ok: true, stats: { inserted: 7, refreshed: 25, pruned: 2 } })));
    show(setup());
    fireEvent.click(screen.getByRole("button", { name: /URL Keşfini Şimdi/ }));
    expect(await screen.findByText(/URL keşfi tamamlandı: \+7 yeni, ↻25 yenilendi, 🗑️2 silindi/)).toBeInTheDocument();
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: gscKey });
  });

  it("does not report a skipped discovery as a successful zero-result run", async () => {
    vi.mocked(apiRequest).mockResolvedValue(new Response(JSON.stringify({ ok: true, stats: null })));
    show(setup());
    fireEvent.click(screen.getByRole("button", { name: /URL Keşfini Şimdi/ }));
    expect(await screen.findByText(/URL keşfi zaten çalışıyor/)).toBeInTheDocument();
    expect(screen.queryByText(/URL keşfi tamamlandı/)).not.toBeInTheDocument();
  });

  it("blocks controls when cached GSC and sync status could not be refreshed", () => {
    const client = setup();
    for (const key of [gscKey, syncKey]) client.getQueryCache().find({ queryKey: key })!.setState({ status: "error", error: new Error("503: unavailable") });
    show(client);
    expect(screen.getByRole("button", { name: /Inspection Batch'i Şimdi/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /URL Keşfini Şimdi/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Station Sync'i Şimdi/ })).toBeDisabled();
    expect(screen.queryByText("✅ boşta")).not.toBeInTheDocument();
  });

  it("refreshes summaries when a tags job finishes and marks failed completion", async () => {
    const client = setup();
    const job = { jobId: "tags-1", startedAt: "2026-09-15T00:00:00.000Z", countryCode: "TR", isRunning: true,
      finishedAt: null, scanned: 20, updated: 10, skipped: 9, failed: 1, lastError: "upstream timeout" };
    client.setQueryData(tagsKey, { job });
    show(client);
    await act(async () => { client.setQueryData(tagsKey, { job: { ...job, isRunning: false } }); });
    expect(await screen.findByText("HATA İLE BİTTİ")).toBeInTheDocument();
    await waitFor(() => expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["/api/admin/seo-health-stats"] }));
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["/api/admin/maintenance/scheduled-backfill/runs"] });
  });

  it("loads health through the authenticated API helper", async () => {
    const client = setup();
    client.removeQueries({ queryKey: ["/api/admin/seo-health-stats"] });
    vi.mocked(apiRequest).mockResolvedValue(new Response(JSON.stringify(health)));
    show(client);
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("GET", "/api/admin/seo-health-stats?country=TR", { signal: expect.any(AbortSignal) }));
    expect(await screen.findByText(/SEO sağlık özeti — TR/)).toBeInTheDocument();
  });
});
