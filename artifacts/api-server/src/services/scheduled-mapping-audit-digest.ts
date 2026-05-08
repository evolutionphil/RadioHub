import cron from 'node-cron';
import { logger } from '../utils/logger';
import {
  emailMappingAuditDigest,
  type MappingAuditDigestEntry,
} from './admin-audit-email';
import {
  resolveMappingAuditDigestSettings,
  type MappingAuditDigestCadence,
} from './mapping-audit-digest-settings';

/**
 * Task #211 — digest of country-language mapping audit activity.
 * Task #284 — admin/env-tunable cadence (off / daily / weekly).
 *
 * Queries `ClearedOverridesAuditLog` rows for the active lookback
 * window, groups them by action type, and emails admins a single
 * summary so they have passive oversight of every override change
 * without polling the dashboard.
 *
 * Cron schedule: every day at 06:00 Europe/Berlin — after the nightly
 *   genre-slug cleanup (Sun 05:00) and the sitemap-diff IndexNow run
 *   (04:45) so the digest reflects a fully-settled overnight state.
 *   On each tick the scheduler resolves the active cadence:
 *     - `off`    → skip silently (manual runs still work).
 *     - `daily`  → 24h lookback window.
 *     - `weekly` → only fires on Monday Europe/Berlin with a 7d window.
 *
 * Distributed-safety: in split deployments, set
 *   `ENABLE_MAPPING_AUDIT_DIGEST_CRON=false` on every replica EXCEPT one.
 *   Default is `true` (single-replica deploys work out of the box).
 *
 * Opt-in: like every other admin-audit email, delivery only happens when
 *   `ADMIN_AUDIT_EMAIL_RECIPIENTS` is set. Empty windows skip silently.
 *
 * Cadence configuration (Task #284):
 *   - Admin UI: PUT `/api/admin/settings/mapping-audit-digest`
 *     `{ cadence: 'off' | 'daily' | 'weekly' }`.
 *   - Env var fallback: `MAPPING_AUDIT_DIGEST_CADENCE`.
 *   - Default: `daily` (preserves Task #211 behaviour).
 */
const WEEKLY_RUN_WEEKDAY = 1; // Monday in Europe/Berlin

class ScheduledMappingAuditDigest {
  private static instance: ScheduledMappingAuditDigest;
  private isInitialized = false;
  private isRunning = false;
  private lastRunAt: Date | null = null;
  private lastResult: {
    skipped: boolean;
    reason?: string;
    totalEntries: number;
    cadence?: MappingAuditDigestCadence;
    error?: string;
  } | null = null;

  static getInstance(): ScheduledMappingAuditDigest {
    if (!ScheduledMappingAuditDigest.instance) {
      ScheduledMappingAuditDigest.instance = new ScheduledMappingAuditDigest();
    }
    return ScheduledMappingAuditDigest.instance;
  }

