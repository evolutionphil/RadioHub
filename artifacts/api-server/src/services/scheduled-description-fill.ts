/**
 * Scheduled Description Fill (daily 04:30 Europe/Berlin)
 *
 * Runs automatically after the nightly station sync (03:00) finishes.
 * Finds all indexable stations that are missing descriptions in any of
 * the 14 universal languages and fills them via OpenAI — no manual action
 * required.
 *
 * Priority order:
 *   1. Stations with ZERO descriptions → generate native language, then
 *      translate to all 13 remaining languages.
 *   2. Stations with PARTIAL descriptions (< 14 langs) → translate missing
 *      languages from the best available source description.
 *
 * Rate limit: 1.5 s between stations (~6.5 h worst-case for 7 900 stations).
 * Hard timeout: 5 h — stops before the next day's 03:00 sync.
 *
 * Gate: set ENABLE_DESCRIPTION_FILL_CRON=false to disable on secondary replicas.
 * Manual trigger: POST /api/admin/description-fill/run
 * Status: GET /api/admin/description-fill/status
 */

import cron from 'node-cron';
import { Station } from '@workspace/db-shared/mongo-schemas';
import { logger } from '../utils/logger';
import { stripPlaceholders } from '../routes/shared-utils';

const UNIVERSAL_14 = ['en', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'ar', 'zh', 'tr', 'ja', 'ko', 'hi', 'he'] as const;
type Lang = typeof UNIVERSAL_14[number];

const RATE_LIMIT_MS = 1_500;
const HARD_TIMEOUT_MS = 5 * 60 * 60 * 1_000; // 5 hours

export interface DescriptionFillStatus {
  isRunning: boolean;
  lastRunAt: Date | null;
  lastResult: DescriptionFillResult | null;
}

export interface DescriptionFillResult {
  trigger: string;
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  totalScanned: number;
  noDescCount: number;
  partialCount: number;
  generated: number;
  translated: number;
  failed: number;
  skipped: number;
  stoppedEarly: boolean;
  stopReason?: string;
}

class ScheduledDescriptionFill {
  private isInitialized = false;
  private isRunning = false;
  private lastRunAt: Date | null = null;
  private lastResult: DescriptionFillResult | null = null;

  initialize(): void {
    if (this.isInitialized) return;
    this.isInitialized = true;

    if (process.env.ENABLE_DESCRIPTION_FILL_CRON === 'false') {
      logger.log('📝 Description fill cron DISABLED (ENABLE_DESCRIPTION_FILL_CRON=false)');
      return;
    }

    // 04:30 Europe/Berlin — after 03:00 sync, well before next day's 03:00
    cron.schedule(
      '30 4 * * *',
      () => {
        this.runOnce('cron:daily').catch((err) => {
          logger.error('❌ Description fill cron crashed:', err);
        });
      },
      { timezone: 'Europe/Berlin' },
    );
    logger.log('📝 Description fill cron initialized (daily 04:30 Europe/Berlin)');
  }

  getStatus(): DescriptionFillStatus {
    return {
      isRunning: this.isRunning,
      lastRunAt: this.lastRunAt,
      lastResult: this.lastResult,
    };
  }

