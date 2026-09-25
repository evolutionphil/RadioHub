import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useEffect, type MouseEvent } from "react";
import { loadBlogContent } from "@workspace/seo-shared/blog";
import { parseBlogPath, BLOG_RETRY_LABELS } from "@workspace/seo-shared/blog-manifest";
import { renderBlogHtml } from "@workspace/seo-shared/blog-html";
import NotFound from "./not-found";

export default function BlogPage() {
  const [location, navigate] = useLocation();
  const route = parseBlogPath(location);
  const locale = route?.locale;
  const {
    data: content,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["editorial-blog", locale],
    enabled: !!locale,
    queryFn: () => loadBlogContent(locale!),
    staleTime: Infinity,
  });
  useEffect(() => {
    const href = "/blog.css?v=20260925";
    if (document.querySelector(`link[href="${href}"]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }, []);
  // Crawlable anchors also use SPA navigation: changing guide or language
  // must not tear down the existing global audio player. Modified clicks,
  // external links and native in-page table-of-contents links keep defaults.
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const anchor = (event.target as Element).closest<HTMLAnchorElement>(
      "a[href]",
    );
    const href = anchor?.getAttribute("href");
    if (
      !anchor ||
      anchor.target ||
      !href?.startsWith("/") ||
      href.startsWith("//")
    )
      return;
    event.preventDefault();
    navigate(href);
    window.scrollTo({ top: 0 });
  };
  if (!route) return <NotFound />;
  if (isError)
    return (
      <main className="radio-journal">
        <button type="button" onClick={() => void refetch()}>
          {BLOG_RETRY_LABELS[route.locale]}
        </button>
      </main>
    );
  if (!content)
    return (
      <main className="radio-journal" aria-busy="true">
        <div className="radio-journal-loading" />
      </main>
    );
  const article = content.articles.find((item) => item.id === route.id);
  return (
    <div
      onClick={onClick}
      dangerouslySetInnerHTML={{
        __html: renderBlogHtml({ locale: route.locale, content, article }),
      }}
    />
  );
}
