// Async CSS Loader - Load non-critical stylesheets after page load

export function loadAsyncCSS(href: string, media = 'all'): void {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.media = media;
  document.head.appendChild(link);
}

export function loadResponsiveCSS(): void {
  // Load device-specific CSS based on screen size
  const isMobile = window.innerWidth <= 768;
  const isDesktop = window.innerWidth > 768;

  // Load appropriate device-specific styles
  if (isMobile) {
    loadAsyncCSS('/styles/mobile.css', '(max-width: 768px)');
  } else if (isDesktop) {
    loadAsyncCSS('/styles/desktop.css', '(min-width: 769px)');
  }

  // Load non-critical styles after initial render
  setTimeout(() => {
    loadAsyncCSS('/styles/non-critical.css');
  }, 100);
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