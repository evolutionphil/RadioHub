import { getStreamProxyUrl } from '@/lib/utils';
import { getLanguageFromPath } from '@workspace/seo-shared/seo-config';

// Check if browser supports WebP format.
// Memoized: WebP support cannot change during a page's lifetime, so the
// canvas + toDataURL probe (which forces a layout/paint allocation) runs at
// most once instead of on every getOptimizedImageSrc call — an INP win on
// image-heavy list renders. Same return value, zero behavioural change.
let _supportsWebPCache: boolean | undefined;
export const supportsWebP = (): boolean => {
  if (typeof window === 'undefined') return false;
  if (_supportsWebPCache !== undefined) return _supportsWebPCache;

  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    _supportsWebPCache = canvas.toDataURL('image/webp').indexOf('webp') !== -1;
  } catch {
    _supportsWebPCache = false;
  }
  return _supportsWebPCache;
};

// Get optimized image URL with fallbacks
export const getOptimizedImageSrc = (src: string, options?: {
  width?: number;
  height?: number;
  quality?: number;
  format?: 'webp' | 'jpg' | 'png';
}): string => {
  // Check for null, undefined, empty string, or the string "null"
  if (!src || src === 'null' || src === 'undefined' || src.trim() === '') {
    return '/images/no-image.webp';
  }

  // Return as-is for SVG files
  if (src.includes('.svg')) return src;

  // For local images, check if WebP version exists
  if (src.startsWith('/images/') || src.startsWith('/public/')) {
    if (supportsWebP() && !src.includes('.webp')) {
      // Try to get WebP version of local images
      const webpSrc = src.replace(/\.(jpg|jpeg|png)$/i, '.webp');
      return webpSrc;
    }
  }

  // For external images, use proxy for mixed content
  const isMixedContent = typeof window !== 'undefined' && 
    window.location.protocol === 'https:' && src.startsWith('http:');
  
  if (isMixedContent) {
    const encodedUrl = btoa(src).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    return getStreamProxyUrl(`/api/image/${encodedUrl}`);
  }

  return src;
};

// Preload critical images
export const preloadImage = (src: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = getOptimizedImageSrc(src);
  });
};

// Preload critical images for better LCP
export const preloadCriticalImages = async () => {
  if (typeof window === 'undefined') return;

  const criticalImages = ['/header-logo-80w.webp'];
  // Only home renders the hero. Match its <picture> / HTML preload breakpoint
  // so desktop visitors do not also download the unused mobile image.
  if (getLanguageFromPath(window.location.pathname).cleanPath === '/') {
    const desktop = window.matchMedia?.('(min-width: 768px)').matches ?? window.innerWidth >= 768;
    criticalImages.push(desktop ? '/images/hero-bg.webp' : '/images/hero-bg-430w.webp');
  }

  // The HTML normally already starts these requests before JS runs. Keep this
  // helper as a fallback for shells without hints, not a second preloader.
  const hintedImages = new Set(
    Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="image"]'))
      .filter(link => !link.media || window.matchMedia?.(link.media).matches)
      .map(link => link.href),
  );
  const missingImages = criticalImages.filter(src => !hintedImages.has(new URL(src, window.location.href).href));

  try {
    await Promise.all(missingImages.map(preloadImage));
  } catch (error) {
    console.warn('⚠️ Some critical images failed to preload:', error);
  }
};

// Image lazy loading with intersection observer
export class ImageLazyLoader {
  private observer: IntersectionObserver | null = null;
  private images: Set<HTMLImageElement> = new Set();

  constructor(options?: IntersectionObserverInit) {
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) {
      return;
    }

    this.observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const img = entry.target as HTMLImageElement;
          this.loadImage(img);
          this.observer?.unobserve(img);
          this.images.delete(img);
        }
      });
    }, {
      rootMargin: '50px 0px',
      threshold: 0.01,
      ...options
    });
  }

  observe(img: HTMLImageElement) {
    if (!this.observer) {
      this.loadImage(img);
      return;
    }

    this.images.add(img);
    this.observer.observe(img);
  }

  unobserve(img: HTMLImageElement) {
    if (this.observer) {
      this.observer.unobserve(img);
    }
    this.images.delete(img);
  }

  private loadImage(img: HTMLImageElement) {
    const dataSrc = img.dataset.src;
    if (dataSrc) {
      img.src = getOptimizedImageSrc(dataSrc);
      img.removeAttribute('data-src');
    }
  }

  disconnect() {
    if (this.observer) {
      this.observer.disconnect();
      this.images.clear();
    }
  }
}

// Progressive image enhancement
export const enhanceImage = (img: HTMLImageElement) => {
  // A fetch-priority hint must never be contradicted by lazy loading. In
  // particular the home hero has fetchPriority="high" but no loading prop.
  const isPriority = img.getAttribute('fetchpriority') === 'high' || img.dataset.priority === 'high';
  if (isPriority) {
    img.loading = 'eager';
  } else if (!img.getAttribute('loading')) {
    img.loading = 'lazy';
  }

  // Add decoding="async" for better performance
  if (!img.decoding) {
    img.decoding = 'async';
  }

  // Optimize src if not already optimized
  if (img.src && !img.dataset.optimized) {
    const optimizedSrc = getOptimizedImageSrc(img.src);
    if (optimizedSrc !== img.src) {
      // Self-heal (PageSpeed 2026-07-03): the proxied variant 404s when the
      // upstream image is dead or unsupported — previously that left a
      // BROKEN image where the original src still rendered fine, plus a
      // console error per image in Lighthouse's Best Practices audit.
      // Restore the original URL once if the proxied one fails to load.
      const originalSrc = img.src;
      img.addEventListener(
        'error',
        () => {
          if (img.src !== originalSrc) img.src = originalSrc;
        },
        { once: true },
      );
      img.src = optimizedSrc;
    }
    img.dataset.optimized = 'true';
  }
};

// Auto-enhance all images on page
export const enhanceAllImages = () => {
  if (typeof document === 'undefined') return;

  const images = document.querySelectorAll('img');
  images.forEach(enhanceImage);
};

// Initialize image optimizations
export const initImageOptimizations = () => {
  if (typeof window === 'undefined') return;

  // Preload critical images
  preloadCriticalImages();

  // Enhance existing images
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enhanceAllImages);
  } else {
    enhanceAllImages();
  }

  // Watch for new images
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const element = node as Element;
          
          // Enhance the element if it's an image
          if (element.tagName === 'IMG') {
            enhanceImage(element as HTMLImageElement);
          }
          
          // Enhance any images within the element
          const images = element.querySelectorAll('img');
          images.forEach(enhanceImage);
        }
      });
    });
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  return () => observer.disconnect();
};
