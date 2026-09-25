/** Editorial content is loaded per locale, not included in the application shell. */
export const BLOG_LOCALES = [
  "en",
  "es",
  "fr",
  "de",
  "pt",
  "it",
  "ru",
  "ar",
  "zh",
  "tr",
  "ja",
  "ko",
  "hi",
  "he",
] as const;
export type BlogLocale = (typeof BLOG_LOCALES)[number];
export const BLOG_IDS = [
  "listen-to-radio-online",
  "internet-radio-explained",
  "radio-app-iphone-android",
  "radio-data-usage",
  "rock-radio-guide",
  "jazz-radio-guide",
  "blues-radio-guide",
  "country-radio-guide",
  "news-talk-radio-guide",
  "80s-90s-radio-guide",
] as const;
export type BlogId = (typeof BLOG_IDS)[number];
export interface BlogArticle {
  id: BlogId;
  title: string;
  seoTitle: string;
  description: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  imageAlt: string;
  intro: string;
  sections: Array<{ heading: string; paragraphs: string[]; items?: string[] }>;
  faq: Array<{ question: string; answer: string }>;
  links: Array<{
    route:
      | "home"
      | "genres"
      | "regions"
      | "applications"
      | "search"
      | `genre:${string}`;
    label: string;
  }>;
}
export interface BlogUi {
  title: string;
  description: string;
  home: string;
  read: string;
  contents: string;
  related: string;
  sources: string;
  questions: string;
  explore: string;
  author: string;
  editorialNote: string;
  updated: string;
  language: string;
}
export interface BlogLocaleContent {
  ui: BlogUi;
  articles: BlogArticle[];
}
