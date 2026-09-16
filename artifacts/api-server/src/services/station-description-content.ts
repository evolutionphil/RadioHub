import { stripPlaceholders } from '../routes/shared-utils';

export function hasDescriptionText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function hasCompleteDescription(value: any): value is { full: string; meta: string } {
  return hasDescriptionText(value?.full) && hasDescriptionText(value?.meta);
}

// Use already-localized prose for metadata-only gaps without a model request.
export function metadataFromFull(full: string): string {
  const excerpt = stripPlaceholders(full).replace(/\s+/g, ' ').trim().substring(0, 155).trim();
  if (!excerpt) return '';
  const lastSpace = excerpt.lastIndexOf(' ');
  const lastPeriod = excerpt.lastIndexOf('.');
  const cutPoint = lastPeriod > 100 ? lastPeriod + 1 : (lastSpace > 100 ? lastSpace : 155);
  const meta = excerpt.substring(0, cutPoint).trim();
  return /[.!?]$/.test(meta) ? meta : `${meta}...`;
}

// A missing-only run must preserve every populated field and locale extension.
export function fillMissingDescription(existing: any, generated: { full: string; meta: string }): { full: string; meta: string } {
  const previous = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
  return {
    ...previous,
    full: hasDescriptionText(previous.full) ? previous.full : stripPlaceholders(generated.full),
    meta: hasDescriptionText(previous.meta) ? previous.meta : stripPlaceholders(generated.meta),
  };
}
