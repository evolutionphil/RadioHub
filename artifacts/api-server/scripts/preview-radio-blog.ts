/** Local-only editorial preview, no production DB, account or analytics calls.
 * node --import tsx scripts/preview-radio-blog.ts */
import express from "express";
import { fileURLToPath } from "node:url";
import {
  loadBlogContent,
  buildBlogSeo,
  buildBlogSchema,
} from "@workspace/seo-shared/blog";
import { parseBlogPath } from "@workspace/seo-shared/blog-manifest";
import { renderBlogHtml } from "@workspace/seo-shared/blog-html";
const app = express();
app.use(
  express.static(
    fileURLToPath(new URL("../../megaradio/public/", import.meta.url)),
  ),
);
app.get("/", (_req, res) => {
  res.redirect("/en/blog");
});
app.get(/.*/, async (req, res) => {
  const route = parseBlogPath(req.path);
  if (!route) {
    res.status(404).send("Editorial preview: page not found");
    return;
  }
  const content = await loadBlogContent(route.locale);
  const page = {
    locale: route.locale,
    content,
    article: content.articles.find((a) => a.id === route.id),
  };
  const seo = buildBlogSeo(page);
  const escape = (s: string) =>
    s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  res
    .type("html")
    .send(
      `<!doctype html><html lang="${route.locale}" dir="${["ar", "he"].includes(route.locale) ? "rtl" : "ltr"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(seo.title)}</title><meta name="description" content="${escape(seo.description)}"><meta name="robots" content="noindex"><link rel="stylesheet" href="/blog.css"><style>body{margin:0;background:#0e0e0e;font-family:Arial,sans-serif}</style><script type="application/ld+json">${JSON.stringify(buildBlogSchema(page)).replace(/</g, "\\u003c")}</script></head><body>${renderBlogHtml(page)}</body></html>`,
    );
});
app.listen(4179, "127.0.0.1", () =>
  console.log("Editorial preview: http://127.0.0.1:4179/en/blog"),
);
