import type pg from 'pg';
import { PostgresCatalogStore } from './postgres-catalog-store';
import { getPostgresPool } from '../postgres-runtime';

/** SSR queries must not inherit the 60-second maintenance-query budget.
 * SET LOCAL is transaction-scoped, so pooled connections cannot leak this limit
 * into background imports. PostgreSQL itself cancels a slow query after 4s. */
async function boundedQuery(text:string,values?:any[]):Promise<pg.QueryResult> {
  const client=await getPostgresPool().connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '4000ms'");
    const result=await client.query(text,values);
    await client.query('COMMIT');
    return result;
  } catch(error) {
    await client.query('ROLLBACK').catch(()=>undefined);
    throw error;
  } finally {client.release();}
}

const readStore = new PostgresCatalogStore({query:boundedQuery} as unknown as pg.Pool);
export const pgSeoCatalog = ():Pick<PostgresCatalogStore,'find'|'findOne'|'findById'|'count'|'groupCount'> => readStore;
