import { SITEMAP_PRIORITY_LANGUAGES } from '@workspace/seo-shared/seo-config';

export interface StationDescriptionChange {
  locale: string;
  field: 'full' | 'meta';
  value: string;
  expectedCurrentValue: string | null;
  // null explicitly means the locale is absent, not a stored JSON null.
  expectedLocaleObject: Record<string, unknown> | null;
}
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
export function parseStationDescriptionPatch(body: unknown): { slug: string; changes: StationDescriptionChange[] } {
  const fail = (): never => { throw new Error('Invalid description patch: use a station slug and 1–28 explicit locale/full-or-meta changes with expected current values and locale objects'); };
  if (!object(body) || Object.keys(body).some(key => !['slug', 'changes'].includes(key)) ||
    typeof body.slug !== 'string' || !body.slug.trim() || body.slug.length > 250 ||
    !Array.isArray(body.changes) || body.changes.length < 1 || body.changes.length > 28) return fail();
  const seen = new Set<string>();
  const changes = body.changes.map(value => {
    if (!object(value) || Object.keys(value).sort().join(',') !== 'expectedCurrentValue,expectedLocaleObject,field,locale,value' ||
      typeof value.locale !== 'string' || !SITEMAP_PRIORITY_LANGUAGES.universal14.includes(value.locale as any) ||
      !['full', 'meta'].includes(String(value.field)) || typeof value.value !== 'string' || !value.value.trim() ||
      value.value.length > (value.field === 'full' ? 20000 : 1000) ||
      !(typeof value.expectedCurrentValue === 'string' || value.expectedCurrentValue === null) ||
      !(object(value.expectedLocaleObject) || value.expectedLocaleObject === null)) return fail();
    if (JSON.stringify(value.expectedLocaleObject).length > 100000) return fail();
    if ((value.expectedLocaleObject?.[String(value.field)] ?? null) !== value.expectedCurrentValue) return fail();
    const key = `${value.locale}.${value.field}`;
    if (seen.has(key)) return fail();
    seen.add(key);
    return value as unknown as StationDescriptionChange;
  });
  return { slug: body.slug, changes };
}
