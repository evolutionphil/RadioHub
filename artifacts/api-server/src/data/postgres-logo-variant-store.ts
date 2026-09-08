import type pg from 'pg';
import { getPostgresPool } from '../postgres-runtime';

export interface LogoVariantStation {
  id: string;
  slug: string | null;
  favicon: string | null;
  country?: string | null;
  countryCode?: string | null;
  slugAliases?: string[] | null;
  logoAssets: Record<string, unknown> | null;
}

/** Native-only metadata patch: never persist or rewrite the imported source. */
export class PostgresLogoVariantStore {
  constructor(private readonly pool: pg.Pool) {}

  async findByIds(ids: string[]): Promise<LogoVariantStation[]> {
    const { rows } = await this.pool.query(
      `SELECT id,slug,favicon,country,country_code AS "countryCode",slug_aliases AS "slugAliases",
       logo_assets AS "logoAssets" FROM stations WHERE id=ANY($1::text[]) ORDER BY id`, [ids],
    );
    return rows;
  }

  async appendVariants(before: LogoVariantStation, additions: Record<string, string>): Promise<boolean> {
    const keys = Object.keys(additions);
    if (!keys.length || keys.some(key => !['webp48', 'webp96'].includes(key) || !additions[key])) {
      throw new Error('Only nonempty small logo variants may be appended');
    }
    if (before.logoAssets?.status !== 'completed' || keys.some(key => ![undefined, null, ''].includes(before.logoAssets?.[key] as any))) {
      throw new Error('Existing logo variants cannot be replaced');
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='5s'");
      await client.query("SET LOCAL statement_timeout='15s'");
      const match = await client.query(
        `SELECT id FROM stations WHERE id=$1 AND favicon IS NOT DISTINCT FROM $2
         AND logo_assets=$3::jsonb FOR UPDATE`, [before.id, before.favicon, JSON.stringify(before.logoAssets)],
      );
      if (!match.rowCount) { await client.query('ROLLBACK'); return false; }
      await client.query(
        'UPDATE stations SET logo_assets=logo_assets||$2::jsonb,updated_at=now() WHERE id=$1',
        [before.id, JSON.stringify(additions)],
      );
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
}

export const pgLogoVariants = () => new PostgresLogoVariantStore(getPostgresPool());
