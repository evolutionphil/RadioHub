import { useEffect } from 'react';
import { useLocation } from 'wouter';

/**
 * Hook that automatically scrolls to the top of the page when the route changes.
 * This ensures users always start at the top of a new page, providing better UX.
 */
export function useScrollToTop() {
  const [location] = useLocation();

  useEffect(() => {
    // INSTANT scroll (2026-07-04): the previous smooth scroll raced against
    // async content rendering on route change — layout shifts cancelled the
    // animation mid-flight and station detail pages regularly opened stuck
    // at the previous page's scroll depth. Instant reset is deterministic;
    // also reset both scrolling elements for cross-browser safety.
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [location]);
}

/**
 * Alternative hook for immediate scroll to top without smooth behavior.
 * Use this when you need instant scrolling (e.g., for performance reasons).
 */
export function useScrollToTopInstant() {
  const [location] = useLocation();

  useEffect(() => {
    // Instant scroll to top when route changes
    window.scrollTo(0, 0);
  }, [location]);
}