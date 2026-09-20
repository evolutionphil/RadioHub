import CacheManager from '../cache';
import { buildAllSitemapManifests, getActiveManifest } from '../seo/sitemap-manifest-builder';
import { scheduledCacheClearService } from './scheduled-cache-clear';

/** Match the existing sitemap rebuild's XML/edge invalidation, without resetting
 * qualified UI languages: repairing station prose does not change that cohort. */
export async function publishDescriptionRepairs(assertActive: () => void): Promise<void> {
  assertActive();
  const result = await buildAllSitemapManifests({ force: true });
  if (!result.built) throw new Error('Sitemap refresh was unavailable or already running');
  assertActive();
  await CacheManager.clearByPattern('admin_stations:');
  await CacheManager.clearByPattern('sitemap:');
  await CacheManager.clearByPattern('precomputed_');
  const base = (process.env.PUBLIC_BASE_URL || 'https://themegaradio.com').replace(/\/$/, '');
  const urls = [`${base}/sitemap-index.xml`, `${base}/sitemap.xml`];
  for (const language of result.qualifiedLanguages) {
    assertActive();
    urls.push(`${base}/sitemap-main-${language}.xml`, `${base}/sitemap-genres-${language}.xml`);
    const manifest = await getActiveManifest('stations', language);
    if (!manifest) throw new Error(`Published station sitemap is unavailable: ${language}`);
    for (let chunk = 1; chunk <= manifest.chunkCount; chunk++) urls.push(`${base}/sitemap-stations-${language}-${chunk}.xml`);
  }
  // Existing provider timeout is 30s per batch; cancellation is checked between
  // batches and never triggers a retry of an uncertain external request.
  for (let offset = 0; offset < urls.length; offset += 30) {
    assertActive();
    const purge = await scheduledCacheClearService.purgeCloudflareUrls(urls.slice(offset, offset + 30));
    if (!purge.success) throw new Error(purge.message || 'Sitemap edge cache invalidation failed');
  }
  assertActive();
}
