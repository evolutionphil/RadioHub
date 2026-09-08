export const ADSENSE_CLIENT = 'ca-pub-8771434485570434';
const scriptUrl = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`;
let ready: Promise<boolean> | undefined;

export function isAdSensePage(pathname: string): boolean {
  // Payment confirmation can precede the subscription webhook: a paid
  // visitor may still appear non-premium while this page polls for activation.
  return !/^\/(?:[a-z]{2}\/)?(?:admin(?:\/|-|$)|premium\/success(?:\/|$))/i.test(pathname);
}

/** One SDK for all placements. A blocked SDK is an unavailable ad, not a page
 * error or a reason to keep retrying network requests. Google's published CMP
 * remains responsible for visitors' consent; we never set consent here. */
export function ensureAdSenseScript(): Promise<boolean> {
  if (!isAdSensePage(window.location.pathname)) return Promise.resolve(false);
  if (ready) return ready;
  ready = new Promise<boolean>(resolve => {
    const existing = document.querySelector<HTMLScriptElement>('script[src*="pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"]');
    const script = existing || document.createElement('script');
    if (script.dataset.mrtLoaded === 'true') { resolve(true); return; }
    const finish = (success: boolean) => {
      clearTimeout(timeout);
      script.removeEventListener('load', loaded);
      script.removeEventListener('error', failed);
      if (success) script.dataset.mrtLoaded = 'true';
      resolve(success);
    };
    const loaded = () => finish(true);
    const failed = () => finish(false);
    const timeout = setTimeout(failed, 15000);
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
