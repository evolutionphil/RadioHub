// Utility functions for generating and handling station slugs
// RESTORED: Simple version without localStorage country detection (working version from 10+ days ago)

export function generateSlug(stationName: string): string {
  return stationName
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // Remove special characters except spaces and hyphens
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
    .trim()
    .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
}

// Get current language from URL path
// CRITICAL: Only reads from URL - never from localStorage
function getCurrentLanguage(): string {
  if (typeof window === 'undefined') return '';
  const path = window.location.pathname;
  // FIXED: Match country code with OR without trailing slash
  const match = path.match(/^\/([a-z]{2})(?:\/|$)/);
  return match ? match[1] : '';
}

export function getStationUrl(station: { _id?: string; slug?: string; name: string }): string {
  const currentLang = getCurrentLanguage();
  const langPrefix = currentLang ? `/${currentLang}` : '';
  
  // Always prefer slug-based URLs for SEO
  if (station.slug) {
    return `${langPrefix}/station/${station.slug}`;
  }
  
  // Generate slug from name if no slug exists (should not happen with our data)
  const generatedSlug = generateSlug(station.name);
  return `${langPrefix}/station/${generatedSlug}`;
}

// Generate SEO-friendly user profile URLs
export function getUserUrl(user: { _id?: string; slug?: string; fullName?: string; name?: string; email?: string }): string {
  const currentLang = getCurrentLanguage();
  const langPrefix = currentLang ? `/${currentLang}` : '';
  
  // Always prefer slug-based URLs for SEO
  if (user.slug) {
    return `${langPrefix}/users/${user.slug}`;
  }
  
  // Generate slug from user data if no slug exists (fallback)
  const userName = user.fullName || user.name || user.email?.split('@')[0] || 'user';
  const generatedSlug = generateSlug(userName);
  return `${langPrefix}/users/${generatedSlug}`;
}

// Universal function to add country code to any path
// CRITICAL: Only uses country code from CURRENT URL - never from localStorage
export function getLocalizedPath(path: string): string {
  // Don't add country code to admin paths
  if (path.startsWith('/admin')) return path;
  
  const currentLang = getCurrentLanguage();
  if (!currentLang) return path;
  
  return `/${currentLang}${path}`;
}

export function navigateToStation(station: { _id?: string; slug?: string; name: string }) {
  const url = getStationUrl(station);
  // Use pushState to navigate without page reload
  window.history.pushState({}, '', url);
  // Trigger a popstate event to notify React Router
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function extractStationIdFromUrl(url: string): string | null {
  // Extract ID from /stations/:id format
  const idMatch = url.match(/\/stations\/([^\/]+)/);
  if (idMatch) {
    return idMatch[1];
  }
  
  return null;
}

export function extractStationSlugFromUrl(url: string): string | null {
  // Extract slug from /station/:slug format
  const slugMatch = url.match(/\/station\/([^\/]+)/);
  if (slugMatch) {
    return slugMatch[1];
  }
  
  return null;
}
