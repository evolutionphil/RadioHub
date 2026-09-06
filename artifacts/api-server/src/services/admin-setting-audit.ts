import { pgAdminSettings } from '../data/postgres-admin-settings-store';

export interface AuditedSettingResult<T = unknown> {
  previousValue: T | null;
  changedAt: Date;
}

interface UpsertArgs<T> {
  key: string;
  value: T;
  changedBy: string | null;
  logTag?: string;
}

interface ClearArgs {
  key: string;
  changedBy: string | null;
  logTag?: string;
  skipHistoryWhenAbsent?: boolean;
}

/** A settings mutation and its audit history always commit together. */
export async function upsertAdminSettingWithHistory<T>(args: UpsertArgs<T>): Promise<AuditedSettingResult<T>> {
  return pgAdminSettings().save(args);
}

export async function clearAdminSettingWithHistory<T = unknown>(args: ClearArgs): Promise<AuditedSettingResult<T> & { existed: boolean }> {
  return pgAdminSettings().clear(args);
}

export interface AdminSettingHistoryEntry {
  id: string;
  action: 'update' | 'clear';
  previousValue: unknown;
  newValue: unknown;
  changedBy: string | null;
  changedAt: Date;
}

export async function listAdminSettingHistory(key: string, limit: number): Promise<AdminSettingHistoryEntry[]> {
  return pgAdminSettings().history(key, limit);
}

export function parseHistoryLimit(raw: unknown, defaultLimit = 20): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 100 ? Math.floor(n) : defaultLimit;
}
