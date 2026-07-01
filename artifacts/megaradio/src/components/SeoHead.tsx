import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { useTranslation } from '@/hooks/useTranslation';
import { generateSeoTags, getLanguageFromPath } from '@workspace/seo-shared/seo-config';
import { buildGenreSeo } from '@workspace/seo-shared/genre-seo-templates';
import { buildSearchSeo } from '@workspace/seo-shared/search-seo-templates';
import { buildLegalSeo } from '@workspace/seo-shared/legal-seo-templates';
import { buildStaticPageSeo } from '@workspace/seo-shared/static-page-seo-templates';
import { useQuery } from '@tanstack/react-query';

interface SeoHeadProps {
  stationData?: {
    name: string;
    slug: string;
    favicon?: string;
    descriptions?: Record<string, string>;
    country?: string;
    countryCode?: string;
    language?: string;
    tags?: string;
    bitrate?: number;
    votes?: number;
  } | null;
  pageType?: 'home' | 'station' | 'genres' | 'stations' | 'users' | 'about' | 'contact' | 'applications' | 'search' | 'faq' | 'terms' | 'privacy';
  /**
   * Genre detail name (e.g. "Pop", "Rock"). When provided alongside `pageType="genres"`,
   * the SeoHead overrides the generic genres-listing meta tags with a fully localized
   * genre-detail title/description (matches the SSR output from server/seo-renderer.ts).
   * Without this, React hydration would replace the SSR-localized meta with English/generic
   * placeholders, causing Google WRS to record the wrong meta after JS render.
   */
  genreName?: string;
}

