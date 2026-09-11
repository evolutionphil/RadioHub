import { describe, expect, it } from 'vitest';
import { adminRunningPoll, mergeUrlSuggestions, removeAcknowledgedDrafts, removeAcknowledgedUrlDrafts, translationDraftKey, translationDraftPayload } from '../src/lib/admin-content-state';

describe('admin content draft boundaries', () => {
  it('keeps independent language/key identities when the visible filter changes', () => {
    const drafts = { [translationDraftKey('de', 'a')]: 'Hallo', [translationDraftKey('tr', 'a')]: 'Merhaba' };
    expect(translationDraftPayload(drafts)).toEqual([
      { keyId: 'a', language: 'de', value: 'Hallo', isCompleted: true },
      { keyId: 'a', language: 'tr', value: 'Merhaba', isCompleted: true },
    ]);
    expect(() => translationDraftPayload({ [translationDraftKey('all', 'a')]: 'bad' })).toThrow();
  });
  it('acknowledges only saved snapshot values, including empty input', () => {
    expect(removeAcknowledgedDrafts({ a: 'newer', b: '', c: 'new' }, { a: 'old', b: '' })).toEqual({ a: 'newer', c: 'new' });
    expect([...removeAcknowledgedUrlDrafts(new Map([['de:genres', 'newer'], ['tr:genres', 'türler']]), [
      { languageCode: 'de', englishPath: 'genres', translatedPath: 'old' },
      { languageCode: 'tr', englishPath: 'genres', translatedPath: 'türler' },
    ])]).toEqual([['de:genres', 'newer']]);
  });
  it('accepts only requested language/paths and preserves newer manual edits', () => {
    const request = { languageCode: 'de', paths: ['genres', 'popular'] };
    const current = new Map([['de:genres', 'manual']]);
    const result = mergeUrlSuggestions(current, { languageCode: 'de', translations: { genres: 'KI', popular: 'beliebt' } }, request);
    expect([...result]).toEqual([['de:genres', 'manual'], ['de:popular', 'beliebt']]);
    expect([...current]).toEqual([['de:genres', 'manual']]);
    for (const bad of [{ languageCode: 'tr', translations: {} }, { languageCode: 'de', translations: { unrequested: 'x' } }, { languageCode: 'de', translations: { genres: 7 } }, null]) {
      expect(() => mergeUrlSuggestions(current, bad, request)).toThrow();
    }
  });
  it('stops polling completed or failed requests even with cached running data', () => {
    expect(adminRunningPoll({ status: 'success' }, true, 5000)).toBe(5000);
    expect(adminRunningPoll({ status: 'error' }, true, 5000)).toBe(false);
    expect(adminRunningPoll({ status: 'success' }, false, 5000)).toBe(false);
    expect(adminRunningPoll({ status: 'success' }, undefined, 5000)).toBe(false);
  });
});
