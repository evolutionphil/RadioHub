import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ----- Mock heavy / app-specific dependencies BEFORE importing the SUT -----

vi.mock("@assets/notification1.png", () => ({ default: "notification1.png" }));

type AuthState = {
  user: { id?: string; username?: string; fullName?: string; avatar?: string } | null;
  isAuthenticated: boolean;
  isLoading: boolean;
};
const authState: { current: AuthState } = {
  current: {
    user: { id: "u1", username: "ada", fullName: "Ada Lovelace" },
    isAuthenticated: true,
    isLoading: false,
  },
};

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => authState.current,
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
  getCountryCodeFromApiName: () => "",
  getLanguageForCountry: () => "en",
}));

vi.mock("@workspace/seo-shared/country-regions", () => ({
  canonicalizeCountry: (n: string) => n,
  countrySlug: (n: string) => n.toLowerCase(),
  getRegionSlugForCountry: () => "europe",
}));

vi.mock("wouter", () => ({
  Link: ({ children, href, ...rest }: { children: React.ReactNode; href?: string }) => (
    <a href={href ?? "#"} {...rest}>
      {children}
    </a>
  ),
  useLocation: () => ["/", vi.fn()] as const,
}));

import RadioHeader from "../src/components/layout/radio-header";

function makeQueryClient(notifications: any[] = []) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: Infinity,
        queryFn: ({ queryKey }) => {
          throw new Error(
            `Unexpected query execution in test for key ${JSON.stringify(queryKey)} — seed it with setQueryData or mock the hook.`
          );
        },
      },
    },
  });
  qc.setQueryData(["/api/filters/countries"], ["Turkey", "Germany"]);
  qc.setQueryData(["/api/countries", "rich"], [{ name: "Turkey", stationCount: 100 }]);
  qc.setQueryData(["/api/user/notifications"], {
    notifications,
    unreadCount: notifications.length,
  });
  return qc;
}

