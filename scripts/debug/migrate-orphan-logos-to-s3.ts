import 'dotenv/config';
import mongoose from 'mongoose';
import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';
import { uploadToS3, isS3Configured } from '../../server/services/s3-storage';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(dryRun ? '🔍 DRY RUN modu' : '🚀 GERÇEK ÇALIŞTIRMA');
  console.log('S3 yapılandırılmış mı:', isS3Configured());
  if (!isS3Configured()) throw new Error('AWS_BUCKET_NAME / KEY / SECRET eksik');

  const uri = process.env.MONGODB_URI || process.env.MONGO_URL;
  if (!uri) throw new Error('MONGODB_URI yok');
  await mongoose.connect(uri);
  const col = mongoose.connection.db!.collection('stations');

  const rows = await col.find({
    favicon: { $regex: '^/station-logos/' },
    $or: [
      { logoAssets: { $exists: false } },
      { 'logoAssets.status': { $ne: 'completed' } },
    ],
  }).toArray();

  console.log(`\n📋 İşlenecek istasyon sayısı: ${rows.length}\n`);

  let ok = 0, skipped = 0, failed = 0;
  const errors: string[] = [];

  for (const s of rows) {
    const fav: string = s.favicon;
    // /station-logos/{folder}/{filename}
    const m = fav.match(/^\/station-logos\/([^/]+)\/(.+)$/);
    if (!m) {
      console.log(`⚠️  ${s.name}: regex match başarısız → ${fav}`);
      skipped++; continue;
    }
    const folder = m[1];
    const localFolderPath = path.resolve(process.cwd(), 'public', 'station-logos', folder);

    if (!existsSync(localFolderPath)) {
      console.log(`⚠️  ${s.name}: yerel klasör yok → ${localFolderPath}`);
      skipped++; continue;
    }

    const files = await fs.readdir(localFolderPath);
    const webp48 = files.find(f => f === 'logo-48.webp');
    const webp96 = files.find(f => f === 'logo-96.webp');
    const webp256 = files.find(f => f === 'logo-256.webp');
    const original = files.find(f => f.startsWith('original'));

    if (!webp256 && !webp48) {
      console.log(`⚠️  ${s.name}: logo-48/256.webp ikisi de yok, dosyalar: ${files.join(',')}`);
      skipped++; continue;
    }

    const logoAssets: any = { folder, status: 'completed', processedAt: new Date() };

    try {
      // Her boyut için S3'e yükle
      const tasks: Array<[string, string, string]> = []; // [filename, key, asset-prop]
      if (webp48)   tasks.push([webp48,   `station-logos/${folder}/${webp48}`,   'webp48']);
      if (webp96)   tasks.push([webp96,   `station-logos/${folder}/${webp96}`,   'webp96']);
      if (webp256)  tasks.push([webp256,  `station-logos/${folder}/${webp256}`,  'webp256']);
      if (original) tasks.push([original, `station-logos/${folder}/${original}`, 'original']);

      for (const [filename, s3Key, prop] of tasks) {
        const buf = await fs.readFile(path.join(localFolderPath, filename));
        if (dryRun) {
          console.log(`  [DRY] ${s.name}: ${filename} → s3://${s3Key} (${buf.length} bytes)`);
          // dry mode için URL'i tahmin et
          const region = process.env.AWS_REGION || 'eu-north-1';
          const bucket = process.env.AWS_BUCKET_NAME;
          logoAssets[prop] = `https://${bucket}.s3.${region}.amazonaws.com/${s3Key}`;
        } else {
          const url = await uploadToS3(s3Key, buf, 'image/webp');
          logoAssets[prop] = url;
        }
      }

      if (!dryRun) {
        await col.updateOne(
          { _id: s._id },
          {
            $set: { logoAssets },
            $unset: { favicon: '' },
          }
        );
      }

      console.log(`✅ ${s.name.padEnd(40)} | folder=${folder} | yüklenen: ${tasks.map(t => t[2]).join(',')}`);
      ok++;
    } catch (e: any) {
      console.log(`❌ ${s.name}: ${e.message}`);
      errors.push(`${s.name}: ${e.message}`);
      failed++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`SONUÇ: ✅ ${ok} başarılı | ⚠️ ${skipped} atlandı | ❌ ${failed} hata`);
  console.log('='.repeat(60));
  if (errors.length) {
    console.log('Hatalar:');
    errors.forEach(e => console.log('  -', e));
  }

  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
