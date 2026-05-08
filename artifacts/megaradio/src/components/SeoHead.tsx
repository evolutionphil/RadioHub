import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { useTranslation } from '@/hooks/useTranslation';
import { generateSeoTags, getLanguageFromPath, generateLanguageUrls } from '@workspace/seo-shared/seo-config';
import { buildGenreSeo } from '@workspace/seo-shared/genre-seo-templates';
import { useQuery } from '@tanstack/react-query';
import { 
  generateOrganizationSchema, 
  generateRadioStationSchema, 
  generateWebSiteSchema,
  generateBreadcrumbSchema,
  type StructuredDataConfig 
} from '@workspace/seo-shared/structured-data';
import { generateFAQSchema, FAQ_PAGE_ITEMS, type FAQTranslatedItem } from '@workspace/seo-shared/faq-schema';

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
  pageType?: 'home' | 'station' | 'genres' | 'stations' | 'users' | 'about' | 'search' | 'faq';
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

    // Update hreflang tags
    updateHrefLangTags(seoTags.hreflangs || []);

    // Generate and inject structured data
    const schemas: StructuredDataConfig[] = [];
    const domain = window.location.host;

    // Always include organization schema - with language-specific translations
    schemas.push(generateOrganizationSchema(domain, language, translations));

    // Add WebSite schema with search functionality and language-specific translations
    schemas.push(generateWebSiteSchema(domain, language, translations));

    // Add page-specific structured data
    if (pageType === 'station' && stationData) {
      // Pass the current location and SEO description to preserve translated URLs and use correct language description
      schemas.push(generateRadioStationSchema(stationData, domain, language, location, seoTags.description));
      
      // Add breadcrumb for station page with proper localized URLs
      // Derive language code and segment from actual location path
      // e.g. /de/sender/dance-wave → langCode='de', stationsSegment='sender'
      const pathParts = location.split('/').filter(Boolean);
      const langCode = pathParts[0] || language;
      const homeUrl = `/${langCode}`;
      // Strip the station slug from the URL to get the stations list URL
      // e.g. /de/sender/dance-wave → /de/sender
      const stationSegment = pathParts[1] || 'stations';
      const stationsUrl = `/${langCode}/${stationSegment}`;
      const stationUrl = location;
      
      const breadcrumbs = [
        { name: translations?.['nav_home'] || 'Home', url: homeUrl },
        { name: translations?.['nav_stations'] || 'Stations', url: stationsUrl },
        { name: stationData.name, url: stationUrl }
      ];
      schemas.push(generateBreadcrumbSchema(breadcrumbs, domain));
    }

    // Add FAQ schema for the dedicated /faq page only.
    // Task #129: previously the FAQPage JSON-LD lived on the homepage (which
    // shows no Q&A) — Google flagged that as deceptive markup. The schema now
    // matches the visible Q&A rendered server-side and client-side on /faq.
    if (pageType === 'faq') {
      const tr = (key: string, fb: string) => translations?.[key] || fb;
      const faqItems = FAQ_PAGE_ITEMS.map((item: FAQTranslatedItem) => ({
        question: tr(item.qKey, item.qFallback),
        answer: tr(item.aKey, item.aFallback),
      }));
      schemas.push(generateFAQSchema(faqItems, domain));
    }

    // Task #164: the /about page previously emitted FAQPage JSON-LD
    // (ABOUT_FAQ + MEGA_RADIO_FAQ — 19 questions) but the about page body
    // does not render any of those questions/answers as visible Q&A. Google
    // flags that schema/visible-content mismatch as deceptive markup, the
    // same issue we fixed on the homepage in Task #129. Since the visible
    // about page content is intro paragraphs + feature cards (not Q&A),
    // the FAQ schema is removed here rather than synthesised. The dedicated
    // /faq page still emits FAQPage JSON-LD that matches its visible Q&A.

    // Update structured data in head
    updateStructuredData(schemas);

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

function updateHrefLangTags(hreflangs: Array<{ lang: string; url: string; hreflang: string }>) {
  // Remove existing hreflang tags
  const existingHreflangs = document.querySelectorAll('link[rel="alternate"][hreflang]');
  existingHreflangs.forEach(link => link.remove());

  // Add new hreflang tags
  hreflangs.forEach(({ url, hreflang }) => {
    const link = document.createElement('link');
    link.rel = 'alternate';
    link.hreflang = hreflang;
    link.href = url;
    document.head.appendChild(link);
  });
}

function updateStructuredData(schemas: StructuredDataConfig[]) {
  // Remove existing structured data
  const existingSchemas = document.querySelectorAll('script[type="application/ld+json"]');
  existingSchemas.forEach(script => script.remove());

  // Add new structured data
  schemas.forEach(schema => {
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(schema, null, 2);
    document.head.appendChild(script);
  });
}