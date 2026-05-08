// Structured data schemas for SEO rich snippets
export interface StructuredDataConfig {
  "@context"?: string;
  "@type"?: string;
  [key: string]: any;
}

// Organization schema for Mega Radio brand - with full multilingual support
export function generateOrganizationSchema(
  domain: string, 
  language: string = 'en',
  translations?: Record<string, string>
): StructuredDataConfig {
  // Get translated meta description from database (detailed, SEO-optimized version)
  // Priority 1: meta_description (full, detailed description for schema)
  // Fallback: hero_worlds_best_radio (short hero text) or default English
  let description = translations?.['meta_description'] || 
    translations?.['hero_worlds_best_radio'] || 
    "Listen to live radio online with Mega Radio! 60,000+ AM/FM stations from 120+ countries, music, news, sports, and talk shows for free.";
  
  // Build list of all 57 available languages for contactPoint
  const availableLanguages = [
    "English", "Turkish", "Spanish", "French", "German", "Arabic", // 6
    "Italian", "Portuguese", "Dutch", "Russian", "Polish", "Swedish", // 6
    "Danish", "Norwegian", "Finnish", "Greek", "Hungarian", "Czech", // 6
    "Slovak", "Romanian", "Bulgarian", "Croatian", "Serbian", "Slovenian", // 6
    "Latvian", "Lithuanian", "Estonian", "Chinese", "Japanese", "Korean", // 6
    "Hindi", "Thai", "Vietnamese", "Indonesian", "Malay", "Filipino", // 6
    "Hebrew", "Persian", "Urdu", "Bengali", "Tamil", "Telugu", // 6
    "Marathi", "Gujarati", "Kannada", "Malayalam", "Punjabi", "Swahili", // 6
    "Amharic", "Zulu", "Afrikaans", "Albanian", "Azerbaijani", "Armenian", // 6
    "Somali", "Ukrainian", "Bosnian" // 3 = 57 total
  ];
  
  // Build localized URL with language prefix
  const localizedUrl = language === 'en' ? `https://${domain}` : `https://${domain}/${language}`;
  
  // D-A3 FIX (2026-05-08): expose social profiles via sameAs so Google
  // can link the Knowledge Graph entity to our verified accounts.
  // Empty strings are filtered out so unset accounts don't ship as
  // dead links. Override per-deploy via env vars at the call site if
  // these handles change.
  const sameAs = [
    'https://www.facebook.com/megaradio',
    'https://twitter.com/megaradio',
    'https://www.instagram.com/megaradio',
    'https://www.youtube.com/@megaradio',
    'https://www.linkedin.com/company/megaradio',
  ].filter(Boolean);

  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `https://${domain}/#organization`,
    "name": "Mega Radio",
    "alternateName": "Mega Radio - Free Online Radio",
    "description": description,
    "url": `https://${domain}`,
    "logo": {
      "@type": "ImageObject",
      "url": `https://${domain}/images/logo-icon.webp`,
      "width": 212,
      "height": 212
    },
    "contactPoint": {
      "@type": "ContactPoint",
      "contactType": "Customer Service",
      "availableLanguage": availableLanguages
    },
    "sameAs": sameAs,
  };
}

