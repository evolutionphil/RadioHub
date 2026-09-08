// Actual AdSense display-unit IDs verified in the publisher dashboard.
// Auto Ads/Auto Optimize are disabled: these are the only Google placements.
export const AD_SLOTS = {
  catalogFooter: '9151849981',
  stationSidebar: '3609188113',
  stationContent: '3667990641',
} as const;

// One visible mobile station slot, or sidebar + one content slot on desktop.
// Catalogs get one footer slot. Never add a second footer ad to station pages.
export const DIRECT_AD_ROTATION_MS = 30_000;
