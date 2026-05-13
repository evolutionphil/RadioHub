// Async CSS Loader - Load non-critical stylesheets after page load

export function loadAsyncCSS(href: string, media = 'all'): void {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.media = media;
  document.head.appendChild(link);
}

export function loadResponsiveCSS(): void {
  // 2026-05-13: previously loaded /styles/{mobile,desktop,non-critical}.css
  // from /public, but those files were never shipped — every visitor got
  // a console error ("Refused to apply style ... MIME type 'text/html'")
  // because the SPA fallback returned the React index page for the
  // missing CSS URLs. All responsive/non-critical rules are already
  // bundled into the main Tailwind/index.css build, so this is now
  // intentionally a no-op. Kept the export so call sites in main.tsx
  // and any future hooks remain stable.
}

export function initAsyncStyles(): void {
  // Load styles after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadResponsiveCSS);
  } else {
    loadResponsiveCSS();
  }
}

// Web Fonts loading - DISABLED
// We use local Ubuntu fonts from /public/fonts/ instead (font-display: swap)
// This eliminates Google Fonts dependency and 50ms delay
export function loadWebFonts(): void {
  // Fonts already loaded via local @font-face in index.css
  // Just mark as loaded to prevent unnecessary retries
  document.documentElement.classList.add('fonts-loaded');
}

// Critical resource hints - REMOVED: Preconnects already in index.html
// Adding duplicate preconnects at runtime hurts performance
export function addResourceHints(): void {
  // No-op: preconnects are already in index.html to avoid duplication
  // PageSpeed recommends max 4 preconnects, adding more hurts performance
}