// RadioStation schema for individual stations
export function generateRadioStationSchema(
  station: any, 
  domain: string, 
  language: string = 'en',
  currentUrl?: string,
  metaDescription?: string
): StructuredDataConfig {
  // Priority 1: Use the pre-computed meta description (already translated and optimized for the language)
  // Priority 2: Use AI-generated custom description if available
  // Priority 3: Use station's about/description field if available
  // Priority 4: Fallback to generic template description
  let stationDescription: string;
  
  if (metaDescription) {
    // Use the SEO meta description (already localized and optimized)
    stationDescription = metaDescription;
  } else if (station.descriptions && typeof station.descriptions === 'object' && station.descriptions[language]) {
    // Use AI-generated description for better SEO and uniqueness
    const desc = station.descriptions[language];
    // Handle both string and object formats (with 'full' and 'meta' keys)
    stationDescription = typeof desc === 'object' && desc.meta ? desc.meta : (typeof desc === 'string' ? desc : desc.full);
  } else if (station.description && station.description.trim()) {
    // Use station's own description from "About the station" if available
    stationDescription = station.description;
  } else {
    // Fallback to template-based description
    stationDescription = `Listen to ${station.name} live online.${station.country ? ` Broadcasting from ${station.country}.` : ''}${station.tags ? ` Genres: ${station.tags.split(',').slice(0, 3).join(', ')}.` : ''} Free radio streaming on Mega Radio.`;
  }
  
  // Build the correct URL - use current URL if provided, otherwise construct from slug/ID
  let stationUrl: string;
  if (currentUrl) {
    // Use the current URL (which already has the correct localized path)
    stationUrl = `https://${domain}${currentUrl}`;
  } else {
    // Fallback: construct URL (note: this doesn't preserve translated URL paths)
    stationUrl = `https://${domain}/${language === 'en' ? '' : language + '/'}stations/${station.slug || station._id}`;
  }
  
  // D-A1 FIX (2026-05-08): emit broadcastDisplayName so Google's Radio
  // Station rich-result extractor accepts the entity. broadcastAffiliateOf
  // alone is not enough — broadcastDisplayName is the user-visible label
  // tied to the station identity.
  const schema: StructuredDataConfig = {
    "@context": "https://schema.org",
    "@type": "RadioStation",
    "@id": `${stationUrl}#radiostation`,
    "name": station.name,
    "broadcastDisplayName": station.name,
    "description": stationDescription,
    "url": stationUrl,
    "image": station.favicon || `https://${domain}/images/no-image.webp`,
    "broadcastAffiliateOf": {
      "@type": "Organization",
      "@id": `https://${domain}/#organization`,
      "name": "Mega Radio"
    },
    "genre": station.tags ? station.tags.split(',').map((tag: string) => tag.trim()) : [],
    "inLanguage": language, // Use page language instead of station language for SEO
    "potentialAction": {
      "@type": "ListenAction",
      "target": {
        "@type": "EntryPoint",
        "urlTemplate": stationUrl,
        "actionPlatform": ["https://schema.org/DesktopWebPlatform", "https://schema.org/MobileWebPlatform"]
      }
    }
  };

  // Enhanced radio-specific properties
  if (station.country) {
    schema.address = {
      "@type": "PostalAddress",
      "addressCountry": station.countryCode || station.country,
      "addressLocality": station.state || undefined
    };
  }

  if (station.geoLat && station.geoLong) {
    schema.geo = {
      "@type": "GeoCoordinates",
      "latitude": parseFloat(station.geoLat),
      "longitude": parseFloat(station.geoLong)
    };
  }

  // Use votes if available, otherwise fall back to clickCount
  const metricValue = station.votes || station.clickCount || 0;
  
  if (metricValue > 0) {
    // Calculate rating using logarithmic scale for realistic distribution
    // This prevents inflated ratings for stations with thousands of votes/clicks
    let ratingValue = 3.0; // Default baseline
    
    if (metricValue >= 5000) {
      ratingValue = 5.0;      // Exceptional popularity
    } else if (metricValue >= 2000) {
      ratingValue = 4.8;      // Very high popularity
    } else if (metricValue >= 1000) {
      ratingValue = 4.5;      // High popularity
    } else if (metricValue >= 500) {
      ratingValue = 4.2;      // Good popularity
    } else if (metricValue >= 200) {
      ratingValue = 4.0;      // Moderate popularity
    } else if (metricValue >= 100) {
      ratingValue = 3.7;      // Decent popularity
    } else if (metricValue >= 50) {
      ratingValue = 3.5;      // Some popularity
    } else if (metricValue >= 20) {
      ratingValue = 3.2;      // Low popularity
    } else if (metricValue >= 10) {
      ratingValue = 3.0;      // Very low popularity
    } else {
      ratingValue = 2.5;      // Minimal popularity
    }
    
    schema.aggregateRating = {
      "@type": "AggregateRating",
      "ratingValue": ratingValue,
      "ratingCount": metricValue,
      "bestRating": 5,
      "worstRating": 1
    };
  }

  // Add broadcasting details if available
  if (station.bitrate) {
    schema.encodingFormat = `audio/mpeg; bitrate=${station.bitrate}`;
  }

  if (station.language) {
    schema.broadcastChannelId = station.language.toUpperCase();
  }

  // D-A1 FIX (2026-05-08): emit broadcastFrequency as a structured
  // BroadcastFrequencySpecification when we can parse a real frequency
  // from the station tags (e.g. "FM 102.5"). Otherwise fall back to a
  // simple string ("FM" / "AM") which is the schema.org permissive
  // alternative. Pure online streams omit this field entirely (correct
  // per spec — they have no broadcast frequency).
  if (station.tags) {
    const freqMatch = String(station.tags).match(/(FM|AM)\s*([0-9]{2,4}(?:[.,][0-9]+)?)/i);
    if (freqMatch) {
      const band = freqMatch[1].toUpperCase();
      const value = parseFloat(freqMatch[2].replace(',', '.'));
      if (Number.isFinite(value)) {
        schema.broadcastFrequency = {
          "@type": "BroadcastFrequencySpecification",
          "broadcastFrequencyValue": value,
          "broadcastSignalModulation": band,
          "frequencyUnit": band === 'FM' ? 'MHz' : 'kHz',
        };
      } else {
        schema.broadcastFrequency = band;
      }
    } else if (station.tags.includes('FM') || station.tags.includes('AM')) {
      schema.broadcastFrequency = station.tags.includes('FM') ? 'FM' : 'AM';
    }
  }

  return schema;
}

