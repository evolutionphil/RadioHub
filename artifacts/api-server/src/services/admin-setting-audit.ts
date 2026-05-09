import {
  AdminSetting,
  AdminSettingHistory,
} from '@workspace/db-shared/mongo-schemas';
import { logger } from '../utils/logger';

// Task #327: shared helper that wraps every `AdminSetting` mutation in
// the matching `AdminSettingHistory` write so admin settings panels do
// not have to repeat the snapshot-prev-then-upsert-then-log dance and,
// just as importantly, can never silently forget the audit row.
//
// Reference implementations of the original inline pattern:
//   - artifacts/api-server/src/routes/admin-coverage-drop-settings-routes.ts
//   - artifacts/api-server/src/routes/admin-mapping-audit-digest-settings-routes.ts
//   - artifacts/api-server/src/routes/admin-maintenance-routes.ts (backfill-retention)
//
// History writes are best-effort: if the append fails we log and keep
// the user-visible mutation succeeding, mirroring the legacy behaviour.

export interface AuditedSettingResult<T = unknown> {
  previousValue: T | null;
  changedAt: Date;
}

interface UpsertArgs<T> {
  key: string;
  value: T;
  changedBy: string | null;
  /** Optional log prefix for any history-write failure messages. */
  logTag?: string;
}

interface ClearArgs {
  key: string;
  changedBy: string | null;
  logTag?: string;
  /**
   * If true, only write a history row when an `AdminSetting` row
   * actually existed. Defaults to false — the original coverage-drop
   * route writes a `clear` row even on a no-op delete so the audit
   * trail captures the admin's intent.
   */
  skipHistoryWhenAbsent?: boolean;
}

export async function upsertAdminSettingWithHistory<T>(
  args: UpsertArgs<T>,
): Promise<AuditedSettingResult<T>> {
  const { key, value, changedBy, logTag } = args;
  const now = new Date();
  // Snapshot the previous value BEFORE the upsert so the audit row
  // captures the actual transition.
  const previousDoc = await AdminSetting.findOne({ key }).lean();
  await AdminSetting.findOneAndUpdate(
    { key },
    {
      $set: { value, updatedAt: now, updatedBy: changedBy },
      $setOnInsert: { createdAt: now, key },
    },
    { upsert: true, new: true },
  );

  try {
    await AdminSettingHistory.create({
      key,
      action: 'update',
      previousValue: (previousDoc?.value as T | undefined) ?? null,
      newValue: value,
      changedBy,
      changedAt: now,
    });
  } catch (historyErr: any) {
    logger.error(
      `[admin-setting-audit${logTag ? ` ${logTag}` : ''}] failed to write history row:`,
      historyErr?.message || historyErr,
    );
  }

  return {
    previousValue: (previousDoc?.value as T | undefined) ?? null,
    changedAt: now,
  };
}

export async function clearAdminSettingWithHistory<T = unknown>(
  args: ClearArgs,
): Promise<AuditedSettingResult<T> & { existed: boolean }> {
  const { key, changedBy, logTag, skipHistoryWhenAbsent = false } = args;
  const now = new Date();
  const previousDoc = await AdminSetting.findOne({ key }).lean();
  const result = await AdminSetting.deleteOne({ key });
  const existed =
    (result?.deletedCount ?? 0) > 0 || previousDoc != null;

  if (!skipHistoryWhenAbsent || existed) {
    try {
      await AdminSettingHistory.create({
        key,
        action: 'clear',
        previousValue: (previousDoc?.value as T | undefined) ?? null,
        newValue: null,
        changedBy,
        changedAt: now,
      });
    } catch (historyErr: any) {
      logger.error(
        `[admin-setting-audit${logTag ? ` ${logTag}` : ''}] failed to write history row:`,
        historyErr?.message || historyErr,
      );
    }
  }

  return {
    previousValue: (previousDoc?.value as T | undefined) ?? null,
    changedAt: now,
    existed,
  };
}

export interface AdminSettingHistoryEntry {
  id: string;
  action: 'update' | 'clear';
  previousValue: unknown;
  newValue: unknown;
  changedBy: string | null;
  changedAt: Date;
}

export async function listAdminSettingHistory(
  key: string,
  limit: number,
): Promise<AdminSettingHistoryEntry[]> {
  const rows = await AdminSettingHistory.find({ key })
    .sort({ changedAt: -1 })
    .limit(limit)
    .lean();
  return rows.map((r) => ({
    id: String(r._id),
    action: r.action,
    previousValue: r.previousValue ?? null,
    newValue: r.newValue ?? null,
    changedBy: r.changedBy ?? null,
    changedAt: r.changedAt,
  }));
}

/**
 * Parse a `?limit=` query param the way the existing settings
 * history endpoints do: clamp to [1, 100], default 20.
 */
export function parseHistoryLimit(raw: unknown, defaultLimit = 20): number {
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0 && n <= 100) {
    return Math.floor(n);
  }
  return defaultLimit;
}
