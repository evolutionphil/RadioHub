import cron from 'node-cron';
import { logger } from '../utils/logger';
import {
  emailMappingAuditDigest,
  type MappingAuditDigestEntry,
} from './admin-audit-email';

/**
 * Task #211 — daily digest of country-language mapping audit activity.
 *
 * Queries the last 24h of `ClearedOverridesAuditLog` rows, groups them by
 * action type, and emails admins a single summary so they have passive
 * oversight of every override change without polling the dashboard.
 *
 * Schedule: every day at 06:00 Europe/Berlin — after the nightly
 *   genre-slug cleanup (Sun 05:00) and the sitemap-diff IndexNow run
 *   (04:45) so the digest reflects a fully-settled overnight state.
 *
 * Distributed-safety: in split deployments, set
 *   `ENABLE_MAPPING_AUDIT_DIGEST_CRON=false` on every replica EXCEPT one.
 *   Default is `true` (single-replica deploys work out of the box).
 *
 * Opt-in: like every other admin-audit email, delivery only happens when
 *   `ADMIN_AUDIT_EMAIL_RECIPIENTS` is set. Empty windows skip silently.
 */
class ScheduledMappingAuditDigest {
  private static instance: ScheduledMappingAuditDigest;
  private isInitialized = false;
  private isRunning = false;
  private lastRunAt: Date | null = null;
  private lastResult: {
    skipped: boolean;
    reason?: string;
    totalEntries: number;
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
        this.runOnce('cron:daily').catch((err) => {
          logger.error('❌ Daily mapping-audit digest crashed:', err);
        });
      },
      { timezone: 'Europe/Berlin' },
    );
    logger.log(
      '📬 Scheduled mapping-audit digest initialized (daily 06:00 Europe/Berlin)',
    );
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      lastRunAt: this.lastRunAt,
      lastResult: this.lastResult,
    };
  }

  async runOnce(trigger: string = 'manual'): Promise<{
    skipped: boolean;
    reason?: string;
    totalEntries: number;
  } | null> {
    if (this.isRunning) {
      logger.log(
        `⏭️  mapping-audit digest: skip (${trigger}) — previous run still in progress`,
      );
      return null;
    }
    this.isRunning = true;
    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - 24 * 60 * 60 * 1000);
    try {
      logger.log(`📬 mapping-audit digest START (${trigger})`);
      const { ClearedOverridesAuditLog } = await import(
        '../shared/mongo-schemas'
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
      const result = await emailMappingAuditDigest({
        entries,
        windowStart,
        windowEnd,
      });
      this.lastResult = result;
      logger.log(
        `📬 mapping-audit digest DONE — entries=${result.totalEntries} ` +
          `skipped=${result.skipped}${result.reason ? ` reason=${result.reason}` : ''}`,
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
