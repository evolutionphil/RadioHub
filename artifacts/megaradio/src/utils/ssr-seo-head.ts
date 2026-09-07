import { createContext } from 'react';

export const ServerSeoHeadContext = createContext(false);

/** Keep the server's page-specific head until the first in-app navigation. */
export function createInitialSsrHeadGuard(initialUrl: string | null) {
  let leftInitialPage = false;
  return (url: string): boolean => {
    if (!initialUrl) return false;
    if (url !== initialUrl) leftInitialPage = true;
    return !leftInitialPage && url === initialUrl;
  };
}

// The canonical marker is emitted by seo-renderer, unlike translation keys
// which describe the homepage even on a station, country or static page.
const initialSsrUrl = typeof document !== 'undefined'
  && document.querySelector('link[rel="canonical"][data-managed="seo-head"]')
  ? window.location.pathname + window.location.search
  : null;

export const preserveInitialSsrHead = createInitialSsrHeadGuard(initialSsrUrl);
