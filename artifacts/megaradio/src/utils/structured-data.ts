// Structured Data (JSON-LD) utilities for SEO optimization

// Station type definition for structured data
interface Station {
  _id: string;
  name: string;
  slug?: string;
  country?: string;
  tags?: string[];
  bitrate?: number;
  codec?: string;
  votes?: number;
  clickCount?: number;
}

export interface OrganizationData {
  "@context": string;
  "@type": "Organization";
  name: string;
  url: string;
  logo: string;
  description: string;
  sameAs: string[];
  contactPoint?: {
    "@type": "ContactPoint";
    contactType: string;
    email?: string;
  };
}

export interface WebSiteData {
  "@context": string;
  "@type": "WebSite";
  name: string;
  url: string;
  description: string;
  potentialAction: {
    "@type": "SearchAction";
    target: string;
    "query-input": string;
  };
}

// 2026-05-12 SEO audit: switched from RadioStation (LocalBusiness subtype
// — invalid for our broadcast* fields) to RadioBroadcastService. See
// lib/seo-shared/src/structured-data.ts for the full rationale. This
// frontend helper is currently dead code (StationStructuredData.tsx is
// not imported anywhere) but kept consistent so future use is safe.
export interface RadioStationData {
  "@context": string;
  "@type": "RadioBroadcastService";
  name: string;
  url: string;
  description?: string;
  category?: string[];
  inLanguage?: string;
  broadcaster?: {
    "@type": "Organization";
    name: string;
    address?: {
      "@type": "PostalAddress";
      addressCountry: string;
    };
  };
  areaServed?: {
    "@type": "Country";
    name: string;
  };
  aggregateRating?: {
    "@type": "AggregateRating";
    ratingValue: number;
    ratingCount: number;
    bestRating: number;
    worstRating: number;
  };
}

export interface BreadcrumbData {
  "@context": string;
  "@type": "BreadcrumbList";
  itemListElement: Array<{
    "@type": "ListItem";
    position: number;
    name: string;
    item: string;
  }>;
}

export interface ItemListData {
  "@context": string;
  "@type": "ItemList";
  name: string;
  description?: string;
  numberOfItems: number;
  inLanguage?: string;
  itemListElement: Array<{
    "@type": "ListItem";
    position: number;
    name: string;
    url: string;
    description?: string;
  }>;
}

// Get current domain dynamically
export const getCurrentDomain = (): string => {
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  // Fallback for SSR - use production domains
  return 'https://themegaradio.com';
};

// Generate Organization structured data
export const generateOrganizationData = (): OrganizationData => {
  const domain = getCurrentDomain();
  
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Mega Radio",
    url: domain,
    logo: `${domain}/images/logo-icon.webp`,
    description: "Mega Radio - Your ultimate destination for live radio streaming from around the world. Discover thousands of radio stations across all genres and countries.",
    sameAs: [
      "https://themegaradio.com"
    ],
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer service",
      email: "support@themegaradio.com"
    }
  };
};

// Generate WebSite structured data with search functionality
export const generateWebSiteData = (): WebSiteData => {
  const domain = getCurrentDomain();
  
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Mega Radio - Live Radio Streaming",
    url: domain,
    description: "Stream live radio stations from around the world. Discover music, news, talk shows, and more across thousands of radio stations in multiple languages and genres.",
    potentialAction: {
      "@type": "SearchAction",
      target: `${domain}/?search={search_term_string}`,
      "query-input": "required name=search_term_string"
    }
  };
};

// Generate RadioStation structured data
export const generateRadioStationData = (station: Station, currentUrl: string): RadioStationData => {
  // Click counts and one-way votes are not star reviews. The authoritative
  // server renderer emits ratings only from genuine user rating aggregates.
  
  const keywords: string[] = (station.tags && station.tags.length > 0)
    ? station.tags.slice(0, 8)
    : ["Music"];
  return {
    "@context": "https://schema.org",
    "@type": "RadioBroadcastService",
    name: station.name,
    url: currentUrl,
    description: station.name + (station.tags ? ` - ${station.tags.join(', ')}` : ''),
    category: keywords,
    broadcaster: {
      "@type": "Organization",
      name: station.name,
      ...(station.country && {
        address: { "@type": "PostalAddress" as const, addressCountry: station.country }
      })
    },
    ...(station.country && {
      areaServed: { "@type": "Country" as const, name: station.country }
    }),
  };
};

// Generate BreadcrumbList structured data
export const generateBreadcrumbData = (breadcrumbs: Array<{name: string, url: string}>): BreadcrumbData => {
  const domain = getCurrentDomain();
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: breadcrumbs.map((breadcrumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: breadcrumb.name,
      item: breadcrumb.url.startsWith('http') ? breadcrumb.url : domain + breadcrumb.url
    }))
  };
};

// Generate ItemList structured data for station listings
export const generateStationListData = (
  stations: Station[], listName: string, listDescription?: string,
  localizedPath: (path: string) => string = path => `/en${path}`,
): ItemListData => {
  const domain = getCurrentDomain();
  
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: listName,
    description: listDescription,
    numberOfItems: stations.length,
    itemListElement: stations.slice(0, 20).map((station, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: station.name,
      url: `${domain}${localizedPath(`/station/${station.slug || station._id}`)}`,
    }))
  };
};

// Generate Genre ItemList structured data
export const generateGenreListData = (
  genres: Array<{name: string, slug: string}>, currentCountry?: string,
  localizedPath: (path: string) => string = path => `/en${path}`,
): ItemListData => {
  const domain = getCurrentDomain();
  
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: currentCountry && currentCountry !== 'all' 
      ? `Music Genres in ${currentCountry}` 
      : "Radio Music Genres",
    description: currentCountry && currentCountry !== 'all'
      ? `Discover radio stations by music genre in ${currentCountry}`
      : "Browse radio stations by music genre from around the world",
    numberOfItems: genres.length,
    itemListElement: genres.map((genre, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: genre.name,
      // Country is a UI filter, not a prefix of the canonical genre route.
      url: `${domain}${localizedPath(`/genres/${genre.slug}`)}`,
    }))
  };
};

// Utility to inject structured data into page head
export const injectStructuredData = (data: any): void => {
  if (typeof document !== 'undefined') {
    // Remove existing structured data script if it exists
    const existingScript = document.querySelector('script[data-structured-data]');
    if (existingScript) {
      existingScript.remove();
    }

    // Create and inject new structured data script
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.setAttribute('data-structured-data', 'true');
    script.textContent = JSON.stringify(data, null, 2);
    document.head.appendChild(script);
  }
};

// Utility to inject multiple structured data objects
export const injectMultipleStructuredData = (dataArray: any[]): void => {
  if (typeof document !== 'undefined') {
    // Remove existing structured data scripts
    const existingScripts = document.querySelectorAll('script[data-structured-data]');
    existingScripts.forEach(script => script.remove());

    // Inject each structured data object
    dataArray.forEach((data, index) => {
      const script = document.createElement('script');
      script.type = 'application/ld+json';
      script.setAttribute('data-structured-data', `true-${index}`);
      script.textContent = JSON.stringify(data, null, 2);
      document.head.appendChild(script);
    });
  }
};

/** A component may replace only its own JSON-LD; never a sibling or SSR node. */
export const injectOwnedStructuredData = (dataArray: unknown[], owner: string): (() => void) => {
  if (typeof document === 'undefined') return () => {};
  const scripts = dataArray.map(data => {
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.dataset.structuredDataOwner = owner;
    script.textContent = JSON.stringify(data);
    document.head.appendChild(script);
    return script;
  });
  return () => scripts.forEach(script => script.remove());
};
