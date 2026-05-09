import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { TooltipProvider } from "@/components/ui/tooltip";

const apiRequestMock = vi.fn();

vi.mock("@/lib/queryClient", () => ({
  apiRequest: (...args: unknown[]) => apiRequestMock(...args),
  queryClient: {
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn(),
  },
  resolveApiUrl: (p: string) => p,
  API_BASE: "",
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), toasts: [] }),
  toast: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { _id: "admin-1", email: "admin@example.com", role: "admin" },
    isAuthenticated: true,
    isLoading: false,
  }),
}));

vi.mock("@/hooks/useAdminViewPrefs", async () => {
  const ReactMod = await import("react");
  return {
    useAdminViewPrefs: (_key: string, defaults: unknown) => {
      const [prefs, setPrefs] = ReactMod.useState(defaults);
      return {
        prefs,
        setPrefs: (next: unknown) =>
          setPrefs((prev: unknown) =>
            typeof next === "function"
              ? (next as (p: unknown) => unknown)(prev)
              : next,
          ),
        clearLocal: () => {},
        reset: () => setPrefs(defaults),
        loaded: true,
      };
    },
  };
});

import AdminCountryLanguageMappings from "../src/pages/admin/AdminCountryLanguageMappings";

const AUDIT_LOG_KEY = [
  "/api/admin/country-language-mappings/cleared-overrides-log",
  { limit: 25, offset: 0 },
];

interface SeededEntry {
  id: string;
  changes: Array<{
    countryCode: string;
    countryName: string;
    previousLanguageCode: string | null;
    newLanguageCode: string | null;
  }>;
}

function buildClient(): QueryClient {
  let qc!: QueryClient;
  qc = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Infinity,
        staleTime: Infinity,
        // Refetches (e.g. refetchAuditLog) shouldn't clobber the data we
        // pre-seeded — return the cached value so the panel stays stable
        // through the full undo flow.
        queryFn: async ({ queryKey }) => {
          const existing = qc.getQueryData(queryKey);
          return existing ?? null;
        },
      },
    },
  });
  return qc;
}

function seed(qc: QueryClient, entries: SeededEntry[]) {
  qc.setQueryData(["/api/admin/available-countries"], []);
  qc.setQueryData(["/api/admin/available-languages"], []);
  qc.setQueryData(["/api/admin/country-language-mappings"], []);
  qc.setQueryData(["/api/admin/country-language-defaults"], []);
  qc.setQueryData(AUDIT_LOG_KEY, {
    entries: entries.map((e) => ({
      id: e.id,
      action: "bulk-save" as const,
      actorEmail: "admin@example.com",
      deletedCount: e.changes.length,
      changes: e.changes,
      createdAt: "2026-05-04T04:00:00.000Z",
    })),
    total: entries.length,
    limit: 25,
    offset: 0,
  });
}

