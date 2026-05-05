import 'dotenv/config';
import mongoose from 'mongoose';

(async () => {
  await mongoose.connect(process.env.MONGODB_URI!);
  const col = mongoose.connection.db!.collection('stations');

  const match = {
    noIndex: { $ne: true },
    $or: [
      { countryCode: null },
      { countryCode: { $exists: false } },
      { countryCode: '' },
    ],
  };

  const total = await col.countDocuments(match);
  console.log('countryCode-null + noIndex≠true toplam:', total);
  console.log('');

  // Kategori histogramları
  const withUrl = await col.countDocuments({ ...match, url: { $exists: true, $nin: [null, ''] } });
  const withClicks = await col.countDocuments({ ...match, clickCount: { $gt: 0 } });
  const withVotes = await col.countDocuments({ ...match, votes: { $gt: 0 } });
  const withName = await col.countDocuments({ ...match, name: { $exists: true, $nin: [null, ''] } });
  const withBitrate = await col.countDocuments({ ...match, bitrate: { $gt: 0 } });
  const withSlug = await col.countDocuments({ ...match, slug: { $exists: true, $nin: [null, ''] } });
  const withDesc = await col.countDocuments({
    ...match,
    descriptions: { $exists: true, $ne: null, $type: 'object' },
  });

  console.log('PROFİL:');
  console.log(`  URL'i olan          : ${withUrl}  (${(withUrl/total*100).toFixed(1)}%)`);
  console.log(`  Slug'ı olan         : ${withSlug}  (${(withSlug/total*100).toFixed(1)}%)`);
  console.log(`  Name'i olan         : ${withName}  (${(withName/total*100).toFixed(1)}%)`);
  console.log(`  Bitrate > 0         : ${withBitrate}  (${(withBitrate/total*100).toFixed(1)}%)`);
  console.log(`  ClickCount > 0      : ${withClicks}  (${(withClicks/total*100).toFixed(1)}%)`);
  console.log(`  Votes > 0           : ${withVotes}  (${(withVotes/total*100).toFixed(1)}%)`);
  console.log(`  Description'ı var   : ${withDesc}  (${(withDesc/total*100).toFixed(1)}%)`);
  console.log('');

  // Click dağılımı - hot kayıtlar neyi temsil ediyor?
  const hot = await col
    .find(match, {
      projection: { _id: 0, name: 1, slug: 1, url: 1, clickCount: 1, votes: 1, bitrate: 1 },
    })
    .sort({ clickCount: -1 })
    .limit(10)
    .toArray();
  console.log('EN ÇOK CLICK (top 10):');
  for (const s of hot) {
    console.log(`  [${s.clickCount || 0}c/${s.votes || 0}v] ${(s.name || '(boş)').slice(0, 60)}  | slug: ${s.slug || '(yok)'} | url: ${s.url ? 'VAR' : 'YOK'}`);
  }
  console.log('');

  // En düşük (kesinlikle junk görünüyor)
  const cold = await col
    .find(match, { projection: { _id: 0, name: 1, slug: 1, url: 1, clickCount: 1, votes: 1 } })
    .sort({ clickCount: 1, votes: 1 })
    .limit(10)
    .toArray();
  console.log('EN DÜŞÜK CLICK (bottom 10 — büyük ihtimal junk):');
  for (const s of cold) {
    console.log(`  [${s.clickCount || 0}c/${s.votes || 0}v] ${(s.name || '(boş)').slice(0, 60)}  | slug: ${s.slug || '(yok)'} | url: ${s.url ? 'VAR' : 'YOK'}`);
  }
  console.log('');

  // Click 0 AND votes 0 AND url yok/boş → kesin junk sayısı
  const certainJunk = await col.countDocuments({
    ...match,
    $and: [
      { $or: [{ clickCount: { $exists: false } }, { clickCount: 0 }] },
      { $or: [{ votes: { $exists: false } }, { votes: 0 }] },
    ],
  });
  console.log('Kesin junk adayı (click=0 AND votes=0):', certainJunk);

  await mongoose.disconnect();
})();
