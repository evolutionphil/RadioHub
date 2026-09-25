import { BLOG_IDS, BLOG_LOCALES, type BlogId, type BlogLocale } from "./types";
export { BLOG_IDS, BLOG_LOCALES } from "./types";
export type { BlogId, BlogLocale } from "./types";

// Change only when editorial content changes, never on a request or catalog sync.
export const BLOG_PUBLISHED = "2026-09-25T00:00:00+02:00";
export const BLOG_UPDATED = "2026-09-25T00:00:00+02:00";
export const BLOG_REVISION = "radio-guides-2026-09-25-v1";
export const BLOG_RETRY_LABELS: Record<BlogLocale, string> = {
  en: 'Could not load this guide. Try again.', de: 'Ratgeber konnte nicht geladen werden. Erneut versuchen.',
  tr: 'Yazı yüklenemedi. Tekrar dene.', fr: 'Impossible de charger ce guide. Réessayer.',
  es: 'No se pudo cargar la guía. Reintentar.', pt: 'Não foi possível carregar o guia. Tentar novamente.',
  it: 'Impossibile caricare la guida. Riprova.', ru: 'Не удалось загрузить статью. Повторить.',
  ar: 'تعذر تحميل الدليل. حاول مرة أخرى.', he: 'לא ניתן לטעון את המדריך. נסו שוב.',
  zh: '无法加载指南，请重试。', ja: 'ガイドを読み込めませんでした。再試行してください。',
  ko: '가이드를 불러오지 못했습니다. 다시 시도하세요.', hi: 'गाइड लोड नहीं हो सकी। फिर कोशिश करें।',
};
export const BLOG_SITEMAP_PATHS = [
  "/blog",
  ...BLOG_IDS.map((id) => `/blog/${id}`),
];
export const BLOG_RELATED: Record<BlogId, readonly BlogId[]> = {
  "listen-to-radio-online": [
    "internet-radio-explained",
    "radio-app-iphone-android",
    "radio-data-usage",
  ],
  "internet-radio-explained": [
    "listen-to-radio-online",
    "radio-data-usage",
    "news-talk-radio-guide",
  ],
  "radio-app-iphone-android": [
    "radio-data-usage",
    "listen-to-radio-online",
    "internet-radio-explained",
  ],
  "radio-data-usage": [
    "radio-app-iphone-android",
    "internet-radio-explained",
    "listen-to-radio-online",
  ],
  "rock-radio-guide": [
    "blues-radio-guide",
    "80s-90s-radio-guide",
    "country-radio-guide",
  ],
  "jazz-radio-guide": [
    "blues-radio-guide",
    "listen-to-radio-online",
    "80s-90s-radio-guide",
  ],
  "blues-radio-guide": [
    "jazz-radio-guide",
    "rock-radio-guide",
    "country-radio-guide",
  ],
  "country-radio-guide": [
    "blues-radio-guide",
    "rock-radio-guide",
    "80s-90s-radio-guide",
  ],
  "news-talk-radio-guide": [
    "internet-radio-explained",
    "radio-app-iphone-android",
    "listen-to-radio-online",
  ],
  "80s-90s-radio-guide": [
    "rock-radio-guide",
    "jazz-radio-guide",
    "listen-to-radio-online",
  ],
};
export const BLOG_LABELS: Record<BlogLocale, string> = {
  en: "Radio guides",
  de: "Radio-Ratgeber",
  tr: "Radyo rehberleri",
  fr: "Guides radio",
  es: "Guías de radio",
  pt: "Guias de rádio",
  it: "Guide radio",
  ru: "Гиды о радио",
  ar: "أدلة الراديو",
  he: "מדריכי רדיו",
  zh: "广播指南",
  ja: "ラジオガイド",
  ko: "라디오 가이드",
  hi: "रेडियो गाइड",
};
export const isBlogLocale = (value: string): value is BlogLocale =>
  (BLOG_LOCALES as readonly string[]).includes(value);
export const isBlogId = (value: string): value is BlogId =>
  (BLOG_IDS as readonly string[]).includes(value);
export const isBlogPath = (path: string) =>
  path === "/blog" || path.startsWith("/blog/");
export const blogPath = (locale: BlogLocale, id?: BlogId) =>
  `/${locale}/blog${id ? `/${id}` : ""}`;
export const blogImage = (id: BlogId, width: 640 | 1200 = 1200) =>
  `/images/blog/${id}-${width}.webp`;

export const BLOG_SOURCES = [
  {
    name: "radio.net — FAQ",
    url: "https://www.radio.net/faq_mobile_iphone_en_US",
  },
  {
    name: "radio.net — Data usage",
    url: "https://radio.zendesk.com/hc/en-us/articles/226776107-Data-usage",
  },
  {
    name: "Radio.co — Internet radio",
    url: "https://www.radio.co/blog/free-internet-radio",
  },
] as const;

// URL slugs are language-independent identifiers; only the locale changes.
export function parseBlogPath(
  path: string,
): { locale: BlogLocale; id?: BlogId } | null {
  const match = path
    .split(/[?#]/)[0]
    .match(/^\/([a-z]{2})\/blog(?:\/([^/]+))?\/?$/);
  if (!match || !isBlogLocale(match[1]) || (match[2] && !isBlogId(match[2])))
    return null;
  return { locale: match[1], ...(match[2] ? { id: match[2] as BlogId } : {}) };
}
