import { faTrackEvent, faTrackPageView } from './flowalive';

// Define the gtag function globally
declare global {
  interface Window {
    dataLayer: any[];
    gtag: (...args: any[]) => void;
  }
}

// Defer Google Analytics loading to after page is interactive
// This prevents blocking the critical rendering path
export const initGA = () => {
  const measurementId = import.meta.env.VITE_GA_MEASUREMENT_ID;

  if (!measurementId) {
    console.warn('Missing required Google Analytics key: VITE_GA_MEASUREMENT_ID');
    return;
  }

  // Load GA script asynchronously - optimized for minimal blocking
  const loadGA = () => {
    // Initialize dataLayer first
    window.dataLayer = window.dataLayer || [];
    
    // Initialize gtag function
    window.gtag = function() { 
      window.dataLayer.push(arguments); 
    };
    
    window.gtag('js', new Date());
    window.gtag('config', measurementId);
    
    // Load GA script asynchronously and non-blocking
    const script = document.createElement('script');
    script.async = true;
    script.defer = true; // Important: defer attribute prevents blocking
    script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
    script.onload = () => {
      // Script loaded, gtag is now ready
      if (window.gtag) {
        window.gtag('config', measurementId);
      }
    };
    document.head.appendChild(script);
    
    // Remove event listeners after loading
    document.removeEventListener('scroll', handleUserInteraction);
    document.removeEventListener('click', handleUserInteraction);
    document.removeEventListener('touchstart', handleUserInteraction);
  };

  // Optimized: Load GTM in background after user first interacts with page
  // This ensures page is fully rendered before GTM loads (140KB file)
  let gaLoaded = false;
  const handleUserInteraction = () => {
    if (!gaLoaded) {
      gaLoaded = true;
      loadGA();
    }
  };

  // Priority 1: Load on user interaction (scroll/click/touch) - most ideal
  // This ensures GTM loads in background while user is actively engaging
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    document.addEventListener('scroll', handleUserInteraction, { once: true, passive: true });
    document.addEventListener('click', handleUserInteraction, { once: true, passive: true });
    document.addEventListener('touchstart', handleUserInteraction, { once: true, passive: true });
    
    // Fallback: Load after 8 seconds if user hasn't interacted (longer timeout for slower networks)
    setTimeout(() => {
      if (!gaLoaded) {
        gaLoaded = true;
        loadGA();
      }
    }, 8000);
  }
};

// Track page views - useful for single-page applications
export const trackPageView = (url: string) => {
  if (typeof window !== 'undefined' && window.gtag) {
    const measurementId = import.meta.env.VITE_GA_MEASUREMENT_ID;
    if (measurementId) {
      window.gtag('config', measurementId, { page_path: url });
    }
  }
  faTrackPageView(url);
};

// Track events
export const trackEvent = (
  action: string, 
  category?: string, 
  label?: string, 
  value?: number
) => {
  if (typeof window === 'undefined' || !window.gtag) return;
  
  window.gtag('event', action, {
    event_category: category,
    event_label: label,
    value: value,
  });
};

// Radio-specific analytics events
export const trackStationPlay = (stationName: string, stationCountry: string, stationGenre?: string) => {
  trackEvent('station_play', 'radio', `${stationName} - ${stationCountry}`, 1);
  if (stationGenre) {
    trackEvent('genre_play', 'radio_genre', stationGenre, 1);
  }
  trackEvent('country_play', 'radio_country', stationCountry, 1);

  faTrackEvent('station_played', {
    station_name: stationName,
    country: stationCountry,
    genre: stationGenre || null,
  });
};

export const trackStationFavorite = (stationName: string, stationCountry: string, action: 'add' | 'remove') => {
  trackEvent(`station_favorite_${action}`, 'user_engagement', `${stationName} - ${stationCountry}`, 1);

  faTrackEvent(action === 'add' ? 'station_favorited' : 'station_unfavorited', {
    station_name: stationName,
    country: stationCountry,
  });
};

export const trackUserSignup = (method: 'google' | 'email') => {
  trackEvent('sign_up', 'user_account', method, 1);
  faTrackEvent('user_signed_up', { method });
};

export const trackUserLogin = (method: 'google' | 'email') => {
  trackEvent('login', 'user_account', method, 1);
  faTrackEvent('user_logged_in', { method });
};

export const trackListeningTime = (stationName: string, durationMinutes: number) => {
  trackEvent('listening_time', 'radio_engagement', stationName, durationMinutes);
  faTrackEvent('listening_session_ended', {
    station_name: stationName,
    duration_minutes: durationMinutes,
  });
};

export const trackSearch = (searchTerm: string, resultsCount: number) => {
  trackEvent('search', 'user_interaction', searchTerm, resultsCount);
  faTrackEvent('search_performed', {
    query: searchTerm,
    results_count: resultsCount,
  });
};