  initialize(): void {
    if (this.isInitialized) {
      logger.log('📬 Scheduled mapping-audit digest already initialized');
      return;
    }
    if (process.env.ENABLE_MAPPING_AUDIT_DIGEST_CRON === 'false') {
      this.isInitialized = true;
      logger.log(
        '📬 Scheduled mapping-audit digest DISABLED (ENABLE_MAPPING_AUDIT_DIGEST_CRON=false)',
      );
      return;
    }
    this.isInitialized = true;

    cron.schedule(
      '0 6 * * *',
      () => {
        this.runOnce('cron:scheduled', { respectCadence: true }).catch((err) => {
          logger.error('❌ Scheduled mapping-audit digest crashed:', err);
        });
      },
      { timezone: 'Europe/Berlin' },
    );
    logger.log(
      '📬 Scheduled mapping-audit digest initialized ' +
        '(cron 06:00 Europe/Berlin, cadence resolved per tick)',
    );
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      lastRunAt: this.lastRunAt,
      lastResult: this.lastResult,
    };
  }

  /**
   * Returns the Europe/Berlin weekday (0=Sun..6=Sat) for the given
   * instant. Used to gate the weekly cadence onto Mondays regardless of
   * the host timezone.
   */
  private berlinWeekday(at: Date): number {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Berlin',
      weekday: 'short',
    }).formatToParts(at);
    const w = parts.find((p) => p.type === 'weekday')?.value ?? '';
    const map: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    return map[w] ?? 0;
  }

  async runOnce(
    trigger: string = 'manual',
    opts: { respectCadence?: boolean } = {},
  ): Promise<{
    skipped: boolean;
    reason?: string;
    totalEntries: number;
    cadence?: MappingAuditDigestCadence;
  } | null> {
    if (this.isRunning) {
      logger.log(
        `⏭️  mapping-audit digest: skip (${trigger}) — previous run still in progress`,
      );
      return null;
    }
    this.isRunning = true;
    const windowEnd = new Date();
    try {
      const resolved = await resolveMappingAuditDigestSettings();
      const cadence = resolved.cadence;

      if (opts.respectCadence) {
        if (cadence === 'off') {
          const result = {
            skipped: true,
            reason: 'cadence-off',
            totalEntries: 0,
            cadence,
          };
          this.lastResult = result;
          logger.log(
            `📬 mapping-audit digest SKIP (${trigger}) — cadence=off`,
          );
          return result;
        }
        if (cadence === 'weekly') {
          const weekday = this.berlinWeekday(windowEnd);
          if (weekday !== WEEKLY_RUN_WEEKDAY) {
            const result = {
              skipped: true,
              reason: 'cadence-weekly-wrong-day',
              totalEntries: 0,
              cadence,
            };
            this.lastResult = result;
            logger.log(
              `📬 mapping-audit digest SKIP (${trigger}) — cadence=weekly, ` +
                `Berlin weekday=${weekday} (waiting for ${WEEKLY_RUN_WEEKDAY})`,
            );
            return result;
          }
        }
      }

      const windowStart = new Date(windowEnd.getTime() - resolved.lookbackMs);
      logger.log(
        `📬 mapping-audit digest START (${trigger}) — cadence=${cadence} ` +
          `lookback=${Math.round(resolved.lookbackMs / 3_600_000)}h ` +
          `source=${resolved.source}`,
      );
      const { ClearedOverridesAuditLog } = await import(
        '@workspace/db-shared/mongo-schemas'
      );
      const rows = await ClearedOverridesAuditLog
        .find({ createdAt: { $gte: windowStart, $lt: windowEnd } })
        .sort({ createdAt: 1 })
        .lean();
      const entries: MappingAuditDigestEntry[] = rows.map((r: any) => ({
        createdAt: r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt),
        action: r.action,
        actorEmail: r.actorEmail ?? null,
        deletedCount: r.deletedCount ?? 0,
        changes: Array.isArray(r.changes) ? r.changes : [],
        snapshot: Array.isArray(r.snapshot) ? r.snapshot : [],
      }));
      const sendResult = await emailMappingAuditDigest({
        entries,
        windowStart,
        windowEnd,
      });
      const result = { ...sendResult, cadence };
      this.lastResult = result;
      logger.log(
        `📬 mapping-audit digest DONE — entries=${result.totalEntries} ` +
          `skipped=${result.skipped}${result.reason ? ` reason=${result.reason}` : ''} ` +
          `cadence=${cadence}`,
      );
      return result;
    } catch (err: any) {
      const errorMsg = err?.message || String(err);
      logger.error('❌ mapping-audit digest error:', errorMsg);
      this.lastResult = {
        skipped: true,
        reason: 'error',
        totalEntries: 0,
        error: errorMsg,
      };
      return this.lastResult;
    } finally {
      this.lastRunAt = new Date();
      this.isRunning = false;
    }
  }
}

export const scheduledMappingAuditDigest =
  ScheduledMappingAuditDigest.getInstance();
