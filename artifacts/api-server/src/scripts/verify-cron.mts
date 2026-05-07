/**
 * Verify post-cron logo-processing outcomes for a configurable cohort of
 * countries. Set `BACKFILL_COUNTRIES=US,DE,RU` to override the default
 * cohort. Re-run after each `scheduled-logo-processor` pass to track the
 * remaining pending counts draining toward 0.
 */
import mongoose from 'mongoose';

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

await mongoose.connect(uri);
const Station = mongoose.connection.collection('stations');

for (const cc of COUNTRIES) {
  const buckets = await Station.aggregate([
    { $match: { countryCode: cc, 'logoAssets.lastAttempt': { $gte: new Date(Date.now() - 36 * 60 * 60 * 1000) } } },
    { $group: { _id: { status: '$logoAssets.status', failureType: '$logoAssets.failureType' }, c: { $sum: 1 } } },
    { $sort: { c: -1 } },
  ]).toArray();
  console.log(cc, JSON.stringify(buckets));

  const stillUnset = await Station.countDocuments({
    countryCode: cc,
    favicon: { $exists: true, $nin: ['', null, 'null'] },
    slug: { $exists: true, $ne: null },
    $or: [
      { logoAssets: { $exists: false } },
      { 'logoAssets.status': 'pending' },
    ],
  });
  console.log(cc, 'still-unset/pending:', stillUnset);
}
await mongoose.disconnect();
