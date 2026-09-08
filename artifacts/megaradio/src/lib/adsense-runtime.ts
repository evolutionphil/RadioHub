import { ACTIVE_SITEMAP_LANGUAGES } from '@workspace/seo-shared/seo-config';
import { normalizeUrlForLanguage, reverseTranslateUrl } from '@workspace/seo-shared/url-translations';

export const ADSENSE_CLIENT = 'ca-pub-8771434485570434';
const scriptUrl = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`;
let ready: Promise<boolean> | undefined;
let failedOwnedScript: HTMLScriptElement | undefined;
let reconnectRetried = false;

export function getAdSensePageType(pathname: string): 'home' | 'station' | 'catalog' | null {
  // Fail closed: account, social, auth, payment, legal and unknown route types
  // must not acquire advertising merely because the shared footer is mounted.
  if (!pathname.startsWith('/') || pathname.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(pathname)) return null;
  const path = pathname.split(/[?#]/, 1)[0];
  if (/%2f|%5c/i.test(path)) return null;
  const query = new URLSearchParams(pathname.split('#', 1)[0].split('?')[1] || '');
  // Explicit personal view selectors are private even on the homepage URL.
  for (const key of ['tab', 'view']) if (/^(?:favorites?|recent(?:ly[-_]?played)?|history|discover|recommendations?|messages?|profile|account)$/i.test(query.get(key) || '')) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(path); } catch { return null; }
  if (decoded.split('/').some(part => part === '.' || part === '..')) return null;
  const parts = path.split('/').filter(Boolean);
  const first = parts[0]?.toLowerCase();
  const localized = ACTIVE_SITEMAP_LANGUAGES.some(language => language === first);
  if (first?.length === 2 && !localized) return null;
  const language = localized ? first : 'en';
  const normalized = normalizeUrlForLanguage(path, language).normalized;
  const cleanPath = localized ? `/${normalized.split('/').filter(Boolean).slice(1).join('/')}` : normalized;
  const canonical = reverseTranslateUrl(cleanPath, language).replace(/\/+$/, '') || '/';
  if (canonical === '/') return 'home';
  if (/^\/stations?\/[^/]+$/.test(canonical) && !/^\/stations?\/(?:0-9|[a-z])$/.test(canonical)) return 'station';
  return /^\/(?:radios|stations|genres|regions)$/.test(canonical)
    || /^\/(?:station|stations)\/(?:0-9|[a-z])$/.test(canonical)
    || /^\/(?:genres|radios)\/[^/]+$/.test(canonical)
    || /^\/regions\/[^/]+(?:\/[^/]+)?$/.test(canonical)
    || /^\/regions\/[^/]+\/[^/]+(?:\/[^/]+)?\/stations$/.test(canonical) ? 'catalog' : null;
}

export const isAdSensePage = (pathname: string): boolean => getAdSensePageType(pathname) !== null;

const advertisementLabels: Record<string, string> = { en: 'Advertisement', de: 'Werbung', tr: 'Reklam', es: 'Publicidad', fr: 'Publicité',
  pt: 'Publicidade', it: 'Pubblicità', ru: 'Реклама', ar: 'إعلان', zh: '广告', ja: '広告', ko: '광고', hi: 'विज्ञापन', he: 'פרסומת' };
export const getAdvertisementLabel = (language: string): string => advertisementLabels[language.toLowerCase().split('-')[0]] || advertisementLabels.en;

/** One SDK for all placements. A slow request may finish without blocking the
 * page. A real load error permits just one shared reconnect recovery, never
 * ad/no-fill refreshes. Google's CMP remains responsible for visitor consent. */
export function ensureAdSenseScript(retryAfterReconnect = false): Promise<boolean> {
  if (!isAdSensePage(window.location.pathname + window.location.search)) return Promise.resolve(false);
  if (retryAfterReconnect && navigator.onLine !== false && failedOwnedScript && !reconnectRetried) {
    reconnectRetried = true;
    // Only remove our own definitively failed resource, never a working SDK
    // or a tag supplied by another integration. No automatic retry loop.
    failedOwnedScript.remove();
    failedOwnedScript = undefined;
    ready = undefined;
  }
  if (ready) return ready;
  ready = new Promise<boolean>(resolve => {
    const existing = document.querySelector<HTMLScriptElement>('script[src*="pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"]');
    const script = existing || document.createElement('script');
    if (script.dataset.mrtLoaded === 'true') { resolve(true); return; }
    const finish = (success: boolean) => {
      script.removeEventListener('load', loaded);
      script.removeEventListener('error', failed);
      if (success) script.dataset.mrtLoaded = 'true';
      else if (!existing) failedOwnedScript = script;
      resolve(success);
    };
    const loaded = () => finish(true);
    const failed = () => finish(false);
    // Do not latch a timeout as failure: browsers can complete the same
    // request later, and the awaiting placements should still be notified.
    script.addEventListener('load', loaded, { once: true });
    script.addEventListener('error', failed, { once: true });
    if (!existing) {
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.src = scriptUrl;
      document.head.appendChild(script);
    }
  });
  return ready;
}
