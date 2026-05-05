// Performance utilities for Core Web Vitals optimization

// Intersection Observer for lazy loading
export const createLazyLoadObserver = (callback: (entries: IntersectionObserverEntry[]) => void) => {
  if (typeof window === 'undefined' || !('IntersectionObserver' in window)) {
    return null;
  }

  return new IntersectionObserver(callback, {
    rootMargin: '50px 0px',
    threshold: 0.01,
  });
};

// Preload critical resources
export const preloadResource = (href: string, as: string, type?: string) => {
  if (typeof document === 'undefined') return;

  const link = document.createElement('link');
  link.rel = 'preload';
  link.href = href;
  link.as = as;
  if (type) link.type = type;
  document.head.appendChild(link);
};

// Optimize image loading with WebP support
export const getOptimizedImageUrl = (src: string): string => {
  if (!src) return '/images/no-image.webp';
  
  // If already WebP or SVG, return as-is
  if (src.includes('.webp') || src.includes('.svg')) {
    return src;
  }
  
  // For local images, prefer WebP version
  if (src.startsWith('/images/') && (src.includes('.jpg') || src.includes('.jpeg') || src.includes('.png'))) {
    return src.replace(/\.(jpg|jpeg|png)$/i, '.webp');
  }
  
  return src;
};

// Debounce function for performance
export const debounce = <T extends (...args: any[]) => void>(
  func: T,
  wait: number
): ((...args: Parameters<T>) => void) => {
  let timeout: NodeJS.Timeout;
  
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
};

// Throttle function for scroll events
export const throttle = <T extends (...args: any[]) => void>(
  func: T,
  limit: number
): ((...args: Parameters<T>) => void) => {
  let inThrottle: boolean;
  
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
};

// Core Web Vitals monitoring
export const measureCoreWebVitals = () => {
  if (typeof window === 'undefined') return;

  // Largest Contentful Paint (LCP)
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.entryType === 'largest-contentful-paint') {
        console.log('LCP:', entry.startTime);
      }
    }
  });

  try {
    observer.observe({ entryTypes: ['largest-contentful-paint'] });
  } catch (e) {
    // Browser doesn't support LCP
  }

  // First Input Delay (FID)
  const fidObserver = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      console.log('FID:', (entry as any).processingStart - entry.startTime);
    }
  });

  try {
    fidObserver.observe({ entryTypes: ['first-input'] });
  } catch (e) {
    // Browser doesn't support FID
  }

  // Cumulative Layout Shift (CLS) - Temporarily disabled for debugging
  // let clsValue = 0;
  // let clsEntries: any[] = [];

  // const clsObserver = new PerformanceObserver((list) => {
  //   for (const entry of list.getEntries()) {
  //     if (!(entry as any).hadRecentInput) {
  //       clsValue += (entry as any).value;
  //       clsEntries.push(entry);
  //       console.log('CLS:', clsValue);
  //     }
  //   }
  // });

  // try {
  //   clsObserver.observe({ entryTypes: ['layout-shift'] });
  // } catch (e) {
  //   // Browser doesn't support CLS
  // }
};

// Initialize performance monitoring in development
if (process.env.NODE_ENV === 'development') {
  if (typeof window !== 'undefined') {
    window.addEventListener('load', measureCoreWebVitals);
  }
}