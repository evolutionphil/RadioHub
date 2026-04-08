import { getApiProxyUrl } from '@/lib/utils';

// Check if browser supports WebP format
export const supportsWebP = (): boolean => {
  if (typeof window === 'undefined') return false;
  
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    return canvas.toDataURL('image/webp').indexOf('webp') !== -1;
  } catch {
    return false;
  }
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
    return getApiProxyUrl(`/api/image/${encodedUrl}`);
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

  const criticalImages = [
    '/images/hero-bg-430w.webp',
    '/header-logo-80w.webp',
    '/images/no-image.webp'
  ];

  try {
    await Promise.all(criticalImages.map(preloadImage));
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
  // Add loading="lazy" if not present
  if (!img.loading) {
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