export const COVERAGE_RANGE_OPTIONS = [7, 14, 30, 90, 180] as const;
export type CoverageRangeDays = (typeof COVERAGE_RANGE_OPTIONS)[number];
export const COVERAGE_DEFAULT_RANGE: CoverageRangeDays = 90;

const REMEMBERED_RANGE_KEY = 'admin:coverageRangeDays';

function isRangeDays(n: number): n is CoverageRangeDays {
  return (COVERAGE_RANGE_OPTIONS as readonly number[]).includes(n);
}

export function readCoverageRangeFromUrl(): CoverageRangeDays | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('days');
  if (raw == null) return null;
  const n = Number(raw);
  return isRangeDays(n) ? n : null;
}

export function readRememberedCoverageRange(): CoverageRangeDays | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(REMEMBERED_RANGE_KEY);
    if (raw == null) return null;
    const n = Number(raw);
    return isRangeDays(n) ? n : null;
  } catch {
    return null;
  }
}

export function writeRememberedCoverageRange(days: CoverageRangeDays): void {
  if (typeof window === 'undefined') return;
  try {
    if (days === COVERAGE_DEFAULT_RANGE) {
      // Resetting to the default clears the remembered preference so the
      // page falls back to the shared default on the next visit.
      window.localStorage.removeItem(REMEMBERED_RANGE_KEY);
    } else {
      window.localStorage.setItem(REMEMBERED_RANGE_KEY, String(days));
    }
  } catch {
    // Best-effort — quota / privacy mode.
  }
}

// Pick the initial range for a coverage page: an explicit `?days=` in the
// URL always wins (so shared links keep working), otherwise fall back to
// the admin's remembered choice, otherwise the shared default.
export function resolveInitialCoverageRange(): CoverageRangeDays {
  return (
    readCoverageRangeFromUrl() ??
    readRememberedCoverageRange() ??
    COVERAGE_DEFAULT_RANGE
  );
}
