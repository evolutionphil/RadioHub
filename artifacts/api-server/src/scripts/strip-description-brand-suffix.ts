import { pathToFileURL } from "node:url";
import path from "node:path";
/**
 * One-shot script: strips the "Listen now on Mega Radio!" (and its
 * translations) from existing station AI descriptions in PostgreSQL.
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

import {
  initializePostgres,
  closePostgres,
  getPostgresPool,
} from "../postgres-runtime";
import { logger } from "../utils/logger";

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

export function stripSuffix(text: string): {
  stripped: string;
  changed: boolean;
} {
  let result = text;
  for (const pattern of SUFFIX_PATTERNS) {
    const before = result;
    result = result.replace(pattern, "");
    pattern.lastIndex = 0; // reset global regex
    if (result !== before) {
      result = result.trimEnd();
      break; // only one suffix per field
    }
  }
  return { stripped: result, changed: result !== text };
}

async function main() {
  await initializePostgres();
  let cursor = "",
    processed = 0,
    modified = 0,
    concurrentChanges = 0;
  try {
    while (true) {
      const batch = (
        await getPostgresPool().query(
          "SELECT id,descriptions FROM stations WHERE id>$1 AND jsonb_typeof(descriptions)='object' AND descriptions<>'{}'::jsonb ORDER BY id LIMIT 500",
          [cursor],
        )
      ).rows;
      if (!batch.length) break;
      for (const row of batch) {
        processed++;
        const original = JSON.stringify(row.descriptions);
        let changed = false;
        for (const entry of Object.values(row.descriptions) as any[]) {
          if (!entry || typeof entry !== "object") continue;
          for (const field of ["full", "meta"]) {
            if (typeof entry[field] !== "string") continue;
            const result = stripSuffix(entry[field]);
            if (result.changed) {
              entry[field] = result.stripped;
              changed = true;
            }
          }
        }
        if (changed) {
          // Compare-and-swap: never overwrite a concurrent editor/AI update.
          const result = await getPostgresPool().query(
            "UPDATE stations SET descriptions=$2::jsonb,updated_at=now() WHERE id=$1 AND descriptions=$3::jsonb",
            [row.id, JSON.stringify(row.descriptions), original],
          );
          if (result.rowCount) modified++;
          else concurrentChanges++;
        }
      }
      cursor = batch[batch.length - 1].id;
    }
    logger.log(
      "Done. Processed: " +
        processed +
        ", Modified: " +
        modified +
        ", Concurrent changes skipped: " +
        concurrentChanges,
    );
  } finally {
    await closePostgres();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