function renderHeader(notifications: any[] = []) {
  const qc = makeQueryClient(notifications);
  return render(
    <QueryClientProvider client={qc}>
      <RadioHeader />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    cb(0);
    return 0 as unknown as number;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// The notification bell + mobile profile triggers each render twice (one is
// hidden on mobile, the other on desktop). jsdom doesn't honor CSS, so all
// of them are present in the DOM. We pick the mobile testid explicitly.
function getNotificationTrigger(): HTMLButtonElement {
  return screen.getByTestId("button-notifications-mobile") as HTMLButtonElement;
}

function getMobileProfileTrigger(): HTMLButtonElement {
  return screen.getByTestId("button-mobile-profile") as HTMLButtonElement;
}

function getNotificationDropdown(): HTMLElement | null {
  return screen.queryByTestId("notification-dropdown");
}

function getMobileProfileDropdown(): HTMLElement | null {
  return screen.queryByTestId("mobile-profile-dropdown");
}

const SAMPLE_NOTIFICATION = {
  _id: "n1",
  type: "new_station",
  title: "New Station",
  data: { stationSlug: "radio-one" },
  read: false,
};

describe("RadioHeader notifications bell — keyboard support", () => {
  it("trigger exposes aria-haspopup=dialog and aria-expanded reflects open state", () => {
    renderHeader();
    const trigger = getNotificationTrigger();
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(getNotificationDropdown()).not.toBeNull();
  });

  it("Enter on a focused trigger opens the dropdown", async () => {
    const user = userEvent.setup();
    renderHeader();
    const trigger = getNotificationTrigger();
    trigger.focus();
    expect(trigger).toHaveFocus();

    await user.keyboard("{Enter}");

    expect(getNotificationDropdown()).not.toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("Space on a focused trigger opens the dropdown", async () => {
    const user = userEvent.setup();
    renderHeader();
    const trigger = getNotificationTrigger();
    trigger.focus();

    await user.keyboard(" ");

    expect(getNotificationDropdown()).not.toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("opening moves focus to the first notification item when items exist", () => {
    renderHeader([SAMPLE_NOTIFICATION]);
    const trigger = getNotificationTrigger();
    fireEvent.click(trigger);

    const item = screen.getByTestId("notification-item-0");
    expect(item).toHaveFocus();
  });

  it("opening with an empty list focuses the dialog root so Escape/Tab still work", () => {
    renderHeader([]);
    const trigger = getNotificationTrigger();
    fireEvent.click(trigger);

    const dropdown = getNotificationDropdown();
    expect(dropdown).not.toBeNull();
    expect(dropdown).toHaveFocus();
  });

  it("Tab and Shift+Tab inside the open dropdown stay trapped on the only focusable item", async () => {
    const user = userEvent.setup();
    renderHeader([SAMPLE_NOTIFICATION]);
    fireEvent.click(getNotificationTrigger());
    const item = screen.getByTestId("notification-item-0");
    expect(item).toHaveFocus();

    await user.tab();
    expect(getNotificationDropdown()).not.toBeNull();
    expect(item).toHaveFocus();

    await user.tab({ shift: true });
    expect(getNotificationDropdown()).not.toBeNull();
    expect(item).toHaveFocus();
  });

  it("Escape closes the dropdown and restores focus to the originating trigger", async () => {
    const user = userEvent.setup();
    renderHeader([SAMPLE_NOTIFICATION]);
    const trigger = getNotificationTrigger();
    fireEvent.click(trigger);
    expect(getNotificationDropdown()).not.toBeNull();

    await user.keyboard("{Escape}");

    expect(getNotificationDropdown()).toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });
});

describe("RadioHeader mobile profile menu — keyboard support", () => {
  it("trigger exposes aria-haspopup=menu and aria-expanded reflects open state", () => {
    renderHeader();
    const trigger = getMobileProfileTrigger();
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(getMobileProfileDropdown()).not.toBeNull();
  });

  it("Enter on a focused trigger opens the dropdown", async () => {
    const user = userEvent.setup();
    renderHeader();
    const trigger = getMobileProfileTrigger();
    trigger.focus();

    await user.keyboard("{Enter}");

    expect(getMobileProfileDropdown()).not.toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("Space on a focused trigger opens the dropdown", async () => {
    const user = userEvent.setup();
    renderHeader();
    const trigger = getMobileProfileTrigger();
    trigger.focus();

    await user.keyboard(" ");

    expect(getMobileProfileDropdown()).not.toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("opening moves focus to the first menu item", () => {
    renderHeader();
    fireEvent.click(getMobileProfileTrigger());

    const dropdown = getMobileProfileDropdown();
    expect(dropdown).not.toBeNull();
    const firstFocusable = dropdown!.querySelector<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    expect(firstFocusable).not.toBeNull();
    expect(firstFocusable).toHaveFocus();
  });

  it("Tab from the last item wraps back to the first focusable inside the menu", async () => {
    const user = userEvent.setup();
    renderHeader();
    fireEvent.click(getMobileProfileTrigger());

    const dropdown = getMobileProfileDropdown()!;
    const focusables = Array.from(
      dropdown.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );
    expect(focusables.length).toBeGreaterThan(1);

    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    act(() => last.focus());
    expect(last).toHaveFocus();

    await user.tab();
    expect(first).toHaveFocus();
    expect(getMobileProfileDropdown()).not.toBeNull();
  });

  it("Shift+Tab from the first item wraps to the last focusable inside the menu", async () => {
    const user = userEvent.setup();
    renderHeader();
    fireEvent.click(getMobileProfileTrigger());

    const dropdown = getMobileProfileDropdown()!;
    const focusables = Array.from(
      dropdown.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    expect(first).toHaveFocus();

    await user.tab({ shift: true });
    expect(last).toHaveFocus();
    expect(getMobileProfileDropdown()).not.toBeNull();
  });

  it("Escape closes the dropdown and restores focus to the trigger", async () => {
    const user = userEvent.setup();
    renderHeader();
    const trigger = getMobileProfileTrigger();
    fireEvent.click(trigger);
    expect(getMobileProfileDropdown()).not.toBeNull();

    await user.keyboard("{Escape}");

    expect(getMobileProfileDropdown()).toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });
});
