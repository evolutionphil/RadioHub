/**
 * Escapes the 5 XML predefined entities for safe inclusion in <loc>,
 * <image:loc>, <xhtml:link href>, station name fields, and any other
 * XML text content emitted by the sitemap pipeline.
 *
 * Task #127: extracted from `routes/seo-sitemap-routes.ts` so the helper
 * can be imported by both the sitemap routes AND the integration test
 * suite that asserts every URL in every <loc> is properly escaped.
 *
 * Returns an empty string for non-string input so callers do not need
 * to null-check before interpolating.
 */
export function escapeXml(value: string): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
