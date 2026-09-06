import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { getPostgresPool } from '../postgres-runtime';

export const ADMIN_SETTING_HISTORY_RETENTION_PER_KEY = 500;

function rowShape(row: any): any {
  return { _id: row.id, key: row.key, value: row.value, updatedBy: row.updated_by,
    createdAt: row.created_at, updatedAt: row.updated_at };
}

// Settings arrive through JSON APIs. Reject values JSON would silently change
// (NaN, Infinity, unsafe integers or undefined properties) before a write.
function json(value: unknown): string {
  const serialized = JSON.stringify(value, (_key, item) => {
    if (typeof item === 'number' && (!Number.isFinite(item) || (Number.isInteger(item) && !Number.isSafeInteger(item)))) {
      throw new TypeError('Admin settings require finite, safely represented JSON numbers');
    }
    if (item === undefined || typeof item === 'function' || typeof item === 'symbol') throw new TypeError('Admin settings require JSON values');
    return item;
  });
  if (serialized === undefined) throw new TypeError('Admin settings require a JSON value');
  return serialized;
}

export class PostgresAdminSettingsStore {
  constructor(private pool: Pick<pg.Pool, 'query' | 'connect'>) {}

  async get(key: string): Promise<any | null> {
    const result = await this.pool.query('SELECT * FROM admin_settings WHERE key=$1', [key]);
    return result.rows[0] ? rowShape(result.rows[0]) : null;
  }

  async save(args: { key: string; value: unknown; changedBy: string | null }): Promise<{ previousValue: any; changedAt: Date }> {
    const value = json(args.value);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`admin-setting:${args.key}`]);
      const previous = (await client.query('SELECT value,value::text AS value_json FROM admin_settings WHERE key=$1 FOR UPDATE', [args.key])).rows[0];
      const row = (await client.query(
        `INSERT INTO admin_settings(id,key,value,updated_by) VALUES ($1,$2,$3::jsonb,$4)
         ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by RETURNING updated_at`,
        [randomBytes(12).toString('hex'), args.key, value, args.changedBy],
      )).rows[0];
      await client.query(
        `INSERT INTO admin_setting_history(id,key,action,previous_value,new_value,changed_by,changed_at)
         VALUES ($1,$2,'update',$3::jsonb,$4::jsonb,$5,$6)`,
        [randomBytes(12).toString('hex'), args.key, previous?.value_json ?? 'null', value, args.changedBy, row.updated_at],
      );
      await client.query('COMMIT');
      return { previousValue: previous?.value ?? null, changedAt: row.updated_at };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async clear(args: { key: string; changedBy: string | null; skipHistoryWhenAbsent?: boolean }): Promise<{ previousValue: any; changedAt: Date; existed: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`admin-setting:${args.key}`]);
      const previous = (await client.query('DELETE FROM admin_settings WHERE key=$1 RETURNING value,value::text AS value_json', [args.key])).rows[0];
      const changedAt = (await client.query('SELECT now() AS now')).rows[0].now as Date;
      if (previous || !args.skipHistoryWhenAbsent) await client.query(
        `INSERT INTO admin_setting_history(id,key,action,previous_value,new_value,changed_by,changed_at)
         VALUES ($1,$2,'clear',$3::jsonb,NULL,$4,$5)`,
        [randomBytes(12).toString('hex'), args.key, previous?.value_json ?? 'null', args.changedBy, changedAt],
      );
      await client.query('COMMIT');
      return { previousValue: previous?.value ?? null, changedAt, existed: !!previous };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async history(key: string, limit: number): Promise<any[]> {
    const bounded = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : 20;
    const rows = await this.pool.query(
      `SELECT id,action,previous_value AS "previousValue",new_value AS "newValue",changed_by AS "changedBy",changed_at AS "changedAt"
       FROM admin_setting_history WHERE key=$1 ORDER BY changed_at DESC,id DESC LIMIT $2`, [key,bounded],
    );
    return rows.rows;
  }

  async pruneHistory(keepPerKey = ADMIN_SETTING_HISTORY_RETENTION_PER_KEY): Promise<{ keysProcessed: number; rowsTrimmed: number }> {
    if (!Number.isInteger(keepPerKey) || keepPerKey < 1) throw new TypeError('History retention must be a positive integer');
    const result = await this.pool.query(
      `WITH ranked AS MATERIALIZED (
         SELECT id,key,row_number() OVER (PARTITION BY key ORDER BY changed_at DESC,id DESC) AS position
         FROM admin_setting_history
       ), deleted AS (
         DELETE FROM admin_setting_history WHERE id IN (SELECT id FROM ranked WHERE position>$1) RETURNING id
       ) SELECT (SELECT count(DISTINCT key)::integer FROM ranked) AS "keysProcessed",
         (SELECT count(*)::integer FROM deleted) AS "rowsTrimmed"`, [keepPerKey],
    );
    return result.rows[0];
  }
}

export const pgAdminSettings = (): PostgresAdminSettingsStore => new PostgresAdminSettingsStore(getPostgresPool());
export const getAdminSetting = (key: string): Promise<any | null> => pgAdminSettings().get(key);