function renderPage(qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <AdminCountryLanguageMappings />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("AdminCountryLanguageMappings → per-row undo confirmation dialog", () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    apiRequestMock.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as unknown as Response);
    window.sessionStorage.clear();
  });

  afterEach(() => {
    window.sessionStorage.clear();
  });

  it("reverts a single-row audit entry in one click without opening the dialog", async () => {
    const qc = buildClient();
    seed(qc, [
      {
        id: "entry-single",
        changes: [
          {
            countryCode: "TR",
            countryName: "Turkey",
            previousLanguageCode: "en",
            newLanguageCode: "tr",
          },
        ],
      },
    ]);
    renderPage(qc);

    const user = userEvent.setup();
    const btn = await screen.findByTestId("button-undo-audit-entry-single");
    await user.click(btn);

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        "POST",
        "/api/admin/country-language-mappings/bulk",
        expect.objectContaining({
          body: {
            mappings: [
              {
                countryCode: "TR",
                countryName: "Turkey",
                languageCode: "en",
              },
            ],
          },
        }),
      );
    });
    expect(screen.queryByTestId("dialog-confirm-undo-audit")).toBeNull();
  });

  it("opens the confirmation dialog for multi-row entries and only reverts after the admin confirms", async () => {
    const qc = buildClient();
    seed(qc, [
      {
        id: "entry-multi",
        changes: [
          {
            countryCode: "TR",
            countryName: "Turkey",
            previousLanguageCode: "en",
            newLanguageCode: "tr",
          },
          {
            countryCode: "DE",
            countryName: "Germany",
            previousLanguageCode: "en",
            newLanguageCode: "de",
          },
        ],
      },
    ]);
    renderPage(qc);

    const user = userEvent.setup();
    await user.click(await screen.findByTestId("button-undo-audit-entry-multi"));

    // Dialog appears and no revert request fires yet.
    expect(
      await screen.findByTestId("dialog-confirm-undo-audit"),
    ).toBeInTheDocument();
    expect(apiRequestMock).not.toHaveBeenCalledWith(
      "POST",
      "/api/admin/country-language-mappings/bulk",
      expect.anything(),
    );

    // Cancelling closes the dialog without touching the audit entry.
    await user.click(screen.getByTestId("button-cancel-undo-audit"));
    await waitFor(() => {
      expect(screen.queryByTestId("dialog-confirm-undo-audit")).toBeNull();
    });
    expect(apiRequestMock).not.toHaveBeenCalledWith(
      "POST",
      "/api/admin/country-language-mappings/bulk",
      expect.anything(),
    );

    // Re-opening and confirming runs the bulk-revert with both rows.
    const reopenBtn = screen.getByTestId("button-undo-audit-entry-multi");
    await waitFor(() => expect(reopenBtn).not.toBeDisabled());
    await user.click(reopenBtn);
    await screen.findByTestId("dialog-confirm-undo-audit");
    await user.click(screen.getByTestId("button-confirm-undo-audit"));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        "POST",
        "/api/admin/country-language-mappings/bulk",
        expect.objectContaining({
          body: {
            mappings: [
              {
                countryCode: "TR",
                countryName: "Turkey",
                languageCode: "en",
              },
              {
                countryCode: "DE",
                countryName: "Germany",
                languageCode: "en",
              },
            ],
          },
        }),
      );
    });
  });

  it("persists 'Don't ask again this session' so the next multi-row undo skips the dialog", async () => {
    const qc = buildClient();
    seed(qc, [
      {
        id: "entry-a",
        changes: [
          {
            countryCode: "TR",
            countryName: "Turkey",
            previousLanguageCode: "en",
            newLanguageCode: "tr",
          },
          {
            countryCode: "DE",
            countryName: "Germany",
            previousLanguageCode: "en",
            newLanguageCode: "de",
          },
        ],
      },
      {
        id: "entry-b",
        changes: [
          {
            countryCode: "FR",
            countryName: "France",
            previousLanguageCode: "en",
            newLanguageCode: "fr",
          },
          {
            countryCode: "IT",
            countryName: "Italy",
            previousLanguageCode: "en",
            newLanguageCode: "it",
          },
        ],
      },
    ]);
    renderPage(qc);

    const user = userEvent.setup();

    // Click the first multi-row entry, tick "Don't ask again this session",
    // then confirm. The session-storage flag must persist.
    await user.click(await screen.findByTestId("button-undo-audit-entry-a"));
    await screen.findByTestId("dialog-confirm-undo-audit");
    await user.click(screen.getByTestId("checkbox-undo-audit-skip-confirm"));
    await user.click(screen.getByTestId("button-confirm-undo-audit"));

    await waitFor(() => {
      expect(
        window.sessionStorage.getItem("admin-mappings:skipUndoConfirm"),
      ).toBe("1");
    });
    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        "POST",
        "/api/admin/country-language-mappings/bulk",
        expect.objectContaining({
          body: expect.objectContaining({
            mappings: expect.arrayContaining([
              expect.objectContaining({ countryCode: "TR" }),
            ]),
          }),
        }),
      );
    });

    apiRequestMock.mockClear();

    // The second multi-row entry now reverts in one click — no dialog.
    const btnB = screen.getByTestId("button-undo-audit-entry-b");
    await waitFor(() => expect(btnB).not.toBeDisabled());
    await user.click(btnB);

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        "POST",
        "/api/admin/country-language-mappings/bulk",
        expect.objectContaining({
          body: expect.objectContaining({
            mappings: expect.arrayContaining([
              expect.objectContaining({ countryCode: "FR" }),
            ]),
          }),
        }),
      );
    });
    expect(screen.queryByTestId("dialog-confirm-undo-audit")).toBeNull();
  });
});
