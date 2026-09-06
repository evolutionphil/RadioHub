/**
 * One-shot read-only MongoDB inspection for Phase A audit.
 * Probes: collections, GSC data, translations, qualified-languages LKG,
 * station noIndex breakdown, junk slug counts.
 *
 * Run: MONGODB_URI=mongodb+srv://... node audit-mongo-inspection.mjs
 */
import { createRequire } from 'module';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const mongoose = require('mongoose');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '../../../../docs/seo-audit-2026-05/mongo-inspection');

const URI = process.env.MONGODB_URI;
if (!URI) { console.error('MONGODB_URI required'); process.exit(1); }

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  console.log('Connecting…');
  await mongoose.connect(URI, { serverSelectionTimeoutMS: 15000 });
  const db = mongoose.connection.db;
  console.log('Connected to db:', db.databaseName);

  const report = { db: db.databaseName, ts: new Date().toISOString() };

  // 1. Collections
  const cols = await db.listCollections().toArray();
  report.collections = cols.map(c => c.name).sort();
  console.log('\n=== Collections ===');
  for (const c of report.collections) {
    const count = await db.collection(c).estimatedDocumentCount();
    console.log(`  ${c.padEnd(45)} ${count}`);
  }

  // 2. GSC URL Inspection
  console.log('\n=== GSC URL Inspections ===');
  if (report.collections.includes('gscurlinspections')) {
    const col = db.collection('gscurlinspections');
    const total = await col.countDocuments({});
    const byState = await col.aggregate([
      { $group: { _id: '$state', n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ]).toArray();
    const byGroup = await col.aggregate([
      { $group: { _id: '$group', n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ]).toArray();
    const byLang = await col.aggregate([
      { $group: { _id: '$language', n: { $sum: 1 } } },
      { $sort: { n: -1 } },
      { $limit: 20 },
    ]).toArray();
    const stuck = await col.countDocuments({
      state: { $in: ['discovered-not-indexed', 'crawled-not-indexed'] },
    });
    const recentSample = await col.find({}).sort({ lastInspectedAt: -1 }).limit(5).toArray();

    report.gsc = { total, byState, byGroup, byLang, stuck };
    console.log(`  total: ${total}`);
    console.log(`  stuck (not indexed): ${stuck}`);
    console.log('  by state:', JSON.stringify(byState));
    console.log('  by group:', JSON.stringify(byGroup));
    console.log('  by language (top 20):', JSON.stringify(byLang));
    if (recentSample.length) {
      console.log('  recent samples:');
      for (const r of recentSample) {
        console.log(`    ${r.state?.padEnd(28)} ${r.language?.padEnd(4)} ${r.group?.padEnd(8)} ${r.url}`);
      }
    }
  } else {
    console.log('  (collection missing)');
  }

  // 3. GSC Snapshots
  console.log('\n=== GSC Indexing Snapshots (daily rollups) ===');
  if (report.collections.includes('gscindexingsnapshots')) {
    const col = db.collection('gscindexingsnapshots');
    const total = await col.countDocuments({});
    const latest = await col.find({ language: 'all', group: 'all' })
      .sort({ date: -1 }).limit(14).toArray();
    report.gscSnapshots = { total, latest14: latest.map(s => ({
      date: s.date, total: s.total, indexed: s.indexed,
      crawledNotIndexed: s.crawledNotIndexed,
      discoveredNotIndexed: s.discoveredNotIndexed,
      excluded: s.excluded, error: s.error, pending: s.pending,
    })) };
    console.log(`  total rows: ${total}`);
    console.log('  latest 14 days (language=all, group=all):');
    for (const s of latest) {
      const d = s.date?.toISOString?.()?.slice(0, 10) || s.date;
      console.log(`    ${d} | total=${s.total} indexed=${s.indexed} stuck=${(s.discoveredNotIndexed||0)+(s.crawledNotIndexed||0)} excluded=${s.excluded||0}`);
    }
  } else {
    console.log('  (collection missing)');
  }

  // 4. Translations — verify Phase C done
  console.log('\n=== Translations / Qualified Languages ===');
  if (report.collections.includes('translations') && report.collections.includes('translationkeys')) {
    const tkCol = db.collection('translationkeys');
    const tCol = db.collection('translations');
    const REQUIRED = [
      'default_station_about', 'from', 'genres', 'station_additional_info',
      'live_radio', 'online_radio', 'radio_streaming',
      'hero_worlds_best_radio', 'hero_over_100_countries', 'hero_listen_everywhere',
      'nav_genres', 'nav_regions', 'nav_stations',
      'popular_genres_title', 'popular_countries_title',
    ];
    const tkDocs = await tkCol.find({ key: { $in: REQUIRED } }).toArray();
    const keyIdMap = Object.fromEntries(tkDocs.map(d => [d.key, d._id]));
    console.log(`  TranslationKey docs found: ${tkDocs.length}/${REQUIRED.length}`);
    const missingKeys = REQUIRED.filter(k => !keyIdMap[k]);
    if (missingKeys.length) console.log(`  MISSING TranslationKey docs: ${missingKeys.join(', ')}`);

    const LANGS = ['en','tr','es','fr','de','ar','it','pt','nl','ru','pl','sv','da','no','fi','el','hu','cs','sk','ro','bg','hr','sr','sl','lv','lt','et','zh','ja','ko','hi','th','vi','id','ms','tl','he','fa','ur','bn','ta','te','mr','gu','kn','ml','pa','sw','am','zu','af','sq','az','hy','so','uk','bs'];
    const coverage = {};
    let qualified = 0;
    for (const lang of LANGS) {
      const c = await tCol.countDocuments({
        keyId: { $in: Object.values(keyIdMap) },
        language: lang,
        value: { $exists: true, $ne: '' },
      });
      coverage[lang] = c;
      if (c === REQUIRED.length) qualified++;
    }
    report.translations = { totalLangs: LANGS.length, qualifiedLangs: qualified, coverage };
    console.log(`  Qualified languages (have all 15 keys): ${qualified}/57`);
    const incomplete = Object.entries(coverage).filter(([_, c]) => c < REQUIRED.length);
    if (incomplete.length) {
      console.log('  Incomplete languages:');
      for (const [lang, c] of incomplete) console.log(`    ${lang}: ${c}/15`);
    } else {
      console.log('  ✅ ALL 57 languages have all 15 required keys!');
    }
  } else {
    console.log('  (translation collections missing)');
  }

  // 5. Qualified languages LKG
  console.log('\n=== Qualified-Languages LKG ===');
  for (const cname of ['qualifiedlanguageslkg', 'qualifiedlanguages', 'qualified_languages_lkg', 'qualified_languages']) {
    if (report.collections.includes(cname)) {
      const docs = await db.collection(cname).find({}).limit(5).toArray();
      console.log(`  ${cname}:`);
      for (const d of docs) {
        console.log(`    keys: ${Object.keys(d).join(', ')}`);
        if (d.languages) console.log(`    languages (${d.languages.length}): ${d.languages.join(',')}`);
        if (d.computedAt) console.log(`    computedAt: ${d.computedAt}`);
        if (d.value) console.log(`    value: ${JSON.stringify(d.value).slice(0, 200)}`);
      }
      report.qualifiedLkg = { collection: cname, docs };
    }
  }

  // 6. Station noIndex breakdown
  console.log('\n=== Station noIndex / slug breakdown ===');
  if (report.collections.includes('stations')) {
    const col = db.collection('stations');
    const total = await col.estimatedDocumentCount();
    const noIndex = await col.countDocuments({ noIndex: true });
    const numericSlugs = await col.countDocuments({ slug: /^-?\d+$/ });
    const emptyTranslitSlugs = await col.countDocuments({ slug: /^-\d+$/ });
    report.stations = { total, noIndex, numericSlugs, emptyTranslitSlugs };
    console.log(`  total: ${total}`);
    console.log(`  noIndex=true: ${noIndex}`);
    console.log(`  numeric-only slug: ${numericSlugs}`);
    console.log(`  -<digit> slug pattern (F1 victims): ${emptyTranslitSlugs}`);
  }

  // 7. Write full JSON
  await fs.writeFile(
    path.join(OUT, 'inspection.json'),
    JSON.stringify(report, null, 2),
    'utf8',
  );
  console.log(`\nWrote ${path.join(OUT, 'inspection.json')}`);

  await mongoose.disconnect();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
