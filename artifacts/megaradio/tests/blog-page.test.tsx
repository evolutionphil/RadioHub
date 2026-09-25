import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import BlogPage from "../src/pages/blog";
import { BLOG_LOCALES } from "@workspace/seo-shared/blog-manifest";
import { loadBlogContent } from "@workspace/seo-shared/blog";

vi.mock("../src/pages/not-found", () => ({
  default: () => <div>Missing editorial page</div>,
}));
let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});
function mount(path: string) {
  window.history.replaceState({}, "", path);
  return render(
    <QueryClientProvider client={client}>
      <audio data-testid="existing-player" />
      <BlogPage />
    </QueryClientProvider>,
  );
}
for (const locale of BLOG_LOCALES)
  it(`renders complete ${locale} prose, locale links and article image`, async () => {
    const content = await loadBlogContent(locale);
    const article = content.articles.find((a) => a.id === "radio-data-usage")!;
    const view = mount(`/${locale}/blog/radio-data-usage`);
    expect(
      await view.findByRole("heading", { level: 1, name: article.title }),
    ).toBeVisible();
    expect(view.getByText(article.sections[0].paragraphs[0])).toBeVisible();
    expect(view.getByAltText(article.imageAlt)).toHaveAttribute(
      "width",
      "1200",
    );
    expect(view.container.querySelector("main")).toHaveAttribute(
      "dir",
      ["ar", "he"].includes(locale) ? "rtl" : "ltr",
    );
    expect(
      view.container.querySelectorAll(".radio-journal-languages a"),
    ).toHaveLength(14);
  });
it("guide and language changes use SPA navigation and preserve the existing player element", async () => {
  const view = mount("/en/blog/radio-data-usage");
  await view.findByRole("heading", { level: 1, name: /data/i });
  const player = view.getByTestId("existing-player");
  fireEvent.click(
    view.container.querySelector('a[href="/tr/blog/radio-data-usage"]')!,
  );
  await waitFor(() =>
    expect(window.location.pathname).toBe("/tr/blog/radio-data-usage"),
  );
  const tr = await loadBlogContent("tr");
  await view.findByRole("heading", {
    level: 1,
    name: tr.articles.find((a) => a.id === "radio-data-usage")!.title,
  });
  expect(view.getByTestId("existing-player")).toBe(player);
  expect(
    client
      .getQueryCache()
      .getAll()
      .map((q) => q.queryKey[1])
      .sort(),
  ).toEqual(["en", "tr"]);
});
it("modified clicks and table-of-contents anchors are not hijacked", async () => {
  const view = mount("/en/blog/radio-data-usage");
  await view.findByRole("heading", { level: 1, name: /data/i });
  // Inspect after the React root handler, then prevent JSDOM's unsupported
  // document navigation. This does not suppress or alter application errors.
  const observedDefaults: boolean[] = [];
  const nativeNavigation = (event: MouseEvent) => {
    observedDefaults.push(event.defaultPrevented);
    event.preventDefault();
  };
  document.addEventListener('click', nativeNavigation);
  fireEvent.click(
    view.container.querySelector('a[href="/tr/blog/radio-data-usage"]')!,
    { ctrlKey: true },
  );
  expect(window.location.pathname).toBe("/en/blog/radio-data-usage");
  const toc = view.container.querySelector('a[href="#section-1"]')!;
  const click = new MouseEvent("click", { bubbles: true, cancelable: true });
  toc.dispatchEvent(click);
  document.removeEventListener('click', nativeNavigation);
  expect(observedDefaults).toEqual([false, false]);
});
it("unknown guide and unavailable locale show a real not-found view, not duplicate index content", async () => {
  const view = mount("/nl/blog");
  expect(view.getByText("Missing editorial page")).toBeVisible();
  expect(view.container.querySelector(".radio-journal-card")).toBeNull();
});
