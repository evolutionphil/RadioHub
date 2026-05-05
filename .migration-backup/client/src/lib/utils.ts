import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

const _API_BASE = import.meta.env.VITE_API_BASE_URL || '';
const _STREAM_PROXY_BASE = import.meta.env.VITE_STREAM_PROXY_URL || _API_BASE || '';

export function getApiProxyUrl(path: string): string {
  if (!_API_BASE || !path.startsWith('/api')) return path;
  return `${_API_BASE}${path}`;
}

export function getStreamProxyUrl(path: string): string {
  if (!_STREAM_PROXY_BASE || !path.startsWith('/api')) return path;
  return `${_STREAM_PROXY_BASE}${path}`;
}

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
      return Buffer.from(str, 'utf-8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    } else if (typeof window !== 'undefined' && typeof btoa === 'function') {
      const utf8Bytes = encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) => 
        String.fromCharCode(parseInt(p1, 16))
      );
      return btoa(utf8Bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    }
  } catch (e) {
    console.warn('Base64 encoding failed:', e);
  }
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

  if (favicon.startsWith('data:')) {
    return favicon;
  }

  if (favicon.startsWith('/')) {
    return favicon;
  }

  let normalizedUrl = favicon;
  if (normalizedUrl.startsWith('//')) {
    normalizedUrl = `https:${normalizedUrl}`;
  } else if (!normalizedUrl.startsWith('http')) {
    normalizedUrl = `https://${normalizedUrl}`;
  }

  if (normalizedUrl.startsWith('http:')) {
    const encodedUrl = safeBase64Encode(normalizedUrl);
    return getStreamProxyUrl(`/api/image/${encodedUrl}`);
  }

  return normalizedUrl;
}

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

export function getAvatarUrl(user: any): string {
  if (!user) return `https://ui-avatars.com/api/?name=User&background=FF4199&color=fff&bold=true`;
  
  if (user.avatar && typeof user.avatar === 'string' && user.avatar.trim()) {
    return user.avatar;
  }
  
  const name = user.fullName || user.username || user.email || 'User';
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((part: string) => part.charAt(0).toUpperCase())
    .join('');
  
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(initials || 'U')}&background=FF4199&color=fff&bold=true&size=40`;
}

export function getImageUrl(url: string | null | undefined): string {
  if (!url || url.trim() === '' || url === 'null' || url === 'undefined') {
    return '/images/no-image.webp';
  }

  if (url.startsWith('https://') || url.startsWith('/') || url.startsWith('data:')) {
    return url;
  }

  if (url.startsWith('//')) {
    return `https:${url}`;
  }

  if (url.startsWith('http://')) {
    const encoded = safeBase64Encode(url);
    if (encoded) {
      return getStreamProxyUrl(`/api/image/${encoded}`);
    }
    return '/images/no-image.webp';
  }

  return '/images/no-image.webp';
}
