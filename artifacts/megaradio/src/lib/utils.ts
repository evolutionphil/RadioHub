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

/**
 * Decide whether a raw upstream stream URL must be tunnelled through the
 * stream proxy (stream.themegaradio.com / VITE_STREAM_PROXY_URL).
 *
 * Chrome silently kills these direct loads because:
 *   - `http://` on an `https://` page → mixed-content block (ERR_EMPTY_RESPONSE)
 *   - `https://host:80/...` or `:8000/:8080` → forced plaintext on a TLS port
 *     scheme combo, browser refuses (also ERR_EMPTY_RESPONSE in prod logs)
 *   - Upstream TLS cert expired / hostname mismatch → ERR_CERT_DATE_INVALID
 *     (the only signal we have for this AHEAD of a play attempt is the
 *     `sslError` flag we ingest from Radio-Browser into Mongo, which is
 *     surfaced on the station object as `sslError: true`)
 *
 * Returns the URL the audio element / hls.js should actually load. When
 * proxying is needed, the URL is base64url-encoded and routed through
 * `/api/stream/<encoded>`.
 */
export function resolveStreamUrl(
  rawUrl: string,
  station?: Record<string, any> | null,
): string {
  if (!rawUrl) return rawUrl;

  let needsProxy = false;

  // 1. Plain HTTP on an HTTPS page → mixed content.
  if (rawUrl.startsWith('http://') && typeof window !== 'undefined' && window.location.protocol === 'https:') {
    needsProxy = true;
  }

  // 2. Explicit plaintext port baked into an https URL (Icecast/Shoutcast
  //    style) — Chrome treats these as mixed content too. Match :80/:8000/
  //    :8080/:8888/:8443 immediately followed by `/` or end of authority.
  if (!needsProxy && /^https?:\/\/[^/]+:(80|8000|8080|8888)(\/|$)/.test(rawUrl)) {
    needsProxy = true;
  }

  // 3. Radio-Browser already flagged the upstream cert as invalid for this
  //    station — route preemptively rather than waiting for the load to
  //    fail with ERR_CERT_DATE_INVALID.
  if (!needsProxy && station?.sslError === true) {
    needsProxy = true;
  }

  if (!needsProxy) return rawUrl;

  const encoded = safeBase64Encode(rawUrl);
  if (!encoded) return rawUrl;
  return getStreamProxyUrl(`/api/stream/${encoded}`);
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

  // Route BOTH http: and https: external favicons through the /api/image proxy.
  // Emitting the raw external URL caused Ahrefs "Page has broken image": many
  // favicon hosts 403 non-browser crawler UAs (or enforce hotlink protection),
  // so the <img> failed for crawlers even though it renders fine in a browser.
  // The proxy re-fetches with a desktop-browser User-Agent and serves the bytes
  // from our own domain (CDN-cached 7d), so the image resolves 200 for crawlers
  // too. NOTE: processed S3 logos never reach here — StationLogo resolves those
  // via resolveLogoUrl; this normalizer only ever receives the external favicon.
  if (normalizedUrl.startsWith('http://') || normalizedUrl.startsWith('https://')) {
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

// OAuth users (Google, Apple, Facebook) get a synthetic username like
// `user_1757414854761_ss3eg6yf0` to satisfy the unique-username constraint.
// That value must never be shown — it is not a real handle the user chose.
const GENERATED_USERNAME_RE = /^user_\d+_[a-z0-9]+$/i;

export function getUserDisplayName(user: any): string {
  if (!user) return "User";
  if (user.fullName && user.fullName.trim()) return user.fullName;
  if (user.username && !GENERATED_USERNAME_RE.test(user.username)) return user.username;
  if (user.email) return user.email.split("@")[0];
  return "User";
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
