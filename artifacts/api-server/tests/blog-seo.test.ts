import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import sharp from "sharp";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import {
  BLOG_IDS,
  BLOG_LOCALES,
  blogImage,
  blogPath,
  parseBlogPath,
} from "@workspace/seo-shared/blog-manifest";
import {
  loadBlogContent,
  buildBlogSeo,
  buildBlogSchema,
} from "@workspace/seo-shared/blog";
import { renderBlogHtml } from "@workspace/seo-shared/blog-html";
import { getLanguageFromPath } from "@workspace/seo-shared/seo-config";
import {
  translateUrl,
  reverseTranslateUrl,
  normalizeUrlForLanguage,
} from "@workspace/seo-shared/url-translations";
import { buildLocalizedUrl } from "../src/seo/url-helpers";
import { buildBlogSitemap } from "../src/seo/blog-sitemap";

for (const locale of BLOG_LOCALES)
  test(`complete native blog content + SEO contract: ${locale}`, async () => {
    const content = await loadBlogContent(locale);
    assert.deepEqual(
      content.articles.map((a) => a.id),
      [...BLOG_IDS],
    );
    assert.equal(
      Object.values(content.ui).filter(
        (v) => typeof v !== "string" || !v.trim(),
      ).length,
      0,
    );
    assert.equal(new Set(content.articles.map((a) => a.seoTitle)).size, 10);
    assert.equal(new Set(content.articles.map((a) => a.description)).size, 10);
    const english = locale === "en" ? null : await loadBlogContent("en");
    for (const article of content.articles) {
      const page = { locale, content, article };
      assert.ok(
        article.title.length >= 8 && article.seoTitle.length <= 70,
        article.id,
      );
      assert.ok(
        article.description.length >= 55 && article.description.length <= 175,
        `${article.id} description`,
      );
      assert.ok(article.imageAlt.length >= 12);
      assert.ok(
        article.sections.length >= 4 &&
          article.sections.every((s) => s.heading && s.paragraphs.length),
      );
      assert.ok(article.sections.some((s) => s.items && s.items.length >= 3));
      assert.ok(article.faq.length >= 2 && article.links.length >= 3);
      const prose = [
        article.intro,
        ...article.sections.flatMap((s) => [
          ...s.paragraphs,
          ...(s.items || []),
        ]),
        ...article.faq.flatMap((f) => [f.question, f.answer]),
      ].join(" ");
      assert.ok(
        prose.length >= (["ja", "zh", "ko"].includes(locale) ? 700 : 1400),
        `${article.id} substantive prose`,
      );
      if (english)
        assert.notEqual(
          article.intro,
          english.articles.find((a) => a.id === article.id)?.intro,
        );
      const seo = buildBlogSeo(page);
      assert.equal(
        seo.canonical,
        `https://themegaradio.com${blogPath(locale, article.id)}`,
      );
      assert.equal(seo.hreflangs?.length, 15);
      assert.equal(
        seo.hreflangs?.find((h) => h.hreflang === locale)?.url,
        seo.canonical,
      );
      assert.equal(seo.noIndex, false);
      assert.equal(seo.ogType, "article");
      const schema = buildBlogSchema(page) as any[];
      assert.equal(schema[1]["@type"], "BlogPosting");
      assert.equal(schema[1].inLanguage, locale);
      assert.equal(schema[1].headline, article.title);
      assert.equal(schema[1].description, article.description);
      assert.equal(schema[1].image.caption, article.imageAlt);
      const html = renderBlogHtml(page);
      assert.equal((html.match(/<h1>/g) || []).length, 1);
      assert.equal(
        (html.match(/<section id="section-/g) || []).length,
        article.sections.length,
      );
      assert.ok(
        html.includes(`dir="${["ar", "he"].includes(locale) ? "rtl" : "ltr"}"`),
      );
      assert.ok(
        html.includes('fetchpriority="high"') && html.includes("srcset="),
      );
      const path = blogPath(locale, article.id);
      const clean = `/blog/${article.id}`;
      assert.equal(getLanguageFromPath(path).language, locale);
      assert.equal(translateUrl(clean, locale), clean);
      assert.equal(reverseTranslateUrl(clean, locale), clean);
      assert.equal(normalizeUrlForLanguage(path, locale).normalized, path);
      assert.equal(
        buildLocalizedUrl(
          clean,
          locale,
          undefined,
          new Map([[`${locale}:blog`, "do-not-translate"]]),
        ),
        path,
      );
    }
    assert.equal(
      (
        renderBlogHtml({ locale, content }).match(
          /class="radio-journal-card"/g,
        ) || []
      ).length,
      10,
    );
  });

test("invalid or unsupported editorial routes never silently become the blog index", () => {
  for (const path of [
    "/de/blog/missing",
    "/en/blog/radio-data-usage/extra",
    "/nl/blog",
    "/en/blog/%3Cscript%3E",
  ])
    assert.equal(parseBlogPath(path), null);
});

test("editorial sitemap: 140 articles + 14 indexes, reciprocal 14-language alternates, original images", () => {
  const xml = buildBlogSitemap();
  assert.equal(XMLValidator.validate(xml), true);
  const entries = new XMLParser({ ignoreAttributes: false }).parse(xml).urlset
    .url;
  assert.equal(entries.length, 154);
  assert.equal(new Set(entries.map((entry: any) => entry.loc)).size, 154);
  let images = 0;
  for (const entry of entries) {
    assert.equal(entry["xhtml:link"].length, 15);
    assert.ok(
      entry["xhtml:link"].some((alt: any) => alt["@_href"] === entry.loc),
    );
    assert.ok(parseBlogPath(new URL(entry.loc).pathname));
    if (entry["image:image"]) {
      images++;
      assert.match(entry["image:image"]["image:loc"], /-1200.webp$/);
    }
  }
  assert.equal(images, 140);
});

test("topic images exist, have explicit correct dimensions, and stay lightweight", async () => {
  for (const id of BLOG_IDS)
    for (const width of [640, 1200] as const) {
      const file = new URL(
        `../../megaradio/public${blogImage(id, width)}`,
        import.meta.url,
      );
      const data = await readFile(file);
      const metadata = await sharp(data).metadata();
      assert.equal(metadata.width, width);
      assert.equal(metadata.height, width === 640 ? 336 : 630);
      assert.ok((await stat(file)).size < 45_000, id);
    }
});

test("untrusted text cannot become executable editorial HTML", async () => {
  const content = structuredClone(await loadBlogContent("en"));
  content.articles[0].title = "<img src=x onerror=alert(1)>";
  content.articles[0].imageAlt = '" onload="alert(1)';
  const html = renderBlogHtml({
    locale: "en",
    content,
    article: content.articles[0],
  });
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
  assert.ok(!html.includes('alt="" onload='));
});

// Real renderer entrypoint: every article works without station DB access,
// regardless of preference cookies, and returns the same visible/schema text.
mock.module("../src/data/postgres-localization-store", {
  namedExports: {
    pgLocalization: () => {
      throw new Error("Blog must not need DB");
    },
  },
});
mock.module("../src/data/postgres-content-store", {
  namedExports: { pgSeoMetadata: async () => null },
});
mock.module("../src/performance-cache", {
  namedExports: {
    performanceCache: { getPageData: () => null, getStats: () => ({}) },
    PerformanceCache: class {},
    deepFreeze: <T>(v: T) => v,
  },
});
test("SSR entrypoint renders all 140 articles with matching metadata and rejects missing URLs", async () => {
  const { SeoRenderer } = await import("../src/seo-renderer");
  const renderer = new SeoRenderer();
  for (const locale of BLOG_LOCALES)
    for (const id of BLOG_IDS) {
      const result = await renderer.renderStaticPage(
        blogPath(locale, id),
        "https://themegaradio.com",
        locale === "en" ? "tr" : "en",
      );
      assert.equal(result.language, locale);
      assert.equal(result.pageData.pageType, "blog");
      const html = renderer.generateHtmlBody({
        pageType: "blog",
        language: locale,
        translations: {},
        additionalData: result.pageData.additionalData,
      });
      const head = renderer.generateHtmlHead(
        result.seoTags,
        locale,
        {},
        result.cleanPath,
        undefined,
        undefined,
        result.pageData,
      );
      assert.ok(html.includes("<h1>"));
      assert.ok(head.includes("BlogPosting"));
      assert.ok(head.includes("/blog.css"));
      assert.equal(
        result.seoTags?.canonical,
        `https://themegaradio.com/${locale}/blog/${id}`,
      );
      assert.equal(result.pageData.notFound, false);
    }
  const missing = await renderer.renderStaticPage("/de/blog/missing");
  assert.equal(missing.pageData.httpNotFound, true);
  assert.equal(missing.seoTags.noIndex, true);
});
