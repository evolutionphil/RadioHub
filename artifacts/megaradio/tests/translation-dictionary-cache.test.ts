import { expect, it } from 'vitest';
import { getMergedTranslationDictionary as merge } from '../src/lib/translation-dictionary-cache';

it('shares a single merged snapshot for repeated hooks without mutating inputs', () => {
  const ssr = Object.freeze({ shared: 'SSR', ssr: 'first paint' });
  const critical = Object.freeze({ shared: 'critical', critical: 'critical only' });
  const full = Object.freeze({ shared: 'admin full', full: 'full only' });
  const result = merge(ssr, critical, full);
  expect(result).toEqual({ shared: 'admin full', ssr: 'first paint', critical: 'critical only', full: 'full only' });
  for (let i = 0; i < 100; i++) expect(merge(ssr, critical, full)).toBe(result);
  expect(ssr.shared).toBe('SSR');
});

it('refreshes for each changed input, preserving older consumers and locale separation', () => {
  const ssr = { text: 'SSR' }, critical = { critical: 'old' }, full = { text: 'TR' };
  const original = merge(ssr, critical, full);
  expect(merge(ssr, critical, { text: 'DE' })).toEqual({ text: 'DE', critical: 'old' });
  expect(merge(ssr, { critical: 'updated' }, full).critical).toBe('updated');
  expect(merge({ added: 'SSR update' }, critical, full).added).toBe('SSR update');
  expect(original).toEqual({ text: 'TR', critical: 'old' });
  expect(merge(undefined, undefined, undefined)).toEqual({});
  expect(merge(ssr, undefined, undefined)).toEqual(ssr);
});
