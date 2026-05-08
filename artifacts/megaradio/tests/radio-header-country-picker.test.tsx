import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ----- Mock heavy / app-specific dependencies BEFORE importing the SUT -----

vi.mock("@assets/notification1.png", () => ({ default: "notification1.png" }));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, isAuthenticated: false, isLoading: false }),
}));

vi.mock("@/hooks/useGlobalPlayer", () => ({
  useGlobalPlayer: () => ({ playStation: vi.fn() }),
}));

vi.mock("@/hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    setLanguage: vi.fn(),
  }),
}));

vi.mock("@/hooks/useSeoRouting", () => ({
  useSeoRouting: () => ({
    getLocalizedUrl: (p: string) => p,
    cleanPath: "/",
    navigateTranslated: vi.fn(),
    currentLanguage: "en",
  }),
}));

vi.mock("@/components/ui/UserMenuDropdown", () => ({
  UserMenuDropdown: () => null,
  default: () => null,
}));

vi.mock("@/components/modals/AddYourStationModal", () => ({
  default: () => null,
}));

vi.mock("@/components/HighlightMatch", () => ({
  HighlightMatch: ({ text }: { text: string }) => <>{text}</>,
  default: ({ text }: { text: string }) => <>{text}</>,
}));

vi.mock("@/lib/utils", () => ({
  getImageUrl: (s: string) => s,
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}));

vi.mock("@/utils/slugs", () => ({
  getStationUrl: (s: { slug?: string }) => `/station/${s?.slug ?? "x"}`,
}));

vi.mock("@workspace/seo-shared/seo-config", () => ({
  getCountryCodeFromApiName: (name: string) => {
    const map: Record<string, string> = {
      Turkey: "tr",
      Germany: "de",
      France: "fr",
      Spain: "es",
    };
    return map[name] ?? "";
  },
  getLanguageForCountry: () => "en",
}));

vi.mock("@workspace/seo-shared/country-regions", () => ({
  canonicalizeCountry: (n: string) => n,
  countrySlug: (n: string) => n.toLowerCase(),
  getRegionSlugForCountry: () => "europe",
}));

vi.mock("wouter", () => ({
  Link: ({ children, ...rest }: { children: React.ReactNode }) => (
    <a {...rest}>{children}</a>
  ),
  useLocation: () => ["/", vi.fn()] as const,
}));

// Now import the SUT
import RadioHeader from "../src/components/layout/radio-header";

function makeQueryClient() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: Infinity,
        // The suite seeds every query via setQueryData, so no real fetch
        // should ever run. Install a fail-fast queryFn so TanStack Query
        // stops logging "No queryFn was passed as an option", while still
        // surfacing unexpected query execution (e.g. a query-key drift)
        // as a loud test failure rather than a silent forever-loading
        // observer.
        queryFn: ({ queryKey }) => {
          throw new Error(
            `Unexpected query execution in test for key ${JSON.stringify(queryKey)} — seed it with setQueryData or mock the hook.`
          );
        },
      },
    },
  });
  qc.setQueryData(["/api/filters/countries"], [
    "Turkey",
    "Germany",
    "France",
    "Spain",
  ]);
  qc.setQueryData(["/api/countries", "rich"], [
    { name: "Turkey", stationCount: 100 },
    { name: "Germany", stationCount: 80 },
  ]);
  qc.setQueryData(["/api/user/notifications"], {
    notifications: [],
    unreadCount: 0,
  });
  return qc;
}

function renderHeader() {
  const qc = makeQueryClient();
  const onCountryChange = vi.fn();
  const utils = render(
    <QueryClientProvider client={qc}>
      <RadioHeader onCountryChange={onCountryChange} />
    </QueryClientProvider>
  );
  return { ...utils, onCountryChange };
}

