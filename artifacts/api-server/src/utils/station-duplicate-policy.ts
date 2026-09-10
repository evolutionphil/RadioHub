/** Automatic merging needs matching identity AND a shared actual endpoint. */
export const DUPLICATE_POLICY_FIELDS = ['_id', 'name', 'country', 'countryCode', 'city', 'state', 'url', 'urlResolved', 'manualEditFields'] as const;
type StationIdentity = Record<string, any>;
const normalizedText = (value: unknown): string => typeof value === 'string'
  ? value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase() : '';

function endpoint(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 8192) return null;
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    // Fragments are not sent to the broadcaster. Path case, protocol and the
    // full query string remain significant; host-only/fuzzy matches are unsafe.
    url.hash = '';
    return url.href;
  } catch { return null; }
}

export function assessDuplicateGroup(docs: readonly StationIdentity[]): { eligible: boolean; reason: string } {
  const reject = (reason: string) => ({ eligible: false, reason });
  if (docs.length < 2) return reject('At least two current stations are required');
  const names = docs.map(doc => normalizedText(doc.name));
  if (!names[0] || names.some(name => name !== names[0])) return reject('Station names do not match exactly');
  const countries = docs.map(doc => normalizedText(doc.country));
  const countryCodes = docs.map(doc => normalizedText(doc.countryCode));
  const knownCodes = new Set(countryCodes.filter(Boolean));
  if (knownCodes.size > 1) return reject('Country codes conflict');
  if (countries.some(Boolean)) {
    if (!countries[0] || countries.some(country => country !== countries[0])) return reject('Countries do not match exactly');
  } else if (!countryCodes[0] || countryCodes.some(code => code !== countryCodes[0])) {
    return reject('Country identity is missing');
  }
  for (const field of ['city', 'state']) {
    if (new Set(docs.map(doc => normalizedText(doc[field])).filter(Boolean)).size > 1) return reject(`Known ${field} values conflict`);
  }
  let shared: Set<string> | undefined;
  for (const doc of docs) {
    const candidates = [doc.url];
    if (doc.manualEditFields?.url !== true || doc.manualEditFields?.urlResolved === true) candidates.push(doc.urlResolved);
    const urls = new Set(candidates.map(endpoint).filter((url): url is string => url !== null));
    shared = shared === undefined ? urls : new Set([...shared].filter(url => urls.has(url)));
    if (!shared.size) return reject('No shared actual HTTP stream endpoint across every station');
  }
  return { eligible: true, reason: 'Exact station identity and shared actual HTTP stream endpoint' };
}
