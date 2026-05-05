import 'dotenv/config';
import mongoose from 'mongoose';

const NAMES = ['Arabesk FM', 'Virgin Radio', 'Best FM'];

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URL;
  if (!uri) throw new Error('MONGODB_URI yok');
  await mongoose.connect(uri);
  const col = mongoose.connection.db!.collection('stations');

  for (const name of NAMES) {
    console.log('\n' + '='.repeat(70));
    console.log(`ARAMA: "${name}"`);
    console.log('='.repeat(70));
    const rows = await col.find({
      $or: [
        { country: 'Turkey' },
        { country: 'Türkiye' },
      ],
      name: { $regex: name, $options: 'i' },
    }).limit(5).toArray();

    if (rows.length === 0) {
      console.log('  (Türkiye filtresiyle bulunamadı, ülke filtresi olmadan deneniyor...)');
      const broad = await col.find({ name: { $regex: name, $options: 'i' } }).limit(5).toArray();
      rows.push(...broad);
    }

    for (const s of rows) {
      console.log(`\n  ▶ ${s.name}  [${s.country}]  slug=${s.slug}`);
      console.log(`    _id          : ${s._id}`);
      console.log(`    favicon      : ${s.favicon || '(yok)'}`);
      console.log(`    localImagePath: ${s.localImagePath || '(yok)'}`);
      if (s.logoAssets) {
        console.log(`    logoAssets   :`);
        console.log(`      status     : ${s.logoAssets.status}`);
        console.log(`      folder     : ${s.logoAssets.folder}`);
        console.log(`      webp48     : ${s.logoAssets.webp48 || '(yok)'}`);
        console.log(`      webp96     : ${s.logoAssets.webp96 || '(yok)'}`);
        console.log(`      webp256    : ${s.logoAssets.webp256 || '(yok)'}`);
        console.log(`      original   : ${s.logoAssets.original || '(yok)'}`);
        console.log(`      processedAt: ${s.logoAssets.processedAt || '(yok)'}`);
      } else {
        console.log(`    logoAssets   : (alan yok)`);
      }
    }
  }

  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
