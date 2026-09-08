import { useEffect, useRef, useState } from 'react';
import { useLocation, useSearch } from 'wouter';

export function parseGenrePage(search: string): number {
  const values = new URLSearchParams(search).getAll('page');
  if (values.length !== 1 || !/^[1-9]\d*$/.test(values[0])) return 1;
  const page = Number(values[0]);
  return Number.isSafeInteger(page) ? page : 1;
}

export function useGenreMobileViewport() {
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', update, { passive: true });
    return () => window.removeEventListener('resize', update);
  }, []);
  return isMobile;
}

/** URL pagination survives reload/back/forward; only same-page filter changes reset it. */
export function useGenrePagination(filterScope: string) {
  const [location, navigate] = useLocation();
  const search = useSearch();
  const previous = useRef({ location, filterScope });
  const filterChanged = previous.current.location === location && previous.current.filterScope !== filterScope;
  const currentPage = filterChanged ? 1 : parseGenrePage(search);

  const navigatePage = (page: number, replace = false) => {
    const params = new URLSearchParams(search);
    if (Number.isSafeInteger(page) && page > 1) params.set('page', String(page));
    else params.delete('page');
    const query = params.toString();
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    navigate(`${location}${query ? `?${query}` : ''}${hash}`, { replace });
  };

  useEffect(() => {
    previous.current = { location, filterScope };
    if (filterChanged) navigatePage(1, true);
    // navigatePage intentionally reads the current search, preserving unrelated parameters.
  }, [location, filterScope, filterChanged, search, navigate]);

  const changePage = (page: number) => {
    navigatePage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  return { currentPage, changePage };
}
