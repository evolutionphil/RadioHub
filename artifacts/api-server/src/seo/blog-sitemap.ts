import {
  BLOG_IDS,
  BLOG_LOCALES,
  BLOG_UPDATED,
  blogImage,
  blogPath,
} from "@workspace/seo-shared/blog-manifest";

/** Editorial sitemap is independent of station counts, DB or language quality
 * thresholds: every listed locale has a complete, versioned translation. */
export function buildBlogSitemap(): string {
  const origin = "https://themegaradio.com";
  const urls = BLOG_LOCALES.flatMap((locale) =>
    [undefined, ...BLOG_IDS].map((id) => {
      const alternates = BLOG_LOCALES.map(
        (lang) =>
          `<xhtml:link rel="alternate" hreflang="${lang}" href="${origin}${blogPath(lang, id)}"/>`,
      ).join("");
      return `<url><loc>${origin}${blogPath(locale, id)}</loc><lastmod>${BLOG_UPDATED}</lastmod>${alternates}<xhtml:link rel="alternate" hreflang="x-default" href="${origin}${blogPath("en", id)}"/>${id ? `<image:image><image:loc>${origin}${blogImage(id)}</image:loc></image:image>` : ""}</url>`;
    }),
  );
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${urls.join("\n")}</urlset>`;
}