// WebSite schema with search functionality - with full multilingual support
export function generateWebSiteSchema(
  domain: string, 
  language: string = 'en',
  translations?: Record<string, string>
): StructuredDataConfig {
  // Get translated meta description from database (detailed, SEO-optimized version)
  // Priority 1: meta_description (full, detailed description for schema)
  // Fallback: hero_worlds_best_radio (short hero text) or default English
  let description = translations?.['meta_description'] || 
    translations?.['hero_worlds_best_radio'] || 
    "Listen to live radio online with Mega Radio! 60,000+ AM/FM stations from 120+ countries, music, news, sports, and talk shows for free.";
  
  // Build localized URLs with language prefix
  const localizedUrl = language === 'en' ? `https://${domain}` : `https://${domain}/${language}`;
  const searchUrl = language === 'en' ? `https://${domain}/search?q={search_term_string}` : `https://${domain}/${language}/search?q={search_term_string}`;
  
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `https://${domain}/#website`,
    "name": "Mega Radio",
    "alternateName": "Mega Radio - Free Online Radio",
    "description": description,
    "url": `https://${domain}`,
    "inLanguage": language,
    "potentialAction": {
      "@type": "SearchAction",
      "target": {
        "@type": "EntryPoint",
        "urlTemplate": searchUrl
      },
      "query-input": "required name=search_term_string"
    }
  };
}

// BreadcrumbList schema for navigation
export function generateBreadcrumbSchema(
  breadcrumbs: Array<{ name: string; url: string }>, 
  domain: string
): StructuredDataConfig {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": breadcrumbs.map((crumb, index) => ({
      "@type": "ListItem",
      "position": index + 1,
      "name": crumb.name,
      "item": `https://${domain}${crumb.url}`
    }))
  };
}

// FAQ schema for help/about pages
export function generateFAQSchema(faqs: Array<{ question: string; answer: string }>): StructuredDataConfig {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": faqs.map(faq => ({
      "@type": "Question",
      "name": faq.question,
      "acceptedAnswer": {
        "@type": "Answer",
        "text": faq.answer
      }
    }))
  };
}

// ItemList schema for station listings
export function generateItemListSchema(
  items: any[], 
  listName: string, 
  domain: string,
  language: string = 'en'
): StructuredDataConfig {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "name": listName,
    "description": `List of ${listName.toLowerCase()} radio stations`,
    "numberOfItems": items.length,
    "itemListElement": items.map((item, index) => ({
      "@type": "ListItem",
      "position": index + 1,
      "name": item.name,
      "url": `https://${domain}/${language === 'en' ? '' : language + '/'}stations/${item.slug || item._id}`,
      "image": item.favicon || `https://${domain}/images/no-image.webp`,
      "description": `Listen to ${item.name} live on Mega Radio`
    }))
  };
}

// Helper function to inject structured data into HTML head
export function injectStructuredData(schemas: StructuredDataConfig[]): string {
  return schemas.map(schema => 
    `<script type="application/ld+json">${JSON.stringify(schema, null, 2)}</script>`
  ).join('\n');
}