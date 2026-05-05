import { useEffect } from 'react';
import { useLocation } from 'wouter';

/**
 * Hook that automatically scrolls to the top of the page when the route changes.
 * This ensures users always start at the top of a new page, providing better UX.
 */
export function useScrollToTop() {
  const [location] = useLocation();

  useEffect(() => {
    // Scroll to top with smooth behavior when route changes
    window.scrollTo({
      top: 0,
      left: 0,
      behavior: 'smooth'
    });
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