export function SeoHead({ stationData, pageType = 'home', genreName }: SeoHeadProps) {
  const [location] = useLocation();
  const { language } = useTranslation();

  // Get translations for SEO
  // CRITICAL FIX: Use server-preloaded translations as initialData so the correct language
  // title is set IMMEDIATELY on first render — no more race condition where Flowalive/bots
  // capture the English placeholder title before the API call resolves.
  const preloadedForThisLang =
    typeof window !== 'undefined' &&
    window.__INITIAL_LANGUAGE__ === language &&
    window.__INITIAL_TRANSLATIONS__ &&
    Object.keys(window.__INITIAL_TRANSLATIONS__).length > 0
      ? window.__INITIAL_TRANSLATIONS__
      : undefined;

  const { data: translations } = useQuery<Record<string, string>>({
    queryKey: ["/api/translations", language],
    staleTime: 5 * 60 * 1000,
    initialData: preloadedForThisLang,
    initialDataUpdatedAt: preloadedForThisLang ? Date.now() : undefined,
  });

  useEffect(() => {
    // Update HTML lang attribute
    document.documentElement.lang = language;

    // Use translations object directly - it's already in the correct format
    const translationMap: Record<string, string> = translations || {};

    // Get current path info
    const { cleanPath } = getLanguageFromPath(location);
    const currentDomain = window.location.origin;

    // Generate SEO tags - pass original location as canonical to prevent country code → language code conversion
    const seoTags = generateSeoTags(pageType, language, translationMap, cleanPath, currentDomain, stationData, location);

    // Genre detail override: keeps client hydration aligned with server SSR.
    // generateSeoTags returns generic genres-listing meta when called from a genre detail
    // page (it doesn't know about `genreName`), so React would otherwise overwrite the
    // SSR-localized title/description with generic English/generic listing meta after mount.
    if (pageType === 'genres' && genreName) {
      const genreSeo = buildGenreSeo(genreName, language, translationMap);
      seoTags.title = genreSeo.title;
      seoTags.description = genreSeo.description;
      seoTags.ogTitle = genreSeo.title;
      seoTags.ogDescription = genreSeo.description;
      seoTags.twitterTitle = genreSeo.title;
      seoTags.twitterDescription = genreSeo.description;
    }

    // Search override: keeps client hydration aligned with server SSR for the
    // search results page. seo-config's static `search` template only covers DB
    // translation keys, so non-top-15 languages without DB strings would fall
    // back to the SAME English title and description on every /xx/search page —
    // the same duplicate-content trap regions and genres had before they were
    // localised. buildSearchSeo emits the per-language template when DB keys
    // are missing in the requested language.
    if (pageType === 'search') {
      const searchSeo = buildSearchSeo(language, translationMap);
      seoTags.title = searchSeo.title;
      seoTags.description = searchSeo.description;
      seoTags.ogTitle = searchSeo.title;
      seoTags.ogDescription = searchSeo.description;
      seoTags.twitterTitle = searchSeo.title;
      seoTags.twitterDescription = searchSeo.description;
    }

    // Legal pages override: keeps client hydration aligned with server SSR for
    // /xx/terms-and-conditions and /xx/privacy-policy. generateSeoTags emits
    // generic English/static legal meta, so React would otherwise overwrite
    // the SSR-localized title/description with hard-coded English copy on
    // mount — the same trap regions/genres/search had before they were
    // localised. buildLegalSeo emits the per-language template when DB keys
    // are missing in the requested language.
    if (pageType === 'terms' || pageType === 'privacy') {
      const legalSeo = buildLegalSeo(pageType, language, translationMap);
      seoTags.title = legalSeo.title;
      seoTags.description = legalSeo.description;
      seoTags.ogTitle = legalSeo.title;
      seoTags.ogDescription = legalSeo.description;
      seoTags.twitterTitle = legalSeo.title;
      seoTags.twitterDescription = legalSeo.description;
    }

    // Static info pages override: keeps client hydration aligned with server SSR for
    // /xx/about, /xx/contact and /xx/applications. Without this, React would
    // overwrite the SSR-localized title/description with the generic English copy
    // baked into generateSeoTags' static templates / SEO_KEY_FALLBACKS — the same
    // duplicate-content trap regions/genres/search/legal had before they were
    // localised. buildStaticPageSeo emits the per-language template when DB keys
    // are missing in the requested language.
    if (pageType === 'about' || pageType === 'contact' || pageType === 'applications') {
      const staticSeo = buildStaticPageSeo(pageType, language, translationMap);
      seoTags.title = staticSeo.title;
      seoTags.description = staticSeo.description;
      seoTags.ogTitle = staticSeo.title;
      seoTags.ogDescription = staticSeo.description;
      seoTags.twitterTitle = staticSeo.title;
      seoTags.twitterDescription = staticSeo.description;
    }

    // Update title
    if (seoTags.title) {
      document.title = seoTags.title;
    }

    // Update or create meta description
    updateMetaTag('description', seoTags.description);

    // Update or create canonical link
    updateLinkTag('canonical', seoTags.canonical);

    // Update Open Graph tags
    updateMetaProperty('og:title', seoTags.ogTitle || seoTags.title);
    updateMetaProperty('og:description', seoTags.ogDescription || seoTags.description);
    updateMetaProperty('og:type', 'website');
    updateMetaProperty('og:url', seoTags.canonical);
    if (seoTags.ogImage) {
      updateMetaProperty('og:image', seoTags.ogImage);
    }

    // Update Twitter tags
    updateMetaTag('twitter:card', 'summary_large_image');
    updateMetaTag('twitter:title', seoTags.twitterTitle || seoTags.title);
    updateMetaTag('twitter:description', seoTags.twitterDescription || seoTags.description);

    // NOTE (2026-07-01): client-side hreflang + JSON-LD injection REMOVED.
    // The API server (seo-renderer.ts) renders a complete, correct SEO head on
    // EVERY response (SSR is served to all visitors, bots included): canonical,
    // hreflang restricted to the station's indexable ≤14-language set, and all
    // JSON-LD (Organization, WebSite, RadioBroadcastService, BreadcrumbList,
    // FAQPage). This client component used to re-inject the same schemas plus
    // hreflang for ALL 57 enabled languages (generateLanguageUrls with no
    // allow-list), which produced on every page:
    //   • 14 (server) + 57 (client) = 71 hreflang tags, 43 of them duplicates
    //     advertising non-universal languages that 301 to /en, and
    //   • two conflicting copies each of Organization / WebSite /
    //     RadioBroadcastService / BreadcrumbList at the same @id.
    // Google flagged the mess (duplicate entities, "no referring sitemap"
    // orphans). The server is the single source of truth now; this component
    // only keeps title/description/OG/Twitter/canonical fresh across in-app
    // (wouter) navigations — Google re-fetches each URL server-side, so
    // per-page hreflang/JSON-LD do not need client updates for indexing.

  }, [location, language, translations, stationData, pageType]);

  return null; // This component only manages head tags
}

function updateMetaTag(name: string, content?: string) {
  if (!content) return;

  let meta = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement;
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = name;
    document.head.appendChild(meta);
  }
  meta.content = content;
}

function updateMetaProperty(property: string, content?: string) {
  if (!content) return;

  let meta = document.querySelector(`meta[property="${property}"]`) as HTMLMetaElement;
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('property', property);
    document.head.appendChild(meta);
  }
  meta.content = content;
}

function updateLinkTag(rel: string, href?: string) {
  if (!href) return;

  let link = document.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement;
  if (!link) {
    link = document.createElement('link');
    link.rel = rel;
    document.head.appendChild(link);
  }
  link.href = href;
}

// hreflang + JSON-LD are now owned exclusively by the server (seo-renderer.ts).
// The client-side updateHrefLangTags / updateStructuredData helpers were removed
// on 2026-07-01 — see the note in the effect above.