import { evaluateJunkStation, frequencyClusterKey, frequencyPrefixBaseSlug, isNumericOnlySlug } from './junk-station-rules';
import { AUDIT_LANGUAGES } from './station-indexability-audit';

export const RECOVERY_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const RECOVERY_CANDIDATE_LIMIT = 100;
export interface RecoveryIdentity {
  id: string; name: string; slug: string | null; country: string | null; countryCode: string | null;
  url: string; urlResolved: string | null;
  stationuuid?: string;
  slugAliases?: string[];
}
export interface RecoveryStation extends RecoveryIdentity {
  stationuuid: string; noIndex: boolean; redirectToSlug: string | null;
  manualEditFields: unknown; automaticNoIndex: unknown;
  lastCheckOk: boolean | null; lastCheckTime: Date | string | null; lastCheckOkTime: unknown;
  completeLanguageCount: number; rowVersion: string; sourceIsObject: boolean; journalIsObject: boolean;
}
export interface RecoveryCandidate {
  id: string; slug: string; name: string; country: string; countryCode: string;
  lastCheckOkTime: string | null; completeLanguageCount: number;
  evidence: { provenance: 'legacy-unknown' | 'owned-duplicate'; providerUuidPresent: true;
    providerLastCheckOk: boolean | null; recentProviderSuccess: boolean; identityPeers: 0;
    recoveryBasis: 'complete-unique-information-page' };
}

/** Deliberately broader than the automatic-merge identity test: punctuation,
 * whitespace and accents are insufficient to rule out a plausible sibling. */
const normalized = (value: unknown): string => typeof value === 'string'
  ? value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') : '';
const text = (value: unknown): value is string => typeof value === 'string' && Boolean(value.trim());
export function recoveryEndpoint(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 8192 || !/^https?:\/\//i.test(value.trim())) return null;
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = '';
    return url.href;
  } catch { return null; }
}

export function createRecoveryIdentityIndex() {
  type Peer = { id: string; country: string; code: string };
  const names = new Map<string, Array<{ id: string; country: string; code: string }>>();
  const endpoints = new Map<string, Set<string>>();
  const slugs = new Map<string, Set<string>>();
  const slugFamilies = new Map<string, Peer[]>();
  const uuids = new Map<string, Set<string>>();
  const familyKeys = (slug: string | null) => {
    const keys = new Set<string>();
    if (!slug) return keys;
    const canonical = frequencyClusterKey(slug);
    if (!canonical) return keys;
    keys.add(canonical);
    const base = frequencyPrefixBaseSlug(canonical);
    if (base) keys.add(base);
    for (const key of [...keys]) {
      // Recovery only: numbers and formats may be legitimate identities, but
      // these historical sibling shapes still require manual review.
      keys.add(key.replace(/-(?:mp3|aac|aacp|flac|ogg|opus|dab|128|192|256|320)(?:-\d+)?$/, ''));
      keys.add(key.replace(/-\d+$/, ''));
    }
    return keys;
  };
  const plausibleCountry = (peer: Peer, country: string, code: string) =>
    !peer.country || !peer.code || peer.country === country || peer.code === code;
  let total = 0;
  return {
    get total() { return total; },
    add(station: RecoveryIdentity) {
      total++;
      const peer = { id: station.id, country: normalized(station.country), code: normalized(station.countryCode) };
      const name = normalized(station.name);
      if (name) {
        const peers = names.get(name) || [];
        peers.push(peer);
        names.set(name, peers);
      }
      for (const value of [station.url, station.urlResolved]) {
        const endpoint = recoveryEndpoint(value);
        if (endpoint) { const ids = endpoints.get(endpoint) || new Set<string>(); ids.add(station.id); endpoints.set(endpoint, ids); }
      }
      for (const slug of [station.slug, ...(station.slugAliases || [])]) {
        if (!slug) continue;
        const ids = slugs.get(slug) || new Set<string>(); ids.add(station.id); slugs.set(slug, ids);
      }
      for (const key of familyKeys(station.slug)) {
        const peers = slugFamilies.get(key) || []; peers.push(peer); slugFamilies.set(key, peers);
      }
      if (station.stationuuid) {
        const key = station.stationuuid.toLowerCase();
        const ids = uuids.get(key) || new Set<string>(); ids.add(station.id); uuids.set(key, ids);
      }
    },
    hasPeer(station: RecoveryStation): boolean {
      const country = normalized(station.country), code = normalized(station.countryCode);
      if (names.get(normalized(station.name))?.some(peer => peer.id !== station.id &&
        plausibleCountry(peer, country, code))) return true;
      if ([...(uuids.get(station.stationuuid.toLowerCase()) || [])].some(id => id !== station.id)) return true;
      for (const key of familyKeys(station.slug)) {
        if (slugFamilies.get(key)?.some(peer => peer.id !== station.id && plausibleCountry(peer, country, code))) return true;
      }
      for (const value of [station.url, station.urlResolved]) {
        const endpoint = recoveryEndpoint(value);
        if (endpoint && [...(endpoints.get(endpoint) || [])].some(id => id !== station.id)) return true;
      }
      // A recorded historical duplicate target that still exists needs human
      // identity review even if its current endpoint/name has changed.
      const provenance = station.automaticNoIndex as { reason?: string } | null;
      const target = typeof provenance?.reason === 'string' && provenance.reason.startsWith('duplicate-of:')
        ? provenance.reason.slice('duplicate-of:'.length) : null;
      return Boolean((station.slug && [...(slugs.get(station.slug) || [])].some(id => id !== station.id)) ||
        (target && [...(slugs.get(target) || [])].some(id => id !== station.id)));
    },
  };
}
export type RecoveryIdentityIndex = ReturnType<typeof createRecoveryIdentityIndex>;

