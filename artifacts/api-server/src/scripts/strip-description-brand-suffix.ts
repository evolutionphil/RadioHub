/**
 * One-shot script: strips the "Listen now on Mega Radio!" (and its
 * translations) from existing station AI descriptions in MongoDB.
 *
 * Why: every description was generated with the prompt instruction
 * "End with call-to-action to listen on Mega Radio", creating a
 * template fingerprint Google uses to classify the whole corpus as
 * mass-produced content → "Crawled not indexed".
 *
 * Usage:
 *   pnpm --filter @workspace/api-server exec tsx \
 *     src/scripts/strip-description-brand-suffix.ts
 *
 * Safe to re-run (idempotent). Logs count of modified documents.
 */

import mongoose from 'mongoose';
import { Station } from '@workspace/db-shared/mongo-schemas';
import { logger } from '../utils/logger';

const MONGODB_URI =
  process.env.MONGODB_URI ||
  process.env.DATABASE_URL ||
  'mongodb://localhost:27017/mega';

// Regex that matches the branded CTA sentence at the end of a description.
// Covers English + the translated variants from ctaTranslations map + the
// original English-only instruction variant.
// Anchored to end-of-string to avoid removing mid-text occurrences.
const SUFFIX_PATTERNS = [
  // English variants
  /\s*Listen now on Mega Radio[!.]?\s*$/gi,
  /\s*Listen to [^.!]*on Mega Radio[!.]?\s*$/gi,
  /\s*Stream live on Mega Radio[!.]?\s*$/gi,
  /\s*Available on Mega Radio[!.]?\s*$/gi,
  /\s*Tune in on Mega Radio[!.]?\s*$/gi,
  // German
  /\s*Hören Sie (?:es )?(?:jetzt )?(?:live )?(?:auf|bei) Mega Radio[!.]?\s*$/gi,
  /\s*Jetzt auf Mega Radio hören[!.]?\s*$/gi,
  // French
  /\s*[ÉE]coutez (?:maintenant )?sur Mega Radio[!.]?\s*$/gi,
  // Spanish
  /\s*Escucha (?:ahora )?en Mega Radio[!.]?\s*$/gi,
  // Italian
  /\s*Ascolta (?:ora )?su Mega Radio[!.]?\s*$/gi,
  // Portuguese
  /\s*Ou[çc]a (?:agora )?(?:na|no|em) Mega Radio[!.]?\s*$/gi,
  // Turkish
  /\s*[Şş]imdi Mega Radio['']da dinleyin[!.]?\s*$/gi,
  /\s*Mega Radio['']da dinleyin[!.]?\s*$/gi,
  // Dutch
  /\s*Luister (?:nu )?op Mega Radio[!.]?\s*$/gi,
  // Russian
  /\s*Слушайте (?:сейчас )?(?:на|по) Mega Radio[!.]?\s*$/gi,
  // Polish
  /\s*Słuchaj (?:teraz )?(?:na|w) Mega Radio[!.]?\s*$/gi,
  // Arabic
  /\s*استمع الآن على Mega Radio[!.]?\s*$/gi,
  /\s*استمع على Mega Radio[!.]?\s*$/gi,
  // Hebrew
  /\s*האזינ[וה] (?:כעת )?ל-?Mega Radio[!.]?\s*$/gi,
  // Japanese
  /\s*Mega Radio[でに](?:今すぐ)?聴く[!！。]?\s*$/gi,
  // Chinese
  /\s*立即在Mega Radio上收听[!！。]?\s*$/gi,
  /\s*在Mega Radio上收听[!！。]?\s*$/gi,
  // Korean
  /\s*Mega Radio에서 (?:지금 )?들어보세요[!！。]?\s*$/gi,
];

function stripSuffix(text: string): { stripped: string; changed: boolean } {
  let result = text;
  for (const pattern of SUFFIX_PATTERNS) {
    const before = result;
    result = result.replace(pattern, '');
    pattern.lastIndex = 0; // reset global regex
    if (result !== before) {
      result = result.trimEnd();
      break; // only one suffix per field
    }
  }
  return { stripped: result, changed: result !== text };
}

async function main() {
  await mongoose.connect(MONGODB_URI);
  logger.log('Connected to MongoDB');

  // Find stations that have descriptions with any language key
  const cursor = Station.find({
    descriptions: { $exists: true, $ne: {} },
  })
    .select('descriptions')
    .lean()
    .cursor();

  let processed = 0;
  let modified = 0;
  const BATCH = 500;
  const bulk: any[] = [];

  for await (const doc of cursor) {
    processed++;
    const descriptions: Record<string, any> = (doc as any).descriptions || {};
    const updates: Record<string, string> = {};

    for (const [lang, entry] of Object.entries(descriptions)) {
      if (!entry || typeof entry !== 'object') continue;

      if (typeof entry.full === 'string' && entry.full.length > 0) {
        const { stripped, changed } = stripSuffix(entry.full);
        if (changed) updates[`descriptions.${lang}.full`] = stripped;
      }
      if (typeof entry.meta === 'string' && entry.meta.length > 0) {
        const { stripped, changed } = stripSuffix(entry.meta);
        if (changed) updates[`descriptions.${lang}.meta`] = stripped;
      }
    }

    if (Object.keys(updates).length > 0) {
      modified++;
      bulk.push({
        updateOne: {
          filter: { _id: (doc as any)._id },
          update: { $set: updates },
        },
      });
    }

    if (bulk.length >= BATCH) {
      await Station.bulkWrite(bulk, { ordered: false });
      logger.log(`  Flushed ${bulk.length} updates (${processed} processed, ${modified} modified so far)`);
      bulk.length = 0;
    }
  }

  if (bulk.length > 0) {
    await Station.bulkWrite(bulk, { ordered: false });
  }

  logger.log(`Done. Processed: ${processed}, Modified: ${modified}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
