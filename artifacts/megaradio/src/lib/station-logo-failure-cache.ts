// An image element cannot distinguish a 404 from transient network failure.
// Keep this short-lived and per-page, never persist it or rewrite station data.
const failures = new Map<string, number>();
const TTL_MS = 30_000;
const MAX_ENTRIES = 256;
function key(url: string): string {
  try { return new URL(url, typeof location !== 'undefined' ? location.origin : 'https://themegaradio.com').href; }
  catch { return url; }
}
export function hasRecentStationLogoFailure(url: string): boolean {
  const normalized = key(url);
  const until = failures.get(normalized);
  if (until === undefined) return false;
  if (until <= Date.now()) { failures.delete(normalized); return false; }
  return true;
}
export function rememberStationLogoFailure(url: string): void {
  if (!url || url.startsWith('data:') || url.endsWith('/images/no-image.webp')) return;
  const normalized = key(url);
  failures.delete(normalized);
  failures.set(normalized, Date.now() + TTL_MS);
  if (failures.size > MAX_ENTRIES) failures.delete(failures.keys().next().value!);
}
export function clearStationLogoFailure(url: string): void { failures.delete(key(url)); }
export function clearStationLogoFailureCache(): void { failures.clear(); }
