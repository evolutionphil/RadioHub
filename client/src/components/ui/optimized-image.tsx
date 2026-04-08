import { useState, memo, useRef, useEffect, useCallback } from "react";
import { getApiProxyUrl } from "@/lib/utils";

interface OptimizedImageProps {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  className?: string;
  loading?: "lazy" | "eager";
  priority?: boolean;
  fallbackSrc?: string;
  placeholder?: string;
  srcSet?: string;
  sizes?: string;
  useWebP?: boolean;
}

/**
 * OptimizedImage component with responsive srcset support for Google Discover
 * 
 * Features:
 * - Responsive images with srcset and sizes for optimal performance
 * - WebP + AVIF formats with JPEG fallback using <picture> element
 * - Lazy loading for below-fold images using Intersection Observer
 * - Mixed content (HTTP/HTTPS) protection via image proxy
 * - Automatic fallback to placeholder on error
 * 
 * Google Discover Requirements:
 * - Images must be at least 1200px wide for Discover eligibility
 * - Use srcSet to provide multiple resolutions (1200w, 800w, 400w)
 * - Use sizes attribute to tell browser which size to use based on viewport
 * 
 * Example usage with srcset:
 * <OptimizedImage
 *   src="/images/genre-pop-800.webp"
 *   srcSet="/images/genre-pop-1200.webp 1200w, /images/genre-pop-800.webp 800w, /images/genre-pop-400.webp 400w"
 *   sizes="(min-width: 1200px) 400px, (min-width: 768px) 300px, 200px"
 *   alt="Pop music genre - Discover the best pop radio stations worldwide"
 *   useWebP={true}
 * />
 */
const OptimizedImage = memo(function OptimizedImage({
  src,
  alt,
  width,
  height,
  className = "",
  loading = "lazy",
  priority = false,
  fallbackSrc = "/images/no-image.webp",
  placeholder = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0IiBmaWxsPSIjNDA0MDQwIi8+Cjwvc3ZnPgo=",
  srcSet,
  sizes,
  useWebP = false
}: OptimizedImageProps) {
  const [imageSrc, setImageSrc] = useState(src || fallbackSrc);
  const [isLoaded, setIsLoaded] = useState(priority); // Prioritized images are considered "loaded" immediately
  const [hasError, setHasError] = useState(false);
  const [shouldLoad, setShouldLoad] = useState(priority); // Intersection Observer for lazy load
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 🚀 Intersection Observer for native image lazy loading optimization
  useEffect(() => {
    if (priority || !containerRef.current) return; // Skip for priority images
    
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setShouldLoad(true);
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: '50px' } // Start loading 50px before image enters viewport
    );

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [priority]);

  useEffect(() => {
    if (src && shouldLoad) {
      loadImage();
    }
  }, [src, shouldLoad]);

  const loadImage = () => {
    if (!src || src === 'null' || src === 'undefined' || src.trim() === '' || hasError) {
      setImageSrc(fallbackSrc);
      setIsLoaded(true);
      return;
    }

    // Proxy ALL external images (both HTTP and HTTPS) to fix mixed content and 404 issues
    // External images are those that start with http:// or https:// and are not relative paths
    const isExternalImage = src.startsWith('http://') || src.startsWith('https://');
    const isOurDomain = src.includes(window.location.hostname);
    const needsProxy = isExternalImage && !isOurDomain;
    
    let optimizedSrc = src;
    
    if (needsProxy) {
      // Base64 encode the URL for proxying
      const encodedUrl = btoa(src).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
      optimizedSrc = getApiProxyUrl(`/api/image/${encodedUrl}`);
    }

    setImageSrc(optimizedSrc);
    setIsLoaded(false);
    setHasError(false);
  };

  const handleImageLoad = () => {
    setIsLoaded(true);
    setHasError(false);
  };

  const handleImageError = () => {
    if (imageSrc !== fallbackSrc) {
      setImageSrc(fallbackSrc);
      setHasError(false);
    } else {
      setHasError(true);
    }
    setIsLoaded(true);
  };

  const commonProps = {
    alt,
    width,
    height,
    className,
    onLoad: handleImageLoad,
    onError: handleImageError,
    loading: priority ? "eager" as const : loading,
    decoding: "async" as const,
    fetchpriority: priority ? "high" as const : "auto" as const,
    style: {
      backgroundColor: hasError ? "#404040" : "transparent",
      width: width ? `${width}px` : undefined,
      height: height ? `${height}px` : undefined,
      minWidth: width ? `${width}px` : undefined,
      minHeight: height ? `${height}px` : undefined,
      maxWidth: width ? `${width}px` : undefined,
      maxHeight: height ? `${height}px` : undefined,
      objectFit: 'cover' as const,
      display: 'block' as const,
      opacity: 1
    }
  };

  // Use <picture> element for AVIF + WebP with JPEG fallback (Google Discover + Performance optimization)
  if (useWebP && srcSet) {
    const avifSrcSet = srcSet.replace(/\.(jpg|jpeg|png)/gi, '.avif');
    const webpSrcSet = srcSet.replace(/\.(jpg|jpeg|png)/gi, '.webp');
    const fallbackSrcSet = srcSet;

    return (
      <div ref={containerRef} style={{ display: 'contents' }}>
        <picture>
          <source type="image/avif" srcSet={avifSrcSet} sizes={sizes} />
          <source type="image/webp" srcSet={webpSrcSet} sizes={sizes} />
          <source type="image/jpeg" srcSet={fallbackSrcSet} sizes={sizes} />
          <img
            ref={imgRef}
            src={imageSrc}
            {...commonProps}
          />
        </picture>
      </div>
    );
  }

  // Use srcset for responsive images without WebP
  if (srcSet) {
    return (
      <div ref={containerRef} style={{ display: 'contents' }}>
        <img
          ref={imgRef}
          src={imageSrc}
          srcSet={srcSet}
          sizes={sizes}
          {...commonProps}
        />
      </div>
    );
  }

  // Standard image without srcset
  return (
    <div ref={containerRef} style={{ display: 'contents' }}>
      <img
        ref={imgRef}
        src={imageSrc}
        {...commonProps}
      />
    </div>
  );
});

export default OptimizedImage;