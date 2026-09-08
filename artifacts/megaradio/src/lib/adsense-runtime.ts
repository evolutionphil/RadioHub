export const ADSENSE_CLIENT = 'ca-pub-8771434485570434';
const scriptUrl = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`;
let ready: Promise<boolean> | undefined;
let failedOwnedScript: HTMLScriptElement | undefined;
let reconnectRetried = false;

export function isAdSensePage(pathname: string): boolean {
  // Payment confirmation can precede the subscription webhook: a paid
  // visitor may still appear non-premium while this page polls for activation.
  return !/^\/(?:[a-z]{2}\/)?(?:admin(?:\/|-|$)|premium\/success(?:\/|$))/i.test(pathname);
}

/** One SDK for all placements. A slow request may finish without blocking the
 * page. A real load error permits just one shared reconnect recovery, never
 * ad/no-fill refreshes. Google's CMP remains responsible for visitor consent. */
export function ensureAdSenseScript(retryAfterReconnect = false): Promise<boolean> {
  if (!isAdSensePage(window.location.pathname)) return Promise.resolve(false);
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
