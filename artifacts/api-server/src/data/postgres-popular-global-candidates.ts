import type pg from 'pg';
import { getPostgresPool } from '../postgres-runtime';

export const POPULAR_RANK_FIELDS = ['_id', 'votes', 'clickCount', 'isFeatured', 'showInGlobalPopular'];

/** Rank narrow native rows once, without transferring 14-language descriptions
 * for every country's candidates. The caller hydrates only the final winners.
 */
export class PostgresPopularGlobalCandidates {
  constructor(private readonly pool: pg.Pool = getPostgresPool()) {}

  async regular(countries: string[], perCountryLimit: number): Promise<any[]> {
    if (!countries.length) return [];
    if (!Number.isSafeInteger(perCountryLimit) || perCountryLimit < 1 || perCountryLimit > 200) {
      throw new Error('Invalid popular per-country limit');
    }
    const result = await this.pool.query(`WITH ranked AS (
      SELECT id,country,votes,click_count,is_featured,show_in_global_popular,
        row_number() OVER (PARTITION BY country
          ORDER BY votes DESC NULLS LAST,click_count DESC NULLS LAST,id ASC) AS position
      FROM stations
      WHERE last_check_ok=true AND is_featured IS DISTINCT FROM true
        AND no_index IS DISTINCT FROM true AND slug IS NOT NULL AND slug<>''
        AND country=ANY($1::text[])
    )
    SELECT s.id,s.votes,s.click_count,s.is_featured,s.show_in_global_popular
    FROM unnest($1::text[]) WITH ORDINALITY AS c(country,country_order)
    JOIN ranked s ON s.country=c.country AND s.position<=$2
    ORDER BY c.country_order,s.position`, [countries, perCountryLimit]);
    // WITH ORDINALITY retains the former country iteration order, including
    // repeated trimmed country keys. Only previously unspecified score ties
    // receive an explicit id tie-breaker within a country.
    return result.rows.map(row => ({ _id: row.id, votes: row.votes,
      clickCount: row.click_count, isFeatured: row.is_featured,
      showInGlobalPopular: row.show_in_global_popular }));
  }
}