/** An unknown flag alone is never evidence for recovery. Complete retained
 * information and identity must pass every guard. Stream availability is
 * recorded as evidence; it does not determine this information page's SEO. */
export function assessLegacyNoindexRecovery(station: RecoveryStation, index: RecoveryIdentityIndex, now: number):
  { reason: string; candidate?: RecoveryCandidate } {
  const reject = (reason: string) => ({ reason });
  if (station.noIndex !== true) return reject('not-noindex');
  const manual = station.manualEditFields;
  if (!manual || typeof manual !== 'object' || Array.isArray(manual)) return reject('ambiguous-manual-flags');
  if (['noIndex', 'slug', 'redirectToSlug'].some(key => Object.hasOwn(manual, key))) return reject('manual-protection');
  if (station.redirectToSlug) return reject('redirect');
  if (!station.sourceIsObject || !station.journalIsObject) return reject('ambiguous-metadata');
  const provenance = station.automaticNoIndex as Record<string, unknown> | null;
  const ownedDuplicate = provenance?.owner === 'radiohub-junk-policy' && provenance.version === 1 &&
    provenance.active === true && typeof provenance.reason === 'string' && provenance.reason.startsWith('duplicate-of:') &&
    provenance.reason.length > 'duplicate-of:'.length;
  if (provenance != null && !ownedDuplicate) return reject('other-provenance');
  if (!text(station.slug)) return reject('missing-slug');
  if (isNumericOnlySlug(station.slug)) return reject('numeric-slug');
  const junk = evaluateJunkStation({ name: station.name, slug: station.slug, url: station.url });
  if (junk.isJunk) return reject(`junk:${junk.reason}`);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(station.stationuuid)) return reject('missing-provider-uuid');
  if (!text(station.country) || !/^[a-z]{2}$/i.test(station.countryCode || '') || !normalized(station.name)) return reject('missing-country-identity');
  if (!recoveryEndpoint(station.url) || (station.urlResolved && !recoveryEndpoint(station.urlResolved))) return reject('ambiguous-stream-endpoint');
  if (['lastCheckOk', 'lastCheckTime', 'lastCheckOkTime', 'url', 'urlResolved'].some(key => Object.hasOwn(manual, key))) return reject('manual-provider-evidence');
  const checkedAt = station.lastCheckTime == null ? NaN : new Date(station.lastCheckTime).getTime();
  // A failed latest check is never relabelled as a successful check. Only an
  // explicit successful timestamp, or a check actually marked successful,
  // can supply this optional historical evidence.
  const successfulAt = station.lastCheckOkTime == null ? (station.lastCheckOk === true ? checkedAt : NaN) :
    typeof station.lastCheckOkTime === 'string' ? new Date(station.lastCheckOkTime).getTime() : NaN;
  const knownSuccessfulAt = Number.isFinite(successfulAt) && successfulAt <= now &&
    (!Number.isFinite(checkedAt) || successfulAt <= checkedAt) ? successfulAt : null;
  const recentProviderSuccess = station.lastCheckOk === true && knownSuccessfulAt !== null &&
    [checkedAt, knownSuccessfulAt].every(value => Number.isFinite(value) && value <= now && value >= now - RECOVERY_MAX_AGE_MS);
  if (station.completeLanguageCount !== AUDIT_LANGUAGES.length) return reject('incomplete-descriptions');
  if (index.hasPeer(station)) return reject('plausible-identity-peer');
  return { reason: 'eligible', candidate: {
    id: station.id, slug: station.slug, name: station.name, country: station.country, countryCode: station.countryCode!,
    lastCheckOkTime: knownSuccessfulAt === null ? null : new Date(knownSuccessfulAt).toISOString(), completeLanguageCount: station.completeLanguageCount,
    evidence: { provenance: ownedDuplicate ? 'owned-duplicate' : 'legacy-unknown', providerUuidPresent: true,
      providerLastCheckOk: typeof station.lastCheckOk === 'boolean' ? station.lastCheckOk : null,
      recentProviderSuccess, identityPeers: 0, recoveryBasis: 'complete-unique-information-page' },
  } };
}
