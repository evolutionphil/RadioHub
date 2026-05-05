import 'dotenv/config';
import mongoose from 'mongoose';

(async () => {
  await mongoose.connect(process.env.MONGODB_URI!);
  const col = mongoose.connection.db!.collection('stations');

  // Popülerlik sinyali: hangi alan var?
  const sample = await col.findOne({}, {
    projection: {
      playCount: 1, clickCount: 1, votes: 1, clicks: 1, clickTrend: 1,
      listeners: 1, popularity: 1, userEngagement: 1, totalPlays: 1,
    }
  });
  console.log('Popülerlik alan örnekleri:', JSON.stringify(sample, null, 2));
  console.log('');

  const pipeline = [
    { $match: { noIndex: { $ne: true } } }, // sadece geçerli (junk olmayan)
    {
      $group: {
        _id: '$countryCode',
        total: { $sum: 1 },
        hasDesc: {
          $sum: {
            $cond: [
              { $and: [
                { $ne: ['$descriptions', null] },
                { $gt: [{ $size: { $ifNull: [{ $objectToArray: '$descriptions' }, []] } }, 0] },
              ]},
              1, 0
            ]
          }
        },
        totalClicks: { $sum: { $ifNull: ['$clickCount', 0] } },
        totalVotes: { $sum: { $ifNull: ['$votes', 0] } },
      }
    },
    { $sort: { total: -1 } },
    { $limit: 40 },
  ];

  const rows = await col.aggregate(pipeline).toArray();
  console.log('ÜLKE BAZINDA KAPSAM (geçerli istasyon, noIndex≠true, ilk 40 ülke)');
  console.log('='.repeat(95));
  console.log('Country | Total  | HasDesc | MISSING | Missing% | TotalClicks | TotalVotes');
  console.log('-'.repeat(95));
  let totalMissing = 0;
  let totalAll = 0;
  for (const r of rows) {
    const missing = r.total - r.hasDesc;
    const pct = (missing / r.total * 100).toFixed(0);
    totalMissing += missing;
    totalAll += r.total;
    console.log(
      `  ${String(r._id || '?').padEnd(5)} | ${String(r.total).padStart(6)} | ${String(r.hasDesc).padStart(7)} | ${String(missing).padStart(7)} | ${pct.padStart(7)}% | ${String(r.totalClicks).padStart(11)} | ${String(r.totalVotes).padStart(10)}`
    );
  }
  console.log('-'.repeat(95));
  console.log(`  TOPLAM | ${String(totalAll).padStart(6)} |         | ${String(totalMissing).padStart(7)} | (ilk 40 ülke)`);

  await mongoose.disconnect();
})();
