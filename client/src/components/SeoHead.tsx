import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { useTranslation } from '@/hooks/useTranslation';
import { generateSeoTags, getLanguageFromPath, generateLanguageUrls } from '@shared/seo-config';
import { useQuery } from '@tanstack/react-query';
import { 
  generateOrganizationSchema, 
  generateRadioStationSchema, 
  generateWebSiteSchema,
  generateBreadcrumbSchema,
  type StructuredDataConfig 
} from '@shared/structured-data';
import { generateFAQSchema, MEGA_RADIO_FAQ, ABOUT_FAQ } from '@shared/faq-schema';

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
}

export function SeoHead({ stationData, pageType = 'home' }: SeoHeadProps) {
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

    // Add FAQ schema for home page — same 10 questions as SSR FAQPage schema
    // CRITICAL: Without this, SSR FAQ schema gets removed on hydration (never re-added)
    if (pageType === 'home') {
      const tr = (key: string, fb: string) => translations?.[key] || fb;
      const homeFaqItems = [
        { question: tr('faq_what_is_radio', 'What is Radio?'), answer: tr('faq_what_is_radio_answer', 'Radio is a technology that uses electromagnetic waves to transmit audio signals wirelessly.') },
        { question: tr('faq_what_is_internet_radio', 'What is Internet Radio?'), answer: tr('faq_what_is_internet_radio_answer', 'Internet radio is audio broadcasting transmitted over the internet, allowing you to listen to stations from anywhere in the world.') },
        { question: tr('faq_what_is_web_radio', 'What is Web Radio?'), answer: tr('faq_what_is_web_radio_answer', 'Web radio is another term for internet radio — audio content streamed through websites and web applications.') },
        { question: tr('faq_how_to_listen', 'How can I listen to Radio?'), answer: tr('faq_how_to_listen_answer', 'Visit our website, choose a station, and click play to start streaming instantly. No download required.') },
        { question: tr('faq_listen_on_phone', 'Can I listen to Radio on my Phone?'), answer: tr('faq_listen_on_phone_answer', 'Yes! Mega Radio works perfectly on smartphones and tablets on both iOS and Android devices.') },
        { question: tr('faq_is_radio_free', 'Is Internet Radio Free?'), answer: tr('faq_is_radio_free_answer', 'Yes, listening to internet radio on Mega Radio is completely free with no subscription fees.') },
        { question: tr('faq_listen_on_pc', 'How can I listen to Radio on my PC?'), answer: tr('faq_listen_on_pc_answer', 'Just visit Mega Radio in any web browser and click play. No downloads or installations needed.') },
        { question: tr('faq_which_stations', 'Which Radio Stations can I listen to?'), answer: tr('faq_which_stations_answer', 'Mega Radio offers over 60,000 radio stations from 120+ countries covering all genres.') },
        { question: tr('faq_best_station', 'Which Radio Station is the best?'), answer: tr('faq_best_station_answer', 'The best station depends on your personal taste! Use our popularity rankings to discover trending stations.') },
        { question: tr('faq_no_ads_stations', 'Which Radio Stations have no Advertising?'), answer: tr('faq_no_ads_stations_answer', 'Many stations on Mega Radio are commercial-free, including public broadcasters and community stations.') }
      ];
      schemas.push(generateFAQSchema(homeFaqItems, domain));
    }

    // Add FAQ schema for about page
    if (pageType === 'about') {
      schemas.push(generateFAQSchema(ABOUT_FAQ.concat(MEGA_RADIO_FAQ), domain));
    }

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