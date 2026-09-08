import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { pgLogoVariants, type LogoVariantStation } from '../data/postgres-logo-variant-store';
import { logoVariantStorageConfig, readLogoVariantSource, uploadLogoVariant } from './s3-storage';

export interface LogoVariantRequest { stationIds: string[]; dryRun: boolean }
export class LogoVariantRequestError extends Error {}
export function parseLogoVariantRequest(input: unknown): LogoVariantRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new LogoVariantRequestError('Expected a JSON object');
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some(key => !['stationIds', 'dryRun'].includes(key)) ||
    !Array.isArray(body.stationIds) || body.stationIds.length < 1 || body.stationIds.length > 10 ||
    body.stationIds.some(id => typeof id !== 'string' || !/^[a-f0-9]{24}$/.test(id)) ||
    new Set(body.stationIds).size !== body.stationIds.length ||
    (body.dryRun !== undefined && typeof body.dryRun !== 'boolean')) {
    throw new LogoVariantRequestError('Provide 1–10 unique lowercase 24-hex stationIds and an optional boolean dryRun');
  }
  return { stationIds: body.stationIds as string[], dryRun: body.dryRun !== false };
}

export function logoVariantCandidate(station: LogoVariantStation, config: { bucket: string; region: string }) {
  const assets = station.logoAssets;
  if (!assets || assets.status !== 'completed' || typeof assets.folder !== 'string' ||
    !/^[a-z0-9_-]{1,200}$/.test(assets.folder) || typeof assets.webp256 !== 'string') return null;
  // Exact comparison rejects credentials, redirects, query strings, ports,
  // encoded paths, lookalike buckets and all old third-party favicon URLs.
  const key = `station-logos/${assets.folder}/logo-256.webp`;
  if (assets.webp256 !== `https://${config.bucket}.s3.${config.region}.amazonaws.com/${key}`) return null;
  const sizes = ([48, 96] as const).filter(size => [undefined, null, ''].includes(assets[`webp${size}`] as any));
  return sizes.length ? { key, folder: assets.folder, sizes } : null;
}

/** Resize the current square artwork only; never replace it or flatten alpha. */
export async function renderSmallLogoVariants(buffer: Buffer, sizes: readonly (48 | 96)[]) {
  const options = { failOn: 'error' as const, limitInputPixels: 256 * 256 };
  const metadata = await sharp(buffer, options).metadata();
  if (metadata.format !== 'webp' || metadata.width !== 256 || metadata.height !== 256 || (metadata.pages || 1) !== 1) {
    throw new Error('Expected one static 256×256 WebP logo');
  }
  const results: Record<string, Buffer> = {};
  for (const size of sizes) results[`webp${size}`] = await sharp(buffer, options)
    .resize(size, size, { withoutEnlargement: true }).webp({ lossless: true, effort: 4 }).toBuffer();
  return results;
}

type Store = ReturnType<typeof pgLogoVariants>;
interface Dependencies {
  store: Pick<Store, 'findByIds' | 'appendVariants'>;
  storageConfig: typeof logoVariantStorageConfig;
  read: typeof readLogoVariantSource;
  upload: typeof uploadLogoVariant;
  render: typeof renderSmallLogoVariants;
  invalidate?: (station: LogoVariantStation) => Promise<void>;
}
export function createLogoVariantBackfill(deps: Dependencies) {
  let running = false;
  return async (request: LogoVariantRequest) => {
    // Validation remains enforced for non-HTTP callers as well.
    request = parseLogoVariantRequest(request);
    const config = deps.storageConfig();
    if (!config) throw Object.assign(new Error('S3 storage is not configured'), { status: 503 });
    if (!request.dryRun && running) throw Object.assign(new Error('A logo variant batch is already running'), { status: 409 });
    if (!request.dryRun) running = true;
    const results: Array<Record<string, unknown>> = [];
    const signal = AbortSignal.timeout(45_000);
    try {
      const stations = new Map((await deps.store.findByIds(request.stationIds)).map(station => [station.id, station]));
      for (const stationId of request.stationIds) {
        const station = stations.get(stationId), candidate = station && logoVariantCandidate(station, config);
        if (!station || !candidate) {
          results.push({ stationId, status: 'skipped', reason: station ? 'No eligible missing variants' : 'Station not found' });
          continue;
        }
        if (request.dryRun) {
          results.push({ stationId, slug: station.slug, status: 'eligible', sizes: candidate.sizes });
          continue;
        }
        const uploaded: string[] = [];
        try {
          signal.throwIfAborted();
          const buffer = await deps.read(candidate.key, signal);
          const rendered = await deps.render(buffer, candidate.sizes);
          const operationId = randomUUID();
          const additions: Record<string, string> = {};
          for (const size of candidate.sizes) {
            signal.throwIfAborted();
            const key = `station-logos/${candidate.folder}/variants/${operationId}/logo-${size}.webp`;
            const url = await deps.upload(key, rendered[`webp${size}`], signal);
            uploaded.push(url); additions[`webp${size}`] = url;
          }
          signal.throwIfAborted();
          const committed = await deps.store.appendVariants(station, additions);
          let cacheRefresh: 'requested' | 'warning' | undefined;
          if (committed && deps.invalidate) {
            try { await deps.invalidate(station); cacheRefresh = 'requested'; }
            catch { cacheRefresh = 'warning'; }
          }
          results.push({ stationId, slug: station.slug, status: committed ? 'updated' : 'conflict', sizes: candidate.sizes, uploaded, ...(cacheRefresh ? { cacheRefresh } : {}) });
        } catch {
          // Existing working metadata is never marked failed. Retain the new
          // unreferenced keys for an operator to review; do not delete originals.
          results.push({ stationId, slug: station.slug, status: 'failed', reason: signal.aborted ? 'Batch time limit reached' : 'Variant preparation failed; existing logo preserved', uploaded });
        }
      }
      return { dryRun: request.dryRun, requested: request.stationIds.length,
        updated: results.filter(row => row.status === 'updated').length, results };
    } finally { if (!request.dryRun) running = false; }
  };
}

let runner: ReturnType<typeof createLogoVariantBackfill> | undefined;
export const backfillLogoVariants = (request: LogoVariantRequest) => {
  runner ||= createLogoVariantBackfill({ store: pgLogoVariants(), storageConfig: logoVariantStorageConfig,
    read: readLogoVariantSource, upload: uploadLogoVariant, render: renderSmallLogoVariants,
    invalidate: async station => (await import('./logo-variant-cache')).invalidateLogoVariantCaches(station) });
  return runner(request);
};
