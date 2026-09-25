import type {
  BlogLocaleContent,
  BlogLocale,
  BlogArticle,
  BlogId,
} from "./types";
import {
  BLOG_LOCALES,
  BLOG_PUBLISHED,
  BLOG_UPDATED,
  BLOG_LABELS,
  blogPath,
  blogImage,
} from "./manifest";
import type { SeoMetaTags } from "../seo-config";
export type { BlogArticle, BlogLocaleContent } from "./types";

// Explicit dynamic imports allow Vite to emit 14 lazy chunks instead of adding
// the entire multilingual library to the player / homepage JavaScript bundle.
const loaders = {
  en: () => import("./locales/en.json"),
  de: () => import("./locales/de.json"),
  tr: () => import("./locales/tr.json"),
  fr: () => import("./locales/fr.json"),
  es: () => import("./locales/es.json"),
  pt: () => import("./locales/pt.json"),
  it: () => import("./locales/it.json"),
  ru: () => import("./locales/ru.json"),
  ar: () => import("./locales/ar.json"),
  he: () => import("./locales/he.json"),
  zh: () => import("./locales/zh.json"),
  ja: () => import("./locales/ja.json"),
  ko: () => import("./locales/ko.json"),
  hi: () => import("./locales/hi.json"),
};
export async function loadBlogContent(
  locale: BlogLocale,
): Promise<BlogLocaleContent> {
  return (await loaders[locale]()).default as BlogLocaleContent;
}
export interface BlogPageData {
  locale: BlogLocale;
  content: BlogLocaleContent;
  article?: BlogArticle;
}
const origin = "https://themegaradio.com";
export function buildBlogSeo({
  locale,
  content,
  article,
}: BlogPageData): SeoMetaTags {
  const title = article?.seoTitle || `${BLOG_LABELS[locale]} | MegaRadio`;
  const description = article?.description || content.ui.description;
  const canonical = origin + blogPath(locale, article?.id);
  const image = origin + blogImage(article?.id || "listen-to-radio-online");
  const ogLocales: Record<BlogLocale, string> = {
    en: "en_US",
    de: "de_DE",
    tr: "tr_TR",
    fr: "fr_FR",
    es: "es_ES",
    pt: "pt_PT",
    it: "it_IT",
    ru: "ru_RU",
    ar: "ar_AR",
    he: "he_IL",
    zh: "zh_CN",
    ja: "ja_JP",
    ko: "ko_KR",
    hi: "hi_IN",
  };
  return {
    title,
    description,
    canonical,
    language: locale,
    domain: "themegaradio.com",
    robots: "index, follow, max-image-preview:large",
    noIndex: false,
    ogTitle: title,
    ogDescription: description,
    ogUrl: canonical,
    ogType: article ? "article" : "website",
    ogImage: image,
    ogLocale: ogLocales[locale],
    twitterTitle: title,
    twitterDescription: description,
    twitterImage: image,
    hreflangs: [
      ...BLOG_LOCALES.map((lang) => ({
        lang,
        hreflang: lang,
        url: origin + blogPath(lang, article?.id),
      })),
      {
        lang: "x-default",
        hreflang: "x-default",
        url: origin + blogPath("en", article?.id),
      },
    ],
  };
}
export function blogBreadcrumbs({ locale, content, article }: BlogPageData) {
  return [
    { name: content.ui.home, path: `/${locale}` },
    { name: BLOG_LABELS[locale], path: blogPath(locale) },
    ...(article
      ? [{ name: article.title, path: blogPath(locale, article.id) }]
      : []),
  ];
}
export function buildBlogSchema(page: BlogPageData): object[] {
  const { locale, article, content } = page;
  const url = origin + blogPath(locale, article?.id);
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: blogBreadcrumbs(page).map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: origin + item.path,
    })),
  };
  if (!article)
    return [
      breadcrumb,
      {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "@id": url,
        url,
        name: content.ui.title,
        description: content.ui.description,
        inLanguage: locale,
        mainEntity: {
          "@type": "ItemList",
          itemListElement: content.articles.map((entry, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: entry.title,
            url: origin + blogPath(locale, entry.id),
          })),
        },
      },
    ];
  return [
    breadcrumb,
    {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      "@id": `${url}#article`,
      url,
      mainEntityOfPage: { "@type": "WebPage", "@id": url },
      headline: article.title,
      description: article.description,
      inLanguage: locale,
      datePublished: BLOG_PUBLISHED,
      dateModified: BLOG_UPDATED,
      image: {
        "@type": "ImageObject",
        url: origin + blogImage(article.id),
        width: 1200,
        height: 630,
        caption: article.imageAlt,
      },
      author: {
        "@type": "Organization",
        name: content.ui.author,
        url: `${origin}/${locale}/blog`,
      },
      publisher: {
        "@type": "Organization",
        name: "MegaRadio",
        url: origin,
        logo: {
          "@type": "ImageObject",
          url: `${origin}/favicon.png`,
          width: 64,
          height: 64,
        },
      },
      keywords: [article.primaryKeyword, ...article.secondaryKeywords],
    },
  ];
}
