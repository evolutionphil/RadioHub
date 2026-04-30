/**
 * Cloudflare cache purge for all sitemap URLs.
 *
 * Usage (DRY-RUN — default, prints URLs without calling CF):
 *   npx tsx scripts/cloudflare-purge-sitemaps.ts
 *
 * Usage (LIVE — actually purges via CF API):
 *   PURGE=1 npx tsx scripts/cloudflare-purge-sitemaps.ts
 *
 * Required env vars (live mode only):
 *   CLOUDFLARE_API_KEY  — API token with Cache Purge permission
 *   CLOUDFLARE_ZONE_ID  — Zone for themegaradio.com
 *
 * Cloudflare's per-call /purge_cache limit is 30 URLs per request, so we
 * batch in groups of 30. We purge:
 *   - /robots.txt
 *   - /sitemap-index.xml
 *   - /sitemap-main-{lang}.xml          (legacy + new)
 *   - /sitemap-genres-{lang}.xml        (new)
 *   - /sitemap-stations-{lang}-{n}.xml  (new, derived from manifest)
 *   - Plus a SUPERSET of the OLD pattern /sitemap-stations-{lang}-1..50.xml
 *     so any cached 200s (now 410s) are flushed too.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import {
  ACTIVE_SITEMAP_LANGUAGES,
} from '../shared/seo-config';
import {
  SitemapManifest,
} from '../shared/mongo-schemas';

const BASE = 'https://themegaradio.com';
const CF_BATCH_SIZE = 30;

interface CFPurgeResponse {
  success: boolean;
  errors?: Array<{ code: number; message: string }>;
}

async function buildPurgeList(): Promise<string[]> {
  const urls = new Set<string>();
  urls.add(`${BASE}/robots.txt`);
  urls.add(`${BASE}/sitemap-index.xml`);
  urls.add(`${BASE}/sitemap-main.xml`); // legacy 301

  // For every active language, purge main + genres
  for (const lang of ACTIVE_SITEMAP_LANGUAGES) {
    urls.add(`${BASE}/sitemap-main-${lang}.xml`);
    urls.add(`${BASE}/sitemap-genres-${lang}.xml`);
  }

  // For every active language, purge OLD pattern chunks 1..50 so previously
  // cached "empty 200" responses are flushed (Bing's 1023 list).
  for (const lang of ACTIVE_SITEMAP_LANGUAGES) {
    for (let i = 1; i <= 50; i++) {
      urls.add(`${BASE}/sitemap-stations-${lang}-${i}.xml`);
    }
  }

  // Also purge the live manifest's actual chunk URLs (in case CF held the
  // pre-refactor 200s with stale content).
  const uri = process.env.MONGODB_URI || '';
  if (uri) {
    await mongoose.connect(uri);
    try {
      const manifests = await SitemapManifest.find({
        type: 'stations',
        status: 'active',
      }).lean();
      for (const m of manifests) {
        for (const c of m.chunks) {
          urls.add(`${BASE}/sitemap-stations-${m.language}-${c.chunk}.xml`);
        }
      }
    } finally {
      await mongoose.disconnect();
    }
  }

  return Array.from(urls).sort();
}

async function purgeBatch(urls: string[], apiKey: string, zoneId: string): Promise<CFPurgeResponse> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ files: urls }),
    },
  );
  return res.json() as Promise<CFPurgeResponse>;
}

async function main() {
  const live = process.env.PURGE === '1';
  const urls = await buildPurgeList();
  console.log(`📋 Total purge candidates: ${urls.length}`);
  console.log(`Mode: ${live ? '🚀 LIVE (will hit Cloudflare API)' : '🧪 DRY-RUN (no API call)'}`);
  if (!live) {
    for (const u of urls.slice(0, 20)) console.log('  ', u);
    if (urls.length > 20) console.log(`  ... and ${urls.length - 20} more`);
    console.log('\nRe-run with PURGE=1 to actually purge.');
    return;
  }

  const apiKey = process.env.CLOUDFLARE_API_KEY;
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  if (!apiKey || !zoneId) {
    console.error('❌ Missing CLOUDFLARE_API_KEY or CLOUDFLARE_ZONE_ID');
    process.exit(1);
  }

  let okBatches = 0;
  let failBatches = 0;
  for (let i = 0; i < urls.length; i += CF_BATCH_SIZE) {
    const batch = urls.slice(i, i + CF_BATCH_SIZE);
    const resp = await purgeBatch(batch, apiKey, zoneId);
    if (resp.success) {
      okBatches++;
      console.log(`✅ batch ${i / CF_BATCH_SIZE + 1}: ${batch.length} URLs purged`);
    } else {
      failBatches++;
      console.error(`❌ batch ${i / CF_BATCH_SIZE + 1} failed:`, resp.errors);
    }
    // Throttle a bit to stay well within CF's per-second rate limit.
    await new Promise((r) => setTimeout(r, 250));
  }
  console.log(`\nDone. ok=${okBatches} fail=${failBatches} total=${urls.length} URLs`);
  if (failBatches > 0) process.exit(1);
}

main().catch((e) => {
  console.error('fatal', e);
  process.exit(1);
});
