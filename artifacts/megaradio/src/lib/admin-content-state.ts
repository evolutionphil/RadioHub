/** Draft identity includes the language: changing a filter must never retarget an edit. */
export const translationDraftKey = (language: string, keyId: string) => JSON.stringify([language, keyId]);

export function translationDraftPayload(drafts: Record<string, string>) {
  return Object.entries(drafts).map(([identity, value]) => {
    const [language, keyId] = JSON.parse(identity);
    if (typeof language !== 'string' || !language || language === 'all' || typeof keyId !== 'string' || !keyId) throw new Error('Invalid translation draft identity');
    return { keyId, language, value, isCompleted: true };
  });
}

/** A successful earlier save must not erase edits made while its request ran. */
export function removeAcknowledgedDrafts(current: Record<string, string>, saved: Record<string, string>) {
  return Object.fromEntries(Object.entries(current).filter(([key, value]) => !Object.hasOwn(saved, key) || saved[key] !== value));
}

export function removeAcknowledgedUrlDrafts(current: Map<string, string>, saved: Array<{ languageCode: string; englishPath: string; translatedPath: string }>) {
  const next = new Map(current);
  for (const row of saved) {
    const key = `${row.languageCode}:${row.englishPath}`;
    if (next.get(key) === row.translatedPath) next.delete(key);
  }
  return next;
}

export function mergeUrlSuggestions(current: Map<string, string>, data: unknown, request: { languageCode: string; paths: string[] }) {
  const result = data as { languageCode?: unknown; translations?: unknown };
  if (!result || result.languageCode !== request.languageCode || !result.translations || Array.isArray(result.translations) || typeof result.translations !== 'object') throw new Error('Invalid URL translation response');
  const requested = new Set(request.paths);
  const next = new Map(current);
  for (const [path, value] of Object.entries(result.translations)) {
    if (!requested.has(path) || typeof value !== 'string' || !value.trim()) throw new Error('Invalid URL translation suggestion');
    const key = `${request.languageCode}:${path}`;
    if (!next.has(key)) next.set(key, value);
  }
  return next;
}

export function adminRunningPoll(state: { status: string }, running: unknown, interval: number): number | false {
  return state.status !== 'error' && running === true ? interval : false;
}
