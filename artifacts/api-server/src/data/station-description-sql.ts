import { SITEMAP_PRIORITY_LANGUAGES } from '@workspace/seo-shared/seo-config';

/** Exact ECMAScript trim set; PostgreSQL [:space:] additionally includes U+0085. */
export function descriptionTextSql(json: string): string {
  return `(jsonb_typeof(${json})='string' AND (${json} #>> '{}') ~ '[^\\u0009-\\u000D\\u0020\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]')`;
}

export function adminDescriptionFilterSql(status?: string): string {
  if (!['yes', 'no', 'partial'].includes(status || '')) return 'TRUE';
  const any = '(d.full_mask | d.meta_mask)<>0';
  if (status === 'yes') return any;
  if (status === 'no') return '(d.full_mask | d.meta_mask)=0';
  // Missing languages includes completely unenriched stations as well as
  // objects with fourteen keys but blank/missing full or meta fields.
  return `(d.full_mask & d.meta_mask)<>${(1 << SITEMAP_PRIORITY_LANGUAGES.universal14.length)-1}`;
}
