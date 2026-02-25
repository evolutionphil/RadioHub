import { useEffect } from 'react';
import { SeoMetaTags } from '@shared/seo-config';

interface SeoHeadProps {
  seoData: SeoMetaTags;
}

export function SeoHead({ seoData }: SeoHeadProps) {
  useEffect(() => {
    // Update document title
    if (seoData.title) {
      document.title = seoData.title;
    }
    
    // Update meta tags
    const updateMetaTag = (name: string, content: string, property?: string) => {
      if (!content) return;
      
      const selector = property ? `meta[property="${property}"]` : `meta[name="${name}"]`;
      let meta = document.querySelector(selector) as HTMLMetaElement;
      
      if (!meta) {
        meta = document.createElement('meta');
        if (property) {
          meta.setAttribute('property', property);
        } else {
          meta.setAttribute('name', name);
        }
        document.head.appendChild(meta);
      }
      
      meta.setAttribute('content', content);
    };
    
    // Update link tags
    const updateLinkTag = (rel: string, href: string, hreflang?: string) => {
      if (!href) return;
      
      const selector = hreflang 
        ? `link[rel="${rel}"][hreflang="${hreflang}"]`
        : `link[rel="${rel}"]`;
      
      let link = document.querySelector(selector) as HTMLLinkElement;
      
      if (!link) {
        link = document.createElement('link');
        link.setAttribute('rel', rel);
        if (hreflang) {
          link.setAttribute('hreflang', hreflang);
        }
        document.head.appendChild(link);
      }
      
      link.setAttribute('href', href);
    };
    
    // Basic meta tags
    updateMetaTag('description', seoData.description);
    
    // Open Graph tags - ALL 4 REQUIRED properties
    updateMetaTag('', seoData.ogTitle || seoData.title, 'og:title');
    updateMetaTag('', seoData.ogDescription || seoData.description, 'og:description');
    
    // og:url - REQUIRED (fallback to canonical or current URL)
    const ogUrl = seoData.ogUrl || seoData.canonical || window.location.href;
    updateMetaTag('', ogUrl, 'og:url');
    
    // og:image - REQUIRED (with fallback to default logo, ensure absolute URL)
    const ogImageRaw = seoData.ogImage || '/images/logo-icon.webp';
    const ogImage = ogImageRaw.startsWith('http') 
      ? ogImageRaw 
      : `${window.location.origin}${ogImageRaw.startsWith('/') ? '' : '/'}${ogImageRaw}`;
    updateMetaTag('', ogImage, 'og:image');
    
    // og:type - REQUIRED
    updateMetaTag('', seoData.ogType || 'website', 'og:type');
    
    // Optional but recommended Open Graph tags
    updateMetaTag('', seoData.ogSiteName || 'Mega Radio', 'og:site_name');
    updateMetaTag('', seoData.ogLocale || 'en_US', 'og:locale');
    
    // Twitter Card tags - ALL REQUIRED for validation
    updateMetaTag('twitter:card', 'summary_large_image');
    updateMetaTag('twitter:site', '@megaradio');
    updateMetaTag('twitter:creator', '@megaradio');
    updateMetaTag('twitter:title', seoData.twitterTitle || seoData.title);
    updateMetaTag('twitter:description', seoData.twitterDescription || seoData.description);
    
    // Ensure Twitter image is absolute URL (required by Twitter)
    const twitterImage = seoData.twitterImage || ogImage;
    const absoluteTwitterImage = twitterImage.startsWith('http') 
      ? twitterImage 
      : `${window.location.origin}${twitterImage.startsWith('/') ? '' : '/'}${twitterImage}`;
    updateMetaTag('twitter:image', absoluteTwitterImage);
    
    // Canonical URL
    if (seoData.canonical) {
      updateLinkTag('canonical', seoData.canonical);
    }
    
    // Hreflang tags
    if (seoData.hreflangs) {
      // Remove existing hreflang tags first
      const existingHreflangs = document.querySelectorAll('link[rel="alternate"][hreflang]');
      existingHreflangs.forEach(link => link.remove());
      
      // Add new hreflang tags (x-default is already included in the array)
      seoData.hreflangs.forEach(({ url, hreflang }) => {
        updateLinkTag('alternate', url, hreflang);
      });
    }
    
    // SEO meta tags updated successfully
  }, [seoData]);

  return null; // This component doesn't render anything visible
}