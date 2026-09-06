/** URL-safe genre slug invariant, independent of any database driver. */
export const SAFE_GENRE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function normalizeGenreSlug(input: string | null | undefined): string {
  return input ? String(input).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') : '';
}
