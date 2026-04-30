import mongoose from 'mongoose';
import { SeoQualifiedLanguagesLkg, SitemapManifest } from '../shared/mongo-schemas';

async function main() {
  const uri = process.env.MONGODB_URI || '';
  if (!uri) { console.error('No MONGODB_URI'); process.exit(1); }
  await mongoose.connect(uri);
  const r1 = await SeoQualifiedLanguagesLkg.deleteMany({});
  const r2 = await SitemapManifest.deleteMany({});
  console.log(`Deleted ${r1.deletedCount} LKG docs, ${r2.deletedCount} manifest docs`);
  await mongoose.disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
