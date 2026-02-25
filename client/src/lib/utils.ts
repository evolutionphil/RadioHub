import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Isomorphic base64 encoder that works in both Node.js (SSR) and browser
 * Handles Unicode characters safely (non-ASCII favicon URLs)
 * Uses Buffer in Node.js and properly encodes UTF-8 before btoa in browser
 */
export function safeBase64Encode(str: string): string {
  try {
    if (typeof Buffer !== 'undefined') {
      // Node.js environment (SSR) - Buffer handles UTF-8 natively
      return Buffer.from(str, 'utf-8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    } else if (typeof window !== 'undefined' && typeof btoa === 'function') {
      // Browser environment - encode UTF-8 to Latin1 before btoa
      // This handles non-ASCII characters (like internationalized URLs)
      const utf8Bytes = encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) => 
        String.fromCharCode(parseInt(p1, 16))
      );
      return btoa(utf8Bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    }
  } catch (e) {
    // If encoding fails, return a fallback hash
    console.warn('Base64 encoding failed:', e);
  }
  // Fallback: return simple hash (should not happen in normal usage)
  return '';
}

/**
 * Normalizes a favicon URL and proxies HTTP URLs to prevent mixed content
 * Works in both SSR and client-side contexts
 */
export function normalizeFaviconUrl(favicon: string | undefined | null): string {
  if (!favicon || favicon.trim() === '' || favicon === 'null' || favicon === 'undefined') {
    return '/images/no-image.webp';
  }

  // Handle data URLs (base64 encoded images) - return as-is
  if (favicon.startsWith('data:')) {
    return favicon;
  }

  // Handle local paths (already on our server) - return as-is
  if (favicon.startsWith('/')) {
    return favicon;
  }

  // Normalize URL: handle protocol-relative and missing protocol
  let normalizedUrl = favicon;
  if (normalizedUrl.startsWith('//')) {
    normalizedUrl = `https:${normalizedUrl}`;
  } else if (!normalizedUrl.startsWith('http')) {
    normalizedUrl = `https://${normalizedUrl}`;
  }

  // Only proxy HTTP (mixed content issue). HTTPS and modern servers have proper CORS
  if (normalizedUrl.startsWith('http:')) {
    const encodedUrl = safeBase64Encode(normalizedUrl);
    return `/api/image/${encodedUrl}`;
  }

  return normalizedUrl;
}

// Decode HTML entities in URLs (especially for favicon URLs)
export function decodeHtmlEntities(str: string): string {
  if (!str) return str;
  
  const htmlEntities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&#x27;': "'",
    '&nbsp;': ' '
  };
  
  return str.replace(/&[a-zA-Z0-9#]+;/g, (entity) => {
    return htmlEntities[entity] || entity;
  });
}

// Generate default avatar for users without profile pictures
// Uses UI Avatars API for clean, minimal initials-based avatars
export function getAvatarUrl(user: any): string {
  if (!user) return `https://ui-avatars.com/api/?name=User&background=FF4199&color=fff&bold=true`;
  
  // If user has an avatar, use it
  if (user.avatar && typeof user.avatar === 'string' && user.avatar.trim()) {
    return user.avatar;
  }
  
  // Generate initials from fullName or email
  const name = user.fullName || user.username || user.email || 'User';
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map(part => part.charAt(0).toUpperCase())
    .join('');
  
  // Return UI Avatars URL with initials
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(initials || 'U')}&background=FF4199&color=fff&bold=true&size=40`;
}

// MIXED CONTENT FIX: Encode HTTP image URLs through our image proxy to serve as HTTPS
// This prevents "Mixed content" warnings when HTTPS page loads HTTP resources
// Updated to use safeBase64Encode for SSR compatibility
export function getImageUrl(url: string | null | undefined): string {
  if (!url || url.trim() === '' || url === 'null' || url === 'undefined') {
    return '/images/no-image.webp';
  }

  // If already HTTPS, local path, or data URL - use as-is
  if (url.startsWith('https://') || url.startsWith('/') || url.startsWith('data:')) {
    return url;
  }

  // Handle protocol-relative URLs
  if (url.startsWith('//')) {
    return `https:${url}`;
  }

  // If HTTP, encode through our image proxy endpoint to convert to HTTPS
  if (url.startsWith('http://')) {
    const encoded = safeBase64Encode(url);
    if (encoded) {
      return `/api/image/${encoded}`;
    }
    // If encoding fails, return fallback
    return '/images/no-image.webp';
  }

  // Default for unknown URLs
  return '/images/no-image.webp';
}
