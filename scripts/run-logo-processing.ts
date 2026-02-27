import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
dotenv.config();

import { Station } from '../shared/mongo-schemas';
import { logoProcessor } from '../server/services/logo-processor';

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI not set');

  console.log('🔗 Connecting to MongoDB...');
  await mongoose.connect(uri);
  console.log('✅ Connected\n');

  const filter: any = {
    favicon: { $exists: true, $nin: ['', null, 'null'] },
    slug: { $exists: true, $ne: null },
    $or: [
      { 'logoAssets.status': { $exists: false } },
      { 'logoAssets.status': 'pending' },
      {
        'logoAssets.status': 'failed',
        'logoAssets.failureType': { $nin: ['http_error', 'invalid_format'] }
      },
      {
        'logoAssets.status': 'failed',
        'logoAssets.failureType': { $exists: false }
      }
    ]
  };

  const needsProcessing = await Station.countDocuments(filter);
  const completed = await Station.countDocuments({ 'logoAssets.status': 'completed' });
  const totalWithFavicon = await Station.countDocuments({ favicon: { $exists: true, $nin: ['', null, 'null'] } });

  console.log('📊 LOGO PROCESSING STATUS');
  console.log('─'.repeat(40));
  console.log(`   Total with favicon : ${totalWithFavicon}`);
  console.log(`   ✅ Already in S3   : ${completed}`);
  console.log(`   ⏳ Needs processing : ${needsProcessing}`);
  console.log(`   📁 S3 Bucket       : ${process.env.AWS_BUCKET_NAME} (${process.env.AWS_REGION})`);
  console.log('─'.repeat(40) + '\n');

  if (needsProcessing === 0) {
    console.log('🎉 All logos already processed and in S3!');
    await mongoose.disconnect();
    return;
  }

  const BATCH_FETCH = 200;
  const CONCURRENT = 8;
  const DELAY_MS = 300;

  let totalProcessed = 0;
  let totalSuccess = 0;
  let totalFailed = 0;
  let round = 0;

  console.log(`🚀 Starting (${CONCURRENT} concurrent, batches of ${BATCH_FETCH})...\n`);

  while (true) {
    const stations = await Station.find(filter).limit(BATCH_FETCH).lean() as any[];
    if (stations.length === 0) break;

    round++;
    console.log(`📦 Round ${round}: ${stations.length} stations`);

    for (let i = 0; i < stations.length; i += CONCURRENT) {
      const batch = stations.slice(i, i + CONCURRENT);
      const results = await Promise.allSettled(
        batch.map(async (station: any) => {
          if (!station.favicon || !station.slug) {
            return { success: false, name: station.name, error: 'Missing favicon/slug' };
          }
          return logoProcessor.processFromUrl(station._id.toString(), station.slug, station.favicon);
        })
      );

      results.forEach((r, idx) => {
        totalProcessed++;
        const name = (batch[idx]?.name || 'unknown').substring(0, 40);
        if (r.status === 'fulfilled' && (r.value as any).success) {
          totalSuccess++;
          console.log(`  ✅ ${name}`);
        } else {
          totalFailed++;
          const err = r.status === 'rejected' ? r.reason?.message : (r.value as any)?.error;
          console.log(`  ❌ ${name}: ${String(err).substring(0, 60)}`);
        }
      });

      await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }

    const remaining = await Station.countDocuments(filter);
    console.log(`\n  Progress: ✅${totalSuccess} ❌${totalFailed} | ⏳${remaining} remaining\n`);
    if (remaining === 0) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('\n' + '='.repeat(40));
  console.log('🎉 LOGO PROCESSING COMPLETE!');
  console.log(`   ✅ Successful: ${totalSuccess}`);
  console.log(`   ❌ Failed:     ${totalFailed}`);
  console.log(`   📦 Total:      ${totalProcessed}`);
  console.log('='.repeat(40));

  await mongoose.disconnect();
}

main().catch(e => {
  console.error('❌ Fatal error:', e.message);
  process.exit(1);
});
