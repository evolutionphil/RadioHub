import 'dotenv/config';
import mongoose from 'mongoose';

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URL;
  if (!uri) throw new Error('MONGODB_URI yok');
  await mongoose.connect(uri);
  const db = mongoose.connection.db!;
  const col = db.collection('stations');

  const total = await col.countDocuments({});
  const noIndex = await col.countDocuments({ noIndex: true });
  const missingDesc = await col.countDocuments({
    $or: [
      { descriptions: { $exists: false } },
      { descriptions: null },
      { descriptions: {} },
    ],
  });
  const hasDesc = total - missingDesc;

  console.log('='.repeat(60));
  console.log('STATION AI-DESCRIPTION COVERAGE AUDIT');
  console.log('='.repeat(60));
  console.log('Toplam istasyon                :', total);
  console.log('noIndex=true (junk/pruned)     :', noIndex);
  console.log('descriptions alanı HIÇ YOK/boş :', missingDesc, `(${(missingDesc/total*100).toFixed(1)}%)`);
  console.log('descriptions alanı VAR         :', hasDesc, `(${(hasDesc/total*100).toFixed(1)}%)`);
  console.log('');

  const cursor = col.find(
    { descriptions: { $exists: true, $ne: null } },
    { projection: { _id: 0, name: 1, countryCode: 1, descriptions: 1 } }
  );

  const perLangFull = new Map<string, number>();
  const perLangHalf = new Map<string, number>();
  const langCountHist = new Map<number, number>();
  let promptLeakCount = 0;
  const promptLeakSamples: Array<{ name: string; lang: string; snippet: string }> = [];
  const LEAK_PATTERNS = [
    /\d{2,3}-\d{2,3}\s*(Zeichen|caract[eè]res|caracteri|characters|字|문자)/i,
    /D[EÉ]CRIPTION M[EÉ]TA TRADUITE/i,
    /META DESCRIPTION TRANSLATED/i,
    /^\s*-\s*\d{2,3}/,
  ];
  let scanned = 0;

  for await (const doc of cursor) {
    scanned++;
    const d: any = doc.descriptions || {};
    let tamCount = 0;
    for (const lang of Object.keys(d)) {
      const e = d[lang];
      if (!e) continue;
      const full = typeof e === 'string' ? e : (e.full || '');
      const meta = typeof e === 'string' ? e : (e.meta || '');
      const hasFull = full.trim().length > 0;
      const hasMeta = meta.trim().length > 0;
      if (hasFull && hasMeta) {
        tamCount++;
        perLangFull.set(lang, (perLangFull.get(lang) || 0) + 1);
        const metaStr = String(meta);
        for (const p of LEAK_PATTERNS) {
          if (p.test(metaStr)) {
            promptLeakCount++;
            if (promptLeakSamples.length < 20) {
              promptLeakSamples.push({
                name: doc.name as string,
                lang,
                snippet: metaStr.slice(0, 120),
              });
            }
            break;
          }
        }
      } else if (hasFull || hasMeta) {
        perLangHalf.set(lang, (perLangHalf.get(lang) || 0) + 1);
      }
    }
    langCountHist.set(tamCount, (langCountHist.get(tamCount) || 0) + 1);
  }

  console.log('TAM (full+meta dolu) dil sayısı dağılımı:');
  const bucket: Record<string, number> = { '0': 0, '1': 0, '2-3': 0, '4-6': 0, '7-10': 0, '11-13': 0, '14+': 0 };
  for (const [k, v] of langCountHist) {
    if (k === 0) bucket['0'] += v;
    else if (k === 1) bucket['1'] += v;
    else if (k <= 3) bucket['2-3'] += v;
    else if (k <= 6) bucket['4-6'] += v;
    else if (k <= 10) bucket['7-10'] += v;
    else if (k <= 13) bucket['11-13'] += v;
    else bucket['14+'] += v;
  }
  for (const [k, v] of Object.entries(bucket)) {
    const pct = (v / scanned * 100).toFixed(1);
    console.log(`  ${k.padEnd(6)} dil : ${String(v).padStart(7)} istasyon  (${pct}%)`);
  }
  console.log('');

  console.log('Dil bazında kapsam (descriptions alanı olan', scanned, 'istasyon içinde):');
  const allLangs = new Set<string>([...perLangFull.keys(), ...perLangHalf.keys()]);
  const langList = [...allLangs].sort((a, b) => (perLangFull.get(b) || 0) - (perLangFull.get(a) || 0));
  console.log('  lang |      TAM |   YARIM |  TAM%');
  console.log('  -----+----------+---------+-------');
  for (const lang of langList) {
    const full = perLangFull.get(lang) || 0;
    const half = perLangHalf.get(lang) || 0;
    const pct = (full / scanned * 100).toFixed(1);
    console.log(`  ${lang.padEnd(4)} | ${String(full).padStart(8)} | ${String(half).padStart(7)} | ${pct.padStart(5)}%`);
  }
  console.log('');

  console.log('PROMPT-LEAK tespiti (meta alanında AI talimatı sızmış):');
  console.log('  Toplam sızıntı kaydı         :', promptLeakCount);
  console.log('  Örnekler:');
  for (const s of promptLeakSamples) {
    console.log(`    [${s.lang}] ${s.name}: "${s.snippet}"`);
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
