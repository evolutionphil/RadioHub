// Actual AdSense display-unit IDs verified in the publisher dashboard.
// Auto Ads/Auto Optimize are disabled: these are the only Google placements.
export const AD_SLOTS = {
  catalogFooter: '9151849981',
  stationSidebar: '3609188113',
  stationContent: '3667990641',
} as const;

// One visible mobile station slot, or sidebar + one content slot on desktop.
// Long mobile station grids move the existing footer slot after eight cards;
// they do not add another placement. Short grids intentionally remain ad-free.
export const CATALOG_AD_AFTER = 8;
export const CATALOG_AD_MIN_STATIONS = 12;

export function usesInlineMobileCatalogAd(url: string): boolean {
  const type = getAdSensePageType(url);
  if (type !== 'home' && type !== 'catalog') return false;
  const { language, cleanPath } = getLanguageFromPath(url.split(/[?#]/)[0]);
  const path = reverseTranslateUrl(cleanPath, language).replace(/\/+$/, '') || '/';
  return path === '/' || path === '/radios' || path === '/stations' || /^\/genres\/[^/]+$/.test(path);
}

// Never add a second footer ad to station pages.
export const DIRECT_AD_ROTATION_MS = 30_000;
import { getLanguageFromPath } from '@workspace/seo-shared/seo-config';
import { reverseTranslateUrl } from '@workspace/seo-shared/url-translations';
import { getAdSensePageType } from './adsense-runtime';
