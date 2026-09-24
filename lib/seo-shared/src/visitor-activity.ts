import { URL_TRANSLATIONS } from './url-translations';

export const REFERRAL_CATEGORIES = ['google', 'search', 'social', 'internal', 'direct-or-unknown', 'other-referral'] as const;
export type VisitorReferralCategory = typeof REFERRAL_CATEGORIES[number];
export const VISITOR_AUTOMATION_STATUSES = ['unknown', 'browser-like', 'automated'] as const;
export type VisitorAutomationStatus = typeof VISITOR_AUTOMATION_STATUSES[number];
export const VISITOR_ACTIVITY_ACTIONS = ['page-view', 'station-view', 'play-request', 'favorite-add', 'favorite-remove', 'rating-submit'] as const;
export type VisitorActivityAction = typeof VISITOR_ACTIVITY_ACTIONS[number];
export type VisitorActivitySource = 'http' | 'client-pageview';
export type VisitorTrafficKind = 'qualified' | 'automated';

const LANGUAGES = new Set(['en','es','fr','de','pt','it','ru','ar','zh','tr','ja','ko','hi','he']);
const STATIC_PAGES = new Set(['about','applications','contact','discover','favorites','feedback','genres','notifications',
  'privacy-policy','radios','recommendations','records','regions','request-station','search','settings','stations',
  'terms-and-conditions','trending','tv','users']);
const PRIVATE_PAGES = new Set(['profile','messages','users']);
const PROFILE_SECTIONS = new Set(['settings','favorites','discover','notifications','messages']);
const MESSAGE_SEGMENTS: Record<string,string> = { de:'nachrichten',es:'mensajes',fr:'messages',pt:'mensagens',it:'messaggi',ru:'soobshcheniya',tr:'mesajlar' };
const SLUG = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,159}$/u;

/** A display-only route, never a URL or an identifier for a person. The same
 * function runs before client transmission and again at server ingestion.
 * Only known route shapes survive; query/hash and private identifiers never do. */
export function sanitizeVisitorPagePath(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 512 || !input.startsWith('/') || input.startsWith('//')
      || /[\\\u0000-\u0020\u007f]/.test(input)) return null;
  const bare = input.split(/[?#]/, 1)[0];
  let decoded: string;
  try { decoded = decodeURIComponent(bare); } catch { return null; }
  if (/[\\%?#\u0000-\u0020\u007f]/.test(decoded) || /%2f|%5c/i.test(bare)
      || decoded.includes('//') || decoded.split('/').some(part => part === '.' || part === '..')) return null;
  const parts = decoded.replace(/\/$/, '').split('/').slice(1);
  let prefix = '';
  let language = 'en';
  if (LANGUAGES.has(parts[0])) { language = parts.shift()!; prefix = `/${language}`; }
  if (!parts.length || parts.length === 1 && !parts[0]) return prefix || '/';
  const translations = URL_TRANSLATIONS[language] ?? {};
  let route = parts[0];
  // A translated plural may equal the singular (German 'sender'). Shape wins.
  if (parts.length === 2 && route === translations.station) route = 'station';
  else if (!STATIC_PAGES.has(route) && !PRIVATE_PAGES.has(route) && route !== 'station') {
    route = Object.keys(translations).find(key => translations[key] === route) ?? route;
  }
  if (PRIVATE_PAGES.has(route)) {
    if (parts.length === 1) return `${prefix}/${route}`;
    if (route === 'profile') {
      const section = Object.keys(translations).find(key => translations[key] === parts[1] && PROFILE_SECTIONS.has(key))
        ?? (parts[1] === MESSAGE_SEGMENTS[language] ? 'messages' : parts[1]);
      if (PROFILE_SECTIONS.has(section) && parts.length === 2) return `${prefix}/profile/${section}`;
      if (section === 'messages' && parts.length === 3) return `${prefix}/profile/messages/:redacted`;
      // A public profile identifier is redacted; unknown deeper private paths are omitted.
    }
    if (parts.length === 2) return `${prefix}/${route}/:redacted`;
    // Only these known profile sections; no private identifiers or free text.
    if (parts.length === 3 && ['favorites','recently-played','followers','following'].includes(parts[2]))
      return `${prefix}/${route}/:redacted/${parts[2]}`;
    return null;
  }
  if (parts.length === 1 && STATIC_PAGES.has(route)) return `${prefix}/${route}`;
  if (parts.length === 2 && ['station','stations','genres'].includes(route) && SLUG.test(parts[1]))
    return `${prefix}/${route}/${parts[1]}`;
  if (route === 'regions' && parts.length >= 2 && parts.length <= 5
      && parts.slice(1).every((part,index) => SLUG.test(part) || part === [':region',':country',':city'][index])
      && (parts.length !== 5 || parts[4] === 'stations')) {
    return `${prefix}/regions/:region${parts.length >= 3 ? '/:country' : ''}${parts.length >= 4 ? '/:city' : ''}${parts.length === 5 && parts[4] === 'stations' ? '/stations' : ''}`;
  }
  return null;
}

function inDomain(host: string, domain: string): boolean { return host === domain || host.endsWith(`.${domain}`); }

/** Referrers are reduced locally to this enum. Never transmit/store the input. */
export function classifyVisitorReferral(rawReferrer: unknown): VisitorReferralCategory {
  if (typeof rawReferrer !== 'string' || !rawReferrer || rawReferrer.length > 4096) return 'direct-or-unknown';
  let url: URL;
  try { url = new URL(rawReferrer); } catch { return 'direct-or-unknown'; }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return 'direct-or-unknown';
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (inDomain(host, 'themegaradio.com')) return 'internal';
  if (['google.com','google.de','google.co.uk','google.fr','google.es','google.it','google.com.tr','google.co.jp',
    'google.co.in','google.com.br','google.ca','google.com.au','google.ch','google.at','google.nl'].some(domain => inDomain(host, domain))) return 'google';
  if (['bing.com','duckduckgo.com','search.yahoo.com','search.brave.com','ecosia.org','qwant.com','yandex.com','yandex.ru','baidu.com'].some(domain => inDomain(host, domain))) return 'search';
  if (['facebook.com','fb.com','instagram.com','twitter.com','x.com','t.co','linkedin.com','youtube.com','youtu.be','reddit.com','tiktok.com','pinterest.com'].some(domain => inDomain(host, domain))) return 'social';
  return 'other-referral';
}
