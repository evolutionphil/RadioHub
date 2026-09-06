import { randomBytes } from 'node:crypto';
import { getPostgresPool, getPostgresCoordinationPool } from '../postgres-runtime';
import { pgCatalog } from '../data/postgres-catalog-store';
import { logger } from '../utils/logger';

export async function seedPostgresDefaultLanguages(): Promise<void> {
  const client = await getPostgresPool().connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('radiohub-language-seed'))");
    if (!(await client.query('SELECT 1 FROM translation_languages LIMIT 1')).rowCount) {
      const languages = { en:'English',tr:'Turkish',es:'Spanish',fr:'French',de:'German',ar:'Arabic',it:'Italian',pt:'Portuguese',ru:'Russian',zh:'Chinese',ja:'Japanese',ko:'Korean' };
      for (const [code,name] of Object.entries(languages)) {
        await client.query('INSERT INTO translation_languages(id,code,name,is_enabled,is_default) VALUES ($1,$2,$3,true,$4)',[randomBytes(12).toString('hex'),code,name,code==='en']);
      }
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

/** Daily bounded keyset cleanup; compare-and-swap never overwrites an admin edit. */
export async function cleanupPostgresDescriptionPrefixes(): Promise<void> {
  const client = await getPostgresCoordinationPool().connect();
  let locked = false;
  let connectionError: Error | undefined;
  const onError = (error: Error) => { connectionError = error; };
  client.on('error',onError);
  try {
    locked = (await client.query("SELECT pg_try_advisory_lock(hashtext('radiohub-description-cleanup')) AS acquired")).rows[0].acquired;
    if (!locked) return;
    const key = 'description_cleanup_last_run';
    const previous = (await client.query('SELECT value FROM runtime_app_state WHERE key=$1',[key])).rows[0]?.value;
    const lastRun = Date.parse(previous?.runAt || '');
    if (Number.isFinite(lastRun) && Date.now()-lastRun < 86400000) return;
    const prefix = /^\[(TRANSLATED\s+)?(META|FULL\s+DESCRIPTION|SEO\s+META)[^\]]*\]\s*/i;
    let cleaned = 0;
    for await (const station of pgCatalog().iterate({ descriptions: { $ne:null } }, { fields:['_id','descriptions'],batchSize:200 })) {
      if (connectionError) throw connectionError;
      if (!station.descriptions || typeof station.descriptions !== 'object') continue;
      const next = structuredClone(station.descriptions);
      let changed = false;
      for (const value of Object.values(next) as any[]) {
        if (!value || typeof value !== 'object') continue;
        for (const field of ['meta','full']) {
          if (typeof value[field] !== 'string') continue;
          const replacement = value[field].replace(prefix,'').trim();
          if (replacement !== value[field]) { value[field] = replacement; changed = true; }
        }
      }
      if (changed) cleaned += (await pgCatalog().update({ _id:station._id,descriptions:station.descriptions },{ $set:{descriptions:next} })).modifiedCount;
    }
    if (connectionError) throw connectionError;
    await client.query(`INSERT INTO runtime_app_state(key,value) VALUES ($1,jsonb_build_object('runAt',now()))
      ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`,[key]);
    logger.log(`PostgreSQL description prefix cleanup: ${cleaned} stations`);
  } finally {
    if (locked && !connectionError) await client.query("SELECT pg_advisory_unlock(hashtext('radiohub-description-cleanup'))").catch(() => undefined);
    client.removeListener('error',onError);
    client.release(Boolean(connectionError));
  }
}
