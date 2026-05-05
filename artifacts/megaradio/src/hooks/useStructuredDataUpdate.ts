import { useEffect } from 'react';
import { getCurrentDomain } from '@/utils/structured-data';

// Hook to update base structured data with current domain
export const useStructuredDataUpdate = () => {
  useEffect(() => {
    const updateStructuredData = () => {
      const currentDomain = getCurrentDomain();
      
      // Update Organization structured data
      const orgScript = document.getElementById('base-structured-data');
      if (orgScript) {
        const orgData = {
          "@context": "https://schema.org",
          "@type": "Organization",
          "name": "Mega Radio",
          "url": currentDomain,
          "alternateName": "MegaRadio",
          "logo": `${currentDomain}/images/logo-icon.webp`,
          "description": "Mega Radio - Your ultimate destination for live radio streaming from around the world. Discover thousands of radio stations across all genres and countries.",
          "sameAs": [
            "https://themegaradio.com"
          ],
          "contactPoint": {
            "@type": "ContactPoint",
            "contactType": "customer service"
          },
          "potentialAction": {
            "@type": "SearchAction",
            "target": `${currentDomain}/?search={search_term_string}`,
            "query-input": "required name=search_term_string"
          }
        };
        orgScript.textContent = JSON.stringify(orgData, null, 2);
      }

      // Update WebSite structured data
      const websiteScript = document.getElementById('website-structured-data');
      if (websiteScript) {
        const websiteData = {
          "@context": "https://schema.org",
          "@type": "WebSite",
          "name": "Mega Radio - Live Radio Streaming",
          "url": currentDomain,
          "description": "Stream live radio stations from around the world. Discover music, news, talk shows, and more across thousands of radio stations in multiple languages and genres.",
          "inLanguage": ["en", "es", "fr", "de", "tr", "ar"],
          "audience": {
            "@type": "Audience",
            "audienceType": "Music lovers, radio enthusiasts, international listeners"
          },
          "potentialAction": {
            "@type": "SearchAction",
            "target": `${currentDomain}/?search={search_term_string}`,
            "query-input": "required name=search_term_string"
          }
        };
        websiteScript.textContent = JSON.stringify(websiteData, null, 2);
      }
    };

    // Update immediately and when domain changes
    updateStructuredData();
    
    // Listen for domain changes (e.g., when switching between dev/prod)
    const handleLocationChange = () => {
      setTimeout(updateStructuredData, 100);
    };
    
    window.addEventListener('popstate', handleLocationChange);
    
    return () => {
      window.removeEventListener('popstate', handleLocationChange);
    };
  }, []);
};