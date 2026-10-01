/** PublicRouter can mount pages directly, without a wouter Route context. */
export function parseRegionDirectoryPath(englishPath: string) {
  const segments = englishPath.split(/[?#]/, 1)[0].split('/').filter(Boolean);
  if (segments[0] !== 'regions' || segments.length > 5) return {};
  if ((segments.length === 4 || segments.length === 5) && segments.at(-1) !== 'stations') return {};
  const safeSlug = (value?: string) => {
    if (!value || value === 'stations') return undefined;
    try {
      const decoded = decodeURIComponent(value);
      return /^[\p{L}\p{N}][\p{L}\p{N}._~-]*$/u.test(decoded) ? decoded : undefined;
    } catch { return undefined; }
  };
  return {
    regionSlug: safeSlug(segments[1]), countrySlug: safeSlug(segments[2]),
    citySlug: segments.length === 5 && segments[4] === 'stations' ? safeSlug(segments[3]) : undefined,
  };
}

export interface DirectoryRegion { slug: string; name: string; countryCount: number }
export function parseRegionsResponse(response: unknown): DirectoryRegion[] {
  const payload = response as { success?: boolean; data?: unknown } | null;
  if (!payload || payload.success !== true || !Array.isArray(payload.data)) throw new Error('Invalid regions response');
  return payload.data.map((region: unknown) => {
    const item = region as DirectoryRegion | null;
    if (!item || typeof item.slug !== 'string' || !/^[a-z]+(?:-[a-z]+)*$/.test(item.slug) ||
        typeof item.name !== 'string' || !item.name.trim() || !Number.isSafeInteger(item.countryCount) || item.countryCount < 0) {
      throw new Error('Invalid region record');
    }
    return { slug: item.slug, name: item.name, countryCount: item.countryCount };
  });
}
