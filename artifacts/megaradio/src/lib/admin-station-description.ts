import { SITEMAP_PRIORITY_LANGUAGES } from '@workspace/seo-shared/seo-config';
import { api } from './api';
import { apiRequest } from './queryClient';

const object = (value: unknown): value is Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = (value: any): string => JSON.stringify(object(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(canonical(value[key]))])) : value);

export function buildDescriptionChanges(json: string, baseline: Record<string, any> = {}) {
  let edited: Record<string, any>;
  try { edited = json.trim() ? JSON.parse(json) : {}; } catch { throw new Error('Descriptions must be valid JSON; no changes were saved.'); }
  if (!object(edited)) throw new Error('Descriptions must be an object keyed by language.');
  const changes: Array<{ locale: string; field: 'full' | 'meta'; value: string; expectedCurrentValue: string | null; expectedLocaleObject: Record<string, any> | null }> = [];
  for (const locale of new Set([...Object.keys(baseline), ...Object.keys(edited)])) {
    const previous = baseline[locale];
    const next = edited[locale];
    if (canonical(previous ?? null) === canonical(next ?? null)) continue;
    if (!SITEMAP_PRIORITY_LANGUAGES.universal14.includes(locale as any) || !object(next) || (previous !== undefined && !object(previous))) {
      throw new Error('Changed descriptions must use a supported website language and an object containing full/meta text; existing translations cannot be removed.');
    }
    for (const field of new Set([...Object.keys(previous || {}), ...Object.keys(next)])) {
      if (canonical(previous?.[field] ?? null) === canonical(next[field] ?? null)) continue;
      if (!['full', 'meta'].includes(field) || typeof next[field] !== 'string' || !next[field].trim() || next[field].length > (field === 'full' ? 20000 : 1000)) {
        throw new Error('Only non-empty full/meta text may change; other existing fields must be preserved.');
      }
      changes.push({ locale, field: field as 'full' | 'meta', value: next[field], expectedCurrentValue: previous?.[field] ?? null, expectedLocaleObject: previous === undefined ? null : structuredClone(previous) });
    }
  }
  if (changes.length > 28) throw new Error('Save at most 28 description fields at a time.');
  return { changes, descriptions: edited };
}

export async function saveAdminStationEdit(id: string | number, data: Record<string, any>) {
  const { descriptionPatch, ...metadata } = data;
  let result: any;
  const hasMetadata = Object.keys(metadata).length > 0;
  if (hasMetadata) result = await api.updateStation(id, metadata);
  if (descriptionPatch) {
    try {
      const response = await apiRequest('PATCH', `/api/admin/stations/${id}/descriptions`, { body: descriptionPatch });
      const descriptions = await response.json();
      if (descriptions.success !== true) throw new Error('Description update was not confirmed');
      result = { ...result, ...descriptions };
    } catch (error) {
      throw new Error(`${hasMetadata ? 'Station details were saved, but descriptions were not. ' : ''}Reload the station and review the description changes. ${error instanceof Error ? error.message : ''}`);
    }
  }
  return result || { success: true };
}

export async function generateAdminStationDescription(id: string) {
  const response = await apiRequest('POST', `/api/admin/stations/${id}/generate-description`);
  const result = await response.json();
  if (!result.success || !result.saved) throw new Error(result.error || 'The generated description was not saved.');
  const refreshed = await apiRequest('GET', `/api/admin/stations/${id}`);
  return refreshed.json();
}
