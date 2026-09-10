type Document = Record<string, any>;
const object = (value: unknown): value is Document => !!value && typeof value === 'object' && !Array.isArray(value);
const missing = (value: unknown) => value == null || (typeof value === 'string' && !value.trim());
const safeKey = (value: string) => !['__proto__', 'constructor', 'prototype'].includes(value);
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && !!item.trim()) : [];
const union = (values: unknown[]): string[] => [...new Set(values.filter((value): value is string => typeof value === 'string' && !!value.trim()))];
function protectedPath(flags: Document, path: string): boolean {
  const parts = path.split('.');
  return parts.some((_, index) => flags[parts.slice(0, index + 1).join('.')] === true);
}

/** Retain the survivor verbatim, filling only absent, unprotected translations. */
export function preserveMergedStationMetadata(primary: Document, duplicates: readonly Document[]): Document {
  const next = structuredClone(primary);
  const flags = object(primary.manualEditFields) ? primary.manualEditFields : {};
  next.manualEditFields = { ...flags };
  const descriptions = object(primary.descriptions) ? structuredClone(primary.descriptions) : {};
  // Stable donor order makes repeated previews/transactions deterministic.
  const donors = [...duplicates].sort((a, b) => String(a._id).localeCompare(String(b._id)));
  for (const donor of donors) {
    if (!object(donor.descriptions)) continue;
    for (const [locale, value] of Object.entries(donor.descriptions)) {
      if (!safeKey(locale) || protectedPath(flags, `descriptions.${locale}`)) continue;
      if (object(value)) {
        if (!missing(descriptions[locale]) && !object(descriptions[locale])) continue;
        const localized = object(descriptions[locale]) ? descriptions[locale] : {};
        for (const [field, text] of Object.entries(value)) {
          if (!safeKey(field) || protectedPath(flags, `descriptions.${locale}.${field}`) ||
            !missing(localized[field]) || missing(text)) continue;
          localized[field] = structuredClone(text);
          if (protectedPath(donor.manualEditFields || {}, `descriptions.${locale}.${field}`)) next.manualEditFields.descriptions = true;
        }
        if (Object.keys(localized).length) descriptions[locale] = localized;
      } else if (missing(descriptions[locale]) && !missing(value)) {
        descriptions[locale] = structuredClone(value);
        if (protectedPath(donor.manualEditFields || {}, `descriptions.${locale}`)) next.manualEditFields.descriptions = true;
      }
    }
  }
  // A malformed/legacy survivor field is not replaced by an empty object.
  if (object(primary.descriptions) || Object.keys(descriptions).length) next.descriptions = descriptions;
  const docs = [primary, ...donors];
  next.slugAliases = union(docs.flatMap(doc => [...strings(doc.slugAliases), doc.slug])).filter(slug => slug !== primary.slug);
  next.mergedUrls = union(docs.flatMap(doc => [doc.url, doc.urlResolved, ...strings(doc.mergedUrls)]));
  next.mergedStationIds = union(docs.flatMap(doc => [doc._id, ...strings(doc.mergedStationIds)])).filter(id => id !== primary._id);
  next.mergedStationUuids = union(docs.flatMap(doc => [doc.stationuuid, ...strings(doc.mergedStationUuids)])).filter(id => id !== primary.stationuuid);
  return next;
}
