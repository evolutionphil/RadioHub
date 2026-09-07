export function parseSeoCatalogPage(url: string): { page: number; valid: boolean } {
  const parameters = new URL(url, 'https://seo.invalid').searchParams;
  const values = parameters.getAll('page');
  if (!values.length) return { page: 1, valid: true };
  if (values.length !== 1 || !/^\d+$/.test(values[0])) return { page: 1, valid: false };
  const page = Number(values[0]);
  return { page, valid: Number.isSafeInteger(page) && page >= 1 };
}

export function isSeoCatalogPath(cleanPath: string): boolean {
  return /^\/stations$/.test(cleanPath) || /^\/(?:station|stations)\/(?:[a-z]|0-9)$/.test(cleanPath)
    || /^\/regions\/[^/]+\/[^/]+(?:\/[^/]+)?(?:\/stations)?$/.test(cleanPath)
    || /^\/country\/[^/]+(?:\/[^/]+)?(?:\/stations)?$/.test(cleanPath);
}

/** A successfully read slice is authoritative; a failed read is never absence. */
export function isMissingSeoCatalogPage(page: number, totalPages: number, rows: readonly unknown[]): boolean {
  return page > 1 && (page > Math.max(1, totalPages) || rows.length === 0);
}

/** Preserve small directories, but bound large directory HTML while keeping
 * first/last and sequential next/previous crawl paths on every valid page. */
export function seoCatalogPageLinks(currentPage: number, totalPages: number): number[] {
  if (totalPages <= 50) return Array.from({ length: totalPages }, (_, index) => index + 1);
  const start = Math.max(2, Math.min(currentPage - 23, totalPages - 47));
  return [...new Set([1, ...Array.from({ length: 47 }, (_, index) => start + index), totalPages])].sort((a, b) => a - b);
}
