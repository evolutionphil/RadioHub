import { SITEMAP_PRIORITY_LANGUAGES } from '@workspace/seo-shared/seo-config';

/** The same string/nonblank contract used by station-description-content.ts.
 * Include the ECMAScript trim whitespace beyond PostgreSQL's locale classes. */
export function descriptionTextSql(json: string): string {
  return `(jsonb_typeof(${json})='string' AND (${json} #>> '{}') ~ '[^[:space:]\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]')`;
}

export function adminDescriptionFilterSql(status?: string): string {
  if (!['yes', 'no', 'partial'].includes(status || '')) return 'TRUE';
  const languages = SITEMAP_PRIORITY_LANGUAGES.universal14.map(language => `'${language}'`).join(',');
  const entries = `jsonb_each(CASE WHEN jsonb_typeof(s.descriptions)='object' THEN s.descriptions ELSE '{}'::jsonb END) d`;
  const full = descriptionTextSql("d.value->'full'");
  const meta = descriptionTextSql("d.value->'meta'");
  const supported = `d.key IN (${languages})`;
  const any = `EXISTS (SELECT 1 FROM ${entries} WHERE ${supported} AND (${full} OR ${meta}))`;
  if (status === 'yes') return any;
  if (status === 'no') return `NOT (${any})`;
  // Missing languages includes completely unenriched stations as well as
  // objects with fourteen keys but blank/missing full or meta fields.
  return `(SELECT count(*) FROM ${entries} WHERE ${supported} AND ${full} AND ${meta})<${SITEMAP_PRIORITY_LANGUAGES.universal14.length}`;
}