// rAF polyfill for jsdom (used by closeCountryDropdownAndRestoreFocus to
// defer focus restoration until after the portal unmounts).
beforeEach(() => {
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    cb(0);
    return 0 as unknown as number;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function getTriggers(): HTMLButtonElement[] {
  // Multiple trigger buttons exist (mobile + desktop variants for both auth
  // and unauth states). The contract under test is the ARIA semantics, so
  // we select by aria-haspopup + the shared aria-label rather than by a
  // data-* attribute that only the mobile variants happen to carry.
  const list = document.querySelectorAll<HTMLButtonElement>(
    'button[aria-haspopup="listbox"][aria-label="Select country"]'
  );
  return Array.from(list);
}

function getMobileTrigger(): HTMLButtonElement {
  const t = document.querySelector<HTMLButtonElement>(
    'button[aria-haspopup="listbox"][data-country-button]'
  );
  expect(t).not.toBeNull();
  return t!;
}

function getDesktopTrigger(): HTMLButtonElement {
  // Desktop variant has the same ARIA but lacks data-country-button.
  const triggers = getTriggers();
  const desktop = triggers.find((b) => !b.hasAttribute("data-country-button"));
  expect(desktop, "expected a desktop trigger button to be rendered").toBeTruthy();
  return desktop!;
}

function getDropdown(): HTMLElement | null {
  return screen.queryByTestId("country-dropdown-unauthenticated");
}

function getSearchInput(): HTMLInputElement {
  const dropdown = getDropdown();
  expect(dropdown).not.toBeNull();
  return within(dropdown!).getByRole("combobox") as HTMLInputElement;
}

/**
 * Open the dropdown via a click on the trigger (which is what both Enter and
 * Space activate at the HTML level for <button>). Then make sure focus is
 * actually on the search input — autoFocus + portal + jsdom can race in a
 * way that real browsers don't, so we explicitly normalize focus here so
 * subsequent keyboard events go to the input handler we want to test.
 */
async function openAndFocus(user: ReturnType<typeof userEvent.setup>) {
  const trigger = getMobileTrigger();
  await user.click(trigger);
  const search = getSearchInput();
  if (document.activeElement !== search) {
    act(() => search.focus());
  }
  expect(search).toHaveFocus();
  return { trigger, search };
}

describe("RadioHeader country picker keyboard support", () => {
  it("exposes aria-haspopup=listbox on every trigger and aria-expanded reflects the open state on both mobile and desktop variants", async () => {
    renderHeader();

    const triggers = getTriggers();
    // We expect at least the mobile + desktop unauth variants to render.
    expect(triggers.length).toBeGreaterThanOrEqual(2);
    triggers.forEach((b) => {
      expect(b).toHaveAttribute("aria-haspopup", "listbox");
      expect(b).toHaveAttribute("aria-expanded", "false");
    });

    const mobile = getMobileTrigger();
    const desktop = getDesktopTrigger();
    expect(mobile).not.toBe(desktop);

    fireEvent.click(mobile);

    // Both variants must reflect the new state — they share state via the
    // same isCountryDropdownOpen flag.
    expect(mobile).toHaveAttribute("aria-expanded", "true");
    expect(desktop).toHaveAttribute("aria-expanded", "true");
    expect(getDropdown()).not.toBeNull();
  });

  it("Pressing Enter on a focused trigger opens the dropdown (no manual click)", async () => {
    const user = userEvent.setup();
    renderHeader();

    const trigger = getMobileTrigger();
    trigger.focus();
    expect(trigger).toHaveFocus();

    // Real keyboard-only activation. <button> elements activate on Enter
    // natively — if that contract regresses (e.g. trigger gets re-rolled
    // as a non-button div), this test will fail.
    await user.keyboard("{Enter}");

    expect(getDropdown()).not.toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("Pressing Space on a focused trigger opens the dropdown and moves focus to the search input (no manual click)", async () => {
    const user = userEvent.setup();
    renderHeader();

    const trigger = getMobileTrigger();
    trigger.focus();
    expect(trigger).toHaveFocus();

    await user.keyboard(" ");

    expect(getDropdown()).not.toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(getSearchInput()).toHaveFocus();
  });

  it("Opening the dropdown moves focus to the country search input", async () => {
    const user = userEvent.setup();
    renderHeader();

    const trigger = getMobileTrigger();
    trigger.focus();
    await user.keyboard("{Enter}");

    const search = getSearchInput();
    // The combobox carries autoFocus; jsdom should honor it during commit.
    expect(search).toHaveFocus();
  });

  it("Escape with an empty query closes the dropdown and restores focus to the trigger", async () => {
    const user = userEvent.setup();
    renderHeader();

    const { trigger, search } = await openAndFocus(user);
    expect(search.value).toBe("");

    await user.keyboard("{Escape}");

    expect(getDropdown()).toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });

  it("Escape with a non-empty query clears the query but keeps the dropdown open", async () => {
    const user = userEvent.setup();
    renderHeader();

    const { search } = await openAndFocus(user);
    await user.type(search, "ger");
    expect(search.value).toBe("ger");

    await user.keyboard("{Escape}");

    // Still open, query cleared
    expect(getDropdown()).not.toBeNull();
    expect(getSearchInput().value).toBe("");
  });

  it("Selecting a country with Enter closes the dropdown and restores focus to the trigger", async () => {
    const user = userEvent.setup();
    const { onCountryChange } = renderHeader();

    const { trigger } = await openAndFocus(user);

    // The first item is the synthetic "global" entry; the second is the
    // first real country ("Turkey" given our mocked data).
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");

    expect(getDropdown()).toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
    expect(onCountryChange).toHaveBeenCalled();
    expect(onCountryChange.mock.calls.at(-1)?.[0]).toBe("Turkey");
  });

  it("Tab and Shift+Tab inside the open dropdown do not move focus away from the search input", async () => {
    const user = userEvent.setup();
    renderHeader();

    const { search } = await openAndFocus(user);

    await user.tab();
    expect(search).toHaveFocus();
    expect(getDropdown()).not.toBeNull();

    await user.tab({ shift: true });
    expect(search).toHaveFocus();
    expect(getDropdown()).not.toBeNull();
  });
});
