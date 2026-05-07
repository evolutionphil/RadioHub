/**
 * Sample-process a small cohort from each just-enqueued country, mimicking
 * what the nightly `scheduled-logo-processor` will do. Used purely to
 * gather empirical evidence that the enqueued stations don't bounce
 * straight into permanent-failure terminal states.
 *
 * Configurable via env:
 *   BACKFILL_COUNTRIES=US,DE,RU  (comma list, default US,DE,RU,FR,GB)
 *   SAMPLE=15                    (per-country cohort size, default 15)
 */
import mongoose from 'mongoose';
import { Station } from '../shared/mongo-schemas.js';
import { logoProcessor } from '../services/logo-processor.js';

const uri =
  process.env.MONGODB_URI ||
  process.env.DATABASE_URL ||
  process.env.MONGO_URI;
if (!uri) {
  throw new Error(
    'MONGODB_URI / DATABASE_URL / MONGO_URI not set in env — cannot connect to Mongo.',
  );
}

const COUNTRIES = (process.env.BACKFILL_COUNTRIES || 'US,DE,RU,FR,GB')
  .split(',')
  .map((c) => c.trim().toUpperCase())
  .filter(Boolean);
const SAMPLE = Number(process.env.SAMPLE || 15);

await mongoose.connect(uri);

const totals: Record<string, Record<string, number>> = {};

for (const cc of COUNTRIES) {
  const cohort = await Station.find({
    countryCode: cc,
    favicon: { $exists: true, $nin: ['', null, 'null'] },
    slug: { $exists: true, $ne: null },
    logoAssets: { $exists: false },
  })
    .select('_id slug favicon')
    .limit(SAMPLE)
    .lean();

  const bucket: Record<string, number> = {};
  for (const s of cohort as Array<{ _id: unknown; slug: string; favicon: string }>) {
    try {
      const r = await logoProcessor.processFromUrl(String(s._id), s.slug, s.favicon);
      const key = r.success ? 'completed' : `failed:${r.failureType ?? 'unknown'}`;
      bucket[key] = (bucket[key] ?? 0) + 1;
    } catch {
      bucket['threw'] = (bucket['threw'] ?? 0) + 1;
    }
  }
  totals[cc] = bucket;
  console.log(cc, JSON.stringify(bucket));
}

console.log('TOTALS', JSON.stringify(totals));
await mongoose.disconnect();
