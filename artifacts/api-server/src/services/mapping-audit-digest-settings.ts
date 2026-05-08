import { logger } from '../utils/logger';
import { AdminSetting } from '@workspace/db-shared/mongo-schemas';

/**
 * Task #284 — admin-tunable cadence for the mapping-audit digest email
 * (Task #211).
 *
 * Three cadence values are supported:
 *   - `off`    — scheduler never sends; manual runs still work.
 *   - `daily`  — fires every day at 06:00 Europe/Berlin with a 24h
 *                lookback window. (Default — matches Task #211 behaviour.)
 *   - `weekly` — fires once a week at 06:00 Europe/Berlin (Monday) with
 *                a 7-day lookback window.
 *
 * Resolution order:
 *   1. AdminSetting row (`mapping-audit-digest`) — admin UI override.
 *   2. `MAPPING_AUDIT_DIGEST_CADENCE` env var.
 *   3. Default: `daily`.
 *
 * Stored value shape: `{ cadence: 'off' | 'daily' | 'weekly' }` (other
 * keys are ignored so we can extend later without migrations).
 */

export type MappingAuditDigestCadence = 'off' | 'daily' | 'weekly';

export const MAPPING_AUDIT_DIGEST_SETTINGS_KEY = 'mapping-audit-digest';
const DEFAULT_CADENCE: MappingAuditDigestCadence = 'daily';
const SETTINGS_CACHE_TTL_MS = 30_000;

export interface MappingAuditDigestSettings {
  cadence: MappingAuditDigestCadence | null;
}

export interface ResolvedMappingAuditDigestSettings {
  cadence: MappingAuditDigestCadence;
  lookbackMs: number;
  source: 'db' | 'env' | 'default';
}

const CADENCES: readonly MappingAuditDigestCadence[] = ['off', 'daily', 'weekly'];

export function isMappingAuditDigestCadence(
  value: unknown,
): value is MappingAuditDigestCadence {
  return typeof value === 'string' && (CADENCES as readonly string[]).includes(value);
}

function envCadence(): { value: MappingAuditDigestCadence; source: 'env' | 'default' } {
  const raw = process.env.MAPPING_AUDIT_DIGEST_CADENCE;
  if (raw && isMappingAuditDigestCadence(raw.trim().toLowerCase())) {
    return { value: raw.trim().toLowerCase() as MappingAuditDigestCadence, source: 'env' };
  }
  return { value: DEFAULT_CADENCE, source: 'default' };
}

function sanitizeStoredSettings(value: unknown): MappingAuditDigestSettings {
  const out: MappingAuditDigestSettings = { cadence: null };
  if (!value || typeof value !== 'object') return out;
  const v = value as Record<string, unknown>;
  if (isMappingAuditDigestCadence(v.cadence)) {
    out.cadence = v.cadence;
  }
  return out;
}

let settingsCache: { at: number; value: MappingAuditDigestSettings } | null = null;

export function invalidateMappingAuditDigestSettingsCache(): void {
  settingsCache = null;
}

export async function loadStoredMappingAuditDigestSettings(
  opts: { bypassCache?: boolean } = {},
): Promise<MappingAuditDigestSettings> {
  if (
    !opts.bypassCache &&
    settingsCache &&
    Date.now() - settingsCache.at < SETTINGS_CACHE_TTL_MS
  ) {
    return settingsCache.value;
  }
  try {
    const doc = await AdminSetting.findOne({
      key: MAPPING_AUDIT_DIGEST_SETTINGS_KEY,
    }).lean();
    const value = sanitizeStoredSettings(doc?.value);
    settingsCache = { at: Date.now(), value };
    return value;
  } catch (err) {
    logger.warn(
      '⚠️  Failed to load mapping-audit digest settings from DB, using env/defaults:',
      err,
    );
    const value: MappingAuditDigestSettings = { cadence: null };
    settingsCache = { at: Date.now(), value };
    return value;
  }
}

export function lookbackMsForCadence(cadence: MappingAuditDigestCadence): number {
  if (cadence === 'weekly') return 7 * 24 * 60 * 60 * 1000;
  // 'off' has no real window; we still default to 24h so the manual
  // run-button stays useful even with cadence disabled.
  return 24 * 60 * 60 * 1000;
}

export async function resolveMappingAuditDigestSettings(): Promise<ResolvedMappingAuditDigestSettings> {
  const stored = await loadStoredMappingAuditDigestSettings();
  const env = envCadence();
  const cadence = stored.cadence ?? env.value;
  const source: 'db' | 'env' | 'default' =
    stored.cadence != null ? 'db' : env.source;
  return {
    cadence,
    lookbackMs: lookbackMsForCadence(cadence),
    source,
  };
}

export function getDefaultMappingAuditDigestCadence(): MappingAuditDigestCadence {
  return DEFAULT_CADENCE;
}

export function getEnvMappingAuditDigestCadence(): MappingAuditDigestCadence | null {
  const raw = process.env.MAPPING_AUDIT_DIGEST_CADENCE;
  if (raw && isMappingAuditDigestCadence(raw.trim().toLowerCase())) {
    return raw.trim().toLowerCase() as MappingAuditDigestCadence;
  }
  return null;
}
