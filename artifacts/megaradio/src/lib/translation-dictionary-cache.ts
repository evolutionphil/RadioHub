type Dictionary = Record<string, string>;
const EMPTY: Dictionary = {};
const merged = new WeakMap<Dictionary, WeakMap<Dictionary, WeakMap<Dictionary, Dictionary>>>();

/** Query dictionaries are immutable snapshots. Share their merged view across
 * every card/hook instead of copying thousands of keys on each render. Weak
 * keys release previous query snapshots when React Query no longer uses them. */
export function getMergedTranslationDictionary(
  ssr: Dictionary | undefined,
  critical: Dictionary | undefined,
  full: Dictionary | undefined,
): Dictionary {
  const fullKey = full || EMPTY;
  const criticalKey = critical || EMPTY;
  const ssrKey = ssr || EMPTY;
  let byCritical = merged.get(fullKey);
  if (!byCritical) merged.set(fullKey, byCritical = new WeakMap());
  let bySsr = byCritical.get(criticalKey);
  if (!bySsr) byCritical.set(criticalKey, bySsr = new WeakMap());
  let dictionary = bySsr.get(ssrKey);
  if (!dictionary) {
    dictionary = { ...ssr, ...critical, ...full };
    bySsr.set(ssrKey, dictionary);
  }
  return dictionary;
}