  async runOnce(trigger: string = 'manual'): Promise<DescriptionFillResult> {
    if (this.isRunning) {
      logger.log(`⏭️  Description fill: skip (${trigger}) — previous run still in progress`);
      return {
        trigger,
        startedAt: new Date(),
        completedAt: new Date(),
        durationMs: 0,
        totalScanned: 0,
        noDescCount: 0,
        partialCount: 0,
        generated: 0,
        translated: 0,
        failed: 0,
        skipped: 0,
        stoppedEarly: true,
        stopReason: 'already_running',
      };
    }

    this.isRunning = true;
    const startedAt = new Date();
    const deadline = startedAt.getTime() + HARD_TIMEOUT_MS;

    let totalScanned = 0;
    let noDescCount = 0;
    let partialCount = 0;
    let generated = 0;
    let translated = 0;
    let failed = 0;
    let skipped = 0;
    let stoppedEarly = false;
    let stopReason: string | undefined;

    logger.log(`📝 Description fill START (${trigger})`);

    try {
      const { generateStationDescription, detectStationLanguage, translateDescription } =
        await import('./ai-station-description');

      // ── Phase 1: stations with NO descriptions ─────────────────────────
      const noDescFilter = {
        noIndex: { $ne: true },
        aiDescriptionSkipped: { $ne: true },
        $or: [
          { descriptions: { $exists: false } },
          { descriptions: null },
          { descriptions: {} },
          {
            $expr: {
              $eq: [{ $size: { $objectToArray: { $ifNull: ['$descriptions', {}] } } }, 0],
            },
          },
        ],
      };

      const noDescCursor = Station.find(noDescFilter)
        .select('_id name countryCode language tags homepage slug')
        .lean()
        .cursor();

      for await (const station of noDescCursor) {
        if (Date.now() > deadline) {
          stoppedEarly = true;
          stopReason = 'hard_timeout';
          break;
        }

        totalScanned++;
        noDescCount++;

        try {
          const nativeLang = detectStationLanguage(station as any);

          // Generate native language
          const result = await generateStationDescription(station as any, nativeLang);

          if (!result.success || !result.fullDescription || !result.metaDescription) {
            failed++;
            logger.log(`❌ [fill] Generate failed for "${station.name}": ${result.error}`);
            await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
            continue;
          }

          const nativeDesc = {
            full: stripPlaceholders(result.fullDescription),
            meta: stripPlaceholders(result.metaDescription),
          };

          await Station.updateOne(
            { _id: station._id },
            { $set: { [`descriptions.${nativeLang}`]: nativeDesc } },
          );
          generated++;

          // Translate to remaining 13 languages
          const missingLangs = UNIVERSAL_14.filter((l) => l !== nativeLang);
          if (missingLangs.length > 0) {
            try {
              const translations = await translateDescription(
                nativeDesc.full,
                nativeDesc.meta,
                nativeLang,
                missingLangs,
                station.name,
              );

              const bulkOps: any[] = [];
              for (const [lang, desc] of translations) {
                bulkOps.push({
                  updateOne: {
                    filter: { _id: station._id },
                    update: {
                      $set: {
                        [`descriptions.${lang}`]: {
                          full: stripPlaceholders(desc.full),
                          meta: stripPlaceholders(desc.meta),
                        },
                      },
                    },
                  },
                });
              }
              if (bulkOps.length > 0) await Station.bulkWrite(bulkOps);
              translated += translations.size;
              logger.log(
                `✅ [fill] "${station.name}" — generated ${nativeLang} + translated ${translations.size} langs`,
              );
            } catch (transErr: any) {
              logger.warn(`⚠️ [fill] Translation failed for "${station.name}": ${transErr.message}`);
              failed++;
            }
          }
        } catch (err: any) {
          failed++;
          logger.error(`❌ [fill] Error processing "${station.name}": ${err.message}`);
        }

        await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
      }

      // ── Phase 2: stations with PARTIAL descriptions ────────────────────
      if (!stoppedEarly) {
        const partialFilter: any = {
          noIndex: { $ne: true },
          aiDescriptionSkipped: { $ne: true },
          descriptions: { $exists: true, $type: 'object' },
          $expr: {
            $and: [
              { $gt: [{ $size: { $objectToArray: { $ifNull: ['$descriptions', {}] } } }, 0] },
              { $lt: [{ $size: { $objectToArray: { $ifNull: ['$descriptions', {}] } } }, 14] },
            ],
          },
        };

        const partialCursor = Station.find(partialFilter)
          .select('_id name countryCode language tags descriptions slug')
          .lean()
          .cursor();

        for await (const station of partialCursor) {
          if (Date.now() > deadline) {
            stoppedEarly = true;
            stopReason = 'hard_timeout';
            break;
          }

          totalScanned++;
          const descObj = (station.descriptions && typeof station.descriptions === 'object')
            ? (station.descriptions as Record<string, any>)
            : {};

          // Find which of the 14 langs are missing (empty or absent)
          const missingLangs: string[] = [];
          let sourceLang: string | null = null;
          let sourceDesc: { full: string; meta: string } | null = null;

          for (const lang of UNIVERSAL_14) {
            const d = descObj[lang];
            const hasFull = d && typeof d === 'object' && typeof d.full === 'string' && d.full.trim().length > 20;
            if (hasFull) {
              if (!sourceLang) { sourceLang = lang; sourceDesc = d; }
            } else {
              missingLangs.push(lang);
            }
          }

          if (missingLangs.length === 0) {
            skipped++;
            continue;
          }

          partialCount++;

          if (!sourceLang || !sourceDesc) {
            // Edge case: descriptions object has entries but all are empty — treat as no-desc
            failed++;
            continue;
          }

          try {
            const translations = await translateDescription(
              sourceDesc.full,
              sourceDesc.meta,
              sourceLang,
              missingLangs,
              station.name,
            );

            const bulkOps: any[] = [];
            for (const [lang, desc] of translations) {
              bulkOps.push({
                updateOne: {
                  filter: { _id: station._id },
                  update: {
                    $set: {
                      [`descriptions.${lang}`]: {
                        full: stripPlaceholders(desc.full),
                        meta: stripPlaceholders(desc.meta),
                      },
                    },
                  },
                },
              });
            }
            if (bulkOps.length > 0) await Station.bulkWrite(bulkOps);
            translated += translations.size;
            logger.log(
              `✅ [fill] "${station.name}" — filled ${translations.size} missing langs`,
            );
          } catch (err: any) {
            failed++;
            logger.error(`❌ [fill] Partial fill error "${station.name}": ${err.message}`);
          }

          await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
        }
      }
    } catch (err: any) {
      logger.error('❌ Description fill top-level error:', err);
      stoppedEarly = true;
      stopReason = err.message;
    } finally {
      this.isRunning = false;
    }

    const completedAt = new Date();
    const result: DescriptionFillResult = {
      trigger,
      startedAt,
      completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      totalScanned,
      noDescCount,
      partialCount,
      generated,
      translated,
      failed,
      skipped,
      stoppedEarly,
      stopReason,
    };

    this.lastRunAt = completedAt;
    this.lastResult = result;

    logger.log(
      `📝 Description fill DONE (${trigger}) — scanned=${totalScanned} noDesc=${noDescCount} partial=${partialCount} ` +
      `generated=${generated} translated=${translated} failed=${failed} skipped=${skipped} ` +
      `duration=${(result.durationMs / 1000).toFixed(0)}s${stoppedEarly ? ` STOPPED_EARLY: ${stopReason}` : ''}`,
    );

    return result;
  }
}

export const scheduledDescriptionFill = new ScheduledDescriptionFill();
