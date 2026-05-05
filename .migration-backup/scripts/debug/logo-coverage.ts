import 'dotenv/config';
import mongoose from 'mongoose';

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URL;
  if (!uri) throw new Error('MONGODB_URI yok');
  await mongoose.connect(uri);
  const col = mongoose.connection.db!.collection('stations');

  const total = await col.countDocuments({});
  const s3Done = await col.countDocuments({ 'logoAssets.status': 'completed' });
  const s3Pending = await col.countDocuments({ 'logoAssets.status': 'pending' });
  const s3Processing = await col.countDocuments({ 'logoAssets.status': 'processing' });
  const s3Failed = await col.countDocuments({ 'logoAssets.status': 'failed' });
  const noS3 = await col.countDocuments({ logoAssets: { $exists: false } });
  const localImg = await col.countDocuments({ localImagePath: { $exists: true, $ne: null, $nin: ['', null] } });
  const noFavicon = await col.countDocuments({
    $and: [
      { 'logoAssets.status': { $ne: 'completed' } },
      { $or: [
          { localImagePath: { $exists: false } },
          { localImagePath: null },
          { localImagePath: '' },
        ] },
      { $or: [
          { favicon: { $exists: false } },
          { favicon: null },
          { favicon: '' },
        ] },
    ],
  });
  const onlyHttpFavicon = await col.countDocuments({
    $and: [
      { 'logoAssets.status': { $ne: 'completed' } },
      { favicon: { $regex: '^http://', $options: 'i' } },
    ],
  });
  const onlyHttpsFavicon = await col.countDocuments({
    $and: [
      { 'logoAssets.status': { $ne: 'completed' } },
      { favicon: { $regex: '^https://', $options: 'i' } },
    ],
  });

  console.log('='.repeat(60));
  console.log('LOGO KAYNAK KAPSAMA TABLOSU');
  console.log('='.repeat(60));
  console.log('Toplam istasyon                       :', total);
  console.log('');
  console.log('S3 logo HAZIR (status=completed)      :', s3Done, `(%${(s3Done/total*100).toFixed(1)})`);
  console.log('S3 logo bekliyor (pending)            :', s3Pending);
  console.log('S3 logo işleniyor (processing)        :', s3Processing);
  console.log('S3 logo başarısız (failed)            :', s3Failed);
  console.log('logoAssets alanı YOK                  :', noS3);
  console.log('Yerel localImagePath var              :', localImg);
  console.log('');
  console.log('S3 hazır DEĞİL ve favicon HTTPS       :', onlyHttpsFavicon, '(direkt URL ile gelir, sorunsuz)');
  console.log('S3 hazır DEĞİL ve favicon HTTP        :', onlyHttpFavicon, '(image-proxy üzerinden gelir)');
  console.log('S3 hazır DEĞİL ve favicon HİÇ YOK     :', noFavicon, '(fallback: /images/no-image.webp)');

  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
