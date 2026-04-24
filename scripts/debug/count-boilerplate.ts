import 'dotenv/config';
import mongoose from 'mongoose';

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URL;
  if (!uri) throw new Error('MONGODB_URI yok');
  await mongoose.connect(uri);
  const db = mongoose.connection.db!;

  const tk = db.collection('translationkeys');
  const tv = db.collection('translations');
  const stations = db.collection('stations');

  // 1) default_station_about anahtarını bul
  const keyDoc = await tk.findOne({ key: 'default_station_about' });
  if (!keyDoc) { console.log('default_station_about anahtarı yok'); process.exit(0); }
  console.log('keyId:', keyDoc._id);
  console.log('defaultValue:', (keyDoc as any).defaultValue || '(yok)');
  console.log('');

  // 2) Tüm dillerdeki değerleri çek
  const allValues = await tv.find(
    { keyId: keyDoc._id },
    { projection: { _id: 0, language: 1, value: 1, isCompleted: 1 } }
  ).toArray();
  console.log(`Toplam dil çevirisi: ${allValues.length}`);
  console.log('');

  // 3) Hedef metni içeren dilleri tespit et
  const TARGET_FRAGMENTS = [
    /Tune in to Mega Rad[iy]o/i,
    /Mega Radyo/,
    /Enjoy listening to .{1,80}\bnow!/i,
  ];

  const matchedLangs: string[] = [];
  console.log('='.repeat(72));
  console.log('default_station_about — TÜM DİL DEĞERLERİ');
  console.log('='.repeat(72));
  for (const v of allValues.sort((a: any, b: any) => (a.language || '').localeCompare(b.language || ''))) {
    const lang = (v as any).language;
    const value = String((v as any).value || '');
    const hit = TARGET_FRAGMENTS.some(rx => rx.test(value));
    if (hit) matchedLangs.push(lang);
    const marker = hit ? ' <<< HEDEF' : '';
    console.log(`  [${lang}] ${value.slice(0, 180)}${value.length > 180 ? '…' : ''}${marker}`);
  }
  console.log('');
  console.log('▸ HEDEF METNİ İÇEREN DİLLER:', matchedLangs.length ? matchedLangs.join(', ') : '(yok)');
  console.log('');

  // 4) Toplam sayım
  const total = await stations.countDocuments({});
  console.log('='.repeat(72));
  console.log('İSTASYON SAYISI ÖZETI');
  console.log('='.repeat(72));
  console.log('Toplam istasyon:', total);
  console.log('');

  if (matchedLangs.length === 0) {
    console.log('default_station_about hiçbir dilde tam eşleşmiyor.');
    console.log('Kullanıcının gördüğü metin başka bir kaynaktan gelmiş olabilir.');
    await mongoose.disconnect();
    return;
  }

  // 5) Her hedef dil için: kaç istasyon fallback gösteriyor?
  console.log('Fallback gösteren istasyon sayısı (hedef dillerde):');
  console.log('Mantık: descriptions[lang].full BOŞ VE descriptions[en].full BOŞ → fallback gösterilir');
  console.log('');
  for (const lang of matchedLangs) {
    const conditions: any[] = [
      { $or: [
          { descriptions: { $exists: false } },
          { descriptions: null },
          { [`descriptions.${lang}.full`]: { $in: [null, ''] } },
          { [`descriptions.${lang}`]: { $exists: false } },
          { [`descriptions.${lang}.full`]: { $exists: false } },
        ] },
    ];
    if (lang !== 'en') {
      conditions.push({ $or: [
          { descriptions: { $exists: false } },
          { descriptions: null },
          { [`descriptions.en.full`]: { $in: [null, ''] } },
          { [`descriptions.en`]: { $exists: false } },
          { [`descriptions.en.full`]: { $exists: false } },
        ] });
    }
    const cnt = await stations.countDocuments({ $and: conditions });
    console.log(`  [${lang}] fallback gösteren: ${cnt}  (toplamın %${(cnt/total*100).toFixed(1)}'i)`);
  }

  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
